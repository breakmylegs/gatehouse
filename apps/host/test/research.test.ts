// W1-10, ADR 0007: a research chat is told to plan, search, read the best sources and cite each claim by number.
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { RESEARCH_INSTRUCTION } from "../src/projects.js"
import { buildStack, type Stack } from "./stack.js"

let s: Stack
beforeAll(async () => {
  s = await buildStack({ hardTimeoutMs: 1500, phoneExpiryMs: 800 })
  s.deps.chatsDir = path.join(s.dir, "chats")
}, 60000)
afterAll(() => s.stop())

const prompt = () => s.sdk.queries.at(-1)?.options.systemPrompt as unknown
const text = (p: unknown) =>
  typeof p === "string" ? p : ((p as { append?: string })?.append ?? "")

describe("a research chat", () => {
  it("is given the research instruction, and says it is one", async () => {
    const chat = await s.manager.start({
      cwd: "x",
      kind: "chat",
      title: "What changed in Vite 8?",
      research: true,
    })
    expect(text(prompt())).toContain(RESEARCH_INSTRUCTION)
    expect(RESEARCH_INSTRUCTION).toMatch(/numbered citation/)
    expect(chat.info().research).toBe(true)
    // Started again (after a crash or Force stop), it is still a research chat.
    expect(chat.restartOptions().research).toBe(true)
    await chat.close()
  })

  it("is not given it unless asked, and a coding session never is", async () => {
    const plain = await s.manager.start({ cwd: "x", kind: "chat", title: "hello" })
    expect(text(prompt())).not.toContain(RESEARCH_INSTRUCTION)
    expect(plain.info().research).toBeUndefined()
    await plain.close()
    const code = await s.manager.start({ cwd: s.repo, research: true })
    expect(text(prompt())).not.toContain(RESEARCH_INSTRUCTION)
    expect(code.info().research).toBeUndefined()
    await code.close()
  })
})
