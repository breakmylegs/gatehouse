// CH-03 (owner's Chat build, 4 Nov): every native chat is recorded into Chat's store as it happens, and Retry, Edit and
// switching branches keep one conversation with siblings.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Fastify from "fastify"
import { afterEach, describe, expect, it } from "vitest"
import { registerChatRoutes } from "../src/chat/api.js"
import { ChatStore } from "../src/chat/db.js"
import { ChatRecorder, type RecordedSession } from "../src/chat/recorder.js"

let dir: string | undefined
const stores: ChatStore[] = []
afterEach(() => {
  for (const s of stores.splice(0)) s.close()
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

function setup() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-chatrec-"))
  const store = new ChatStore({ file: path.join(dir, "chat.db"), redact: (v) => v })
  stores.push(store)
  const sessions = new Map<string, RecordedSession>()
  const logged: string[] = []
  const rec = new ChatRecorder(
    store,
    (id) => sessions.get(id),
    (l) => logged.push(l),
  )
  /** One whole turn: your message, Claude's reply in parts, the end of the turn. */
  const turn = (id: string, said: string, answer: string, uuid: string) => {
    rec.prompted(id, said)
    rec.message(id, {
      type: "assistant",
      uuid: `${uuid}-a`,
      message: {
        model: "claude-opus-5-5",
        content: [
          { type: "thinking", thinking: "Let me think." },
          { type: "tool_use", name: "WebSearch", input: { query: said } },
        ],
      },
    })
    rec.message(id, {
      type: "user",
      uuid: `${uuid}-r`,
      message: {
        content: [{ type: "tool_result", content: [{ type: "text", text: "found it" }] }],
      },
    })
    rec.message(id, {
      type: "assistant",
      uuid,
      message: { content: [{ type: "text", text: answer }] },
    })
    rec.message(id, { type: "result", subtype: "success" })
  }
  const shown = (id: string) => {
    const conversation = rec.conversationOf(id)!
    return store.branch(conversation).map((s) => {
      const last = s.message.blocks[s.message.blocks.length - 1] as { text?: string }
      return `${last.text} ${s.index + 1}/${s.siblings.length}`
    })
  }
  return { store, sessions, rec, turn, shown, logged }
}

describe("recording native chats", () => {
  it("keeps your message and Claude's whole reply, with the SDK ids a fork needs", () => {
    const { store, sessions, rec, turn } = setup()
    sessions.set("s1", { kind: "chat", title: "Colours", sdkSessionId: "sdk1" })
    turn("s1", "Name a colour", "Blue", "u1")
    const [you, claude] = store.messages(rec.conversationOf("s1")!)
    expect(you).toMatchObject({
      role: "user",
      blocks: [{ type: "text", text: "Name a colour" }],
      sdkSessionId: "sdk1",
    })
    expect(claude).toMatchObject({
      role: "assistant",
      parentId: you!.id,
      model: "claude-opus-5-5",
      provider: "anthropic",
      sdkUuid: "u1",
      sdkSessionId: "sdk1",
      blocks: [
        { type: "thinking", text: "Let me think." },
        { type: "tool_use", name: "WebSearch" },
        { type: "tool_result", text: "found it" },
        { type: "text", text: "Blue" },
      ],
    })
    expect(store.conversation(rec.conversationOf("s1")!)?.title).toBe("Colours")
  })

  it("makes an Edit a sibling, switches back to the first version and carries on there", () => {
    const { sessions, rec, turn, shown, store } = setup()
    sessions.set("s1", { kind: "chat", sdkSessionId: "sdk1" })
    turn("s1", "Name a colour", "Blue", "u1")
    turn("s1", "Another", "Green", "u2")
    // Edit "Another": a fork of sdk1 at the end of the first reply.
    sessions.set("s2", {
      kind: "chat",
      sdkSessionId: "sdk2",
      historyFrom: "sdk1",
      historyUntil: "u1",
      replaces: "s1",
    })
    turn("s2", "A warm one", "Orange", "v1")
    rec.closed("s1")
    expect(shown("s2")).toEqual(["Name a colour 1/1", "Blue 1/1", "A warm one 2/2", "Orange 1/1"])
    // Back to "Another": its branch ends in sdk1, which the screen resumes.
    const conversation = rec.conversationOf("s2")!
    const another = store.branch(conversation)[2]!.siblings[0]!
    const leaf = store.switchTo(conversation, another)
    expect(store.message(leaf)?.sdkSessionId).toBe("sdk1")
    sessions.set("s3", { kind: "chat", sdkSessionId: "sdk1", historyFrom: "sdk1", replaces: "s2" })
    turn("s3", "And one more", "Red", "u3")
    expect(shown("s3")).toEqual([
      "Name a colour 1/1",
      "Blue 1/1",
      "Another 1/2",
      "Green 1/1",
      "And one more 1/1",
      "Red 1/1",
    ])
  })

  it("makes a Retry of the first message a new first message in the same conversation", () => {
    const { sessions, rec, turn, shown } = setup()
    sessions.set("s1", { kind: "chat", sdkSessionId: "sdk1" })
    turn("s1", "Hello", "Hi", "u1")
    sessions.set("s2", { kind: "chat", sdkSessionId: "sdk2", replaces: "s1" })
    turn("s2", "Hello again", "Hi again", "v1")
    expect(rec.conversationOf("s2")).toBe(rec.conversationOf("s1"))
    expect(shown("s2")).toEqual(["Hello again 2/2", "Hi again 1/1"])
  })

  it("carries on where a chat brought back after a restart left off", () => {
    const { sessions, rec, turn, shown } = setup()
    sessions.set("s1", { kind: "chat", sdkSessionId: "sdk1" })
    turn("s1", "Hello", "Hi", "u1")
    const before = rec.conversationOf("s1")
    rec.closed("s1")
    sessions.set("s1b", { kind: "chat", sdkSessionId: "sdk1", historyFrom: "sdk1" })
    turn("s1b", "Still there?", "Yes", "u2")
    expect(rec.conversationOf("s1b")).toBe(before)
    expect(shown("s1b")).toEqual(["Hello 1/1", "Hi 1/1", "Still there? 1/1", "Yes 1/1"])
  })

  it("files a chat carried on from claude.ai as a fork that says where it came from (CH-07)", () => {
    const { store, sessions, rec, turn } = setup()
    sessions.set("s1", {
      kind: "chat",
      sdkSessionId: "sdk1",
      title: "Colours",
      forkOf: { conversation: "imported-1", message: "m9" },
    })
    turn("s1", "Carry on", "Gladly", "u1")
    expect(store.conversation(rec.conversationOf("s1")!)).toMatchObject({
      kind: "fork",
      provenance: { kind: "fork", fromConversation: "imported-1", fromMessage: "m9" },
    })
  })

  it("records only chats, and leaves out a subagent's steps and replayed history", () => {
    const { store, sessions, rec, turn } = setup()
    sessions.set("code", { kind: "code", sdkSessionId: "c1" })
    sessions.set("eval", { kind: "chat", sdkSessionId: "e1", evaluation: { plugin: "x" } })
    turn("code", "Build it", "Built", "c-1")
    turn("eval", "Try it", "Tried", "e-1")
    expect(store.listConversations()).toEqual([])
    sessions.set("s1", { kind: "chat", sdkSessionId: "sdk1" })
    rec.prompted("s1", "Hello")
    rec.message("s1", {
      type: "assistant",
      parent_tool_use_id: "t1",
      message: { content: [{ type: "text", text: "sub" }] },
    })
    rec.message("s1", {
      type: "user",
      isReplay: true,
      message: { content: [{ type: "tool_result", content: "old" }] },
    })
    rec.message("s1", {
      type: "assistant",
      uuid: "u1",
      message: { content: [{ type: "text", text: "Hi" }] },
    })
    rec.message("s1", { type: "result" })
    const reply = store.messages(rec.conversationOf("s1")!)[1]!
    expect(reply.blocks).toEqual([{ type: "text", text: "Hi" }])
  })

  it("opens a conversation found by search where its shown branch ends, in that session's folder", async () => {
    const { store, sessions, rec, turn } = setup()
    sessions.set("s1", { kind: "chat", sdkSessionId: "sdk1", cwd: "C:/chats/colours" })
    turn("s1", "Name a colour", "Blue", "u1")
    sessions.set("s2", {
      kind: "chat",
      sdkSessionId: "sdk2",
      cwd: "C:/chats/colours",
      historyFrom: "sdk1",
      historyUntil: "u1",
      replaces: "s1",
    })
    turn("s2", "A warm one", "Orange", "v1")
    const app = Fastify()
    registerChatRoutes(app, { store, recorder: rec })
    const open = (conversation: string) =>
      app.inject({ method: "POST", url: "/api/chat/open", payload: { conversation } })
    const conversation = rec.conversationOf("s2")!
    expect((await open(conversation)).json()).toEqual({
      sdkSessionId: "sdk2",
      cwd: "C:/chats/colours",
    })
    expect((await open("nothing")).statusCode).toBe(404)
    await app.close()
  })

  it("serves the branch to the screen and switches through the admin API", async () => {
    const { store, sessions, rec, turn } = setup()
    sessions.set("s1", { kind: "chat", sdkSessionId: "sdk1" })
    turn("s1", "Name a colour", "Blue", "u1")
    const app = Fastify()
    registerChatRoutes(app, { store, recorder: rec })
    const branch = (await app.inject({ url: "/api/chat/branch?session=s1" })).json() as {
      steps: Array<{ id: string; role: string; index: number; siblings: string[] }>
    }
    expect(branch.steps.map((s) => [s.role, s.index, s.siblings.length])).toEqual([
      ["user", 0, 1],
      ["assistant", 0, 1],
    ])
    const sw = await app.inject({
      method: "POST",
      url: "/api/chat/switch",
      payload: { session: "s1", messageId: branch.steps[0]!.id },
    })
    expect(sw.json()).toMatchObject({ sdkSessionId: "sdk1" })
    expect((await app.inject({ url: "/api/chat/branch?session=nobody" })).json()).toEqual({
      steps: [],
    })
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/chat/switch",
          payload: { session: "s1", messageId: "x" },
        })
      ).statusCode,
    ).toBe(404)
    expect((await app.inject({ url: "/api/chat/search?q=colour" })).json().hits).toHaveLength(1)
    await app.close()
  })
})
