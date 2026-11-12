/**
 * D-028, the causal provenance graph (Frontier build, Wave 3). Where a change came from: for each hunk of a changed
 * file, the edit call that made it, and what the session had read before that call (files, pages, other servers'
 * results), with anything D-061 flagged as holding prompt injection, or D-015 counts as not the project's own words,
 * marked. Built from the audit log alone; nothing runs.
 */
import type { AuditRecord } from "@gatehouse/shared/audit"
import { fromOutside } from "./provenance.js"

export interface SourceNode {
  seq: number
  tool: string
  what: string
  /** D-061 found what looks like prompt injection in it. */
  injected?: true
  /** A page, another server's tool, or a file whose words are not the project's own. */
  outside?: true
}

export interface CallNode {
  seq: number
  tool: string
  file: string
  /** The sources read before it in the session, newest first, at most 20. */
  sources: SourceNode[]
}

export interface HunkLink {
  file: string
  /** The hunk's place in the file's diff, from 0. */
  hunk: number
  call?: CallNode
}

const READS = new Set(["Read", "Grep", "Glob", "WebFetch", "WebSearch", "NotebookRead"])
const EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"])

function inputOf(r: AuditRecord): Record<string, unknown> {
  try {
    const v = JSON.parse(r.inputJson) as unknown
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase()

/** What an edit call put in the file: its new strings, or the whole content of a Write. */
function written(input: Record<string, unknown>): string[] {
  if (typeof input.content === "string") return [input.content]
  if (typeof input.new_string === "string") return [input.new_string]
  if (Array.isArray(input.edits)) return (input.edits as Array<Record<string, unknown>>).map((e) => String(e.new_string ?? ""))
  return []
}

/** The added lines of each hunk of a unified diff, in order. */
function hunksOf(diff: string): string[][] {
  const out: string[][] = []
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("@@")) out.push([])
    else if (out.length && line.startsWith("+") && !line.startsWith("+++")) out.at(-1)!.push(line.slice(1))
  }
  return out
}

/**
 * The graph for a session's changed files: each hunk tied to the newest allowed edit of its file whose written text
 * holds the hunk's added lines (or, failing that, the newest edit of the file), and each edit to what was read before it.
 */
export function provenanceGraph(o: {
  records: AuditRecord[]
  files: Array<{ path: string; diff: string }>
  /** D-015: whether a file's words are not the project's own (README, documentation, dependencies). */
  untrusted: (file: string) => boolean
}): HunkLink[] {
  const calls = new Map<string, AuditRecord>()
  for (const r of o.records) calls.set(r.toolUseId ?? `seq-${r.seq}`, r)
  const ordered = [...calls.values()].sort((a, b) => a.seq - b.seq)
  const injected = new Set(
    o.records.filter((r) => r.event === "injection_flagged").map((r) => String(inputOf(r).toolUseId ?? "")).filter(Boolean),
  )
  const sources: SourceNode[] = []
  const edits: Array<{ node: CallNode; text: string[] }> = []
  for (const r of ordered) {
    if (r.verdict.outcome !== "allow" || r.event === "injection_flagged") continue
    const input = inputOf(r)
    if (READS.has(r.tool) || fromOutside(r.tool)) {
      const what = String(input.file_path ?? input.url ?? input.query ?? input.pattern ?? input.path ?? r.tool)
      const outside = fromOutside(r.tool) || (r.tool === "Read" && o.untrusted(what))
      sources.push({
        seq: r.seq,
        tool: r.tool,
        what: what.slice(0, 300),
        ...(r.toolUseId && injected.has(r.toolUseId) ? { injected: true as const } : {}),
        ...(outside ? { outside: true as const } : {}),
      })
    } else if (EDITS.has(r.tool)) {
      const file = String(input.file_path ?? input.notebook_path ?? "")
      edits.push({ node: { seq: r.seq, tool: r.tool, file, sources: [...sources].reverse().slice(0, 20) }, text: written(input) })
    }
  }
  const links: HunkLink[] = []
  for (const f of o.files) {
    const mine = edits.filter((e) => norm(e.node.file).endsWith(norm(f.path)))
    hunksOf(f.diff).forEach((added, hunk) => {
      const body = added.map((l) => l.trim()).filter(Boolean)
      const made = [...mine].reverse().find((e) => body.length > 0 && body.every((l) => e.text.some((t) => t.includes(l)))) ?? mine.at(-1)
      links.push({ file: f.path, hunk, ...(made ? { call: made.node } : {}) })
    })
  }
  return links
}
