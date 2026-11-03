// Low, Medium and High per session (owner, 30 Oct), as the Host applies them: through the SDK's documented spawn
// hook, changed while a session runs, recorded, kept across a restart, and never at the cost of invariant 4.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { RESOURCE_LEVELS } from "@gatehouse/shared/ws-protocol"
import { LEVELS, type Limiter, type ResourceLevel } from "../src/limits.js"
import { SessionMetaStore } from "../src/session-meta.js"
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

  it("has five levels, each allowing more than the one before, with Low, Medium and High as they always were", () => {
    expect(RESOURCE_LEVELS).toEqual(["lowest", "low", "medium", "higher", "high"])
    // An older version saved these three: they must keep their meaning.
    expect([LEVELS.low, LEVELS.medium, LEVELS.high]).toEqual([
      { cpu: 20, memoryMb: 2048, priority: "below" },
      { cpu: 50, memoryMb: 4096, priority: "below" },
      { cpu: 0, memoryMb: 0, priority: "normal" },
    ])
    const capped = RESOURCE_LEVELS.slice(0, -1).map((l) => LEVELS[l])
    for (let i = 1; i < capped.length; i++) {
      expect(capped[i]!.cpu).toBeGreaterThan(capped[i - 1]!.cpu)
      expect(capped[i]!.memoryMb).toBeGreaterThan(capped[i - 1]!.memoryMb)
    }
  })

  it("starts a session at Lowest, and keeps the level for Resume, dropping one it does not know", async () => {
    const session = await s.manager.start({ cwd: s.repo, resources: "lowest" })
    expect(started?.level()).toBe("lowest")
    expect(session.info().resources).toBe("lowest")
    const meta = new SessionMetaStore(
      path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gh-lv-")), "s.json"),
    )
    meta.keepSettings("a", { resources: "higher" })
    expect(meta.settings("a").resources).toBe("higher")
    meta.keepSettings("b", { resources: "turbo" as never })
    expect(meta.settings("b").resources).toBeUndefined()
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
