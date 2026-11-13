import { execFile } from "node:child_process"
import type { MemoryReading } from "./memory-governor.js"

// Mac fork: the memory governor's reading on a Mac. Kept out of memory-governor.ts so upstream's changes merge without
// conflicts; bootstrap.ts chooses it on a Mac (see docs/mac.md).

/**
 * macOS has no commit limit like Windows': it grows swap as it needs to. Its own measure is memory pressure, and
 * kern.memorystatus_level is the share of memory still free or reclaimable (memory_pressure's "free percentage").
 * The reading is the share in use, out of 100, so the governor's point in Settings means the same thing: above 85%
 * in use, nothing heavy starts.
 */
export function parseSysctl(out: string): MemoryReading | undefined {
  const [total, level] = out.trim().split(/\s+/).map(Number)
  if (!(total! > 0) || !(level! >= 0 && level! <= 100)) return undefined
  return {
    commitUsed: 100 - level!,
    commitLimit: 100,
    physTotal: total!,
    physAvail: Math.round((total! * level!) / 100),
  }
}

type Run = (file: string, args: string[]) => Promise<string>
const run: Run = (file, args) =>
  new Promise((resolve, reject) =>
    execFile(file, args, { timeout: 5_000 }, (err, out) =>
      err ? reject(err) : resolve(String(out)),
    ),
  )

/** Reads memory with sysctl, or nothing when it does not answer: the governor then refuses nothing, as on Windows. */
export function macMemoryReader(query: Run = run): () => Promise<MemoryReading | undefined> {
  return () =>
    query("/usr/sbin/sysctl", ["-n", "hw.memsize", "kern.memorystatus_level"])
      .then(parseSysctl)
      .catch(() => undefined)
}
