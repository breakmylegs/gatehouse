// O60 (owner, 27 Nov): what a test run leaves behind when it hangs or is stopped. A process stopped is stopped with
// everything it started. A headless browser the browser checks started (its throwaway profile named codeh-phone-,
// codeh-shots- or codeh-perf- in the temp folder) whose run is gone (its parent process no longer there) is stopped, and
// a profile no running browser uses any more is removed. A browser whose run is still going, another session's
// included, is left alone; nothing else of the owner's is touched.
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export const PROFILE_PREFIXES = ["codeh-phone-", "codeh-shots-", "codeh-perf-"]
const PROFILE = new RegExp(`--user-data-dir=("?)([^"\\s]*(?:${PROFILE_PREFIXES.join("|")})[^"\\s]*)\\1`, "i")

/** Stops a process and everything it started. */
export function killTree(pid) {
  if (!pid) return
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
  else {
    try {
      process.kill(-pid, "SIGKILL")
    } catch {
      try {
        process.kill(pid, "SIGKILL")
      } catch {
        // already gone
      }
    }
  }
}

/** Every process: { pid, parent, command }. */
function processes(run = spawnSync) {
  if (process.platform === "win32") {
    const r = run(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.CommandLine)\" }"],
      { encoding: "utf8", windowsHide: true, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 },
    )
    return String(r.stdout ?? "")
      .split(/\r?\n/)
      .map((l) => l.split("\t"))
      .filter((p) => p.length >= 3)
      .map(([pid, parent, ...cmd]) => ({ pid: Number(pid), parent: Number(parent), command: cmd.join("\t") }))
  }
  const r = run("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  return String(r.stdout ?? "")
    .split("\n")
    .map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), parent: Number(m[2]), command: m[3] }))
}

/**
 * The browsers on our throwaway profiles: each top browser process (not one of its helpers) with its profile, and
 * whether its run is gone.
 */
export function ourBrowsers(list = processes()) {
  const pids = new Set(list.map((p) => p.pid))
  return list
    .filter((p) => !/--type=/.test(p.command))
    .map((p) => ({ ...p, profile: PROFILE.exec(p.command)?.[2] }))
    .filter((p) => p.profile)
    .map((p) => ({ pid: p.pid, profile: p.profile, orphaned: !pids.has(p.parent) }))
}

/**
 * Stops our browsers whose run is gone, then removes the profiles in the temp folder no running browser of ours uses
 * (and that are more than a minute old, so one being created now is not taken).
 */
export function sweepBrowsers(o = {}) {
  const tmp = o.tmp ?? os.tmpdir()
  const kill = o.kill ?? killTree
  const browsers = ourBrowsers(o.list ?? processes())
  let stopped = 0
  for (const b of browsers)
    if (b.orphaned) {
      kill(b.pid)
      stopped++
    }
  const inUse = new Set(browsers.filter((b) => !b.orphaned).map((b) => path.resolve(b.profile).toLowerCase()))
  let removed = 0
  let names = []
  try {
    names = fs.readdirSync(tmp).filter((n) => PROFILE_PREFIXES.some((p) => n.startsWith(p)))
  } catch {
    // no temp folder to read
  }
  const now = o.now ?? Date.now()
  for (const n of names) {
    const d = path.join(tmp, n)
    if (inUse.has(path.resolve(d).toLowerCase())) continue
    try {
      if (now - fs.statSync(d).mtimeMs < 60_000) continue
    } catch {
      continue
    }
    for (let i = 0; i < 5; i++) {
      try {
        fs.rmSync(d, { recursive: true, force: true })
        removed++
        break
      } catch {
        // a browser still letting go of it
      }
    }
  }
  return { stopped, removed }
}
