// O60 (owner, 27 Nov): one heavy run at a time on this computer (the full gate, a release's tests, the browser tests,
// a whole-suite vitest run), so sessions do not fight over memory and fail with retries. A run takes the lock, others
// wait their turn with a clear message, and the lock goes when the run ends however it ends. A lock whose process is
// gone, or that is older than MAX_AGE, is taken over. What a holder starts inherits the lock (GATEHOUSE_HEAVY_LOCK).
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const MAX_AGE_MS = 6 * 60 * 60 * 1000
const POLL_MS = 15_000

/** Gatehouse's data folder, as the Host has it on each platform. */
export function dataDir(env = process.env, platform = process.platform) {
  if (env.GATEHOUSE_DATA_DIR) return env.GATEHOUSE_DATA_DIR
  if (platform === "win32") return path.join(env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "Gatehouse")
  if (platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Gatehouse")
  return path.join(env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"), "Gatehouse")
}

export const lockFile = (env = process.env) => path.join(dataDir(env), "locks", "heavy-run.json")

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === "EPERM"
  }
}

/** The lock's holder, or undefined when there is none or it is stale. */
export function holder(env = process.env, now = Date.now()) {
  try {
    const h = JSON.parse(fs.readFileSync(lockFile(env), "utf8"))
    if (typeof h.pid !== "number" || !alive(h.pid) || now - Date.parse(h.since) > MAX_AGE_MS) return undefined
    return h
  } catch {
    return undefined
  }
}

/**
 * Takes the lock for `what`, waiting while another run has it (saying who and since when, once a minute). Returns the
 * function that lets it go, also called when the process exits. Already held by this process or the one that started
 * it (GATEHOUSE_HEAVY_LOCK): nothing to take.
 */
export async function heavyLock(what, o = {}) {
  const env = o.env ?? process.env
  const say = o.say ?? ((line) => console.log(line))
  if (env.GATEHOUSE_HEAVY_LOCK && holder(env)?.pid === Number(env.GATEHOUSE_HEAVY_LOCK)) return () => undefined
  const file = lockFile(env)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  let lastSaid = 0
  for (;;) {
    const mine = JSON.stringify({ pid: process.pid, what, since: new Date().toISOString(), cwd: process.cwd() })
    try {
      fs.writeFileSync(file, mine, { flag: "wx" })
      break
    } catch (e) {
      if (e.code !== "EEXIST") throw e
      const h = holder(env)
      if (!h) {
        // Gone or stale: taken over (removed, then raced for again with wx, so only one run gets it).
        fs.rmSync(file, { force: true })
        continue
      }
      if (o.wait === false) throw new Error(`Another heavy run has the lock: ${h.what} (process ${h.pid}, since ${h.since}).`)
      if (Date.now() - lastSaid >= 60_000) {
        say(`[heavy-run] waiting for ${h.what} (process ${h.pid}, in ${h.cwd}, since ${h.since}) to finish before ${what}`)
        lastSaid = Date.now()
      }
      await new Promise((r) => setTimeout(r, o.pollMs ?? POLL_MS))
    }
  }
  env.GATEHOUSE_HEAVY_LOCK = String(process.pid)
  let released = false
  const release = () => {
    if (released) return
    released = true
    try {
      const h = JSON.parse(fs.readFileSync(file, "utf8"))
      if (h.pid === process.pid) fs.rmSync(file, { force: true })
    } catch {
      // already gone
    }
  }
  process.once("exit", release)
  for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK"])
    process.once(sig, () => {
      release()
      process.exit(130)
    })
  return release
}
