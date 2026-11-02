// Retry and Edit (owner, 2 Nov): a fork carries a conversation on from one of its messages. The Host asks the SDK to
// resume, fork and stop at that message, keeps a chat in its own folder (where Claude Code finds the conversation),
// and says where the earlier conversation stops.
import path from "node:path"
import type { Options } from "@anthropic-ai/claude-agent-sdk"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { buildStack, type Stack } from "./stack.js"

let s: Stack
beforeEach(async () => {
  s = await buildStack({ config: {} })
  s.deps.chatsDir = path.join(s.dir, "chats")
})
afterEach(() => s.stop())

describe("carrying a conversation on from one of its messages", () => {
  it("resumes, forks and stops at the message, in the chat's own folder", async () => {
    const chat = await s.manager.start({ cwd: "x", kind: "chat", title: "Plan the launch" })
    const fork = await s.manager.start({
      cwd: chat.cwd,
      kind: "chat",
      title: "Plan the launch again",
      resume: "sdk-earlier",
      fork: true,
      resumeAt: "uuid-of-the-reply-before",
    })
    const o = s.sdk.queries.at(-1)!.options as Options
    expect(o.resume).toBe("sdk-earlier")
    expect(o.forkSession).toBe(true)
    expect(o.resumeSessionAt).toBe("uuid-of-the-reply-before")
    expect(fork.cwd).toBe(chat.cwd)
    expect(fork.info()).toMatchObject({
      historyFrom: "sdk-earlier",
      historyUntil: "uuid-of-the-reply-before",
      mode: "plan",
    })
  })

  it("never carries a chat on in a folder Codehouse did not make for chats", async () => {
    await expect(
      s.manager.start({
        cwd: s.repo,
        kind: "chat",
        resume: "sdk-earlier",
        fork: true,
        resumeAt: "u1",
      }),
    ).rejects.toThrow(/not one Codehouse made for chats/)
  })
})
