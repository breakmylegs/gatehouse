/**
 * E-039, error signature triage (Expansion E4). The errors in a project's log lines (E-038) are grouped by signature:
 * the error's type, its message with ids, numbers, quoted values, addresses and times taken out, and its top frame. Two
 * errors that differ only in ids are one signature, counted. A JavaScript frame in the project whose file has a source
 * map is mapped back to its source (Node's own SourceMap, no dependency); a map is read only from inside the project.
 * Each signature offers a fix task: a prompt for the session, naming the error, how often and where.
 */
import fs from "node:fs"
import { SourceMap } from "node:module"
import path from "node:path"
import type { LogEntry } from "./log-capture.js"

export interface Frame {
  fn?: string
  file: string
  line: number
  column?: number
  /** Where a source map puts it. */
  source?: { file: string; line: number; column?: number }
}

export interface Signature {
  key: string
  type: string
  message: string
  count: number
  first: string
  last: string
  frames: Frame[]
  sample: string
}

/** A message with what changes from one occurrence to the next taken out. */
export function normalise(message: string): string {
  return message
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\b\d{4}-\d\d-\d\d[T ]\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:?\d\d)?\b/g, "<time>")
    .replace(/\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g, "<email>")
    .replace(/\bhttps?:\/\/\S+/g, "<url>")
    .replace(/\b0x[0-9a-f]+\b|\b[0-9a-f]{12,}\b/gi, "<hex>")
    .replace(/(["'`])(?:(?!\1).){1,200}\1/g, "<value>")
    // Numbers, also with a unit after them (3000ms), but not inside a name (v2, utf8).
    .replace(/(?<![A-Za-z_\d])\d+(\.\d+)?/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
}

const ERROR_HEAD = /^\s*(?:Uncaught\s+)?([A-Z][\w.]*(?:Error|Exception|Fault|Failure))(?::\s*(.*))?$/
const JS_FRAME = /^\s*at\s+(?:(.*?)\s+\()?(.*?):(\d+)(?::(\d+))?\)?\s*$/
const PY_FRAME = /^\s*File "(.+)", line (\d+)(?:, in (\S+))?/
const NET_FRAME = /^\s*at\s+(\S+)\(.*\)\s+in\s+(.+):line\s+(\d+)/

export function parseFrame(line: string): Frame | undefined {
  let m = NET_FRAME.exec(line)
  if (m) return { fn: m[1]!, file: m[2]!, line: Number(m[3]) }
  m = PY_FRAME.exec(line)
  if (m) return { ...(m[3] ? { fn: m[3] } : {}), file: m[1]!, line: Number(m[2]) }
  m = JS_FRAME.exec(line)
  if (m && /\.\w+$|^node:/.test(m[2]!)) return { ...(m[1] ? { fn: m[1] } : {}), file: m[2]!.replace(/^file:\/\/\/?/, ""), line: Number(m[3]), ...(m[4] ? { column: Number(m[4]) } : {}) }
  return undefined
}

/** The errors in log lines (oldest first), each with the frames that follow it from the same source. */
export function errorsIn(entries: LogEntry[]): Array<{ at: string; type: string; message: string; frames: Frame[]; sample: string }> {
  const out: Array<{ at: string; type: string; message: string; frames: Frame[]; sample: string }> = []
  let open: (typeof out)[number] | undefined
  let openSource = ""
  for (const e of entries) {
    const frame = parseFrame(e.message)
    if (frame && open && e.source === openSource) {
      if (open.frames.length < 20) open.frames.push(frame)
      continue
    }
    const head = ERROR_HEAD.exec(e.message) ?? (e.level === "error" || e.level === "fatal" ? /^()(.*)$/.exec(e.message) : null)
    if (head) {
      open = { at: e.at, type: head[1] || (typeof e.fields?.err === "string" ? "Error" : "logged error"), message: (head[2] ?? "").slice(0, 500), frames: [], sample: e.message.slice(0, 300) }
      openSource = e.source
      out.push(open)
    } else open = undefined
  }
  return out
}

/** A frame's file inside the project, mapped through its source map when it has one; undefined when it cannot be. */
export function mapFrame(root: string, f: Frame): Frame {
  const abs = path.resolve(root, f.file)
  const rel = path.relative(root, abs)
  if (rel.startsWith("..") || path.isAbsolute(rel) || !/\.[cm]?js$/.test(abs)) return f
  try {
    let mapFile = `${abs}.map`
    if (!fs.existsSync(mapFile)) {
      const tail = fs.readFileSync(abs, "utf8").slice(-2000)
      const url = /\/\/# sourceMappingURL=(\S+)\s*$/.exec(tail)?.[1]
      if (!url || /^(data|https?):/.test(url)) return f
      mapFile = path.resolve(path.dirname(abs), url)
      const mrel = path.relative(root, mapFile)
      if (mrel.startsWith("..") || path.isAbsolute(mrel)) return f
    }
    const sm = new SourceMap(JSON.parse(fs.readFileSync(mapFile, "utf8")) as never)
    const hit = sm.findEntry(f.line - 1, (f.column ?? 1) - 1) as { originalSource?: string; originalLine?: number; originalColumn?: number }
    if (!hit?.originalSource) return f
    const src = hit.originalSource.replace(/^webpack:\/\/\/?|^file:\/\/\/?/, "")
    return { ...f, source: { file: path.relative(root, path.resolve(path.dirname(mapFile), src)).replace(/\\/g, "/"), line: (hit.originalLine ?? 0) + 1, column: (hit.originalColumn ?? 0) + 1 } }
  } catch {
    return f
  }
}

/** Errors grouped by signature, most frequent first, their frames mapped to source. */
export function triage(root: string, entries: LogEntry[]): Signature[] {
  const groups = new Map<string, Signature>()
  for (const e of errorsIn(entries)) {
    const top = e.frames.find((f) => !/node_modules|^node:|internal\//.test(f.file)) ?? e.frames[0]
    const key = `${e.type}: ${normalise(e.message)}${top ? ` at ${top.fn ?? "?"} (${path.basename(top.file)})` : ""}`
    const g = groups.get(key)
    if (g) {
      g.count++
      if (e.at < g.first) g.first = e.at
      if (e.at > g.last) g.last = e.at
    } else groups.set(key, { key, type: e.type, message: normalise(e.message), count: 1, first: e.at, last: e.at, frames: e.frames.slice(0, 8).map((f) => mapFrame(root, f)), sample: e.sample })
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.last.localeCompare(a.last))
}

/** The fix task a signature offers: a prompt for the session. */
export function fixTask(s: Signature): string {
  const where = s.frames
    .slice(0, 5)
    .map((f) => (f.source ? `${f.source.file}:${f.source.line}` : `${f.file}:${f.line}`) + (f.fn ? ` (${f.fn})` : ""))
    .join("\n  ")
  return [
    `Investigate and fix this error. It appeared ${s.count} time${s.count === 1 ? "" : "s"} in the project's logs between ${s.first.slice(0, 16)} and ${s.last.slice(0, 16)}.`,
    `${s.type}: ${s.message}`,
    where ? `Where it was raised:\n  ${where}` : "",
    "Find the cause, fix it with a test that fails before the fix, and say what the cause was.",
  ]
    .filter(Boolean)
    .join("\n\n")
}
