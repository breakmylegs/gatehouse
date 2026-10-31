// Low, Medium and High per session (owner, 30 Oct), as the Host applies them: through the SDK's documented spawn
// hook, changed while a session runs, recorded, kept across a restart, and never at the cost of invariant 4.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { Limiter, ResourceLevel } from "../src/limits.js"
import { buildStack, type Stack } from "./stack.js"

let s: Stack
const set = vi.fn(async (_job: string, _level: ResourceLevel) => undefined)
let started: { job: string; level: () => ResourceLevel; onStderr: (t: string) => void } | undefined
const fake: Limiter = {
  spawn: (job, level, onStderr) => {
    started = { job, level, onStderr }
    return (() => undefined) as never
  },
  set,
}

beforeAll(async () => {
  s = await buildStack({ hardTimeoutMs: 1500, phoneExpiryMs: 800 })
  s.deps.limiter = fake
}, 60000)
afterAll(() => s.stop())

describe("resources per session", () => {
  it("starts Claude Code through the limiter at the session's level, and says which level it has", async () => {
    const session = await s.manager.start({ cwd: s.repo, resources: "low" })
    expect(typeof s.sdk.queries.at(-1)?.options.spawnClaudeCodeProcess).toBe("function")
    expect(started?.level()).toBe("low")
    expect(session.info().resources).toBe("low")
  })

  it("changes the level of a running session at once, and records it", async () => {
    const session = await s.manager.start({ cwd: s.repo })
    expect(session.info().resources).toBe("high")
    await session.setResources("medium")
    expect(set).toHaveBeenLastCalledWith(started?.job, "medium")
    expect(session.info().resources).toBe("medium")
    expect(started?.level()).toBe("medium")
    expect(
      s
        .records()
        .filter((r) => r.event === "resources_changed")
        .at(-1),
    ).toMatchObject({
      session: session.id,
      verdict: { ruleId: "resources-changed", decidedBy: "human-desktop" },
    })
  })

  it("still stops the session on the shadowing warning, which now comes through the limiter", async () => {
    const session = await s.manager.start({ cwd: s.repo })
    started?.onStderr("warning CLAUDE_SDK_CAN_USE_TOOL_SHADOWED: canUseTool will not be called")
    expect(session.info().state).toBe("error")
  })

  it("keeps the level when the session is force-stopped and started again", async () => {
    const session = await s.manager.start({ cwd: s.repo, resources: "low" })
    const again = await s.manager.forceStop(session.id)
    expect(again.info().resources).toBe("low")
  })
})

describe("without the limiter", () => {
  it("leaves the SDK to start Claude Code itself, and offers no level", async () => {
    const before = s.deps.limiter
    delete s.deps.limiter
    try {
      const session = await s.manager.start({ cwd: s.repo })
      expect(s.sdk.queries.at(-1)?.options.spawnClaudeCodeProcess).toBeUndefined()
      expect(session.info().resources).toBeUndefined()
      await expect(session.setResources("low")).rejects.toThrow(/cannot limit/)
    } finally {
      s.deps.limiter = before
    }
  })
})
