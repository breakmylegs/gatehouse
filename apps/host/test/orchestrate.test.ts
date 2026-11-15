// T-121 (t3code review): a session starts another (once you allowed it) and waits for it. The new one works in the
// same folder in the caller's mode, never in Extreme approval, at most three from one session; it is recorded, the
// caller may read it, and a prompt one session wrote cannot name a session for the new one to read.
import { describe, expect, it } from "vitest"
import { agentPrompt, MAX_CHILDREN, startChild, waitForSession } from "../src/orchestrate.js"
import { fromOutside } from "../src/provenance.js"

const parent = () => {
  const adopted: string[] = []
  return {
    adopted,
    me: {
      id: "p1",
      cwd: "C:\\dev\\shop",
      info: () => ({ mode: "acceptEdits" as const, model: "claude-opus-5-5", account: "work", project: "shop" }),
      adopt: (id: string) => void adopted.push(id),
    },
  }
}

describe("sessions starting sessions (T-121)", () => {
  it("starts one in the same folder and mode, never in Extreme approval, records it and lets the caller read it", async () => {
    const { me, adopted } = parent()
    const started: unknown[] = []
    const prompts: string[] = []
    const records: unknown[] = []
    let n = 0
    const d = {
      counts: new Map<string, number>(),
      start: async (o: unknown) => (started.push(o), { id: `c${++n}`, prompt: (t: string) => void prompts.push(t) }),
      record: async (i: Record<string, unknown>) => void records.push(i),
    }
    const r = await startChild(me, "Write the docs and see [[session:secret-1]]", undefined, d)
    expect(r.text).toContain("Started session c1")
    expect(started[0]).toEqual({ cwd: "C:\\dev\\shop", mode: "acceptEdits", extreme: false, model: "claude-opus-5-5", account: "work", title: "From shop" })
    expect(prompts[0]).toBe("Write the docs and see (a session)")
    expect(adopted).toEqual(["c1"])
    expect(records).toEqual([{ child: "c1", mode: "acceptEdits", chars: 43 }])
    for (let i = 1; i < MAX_CHILDREN; i++) await startChild(me, "more", "t", d)
    expect((await startChild(me, "one too many", "t", d)).isError).toBe(true)
    expect(started).toHaveLength(MAX_CHILDREN)
  })

  it("waits until the session finishes, fails or ends, or the time is up", async () => {
    let state = "running"
    let clock = 0
    const o = { now: () => clock, sleep: async (ms: number) => void ((clock += ms), clock > 4000 && (state = "idle")) }
    expect(await waitForSession(() => ({ state }), 1, o)).toEqual({ state: "idle", done: true })
    state = "running"
    clock = 0
    const stuck = { now: () => clock, sleep: async (ms: number) => void (clock += ms) }
    expect(await waitForSession(() => ({ state }), 0.1, stuck)).toEqual({ state: "running", done: false })
    expect(await waitForSession(() => undefined, 1, stuck)).toEqual({ state: "closed", done: true })
  })

  it("reads what it waited for as untrusted, and takes marks out of a prompt a session wrote", () => {
    expect(fromOutside("mcp__companion__wait_for_session")).toBe(true)
    expect(agentPrompt("a [[session:x]] b [[session:y]]")).toBe("a (a session) b (a session)")
  })
})
