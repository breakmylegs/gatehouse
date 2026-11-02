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

const REF_PREFIX = "refs/gatehouse/checkpoints/"

export function safeSegment(text: string): string {
  const cleaned = text.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "")
  return cleaned === "" ? "session" : cleaned.slice(0, 64)
}

function cleanLabel(label: string): string {
  const printable = [...label]
    .map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? " " : c))
    .join("")
  return printable.replace(/\s+/g, " ").trim().slice(0, 200) || "checkpoint"
}

async function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<string> {
  try {
    const { stdout } = await run("git", args, {
      cwd,
      env: { ...process.env, ...GIT_IDENTITY, ...env },
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    })
    return stdout.trim()
  } catch (e) {
    const err = e as { stderr?: string; message: string }
    throw new CheckpointError(
      `git ${args[0]} failed: ${(err.stderr ?? err.message).trim().split("\n")[0]}`,
    )
  }
}

/** Like git(), but returns stdout exactly as git wrote it (needed for -z output). */
async function gitRaw(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<string> {
  try {
    const { stdout } = await run("git", args, {
      cwd,
      env: { ...process.env, ...GIT_IDENTITY, ...env },
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    })
    return stdout
  } catch (e) {
    const err = e as { stderr?: string; message: string }
    throw new CheckpointError(
      `git ${args[0]} failed: ${(err.stderr ?? err.message).trim().split("\n")[0]}`,
    )
  }
}

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(".", "")
}

async function repoTop(cwd: string): Promise<string> {
  return git(cwd, ["rev-parse", "--show-toplevel"])
}

async function headOf(top: string): Promise<string | undefined> {
  try {
    return await git(top, ["rev-parse", "--verify", "HEAD"])
  } catch {
    return undefined
  }
}

/**
 * Builds a tree of the working tree (tracked changes, untracked files, no ignored files, none of
 * excludeGlobs) in a throw-away index, so the real index and working tree are never touched.
 */
async function snapshotTree(
  top: string,
  base: string | undefined,
  excludeGlobs: readonly string[] | undefined,
): Promise<string> {
  const indexFile = path.join(
    os.tmpdir(),
    `gh-index-${process.pid}-${Math.random().toString(36).slice(2)}`,
  )
  const env = { GIT_INDEX_FILE: indexFile }
  try {
    if (base) await git(top, ["read-tree", base], env)
    const pathspecs = (excludeGlobs ?? []).map((g) => `:(exclude,glob,icase)${g}`)
    await git(top, ["add", "-A", "--", ".", ...pathspecs], env)
    return await git(top, ["write-tree"], env)
  } finally {
    fs.rmSync(indexFile, { force: true })
  }
}

/**
 * Records the working tree as a commit under refs/gatehouse/checkpoints/<session>/<timestamp>
 * without touching the working tree, the real index or HEAD. It uses a throw-away index, so it
 * also captures untracked files, and honours .gitignore.
 */
export async function createCheckpoint(opts: CheckpointOptions): Promise<Checkpoint> {
  const now = (opts.now ?? (() => new Date()))()
  const label = cleanLabel(opts.label)
  const top = await repoTop(opts.cwd)
  const base = await headOf(top)
  const tree = await snapshotTree(top, base, opts.excludeGlobs)
  const commit = await git(top, [
    "commit-tree",
    tree,
    ...(base ? ["-p", base] : []),
    "-m",
    `gatehouse checkpoint: ${label}`,
  ])
  const prefix = `${REF_PREFIX}${safeSegment(opts.sessionId)}/${stamp(now)}`
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
}

