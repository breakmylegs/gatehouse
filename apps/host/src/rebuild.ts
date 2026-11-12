/**
 * D-027, step-exact reconstruction (Frontier build, Wave 2). The working tree as it was at any audited step, rebuilt in
 * a scratch folder of its own: the newest checkpoint taken before the step, written out from git's object store, and
 * then every edit the session made after it up to the step, from the audit log's record of each (Write, Edit,
 * MultiEdit). No model is asked and nothing of the session's runs: git is used only to read objects and write a tree
 * (read-tree, checkout-index, add, write-tree, rev-parse), always in a throw-away index, never the project's own.
 *
 * What cannot be replayed is said, and the rebuild is then not exact: an edit whose recorded input was redacted (the
 * tree stops at the edit before it), an edit whose text is not in the file, a notebook edit, and a shell command that
 * ran after the checkpoint (what it changed is not replayed; the next checkpoint holds it).
 */
import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { AuditRecord } from "@gatehouse/shared/audit"
import type { Checkpoint } from "@gatehouse/shared/node"

/** The only git commands a rebuild runs. */
export const REBUILD_GIT = new Set(["read-tree", "checkout-index", "add", "write-tree", "rev-parse"])

export type RebuildGit = (cwd: string, args: string[], env?: NodeJS.ProcessEnv) => Promise<string>

const git: RebuildGit = (cwd, args, env = {}) =>
  new Promise((resolve, reject) => {
    if (!REBUILD_GIT.has(args.find((a) => !a.startsWith("-") && !a.includes("=")) ?? "")) return reject(new Error(`git ${args[0]} is not one a rebuild runs`))
    execFile("git", args, { cwd, env: { ...process.env, ...env }, windowsHide: true, timeout: 120_000, maxBuffer: 64 * 1024 * 1024 }, (e, out) =>
      e ? reject(e) : resolve(String(out).trim()),
    )
  })

export interface RebuildResult {
  dir: string
  seq: number
  from: { ref: string; label: string; createdAt: string }
  /** How many recorded edits were applied on top of the checkpoint. */
  applied: number
  exact: boolean
  /** What could not be replayed, in words. */
  marks: string[]
  /** The rebuilt tree's git hash, to compare with a checkpoint's. */
  tree: string
}

const EDITS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"])
const SHELL = new Set(["Bash", "PowerShell"])
const REDACTED = /\[REDACTED:[a-z-]+\]/

