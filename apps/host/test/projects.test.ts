// Chat projects (owner's plan, W1-07, ADR 0006): instructions, knowledge files, and what reaches Claude.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  clipInstructions,
  composeInstructions,
  MAX_INSTRUCTIONS,
  MAX_KNOWLEDGE_FILES,
  ProjectError,
  ProjectStore,
} from "../src/projects.js"
import { CHAT_PROMPT } from "../src/sessions.js"
import { buildStack, type Stack } from "./stack.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-projects-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))
let n = 0
const fresh = () => new ProjectStore(path.join(dir, `store-${++n}`))
const code = (fn: () => unknown) => {
  try {
    fn()
  } catch (e) {
    return e instanceof ProjectError ? e.code : "other"
  }
  return "none"
}

describe("the project store", () => {
  it("makes, lists and removes projects, and refuses a name that is not one plain name", async () => {
    const s = fresh()
    expect(s.list()).toEqual([])
    s.create("Home assistant")
    s.create("Taxes 2026")
    expect(s.list().map((p) => p.name)).toEqual(["Home assistant", "Taxes 2026"])
    expect(code(() => s.create("Home assistant"))).toBe("exists")
    for (const bad of [
      "",
      "..",
      "../escape",
      "a/b",
      "a\\b",
      ".hidden",
      "con",
      "NUL.txt",
      "x".repeat(61),
      "trailing.",
    ])
      expect(
        code(() => s.create(bad)),
        bad,
      ).toBe("invalid")
    s.remove("Taxes 2026")
    expect(s.list().map((p) => p.name)).toEqual(["Home assistant"])
    expect(code(() => s.remove("Taxes 2026"))).toBe("missing")
    // Nothing was made outside the store.
    expect(fs.readdirSync(s.dir)).toEqual(["Home assistant"])
  })

  it("keeps instructions, up to the limit, and reads a missing file as none", async () => {
    const s = fresh()
    s.create("p")
    expect(s.get("p")?.instructions).toBe("")
    await s.setInstructions("p", "Answer briefly.")
    expect(s.get("p")?.instructions).toBe("Answer briefly.")
    expect(s.list()[0]).toMatchObject({ name: "p", hasInstructions: true })
    await expect(s.setInstructions("p", "x".repeat(MAX_INSTRUCTIONS + 1))).rejects.toThrow(
      /up to 8000/,
    )
    await expect(s.setInstructions("nope", "x")).rejects.toThrow(/no such project/)
    expect(s.get("p")?.instructions).toBe("Answer briefly.")
  })

  it("keeps knowledge files, shows their size, and refuses what it should", async () => {
    const s = fresh()
    s.create("p")
    await s.addFile("p", "notes.md", Buffer.from("# Notes"))
    await s.addFile("p", "data.bin", Buffer.from([0, 255, 1, 2]))
    expect(s.get("p")?.files).toEqual([
      { name: "data.bin", size: 4 },
      { name: "notes.md", size: 7 },
    ])
    // Binary content survives, and no temporary file is left behind.
    expect([...fs.readFileSync(path.join(s.knowledgeDir("p"), "data.bin"))]).toEqual([0, 255, 1, 2])
    expect(fs.readdirSync(s.knowledgeDir("p")).sort()).toEqual(["data.bin", "notes.md"])
    await expect(s.addFile("p", "../x.md", Buffer.from("x"))).rejects.toMatchObject({
      code: "invalid",
    })
    await expect(s.addFile("nope", "x.md", Buffer.from("x"))).rejects.toMatchObject({
      code: "missing",
    })
    s.removeFile("p", "notes.md")
    expect(s.get("p")?.files.map((f) => f.name)).toEqual(["data.bin"])
    expect(code(() => s.removeFile("p", "notes.md"))).toBe("missing")
    for (let i = 0; i < MAX_KNOWLEDGE_FILES - 1; i++)
      await s.addFile("p", `f${i}.txt`, Buffer.from("x"))
    await expect(s.addFile("p", "one-too-many.txt", Buffer.from("x"))).rejects.toMatchObject({
      code: "too-many",
    })
    // Replacing a file that is there is not a new file.
    await s.addFile("p", "f0.txt", Buffer.from("changed"))
  })

  it("ignores what it did not make", async () => {
    const s = fresh()
    fs.mkdirSync(s.dir, { recursive: true })
    fs.writeFileSync(path.join(s.dir, "stray.txt"), "x")
    fs.mkdirSync(path.join(s.dir, ".git"))
    s.create("p")
    expect(s.list().map((p) => p.name)).toEqual(["p"])
    expect(s.get("not-there")).toBeUndefined()
  })
})

