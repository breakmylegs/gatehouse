// CH-03 (ADR 0012): every tool call from a chat tells the Approver it comes from a chat, so the rules for chats apply.
import { describe, expect, it, vi } from "vitest"
import { createCanUseTool, type CanUseDeps } from "../src/canuse.js"

function setup(sessionKind?: "code" | "chat") {
  const evaluate = vi.fn(async () => ({
    outcome: "deny" as const,
    ruleId: "chat-no-shell",
    reason: "A chat cannot run commands or change files.",
    risk: 100,
    decidedBy: "rules" as const,
    policyHash: "h",
  }))
  const deps = {
    sessionId: "s1",
    cwd: "C:/chats/hello",
    project: "hello",
    ...(sessionKind ? { sessionKind } : {}),
    approver: { evaluate },
    broker: { request: async () => ({ outcome: "deny", channel: "desktop", waitedMs: 1 }) },
    audit: { record: async () => true },
    kill: () => false,
    policy: () => undefined,
    engine: {},
    pwsh: undefined,
    decided: new Set<string>(),
    verdicts: new Map(),
    log: () => undefined,
  } as unknown as CanUseDeps
  const canUse = createCanUseTool(deps)
  return {
    evaluate,
    call: () =>
      canUse("Bash", { command: "git status" }, {
        toolUseID: "t1",
        signal: new AbortController().signal,
      } as never),
  }
}

describe("a chat's tool calls", () => {
  it("say they come from a chat, and are refused when the rules for chats refuse them", async () => {
    const t = setup("chat")
    expect((await t.call())?.behavior).toBe("deny")
    expect(t.evaluate).toHaveBeenCalledWith(
      { toolName: "Bash", input: { command: "git status" } },
      expect.objectContaining({ sessionKind: "chat", sessionId: "s1" }),
    )
  })

  it("leave the kind out where the session does not give one, which the rules read as a coding session", async () => {
    const t = setup()
    await t.call()
    const ctx = (t.evaluate.mock.calls[0] as unknown[])[1] as Record<string, unknown>
    expect(ctx).not.toHaveProperty("sessionKind")
  })
})
