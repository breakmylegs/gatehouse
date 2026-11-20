/**
 * Uplift phase 3 (owner, 17 Nov): the board across computers and the one inbox. CNW asks each connected computer for
 * its state (its Host's GET /api/state, as the desktop reads it) and keeps only what the board shows: how many
 * sessions are working or waiting, what waits on you, the kill switch and safe mode. Transcripts never reach the board.
 */

/** At risk 85 and over, a request is Severe: allowing it from CNW wants a recent sign-in (owner, 17 Nov). */
export const SEVERE_RISK = 85
/** How recent a sign-in must be to allow a Severe request: five minutes. */
export const FRESH_MS = 5 * 60_000

export interface Waiting {
  computer: string
  computerLabel: string
  requestId: string
  kind: "permission" | "question" | "plan"
  sessionId: string
  project: string
  tool: string
  /** The command, path or address, from the computer's redacted copy, cut to 300 characters. */
  what: string
  reason: string
  ruleId: string
  risk: number
  since: string
  expiresAt?: string
}

export interface BoardRow {
  id: string
  label: string
  /** Tags given on You: the board groups by the first. */
  tags?: string[]
  online: boolean
  lastSeen?: number
  version?: string
  needsUpdate?: "cnw" | "codehouse"
  /** ADR 0020: this computer refused CNW's certificate, and said so (signed), when. */
  refused?: { at: number; reason: "certificate" }
  /** Absent when the computer is offline or did not answer. */
  sessions?: { total: number; working: number; waiting: number }
  waiting: Waiting[]
  kill?: boolean
  safeMode?: boolean
  /** Why there is nothing more: offline, or it did not answer. */
  note?: string
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const str = (v: unknown, max = 300): string => (typeof v === "string" ? v.slice(0, max) : "")

/** The one line that says what a request would do, from its redacted input. */
export function whatOf(tool: string, input: unknown): string {
  const i = obj(input)
  const pick = [i.command, i.file_path, i.path, i.url, i.pattern, i.query, i.description].find((v) => typeof v === "string" && v)
  return str(pick ?? (tool ? tool : ""))
}

/** A computer's GET /api/state, kept to what the board needs. Anything unexpected is left out, never trusted. */
export function summarise(c: { id: string; label: string }, state: unknown): Pick<BoardRow, "sessions" | "waiting" | "kill" | "safeMode"> {
  const s = obj(state)
  const sessions = Array.isArray(s.sessions) ? s.sessions.map(obj) : []
  const pending = Array.isArray(s.pending) ? s.pending.map(obj) : []
  const health = obj(s.health)
  const waiting: Waiting[] = []
  for (const p of pending) {
    const r = obj(p.request)
    const v = obj(r.verdict)
    const requestId = str(r.id, 100)
    if (!requestId) continue
    const kind = r.kind === "question" || r.kind === "plan" ? r.kind : "permission"
    const tool = str(r.toolName, 80)
    waiting.push({
      computer: c.id,
      computerLabel: c.label,
      requestId,
      kind,
      sessionId: str(r.sessionId, 100),
      project: str(r.project, 120),
      tool,
      what: whatOf(tool, r.input),
      reason: str(v.reason, 500),
      ruleId: str(v.ruleId, 120),
      risk: typeof v.risk === "number" && Number.isFinite(v.risk) ? Math.max(0, Math.min(100, Math.round(v.risk))) : 100,
      since: str(r.createdAt, 40),
      ...(typeof p.hardDeadline === "string" ? { expiresAt: str(p.hardDeadline, 40) } : {}),
    })
  }
  const kill = obj(health.killSwitch).engaged === true
  const safeMode = obj(health.safeMode).on === true
  return {
    sessions: {
      total: sessions.filter((x) => x.state !== "ended").length,
      working: sessions.filter((x) => x.state === "running").length,
      waiting: sessions.filter((x) => x.state === "waiting").length,
    },
    waiting,
    ...(kill ? { kill } : {}),
    ...(safeMode ? { safeMode } : {}),
  }
}

/**
 * The board's order: computers with something waiting first (the oldest wait first), then working, then the rest,
 * then those offline. The inbox: every waiting request, oldest first.
 */
export function order(rows: BoardRow[]): { board: BoardRow[]; inbox: Waiting[] } {
  const oldest = (r: BoardRow) => (r.waiting.length ? Math.min(...r.waiting.map((w) => Date.parse(w.since) || Infinity)) : Infinity)
  const rank = (r: BoardRow) => (!r.online ? 3 : r.waiting.length ? 0 : (r.sessions?.working ?? 0) > 0 ? 1 : 2)
  const board = [...rows].sort((a, b) => rank(a) - rank(b) || oldest(a) - oldest(b) || a.label.localeCompare(b.label))
  const inbox = rows.flatMap((r) => r.waiting).sort((a, b) => (Date.parse(a.since) || 0) - (Date.parse(b.since) || 0))
  return { board, inbox }
}
