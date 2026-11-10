// Backlog G14: merging a worktree's branch back, after seeing what it brings, never over uncommitted work, never half.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Fastify from "fastify"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mergeBack, previewMerge } from "../src/worktree-merge.js"
import { registerWorktreeRoutes, Worktrees, type WorktreeRecord } from "../src/worktrees.js"

let dir: string
let repo: string
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim()

beforeEach(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-merge-")))
  repo = path.join(dir, "shop")
  fs.mkdirSync(repo)
  git(repo, "init", "--quiet", "-b", "main")
  git(repo, "config", "user.email", "test@example.com")
  git(repo, "config", "user.name", "Test")
  fs.writeFileSync(path.join(repo, "a.txt"), "one\n")
  git(repo, "add", ".")
  git(repo, "commit", "--quiet", "-m", "first")
})
afterEach(() => {
  try {
    git(repo, "worktree", "prune")
  } catch {
    // gone
  }
  fs.rmSync(dir, { recursive: true, force: true })
})

async function worktreeWithCommit(file: string, text: string): Promise<WorktreeRecord> {
  const w = await new Worktrees(path.join(dir, "data")).create(repo)
  git(w.path, "config", "user.email", "test@example.com")
  git(w.path, "config", "user.name", "Test")
  fs.writeFileSync(path.join(w.path, file), text)
  git(w.path, "add", ".")
  git(w.path, "commit", "--quiet", "-m", `add ${file}`)
  return w
}

// Real git, several worktrees a test: slow when the machine is busy.
describe("merging a worktree back", { timeout: 180_000 }, () => {
  it("shows its commits and diff first, then merges into the checkout's branch", async () => {
    const w = await worktreeWithCommit("b.txt", "from the worktree\n")
    const p = await previewMerge(w)
    expect(p).toMatchObject({ into: "main", branch: w.branch, uncommitted: 0, checkoutDirty: 0 })
    expect(p.commits.map((c) => c.subject)).toEqual(["add b.txt"])
    expect(p.diff).toContain("+from the worktree")
    expect(await mergeBack(w, p)).toEqual({ into: "main", commits: 1 })
    expect(fs.readFileSync(path.join(repo, "b.txt"), "utf8").trim()).toBe("from the worktree")
  })

  it("refuses over uncommitted work, a moved checkout or branch, or with nothing to bring", async () => {
    const w = await worktreeWithCommit("b.txt", "x\n")
    const p = await previewMerge(w)
    fs.writeFileSync(path.join(repo, "a.txt"), "yours, not committed\n")
    await expect(mergeBack(w, p)).rejects.toThrow(/not committed/)
    git(repo, "checkout", "--quiet", "--", "a.txt")
    await expect(mergeBack(w, { ...p, into: "release" })).rejects.toThrow(/now on main/)
    // A session committed again after you looked: that commit is not merged unseen.
    fs.writeFileSync(path.join(w.path, "c.txt"), "later\n")
    git(w.path, "add", ".")
    git(w.path, "commit", "--quiet", "-m", "later")
    await expect(mergeBack(w, p)).rejects.toThrow(/new commits since you looked/)
    const empty = await new Worktrees(path.join(dir, "data")).create(repo)
    await expect(mergeBack(empty, await previewMerge(empty))).rejects.toThrow(/nothing/)
    expect(fs.existsSync(path.join(repo, "b.txt"))).toBe(false)
  })

  it("undoes a merge that meets a conflict, leaving the checkout as it was", async () => {
    const w = await worktreeWithCommit("a.txt", "theirs\n")
    fs.writeFileSync(path.join(repo, "a.txt"), "ours\n")
    git(repo, "commit", "--quiet", "-am", "ours")
    await expect(mergeBack(w, await previewMerge(w))).rejects.toThrow(/conflict, so it was undone/)
    expect(git(repo, "status", "--porcelain")).toBe("")
    expect(fs.readFileSync(path.join(repo, "a.txt"), "utf8").trim()).toBe("ours")
  })

  it("is recorded before it merges, and not merged when it cannot be recorded", async () => {
    const wts = new Worktrees(path.join(dir, "data"))
    const w = await worktreeWithCommit("b.txt", "x\n")
    const recorded: string[] = []
    let canRecord = false
    const app = Fastify()
    registerWorktreeRoutes(app, {
      worktrees: wts,
      audit: { record: async (r: { event: string }) => (recorded.push(r.event), canRecord) } as never,
    })
    const preview = await app.inject({
      method: "GET",
      url: `/api/worktrees/merge-preview?path=${encodeURIComponent(w.path)}`,
    })
    const { into, tip } = preview.json() as { into: string; tip: string }
    expect(into).toBe("main")
    let r = await app.inject({ method: "POST", url: "/api/worktrees/merge", payload: { path: w.path, into, tip } })
    expect(r.statusCode).toBe(503)
    expect(fs.existsSync(path.join(repo, "b.txt"))).toBe(false)
    r = await app.inject({ method: "POST", url: "/api/worktrees/merge", payload: { path: w.path } })
    expect(r.statusCode).toBe(422)
    r = await app.inject({
      method: "POST",
      url: "/api/worktrees/merge",
      payload: { path: path.join(dir, "elsewhere"), into, tip },
    })
    expect(r.statusCode).toBe(404)
    canRecord = true
    r = await app.inject({ method: "POST", url: "/api/worktrees/merge", payload: { path: w.path, into, tip } })
    expect(r.json()).toEqual({ into: "main", commits: 1 })
    expect(recorded).toEqual(["worktree_merged", "worktree_merged"])
    await app.close()
  })
})
