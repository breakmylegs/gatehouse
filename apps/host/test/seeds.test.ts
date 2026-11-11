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
    const seed = runs.at(-1)?.env?.CODEHOUSE_SEED
    expect(seed).toMatch(/^\d+$/)
    expect(events[0]).toMatchObject({ kind: "tests", outcome: "contradicted", seed: Number(seed) })
    expect(String(events[0]!.why)).toContain(`with the fresh seed ${seed}`)
    const rec = s.records().find((r) => r.event === "claim_verified" && r.session === session.id)
    expect(JSON.parse(rec!.inputJson)).toMatchObject({ seed: Number(seed) })
    await session.close()
  })
})
