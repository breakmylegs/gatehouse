// Mac fork. Builds Codehouse.app, a Mac app you put in Applications and open like any other, and a disk image to
// install it from. Nobody needs Node, npm or a terminal to use it: everything it runs on is inside the app.
//
//   dist-app/Codehouse.app/Contents/
//     MacOS/Codehouse           the window, menu bar icon and Host launcher (packaging/mac/*.swift)
//     Resources/runtime/node    the Node it runs on: Node's own Mac build, its sha256 checked against nodejs.org
//     Resources/app/            the application and its production node_modules (scripts/package.mjs --stage-only)
//     Resources/Codehouse.icns, splash.png, tray-*.png
//     Info.plist
//   dist-app/Codehouse-<version>.dmg   with --dmg
//
// Usage: node scripts/package-mac.mjs [--skip-build] [--swift-only] [--check] [--dmg] [--install]
//   --skip-build  reuse apps/web/dist and apps/phone/dist as they are
//   --swift-only  only recompile the program into an existing dist-app/Codehouse.app (quick, for the window's code)
//   --check       afterwards run Codehouse --check against the built app, with its own data folder
//   --dmg         also make the disk image
//   --install     put it in /Applications, or in your own Applications folder when /Applications needs an administrator
//   --when-quit   with --install, when that Codehouse is running: install it as soon as you quit it, and open it again
//
// Builds on a Mac only, for the Mac's own processor. Signed for this Mac only (ad hoc), not notarised: see docs/mac.md.
import { execFileSync, spawn, spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const NODE_VERSION = "24.22.2"
const MIN_MACOS = "13.0"
const BUNDLE_ID = "local.gatehouse.codehouse"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const out = path.join(root, "dist-app")
const cache = path.join(out, ".cache")
const appBundle = path.join(out, "Codehouse.app")
const contents = path.join(appBundle, "Contents")
const resources = path.join(contents, "Resources")
const say = (t) => console.log(`[package-mac] ${t}`)
const run = (cmd, a, opts = {}) => {
  const r = spawnSync(cmd, a, { stdio: "inherit", ...opts })
  if (r.status !== 0) throw new Error(`${cmd} ${a.join(" ")} failed (${r.status})`)
}

if (process.platform !== "darwin") throw new Error("Codehouse.app is built on a Mac.")
const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : undefined
if (!arch) throw new Error(`There is no Mac build for ${process.arch}.`)
if (!fs.existsSync("/usr/bin/swiftc"))
  throw new Error(
    "swiftc was not found. Install Apple's command line tools: xcode-select --install",
  )

// The same version a Windows release of this commit would have: major.minor from package.json, the commit count.
const version = execFileSync(
  process.execPath,
  [
    path.join(root, "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(root, "scripts", "release.ts"),
    "version",
  ],
  { cwd: root, encoding: "utf8" },
).trim()
const plain = /^\d+\.\d+\.\d+/.exec(version)?.[0] ?? "0.0.0"
say(`Codehouse ${version} for ${arch}`)

if (!has("--swift-only")) {
  // The application folder, staged by upstream's packager so the two packages hold the same files.
  const stage = path.join(out, ".mac-stage")
  fs.rmSync(stage, { recursive: true, force: true })
  run(
    process.execPath,
    [
      path.join(root, "scripts", "package.mjs"),
      "--stage-only",
      "--out",
      stage,
      ...(has("--skip-build") ? ["--skip-build"] : []),
    ],
    { cwd: root },
  )
  fs.rmSync(appBundle, { recursive: true, force: true })
  fs.mkdirSync(path.join(contents, "MacOS"), { recursive: true })
  fs.mkdirSync(resources, { recursive: true })
  fs.renameSync(path.join(stage, "Codehouse", "app"), path.join(resources, "app"))
  fs.rmSync(stage, { recursive: true, force: true })
  // npm links the workspace packages with relative links on a Mac, so the app can be moved. links.mjs is for
  // Windows' absolute junctions and is never run here: it would write inside the signed app.
  for (const l of JSON.parse(
    fs.readFileSync(path.join(resources, "app", "workspace-links.json"), "utf8"),
  ))
    if (path.isAbsolute(fs.readlinkSync(path.join(resources, "app", l.link))))
      throw new Error(`${l.link} is an absolute link, so the app would break when moved`)

  await bundleNode(path.join(resources, "runtime"))

  say("adding the icon and pictures")
  makeIcon(path.join(resources, "Codehouse.icns"))
  fs.copyFileSync(
    path.join(root, "apps", "web", "public", "codehouse", "splash.png"),
    path.join(resources, "splash.png"),
  )
  for (const state of ["normal", "attention"])
    for (const n of [16, 32])
      fs.copyFileSync(
        path.join(root, "packaging", "brand", `tray-${state}-${n}.png`),
        path.join(resources, `tray-${state}-${n}.png`),
      )
}
if (!fs.existsSync(path.join(resources, "app")))
  throw new Error(`${appBundle} has not been built. Run without --swift-only.`)

say("compiling the window and the limits helper")
const swiftDir = path.join(root, "packaging", "mac")
const swiftc = (out, files) =>
  run("/usr/bin/swiftc", [
    "-O",
    "-swift-version",
    "5",
    "-target",
    `${arch === "x64" ? "x86_64" : "arm64"}-apple-macos${MIN_MACOS}`,
    "-o",
    out,
    ...files,
  ])
// Every .swift file beside main.swift; the helper and the test have their own main in limits/ and test/.
swiftc(
  path.join(contents, "MacOS", "Codehouse"),
  fs
    .readdirSync(swiftDir)
    .filter((f) => f.endsWith(".swift"))
    .sort()
    .map((f) => path.join(swiftDir, f)),
)
const limitsHelper = path.join(contents, "MacOS", "codehouse-limits")
swiftc(limitsHelper, [path.join(swiftDir, "limits", "main.swift")])
fs.writeFileSync(path.join(contents, "Info.plist"), infoPlist())
fs.writeFileSync(path.join(contents, "PkgInfo"), "APPL????")

// Ad hoc: enough for this Mac to run it, and it seals every file inside, so a changed file shows. Node and Claude
// Code keep their makers' own signatures (no --deep); the helper beside the program is signed first, as nested code.
say("signing for this Mac (ad hoc)")
run("/usr/bin/codesign", ["--force", "--sign", "-", "--timestamp=none", limitsHelper])
run("/usr/bin/codesign", ["--force", "--sign", "-", "--timestamp=none", appBundle])
run("/usr/bin/codesign", ["--verify", "--strict", appBundle])

const mb = Math.round(
  Number(execFileSync("/usr/bin/du", ["-sk", appBundle], { encoding: "utf8" }).split("\t")[0]) /
    1024,
)
say(`built ${appBundle} (${mb} MB)`)

if (has("--check")) {
  say("checking the built app")
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-maccheck-"))
  const r = spawnSync(path.join(contents, "MacOS", "Codehouse"), ["--check"], {
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      GATEHOUSE_DATA_DIR: dir,
      GATEHOUSE_AUDIT_DIR: path.join(dir, "audit"),
      GATEHOUSE_CONFIG: path.join(dir, "config.json"),
      GATEHOUSE_STATE: path.join(dir, "state.json"),
      GATEHOUSE_HOST_PORT: "0",
    },
    timeout: 300_000,
  })
  fs.rmSync(dir, { recursive: true, force: true })
  if (r.status !== 0) throw new Error(`Codehouse --check failed (${r.status ?? r.signal})`)
  run("/usr/bin/codesign", ["--verify", "--strict", appBundle])
  say("the built app works, and nothing inside it changed while it ran")
}

if (has("--dmg")) {
  const dmg = path.join(out, `Codehouse-${version}.dmg`)
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "gh-dmg-"))
  run("/usr/bin/ditto", [appBundle, path.join(folder, "Codehouse.app")])
  fs.symlinkSync("/Applications", path.join(folder, "Applications"))
  fs.writeFileSync(
    path.join(folder, "Read me.txt"),
    [
      "Codehouse",
      "",
      "Drag Codehouse to Applications, then open it from Applications or Spotlight.",
      "",
      "If your Mac asks for an administrator's name and password and you do not have them, drag Codehouse to the",
      "Applications folder in your home folder instead (Finder, Go, Home, Applications; make the folder if it is not there).",
      "",
      "Before the first start, sign in to Claude Code on this Mac. Codehouse keeps your data in",
      "~/Library/Application Support/Gatehouse, so installing a newer Codehouse over this one keeps it.",
      "",
    ].join("\n"),
  )
  fs.rmSync(dmg, { force: true })
  say("making the disk image")
  run("/usr/bin/hdiutil", [
    "create",
    "-quiet",
    "-volname",
    "Codehouse",
    "-srcfolder",
    folder,
    "-ov",
    "-format",
    "UDZO",
    dmg,
  ])
  fs.rmSync(folder, { recursive: true, force: true })
  say(`wrote ${dmg}`)
}

