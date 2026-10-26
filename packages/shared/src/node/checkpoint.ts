import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

const run = promisify(execFile)

export interface CheckpointOptions {
  cwd: string
  sessionId: string
  label: string
  /** Globs (git pathspec glob syntax, case-insensitive) that are never captured, such as secrets files. */
  excludeGlobs?: readonly string[]
  now?: () => Date
}

export interface Checkpoint {
  ref: string
  commit: string
  label: string
  createdAt: string
  /** HEAD when the checkpoint was taken. Undefined in a repository with no commits yet. */
  base?: string
}

export class CheckpointError extends Error {}

const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: "Gatehouse",
  GIT_AUTHOR_EMAIL: "gatehouse@localhost",
  GIT_COMMITTER_NAME: "Gatehouse",
  GIT_COMMITTER_EMAIL: "gatehouse@localhost",
}

export function safeSegment(text: string): string {
  const cleaned = text.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "")
  return cleaned === "" ? "session" : cleaned.slice(0, 64)
}

function cleanLabel(label: string): string {
  const printable = [...label].map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? " " : c)).join("")
  return printable.replace(/\s+/g, " ").trim().slice(0, 200) || "checkpoint"
}

async function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<string> {
  try {
    const { stdout } = await run("git", args, {
      cwd,
      env: { ...process.env, ...GIT_IDENTITY, ...env },
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    })
    return stdout.trim()
  } catch (e) {
    const err = e as { stderr?: string; message: string }
    throw new CheckpointError(`git ${args[0]} failed: ${(err.stderr ?? err.message).trim().split("\n")[0]}`)
  }
}

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(".", "")
}

/**
 * Records the working tree as a commit under refs/gatehouse/checkpoints/<session>/<timestamp>
 * without touching the working tree, the real index or HEAD. It uses a throw-away index, so it
 * also captures untracked files, and honours .gitignore.
 */
export async function createCheckpoint(opts: CheckpointOptions): Promise<Checkpoint> {
  const now = (opts.now ?? (() => new Date()))()
  const label = cleanLabel(opts.label)
  const top = await git(opts.cwd, ["rev-parse", "--show-toplevel"])
  let base: string | undefined
  try {
    base = await git(top, ["rev-parse", "--verify", "HEAD"])
  } catch {
    base = undefined
  }

  const indexFile = path.join(os.tmpdir(), `gh-index-${process.pid}-${Math.random().toString(36).slice(2)}`)
  const env = { GIT_INDEX_FILE: indexFile }
  try {
    if (base) await git(top, ["read-tree", base], env)
    const pathspecs = (opts.excludeGlobs ?? []).map((g) => `:(exclude,glob,icase)${g}`)
    await git(top, ["add", "-A", "--", ".", ...pathspecs], env)
    const tree = await git(top, ["write-tree"], env)
    const commit = await git(
      top,
      ["commit-tree", tree, ...(base ? ["-p", base] : []), "-m", `gatehouse checkpoint: ${label}`],
      env,
    )
    const prefix = `refs/gatehouse/checkpoints/${safeSegment(opts.sessionId)}/${stamp(now)}`
    let ref = prefix
    for (let n = 2; n < 100; n++) {
      try {
        await git(top, ["rev-parse", "--verify", "--quiet", ref])
        ref = `${prefix}-${n}`
      } catch {
        break
      }
    }
    await git(top, ["update-ref", "--create-reflog", "-m", label, ref, commit])
    return { ref, commit, label, createdAt: now.toISOString(), ...(base ? { base } : {}) }
  } finally {
    fs.rmSync(indexFile, { force: true })
  }
}

/** Checkpoints for a session, newest first. */
export async function listCheckpoints(cwd: string, sessionId?: string): Promise<Checkpoint[]> {
  const top = await git(cwd, ["rev-parse", "--show-toplevel"])
  const scope = sessionId ? `refs/gatehouse/checkpoints/${safeSegment(sessionId)}/` : "refs/gatehouse/checkpoints/"
  const out = await git(top, [
    "for-each-ref",
    "--sort=-creatordate",
    "--format=%(refname)%09%(objectname)%09%(creatordate:iso-strict)%09%(contents:subject)",
    scope,
  ])
  if (out === "") return []
  return out.split("\n").map((line) => {
    const [ref = "", commit = "", createdAt = "", subject = ""] = line.split("\t")
    return { ref, commit, createdAt, label: subject.replace(/^gatehouse checkpoint: /, "") }
  })
}
