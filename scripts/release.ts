// Versions and releases of Codehouse. Run with tsx (the package and the release workflow do).
//
//   tsx scripts/release.ts version              the version this checkout builds as, for example 1.0.212
//   tsx scripts/release.ts stamp <dir>           write <dir>/release.json: the version and each part's hash
//   tsx scripts/release.ts publish <dir> <out>   zip the parts into <out>, write and sign release.json there, and
//                                                write notes.md for the GitHub release page
//   tsx scripts/release.ts ship [--skip-tests]   npm run release: the whole release from this computer. The commit
//                                                must be pushed. The gate on what changed since the last release
//                                                (scripts/gate.mjs), package and its check, installer, sign, then
//                                                gh release create with Codehouse-Setup.exe first. --skip-tests only
//                                                with the owner's signed override for this version (C-002), recorded
//                                                in the audit log.
//   tsx scripts/release.ts allow-skip-tests <why> the owner's step, at a console: a signed override for this version
//
// GitHub Actions are switched off for this repository (the owner's account has few minutes), so releases are made
// here. The signing key is the Ed25519 private key (PEM): CODEHOUSE_RELEASE_KEY holds it, or CODEHOUSE_RELEASE_KEY_FILE names
// its file, or it is %USERPROFILE%\.codehouse-release\release-key.pem. Its public half is in apps/host/src/update/manifest.ts.
//
// Update routes (owner, 2 Nov: "We cant have a breaking change ever"). Installs made before a rename read their updates
// under other names and another product id. Each release also publishes a route for each of them, so they update in
// the app and then move into their own folder. The routes name those earlier names, so they are kept out of the
// repository: release-channels.local.json at the top of this checkout (ignored by git), or channels.json beside the
// release key. publish and ship refuse without one. Never remove a route: an install can come back to it at any time.
//
// A version is major.minor from package.json and the number of commits, so every push to main is higher than the
// one before. A working copy with uncommitted changes builds as -dev, which sorts before the release of that number.
import { notesFor, parseLog, type Change } from "./platforms.js"
import { execFileSync, spawnSync } from "node:child_process"
import { publishRelease } from "./release-upload.js"
import { gateRecord } from "./gate-record.mjs"
import { heavyLock } from "./heavy-lock.mjs"
import { fits, jobHeadroom } from "./job-headroom.mjs"
import { findRoutesFile } from "./release-routes.js"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  checkRoute,
  makeRelease,
  stampInstall,
  type LegacyRoute,
} from "../apps/host/src/update/publish.js"
import { writeZip } from "../apps/host/src/update/zip.js"
import { buildStatement, sessionNotes, verifyStatement } from "../apps/host/src/slsa.js"
import { RELEASE_KEYS } from "../apps/host/src/update/manifest.js"
import { redact } from "@gatehouse/policy"
import { AuditWriter } from "@gatehouse/shared/audit"
import { auditDir } from "@gatehouse/shared/node"
import {
  checkSkipOverride,
  makeSkipOverride,
  overridePath,
  readSkipOverride,
} from "./skip-tests-override.js"
import {
  CHANGELOG_FILE,
  parseChangelog,
  whatIsNew,
  type ChangelogEntry,
} from "../apps/host/src/update/changelog.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const REPO = "breakmylegs/gatehouse"
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()

export function currentVersion(): { version: string; commit: string | undefined } {
  if (process.env.CODEHOUSE_VERSION)
    return { version: process.env.CODEHOUSE_VERSION, commit: process.env.GITHUB_SHA }
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
    version: string
  }
  const [major, minor] = pkg.version.split(".")
  let count = "0"
  let commit: string | undefined
  let dirty = false
  try {
    count = git("rev-list", "--count", "HEAD")
    commit = git("rev-parse", "HEAD")
    dirty = git("status", "--porcelain", "--untracked-files=no").length > 0
  } catch {
    // not a git checkout
  }
  return { version: `${major}.${minor}.${count}${dirty ? "-dev" : ""}`, commit }
}

