// Makes dist-app\JCVC-Setup.exe with Inno Setup, building the package first if it is not there.
// Usage: node scripts/installer.mjs [--iscc <path to ISCC.exe>]
// ISCC.exe is looked for in the usual Inno Setup folders, then on the PATH. You can also set GATEHOUSE_ISCC.
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const args = process.argv.slice(2)
const flag = args.indexOf("--iscc")
const say = (t) => console.log(`[installer] ${t}`)

const candidates = [
  flag >= 0 ? args[flag + 1] : undefined,
  process.env.GATEHOUSE_ISCC,
  ...["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"].flatMap((v) => {
    const base = process.env[v]
    if (!base) return []
    const sub = v === "LOCALAPPDATA" ? "Programs" : ""
    return ["Inno Setup 6", "Inno Setup 5"].map((n) => path.join(base, sub, n, "ISCC.exe"))
  }),
].filter(Boolean)
let iscc = candidates.find((p) => fs.existsSync(p))
if (!iscc) {
  const where = spawnSync("where", ["ISCC"], { encoding: "utf8", shell: true })
  iscc = where.status === 0 ? where.stdout.split(/\r?\n/)[0]?.trim() : undefined
}
if (!iscc) {
  say("Inno Setup's ISCC.exe was not found. Tried:")
  for (const c of candidates) say(`  ${c}`)
  say("Give its path with --iscc <path>, or set GATEHOUSE_ISCC.")
  process.exit(1)
}

if (
  !fs.existsSync(path.join(root, "dist-app", "JCVC", "JCVC.exe")) ||
  !fs.existsSync(path.join(root, "dist-app", "gatehouse.ico"))
) {
  say("building the package first")
  const r = spawnSync(process.execPath, [path.join(root, "scripts", "package.mjs")], {
    stdio: "inherit",
    cwd: root,
  })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
// The installer shows the version the package was stamped with.
let version = "0.0.0"
try {
  version = JSON.parse(fs.readFileSync(path.join(root, "dist-app", "JCVC", "release.json"), "utf8")).version
} catch {
  say("dist-app\\JCVC\\release.json is missing, so the installer says 0.0.0")
}
say(`compiling version ${version} with ${iscc}`)
const r = spawnSync(iscc, [`/DAppVersion=${version}`, path.join(root, "packaging", "installer.iss")], {
  stdio: "inherit",
  cwd: root,
})
if (r.status !== 0) {
  say(
    "Inno Setup reported an error. The script has not been compiled on this machine before, so a fix to packaging/installer.iss may be needed.",
  )
  process.exit(r.status ?? 1)
}
say(`wrote ${path.join(root, "dist-app", "JCVC-Setup.exe")}`)
