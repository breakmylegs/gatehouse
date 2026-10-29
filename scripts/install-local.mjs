// Installs JCVC on this computer from this checkout, with nothing downloaded: for a laptop whose browser will not
// keep JCVC-Setup.exe. It builds the package (unless --skip-build), puts it where the installer would
// (%LOCALAPPDATA%\Programs\JCVC), adds a Start menu shortcut and starts JCVC.
//
// Over a copy that is already there it switches the way an update does, with JCVC-Update.exe: your rules are
// carried across, the old version is kept beside it (Settings can go back to it), and if the new one does not
// start, the old one is put back and started. Quit JCVC from its tray icon first.
//
// Usage: npm run install:local
//        npm run install:local -- --skip-build          use the package already in dist-app\JCVC
//        npm run install:local -- --dir <folder>        somewhere else (tests use this)
//        npm run install:local -- --no-shortcut --no-start
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const dist = path.join(root, "dist-app", "JCVC")
const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const dirArg = args.includes("--dir") ? args[args.indexOf("--dir") + 1] : undefined
const say = (t) => console.log(`[install] ${t}`)
const local = process.env.LOCALAPPDATA
if (!local) throw new Error("LOCALAPPDATA is not set: this installs for a Windows user.")
const dir = path.resolve(dirArg ?? path.join(local, "Programs", "JCVC"))
const next = `${dir}.next`
const dataDir = process.env.GATEHOUSE_DATA_DIR ?? path.join(local, "Gatehouse")
const versionIn = (d) => JSON.parse(fs.readFileSync(path.join(d, "release.json"), "utf8")).version

if (!has("--skip-build")) {
  say("building the package (a few minutes)")
  const r = spawnSync(process.execPath, [path.join(root, "scripts", "package.mjs")], {
    cwd: root,
    stdio: "inherit",
  })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
if (!fs.existsSync(path.join(dist, "release.json")))
  throw new Error("There is no package in dist-app\\JCVC. Run without --skip-build.")
const version = versionIn(dist)

// A copy running from the folder would hold its files: ask for it to be closed rather than stop it.
const running = spawnSync(
  "powershell",
  [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Get-Process JCVC,JCVC-Console -ErrorAction SilentlyContinue | Where-Object { $_.Path -like ($env:JCVC_DIR + '\\*') } | Measure-Object | Select-Object -ExpandProperty Count",
  ],
  { encoding: "utf8", env: { ...process.env, JCVC_DIR: dir } },
)
if (Number(running.stdout.trim()) > 0) {
  say(
    `JCVC is running from ${dir}. Quit it from its tray icon (right-click, Quit JCVC), then run this again.`,
  )
  process.exit(1)
}

say(`copying ${version} beside ${dir}`)
fs.rmSync(next, { recursive: true, force: true })
fs.mkdirSync(path.dirname(dir), { recursive: true })
// npm's workspace links are left out: JCVC makes them on every start (scripts/links.mjs).
fs.cpSync(dist, next, { recursive: true, filter: (src) => !fs.lstatSync(src).isSymbolicLink() })

/** Renames a folder, retrying for a minute: right after a copy, Windows' virus scan can still hold the new files. */
function renameSoon(from, to) {
  const until = Date.now() + 60_000
  for (;;) {
    try {
      fs.renameSync(from, to)
      return
    } catch (e) {
      if (!["EPERM", "EBUSY", "EACCES"].includes(e.code) || Date.now() > until) throw e
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500)
    }
  }
}

if (!fs.existsSync(dir)) {
  renameSoon(next, dir)
  say(`installed ${version} in ${dir}`)
  finish(true)
} else {
  const from = fs.existsSync(path.join(dir, "release.json")) ? versionIn(dir) : "unknown"
  say(`switching ${dir} from ${from} to ${version}, as an update does`)
  const updates = path.join(dataDir, "updates")
  fs.mkdirSync(updates, { recursive: true })
  const updater = path.join(updates, "JCVC-Update.exe")
  fs.copyFileSync(path.join(next, "JCVC-Update.exe"), updater)
  const plan = path.join(updates, "plan.txt")
  const result = path.join(updates, "result.txt")
  fs.rmSync(result, { force: true })
  fs.writeFileSync(
    plan,
    [
      "mode=apply",
      `install=${dir}`,
      `candidate=${next}`,
      `previous=${dir}.previous`,
      `from=${from}`,
      `to=${version}`,
      `health=${path.join(updates, "started.json")}`,
      `result=${result}`,
      "timeout=240",
      "",
    ].join("\r\n"),
  )
  const r = spawnSync(updater, ["--plan", plan], { stdio: "inherit" })
  const said = fs.existsSync(result) ? fs.readFileSync(result, "utf8") : ""
  if (r.status === 0 && /ok=true/.test(said)) {
    say(
      `switched to ${version} and it started. ${from} is kept beside it; Settings, Updates can go back to it.`,
    )
    finish(false)
  } else {
    const reason = /reason=(.*)/.exec(said)?.[1]
    say(`the switch did not finish${reason ? `: ${reason}` : ""}. ${from} is back in place.`)
    process.exit(1)
  }
}

/** The Start menu shortcut (for a fresh install) and starting JCVC (the switch already started it). */
function finish(fresh) {
  if (fresh && !has("--no-shortcut")) {
    const link = path.join(
      process.env.APPDATA ?? "",
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
      "Jean-Claude Van Code.lnk",
    )
    const r = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:JCVC_LINK); $s.TargetPath = $env:JCVC_EXE; $s.WorkingDirectory = $env:JCVC_DIR; $s.Description = 'Run Claude agent sessions and stay in charge of what they do'; $s.Save()",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          JCVC_LINK: link,
          JCVC_EXE: path.join(dir, "JCVC.exe"),
          JCVC_DIR: dir,
        },
      },
    )
    say(
      r.status === 0 && fs.existsSync(link)
        ? "added Jean-Claude Van Code to the Start menu"
        : `could not add the Start menu shortcut; open ${path.join(dir, "JCVC.exe")} instead`,
    )
  }
  if (fresh && !has("--no-start")) {
    spawn(path.join(dir, "JCVC.exe"), [], { detached: true, stdio: "ignore", cwd: dir }).unref()
    say("starting JCVC. The first start can take a minute.")
  }
  say(
    "from now on JCVC updates itself from GitHub; run this again any time to install what this checkout builds",
  )
}
