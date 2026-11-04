// B23: a project's AGENTS.md reaches a coding session, through the floor, and not twice.
import fs from "node:fs"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { MAX_AGENTS_MD, readAgentsMd } from "../src/agents-md.js"
import { buildStack, type Stack } from "./stack.js"

let s: Stack
beforeAll(async () => {
  s = await buildStack({ hardTimeoutMs: 1500, phoneExpiryMs: 800 })
}, 60000)
afterAll(() => s.stop())

const write = (name: string, text: string) => fs.writeFileSync(path.join(s.repo, name), text)
const remove = (name: string) => fs.rmSync(path.join(s.repo, name), { force: true })
const prompt = () => s.sdk.queries.at(-1)?.options.systemPrompt as { append?: string }

describe("a project's AGENTS.md", () => {
  it("is given to a coding session, after what you told every session", async () => {
    write("AGENTS.md", "Use pnpm, never npm.")
    try {
      await s.manager.start({ cwd: s.repo })
      expect(prompt().append).toContain("This project has an AGENTS.md")
      expect(prompt().append).toContain("Use pnpm, never npm.")
    } finally {
      remove("AGENTS.md")
    }
  })

  it("is not given twice when CLAUDE.md brings it in, nor when there is none, and is cut to size", async () => {
    write("AGENTS.md", "x".repeat(MAX_AGENTS_MD + 500))
    try {
      expect((await readAgentsMd(s.repo, s.deps.policy()))?.length).toBe(MAX_AGENTS_MD)
      write("CLAUDE.md", "See @AGENTS.md for the rules.")
      expect(await readAgentsMd(s.repo, s.deps.policy())).toBeUndefined()
    } finally {
      remove("CLAUDE.md")
      remove("AGENTS.md")
    }
    expect(await readAgentsMd(s.repo, s.deps.policy())).toBeUndefined()
    // Without a policy nothing is read: the floor could not check it.
    write("AGENTS.md", "rules")
    try {
      expect(await readAgentsMd(s.repo, undefined)).toBeUndefined()
    } finally {
      remove("AGENTS.md")
    }
  })
})