/**
 * The commits since the last release tag, each with its subject (without the conventional-commit prefix), the files it
 * touched and the platform those make it for (scripts/platforms.ts, for forks such as the Mac one).
 */
function changes(): Change[] {
  let range = "HEAD~30..HEAD"
  // Release tags are made on GitHub by gh release create, so fetch them, or the last release is not found here.
  try {
    git("fetch", "--tags", "--quiet", "origin")
  } catch {
    // offline: fall back to what is here
  }
  try {
    range = `${git("describe", "--tags", "--abbrev=0", "--match", "v*", "HEAD^")}..HEAD`
  } catch {
    // no earlier release: the last 30 commits
  }
  const format = "--format=%x1e%H%x1f%s"
  let log = ""
  try {
    log = git("log", range, "--no-merges", format, "--name-only")
  } catch {
    log = git("log", "-30", "--no-merges", format, "--name-only")
  }
  return parseLog(log)
}

function releaseKey(): string {
  if (process.env.CODEHOUSE_RELEASE_KEY) return process.env.CODEHOUSE_RELEASE_KEY
  const file =
    process.env.CODEHOUSE_RELEASE_KEY_FILE ??
    path.join(process.env.USERPROFILE ?? "", ".codehouse-release", "release-key.pem")
  if (!fs.existsSync(file))
    throw new Error(
      `No release key: set CODEHOUSE_RELEASE_KEY or CODEHOUSE_RELEASE_KEY_FILE, or put it at ${file}.`,
    )
  return fs.readFileSync(file, "utf8")
}

/**
 * O60: what a release's own run needs free in a session's job: its tests' processes (one at a time, up to
 * TEST_NODE_OPTIONS' heap), packaging, and the release itself beside them. Medium (4 GB) leaves enough beside a
 * session's own use; Low (2 GB) does not.
 */
export const RELEASE_NEEDS_MB = 3072
/** The memory options a release's test processes run with, as every other test run here does. */
export const TEST_NODE_OPTIONS = "--max-old-space-size=3072 --max-semi-space-size=4"
/** O60: what the computer needs free before a release's tests start (they crashed with about 2.1 GB free, passed with 2.4). */
export const TEST_NEEDS_FREE_MB = 2560

/**
 * Waits until the computer has `mb` free, saying so once a minute, for up to 20 minutes; then stops the release with
 * a clear message rather than starting tests that would run out of memory partway.
 */
async function waitForMemory(mb: number): Promise<void> {
  const until = Date.now() + 20 * 60_000
  let said = 0
  for (;;) {
    const free = Math.round(os.freemem() / 1024 ** 2)
    if (free >= mb) return
    if (Date.now() > until)
      throw new Error(
        `The computer has had only about ${free} MB free for 20 minutes, and a release's tests need ${mb} MB. Close some sessions or other programs, then release again.`,
      )
    if (Date.now() - said >= 60_000) {
      console.log(`[release] waiting for memory: ${free} MB free, the tests need ${mb} MB`)
      said = Date.now()
    }
    await new Promise((r) => setTimeout(r, 10_000))
  }
}

const NO_ROUTES =
  "No update routes file (release-channels.local.json here, or channels.json beside the release key). Without it, installs made before the rename cannot update. See scripts/release.ts."

/** The update routes for installs made before a rename, or undefined when there is no routes file here. */
function loadRoutes(): LegacyRoute[] | undefined {
  // O60: this checkout, the main worktree (a release from a worktree needs nothing copied in), or beside the key.
  const file = findRoutesFile(root)
  if (!file) return undefined
  const routes = (JSON.parse(fs.readFileSync(file, "utf8")) as { legacy?: LegacyRoute[] }).legacy
  if (!Array.isArray(routes)) throw new Error(`${file} has no "legacy" list of update routes.`)
  for (const route of routes) checkRoute(route)
  return routes
}

function step(
  label: string,
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): void {
  console.log(`[release] ${label}`)
  execFileSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    env,
    shell: process.platform === "win32" && (cmd === "npx" || cmd === "npm"),
  })
}

