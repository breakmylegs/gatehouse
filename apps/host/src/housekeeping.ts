import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { FastifyInstance } from "fastify"
import type { HostAudit } from "./hostaudit.js"

/**
 * Temporary folders and files Codehouse and its checks make (owner, 1 Nov: the disk filled with leftovers). Each use
 * removes its own when done; these are what a crash, a stopped run or a closed window can leave behind. Nothing
 * else in the temp folder is touched.
 */
export const TEMP_PREFIXES = [
  // The Host: a candidate policy, your rules tried out, a checkpoint's git index.
  "gh-policy-",
  "gh-user-rules-",
  "gh-index-",
  // The build's checks in headless Edge, and the packaged-copy and update checks.
  "codeh-shots-",
  "codeh-sandbox-",
  "codeh-perf-",
  "codeh-e2e-",
  "codeh-smoke-",
] as const

/** Leftovers younger than this may still be in use, so they are never removed. */
export const IN_USE_MS = 10 * 60_000

interface Leftover {
  path: string
  bytes: number
  mtimeMs: number
}

function sizeOf(p: string): number {
  let st: fs.Stats
  try {
    st = fs.lstatSync(p)
  } catch {
    return 0
  }
  if (!st.isDirectory()) return st.size
  let n = 0
  let names: string[] = []
  try {
    names = fs.readdirSync(p)
  } catch {
    return 0
  }
  for (const name of names) n += sizeOf(path.join(p, name))
  return n
}

/** What Codehouse has left in the temp folder, with sizes. */
export function tempLeftovers(tmp: string = os.tmpdir()): Leftover[] {
  let names: string[] = []
  try {
    names = fs.readdirSync(tmp)
  } catch {
    return []
  }
  const out: Leftover[] = []
  for (const name of names) {
    if (!TEMP_PREFIXES.some((p) => name.startsWith(p))) continue
    const full = path.join(tmp, name)
    try {
      out.push({ path: full, bytes: sizeOf(full), mtimeMs: fs.lstatSync(full).mtimeMs })
    } catch {
      // gone meanwhile
    }
  }
  return out
}

/** Removes the leftovers older than the age given. Ones still in use, or locked, stay. */
export function clearTemp(
  olderThanMs: number,
  tmp: string = os.tmpdir(),
  now: number = Date.now(),
): { removed: number; bytes: number; left: number } {
  let removed = 0
  let bytes = 0
  let left = 0
  for (const l of tempLeftovers(tmp)) {
    if (now - l.mtimeMs < Math.max(olderThanMs, IN_USE_MS)) {
      left++
      continue
    }
    try {
      fs.rmSync(l.path, { recursive: true, force: true, maxRetries: 2 })
      removed++
      bytes += l.bytes
    } catch {
      left++
    }
  }
  return { removed, bytes, left }
}

/** Settings shows how much the leftovers take and clears them. */
export function registerHousekeepingRoutes(
  app: FastifyInstance,
  ctx: { audit: HostAudit; tempDir?: string },
): void {
  const tmp = ctx.tempDir ?? os.tmpdir()
  app.get("/api/housekeeping/temp", async () => {
    const all = tempLeftovers(tmp)
    return { items: all.length, bytes: all.reduce((n, l) => n + l.bytes, 0) }
  })
  app.post("/api/housekeeping/temp/clear", async () => {
    const r = clearTemp(IN_USE_MS, tmp)
    await ctx.audit
      .record({
        session: "desktop",
        event: "temp_cleared",
        channel: "desktop",
        tool: "housekeeping",
        input: { removed: r.removed, bytes: r.bytes, left: r.left },
        verdict: {
          outcome: "allow",
          ruleId: "temp-cleared",
          reason: "Codehouse's temporary leftovers were cleared from Settings.",
          risk: 0,
          decidedBy: "human-desktop",
          policyHash: "",
        },
        latencyMs: 0,
      })
      .catch(() => undefined)
    return r
  })
}
