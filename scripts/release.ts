// Versions and releases of JCVC. Run with tsx (the package and the release workflow do).
//
//   tsx scripts/release.ts version              the version this checkout builds as, for example 1.0.212
//   tsx scripts/release.ts stamp <dir>           write <dir>/release.json: the version and each part's hash
//   tsx scripts/release.ts publish <dir> <out>   zip the parts into <out>, write and sign release.json there, and
//                                                write notes.md for the GitHub release page
//   tsx scripts/release.ts ship [--skip-tests]   npm run release: the whole release from this computer. The commit
//                                                must be pushed. The gate on what changed since the last release
//                                                (scripts/gate.mjs), package and its check, installer, sign, then
//                                                gh release create with JCVC-Setup.exe first. --skip-tests when the
//                                                gate has just passed on exactly this commit.
//
// GitHub Actions are switched off for this repository (the owner's account has few minutes), so releases are made
// here. The signing key is the Ed25519 private key (PEM): JCVC_RELEASE_KEY holds it, or JCVC_RELEASE_KEY_FILE names
// its file, or it is %USERPROFILE%\.jcvc-release\release-key.pem. Its public half is in apps/host/src/update/manifest.ts.
//
// A version is major.minor from package.json and the number of commits, so every push to main is higher than the
// one before. A working copy with uncommitted changes builds as -dev, which sorts before the release of that number.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { makeRelease, stampInstall } from "../apps/host/src/update/publish.js"
import { writeZip } from "../apps/host/src/update/zip.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const REPO = "breakmylegs/gatehouse"
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()

export function currentVersion(): { version: string; commit: string | undefined } {
  if (process.env.JCVC_VERSION)
    return { version: process.env.JCVC_VERSION, commit: process.env.GITHUB_SHA }
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

/** The commit subjects since the last release tag, without conventional-commit prefixes. */
function changes(): string[] {
  let range = "HEAD~30..HEAD"
  try {
    range = `${git("describe", "--tags", "--abbrev=0", "--match", "v*", "HEAD^")}..HEAD`
  } catch {
    // no earlier release: the last 30 commits
  }
  let log = ""
  try {
    log = git("log", range, "--no-merges", "--format=%s")
  } catch {
    log = git("log", "-30", "--no-merges", "--format=%s")
  }
  return log
    .split(/\r?\n/)
    .filter(Boolean)
    .map((s) => s.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, ""))
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
}

function releaseKey(): string {
  if (process.env.JCVC_RELEASE_KEY) return process.env.JCVC_RELEASE_KEY
  const file =
    process.env.JCVC_RELEASE_KEY_FILE ??
    path.join(process.env.USERPROFILE ?? "", ".jcvc-release", "release-key.pem")
  if (!fs.existsSync(file))
    throw new Error(
      `No release key: set JCVC_RELEASE_KEY or JCVC_RELEASE_KEY_FILE, or put it at ${file}.`,
    )
  return fs.readFileSync(file, "utf8")
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
  const notes = list.map((s) => `- ${s}`).join("\n")
  const made = await makeRelease({
    dir: path.resolve(a),
    out: path.resolve(b),
    version: v.version,
    notes,
    ...(v.commit ? { commit: v.commit } : {}),
    privateKeyPem: key,
  })
  const dl = (f: string) => `https://github.com/${REPO}/releases/download/v${v.version}/${f}`
  fs.writeFileSync(
    path.join(path.resolve(b), "notes.md"),
    [
      "## Download",
      "",
      "For Windows 10 and 11, 64-bit. You only install once.",
      "",
      `- **[JCVC-Setup.exe](${dl("JCVC-Setup.exe")})**: the installer. It installs JCVC for you alone, in your own Programs folder, with no administrator rights.`,
      `- **[JCVC-Setup-exe.zip](${dl("JCVC-Setup-exe.zip")})**: the same installer in a zip. Use this one if your browser will not keep a .exe download; open the zip and run JCVC-Setup.exe from it.`,
      "- **Your browser will not keep either?** If you have the source, `npm run install:local` builds JCVC and installs it in the same place, with nothing downloaded. See the README.",
      "",
      "Already installed? You do not need to download anything. JCVC checks for new versions (every 30 minutes unless you change it in Settings) and offers this one. Choose Update and it switches over and restarts by itself.",
      "",
      "## What is new",
      "",
      notes || "- Small fixes.",
      "",
      "## The other files",
      "",
      "`release.json`, `release.sig` and the `jcvc-*.zip` files are what JCVC's updater downloads: only the parts that changed, checked against a signature. You do not need them.",
      "",
    ].join("\n"),
  )
  console.log(`[release] ${v.version}: ${made.files.length} files in ${path.resolve(b)}`)
} else if (cmd === "ship") {
  const key = releaseKey()
  const v = currentVersion()
  if (v.version.includes("-")) throw new Error(`${v.version}: commit your changes first.`)
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
      path.join(root, "dist-app", "JCVC"),
      out,
    ],
    {
      ...process.env,
      JCVC_RELEASE_KEY: key,
    },
  )
  // The installer, and the same in a zip.
  fs.copyFileSync(path.join(root, "dist-app", "JCVC-Setup.exe"), path.join(out, "JCVC-Setup.exe"))
  await writeZip(path.join(out, "JCVC-Setup-exe.zip"), out, ["JCVC-Setup.exe"], {
    date: new Date(),
  })
  const files = [
    "JCVC-Setup.exe",
    "JCVC-Setup-exe.zip",
    "release.json",
    "release.sig",
    ...fs.readdirSync(out).filter((f) => /^jcvc-.*\.zip$/.test(f)),
  ].map((f) => path.join(out, f))
  step("publish", "gh", [
    "release",
    "create",
    `v${v.version}`,
    ...files,
    "--repo",
    REPO,
    "--title",
    `JCVC ${v.version}`,
    "--notes-file",
    path.join(out, "notes.md"),
    "--target",
    git("rev-parse", "HEAD"),
    "--latest",
  ])
  console.log(
    `[release] JCVC ${v.version} is out: https://github.com/${REPO}/releases/tag/v${v.version}`,
  )
} else {
  console.log(
    "Usage: tsx scripts/release.ts version | stamp <dir> | publish <dir> <out> | ship [--skip-tests]",
  )
  process.exit(2)
}