if (has("--install")) install()

/** Node's own build for this Mac, downloaded once into dist-app/.cache and checked against nodejs.org's sums. */
async function bundleNode(dest) {
  const name = `node-v${NODE_VERSION}-darwin-${arch}`
  const tarball = path.join(cache, `${name}.tar.gz`)
  fs.mkdirSync(cache, { recursive: true })
  const base = `https://nodejs.org/dist/v${NODE_VERSION}`
  const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text()
  const want = sums
    .split("\n")
    .find((l) => l.endsWith(`  ${name}.tar.gz`))
    ?.split(" ")[0]
  if (!want) throw new Error(`nodejs.org lists no ${name}.tar.gz`)
  const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex")
  if (!fs.existsSync(tarball) || sha(tarball) !== want) {
    say(`downloading Node ${NODE_VERSION}`)
    const res = await fetch(`${base}/${name}.tar.gz`)
    if (!res.ok) throw new Error(`Node ${NODE_VERSION} could not be downloaded (${res.status})`)
    fs.writeFileSync(tarball + ".part", Buffer.from(await res.arrayBuffer()))
    fs.renameSync(tarball + ".part", tarball)
  }
  if (sha(tarball) !== want) throw new Error(`${name}.tar.gz does not match nodejs.org's sha256`)
  say(`adding Node ${NODE_VERSION} (sha256 checked)`)
  fs.mkdirSync(dest, { recursive: true })
  run("/usr/bin/tar", [
    "-xzf",
    tarball,
    "-C",
    dest,
    "--strip-components",
    "1",
    `${name}/bin/node`,
    `${name}/LICENSE`,
  ])
  fs.renameSync(path.join(dest, "bin", "node"), path.join(dest, "node"))
  fs.rmSync(path.join(dest, "bin"), { recursive: true, force: true })
  fs.renameSync(path.join(dest, "LICENSE"), path.join(dest, "NODE-LICENSE.txt"))
  fs.writeFileSync(path.join(dest, "NODE-VERSION.txt"), `v${NODE_VERSION}\n`)
}

