/**
 * E-051 (expansion): a merge conflict seen before anyone merges. While sessions work in worktrees, Codehouse tries
 * each worktree's branch against the branch it came from, and against every other worktree's branch from the same
 * repository, with `git merge-tree --write-tree`. That merges in git's object store only: no working tree, index or
 * branch is touched. A pair that would conflict is reported with its files, for the dashboard and both sessions.
 * Only what is committed is compared (uncommitted work is not in a branch yet), and a git too old for merge-tree's
 * --write-tree (before 2.38) reports nothing rather than guessing.
 */
import { execFile } from "node:child_process"
import type { WorktreeRecord } from "./worktrees.js"

export interface Conflict {
  repo: string
  /** The two branches that would conflict; `with` is a base branch or another worktree's branch. */
  branch: string
  with: string
  files: string[]
  /** The worktree folders involved, so the sessions working there can be told. */
  paths: string[]
}

export type RunGit = (cwd: string, args: string[]) => Promise<{ code: number; stdout: string }>

export const runGit: RunGit = (cwd, args) =>
  new Promise((resolve) => {
    execFile("git", args, { cwd, windowsHide: true, timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }, (e, stdout) => {
      const code = e ? (typeof (e as { code?: unknown }).code === "number" ? ((e as { code: number }).code) : -1) : 0
      resolve({ code, stdout: String(stdout ?? "") })
    })
  })

/** The files two branches would conflict in; [] when they merge cleanly; undefined when git cannot say. */
export async function conflictFiles(repo: string, a: string, b: string, run: RunGit = runGit): Promise<string[] | undefined> {
  const r = await run(repo, ["merge-tree", "--write-tree", "--name-only", "--no-messages", "--end-of-options", a, b])
  if (r.code === 0) return []
  // Exit 1 is "conflicts": the tree on the first line, then each conflicted file.
  if (r.code !== 1) return undefined
  const lines = r.stdout.split(/\r?\n/).filter(Boolean)
  return /^[0-9a-f]{40,64}$/.test(lines[0] ?? "") ? [...new Set(lines.slice(1))] : undefined
}

/** A branch name that resolves in the repository; undefined when it does not (gone, or never a branch). */
async function resolves(repo: string, ref: string, run: RunGit): Promise<boolean> {
  return (await run(repo, ["rev-parse", "--verify", "--quiet", "--end-of-options", `refs/heads/${ref}`])).code === 0
}

/**
 * Each pair among these worktrees that would conflict: each branch with its base branch (when that is a branch that
 * still exists), and each two branches from the same repository.
 */
export async function findConflicts(records: readonly WorktreeRecord[], run: RunGit = runGit): Promise<Conflict[]> {
  const out: Conflict[] = []
  const byRepo = new Map<string, WorktreeRecord[]>()
  for (const r of records) byRepo.set(r.repo, [...(byRepo.get(r.repo) ?? []), r])
  for (const [repo, list] of byRepo) {
    const live: WorktreeRecord[] = []
    for (const r of list) if (await resolves(repo, r.branch, run)) live.push(r)
    // A worktree made from HEAD came from the branch the repository has checked out.
    const checkedOut = (await run(repo, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim()
    for (const r of live) {
      const base = r.baseName === "HEAD" ? checkedOut : r.baseName
      if (!base || base === "HEAD" || base === r.branch || !(await resolves(repo, base, run))) continue
      const files = await conflictFiles(repo, base, r.branch, run)
      if (files?.length) out.push({ repo, branch: r.branch, with: base, files, paths: [r.path] })
    }
    for (let i = 0; i < live.length; i++)
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i]!
        const b = live[j]!
        const files = await conflictFiles(repo, a.branch, b.branch, run)
        if (files?.length) out.push({ repo, branch: a.branch, with: b.branch, files, paths: [a.path, b.path] })
      }
  }
  return out
}

/** A short line for a session or the dashboard: the branches and up to five files. */
export function conflictLine(c: Conflict): string {
  const shown = c.files.slice(0, 5).join(", ")
  const more = c.files.length > 5 ? ` and ${c.files.length - 5} more` : ""
  return `${c.branch} and ${c.with} would conflict in ${shown}${more}.`
}

/**
 * Checks the worktrees sessions are working in, every so often, and says when what conflicts changes. Nothing runs
 * while no session works in a worktree.
 */
export class ConflictWatch {
  #timer: NodeJS.Timeout | undefined
  #last = "[]"
  #current: Conflict[] = []
  #running = false

  constructor(
    private readonly o: {
      /** The worktrees a session is working in now. */
      working: () => WorktreeRecord[]
      onChange: (conflicts: Conflict[]) => void
      everyMs?: number
      run?: RunGit
    },
  ) {}

  get conflicts(): Conflict[] {
    return this.#current
  }

  start(): void {
    if (this.#timer) return
    this.#timer = setInterval(() => void this.check(), this.o.everyMs ?? 5 * 60_000)
    this.#timer.unref?.()
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = undefined
  }

  /** One cycle: what conflicts now, told only when it differs from the last cycle. */
  async check(): Promise<Conflict[]> {
    if (this.#running) return this.#current
    this.#running = true
    try {
      const working = this.o.working()
      const found = working.length > 1 || working.some((w) => w.baseName) ? await findConflicts(working, this.o.run) : []
      const key = JSON.stringify(found)
      this.#current = found
      if (key !== this.#last) {
        this.#last = key
        this.o.onChange(found)
      }
      return found
    } catch {
      return this.#current
    } finally {
      this.#running = false
    }
  }
}
