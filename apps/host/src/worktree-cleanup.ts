import { execFile } from "node:child_process"
import fs from "node:fs"
import type { HostAudit } from "./hostaudit.js"
import type { WorktreeView, Worktrees } from "./worktrees.js"

/**
 * T-089 (t3code review, O31): worktrees cleaned up by rules you choose, all off until you turn them on: unchanged
 * (no commits of its own), merged (its branch is in the branch it came from) or inactive (nothing changed in it for
 * some days). Stricter than T3: a worktree with any uncommitted, untracked or ignored file (an .env, a build
 * output) is never removed by a rule, nor one a session works in. Only its folder goes, never its branch, and each
 * removal is recorded before it is done.
 */
export interface CleanupPolicy {
  unchanged?: boolean
  merged?: boolean
  /** Days without a change, 1 to 365. */
  inactiveDays?: number
}

export interface CleanupFacts {
  /** Any uncommitted, untracked or ignored file. */
  dirty: boolean
  /** Its branch is contained in the branch it came from. */
  merged: boolean
  /** When anything last changed: its newest commit or file. */
  lastChange: number
  open: boolean
}

/** Why a rule removes this worktree, or undefined to keep it. */
export function cleanupReason(w: WorktreeView, f: CleanupFacts, p: CleanupPolicy, now: number): string | undefined {
  if (!w.exists || f.open || f.dirty) return undefined
  if (p.unchanged && w.commits === 0) return "it has no commits of its own"
  if (p.merged && w.commits > 0 && f.merged) return `its branch is merged into ${w.baseName}`
  if (p.inactiveDays && now - f.lastChange > p.inactiveDays * 86_400_000)
    return `nothing changed in it for over ${p.inactiveDays} days`
  return undefined
}

const run = (cwd: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) =>
    execFile("git", args, { cwd, windowsHide: true, timeout: 60_000 }, (e, out) => (e ? reject(e) : resolve(String(out)))),
  )

/** What the rules need to know about one worktree, read from git; anything unreadable counts as dirty. */
export async function cleanupFacts(w: WorktreeView, open: boolean): Promise<CleanupFacts> {
  const dirty = await run(w.path, ["status", "--porcelain", "--ignored", "--untracked-files=all"])
    .then((s) => s.trim().length > 0)
    .catch(() => true)
  const merged = await run(w.repo, ["merge-base", "--is-ancestor", "--end-of-options", w.branch, w.baseName])
    .then(() => true)
    .catch(() => false)
  const commitAt = await run(w.path, ["log", "-1", "--format=%ct"])
    .then((s) => Number(s.trim()) * 1000 || 0)
    .catch(() => 0)
  let fileAt = 0
  try {
    fileAt = fs.statSync(w.path).mtimeMs
  } catch {
    // gone
  }
  return { dirty, merged, lastChange: Math.max(commitAt, fileAt, Date.parse(w.createdAt) || 0), open }
}

export interface CleanupResult {
  removed: Array<{ path: string; branch: string; why: string }>
  kept: Array<{ path: string; why: string }>
}

/** Applies the rules now: each removal recorded first; one that cannot be recorded or removed is kept. */
export async function cleanUp(
  worktrees: Pick<Worktrees, "list" | "remove">,
  p: CleanupPolicy,
  d: {
    open: (folder: string) => boolean
    audit: Pick<HostAudit, "record">
    channel: "desktop" | "host"
    now?: () => number
    facts?: typeof cleanupFacts
  },
): Promise<CleanupResult> {
  const out: CleanupResult = { removed: [], kept: [] }
  const now = (d.now ?? Date.now)()
  for (const w of await worktrees.list()) {
    const f = await (d.facts ?? cleanupFacts)(w, d.open(w.path))
    const why = cleanupReason(w, f, p, now)
    if (!why) {
      out.kept.push({
        path: w.path,
        why: !w.exists ? "its folder has gone" : f.open ? "a session works there" : f.dirty ? "it has uncommitted, untracked or ignored files" : "no rule applies",
      })
      continue
    }
    const recorded = await d.audit.record({
      session: d.channel,
      event: "worktree_cleaned_up",
      channel: d.channel,
      tool: "git",
      cwd: "",
      input: { path: w.path, branch: w.branch, why },
      verdict: {
        outcome: "allow",
        ruleId: "worktree-cleanup",
        reason: `A worktree was removed by your clean-up rules because ${why}. Its branch was kept.`,
        risk: 0,
        decidedBy: d.channel === "desktop" ? "human-desktop" : "rules",
        policyHash: "",
      },
      latencyMs: 0,
    })
    if (!recorded) {
      out.kept.push({ path: w.path, why: "it could not be recorded" })
      continue
    }
    try {
      await worktrees.remove(w.path)
      out.removed.push({ path: w.path, branch: w.branch, why })
    } catch (e) {
      out.kept.push({ path: w.path, why: (e as Error).message })
    }
  }
  return out
}
