// D-009, the done-claim verifier: a claim that the work is done is checked by running what it rests on again, and
// stamped Verified, Contradicted or Unverified.
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { checkIn, commandFor, findClaims } from "../src/claims.js"
import type { ActionRequest, ActionResult } from "../src/codehouse-action.js"
import { buildStack, type Stack } from "./stack.js"

describe("finding claims (D-009)", () => {
  it("finds what a reply claims, and leaves alone what it does not", () => {
    expect(findClaims("Done. All tests pass now.").map((c) => c.kind)).toEqual(["tests"])
    expect(findClaims("The build succeeds and lint is clean.").map((c) => c.kind)).toEqual(["build", "lint"])
    expect(findClaims("I have fixed the bug in parse().").map((c) => c.kind)).toEqual(["fixed"])
    expect(findClaims("Typecheck passes. All green!").map((c) => c.kind)).toEqual(["tests", "typecheck"])
    for (const s of [
      "Not all tests pass yet.",
      "The tests don't pass: two fail.",
      "Once I add the mock, the tests should pass.",
      "Tests pass except the slow one.",
    ])
      expect(findClaims(s), s).toEqual([])
  })

  it("reruns only the part of a line that checks it, in the folder it ran in", () => {
    expect(checkIn("cd app && npm test 2>&1 | tail -20", "tests", "C:/p")).toEqual({
      command: "npm test",
      cwd: path.resolve("C:/p", "app"),
    })
    expect(checkIn("npx tsc --noEmit -p apps/host", "typecheck", "C:/p")).toEqual({
      command: "npx tsc --noEmit -p apps/host",
      cwd: "C:/p",
    })
    expect(checkIn("npx tsc --noEmit", "build", "C:/p")).toBeUndefined()
    expect(commandFor({ kind: "tests", quote: "" }, ["git status", "npx vitest run"], "C:/p", "C:/p")).toEqual({
      command: "npx vitest run",
      cwd: "C:/p",
    })
  })
})

describe("on a real session (D-009)", () => {
  let s: Stack
  const runs: ActionRequest[] = []
  let exitCode = 1
  beforeAll(async () => {
    s = await buildStack({
      hardTimeoutMs: 1500,
      phoneExpiryMs: 800,
      codehouseAction: async (r): Promise<ActionResult> => {
        runs.push(r)
        return { ran: true, exitCode, output: "", timedOut: false, killed: false, ms: 5 }
      },
    })
  }, 60000)
  afterAll(async () => {
    for (const x of s.manager.liveSessions()) await x.close()
    await s.stop()
  })

  /** A turn that runs the tests, then says what it says. */
  async function turn(say: string, command?: string) {
    s.sdk.turn = async (api) => {
      if (command) await api.callTool("Bash", { command }, { selfApproved: false })
      api.say(say)
    }
    const session = await s.manager.start({ cwd: s.repo })
    const events: Array<Record<string, unknown>> = []
    session.on("event", (e) => e.type === "claim_checked" && events.push(e.data))
    session.prompt("go")
    await vi.waitFor(() => expect(events.length).toBeGreaterThan(0), { timeout: 10_000 })
    return { session, events }
  }

  it("shows Contradicted when the tests are said to pass after a failing run", async () => {
    exitCode = 1
    // A command the rules allow, so it runs and the turn records it (the part a pipe hides is in checkIn's own test).
    const { session, events } = await turn("All tests pass now.", "npm test")
    expect(events[0]).toMatchObject({ kind: "tests", outcome: "contradicted", command: "npm test" })
    expect(runs.at(-1)).toMatchObject({ command: "npm test", sessionId: session.id, level: "high" })
    expect(session.info().claims?.at(-1)).toMatchObject({ outcome: "contradicted" })
    expect(s.records().some((r) => r.event === "claim_verified")).toBe(true)
  })

  it("shows Verified when the check passes", async () => {
    exitCode = 0
    const { events } = await turn("Fixed it, and the tests pass.", "npm test")
    expect(events.map((e) => e.outcome)).toEqual(["verified", "verified"])
  })

  it("shows Unverified for a claim with no command to run", async () => {
    const before = runs.length
    // The test repository has no test script and the turn ran nothing.
    const { events } = await turn("The build succeeds.")
    expect(events[0]).toMatchObject({ kind: "build", outcome: "unverified", why: "there is no command to check it with" })
    expect(runs.length).toBe(before)
  })
})

