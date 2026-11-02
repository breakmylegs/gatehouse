// Usage: node scripts/installer-move-check.mjs (Windows, with Inno Setup 6). Run it after changing packaging/installer.iss.
// Rehearses the installer's move-over from an earlier install, with a test AppId and stand-in folders, so the owner's
// real install is never touched. Cleans up everything it makes, whatever happens.
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const HERE = path.join(os.tmpdir(), "codeh-installer-move")
const LAD = process.env.LOCALAPPDATA
const PROGRAMS = path.join(LAD, "Programs")
const START = path.join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs")
const GUID = "{0D5C1A2B-7E44-4C1B-9A11-2F7E3C9D0A55}"
const KEY = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${GUID}_is1`
const EARLIER = path.join(PROGRAMS, "CodehouseEarlierTest")
const NEW = path.join(PROGRAMS, "CodehouseTest")
const GROUP = path.join(START, "CodehouseEarlierTestGroup")
const TOP = path.join(START, "CodehouseEarlierTest.lnk")
const ISCC = path.join(LAD, "Programs", "Inno Setup 6", "ISCC.exe")
let sleeper
const results = []
const check = (name, ok) => {
  results.push(`${ok ? "ok  " : "FAIL"} ${name}`)
}
const ps = (cmd) =>
  spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", cmd], { encoding: "utf8" })
const link = (file, target) =>
  ps(
    `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${file}'); $s.TargetPath='${target}'; $s.Save()`,
  )

