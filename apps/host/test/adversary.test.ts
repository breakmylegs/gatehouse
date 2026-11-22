// D-084: the breaker has read tools and RunTests only; any edit it tries escalates; its findings are read from its
// report and land in the implementer's evidence pack.
import { describe, expect, it, vi } from "vitest"
import { AdversaryStore, breakerFindings, BREAKER_EDIT_RULE } from "../src/adversary.js"
import { createCanUseTool, type CanUseDeps } from "../src/canuse.js"
import { localQuery, RUN_TESTS } from "../src/providers/local-query.js"

describe("the adversarial pair", () => {
  it("reads each finding from the breaker's report", () => {
    expect(breakerFindings("I looked.\nFINDING: total() is wrong for an empty cart (test cart.test.ts failed)\n- FINDING: price rounds down\nNO FINDINGS otherwise")).toEqual([
      "total() is wrong for an empty cart (test cart.test.ts failed)",
      "price rounds down",
    ])
    expect(breakerFindings("NO FINDINGS")).toEqual([])
  })

  it("keeps the findings with the session the breaker tried to break, for its evidence pack", () => {
    const store = new AdversaryStore()
    store.started("impl", "brk", "qwen2.5-coder", new Date("2026-11-22T10:00:00Z"))
    expect(store.get("impl")).toMatchObject({ reported: false, findings: [] })
    store.reported("impl", ["it breaks"])
    expect(store.get("impl")).toEqual({ breaker: "brk", model: "qwen2.5-coder", at: "2026-11-22T10:00:00.000Z", findings: ["it breaks"], reported: true })
    store.reported("someone-else", ["x"])
    expect(store.get("someone-else")).toBeUndefined()
  })

  it("sends a breaker's edit to a person, whatever the rules say", async () => {
    const request = vi.fn(async () => ({ outcome: "deny", channel: "desktop", waitedMs: 1 }))
    const canUse = createCanUseTool({
      sessionId: "brk",
      cwd: "C:/w",
      project: "shop",
      approver: { evaluate: async () => ({ outcome: "allow", ruleId: "edit-workspace-source", reason: "ok", risk: 10, decidedBy: "rules", policyHash: "h" }) },
      broker: { request },
      audit: { record: async () => true },
      kill: () => false,
      policy: () => undefined,
      engine: {},
      pwsh: undefined,
      decided: new Set<string>(),
      extreme: () => false,
      breaker: true,
      effects: async () => undefined,
      log: () => undefined,
    } as unknown as CanUseDeps)
    const call = (tool: string, input: Record<string, unknown>) => canUse(tool, input, { toolUseID: "t", signal: new AbortController().signal } as never)
    expect((await call("Write", { file_path: "C:/w/src/a.ts", content: "x" }))?.behavior).toBe("deny")
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ verdict: expect.objectContaining({ ruleId: BREAKER_EDIT_RULE, outcome: "escalate" }) }))
    expect((await call("Read", { file_path: "C:/w/src/a.ts" }))?.behavior).toBe("allow")
  })

  it("offers RunTests only to a breaker, runs it only after canUseTool allows it, and nothing else", async () => {
    const replies = [
      { choices: [{ message: { content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "RunTests", arguments: "{}" } }] } }] },
      { choices: [{ message: { content: "FINDING: the empty cart test fails" } }] },
    ]
    const bodies: Array<{ tools?: Array<{ function: { name: string } }> }> = []
    const fetchFn = vi.fn(async (_u: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as never)
      return Response.json(replies.shift())
    })
    const runTests = vi.fn(async () => ({ ok: false, output: "1 failed: empty cart" }))
    const asked: string[] = []
    async function* prompt() {
      yield { type: "user", message: { role: "user", content: "Break it" }, parent_tool_use_id: null, session_id: "" } as never
    }
    const q = localQuery(
      { prompt: prompt(), options: { cwd: "C:/w", canUseTool: async (name: string, input: Record<string, unknown>) => (asked.push(name), { behavior: "allow", updatedInput: input }) } as never },
      { runtime: { kind: "openai-compatible", url: "http://127.0.0.1:1", models: [{ name: "m" }] }, model: "m", models: ["m"], account: () => undefined, redact: (t) => t, fetchFn: fetchFn as never, runTests },
    ) as unknown as AsyncIterable<Record<string, unknown>>
    const seen: Array<Record<string, unknown>> = []
    for await (const m of q) seen.push(m)
    expect(bodies[0]!.tools!.map((t) => t.function.name)).toEqual(["Read", "Glob", "Grep", "WebFetch", RUN_TESTS.name])
    expect(asked).toEqual(["RunTests"])
    expect(runTests).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(seen)).toContain("1 failed: empty cart")
    expect(seen.find((m) => m.type === "result")).toMatchObject({ result: "FINDING: the empty cart test fails" })
  })

  it("does not run the tests when canUseTool does not allow it", async () => {
    const replies = [
      { choices: [{ message: { content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "RunTests", arguments: "{}" } }] } }] },
      { choices: [{ message: { content: "NO FINDINGS" } }] },
    ]
    const fetchFn = vi.fn(async () => Response.json(replies.shift()))
    const runTests = vi.fn(async () => ({ ok: true, output: "" }))
    async function* prompt() {
      yield { type: "user", message: { role: "user", content: "Break it" }, parent_tool_use_id: null, session_id: "" } as never
    }
    const q = localQuery(
      { prompt: prompt(), options: { cwd: "C:/w", canUseTool: async () => ({ behavior: "deny", message: "no" }) } as never },
      { runtime: { kind: "openai-compatible", url: "http://127.0.0.1:1", models: [{ name: "m" }] }, model: "m", models: ["m"], account: () => undefined, redact: (t) => t, fetchFn: fetchFn as never, runTests },
    ) as unknown as AsyncIterable<unknown>
    for await (const _m of q) void _m
    expect(runTests).not.toHaveBeenCalled()
  })

  it("does not offer RunTests to an ordinary chat on a local model", async () => {
    const bodies: Array<{ tools?: Array<{ function: { name: string } }> }> = []
    const fetchFn = vi.fn(async (_u: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as never)
      return Response.json({ choices: [{ message: { content: "hello" } }] })
    })
    async function* prompt() {
      yield { type: "user", message: { role: "user", content: "Hi" }, parent_tool_use_id: null, session_id: "" } as never
    }
    const q = localQuery(
      { prompt: prompt(), options: { cwd: "C:/w" } as never },
      { runtime: { kind: "openai-compatible", url: "http://127.0.0.1:1", models: [{ name: "m" }] }, model: "m", models: ["m"], account: () => undefined, redact: (t) => t, fetchFn: fetchFn as never },
    ) as unknown as AsyncIterable<unknown>
    for await (const _m of q) void _m
    expect(bodies[0]!.tools!.map((t) => t.function.name)).toEqual(["Read", "Glob", "Grep", "WebFetch"])
  })
})
