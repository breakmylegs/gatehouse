// B06 (MCP 2026-07-28): a server asking you to open a page is decided like a tool call, and never opened by Codehouse.
import { describe, expect, it, vi } from "vitest"
import type { CanUseTool, ElicitationRequest } from "@anthropic-ai/claude-agent-sdk"
import { decideElicitation, OPEN_URL_TOOL } from "../src/elicitation.js"

const req = (over: Partial<ElicitationRequest> = {}): ElicitationRequest => ({
  serverName: "docs",
  message: "Sign in to read your documents",
  mode: "url",
  url: "https://auth.example.com/login?state=abc",
  elicitationId: "e1",
  ...over,
})
const allowing = vi.fn(async () => ({
  behavior: "allow",
  updatedInput: {},
})) as unknown as CanUseTool
const denying = vi.fn(async () => ({ behavior: "deny", message: "no" })) as unknown as CanUseTool
const deps = (canUse: CanUseTool, extreme = false) => ({
  canUse,
  extreme: () => extreme,
  log: () => undefined,
})

describe("a server's request for you", () => {
  it("asks through the permission path with the full address, and accepts only what you allow", async () => {
    expect(await decideElicitation(req(), deps(allowing))).toEqual({ action: "accept" })
    expect(vi.mocked(allowing)).toHaveBeenCalledWith(
      OPEN_URL_TOOL,
      {
        server: "docs",
        url: "https://auth.example.com/login?state=abc",
        message: "Sign in to read your documents",
      },
      expect.objectContaining({ toolUseID: "elicit-e1" }),
    )
    expect(await decideElicitation(req(), deps(denying))).toEqual({ action: "decline" })
  })

  it("declines a form, an address that is not plain https, and any request in Extreme approval, without asking", async () => {
    const ask = vi.fn(allowing)
    for (const r of [
      req({ mode: "form", url: undefined, requestedSchema: {} }),
      req({ url: "http://auth.example.com/login" }),
      req({ url: "javascript:alert(1)" }),
      req({ url: "https://user:pass@auth.example.com/" }),
      req({ url: "not a url" }),
      req({ url: undefined }),
    ])
      expect(await decideElicitation(r, deps(ask))).toEqual({ action: "decline" })
    expect(await decideElicitation(req(), deps(ask, true))).toEqual({ action: "decline" })
    expect(ask).not.toHaveBeenCalled()
  })

  it("is handled in every session, and the rules ask you rather than allow it by themselves", async () => {
    const { buildStack } = await import("./stack.js")
    const s = await buildStack({ hardTimeoutMs: 1500, phoneExpiryMs: 800 })
    try {
      await s.manager.start({ cwd: s.repo })
      expect(typeof s.sdk.queries.at(-1)?.options.onElicitation).toBe("function")
      const v = await s.approver.evaluate(
        { toolName: OPEN_URL_TOOL, input: { server: "docs", url: "https://auth.example.com/" } },
        { cwd: s.repo, sessionId: "s" },
      )
      expect(v.outcome).not.toBe("allow")
    } finally {
      await s.stop()
    }
  }, 60_000)

  it("declines when deciding fails (invariant 1)", async () => {
    const broken = (async () => {
      throw new Error("down")
    }) as unknown as CanUseTool
    expect(await decideElicitation(req(), deps(broken))).toEqual({ action: "decline" })
  })
})