function inputOf(r: AuditRecord): Record<string, unknown> {
  try {
    const v = JSON.parse(r.inputJson) as unknown
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Each call's last record, in order: what the call was finally decided as. */
function calls(records: AuditRecord[]): AuditRecord[] {
  const last = new Map<string, AuditRecord>()
  for (const r of records) last.set(r.toolUseId ?? `seq-${r.seq}`, r)
  return [...last.values()].sort((a, b) => a.seq - b.seq)
}

/** A tree's hash: the folder added to a throw-away index of the project's repository, then written. */
async function treeOf(top: string, dir: string, run: RebuildGit): Promise<string> {
  const index = path.join(os.tmpdir(), `gh-rebuild-${process.pid}-${Math.random().toString(36).slice(2)}`)
  try {
    await run(top, ["-c", "core.autocrlf=false", `--work-tree=${dir}`, "add", "-A", "--", "."], { GIT_INDEX_FILE: index })
    return await run(top, ["write-tree"], { GIT_INDEX_FILE: index })
  } finally {
    fs.rmSync(index, { force: true })
  }
}

export async function rebuildAt(o: {
  /** The project's folder (inside its repository). */
  cwd: string
  seq: number
  /** The session's audit records, oldest first. */
  records: AuditRecord[]
  checkpoints: Checkpoint[]
  /** An empty folder of its own, made for this rebuild. */
  dir: string
  git?: RebuildGit
}): Promise<RebuildResult> {
  const run = o.git ?? git
  const step = o.records.find((r) => r.seq === o.seq)
  if (!step) throw new Error(`Record ${o.seq} is not this session's.`)
  const at = Date.parse(step.ts)
  const from = [...o.checkpoints].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).filter((c) => Date.parse(c.createdAt) <= at).at(-1)
  if (!from) throw new Error("There is no checkpoint from before this step to rebuild from.")
  if (fs.existsSync(o.dir) && fs.readdirSync(o.dir).length) throw new Error("The folder to rebuild in must be empty.")
  fs.mkdirSync(o.dir, { recursive: true })
  const dir = path.resolve(o.dir)
  const top = (await run(o.cwd, ["rev-parse", "--show-toplevel"])).replace(/\//g, path.sep)

  // The checkpoint, written out from git's objects through a throw-away index.
  const index = path.join(os.tmpdir(), `gh-rebuild-${process.pid}-${Math.random().toString(36).slice(2)}`)
  try {
    await run(top, ["read-tree", from.commit], { GIT_INDEX_FILE: index })
    await run(top, ["-c", "core.autocrlf=false", "checkout-index", "-a", "-f", `--prefix=${dir.replace(/\\/g, "/")}/`], { GIT_INDEX_FILE: index })
  } finally {
    fs.rmSync(index, { force: true })
  }

  const marks: string[] = []
  let applied = 0
  let stopped = false
  const inside = (file: string): string | undefined => {
    const abs = path.resolve(path.isAbsolute(file) ? file : path.join(o.cwd, file))
    const rel = path.relative(top, abs)
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return undefined
    const out = path.resolve(dir, rel)
    return out.startsWith(dir + path.sep) ? out : undefined
  }
  const after = calls(o.records.filter((r) => Date.parse(r.ts) >= Date.parse(from.createdAt) && r.seq <= o.seq))
  for (const r of after) {
    if (r.verdict.outcome !== "allow") continue
    if (SHELL.has(r.tool)) {
      marks.push(`A shell command ran at record ${r.seq}; what it changed is not replayed.`)
      continue
    }
    if (!EDITS.has(r.tool) || stopped) continue
    const input = inputOf(r)
    if (REDACTED.test(r.inputJson)) {
      marks.push(`The edit at record ${r.seq} was recorded with part of it redacted, so the rebuild stops before it.`)
      stopped = true
      continue
    }
    if (r.tool === "NotebookEdit") {
      marks.push(`The notebook edit at record ${r.seq} cannot be replayed, so the rebuild stops before it.`)
      stopped = true
      continue
    }
    const target = inside(String(input.file_path ?? ""))
    if (!target) {
      marks.push(`The edit at record ${r.seq} is outside the project, so it is not replayed.`)
      continue
    }
    let text = r.tool === "Write" ? String(input.content ?? "") : fs.existsSync(target) ? fs.readFileSync(target, "utf8") : undefined
    const edits =
      r.tool === "Edit"
        ? [input]
        : r.tool === "MultiEdit" && Array.isArray(input.edits)
          ? (input.edits as Array<Record<string, unknown>>)
          : []
    let ok = text !== undefined
    for (const e of edits) {
      const was = String(e.old_string ?? "")
      const now = String(e.new_string ?? "")
      if (text === undefined || !text.includes(was)) {
        ok = false
        break
      }
      text = e.replace_all === true ? text.split(was).join(now) : text.replace(was, () => now)
    }
    if (!ok || text === undefined) {
      marks.push(`The edit at record ${r.seq} does not match the file as rebuilt, so the rebuild stops before it.`)
      stopped = true
      continue
    }
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, text)
    applied++
  }
  return {
    dir,
    seq: o.seq,
    from: { ref: from.ref, label: from.label, createdAt: from.createdAt },
    applied,
    exact: marks.length === 0,
    marks,
    tree: await treeOf(top, dir, run),
  }
}
