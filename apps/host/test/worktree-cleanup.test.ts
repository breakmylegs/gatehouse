// T-089 (t3code review): worktrees removed by your rules, all off until chosen. Never one with an uncommitted,
// untracked or ignored file, nor one a session works in; each removal recorded first, and kept if it cannot be.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { cleanupFacts, cleanupReason, cleanUp, type CleanupFacts } from "../src/worktree-cleanup.js"
import type { WorktreeView } from "../src/worktrees.js"

const DAY = 86_400_000
const view = (o: Partial<WorktreeView> = {}): WorktreeView =>
  ({ path: "C:/wt/a", branch: "fix/a-123", repo: "C:/repo", base: "abc", baseName: "main", createdAt: "2026-11-01T00:00:00Z", exists: true, bytes: 1, changed: 0, commits: 0, ...o }) as WorktreeView
const facts = (o: Partial<CleanupFacts> = {}): CleanupFacts => ({ dirty: false, merged: false, lastChange: 0, open: false, ...o })

describe("worktree clean-up rules (T-089)", () => {
  it("removes only by a chosen rule, and never a dirty or open worktree", () => {
    const now = 100 * DAY
    expect(cleanupReason(view(), facts(), {}, now)).toBeUndefined()
    expect(cleanupReason(view(), facts(), { unchanged: true }, now)).toBe("it has no commits of its own")
    expect(cleanupReason(view({ commits: 2 }), facts({ merged: true }), { merged: true }, now)).toBe("its branch is merged into main")
    expect(cleanupReason(view({ commits: 2 }), facts({ lastChange: now - 31 * DAY }), { inactiveDays: 30 }, now)).toMatch(/over 30 days/)
    expect(cleanupReason(view({ commits: 2 }), facts({ lastChange: now - 29 * DAY }), { inactiveDays: 30 }, now)).toBeUndefined()
    for (const f of [facts({ dirty: true }), facts({ open: true })])
      expect(cleanupReason(view(), f, { unchanged: true, merged: true, inactiveDays: 1 }, now)).toBeUndefined()
  })

  it("records each removal first, and keeps one it cannot record", async () => {
    const removed: string[] = []
    const records: unknown[] = []
    let ok = true
    const wts = { list: async () => [view({ path: "a" }), view({ path: "b" })], remove: async (p: string) => (removed.push(p), view({ path: p })) }
    const d = { open: () => false, audit: { record: async (r: unknown) => (records.push(r), ok) }, channel: "desktop" as const, facts: async () => facts() }
    let r = await cleanUp(wts, { unchanged: true }, d)
    expect(r.removed.map((x) => x.path)).toEqual(["a", "b"])
    expect(records).toHaveLength(2)
    ok = false
    removed.length = 0
    r = await cleanUp(wts, { unchanged: true }, d)
    expect(removed).toEqual([])
    expect(r.kept.map((k) => k.why)).toEqual(["it could not be recorded", "it could not be recorded"])
  })
})

describe("reading a real worktree (T-089)", { timeout: 120_000 }, () => {
  let repo: string
  const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", windowsHide: true })
  beforeAll(() => {
    repo = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-cleanup-")))
    git(repo, "init", "--quiet", "-b", "main")
    git(repo, "config", "user.email", "ada@example.com")
    git(repo, "config", "user.name", "Ada")
    fs.writeFileSync(path.join(repo, ".gitignore"), ".env\n")
    git(repo, "add", ".")
    git(repo, "commit", "--quiet", "-m", "first")
    git(repo, "worktree", "add", "--quiet", "-b", "fix/x", path.join(repo, "..", path.basename(repo) + "-wt"), "main")
  })
  afterAll(() => {
    fs.rmSync(path.join(repo, "..", path.basename(repo) + "-wt"), { recursive: true, force: true })
    fs.rmSync(repo, { recursive: true, force: true })
  })

  it("counts an ignored file such as .env as dirty, and sees a merged branch", async () => {
    const wt = path.join(repo, "..", path.basename(repo) + "-wt")
    const w = view({ path: wt, repo, branch: "fix/x", baseName: "main" })
    expect((await cleanupFacts(w, false)).dirty).toBe(false)
    expect((await cleanupFacts(w, false)).merged).toBe(true)
    fs.writeFileSync(path.join(wt, ".env"), "KEY=1\n")
    expect((await cleanupFacts(w, false)).dirty).toBe(true)
    fs.rmSync(path.join(wt, ".env"))
  })
})
