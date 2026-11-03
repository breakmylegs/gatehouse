// B10: a coding session can work in a git worktree of its own, beside the repository, on a new branch; the cleanup
// panel removes only worktrees Codehouse made, keeps their branches, and keeps one with uncommitted work unless told.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Fastify from "fastify"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { registerWorktreeRoutes, Worktrees } from "../src/worktrees.js"
import { buildStack, type Stack } from "./stack.js"

let dir: string
let repo: string
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim()

beforeEach(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-wt-")))
  repo = path.join(dir, "shop")
  fs.mkdirSync(repo)
  git(repo, "init", "--quiet", "-b", "main")
  git(repo, "config", "user.email", "test@example.com")
  git(repo, "config", "user.name", "Test")
  fs.writeFileSync(path.join(repo, "README.md"), "shop\n")
  git(repo, "add", ".")
  git(repo, "commit", "--quiet", "-m", "first")
  git(repo, "branch", "release")
  fs.writeFileSync(path.join(repo, "later.txt"), "later\n")
  git(repo, "add", ".")
  git(repo, "commit", "--quiet", "-m", "second")
})
afterEach(() => {
  try {
    git(repo, "worktree", "prune")
  } catch {
    // gone
  }
  fs.rmSync(dir, { recursive: true, force: true })
})

describe("making a worktree", () => {
  it("puts it beside the repository on a new branch, from its current commit, and records it", async () => {
    const wts = new Worktrees(path.join(dir, "data"))
    const w = await wts.create(path.join(repo))
    expect(path.dirname(w.path)).toBe(path.join(dir, "shop.worktrees"))
    expect(w.branch).toMatch(/^codehouse\/\d{4}-\d{2}-\d{2}-[0-9a-f]{6}$/)
    expect(git(w.path, "rev-parse", "--abbrev-ref", "HEAD")).toBe(w.branch)
    // Git on Windows may turn line endings into CRLF on checkout.
    expect(fs.readFileSync(path.join(w.path, "later.txt"), "utf8").trim()).toBe("later")
    expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main")
    const [v] = await wts.list()
    expect(v).toMatchObject({
      path: w.path,
      exists: true,
      changed: 0,
      commits: 0,
      baseName: "HEAD",
    })
    expect(v!.bytes).toBeGreaterThan(0)
  })

  it("starts from the branch you name, and refuses an option, a name that is not there, or a folder outside git", async () => {
    const wts = new Worktrees(path.join(dir, "data"))
    const w = await wts.create(repo, "release")
    expect(fs.existsSync(path.join(w.path, "later.txt"))).toBe(false)
    // Only characters a name may have, but an option to git: refused before git sees it.
    await expect(wts.create(repo, "--orphan")).rejects.toThrow(/not a branch, tag or commit/)
    await expect(wts.create(repo, "--upload-pack=calc")).rejects.toThrow(
      /not a branch, tag or commit/,
    )
    await expect(wts.create(repo, "no-such-branch")).rejects.toThrow(/no branch, tag or commit/)
    const plain = path.join(dir, "plain")
    fs.mkdirSync(plain)
    await expect(wts.create(plain)).rejects.toThrow(/not in a git repository/)
    expect(wts.records()).toHaveLength(1)
  })
})

describe("removing a worktree", () => {
  it("keeps one with uncommitted work unless told, keeps the branch, and never touches a folder it did not make", async () => {
    const wts = new Worktrees(path.join(dir, "data"))
    const w = await wts.create(repo)
    fs.writeFileSync(path.join(w.path, "work.txt"), "not committed")
    expect((await wts.list())[0]).toMatchObject({ changed: 1 })
    await expect(wts.remove(w.path)).rejects.toThrow(/1 changed file not committed/)
    expect(fs.existsSync(w.path)).toBe(true)
    await expect(wts.remove(repo)).rejects.toThrow(/did not make/)
    await wts.remove(w.path, { force: true })
    expect(fs.existsSync(w.path)).toBe(false)
    expect(git(repo, "branch", "--list", w.branch)).toContain(w.branch)
    expect(wts.records()).toEqual([])
  })

  it("from the panel: records each removal first, and refuses one a session is working in", async () => {
    const wts = new Worktrees(path.join(dir, "data"))
    const w = await wts.create(repo)
    const recorded: string[] = []
    let open = true
    let canRecord = true
    const app = Fastify()
    registerWorktreeRoutes(app, {
      worktrees: wts,
      audit: {
        record: async (r: { event: string }) => (recorded.push(r.event), canRecord),
      } as never,
      openIn: () => open,
    })
    // Not recorded, not removed.
    open = false
    canRecord = false
    const unrecorded = await app.inject({
      method: "POST",
      url: "/api/worktrees/remove",
      payload: { path: w.path },
    })
    expect(unrecorded.statusCode).toBe(503)
    expect(fs.existsSync(w.path)).toBe(true)
    recorded.length = 0
    canRecord = true
    open = true
    const list = await app.inject({ method: "GET", url: "/api/worktrees" })
    expect(list.json().worktrees[0]).toMatchObject({ path: w.path, open: true })
    let r = await app.inject({
      method: "POST",
      url: "/api/worktrees/remove",
      payload: { path: w.path },
    })
    expect(r.statusCode).toBe(409)
    expect(fs.existsSync(w.path)).toBe(true)
    open = false
    r = await app.inject({
      method: "POST",
      url: "/api/worktrees/remove",
      payload: { path: w.path },
    })
    expect(r.json()).toMatchObject({ removed: w.path, branch: w.branch })
    expect(recorded).toEqual(["worktree_removed"])
    await app.close()
  })
})

describe("a session in a worktree", () => {
  let s: Stack
  afterEach(async () => s?.stop())

  it("works in the worktree, says so, and the making is recorded", async () => {
    s = await buildStack({ config: {} })
    s.deps.worktrees = new Worktrees(path.join(dir, "data"))
    const session = await s.manager.start({ cwd: repo, worktree: {} })
    const w = s.deps.worktrees.records()[0]!
    expect(session.cwd).toBe(w.path)
    expect(s.sdk.queries.at(-1)?.options.cwd).toBe(w.path)
    expect(session.info().worktree).toEqual({ branch: w.branch, repo })
    await session.close()
  })
})