describe("a chat's own knowledge folder matches the project", () => {
  it("copies what is added, copies again what changed, and removes what was removed", async () => {
    const s = fresh()
    s.create("p")
    await s.addFile("p", "a.md", Buffer.from("one"))
    await s.addFile("p", "b.md", Buffer.from("two"))
    const chat = path.join(dir, `chat-${n}`)
    expect(s.sync("p", chat).sort()).toEqual(["a.md", "b.md"])
    expect(fs.readFileSync(path.join(chat, "knowledge", "a.md"), "utf8")).toBe("one")
    s.removeFile("p", "b.md")
    await s.addFile("p", "a.md", Buffer.from("one, longer"))
    await s.addFile("p", "c.md", Buffer.from("three"))
    expect(s.sync("p", chat).sort()).toEqual(["a.md", "c.md"])
    expect(fs.readdirSync(path.join(chat, "knowledge")).sort()).toEqual(["a.md", "c.md"])
    expect(fs.readFileSync(path.join(chat, "knowledge", "a.md"), "utf8")).toBe("one, longer")
  })
})

describe("what Claude is told", () => {
  it("puts everyone's instructions, then the project's, then this session's, each cut to the limit", () => {
    const text = composeInstructions({
      global: "  Be kind.  ",
      project: { name: "Home", text: "Use metric.", files: [] },
      session: "x".repeat(MAX_INSTRUCTIONS + 500),
    })
    const at = (s: string) => text.indexOf(s)
    expect(at("Be kind.")).toBeGreaterThan(-1)
    expect(at("Be kind.")).toBeLessThan(at("Use metric."))
    expect(at("Use metric.")).toBeLessThan(at("For this conversation:"))
    expect(text).toContain('For the project "Home":')
    expect(text.match(/x+/)![0].length).toBe(MAX_INSTRUCTIONS)
    expect(clipInstructions("  hi \n")).toBe("hi")
  })

  it("tells every session first what to call you and your work, from Settings, Profile (owner, 4 Nov)", () => {
    const text = composeInstructions({
      profile: { callMe: " Pete ", work: "chief architect" },
      global: "Be kind.",
    })
    expect(text).toContain("About the person you are working with:")
    expect(text).toContain("- Call them Pete.")
    expect(text).toContain("- Their work: chief architect.")
    expect(text.indexOf("Call them")).toBeLessThan(text.indexOf("Be kind."))
    expect(composeInstructions({ profile: { callMe: "  ", work: "" } })).toBe("")
    expect(composeInstructions({ profile: { work: "consultant" } })).not.toContain("Call them")
  })

  it("says nothing when there is nothing to say, and names the knowledge files when there are some", () => {
    expect(composeInstructions({})).toBe("")
    expect(composeInstructions({ global: "   ", session: "" })).toBe("")
    const text = composeInstructions({ project: { name: "P", text: "", files: ["a.pdf", "b.md"] } })
    expect(text).toContain("a.pdf, b.md")
    expect(text).toContain("say which you used")
    expect(text).not.toContain("gave these instructions")
  })
})

