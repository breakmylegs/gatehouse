// W1-14: saved prompts, kept tolerantly and redacted, and Promote writes a skill in a project and audits it.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Fastify from "fastify"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { PromptStore, registerPromptRoutes, skillFile } from "../src/prompts.js"

let dir: string
let project: string
beforeEach(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-prompts-")))
  project = path.join(dir, "shop")
  fs.mkdirSync(path.join(project, ".git"), { recursive: true })
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe("saved prompts", () => {
  it("are added, changed and removed, redacted before they are written", async () => {
    const store = new PromptStore(path.join(dir, "prompts.json"), (t) =>
      t.replaceAll("Falcon", "[REDACTED:term]"),
    )
    const p = await store.save({ title: "Review", text: "Review {{file}} for Falcon" })
    expect(store.list()).toEqual([{ ...p }])
    expect(fs.readFileSync(path.join(dir, "prompts.json"), "utf8")).not.toContain("Falcon")
    await store.save({ id: p.id, title: "Review again", text: "Review {{file}}" })
    expect(store.get(p.id)?.title).toBe("Review again")
    await store.remove(p.id)
    expect(store.list()).toEqual([])
    await expect(store.save({ title: "", text: "x" })).rejects.toThrow(/title/)
  })

  it("keeps what a newer version wrote, and an entry it cannot read", async () => {
    const file = path.join(dir, "prompts.json")
    fs.writeFileSync(
      file,
      JSON.stringify([
        { id: "a", title: "A", text: "x", at: "", tags: ["kept"] },
        { strange: true },
      ]),
    )
    const store = new PromptStore(file)
    await store.save({ id: "a", title: "A2", text: "y" })
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Array<Record<string, unknown>>
    expect(raw[0]).toMatchObject({ id: "a", title: "A2", tags: ["kept"] })
    expect(raw[1]).toEqual({ strange: true })
  })
})

describe("promoting a prompt to a skill", () => {
  async function appWith(audited: boolean) {
    const store = new PromptStore(path.join(dir, "prompts.json"))
    const p = await store.save({
      title: "Write release notes",
      text: "Summarise the changes since {{tag}}.",
    })
    const records: Array<Record<string, unknown>> = []
    const app = Fastify()
    registerPromptRoutes(app, {
      prompts: store,
      audit: { record: async (e: Record<string, unknown>) => (records.push(e), audited) } as never,
      sessionCwd: (id) => (id === "s1" ? path.join(project, "src") : undefined),
    })
    return { app, p, records }
  }

  it("writes SKILL.md in the session's project and records it, never over an existing skill", async () => {
    fs.mkdirSync(path.join(project, "src"), { recursive: true })
    const { app, p, records } = await appWith(true)
    const r = await app.inject({
      method: "POST",
      url: `/api/prompts/${p.id}/promote`,
      payload: { session: "s1" },
    })
    expect(r.json()).toEqual({
      skill: "write-release-notes",
      path: ".claude/skills/write-release-notes/SKILL.md",
    })
    const file = path.join(project, ".claude", "skills", "write-release-notes", "SKILL.md")
    expect(fs.readFileSync(file, "utf8")).toBe(skillFile(p))
    expect(fs.readFileSync(file, "utf8")).toMatch(/^---\nname: write-release-notes\ndescription: /)
    expect(records[0]).toMatchObject({
      event: "prompt_promoted",
      input: { skill: "write-release-notes" },
    })
    const again = await app.inject({
      method: "POST",
      url: `/api/prompts/${p.id}/promote`,
      payload: { session: "s1" },
    })
    expect(again.statusCode).toBe(409)
    const nobody = await app.inject({
      method: "POST",
      url: `/api/prompts/${p.id}/promote`,
      payload: { session: "x" },
    })
    expect(nobody.statusCode).toBe(404)
    await app.close()
  })

  it("writes nothing it could not record", async () => {
    fs.mkdirSync(path.join(project, "src"), { recursive: true })
    const { app, p } = await appWith(false)
    const r = await app.inject({
      method: "POST",
      url: `/api/prompts/${p.id}/promote`,
      payload: { session: "s1" },
    })
    expect(r.statusCode).toBe(503)
    expect(fs.existsSync(path.join(project, ".claude"))).toBe(false)
    await app.close()
  })
})
