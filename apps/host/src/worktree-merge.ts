/**
 * Merge back (backlog G14): a worktree's branch merged into the checkout it was made from, only after you have seen
 * what it brings and said yes, and only when that checkout has nothing uncommitted, so your own work is never mixed in.
 * A merge that meets a conflict is undone at once (git merge --abort) and says so: nothing is left half merged.
 * Git runs without a shell, every argument fixed or checked.
 */
import { execFile } from "node:child_process"
import type { WorktreeRecord } from "./worktrees.js"

export class MergeError extends Error {}

type Git = (cwd: string, args: string[]) => Promise<string>

const git: Git = (cwd, args) =>
  new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, windowsHide: true, timeout: 120_000, maxBuffer: 32 * 1024 * 1024 },
      (e, stdout, stderr) =>
        e ? reject(new MergeError(String(stderr || e.message).trim().slice(0, 500))) : resolve(String(stdout)),
    )
  })

/** The most of a diff shown before merging. */
const MAX_DIFF = 400_000

export interface MergePreview {
  /** The branch the worktree's commits go into: the checkout's own branch now. */
  into: string
  branch: string
  /** The branch's last commit as shown: the merge takes exactly this, so later commits are not merged unseen. */
  tip: string
  commits: Array<{ hash: string; subject: string }>
  /** git diff --stat, and the diff itself (cut short past MAX_DIFF). */
  stat: string
  diff: string
  truncated: boolean
  /** The worktree has changes not committed: they are not part of the merge. */
  uncommitted: number
  /** The checkout has changes not committed: merging is refused until they are committed or put away. */
  checkoutDirty: number
}

const count = (s: string) => s.split(/\r?\n/).filter(Boolean).length

async function tipOf(rec: WorktreeRecord, run: Git): Promise<string> {
  const tip = (
    await run(rec.repo, ["rev-parse", "--verify", "--quiet", "--end-of-options", `refs/heads/${rec.branch}`])
  ).trim()
  if (!/^[0-9a-f]{40,64}$/.test(tip)) throw new MergeError(`The branch ${rec.branch} has gone.`)
  return tip
}

export async function previewMerge(rec: WorktreeRecord, run: Git = git): Promise<MergePreview> {
  const into = (await run(rec.repo, ["rev-parse", "--abbrev-ref", "HEAD"])).trim()
  const tip = await tipOf(rec, run)
  // What the branch has that the checkout's branch does not, from where they parted.
  const range = `${into}...${tip}`
  const log = await run(rec.repo, ["log", "--format=%h%x09%s", `${into}..${tip}`])
  const stat = await run(rec.repo, ["diff", "--stat", "--no-color", range])
  const whole = await run(rec.repo, ["diff", "--no-color", "--no-ext-diff", range])
  return {
    into,
    branch: rec.branch,
    tip,
    commits: log
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => {
        const [hash, ...rest] = l.split("\t")
        return { hash: hash ?? "", subject: rest.join("\t") }
      }),
    stat: stat.trim(),
    diff: whole.length > MAX_DIFF ? whole.slice(0, MAX_DIFF) : whole,
    truncated: whole.length > MAX_DIFF,
    uncommitted: await run(rec.path, ["status", "--porcelain"]).then(count, () => 0),
    checkoutDirty: await run(rec.repo, ["status", "--porcelain", "--untracked-files=no"]).then(count),
  }
}

/**
 * Merges the branch into the checkout's branch, exactly as previewed (same branch to merge into, same last commit).
 * Refuses a dirty checkout; aborts on a conflict.
 */
export async function mergeBack(
  rec: WorktreeRecord,
  seen: { into: string; tip: string },
  run: Git = git,
): Promise<{ into: string; commits: number }> {
  const into = (await run(rec.repo, ["rev-parse", "--abbrev-ref", "HEAD"])).trim()
  if (into !== seen.into)
    throw new MergeError(
      `The checkout is now on ${into}, not ${seen.into} as when you looked. Look again before merging.`,
    )
  if (into === "HEAD") throw new MergeError("The checkout is not on a branch, so there is nothing to merge into.")
  const tip = await tipOf(rec, run)
  if (tip !== seen.tip)
    throw new MergeError(`${rec.branch} has new commits since you looked. Look again before merging.`)
  const dirty = count(await run(rec.repo, ["status", "--porcelain", "--untracked-files=no"]))
  if (dirty)
    throw new MergeError(
      `Your checkout has ${dirty === 1 ? "1 change" : `${dirty} changes`} not committed. Commit or stash ${dirty === 1 ? "it" : "them"} first, so they are not mixed into the merge.`,
    )
  const commits = count(await run(rec.repo, ["rev-list", `${into}..${tip}`]))
  if (!commits) throw new MergeError(`${rec.branch} has nothing that ${into} does not already have.`)
  try {
    await run(rec.repo, ["merge", "--no-ff", "--no-edit", "-m", `Merge ${rec.branch} into ${into}`, "--", tip])
  } catch (e) {
    await run(rec.repo, ["merge", "--abort"]).catch(() => undefined)
    throw new MergeError(
      `The merge met a conflict, so it was undone and nothing changed. Merge it yourself, or ask a session to: ${(e as Error).message.slice(0, 200)}`,
    )
  }
  return { into, commits }
}
