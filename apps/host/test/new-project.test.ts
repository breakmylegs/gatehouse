import fs from "node:fs"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { CHAT_PROMPT, SessionFolderError } from "../src/sessions.js"
import { buildStack, type Stack } from "./stack.js"

let s: Stack
let projects: string

beforeAll(async () => {
  s = await buildStack({ config: {} })
  projects = path.join(s.dir, "projects")
  fs.mkdirSync(projects)
})
afterAll(() => s.stop())

const start = (cwd: string) => s.manager.start({ cwd, freshFolder: true })

describe("a new project in the projects folder", () => {
  it("gets a folder of its own, made a git repository, and a number when the name is taken", async () => {
    setProjects(projects)
    const first = await start(path.join(projects, "html-excel"))
    expect(first.cwd).toBe(path.join(projects, "html-excel"))
    expect(fs.existsSync(path.join(first.cwd, ".git"))).toBe(true)
    fs.writeFileSync(path.join(first.cwd, "index.html"), "<p>hi</p>")
    const second = await start(path.join(projects, "html-excel"))
    expect(second.cwd).toBe(path.join(projects, "html-excel-2"))
    // An empty folder of that name is used as it is.
    fs.mkdirSync(path.join(projects, "empty-one"))
    expect((await start(path.join(projects, "empty-one"))).cwd).toBe(
      path.join(projects, "empty-one"),
    )
  })

  it("is refused anywhere but straight inside the projects folder, and without one", async () => {
    setProjects(projects)
    await expect(start(path.join(s.dir, "elsewhere"))).rejects.toThrow(SessionFolderError)
    await expect(start(path.join(projects, "a", "b"))).rejects.toThrow(SessionFolderError)
    expect(fs.existsSync(path.join(s.dir, "elsewhere"))).toBe(false)
    setProjects(undefined)
    await expect(start(path.join(projects, "fine"))).rejects.toThrow(/projects folder/)
    expect(fs.existsSync(path.join(projects, "fine"))).toBe(false)
  })
})

/** The stack's config object is the one the session manager reads, so changing it is what the Host sees. */
function setProjects(folder: string | undefined) {
  const config = s.deps.config()
  if (folder) config.projectsFolder = folder
  else delete config.projectsFolder
}

describe("a chat", () => {
  it("gets a folder of its own in the chats folder, named from what was said, whatever folder was sent", async () => {
    const chats = path.join(s.dir, "chats")
    s.deps.chatsDir = chats
    const a = await s.manager.start({
      cwd: "C:\\Windows",
      kind: "chat",
      title: "How do vite proxies work?",
    })
    expect(path.dirname(a.cwd)).toBe(chats)
    expect(path.basename(a.cwd)).toBe("vite-proxies")
    expect(a.info().kind).toBe("chat")
    // Not a git repository: nothing of yours lives there.
    expect(fs.existsSync(path.join(a.cwd, ".git"))).toBe(false)
    const b = await s.manager.start({ cwd: "x", kind: "chat", title: "How do vite proxies work?" })
    expect(path.basename(b.cwd)).toBe("vite-proxies-2")
    const c = await s.manager.start({ cwd: "x", kind: "chat" })
    expect(path.basename(c.cwd)).toBe("chat")
  })

  it("stays in Plan mode whatever was asked, so it cannot change your projects", async () => {
    s.deps.chatsDir = path.join(s.dir, "chats")
    const chat = await s.manager.start({
      cwd: "x",
      kind: "chat",
      title: "plans",
      mode: "auto",
      extreme: true,
    })
    expect(chat.info()).toMatchObject({ mode: "plan", extreme: false })
    expect(s.sdk.queries.at(-1)?.options.permissionMode).toBe("plan")
    await expect(chat.setMode("default")).rejects.toThrow(/Plan mode/)
    await expect(chat.setMode("auto")).rejects.toThrow(/Plan mode/)
    await expect(chat.setExtreme(true)).rejects.toThrow(/Plan mode/)
    await chat.setMode("plan")
  })

  it("tells Claude it is a chat, and a coding session does not", async () => {
    s.deps.chatsDir = path.join(s.dir, "chats")
    await s.manager.start({ cwd: "x", kind: "chat", title: "hello there" })
    const chat = s.sdk.queries.at(-1)?.options.systemPrompt as { append?: string }
    expect(chat.append).toBe(CHAT_PROMPT)
    setProjects(projects)
    await s.manager.start({ cwd: path.join(projects, "code-one"), freshFolder: true })
    expect(
      (s.sdk.queries.at(-1)?.options.systemPrompt as { append?: string }).append,
    ).toBeUndefined()
  })
})
