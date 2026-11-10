/**
 * C-010, the audit-backed session timeline (Frontier build, Wave 2 prerequisite). Every call a session made, in audit
 * order (by the chain's sequence number, never by clock), each with the decision it ended in, the rule, the risk and
 * who decided, and links to its records, its file's change and the checkpoint taken while it waited. Things the session
 * did that were not calls (a mode change, a pause, Extreme approval carrying on) are entries of their own. It reads the
 * audit log only: what it shows is what was recorded, already redacted.
 */
import fs from "node:fs"
import path from "node:path"
import { AuditRecord, listAuditFiles } from "@gatehouse/shared/audit"

export interface TimelineEntry {
  /** The first record's sequence number: the entry's place in the timeline. */
  seq: number
  at: string
  kind: "call" | "event"
  /** The last record's event: what the call ended in (human_decision, floor_deny, self_approved...). */
  event: string
  tool: string
  toolUseId?: string
  /** What was asked, short, from the record (redacted before it was written). */
  summary: string
  outcome: string
  ruleId: string
  risk: number
  decidedBy: string
  channel: string
  /** Every record of this call, oldest first, to open on the Audit page. */
  records: number[]
  /** The file an edit tool changed, for its diff in Changes. */
  file?: string
  /** The checkpoint taken while this call waited, to preview or restore. */
  checkpoint?: { ref: string; label: string; createdAt: string }
}

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"])

function summaryOf(tool: string, inputJson: string): { summary: string; file?: string } {
  let input: Record<string, unknown> = {}
  try {
    const v: unknown = JSON.parse(inputJson)
    if (v && typeof v === "object" && !Array.isArray(v)) input = v as Record<string, unknown>
  } catch {
    // Not JSON: shown as it is.
    return { summary: inputJson.slice(0, 200) }
  }
  const file = typeof input.file_path === "string" ? input.file_path : typeof input.notebook_path === "string" ? input.notebook_path : undefined
  const text =
    typeof input.command === "string"
      ? input.command
      : file ?? (typeof input.url === "string" ? input.url : typeof input.pattern === "string" ? input.pattern : JSON.stringify(input))
  return { summary: text.replace(/\s+/g, " ").slice(0, 200), ...(file && EDIT_TOOLS.has(tool) ? { file } : {}) }
}

/** A session's records, oldest first by sequence number, from every month file. */
export function sessionRecords(dir: string, sessionId: string): AuditRecord[] {
  const out: AuditRecord[] = []
  for (const file of listAuditFiles(dir)) {
    let text: string
    try {
      text = fs.readFileSync(path.join(dir, file), "utf8")
    } catch {
      continue
    }
    for (const raw of text.split("\n")) {
      if (!raw) continue
      try {
        const parsed = AuditRecord.safeParse(JSON.parse(raw))
        if (parsed.success && parsed.data.session === sessionId) out.push(parsed.data)
      } catch {
        // A line being written, or a damaged one: the verifier reports it; the timeline leaves it out.
      }
    }
  }
  return out.sort((a, b) => a.seq - b.seq)
}

/**
 * The timeline, oldest first. A call's records are joined by its tool use id, and the call takes the decision of its
 * last record. A checkpoint belongs to the call that was waiting when it was taken, or else the next call after it.
 */
export function sessionTimeline(
  records: AuditRecord[],
  checkpoints: Array<{ ref: string; label: string; createdAt: string }> = [],
): TimelineEntry[] {
  const entries: TimelineEntry[] = []
  const calls = new Map<string, TimelineEntry>()
  const ordered = [...records].sort((a, b) => a.seq - b.seq)
  for (const r of ordered) {
    const decided = {
      event: r.event,
      outcome: r.verdict.outcome,
      ruleId: r.verdict.ruleId,
      risk: r.verdict.risk,
      decidedBy: r.verdict.decidedBy,
      channel: r.channel,
    }
    const id = r.toolUseId
    const known = id ? calls.get(id) : undefined
    if (known) {
      Object.assign(known, decided)
      known.records.push(r.seq)
      continue
    }
    const { summary, file } = summaryOf(r.tool, r.inputJson)
    const entry: TimelineEntry = {
      seq: r.seq,
      at: r.ts,
      kind: id ? "call" : "event",
      tool: r.tool,
      ...(id ? { toolUseId: id } : {}),
      summary,
      ...decided,
      records: [r.seq],
      ...(file ? { file } : {}),
    }
    entries.push(entry)
    if (id) calls.set(id, entry)
  }
  // Each checkpoint, oldest first, to the call whose records span its time, or the first call after it.
  const callEntries = entries.filter((e) => e.kind === "call")
  const tsOf = new Map(ordered.map((r) => [r.seq, r.ts]))
  const lastAt = new Map(callEntries.map((e) => [e, Date.parse(tsOf.get(e.records[e.records.length - 1]!) ?? e.at)]))
  for (const c of [...checkpoints].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))) {
    const t = Date.parse(c.createdAt)
    if (!Number.isFinite(t)) continue
    const within = callEntries.find((e) => !e.checkpoint && Date.parse(e.at) - 1000 <= t && t <= (lastAt.get(e) ?? 0))
    const next = within ?? callEntries.find((e) => !e.checkpoint && Date.parse(e.at) >= t)
    if (next) next.checkpoint = c
  }
  return entries
}
