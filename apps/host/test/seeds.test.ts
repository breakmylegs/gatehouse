// D-010, randomised check seeds: the verifier's rerun gets a fresh seed, passed to the runner it knows and in
// CODEHOUSE_SEED, and recorded; a test written against one seed passes as Claude ran it and fails the rerun.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { ActionRequest, ActionResult } from "../src/codehouse-action.js"
import { freshSeed, seededCommand } from "../src/seeds.js"
import { buildStack, type Stack } from "./stack.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-seeds-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe("check seeds (D-010)", () => {
  it("passes the seed to Vitest and Jest, behind npm test too, and leaves other commands as they were", () => {
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }))
    expect(seededCommand("npx vitest run", dir, 7)).toBe("npx vitest run --sequence.seed=7 --sequence.shuffle")
    expect(seededCommand("npx jest", dir, 7)).toBe("npx jest --seed=7")
    expect(seededCommand("npm test", dir, 7)).toBe("npm test -- --sequence.seed=7 --sequence.shuffle")
    expect(seededCommand("npm test -- src/a", dir, 7)).toBe("npm test -- src/a --sequence.seed=7 --sequence.shuffle")
    expect(seededCommand("pytest", dir, 7)).toBe("pytest")
    expect(seededCommand("npx vitest run --sequence.seed=3", dir, 7)).toBe("npx vitest run --sequence.seed=3")
    const seeds = new Set(Array.from({ length: 20 }, freshSeed))
    expect(seeds.size).toBeGreaterThan(15)
    for (const s of seeds) expect(s).toBeGreaterThan(0)
  })
})

describe("flake quarantine on a real session (D-011)", () => {
  let s: Stack
  let calls = 0
  let always = false
  beforeAll(async () => {
    s = await buildStack({
      hardTimeoutMs: 1500,
      phoneExpiryMs: 800,
      // Fails the first run and every other one after: a flaky test. With `always`, it never passes.
      codehouseAction: async (): Promise<ActionResult> => {
        calls++
        return { ran: true, exitCode: always || calls % 2 === 1 ? 1 : 0, output: "", timedOut: false, killed: false, ms: 5 }
      },
    })
  }, 60000)
  afterAll(async () => {
    for (const x of s.manager.liveSessions()) await x.close()
    await s.stop()
  })

  async function claim(): Promise<Record<string, unknown>> {
    s.sdk.turn = async (api) => {
      await api.callTool("Bash", { command: "npm test" }, { selfApproved: false })
      api.say("All tests pass now.")
    }
    const session = await s.manager.start({ cwd: s.repo })
    const events: Array<Record<string, unknown>> = []
    session.on("event", (e) => e.type === "claim_checked" && events.push(e.data))
    session.prompt("go")
    await vi.waitFor(() => expect(events.length).toBeGreaterThan(0), { timeout: 20_000 })
    await session.close()
    return events[0]!
  }

  it("labels a test run that passes and fails across five seeds as flaky, with every seed", async () => {
    calls = 0
    const e = await claim()
    expect(calls).toBe(5)
    expect(e).toMatchObject({ outcome: "contradicted", flaky: true })
    const runs = e.runs as Array<{ seed: number; passed: boolean }>
    expect(runs.map((r) => r.passed)).toEqual([false, true, false, true, false])
    expect(new Set(runs.map((r) => r.seed)).size).toBe(5)
    expect(String(e.why)).toContain("passed 2 of 5 runs, so the tests are flaky")
    expect(JSON.parse(s.records().filter((r) => r.event === "claim_verified").at(-1)!.inputJson)).toMatchObject({ flaky: true })
  })

  it("does not call a test that always fails flaky", async () => {
    always = true
    calls = 0
    const e = await claim()
    expect(calls).toBe(5)
    expect(e).toMatchObject({ outcome: "contradicted" })
    expect(e.flaky).toBeUndefined()
  })
})

describe("on a real session (D-010)", () => {
  let s: Stack
  const runs: ActionRequest[] = []
  beforeAll(async () => {
    s = await buildStack({
      hardTimeoutMs: 1500,
      phoneExpiryMs: 800,
      // A test pinned to its seed: it passes with the seed it was written for (42, or none), and fails any other.
      codehouseAction: async (r): Promise<ActionResult> => {
        runs.push(r)
        const seed = r.env?.CODEHOUSE_SEED
        return { ran: true, exitCode: seed === undefined || seed === "42" ? 0 : 1, output: "", timedOut: false, killed: false, ms: 5 }
      },
    })
  }, 60000)
  afterAll(async () => {
    for (const x of s.manager.liveSessions()) await x.close()
    await s.stop()
  })

  it("a test written against one seed passes as Claude ran it, fails the rerun with a fresh seed, and the seed is recorded", async () => {
    s.sdk.turn = async (api) => {
      await api.callTool("Bash", { command: "npm test" }, { selfApproved: false })
      api.say("All tests pass now.")
    }
    const session = await s.manager.start({ cwd: s.repo })
    const events: Array<Record<string, unknown>> = []
    session.on("event", (e) => e.type === "claim_checked" && events.push(e.data))
    session.prompt("go")
    await vi.waitFor(() => expect(events.length).toBeGreaterThan(0), { timeout: 10_000 })
    // D-011 reruns a failing check with more fresh seeds; the claim names the first, the one that decided it.
    const seed = runs.find((r) => r.env?.CODEHOUSE_SEED !== undefined)?.env?.CODEHOUSE_SEED
    expect(seed).toMatch(/^\d+$/)
    expect(events[0]).toMatchObject({ kind: "tests", outcome: "contradicted", seed: Number(seed) })
    expect(String(events[0]!.why)).toContain(`with the fresh seed ${seed}`)
    const rec = s.records().find((r) => r.event === "claim_verified" && r.session === session.id)
    expect(JSON.parse(rec!.inputJson)).toMatchObject({ seed: Number(seed) })
    await session.close()
  })
})