/**
 * Every published release's notes and date, from GitHub through gh (signed in already, since gh publishes the release),
 * for the changelog in Settings (owner, 4 Nov). Drafts have no date and are left out.
 */
function publishedReleases(): ChangelogEntry[] {
  const out = execFileSync(
    "gh",
    [
      "api",
      "--paginate",
      `repos/${REPO}/releases?per_page=100`,
      "--jq",
      '.[] | select(.published_at != null) | {version: (.tag_name | ltrimstr("v")), date: .published_at, body: (.body // "")}',
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { version: string; date: string; body: string })
    .map((r) => ({ version: r.version, date: r.date, notes: whatIsNew(r.body) }))
}

const [cmd, a, b] = process.argv.slice(2)
if (cmd === "version") {
  console.log(currentVersion().version)
} else if (cmd === "stamp" && a) {
  const v = currentVersion()
  await stampInstall(path.resolve(a), {
    version: v.version,
    ...(v.commit ? { commit: v.commit } : {}),
  })
  console.log(`[release] ${path.resolve(a)} is version ${v.version}`)
} else if (cmd === "publish" && a && b) {
  const key = releaseKey()
  const v = currentVersion()
  if (v.version.includes("-"))
    throw new Error(`${v.version} has uncommitted changes and cannot be published.`)
  const list = changes()
  const notes = notesFor(list)
  // Which change is for which platform, for a fork that pulls the newest features (owner, 4 Nov; docs/forks.md).
  fs.mkdirSync(path.resolve(b), { recursive: true })
  fs.writeFileSync(
    path.join(path.resolve(b), "changes.json"),
    JSON.stringify(
      { version: v.version, ...(v.commit ? { commit: v.commit } : {}), changes: list },
      null,
      2,
    ) + "\n",
  )
  // Every release's notes, this one first, in one file the changelog in Settings reads (owner, 4 Nov).
  const history = JSON.stringify(
    {
      releases: [
        { version: v.version, date: new Date().toISOString(), notes: notes || "- Small fixes." },
        ...publishedReleases().filter((r) => r.version !== v.version),
      ],
    },
    null,
    1,
  )
  if (!parseChangelog(history)?.length) throw new Error("The changelog could not be made.")
  fs.writeFileSync(path.join(path.resolve(b), CHANGELOG_FILE), history + "\n")
  const routes = loadRoutes()
  if (!routes) throw new Error(NO_ROUTES)
  const setup = path.join(root, "dist-app", "Codehouse-Setup.exe")
  const made = await makeRelease({
    dir: path.resolve(a),
    out: path.resolve(b),
    version: v.version,
    notes,
    ...(v.commit ? { commit: v.commit } : {}),
    privateKeyPem: key,
    ...(fs.existsSync(setup) ? { installer: setup } : {}),
    routes,
  })
  // The routes' file names, for ship to upload (the names are not written down anywhere else in the repository).
  fs.writeFileSync(
    path.join(path.resolve(b), "routes.txt"),
    routes.flatMap((r) => [r.manifest, r.signature]).join("\n") + "\n",
  )
  const dl = (f: string) => `https://github.com/${REPO}/releases/download/v${v.version}/${f}`
  fs.writeFileSync(
    path.join(path.resolve(b), "notes.md"),
    [
      "## Download",
      "",
      "For Windows 10 and 11, 64-bit. You only install once.",
      "",
      `- **[Codehouse-Setup.exe](${dl("Codehouse-Setup.exe")})**: the installer. It installs Codehouse for you alone, in your own Programs folder, with no administrator rights.`,
      `- **[Codehouse-Setup-exe.zip](${dl("Codehouse-Setup-exe.zip")})**: the same installer in a zip. Use this one if your browser will not keep a .exe download; open the zip and run Codehouse-Setup.exe from it.`,
      "- **Your browser will not keep either?** If you have the source, `npm run install:local` builds Codehouse and installs it in the same place, with nothing downloaded. See the README.",
      "",
      "Already installed? You do not need to download anything. Codehouse checks for new versions (every 30 minutes unless you change it in Settings) and offers this one. Choose Update and it switches over and restarts by itself.",
      "",
      "## What is new",
      "",
      notes || "- Small fixes.",
      "",
      "## The other files",
      "",
      "`changes.json` lists every change in this release with the files it touched and whether it is for every platform or Windows only, for forks of Codehouse on other systems (see docs/forks.md in the repository).",
      "",
      "`changelog.json` holds every release's notes and date, for the changelog in Codehouse's Settings.",
      "",
      "`update.json`, `update.sig`, the other `.json` and `.sig` files and the `codeh-*.zip` files are what Codehouse's updater downloads, for this version and for copies installed before a rename: only the parts that changed, checked against a signature. You do not need them.",
      "",
      "`provenance.intoto.json` is this release's SLSA provenance: every file here with its SHA-256, the commit it was built from, and the Codehouse sessions whose commits went in, with the audit records and evidence packs they are tied to.",
      "",
    ].join("\n"),
  )
  console.log(`[release] ${v.version}: ${made.files.length} files in ${path.resolve(b)}`)
} else if (cmd === "ship") {
  // D-032: when this release began, for its provenance.
  const startedOn = new Date().toISOString()
  const key = releaseKey()
  const v = currentVersion()
  if (v.version.includes("-")) throw new Error(`${v.version}: commit your changes first.`)
  // Before anything long runs: a release without the routes would strand installs made before the rename.
  if (!loadRoutes()) throw new Error(NO_ROUTES)
  git("fetch", "origin", "main")
  if (git("rev-parse", "HEAD") !== git("rev-parse", "origin/main"))
    throw new Error(
      "This commit is not what origin/main has. Push first, so the release points at a published commit.",
    )
  try {
    git("ls-remote", "--exit-code", "--tags", "origin", `refs/tags/v${v.version}`)
    throw new Error(`v${v.version} is already released.`)
  } catch (e) {
    if ((e as Error).message.includes("already released")) throw e
  }
  // O60 (owner, 27 Nov): one heavy run at a time on this computer; a release waits its turn behind the full gate or a
  // whole-suite run, saying so, instead of both running out of memory partway.
  await heavyLock(`the release of ${v.version} from ${root}`, { say: (l: string) => console.log(`[release] ${l}`) })
  // O60: inside a Codehouse session's job object, a release needs room in it; too little stops it here, naming the
  // level it needs, rather than crashing halfway. Outside one (a terminal, or a session's tools, which run outside
  // the job), nothing to check. The free memory of the computer is said either way.
  const room = fits(RELEASE_NEEDS_MB, jobHeadroom())
  if (!room.ok) throw new Error(room.message)
  console.log(`[release] memory: ${Math.round(os.freemem() / 1024 ** 2)} MB free on this computer${room.free !== undefined ? `, ${room.free} MB free in this session's job` : ""}`)
  const node = process.execPath
  const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs")
  // C-002: skipping the tests needs the owner's signed override for exactly this version, recorded before going on.
  if (process.argv.includes("--skip-tests")) {
    const r = checkSkipOverride(readSkipOverride(), v.version, RELEASE_KEYS)
    if (!r.ok)
      throw new Error(
        `--skip-tests needs the owner's signed override for ${v.version}: ${r.reason} The owner makes one with: npx tsx scripts/release.ts allow-skip-tests "<why>"`,
      )
    const writer = new AuditWriter({ dir: auditDir(), redact: (x) => redact(x, { terms: [] }) })
    await writer.append({
      session: "release",
      event: "release_skip_tests",
      channel: "desktop",
      tool: "release",
      cwd: root,
      input: { version: v.version, reason: r.override.reason, expiresAt: r.override.expiresAt },
      verdict: {
        outcome: "allow",
        ruleId: "release-skip-tests",
        reason: "A release skipped its tests under the owner's signed override for this version.",
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: "",
      },
      latencyMs: 0,
    })
    console.log(`[release] tests skipped under the owner's override: ${r.override.reason}`)
  }
  // Owner, 13 Nov: "It doesnt make sense to test everything every time. So even for releases the optimal amount of
  // feature and regression tests should be done." Each change is tested when it is made (its own tests and the
  // regression tests for what it touches), so a release no longer re-runs everything since the last one (that was up
  // to 237 test files, half an hour and more on this laptop). It runs the security invariant tests the gate always
  // runs, then the prohibited patterns and the packaged copy's own check below.
  // O60 (owner, 27 Nov): a full gate recorded as complete for exactly this commit ran these and everything else, so
  // they are not run again here.
  const gated = gateRecord(git("rev-parse", "HEAD"))
  if (!process.argv.includes("--skip-tests") && gated?.complete)
    console.log(`[release] the full gate passed for this commit (${gated.passed.length} test files, recorded ${gated.updated ?? ""}), so its tests are not run again`)
  else if (!process.argv.includes("--skip-tests")) {
    const invariants = [
      "apps/host/test/invariants.test.ts",
      "apps/host/test/threat-model.test.ts",
      "apps/host/test/providers.test.ts",
      "apps/host/test/conformance.test.ts",
    ]
    // 16 Nov: with under 4 GB free (Codehouse's own sessions running), two workers at once timed out or crashed, two
    // releases in a row. O60: always each file in a process of its own, one worker, with the memory options every
    // other run here uses (27 Nov: four releases in a row crashed in invariants.test.ts, "Fatal process out of
    // memory: Zone", run with the defaults), and each process stopped with all it started if it hangs.
    // O60, measured 27 Nov: invariants.test.ts crashed with V8's "Fatal process out of memory: Zone" on a background
    // compile thread whenever the computer had about 2 GB free (other sessions running), and passed with more; its
    // environment made no difference. So it waits, saying so, until there is room, and a crash of that kind gets one
    // more try once memory is back, rather than failing the release halfway.
    const tests = () =>
      spawnSync(node, [path.join(root, "scripts", "test-shards.mjs"), ...invariants], {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
        env: { ...process.env, NODE_OPTIONS: TEST_NODE_OPTIONS, GATEHOUSE_SHARD_TIMEOUT_MIN: "20" },
      })
    console.log("[release] security invariant tests, one file to a process")
    await waitForMemory(TEST_NEEDS_FREE_MB)
    let r = tests()
    if (r.status !== 0 && /out of memory|exit code 2147483651|exited unexpectedly/.test(`${r.stdout}${r.stderr}`)) {
      console.log("[release] a test process ran out of memory (the computer was short of it); trying again once there is room")
      await waitForMemory(TEST_NEEDS_FREE_MB + 512)
      r = tests()
    }
    process.stdout.write(`${r.stdout ?? ""}${r.stderr ?? ""}`.split(/\r?\n/).filter((l) => /\[shards\]|FAIL|✗|×/.test(l)).join("\n") + "\n")
    if (r.status !== 0) throw new Error(`The security invariant tests failed:\n${`${r.stdout}${r.stderr}`.slice(-6000)}`)
  }
  // Even with --skip-tests: a release never ships what the terms or the rules forbid (CH-01).
  step("prohibited patterns", node, [path.join(root, "scripts", "forbidden.mjs")])
  step("package and check it", node, [path.join(root, "scripts", "package.mjs"), "--check"])
  step("installer", node, [path.join(root, "scripts", "installer.mjs")])
  const out = path.join(root, "dist-release")
  fs.rmSync(out, { recursive: true, force: true })
  step(
    "sign",
    node,
    [
      tsx,
      path.join(root, "scripts", "release.ts"),
      "publish",
      path.join(root, "dist-app", "Codehouse"),
      out,
    ],
    {
      ...process.env,
      CODEHOUSE_RELEASE_KEY: key,
    },
  )
  // The installer, and the same in a zip.
  fs.copyFileSync(
    path.join(root, "dist-app", "Codehouse-Setup.exe"),
    path.join(out, "Codehouse-Setup.exe"),
  )
  await writeZip(path.join(out, "Codehouse-Setup-exe.zip"), out, ["Codehouse-Setup.exe"], {
    date: new Date(),
  })
  const files = [
    "Codehouse-Setup.exe",
    "Codehouse-Setup-exe.zip",
    "update.json",
    "update.sig",
    "changes.json",
    CHANGELOG_FILE,
    ...fs.readFileSync(path.join(out, "routes.txt"), "utf8").split(/\r?\n/).filter(Boolean),
    ...fs.readdirSync(out).filter((f) => /^codeh-.*\.zip$/.test(f)),
  ].map((f) => path.join(out, f))
  // D-032: the release's provenance (SLSA v1): its files and their hashes, the commit, and the agent sessions whose
  // commits went in since the last release, from their git notes. Checked against the files before it is added; a
  // failure here is said and never stops the release.
  try {
    let range = "HEAD~100..HEAD"
    try {
      execFileSync("git", ["fetch", "-q", "--tags", "origin"], { cwd: root, windowsHide: true, stdio: "ignore" })
      const prev = publishedReleases()
        .map((r) => r.version)
        .find((x) => x !== v.version)
      if (prev) range = `${git("rev-parse", `v${prev}^{commit}`)}..HEAD`
    } catch {
      // The last release's tag is not here: the last hundred commits stand in.
    }
    const statement = buildStatement({ files, repo: REPO, tag: `v${v.version}`, commit: git("rev-parse", "HEAD"), version: v.version, notes: sessionNotes(root, range), startedOn, finishedOn: new Date().toISOString() })
    const check = verifyStatement(statement, out)
    if (!check.ok) throw new Error(check.why)
    const file = path.join(out, "provenance.intoto.json")
    fs.writeFileSync(file, JSON.stringify(statement, null, 2))
    files.push(file)
    console.log(`[release] provenance: ${statement.subject.length} files, ${statement.predicate.runDetails.byproducts?.length ?? 0} agent sessions`)
  } catch (e) {
    console.log(`[release] provenance not made, the release goes on without it: ${(e as Error).message}`)
  }
  // O28: one file at a time into a draft, each retried and checked, published only when all match.
  console.log("[release] publish")
  publishRelease({
    run: (cmd, args) => {
      const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8", windowsHide: true })
      return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? String(r.error ?? "") }
    },
    repo: REPO,
    tag: `v${v.version}`,
    title: `Codehouse ${v.version}`,
    notesFile: path.join(out, "notes.md"),
    target: git("rev-parse", "HEAD"),
    files,
  })
  console.log(
    `[release] Codehouse ${v.version} is out: https://github.com/${REPO}/releases/tag/v${v.version}`,
  )
} else if (cmd === "allow-skip-tests") {
  // C-002: the owner's own step, typed at a console: it refuses to run without one, so no script can make it.
  if (!process.stdin.isTTY)
    throw new Error("This is the owner's step: run it yourself at a console.")
  const reason = process.argv.slice(3).join(" ").trim()
  const v = currentVersion()
  const typed = await new Promise<string>((resolve) => {
    process.stdout.write(`Type the version (${v.version}) to let its release skip the tests: `)
    process.stdin.once("data", (d) => resolve(String(d).trim()))
  })
  process.stdin.pause()
  if (typed !== v.version) throw new Error("That is not the version, so no override was made.")
  const o = makeSkipOverride(releaseKey(), v.version, reason)
  fs.mkdirSync(path.dirname(overridePath()), { recursive: true })
  fs.writeFileSync(overridePath(), JSON.stringify(o, null, 2) + "\n")
  console.log(`[release] ${v.version} may skip its tests until ${o.expiresAt}.`)
} else {
  console.log(
    "Usage: tsx scripts/release.ts version | stamp <dir> | publish <dir> <out> | ship [--skip-tests] | allow-skip-tests <why>",
  )
  process.exit(2)
}
