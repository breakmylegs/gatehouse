// T-080 (t3code review): a watched pull request wakes its session when a check newly fails or the branch newly
// conflicts: never for what already failed, at most every two minutes, one wake in 15 minutes and 12 a day, recorded
// first, naming only checks, and ending when the pull request is merged or the session closes.
import { describe, expect, it } from "vitest"
import type { PullRequestDetail } from "../src/forge/github.js"
import { MIN_GAP_MS, POLL_MS, PrWatcher } from "../src/forge/watch.js"

const pr = (checks: Array<[string, string]>, o: Partial<PullRequestDetail> = {}): PullRequestDetail => ({
  number: 12,
  title: "Fix",
  state: "OPEN",
  url: "",
  branch: "fix/x",
  draft: false,
  base: "main",
  checks: checks.map(([name, state]) => ({ name, state })),
  ...o,
})

function setup() {
  let now = 0
  let current = pr([["build", "FAILURE"], ["lint", "SUCCESS"]])
  let alive = true
  let canRecord = true
  const woke: string[] = []
  const records: unknown[] = []
  const w = new PrWatcher({
    enabled: () => true,
    view: async () => current,
    alive: () => alive,
    wake: (_id, text) => void woke.push(text),
    audit: { record: async (r: unknown) => (records.push(r), canRecord) },
    now: () => now,
  })
  return {
    w,
    woke,
    records,
    set: (p: PullRequestDetail) => void (current = p),
    advance: (ms: number) => void (now += ms),
    close: () => void (alive = false),
    noRecord: () => void (canRecord = false),
  }
}

describe("watching a pull request (T-080)", () => {
  it("wakes the session for a check that newly fails, not one that already failed", async () => {
    const t = setup()
    await t.w.watch("s1", "C:/repo", 12)
    t.advance(POLL_MS)
    await t.w.tick()
    expect(t.woke).toEqual([])
    t.set(pr([["build", "FAILURE"], ["lint", "FAILURE"]]))
    t.advance(POLL_MS - 1)
    await t.w.tick()
    expect(t.woke).toEqual([])
    t.advance(1)
    await t.w.tick()
    expect(t.woke).toEqual(['Pull request #12: the check "lint" now fails. Look into it and fix what you can.'])
    expect(t.records).toHaveLength(1)
  })

  it("waits 15 minutes between wakes, and says when the branch conflicts", async () => {
    const t = setup()
    await t.w.watch("s1", "C:/repo", 12)
    t.set(pr([["build", "FAILURE"], ["lint", "FAILURE"]]))
    t.advance(POLL_MS)
    await t.w.tick()
    t.set(pr([["build", "FAILURE"], ["lint", "FAILURE"], ["e2e", "TIMED_OUT"]], { mergeable: "CONFLICTING" }))
    t.advance(POLL_MS)
    await t.w.tick()
    expect(t.woke).toHaveLength(1)
    t.set(pr([["build", "FAILURE"], ["lint", "FAILURE"], ["e2e", "TIMED_OUT"], ["unit", "ERROR"]], { mergeable: "CONFLICTING" }))
    t.advance(MIN_GAP_MS)
    await t.w.tick()
    expect(t.woke[1]).toBe('Pull request #12: the check "unit" now fails. Look into it and fix what you can.')
  })

  it("does not wake without a record, and stops when merged or the session closes", async () => {
    const t = setup()
    await t.w.watch("s1", "C:/repo", 12)
    t.noRecord()
    t.set(pr([["build", "FAILURE"], ["lint", "FAILURE"]]))
    t.advance(POLL_MS)
    await t.w.tick()
    expect(t.woke).toEqual([])
    t.set(pr([], { state: "MERGED" }))
    t.advance(POLL_MS)
    await t.w.tick()
    expect(t.w.list("s1")).toEqual([])
    await t.w.watch("s1", "C:/repo", 12)
    t.close()
    t.advance(POLL_MS)
    await t.w.tick()
    expect(t.w.list("s1")).toEqual([])
  })
})