/** Checkpoints for a session, newest first. */
export async function listCheckpoints(cwd: string, sessionId?: string): Promise<Checkpoint[]> {
  const top = await repoTop(cwd)
  const scope = sessionId ? `${REF_PREFIX}${safeSegment(sessionId)}/` : REF_PREFIX
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

export type FileChange = "added" | "modified" | "deleted"

export interface RestorePreview {
  ref: string
  commit: string
  /** What restoring would do: "added" means the file comes back, "deleted" means a file made since is removed. */
  changes: { path: string; change: FileChange }[]
  /** Unified diff from the current state to the checkpoint, cut at 200 KB. */
  diff: string
  truncated: boolean
}

const MAX_DIFF_CHARS = 200_000

function assertOurRef(ref: string): void {
  if (!ref.startsWith(REF_PREFIX) || ref.includes("..") || /[\s~^:?*[\\]/.test(ref)) {
    throw new CheckpointError("Not a Gatehouse checkpoint reference")
  }
}

interface RawChange {
  path: string
  change: FileChange
}

/** Name and status of every file that differs between the current working tree and a checkpoint. */
async function changesToCheckpoint(
  top: string,
  commit: string,
  excludeGlobs: readonly string[] | undefined,
): Promise<{ currentTree: string; changes: RawChange[] }> {
  const base = await headOf(top)
  const currentTree = await snapshotTree(top, base, excludeGlobs)
  // Direction: current -> checkpoint. "A" exists only in the checkpoint, "D" only in the working tree.
  const out = await gitRaw(top, [
    "diff-tree",
    "-r",
    "--name-status",
    "-z",
    "--no-renames",
    currentTree,
    commit,
  ])
  const parts = out.split("\0").filter((p) => p !== "")
  const changes: RawChange[] = []
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const status = parts[i]
    const file = parts[i + 1] as string
    const change: FileChange | undefined =
      status === "A"
        ? "added"
        : status === "D"
          ? "deleted"
          : status === "M" || status === "T"
            ? "modified"
            : undefined
    if (change) changes.push({ path: file, change })
  }
  return { currentTree, changes }
}

/** Shows what restoring a checkpoint would change, without changing anything. */
export async function previewRestore(
  cwd: string,
  ref: string,
  excludeGlobs?: readonly string[],
): Promise<RestorePreview> {
  assertOurRef(ref)
  const top = await repoTop(cwd)
  const commit = await git(top, ["rev-parse", "--verify", `${ref}^{commit}`])
  const { currentTree, changes } = await changesToCheckpoint(top, commit, excludeGlobs)
  let diff = await gitRaw(top, ["diff", "--no-color", "--no-ext-diff", currentTree, commit])
  const truncated = diff.length > MAX_DIFF_CHARS
  if (truncated) diff = diff.slice(0, MAX_DIFF_CHARS)
  return { ref, commit, changes, diff, truncated }
}

export interface RestoreResult {
  restored: string[]
  deleted: string[]
  /** A checkpoint of the state just before the restore, so the restore can itself be undone. */
  safety: Checkpoint
}

/**
 * Puts the working tree back as it was at a checkpoint. It first saves a safety checkpoint, then
 * rewrites the files that differ and deletes the files made since. Files that checkpoints never hold
 * (ignored files and the exclude globs, such as secrets) are not touched. The real index is not changed.
 * Needs `confirm: true`, which the caller sets only after showing the preview to the user.
 */
export async function restoreCheckpoint(opts: {
  cwd: string
  ref: string
  sessionId: string
  confirm: boolean
  excludeGlobs?: readonly string[]
}): Promise<RestoreResult> {
  if (opts.confirm !== true) throw new CheckpointError("Restoring needs explicit confirmation")
  assertOurRef(opts.ref)
  const top = await repoTop(opts.cwd)
  const commit = await git(top, ["rev-parse", "--verify", `${opts.ref}^{commit}`])
  const safety = await createCheckpoint({
    cwd: top,
    sessionId: opts.sessionId,
    label: `before restoring ${opts.ref.slice(REF_PREFIX.length)}`,
    excludeGlobs: opts.excludeGlobs,
  })
  const { changes } = await changesToCheckpoint(top, commit, opts.excludeGlobs)
  const toWrite = changes.filter((c) => c.change !== "deleted").map((c) => c.path)
  for (let i = 0; i < toWrite.length; i += 100) {
    const chunk = toWrite.slice(i, i + 100)
    await git(top, ["restore", `--source=${commit}`, "--worktree", "--", ...chunk])
  }
  const deleted: string[] = []
  // git prints the top folder with forward slashes. Compare like with like before deleting anything.
  const topDir = path.resolve(top)
  for (const c of changes.filter((x) => x.change === "deleted")) {
    const target = path.resolve(topDir, c.path)
    if (target !== topDir && target.startsWith(topDir + path.sep)) {
      fs.rmSync(target, { force: true })
      deleted.push(c.path)
    }
  }
  return { restored: toWrite, deleted, safety }
}

export interface ChangeSince {
  path: string
  /** From the checkpoint to now: "added" was made since, "deleted" was removed since. */
  change: FileChange
  added: number
  removed: number
  binary: boolean
  /** This file's unified diff from the checkpoint to now, cut at 40 KB. */
  diff: string
}

const MAX_FILE_DIFF = 40_000

/**
 * What changed in the working tree since a checkpoint, file by file with its diff: the Changes pane. Nothing is
 * changed. Files that checkpoints never hold (ignored files and excludeGlobs, such as secrets) are not listed.
 */
export async function changesSince(
  cwd: string,
  ref: string,
  excludeGlobs?: readonly string[],
): Promise<{ ref: string; commit: string; files: ChangeSince[]; truncated: boolean }> {
  assertOurRef(ref)
  const top = await repoTop(cwd)
  const commit = await git(top, ["rev-parse", "--verify", `${ref}^{commit}`])
  const currentTree = await snapshotTree(top, await headOf(top), excludeGlobs)
  // Direction: checkpoint -> now.
  const status = (
    await gitRaw(top, [
      "diff-tree",
      "-r",
      "--name-status",
      "-z",
      "--no-renames",
      commit,
      currentTree,
    ])
  )
    .split("\0")
    .filter((p) => p !== "")
  const files: ChangeSince[] = []
  for (let i = 0; i + 1 < status.length; i += 2) {
    const s = status[i]
    const change: FileChange | undefined =
      s === "A" ? "added" : s === "D" ? "deleted" : s === "M" || s === "T" ? "modified" : undefined
    if (change)
      files.push({
        path: status[i + 1] as string,
        change,
        added: 0,
        removed: 0,
        binary: false,
        diff: "",
      })
  }
  const byPath = new Map(files.map((f) => [f.path, f]))
  const numstat = await gitRaw(top, [
    "diff-tree",
    "-r",
    "--numstat",
    "-z",
    "--no-renames",
    commit,
    currentTree,
  ])
  for (const entry of numstat.split("\0").filter((p) => p !== "")) {
    const [a = "", r = "", ...rest] = entry.split("\t")
    const f = byPath.get(rest.join("\t"))
    if (!f) continue
    f.binary = a === "-"
    f.added = Number(a) || 0
    f.removed = Number(r) || 0
  }
  const full = await gitRaw(top, [
    "-c",
    "core.quotePath=false",
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--no-renames",
    commit,
    currentTree,
  ])
  let total = 0
  let truncated = false
  const head = "diff --git a/"
  const sections = full.split(/^(?=diff --git )/m).filter((x) => x.startsWith("diff --git "))
  sections.forEach((section, i) => {
    const first = section.slice(0, section.indexOf("\n"))
    // "diff --git a/<p> b/<p>": the same path twice, as nothing is renamed.
    const p = first.slice(head.length, head.length + (first.length - head.length - 3) / 2)
    const f = byPath.get(p) ?? files[i]
    if (!f) return
    let text = section
    if (text.length > MAX_FILE_DIFF) {
      text = text.slice(0, MAX_FILE_DIFF)
      truncated = true
    }
    if (total + text.length > MAX_DIFF_CHARS) {
      truncated = true
      return
    }
    total += text.length
    f.diff = text
  })
  return { ref, commit, files, truncated }
}

/**
 * Puts some files back as they were at a checkpoint: the Changes pane's Undo for one file. Only files that differ
 * from the checkpoint can be named. A safety checkpoint is taken first, so the undo can itself be undone. A file
 * made since the checkpoint is deleted; one changed or removed since is written back.
 */
export async function restoreFiles(opts: {
  cwd: string
  ref: string
  paths: readonly string[]
  sessionId: string
  confirm: boolean
  excludeGlobs?: readonly string[]
}): Promise<RestoreResult> {
  if (opts.confirm !== true) throw new CheckpointError("Undoing needs explicit confirmation")
  assertOurRef(opts.ref)
  const top = await repoTop(opts.cwd)
  const commit = await git(top, ["rev-parse", "--verify", `${opts.ref}^{commit}`])
  const { changes } = await changesToCheckpoint(top, commit, opts.excludeGlobs)
  const wanted = new Set(opts.paths)
  const chosen = changes.filter((c) => wanted.has(c.path))
  if (chosen.length !== wanted.size)
    throw new CheckpointError("Only files that changed since the checkpoint can be undone")
  const safety = await createCheckpoint({
    cwd: top,
    sessionId: opts.sessionId,
    label: `before undoing ${chosen.length} file${chosen.length === 1 ? "" : "s"}`,
    excludeGlobs: opts.excludeGlobs,
  })
  const toWrite = chosen.filter((c) => c.change !== "deleted").map((c) => c.path)
  if (toWrite.length)
    await git(top, ["restore", `--source=${commit}`, "--worktree", "--", ...toWrite])
  const deleted: string[] = []
  const topDir = path.resolve(top)
  for (const c of chosen.filter((x) => x.change === "deleted")) {
    const target = path.resolve(topDir, c.path)
    if (target !== topDir && target.startsWith(topDir + path.sep)) {
      fs.rmSync(target, { force: true })
      deleted.push(c.path)
    }
  }
  return { restored: toWrite, deleted, safety }
}
