// E-051: two worktrees that edit the same lines are found to conflict within one cycle, with their files, against
// each other and against their base; a clean pair is not; and no working tree, index or branch is changed.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { ConflictWatch, conflictLine, findConflicts } from "../src/conflict-check.js"
import type { WorktreeRecord } from "../src/worktrees.js"

let dir: string
let repo: string
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim()
const rec = (name: string, baseName = "main"): WorktreeRecord => ({
  path: path.join(dir, name),
  branch: name,
  repo,
  base: "",
  baseName,
  createdAt: "",
})
function worktree(name: string, file: string, text: string): void {
  git(repo, "worktree", "add", "-q", "-b", name, path.join(dir, name), "main")
  fs.writeFileSync(path.join(dir, name, file), text)
  git(path.join(dir, name), "commit", "-qam", name)
}
/** Everything a check could change: each tree's status, its HEAD, every branch. */
const state = () => [repo, ...["a", "b", "c"].map((n) => path.join(dir, n))].map((p) => `${git(p, "status", "--porcelain")}|${git(p, "rev-parse", "HEAD")}`).join("\n") + git(repo, "for-each-ref")

beforeAll(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-conflicts-")))
  repo = path.join(dir, "repo")
  fs.mkdirSync(repo)
  git(repo, "init", "-q", "-b", "main")
  git(repo, "config", "user.email", "t@example.com")
  git(repo, "config", "user.name", "T")
  fs.writeFileSync(path.join(repo, "app.ts"), "line 1\nline 2\nline 3\n")
  fs.writeFileSync(path.join(repo, "other.ts"), "x\n")
  git(repo, "add", ".")
  git(repo, "commit", "-qm", "first")
  worktree("a", "app.ts", "line 1\nline two from a\nline 3\n")
  worktree("b", "app.ts", "line 1\nline two from b\nline 3\n")
  worktree("c", "other.ts", "y\n")
  // Uncommitted work in a worktree is left exactly as it is.
  fs.writeFileSync(path.join(dir, "c", "scratch.txt"), "mine\n")
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe("merge conflicts before merging (E-051)", () => {
  it("finds two worktrees editing the same lines within one cycle, naming the file, and leaves every tree as it was", async () => {
    const before = state()
    const told: unknown[] = []
    const watch = new ConflictWatch({ working: () => [rec("a"), rec("b"), rec("c")], onChange: (c) => told.push(c) })
    const found = await watch.check()
    expect(found).toEqual([expect.objectContaining({ branch: "a", with: "b", files: ["app.ts"], paths: [path.join(dir, "a"), path.join(dir, "b")] })])
    expect(conflictLine(found[0]!)).toBe("a and b would conflict in app.ts.")
    expect(told).toHaveLength(1)
    // The same result again is not told twice.
    await watch.check()
    expect(told).toHaveLength(1)
    expect(state()).toBe(before)
    // Many git calls, each slow on a busy Windows machine.
  }, 180_000)

  it("compares a branch with its base when the base moved, and with HEAD's branch for a worktree made from HEAD", async () => {
    fs.writeFileSync(path.join(repo, "other.ts"), "z\n")
    git(repo, "commit", "-qam", "main moves")
    const found = await findConflicts([rec("c"), rec("a", "HEAD")])
    expect(found).toEqual([expect.objectContaining({ branch: "c", with: "main", files: ["other.ts"], paths: [path.join(dir, "c")] })])
    expect(await findConflicts([rec("a"), { ...rec("gone"), branch: "gone" }])).toEqual([])
  })
})
