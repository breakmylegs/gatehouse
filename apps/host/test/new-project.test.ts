import fs from "node:fs"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { SessionFolderError } from "../src/sessions.js"
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