function cleanup() {
  try {
    sleeper?.kill()
  } catch {}
  const unins = path.join(NEW, "unins000.exe")
  if (fs.existsSync(unins)) spawnSync(unins, ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"])
  spawnSync("reg", ["delete", KEY, "/f"])
  spawnSync("reg", [
    "delete",
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce",
    "/v",
    "CodehouseTidy",
    "/f",
  ])
  for (const p of [
    EARLIER,
    EARLIER + ".previous",
    NEW,
    GROUP,
    path.join(START, "CodehouseTest"),
    HERE,
  ])
    fs.rmSync(p, { recursive: true, force: true })
  fs.rmSync(TOP, { force: true })
}

try {
  cleanup()
  fs.mkdirSync(HERE, { recursive: true })
  // The installer under test, with its own AppId, name and folder, and one small file instead of the app.
  let iss = fs.readFileSync(path.join(REPO, "packaging", "installer.iss"), "utf8")
  iss = iss
    .replaceAll("6C1E5B0A-2F1D-4F3B-9D6E-6B7A0C2E41A7", GUID.slice(1, -1))
    .replace('#define AppName "Codehouse"', '#define AppName "CodehouseTest"')
    .replace(
      "DefaultDirName={localappdata}\\Programs\\Codehouse",
      "DefaultDirName={localappdata}\\Programs\\CodehouseTest",
    )
    .replace("OutputDir=..\\dist-app", `OutputDir=${HERE}`)
    .replace("OutputBaseFilename=Codehouse-Setup", "OutputBaseFilename=migrate-setup")
    .replace("SetupIconFile=..\\dist-app\\gatehouse.ico", "")
    .replace("WizardImageFile=brand\\", `WizardImageFile=${REPO}\\packaging\\brand\\`)
    .replace("WizardSmallImageFile=brand\\", `WizardSmallImageFile=${REPO}\\packaging\\brand\\`)
    .replace(
      /\[Files\][\s\S]*?\n\n/,
      `[Files]\nSource: "${path.join(HERE, "one.txt")}"; DestDir: "{app}"\n\n`,
    )
  if (!iss.includes(GUID.slice(1, -1)) || iss.includes("6C1E5B0A"))
    throw new Error("AppId not replaced")
  fs.writeFileSync(path.join(HERE, "one.txt"), "test\n")
  fs.writeFileSync(path.join(HERE, "migrate.iss"), iss)
  const c = spawnSync(ISCC, ["/Q", path.join(HERE, "migrate.iss")], { encoding: "utf8" })
  if (c.status !== 0) throw new Error("compile: " + c.stdout + c.stderr)
  const setup = path.join(HERE, "migrate-setup.exe")

  // The stand-in earlier install: Windows' record of it, its folder, its updater's backup, its shortcuts.
  fs.mkdirSync(EARLIER, { recursive: true })
  fs.mkdirSync(EARLIER + ".previous", { recursive: true })
  fs.writeFileSync(path.join(EARLIER + ".previous", "old.txt"), "old\n")
  fs.copyFileSync("C:/Windows/System32/PING.EXE", path.join(EARLIER, "sleeper.exe"))
  fs.copyFileSync("C:/Windows/System32/PING.EXE", path.join(EARLIER, "unins000.exe"))
  spawnSync("reg", ["add", KEY, "/v", "Inno Setup: App Path", "/d", EARLIER, "/f"])
  spawnSync("reg", [
    "add",
    KEY,
    "/v",
    "Inno Setup: Icon Group",
    "/d",
    "CodehouseEarlierTestGroup",
    "/f",
  ])
  fs.mkdirSync(GROUP, { recursive: true })
  link(path.join(GROUP, "Earlier.lnk"), path.join(EARLIER, "sleeper.exe"))
  link(path.join(GROUP, "Other.lnk"), "C:\\Windows\\notepad.exe")
  link(TOP, path.join(EARLIER, "sleeper.exe"))

  // While something runs from the earlier folder, setup stops and changes nothing.
  sleeper = spawn(path.join(EARLIER, "sleeper.exe"), ["-n", "120", "127.0.0.1"], {
    stdio: "ignore",
  })
  spawnSync("powershell", ["-c", "Start-Sleep -m 800"])
  let r = spawnSync(setup, [
    "/VERYSILENT",
    "/SUPPRESSMSGBOXES",
    "/NORESTART",
    `/LOG=${path.join(HERE, "run1.log")}`,
  ])
  check(`setup stops while the earlier version runs (exit ${r.status})`, r.status !== 0)
  check("the earlier folder is untouched", fs.existsSync(path.join(EARLIER, "unins000.exe")))
  check("nothing was installed", !fs.existsSync(path.join(NEW, "one.txt")))
  sleeper.kill()
  spawnSync("powershell", ["-c", "Start-Sleep -m 800"])

  // Once it is quit: installed in the new folder, the earlier folder, its backup and its shortcuts gone.
  r = spawnSync(setup, [
    "/VERYSILENT",
    "/SUPPRESSMSGBOXES",
    "/NORESTART",
    `/LOG=${path.join(HERE, "run2.log")}`,
  ])
  check(`setup succeeds once it is quit (exit ${r.status})`, r.status === 0)
  check("installed in the new folder", fs.existsSync(path.join(NEW, "one.txt")))
  check("the earlier folder is gone", !fs.existsSync(EARLIER))
  check("its updater's backup is gone", !fs.existsSync(EARLIER + ".previous"))
  check(
    "the shortcut that started it is gone",
    !fs.existsSync(path.join(GROUP, "Earlier.lnk")) && !fs.existsSync(TOP),
  )
  check("an unrelated shortcut is kept", fs.existsSync(path.join(GROUP, "Other.lnk")))
  const app = spawnSync("reg", ["query", KEY, "/v", "Inno Setup: App Path"], {
    encoding: "utf8",
  }).stdout
  check("Windows now records the new folder", app.includes(NEW))
} catch (e) {
  results.push("ERROR " + e.message)
} finally {
  if (fs.existsSync(path.join(HERE, "run2.log")))
    results.push(
      ...fs
        .readFileSync(path.join(HERE, "run2.log"), "utf8")
        .split(/\r?\n/)
        .filter((l) => /rror|Exception/.test(l))
        .slice(0, 5),
    )
  cleanup()
  results.push(`cleaned: ${![EARLIER, NEW, GROUP, TOP, HERE].some((p) => fs.existsSync(p))}`)
  console.log(results.join("\n"))
}
