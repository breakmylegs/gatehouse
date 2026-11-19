import path from "node:path"
import type { AuditRecord } from "@gatehouse/shared/audit"

/**
 * D-073 (frontier, Insight and evidence): the undo-learning loop. When you undo the same kind of change, or say no to
 * the same kind of call, three times or more in a project, Codehouse proposes a line for its CLAUDE.md, with the
 * records it rests on. Nothing is written until you add it on the desktop, and adding it goes through D-059: it is
 * recorded first, refused while the project's instructions have a change from outside you have not reviewed, and
 * CLAUDE.md is pinned again as Codehouse wrote it.
 *
 * Kinds:
 *   denied a command      the same command word (and its subcommand), said no to by a person: "git push"
 *   denied an edit        an edit refused by a person in the same folder: "src/generated/"
 *   denied a tool         the same other tool refused by a person: "WebFetch"
 *   undone                files put back from a checkpoint in the same folder (files_undone, change_undone)
 * The line is made here from those parts only, each held to a small set of characters, so what a session wrote (a
 * command, a path) cannot carry its own words into the instructions.
 */
export const LESSON_THRESHOLD = 3
export const LESSON_HEADING = "## Learnt from your undos and denials (Codehouse)"

export interface Lesson {
  key: string
  kind: "denied-command" | "denied-edit" | "denied-tool" | "undone"
  count: number
  line: string
  evidence: Array<{ seq: number; ts: string; session: string; what: string }>
}

type Rec = Pick<AuditRecord, "seq" | "ts" | "session" | "event" | "tool" | "inputJson"> & { cwd?: string; verdict?: { outcome?: string; decidedBy?: string } }

const SAFE_WORD = /^[A-Za-z0-9][\w.-]{0,40}$/
const SAFE_AREA = /^[\w@.-]+(\/[\w@.-]+)?$/
const FILE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"])
const SHELL_TOOLS = new Set(["Bash", "PowerShell"])

const inputOf = (r: Rec): Record<string, unknown> => {
  try {
    const v = JSON.parse(r.inputJson ?? "{}") as unknown
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const norm = (p: string) => path.resolve(p).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()

/** A path's folder inside the project, at most two levels deep, or a file at the root by its name. */
export function areaOf(root: string, file: string): string | undefined {
  const rel = path.relative(root, path.resolve(root, file)).replace(/\\/g, "/")
  if (!rel || rel.startsWith("../") || path.isAbsolute(rel)) return undefined
  const dir = path.posix.dirname(rel)
  const area = dir === "." ? rel : dir.split("/").slice(0, 2).join("/")
  return SAFE_AREA.test(area) && !area.split("/").includes("..") ? area : undefined
}

/** A shell command's word and, when it has one, its subcommand: "git push", "npm publish", "rm". */
export function commandOf(command: string): string | undefined {
  const words = command.trim().split(/\s+/)
  const first = (words[0] ?? "").replace(/^.*[\\/]/, "").replace(/\.(exe|cmd|ps1)$/i, "")
  if (!SAFE_WORD.test(first)) return undefined
  const second = words[1] ?? ""
  return /^[a-z][a-z-]{1,30}$/.test(second) ? `${first} ${second}` : first
}

const isPersonDeny = (r: Rec) => r.verdict?.outcome === "deny" && (r.verdict.decidedBy ?? "").startsWith("human") && (r.event === "human_decision" || r.event === "evaluate_permission")

/** The lessons in a project's records: each kind seen at least LESSON_THRESHOLD times, not already in its CLAUDE.md. */
export function lessonsFrom(records: Rec[], cwd: string, claudeMd: string): Lesson[] {
  const root = norm(cwd)
  const inProject = (r: Rec) => !!r.cwd && (norm(r.cwd) === root || norm(r.cwd).startsWith(`${root}/`))
  const groups = new Map<string, Omit<Lesson, "count" | "line"> & { name: string }>()
  const add = (key: string, kind: Lesson["kind"], name: string, r: Rec, what: string) => {
    const g = groups.get(key) ?? { key, kind, name, evidence: [] }
    // One record counts once for a kind, however many of its files it names.
    if (!g.evidence.some((e) => e.seq === r.seq)) g.evidence.push({ seq: r.seq, ts: r.ts, session: r.session, what })
    groups.set(key, g)
  }
  for (const r of records) {
    if (!inProject(r)) continue
    const input = inputOf(r)
    if (isPersonDeny(r)) {
      if (SHELL_TOOLS.has(r.tool)) {
        const c = typeof input.command === "string" ? commandOf(input.command) : undefined
        if (c) add(`denied-command:${c}`, "denied-command", c, r, `You said no to ${c}`)
      } else if (FILE_TOOLS.has(r.tool)) {
        const f = typeof input.file_path === "string" ? input.file_path : typeof input.notebook_path === "string" ? input.notebook_path : undefined
        const a = f ? areaOf(cwd, f) : undefined
        if (a) add(`denied-edit:${a}`, "denied-edit", a, r, `You said no to an edit in ${a}`)
      } else if (SAFE_WORD.test(r.tool) || /^mcp__[\w-]{1,60}$/.test(r.tool)) add(`denied-tool:${r.tool}`, "denied-tool", r.tool, r, `You said no to ${r.tool}`)
    } else if (r.event === "files_undone" || r.event === "change_undone") {
      const paths = Array.isArray(input.paths) ? input.paths : [input.path]
      for (const p of paths) {
        const a = typeof p === "string" ? areaOf(cwd, p) : undefined
        if (a) add(`undone:${a}`, "undone", a, r, `You undid a change in ${a}`)
      }
    }
  }
  const out: Lesson[] = []
  for (const g of groups.values()) {
    if (g.evidence.length < LESSON_THRESHOLD || claudeMd.includes(marker(g.key))) continue
    const n = g.evidence.length
    const line =
      g.kind === "denied-command"
        ? `Do not run \`${g.name}\` in this project unless I ask for it: I have said no to it ${n} times. Ask in words first if it seems needed.`
        : g.kind === "denied-edit"
          ? `Do not edit files in \`${g.name}\` unless I ask for it: I have said no to edits there ${n} times.`
          : g.kind === "denied-tool"
            ? `Do not use ${g.name} in this project unless I ask for it: I have said no to it ${n} times.`
            : `Leave \`${g.name}\` alone unless I ask for a change there: I have undone your changes to it ${n} times.`
    out.push({ key: g.key, kind: g.kind, count: n, line, evidence: g.evidence.slice(-10) })
  }
  return out.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

/** The comment that marks a lesson's line in CLAUDE.md, so it is not proposed again. */
export const marker = (key: string) => `<!-- codehouse-lesson: ${key} -->`

/** CLAUDE.md with the lesson added under Codehouse's own heading, made if it is not there yet. */
export function withLesson(claudeMd: string, lesson: Lesson): string {
  const item = `- ${lesson.line} ${marker(lesson.key)}`
  const eol = claudeMd.includes("\r\n") ? "\r\n" : "\n"
  const lines = claudeMd ? claudeMd.replace(/(\r?\n)+$/, "").split(/\r?\n/) : []
  const at = lines.indexOf(LESSON_HEADING)
  if (at < 0) return [...lines, ...(lines.length ? [""] : []), LESSON_HEADING, "", item, ""].join(eol)
  let end = at + 1
  while (end < lines.length && !/^#{1,2} /.test(lines[end]!)) end++
  while (end > at + 1 && !lines[end - 1]!.trim()) end--
  return [...lines.slice(0, end), item, ...lines.slice(end), ""].join(eol)
}
