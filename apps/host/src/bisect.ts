/**
 * E-044, a bisect assistant (Expansion E4). git bisect is run with a check command in a scratch worktree of the
 * project (a detached `git worktree add` in the temporary folder, so the bisect's refs and checkout are that worktree's
 * own and your working tree is never touched). `git bisect start` and `git bisect run <check>` run as Codehouse actions,
 * judged by the rules and recorded. The first bad commit is reported with its subject and, when it has one, its
 * Codehouse session note (D-030).
 *
 * Junction-safe deletion: the project's node_modules is linked into the worktree so the check can run; on the way out
 * each link is removed by itself first (never followed), and only then the worktree, so nothing it pointed to is
 * touched. (A plain recursive delete of a folder holding a junction can follow it on Windows.)
 */
import crypto from "node:crypto"
import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { sessionNotes } from "./slsa.js"

/** Folders linked into the worktree so the check can run. */
export const LINKED = ["node_modules"]

export type BisectRun = (command: string, cwd: string) => Promise<{ ran: boolean; exitCode: number | null; output: string; refused?: string }>

const git = (args: string[], cwd: string) =>
  new Promise<string>((resolve, reject) => execFile("git", args, { cwd, windowsHide: true, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 }, (e, out, err) => (e ? reject(new Error(String(err || e.message).trim())) : resolve(String(out)))))

/** A commit name that can only be a commit name: no spaces, quotes or shell characters. */
export const safeRef = (r: string) => /^[\w./~^@{}-]{1,200}$/.test(r) && !r.startsWith("-")

/** Removes a scratch worktree: its links first, each by itself, then the folder, then git's record of it. */
export async function removeScratch(root: string, dir: string): Promise<void> {
  for (const d of LINKED) {
    const p = path.join(dir, d)
    try {
      const st = fs.lstatSync(p)
      if (st.isSymbolicLink()) fs.unlinkSync(p)
      else if (process.platform === "win32" && st.isDirectory() && fs.readlinkSync(p)) fs.rmdirSync(p)
    } catch {
      // Not there, or not a link.
    }
  }
  // Nothing linked is left, so removing the folder cannot reach outside it.
  await git(["worktree", "remove", "--force", dir], root).catch(() => undefined)
  fs.rmSync(dir, { recursive: true, force: true })
  await git(["worktree", "prune"], root).catch(() => undefined)
}

export interface BisectResult {
  first?: { sha: string; subject: string; session?: string }
  steps: number
  notFound?: string
}

/** Finds the first bad commit between a good and a bad one, with a check command; your working tree is not touched. */
export async function bisect(root: string, good: string, bad: string, check: string, run: BisectRun): Promise<BisectResult> {
  if (!safeRef(good) || !safeRef(bad)) return { steps: 0, notFound: "Give the good and bad commits as plain names or hashes." }
  const dir = path.join(os.tmpdir(), `codeh-bisect-${crypto.randomBytes(4).toString("hex")}`)
  try {
    await git(["worktree", "add", "--detach", dir, bad], root)
    for (const d of LINKED) {
      const from = path.join(root, d)
      if (fs.existsSync(from) && !fs.existsSync(path.join(dir, d))) fs.symlinkSync(from, path.join(dir, d), "junction")
    }
    const start = await run(`git bisect start ${bad} ${good}`, dir)
    if (!start.ran) return { steps: 0, notFound: `git bisect was not started: ${start.refused ?? "refused"}` }
    if (start.exitCode !== 0) return { steps: 0, notFound: `git bisect could not start: ${start.output.trim().split("\n").slice(-1)[0] ?? ""}` }
    const r = await run(`git bisect run ${check}`, dir)
    if (!r.ran) return { steps: 0, notFound: `the check was not run: ${r.refused ?? "refused"}` }
    const steps = (r.output.match(/^running /gim) ?? []).length
    const sha = /\b([0-9a-f]{40}) is the first bad commit/.exec(r.output)?.[1]
    if (!sha) return { steps, notFound: `git bisect did not name a first bad commit: ${r.output.trim().split("\n").slice(-2).join(" ").slice(0, 300)}` }
    const subject = (await git(["log", "-1", "--format=%s", sha], root)).trim()
    const note = sessionNotes(root, `${sha}^!`)[0]
    return { first: { sha, subject, ...(note ? { session: note.session } : {}) }, steps }
  } catch (e) {
    return { steps: 0, notFound: (e as Error).message.slice(0, 300) }
  } finally {
    await git(["bisect", "reset"], dir).catch(() => undefined)
    await removeScratch(root, dir)
  }
}