/**
 * The app icon from the pack's 1024 px mark, set on Apple's icon grid (the shape 824 of 1024, centred) so it sits
 * the same size as the other apps in the Dock.
 */
function makeIcon(icns) {
  const set = fs.mkdtempSync(path.join(os.tmpdir(), "gh-icon-")) + "/Codehouse.iconset"
  fs.mkdirSync(set)
  const source = path.join(root, "docs", "brand", "codehouse-icon-1024.png")
  // The mark's rounded square fills 944 of its 1024 px; at 894 px it fills Apple's 824.
  const grid = path.join(path.dirname(set), "grid.png")
  run("/usr/bin/sips", ["-s", "format", "png", "-z", "894", "894", source, "--out", grid], {
    stdio: "ignore",
  })
  run("/usr/bin/sips", ["--padToHeightWidth", "1024", "1024", grid, "--out", grid], {
    stdio: "ignore",
  })
  for (const n of [16, 32, 128, 256, 512])
    for (const scale of [1, 2]) {
      const px = n * scale
      const file = path.join(set, `icon_${n}x${n}${scale === 2 ? "@2x" : ""}.png`)
      run("/usr/bin/sips", ["-z", String(px), String(px), grid, "--out", file], { stdio: "ignore" })
    }
  run("/usr/bin/iconutil", ["-c", "icns", set, "-o", icns])
  fs.rmSync(path.dirname(set), { recursive: true, force: true })
}

function infoPlist() {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
  const entries = {
    CFBundleDevelopmentRegion: "en-GB",
    CFBundleDisplayName: "Codehouse",
    CFBundleExecutable: "Codehouse",
    CFBundleIconFile: "Codehouse",
    CFBundleIdentifier: BUNDLE_ID,
    CFBundleInfoDictionaryVersion: "6.0",
    CFBundleName: "Codehouse",
    CFBundlePackageType: "APPL",
    CFBundleShortVersionString: plain,
    CFBundleVersion: plain,
    CodehouseVersion: version,
    LSApplicationCategoryType: "public.app-category.developer-tools",
    LSMinimumSystemVersion: MIN_MACOS,
    NSHumanReadableCopyright: "Codehouse. Powered by Claude.",
  }
  const lines = Object.entries(entries).map(
    ([k, v]) => `  <key>${k}</key>\n  <string>${esc(v)}</string>`,
  )
  // The window loads the interface from the Host on 127.0.0.1 over plain http, which App Transport Security allows
  // only for local addresses, and only with this.
  lines.push(
    "  <key>NSAppTransportSecurity</key>\n  <dict>\n    <key>NSAllowsLocalNetworking</key>\n    <true/>\n  </dict>",
    "  <key>NSHighResolutionCapable</key>\n  <true/>",
    "  <key>NSSupportsAutomaticGraphicsSwitching</key>\n  <true/>",
  )
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    ...lines,
    "</dict>",
    "</plist>",
    "",
  ].join("\n")
}

