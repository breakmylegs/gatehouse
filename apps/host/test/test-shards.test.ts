// C-001: test files run one per process, as many at once as free memory allows; a failure is retried once and logged,
// and a file that fails twice fails the run.
import { describe, expect, it } from "vitest"
import {
  listTestFiles,
  PER_FILE_BYTES,
  RESERVE_BYTES,
  runShards,
  workersFor,
} from "../../../scripts/test-shards.mjs"

const GB = 1024 ** 3

describe("memory-aware test sharding (C-001)", () => {
  it("caps how many files run at once by free memory and by cores, never below one", () => {
    expect(workersFor(1 * GB, 16)).toBe(1)
    expect(workersFor(RESERVE_BYTES + 3 * PER_FILE_BYTES, 16)).toBe(3)
    expect(workersFor(64 * GB, 4)).toBe(3)
    expect(workersFor(64 * GB, 1)).toBe(1)
  })

  it("never runs more at once than the memory free at each start allows", async () => {
    let running = 0
    let most = 0
    let free = RESERVE_BYTES + 2 * PER_FILE_BYTES
    const run = async () => {
      running++
      most = Math.max(most, running)
      await new Promise((r) => setTimeout(r, 20))
      running--
      return { ok: true, out: "" }
    }
    await runShards(["a", "b", "c", "d", "e"], { freemem: () => free, run, log: () => undefined })
    expect(most).toBe(2)
    // Under pressure: one at a time.
    most = 0
    free = 1 * GB
    await runShards(["a", "b", "c"], { freemem: () => free, run, log: () => undefined })
    expect(most).toBe(1)
  })

  it("retries a failing file once and logs it; one that fails twice fails the run", async () => {
    const seen = new Map<string, number>()
    const logs: string[] = []
    const run = async (f: string) => {
      const n = (seen.get(f) ?? 0) + 1
      seen.set(f, n)
      // flaky.test.ts fails only the first time; broken.test.ts always fails (an injected failing test).
      return { ok: f === "fine.test.ts" || (f === "flaky.test.ts" && n > 1), out: `out of ${f}` }
    }
    const r = await runShards(["fine.test.ts", "flaky.test.ts", "broken.test.ts"], {
      freemem: () => 64 * GB,
      run,
      log: (l: string) => void logs.push(l),
    })
    expect(r.failed).toEqual(["broken.test.ts"])
    expect(r.passedOnRetry).toEqual(["flaky.test.ts"])
    expect(seen.get("broken.test.ts")).toBe(2)
    expect(seen.get("fine.test.ts")).toBe(1)
    expect(logs).toContain("[shards] retry once: flaky.test.ts")
  })

  it("finds the workspaces' test files", () => {
    const files = listTestFiles()
    expect(files).toContain("apps/host/test/test-shards.test.ts")
    expect(files.every((f) => /^(apps|packages)\/[^/]+\/test\//.test(f))).toBe(true)
  })
})
