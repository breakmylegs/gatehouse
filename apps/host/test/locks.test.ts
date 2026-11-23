// E-050: two sessions in one folder cannot both edit one file without a decision; a port being served is held the same
// way; a session's locks go when it ends.
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { CROSS_LOCK_RULE, LockTable, lockReason } from "../src/locks.js"
import { buildStack, type Stack } from "./stack.js"

describe("the lock table", () => {
  it("lets a session take a file once, and names who holds it for another", () => {
    const t = new LockTable("win32")
    const name = t.fileName("src/a.ts", "C:/dev/shop")
    expect(t.acquire("s1", "file", name)).toEqual({ ok: true })
    expect(t.acquire("s1", "file", name)).toEqual({ ok: true })
    expect(t.acquire("s2", "file", name)).toMatchObject({ ok: false, holder: { sessionId: "s1" } })
    expect(t.holderFor("s2", "Edit", { file_path: "C:\\DEV\\shop\\SRC\\a.ts" }, "C:/dev/shop")?.sessionId).toBe("s1")
    expect(t.holderFor("s1", "Edit", { file_path: "src/a.ts" }, "C:/dev/shop")).toBeUndefined()
    expect(t.holderFor("s2", "Read", { file_path: "src/a.ts" }, "C:/dev/shop")).toBeUndefined()
  })

  it("holds a port a session serves on, and releases everything a session held when it ends", () => {
    const t = new LockTable("win32")
    t.tookCall("s1", "Bash", { command: "npx vite --port 5180" })
    expect(t.holderFor("s2", "Bash", { command: "npm run dev -- --port 5180" }, "C:/p")?.kind).toBe("port")
    expect(t.holderFor("s2", "Bash", { command: "npx vite --port 5181" }, "C:/p")).toBeUndefined()
    expect(t.releaseSession("s1")).toBe(1)
    expect(t.holderFor("s2", "Bash", { command: "npx vite --port 5180" }, "C:/p")).toBeUndefined()
    expect(lockReason({ kind: "file", name: "x", sessionId: "s1", at: "" }, "Shop fixes")).toMatch(/^Another session \(Shop fixes\) is working on this file/)
  })
})

describe("on real sessions", () => {
  let s: Stack
  beforeAll(async () => {
    s = await buildStack({ hardTimeoutMs: 20_000, phoneExpiryMs: 10_000 })
    s.deps.sessionLocks = new LockTable()
    s.deps.sessionName = (id) => (id ? "the first session" : "?")
  }, 90_000)
  afterAll(async () => {
    for (const x of s.manager.liveSessions()) await x.close()
    await s.stop()
  })

  it("stops a second session editing a file the first is working on, without a decision", { timeout: 60_000 }, async () => {
    const file = path.join(s.repo, "shared.txt")
    s.sdk.turn = async (api) => {
      await api.callTool("Write", { file_path: file, content: "first\n" }, { selfApproved: false })
      api.say("done")
    }
    const a = await s.manager.start({ cwd: s.repo })
    const aDone = new Promise<void>((r) => a.on("message", (m: { type: string }) => m.type === "result" && r()))
    a.prompt("write it")
    // The rules hold a new file here; you allow the first session's write.
    await s.waitForPending(1)
    s.broker.resolve(s.pendingId(), { kind: "decision", decision: "allow" }, "desktop")
    await aDone
    expect(s.deps.sessionLocks!.list()).toEqual([expect.objectContaining({ kind: "file", sessionId: a.id })])

    s.sdk.turn = async (api) => {
      await api.callTool("Write", { file_path: file, content: "second\n" }, { selfApproved: false })
      api.say("done")
    }
    const b = await s.manager.start({ cwd: s.repo })
    b.prompt("write it too")
    await s.waitForPending(1)
    const pending = s.broker.list()[0]!.request
    expect(pending.verdict).toMatchObject({ ruleId: CROSS_LOCK_RULE, reason: expect.stringMatching(/Another session \(the first session\)/) })
    // The second write is held, and the lock is still the first session's.
    expect(s.deps.sessionLocks!.list()).toEqual([expect.objectContaining({ kind: "file", sessionId: a.id })])
    s.broker.resolve(pending.id, { kind: "decision", decision: "deny" }, "desktop")

    // When the first session ends, its lock goes.
    await a.close()
    await new Promise((r) => setTimeout(r, 50))
    expect(s.deps.sessionLocks!.list().filter((l) => l.sessionId === a.id)).toEqual([])
  })
})