describe("a session started with instructions", () => {
  let s: Stack
  let projects: ProjectStore
  beforeAll(async () => {
    s = await buildStack({ hardTimeoutMs: 1500, phoneExpiryMs: 800 })
    projects = new ProjectStore(path.join(s.dir, "projects"))
    s.deps.projects = projects
    s.deps.chatsDir = path.join(s.dir, "chats")
  }, 60000)
  afterAll(() => s.stop())

  const prompt = () => s.sdk.queries.at(-1)?.options.systemPrompt as unknown

  it("reaches a chat in that order, after its own instructions, and a project chat gets its files", async () => {
    projects.create("Home")
    await projects.setInstructions("Home", "Prefer metric units.")
    await projects.addFile("Home", "plan.md", Buffer.from("the plan"))
    ;(s.deps.config() as { globalInstructions?: string }).globalInstructions = "Always be concise."
    const chat = await s.manager.start({
      cwd: "x",
      kind: "chat",
      title: "hello",
      chatProject: "Home",
      instructions: "Today is for the garden.",
    })
    const text = prompt() as string
    expect(typeof text).toBe("string")
    expect(text.startsWith(CHAT_PROMPT)).toBe(true)
    const at = (x: string) => text.indexOf(x)
    expect(at("Always be concise.")).toBeGreaterThan(at(CHAT_PROMPT))
    expect(at("Always be concise.")).toBeLessThan(at("Prefer metric units."))
    expect(at("Prefer metric units.")).toBeLessThan(at("Today is for the garden."))
    expect(text).toContain("plan.md")
    expect(chat.info()).toMatchObject({
      chatProject: "Home",
      instructions: "Today is for the garden.",
    })
    // The files are in the chat's own folder, where reading needs no new permission.
    expect(fs.readFileSync(path.join(chat.cwd, "knowledge", "plan.md"), "utf8")).toBe("the plan")
    // Nothing was added through another folder.
    expect(
      (s.sdk.queries.at(-1)?.options as { additionalDirectories?: string[] }).additionalDirectories,
    ).toBeUndefined()
  })

  it("stops using a file you removed from the next message on", async () => {
    projects.create("Docs")
    await projects.addFile("Docs", "old.md", Buffer.from("old"))
    const chat = await s.manager.start({
      cwd: "x",
      kind: "chat",
      title: "docs",
      chatProject: "Docs",
    })
    expect(fs.existsSync(path.join(chat.cwd, "knowledge", "old.md"))).toBe(true)
    projects.removeFile("Docs", "old.md")
    await projects.addFile("Docs", "new.md", Buffer.from("new"))
    chat.prompt("hello")
    expect(fs.existsSync(path.join(chat.cwd, "knowledge", "old.md"))).toBe(false)
    expect(fs.existsSync(path.join(chat.cwd, "knowledge", "new.md"))).toBe(true)
  })

  it("reaches a coding session through the preset's append, and a session without instructions gets only the tidy-up line", async () => {
    const repo = s.repo
    await s.manager.start({ cwd: repo, instructions: "Run the tests before you finish." })
    const withIt = prompt() as { preset: string; append?: string }
    expect(withIt).toMatchObject({ type: "preset", preset: "claude_code" })
    expect(withIt.append).toContain("Run the tests before you finish.")
    expect(withIt.append).toContain("Always be concise.")
    delete (s.deps.config() as { globalInstructions?: string }).globalInstructions
    await s.manager.start({ cwd: repo })
    // Owner, 1 Nov: every coding session is asked to clean up its temporary files; nothing else is added.
    const bare = (prompt() as { append?: string }).append ?? ""
    expect(bare).toContain("delete temporary files and folders you create")
    expect(bare).not.toContain("gave these instructions")
  })

  it("is refused when the project does not exist, or when it is not a chat", async () => {
    await expect(
      s.manager.start({ cwd: "x", kind: "chat", title: "t", chatProject: "Nothing" }),
    ).rejects.toThrow(/no project with that name/)
    projects.create("Real")
    await expect(s.manager.start({ cwd: s.repo, chatProject: "Real" })).rejects.toThrow(
      /Only a chat can belong to a project/,
    )
  })
})
