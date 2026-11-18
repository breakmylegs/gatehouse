// E-099: what the test runner and the gate found on this developer's computer, for the health score: test files that
// passed only on their retry, and each gate's result. Kept in dev-checks.json in Codehouse's data folder, the newest
// 500 of each, written in one go (temp file, then rename). Never fails the run that writes it.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

function dataDir() {
  if (process.env.GATEHOUSE_DATA_DIR) return process.env.GATEHOUSE_DATA_DIR
  const base =
    process.env.LOCALAPPDATA ??
    (process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support") : path.join(os.homedir(), ".local", "share"))
  return path.join(base, "Gatehouse")
}

/** Adds one entry ({ file } to "flaky", { ok } to "gates"), with the time. */
export function recordDevCheck(kind, entry) {
  try {
    const dir = dataDir()
    const file = path.join(dir, "dev-checks.json")
    let all = {}
    try {
      all = JSON.parse(fs.readFileSync(file, "utf8"))
    } catch {
      all = {}
    }
    const list = Array.isArray(all[kind]) ? all[kind] : []
    all[kind] = [...list, { ...entry, at: new Date().toISOString() }].slice(-500)
    fs.mkdirSync(dir, { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(all, null, 1))
    fs.renameSync(tmp, file)
  } catch {
    // The health score goes without it.
  }
}
