// The warm chat (owner, 1 Nov): a plain chat started hidden while New chat is open, claimed by the next plain chat, so
// the first message does not wait for Claude Code to start. Hidden until claimed, never used once it no longer fits,
// put away when not asked for, and never started with the kill switch on or free memory short.
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WARM_IDLE_MS } from "../src/sessions.js"
import { buildStack, type Stack } from "./stack.js"

let s: Stack
const seen: string[] = []
const named: Array<[string, string]> = []
beforeEach(async () => {
  s = await buildStack({ config: {} })
  s.deps.chatsDir = path.join(s.dir, "chats")
  s.deps.freeMemory = () => 8 * 1024 ** 3
  s.deps.nameChat = async (id, title) => void named.push([id, title])
  seen.length = 0
  named.length = 0
  s.manager.on("session", (info) => seen.push(info.id))
  // The account is checked by the first session, as it is when Codehouse starts.
  await (await s.manager.start({ cwd: s.repo })).close()
})
afterEach(async () => {
  vi.useRealTimers()
  await s.stop()
})

/** Starts the warm chat and waits until its Claude Code has started. */
async function warm() {
  const before = s.sdk.queries.length
  s.manager.warmChat()
  await vi.waitFor(() => expect(s.sdk.queries.length).toBe(before + 1))
  const q = s.sdk.queries.at(-1)!
  await q.initializationResult()
  return q
}

describe("the warm chat", () => {
  it("starts hidden, and the next plain chat takes it, named from what was said", async () => {
    const q = await warm()
    expect(s.manager.list().some((i) => i.kind === "chat")).toBe(false)
    const queries = s.sdk.queries.length
    const chat = await s.manager.start({ cwd: "x", kind: "chat", title: "What is a job object?" })
    expect(s.logs.filter((l) => l.includes("warm"))).toEqual([])
    expect(s.sdk.queries.length).toBe(queries)
    expect(s.sdk.queries.at(-1)).toBe(q)
    expect(q.options.permissionMode).toBe("plan")
    expect(chat.info()).toMatchObject({ kind: "chat", title: "What is a job object?" })
    expect(s.manager.list().map((i) => i.id)).toContain(chat.id)
    expect(path.dirname(chat.cwd)).toBe(s.deps.chatsDir)
    // Nothing about it reached the window until it was claimed.
    expect(seen.filter((id) => id === chat.id)).toHaveLength(1)
  })

  it("keeps the first message as the chat's title, redacted, once Claude Code names the chat", async () => {
    s.deps.config().redactTerms = ["Falcon"]
    await warm()
    const chat = await s.manager.start({ cwd: "x", kind: "chat", title: "Plan the Falcon launch" })
    chat.prompt("Plan the Falcon launch")
    await vi.waitFor(() => expect(named).toHaveLength(1))
    expect(named[0]![1]).not.toMatch(/falcon/i)
    expect(named[0]![1]).toMatch(/^Plan the .+ launch$/)
  })

  it("is not taken by a chat it does not fit, and is put away when what chats start with changed", async () => {
    const q = await warm()
    const research = await s.manager.start({
      cwd: "x",
      kind: "chat",
      title: "Find sources",
      research: true,
    })
    expect(s.sdk.queries.at(-1)).not.toBe(q)
    expect(research.info().kind).toBe("chat")
    expect(q.closed).toBe(false)
    s.deps.config().globalInstructions = "Answer in French."
    const queries = s.sdk.queries.length
    await s.manager.start({ cwd: "x", kind: "chat", title: "Bonjour" })
    expect(q.closed).toBe(true)
    expect(s.sdk.queries.length).toBe(queries + 1)
  })

  it("is not started with the kill switch on, or with free memory short", async () => {
    const before = s.sdk.queries.length
    s.deps.freeMemory = () => 1024 ** 3
    s.manager.warmChat()
    await s.kill.engage("desktop")
    s.deps.freeMemory = () => 8 * 1024 ** 3
    s.manager.warmChat()
    await new Promise((r) => setTimeout(r, 50))
    expect(s.sdk.queries.length).toBe(before)
  })

  it("is put away when no one asks for it for a while", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "Date"] })
    const q = await warm()
    vi.advanceTimersByTime(WARM_IDLE_MS + 31_000)
    await vi.waitFor(() => expect(q.closed).toBe(true))
  })
})
