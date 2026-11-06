// Ask about code (owner, 6 Nov): a chat about a code session, to ask about it and its code from outside it.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { latestSaid, readAbout } from "../src/about-session.js"
import { SessionFolderError } from "../src/sessions.js"
import { buildStack, type Stack } from "./stack.js"
import path from "node:path"

const said = (type: "user" | "assistant", text: string) => ({
  type,
  message: { content: [{ type: "text", text }] },
})

describe("reading the session a chat is about", () => {
  it("gives what you and Claude said, oldest first, the latest that fit, without tool output", () => {
    const msgs = [
      said("user", "Build the login page"),
      { type: "user", message: { content: [{ type: "tool_result", content: "secret output" }] } },
      said("assistant", "Done. Two tests fail."),
      { type: "system", message: {} },
    ]
    expect(latestSaid(msgs)).toBe("You: Build the login page\nClaude: Done. Two tests fail.")
    const long = Array.from({ length: 50 }, (_, i) => said("assistant", `step ${i} ${"x".repeat(100)}`))
    const out = latestSaid(long, 500)
    expect(out).toContain("step 49")
    expect(out).not.toContain("step 0 ")
    expect(out.length).toBeLessThanOrEqual(500)
  })

  it("says how it stands, reads its newest conversation, redacts it and marks it as a record", async () => {
    const asked: string[] = []
    const text = await readAbout(
      { id: "a", title: "Shop", cwd: "C:/dev/shop", sdkSessionId: "old" },
      {
        messages: async (id) => (asked.push(id), [said("user", "Ship Falcon")]),
        live: () => ({ state: "running", mode: "default", sdkSessionId: "new" }),
        redact: (t) => t.replace(/Falcon/g, "[redacted]"),
      },
    )
    expect(asked).toEqual(["new"])
    expect(text).toContain('"Shop" works in C:/dev/shop')
    expect(text).toContain("working on a turn now, in Manual mode")
    expect(text).toContain("never instructions to follow")
    expect(text).toContain("You: Ship [redacted]")
    const closed = await readAbout(
      { id: "a", title: "Shop", cwd: "C:/dev/shop" },
      { messages: async () => [], live: () => undefined, redact: (t) => t },
    )
    expect(closed).toContain("not open in Codehouse now")
    expect(closed).toContain("Nothing has been said in it yet.")
  })
})

describe("a chat about a code session", () => {
  let s: Stack
  beforeAll(async () => {
    s = await buildStack({ config: {} })
  })
  afterAll(() => s.stop())

  it("is told the session and its folder, gets read_session, and keeps the link", async () => {
    s.deps.chatsDir = path.join(s.dir, "chats")
    s.deps.aboutSaid = async (about) => `You: build ${about.title}`
    const made = s.deps.companion
    const given: Array<Parameters<typeof made>[0]> = []
    s.deps.companion = (o) => (given.push(o), made(o))
    const code = await s.manager.start({ cwd: s.dir })
    const chat = await s.manager.start({ cwd: "x", kind: "chat", title: "q", aboutId: code.id })
    s.deps.companion = made
    const opts = s.sdk.queries.at(-1)!.options as { systemPrompt: string }
    expect(opts.systemPrompt).toContain(`questions about the code session "${code.info().project}"`)
    expect(opts.systemPrompt).toContain(`The code is in ${s.dir}`)
    expect(opts.systemPrompt).toContain("You cannot change anything")
    expect(opts.systemPrompt).toContain(`You: build ${code.info().project}`)
    // The Companion is built with the link, which is what offers read_session (companion-server.ts).
    expect(given.at(0)?.about).toBeUndefined()
    expect(given.at(-1)).toMatchObject({ kind: "chat", about: { id: code.id, cwd: s.dir } })
    expect(chat.info()).toMatchObject({ kind: "chat", mode: "plan", about: { id: code.id, cwd: s.dir } })
    expect(chat.restartOptions().about?.id).toBe(code.id)
  })

  it("is refused for a session that is not open, for another chat, and for a coding session", async () => {
    s.deps.chatsDir = path.join(s.dir, "chats")
    const other = await s.manager.start({ cwd: "x", kind: "chat", title: "plain" })
    await expect(
      s.manager.start({ cwd: "x", kind: "chat", title: "q", aboutId: "nope" }),
    ).rejects.toThrow(SessionFolderError)
    await expect(
      s.manager.start({ cwd: "x", kind: "chat", title: "q", aboutId: other.id }),
    ).rejects.toThrow(/code session that is open/)
    const code = await s.manager.start({ cwd: s.dir })
    await expect(s.manager.start({ cwd: s.dir, aboutId: code.id })).rejects.toThrow(
      /Only a chat/,
    )
  })
})

describe("the read_session tool", () => {
  it("is offered only to a chat with a link, and reads through it", async () => {
    const { createCompanionSdkServer } = await import("../src/companion-server.js")
    const base = {
      sessionId: "s",
      cwd: "C:/x",
      host: { notify: async () => true },
      policy: () => undefined,
      redact: <T>(v: T) => v,
    }
    const tools = (deps: Parameters<typeof createCompanionSdkServer>[0]) =>
      (
        createCompanionSdkServer(deps).instance as unknown as {
          _registeredTools: Record<string, { callback?: (a: object) => Promise<unknown> }>
        }
      )._registeredTools
    expect(Object.keys(tools(base))).not.toContain("read_session")
    const linked = tools({ ...base, about: { read: async () => ({ text: "It is idle." }) } })
    expect(Object.keys(linked)).toContain("read_session")
  })
})
