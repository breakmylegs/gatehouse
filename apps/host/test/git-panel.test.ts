// Backlog G36: history, blame, staging one change, and conflicts, from git itself; only the index ever changes.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Fastify from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  blame,
  changes,
  conflicts,
  history,
  markResolved,
  registerGitPanelRoutes,
  stageHunk,
} from "../src/git-panel.js"

let repo: string
const git = (...a: string[]) =>
  execFileSync("git", a, { cwd: repo, encoding: "utf8", windowsHide: true })
const write = (rel: string, text: string) => fs.writeFileSync(path.join(repo, rel), text)

beforeAll(() => {
  repo = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-gitpanel-")))
  git("init", "--quiet", "-b", "main")
  git("config", "user.email", "ada@example.com")
  git("config", "user.name", "Ada")
  write("a.txt", Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n") + "\n")
  git("add", ".")
  git("commit", "--quiet", "-m", "first")
})
afterAll(() => fs.rmSync(repo, { recursive: true, force: true }))

describe("the git panel", { timeout: 120_000 }, () => {
  it("shows the history as git draws it, and who last changed each line", async () => {
    write("b.txt", "b\n")
    git("add", ".")
    git("commit", "--quiet", "-m", "add b")
    const h = await history(repo)
    expect(h.map((l) => l.subject)).toEqual(["add b", "first"])
    expect(h[0]).toMatchObject({ author: "Ada", graph: expect.stringContaining("*") })
    const b = await blame(repo, "a.txt")
    expect(b).toHaveLength(20)
    expect(b[0]).toMatchObject({ line: 1, author: "Ada", summary: "first", text: "line 1" })
    await expect(blame(repo, "../outside")).rejects.toThrow(/not a path/)
    await expect(blame(repo, "--output=x")).rejects.toThrow(/not a path/)
  })

  it("stages one change of a file and leaves the other, then unstages it, never touching the file", async () => {
    const lines = fs.readFileSync(path.join(repo, "a.txt"), "utf8").split("\n")
    lines[1] = "line 2 changed"
    lines[17] = "line 18 changed"
    write("a.txt", lines.join("\n"))
    const before = fs.readFileSync(path.join(repo, "a.txt"), "utf8")
    let c = await changes(repo)
    expect(c.filter((f) => !f.staged)[0]?.hunks).toHaveLength(2)
    await stageHunk(repo, "a.txt", 1, false)
    expect(git("diff", "--cached")).toContain("+line 18 changed")
    expect(git("diff", "--cached")).not.toContain("+line 2 changed")
    c = await changes(repo)
    expect(c.find((f) => f.staged)?.hunks).toHaveLength(1)
    await stageHunk(repo, "a.txt", 0, true)
    expect(git("diff", "--cached")).toBe("")
    expect(fs.readFileSync(path.join(repo, "a.txt"), "utf8")).toBe(before)
    await expect(stageHunk(repo, "a.txt", 9, false)).rejects.toThrow(/not there any more/)
    git("checkout", "--quiet", "--", "a.txt")
  })

  it("lists a conflict, and marks it resolved only once no markers are left", async () => {
    git("checkout", "--quiet", "-b", "other")
    write("b.txt", "theirs\n")
    git("commit", "--quiet", "-am", "theirs")
    git("checkout", "--quiet", "main")
    write("b.txt", "ours\n")
    git("commit", "--quiet", "-am", "ours")
    try {
      git("merge", "other")
    } catch {
      // the conflict this test wants
    }
    expect(await conflicts(repo)).toEqual(["b.txt"])
    const marked = fs.readFileSync(path.join(repo, "b.txt"), "utf8")
    await expect(markResolved(repo, "b.txt", marked)).rejects.toThrow(/markers are still/)
    write("b.txt", "both\n")
    await markResolved(repo, "b.txt", "both\n")
    expect(await conflicts(repo)).toEqual([])
    await expect(markResolved(repo, "a.txt", "x")).rejects.toThrow(/no conflict/)
    git("merge", "--abort")
  })

  it("records a staging before doing it, and does nothing it cannot record", async () => {
    let canRecord = false
    const recorded: string[] = []
    const app = Fastify()
    registerGitPanelRoutes(app, {
      sessionCwd: (id) => (id === "s1" ? repo : undefined),
      audit: {
        record: async (r: { event: string }) => (recorded.push(r.event), canRecord),
      } as never,
    })
    write("a.txt", fs.readFileSync(path.join(repo, "a.txt"), "utf8").replace("line 5", "line five"))
    const stage = () =>
      app.inject({
        method: "POST",
        url: "/api/git/stage",
        payload: { session: "s1", path: "a.txt", index: 0 },
      })
    expect((await stage()).statusCode).toBe(503)
    expect(git("diff", "--cached")).toBe("")
    canRecord = true
    expect((await stage()).json()).toEqual({ ok: true })
    expect(git("diff", "--cached")).toContain("+line five")
    expect(recorded).toEqual(["git_staged", "git_staged"])
    const h = await app.inject({ method: "GET", url: "/api/git/history?session=s1" })
    expect(h.json().lines.length).toBeGreaterThan(0)
    expect(
      (await app.inject({ method: "GET", url: "/api/git/history?session=zz" })).statusCode,
    ).toBe(404)
    git("reset", "--quiet")
    git("checkout", "--quiet", "--", "a.txt")
    await app.close()
  })
})
