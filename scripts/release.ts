// Versions and releases of Codehouse. Run with tsx (the package and the release workflow do).
//
//   tsx scripts/release.ts version              the version this checkout builds as, for example 1.0.212
//   tsx scripts/release.ts stamp <dir>           write <dir>/release.json: the version and each part's hash
//   tsx scripts/release.ts publish <dir> <out>   zip the parts into <out>, write and sign release.json there, and
//                                                write notes.md for the GitHub release page
//   tsx scripts/release.ts ship [--skip-tests]   npm run release: the whole release from this computer. The commit
//                                                must be pushed. The gate on what changed since the last release
//                                                (scripts/gate.mjs), package and its check, installer, sign, then
//                                                gh release create with Codehouse-Setup.exe first. --skip-tests when the
//                                                gate has just passed on exactly this commit.
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
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  checkRoute,
  makeRelease,
  stampInstall,
  type LegacyRoute,
} from "../apps/host/src/update/publish.js"
import { writeZip } from "../apps/host/src/update/zip.js"
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

const NO_ROUTES =
  "No update routes file (release-channels.local.json here, or channels.json beside the release key). Without it, installs made before the rename cannot update. See scripts/release.ts."

/** The update routes for installs made before a rename, or undefined when there is no routes file here. */
function loadRoutes(): LegacyRoute[] | undefined {
  const files = [
    path.join(root, "release-channels.local.json"),
    path.join(process.env.USERPROFILE ?? "", ".codehouse-release", "channels.json"),
  ]
  const file = files.find((f) => fs.existsSync(f))
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
    ].join("\n"),
  )
  console.log(`[release] ${v.version}: ${made.files.length} files in ${path.resolve(b)}`)
} else if (cmd === "ship") {
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
  const node = process.execPath
  const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs")
  // The gate checks what this release changes: everything since the last release, or everything when there is none.
  if (!process.argv.includes("--skip-tests")) {
    let last: string | undefined
    // The tags are made on GitHub, so fetch them first: without the last one the gate went back two releases and
    // ran the whole suite for 34 minutes, which failed two timing tests on a busy laptop (1 Nov).
    try {
      git("fetch", "--tags", "--quiet", "origin")
    } catch {
      // offline: compare with the newest tag that is here
    }
    try {
      last = git("describe", "--tags", "--abbrev=0", "--match", "v*", "HEAD")
    } catch {
      last = undefined
    }
    step(
      last ? `gate: what changed since ${last}` : "gate: everything (no earlier release)",
      node,
      [path.join(root, "scripts", "gate.mjs"), ...(last ? ["--base", last] : ["--full"])],
    )
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
  step("publish", "gh", [
    "release",
    "create",
    `v${v.version}`,
    ...files,
    "--repo",
    REPO,
    "--title",
    `Codehouse ${v.version}`,
    "--notes-file",
    path.join(out, "notes.md"),
    "--target",
    git("rev-parse", "HEAD"),
    "--latest",
  ])
  console.log(
    `[release] Codehouse ${v.version} is out: https://github.com/${REPO}/releases/tag/v${v.version}`,
  )
} else {
  console.log(
    "Usage: tsx scripts/release.ts version | stamp <dir> | publish <dir> <out> | ship [--skip-tests]",
  )
  process.exit(2)
}