/**
 * Puts the app in /Applications when this account may write there, otherwise in ~/Applications (Finder, Spotlight
 * and Launchpad show both). Refuses while that copy is running. Your data is not in the app, so it is kept.
 */
function install() {
  const writable = (d) => {
    try {
      fs.accessSync(d, fs.constants.W_OK)
      return true
    } catch {
      return false
    }
  }
  const dir = writable("/Applications") ? "/Applications" : path.join(os.homedir(), "Applications")
  fs.mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, "Codehouse.app")
  const program = path.join(dest, "Contents", "MacOS", "Codehouse")
  // A process whose whole command line is that program. macOS's pgrep -f -x missed the running app, so ps it is.
  const running = execFileSync("/bin/ps", ["-axo", "command="], { encoding: "utf8" })
    .split("\n")
    .some((l) => l.trim() === program)
  if (running && !has("--when-quit"))
    throw new Error(
      `Codehouse is running from ${dest}. Quit it (Command-Q), then install again, or add --when-quit.`,
    )
  // Copied into a hidden folder first, so Spotlight never lists a half-copied app under a passing name.
  const staging = path.join(dir, ".codehouse-installing")
  fs.rmSync(staging, { recursive: true, force: true })
  fs.mkdirSync(staging)
  run("/usr/bin/ditto", [appBundle, path.join(staging, "Codehouse.app")])
  if (running) return installWhenQuit(program, staging, dest)
  fs.rmSync(dest, { recursive: true, force: true })
  fs.renameSync(path.join(staging, "Codehouse.app"), dest)
  fs.rmSync(staging, { recursive: true, force: true })
  // Tell Launch Services and Spotlight about it now, rather than whenever they next look.
  spawnSync(
    "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
    ["-f", dest],
  )
  spawnSync("/usr/bin/mdimport", [dest])
  say(`installed ${dest}`)
}

/**
 * --when-quit, for the Codehouse you are using: the new copy is already staged beside it, and a small background
 * script waits until you quit Codehouse (for up to a day), puts the new copy in its place and opens it. A Codehouse
 * that was working when it closed carries on where it was. What happened goes in updates/mac-install.log.
 */
function installWhenQuit(program, staging, dest) {
  const log = path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "Gatehouse",
    "updates",
    "mac-install.log",
  )
  fs.mkdirSync(path.dirname(log), { recursive: true })
  const script = [
    'LOG="$5"',
    'say() { echo "$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ) $1" >> "$LOG"; }',
    'say "waiting for Codehouse to quit"',
    "i=0",
    'while /bin/ps -axo command= | /usr/bin/grep -Fxq "$1"; do',
    '  i=$((i+1)); if [ "$i" -gt 43200 ]; then say "gave up after a day; the new copy is in $2"; exit 1; fi',
    "  /bin/sleep 2",
    "done",
    "/bin/sleep 2",
    // The old copy is kept until the new one is in place, and put back if it cannot be.
    'if [ -e "$3" ] && ! /bin/mv "$3" "$3.previous"; then say "could not move the old copy aside; nothing changed"; exit 1; fi',
    'if /bin/mv "$2/Codehouse.app" "$3"; then',
    '  /bin/rm -rf "$3.previous"; /bin/rmdir "$2"',
    '  "$4" -f "$3"; /usr/bin/mdimport "$3"; say "installed $3"; /usr/bin/open "$3"',
    "else",
    '  [ -e "$3.previous" ] && /bin/mv "$3.previous" "$3"',
    '  say "could not put the new copy in place, so the old one is back; the new copy is in $2"; exit 1',
    "fi",
  ].join("\n")
  const lsregister =
    "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
  const child = spawn(
    "/bin/sh",
    ["-c", script, "codehouse-install", program, staging, dest, lsregister, log],
    {
      detached: true,
      stdio: "ignore",
    },
  )
  child.unref()
  say(
    `Codehouse is running, so the new copy waits: quit Codehouse (Command-Q) and it is installed and opened again`,
  )
}
