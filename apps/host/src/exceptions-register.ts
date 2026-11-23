/**
 * E-078, the policy exceptions register (Expansion E6). Every grant you made (a remembered rule, C-013) with who granted
 * it and how, why (the request it answered), its scope (the tool and what it covers, the project, the folder, the uses
 * allowed) and its expiry; and the recent exceptions to the rules the audit log holds (a tool allowed for a whole
 * session, a policy regression accepted, a test lock lifted). A grant that expires within three days gets a reminder,
 * tomorrow's and today's first. The register exports as CSV. Grants made before this was built have no record of who
 * or why, and say so.
 */
import type { AuditRecord } from "@gatehouse/shared/audit"

export interface GrantRow {
  id: string
  tool: string
  covers: string
  project?: string
  folder?: string
  maxUses?: number
  createdAt?: string
  expiresAt?: string
  grantedBy: string
  why: string
}

export interface ExceptionRow {
  at: string
  kind: string
  project?: string
  who: string
  why: string
}

export interface Reminder {
  id: string
  expiresAt: string
  inDays: number
  text: string
}

export const GRANT_EVENT = "grant_made"
const EXCEPTION_EVENTS: Record<string, string> = {
  tool_granted: "a tool allowed for a whole session",
  policy_regression_accepted: "a policy regression accepted",
  test_lock_lifted: "a test lock lifted",
  loosening_applied: "a loosening of the rules",
}

/** A record's input, as it was stored (redacted, as JSON). */
const inputOf = (r: AuditRecord): Record<string, unknown> | undefined => {
  try {
    const v = JSON.parse(r.inputJson) as unknown
    return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

const who = (r: AuditRecord) => (r.channel === "phone" ? "you, on the phone" : r.channel === "desktop" ? "you, on the desktop" : r.channel === "push" ? "you, from a notification" : `Codehouse (${r.channel})`)

export function register(o: {
  entries: Array<{ id: string; tool: string; command?: string; path?: string; host?: string; project?: string; createdAt?: string }>
  limits: Record<string, { expiresAt?: string; scope?: string; maxUses?: number }>
  records: AuditRecord[]
}): { grants: GrantRow[]; exceptions: ExceptionRow[] } {
  const made = new Map<string, AuditRecord>()
  for (const r of o.records) {
    const id = inputOf(r)?.id
    if ((r.event === GRANT_EVENT || r.event === "remember_added") && typeof id === "string") made.set(id, r)
  }
  const grants = o.entries.map((e) => {
    const l = o.limits[e.id] ?? {}
    const rec = made.get(e.id) ?? made.get(`remember-${e.id}`)
    const why = rec ? inputOf(rec)?.why : undefined
    return {
      id: e.id,
      tool: e.tool,
      covers: e.command ?? e.path ?? e.host ?? "",
      ...(e.project ? { project: e.project } : {}),
      ...(l.scope ? { folder: l.scope } : {}),
      ...(typeof l.maxUses === "number" ? { maxUses: l.maxUses } : {}),
      ...(e.createdAt ? { createdAt: e.createdAt } : {}),
      ...(l.expiresAt ? { expiresAt: l.expiresAt } : {}),
      grantedBy: rec ? who(rec) : "not recorded (made before the register)",
      why: typeof why === "string" ? why : rec ? rec.verdict.reason : "not recorded",
    }
  })
  const exceptions = o.records
    .filter((r) => EXCEPTION_EVENTS[r.event])
    .map((r) => ({ at: r.ts, kind: EXCEPTION_EVENTS[r.event]!, ...(r.project ? { project: r.project } : {}), who: who(r), why: r.verdict.reason }))
    .sort((a, b) => b.at.localeCompare(a.at))
  return { grants, exceptions }
}

/** Grants that expire within `days` (three by default), soonest first; an expired one is not a reminder. */
export function reminders(grants: GrantRow[], now = new Date(), days = 3): Reminder[] {
  return grants
    .filter((g) => g.expiresAt && Date.parse(g.expiresAt) > now.getTime() && Date.parse(g.expiresAt) - now.getTime() <= days * 86_400_000)
    .map((g) => {
      const inDays = Math.max(0, Math.round((startOfDay(new Date(g.expiresAt!)) - startOfDay(now)) / 86_400_000))
      return { id: g.id, expiresAt: g.expiresAt!, inDays, text: `The grant for ${g.tool} ${g.covers} ends ${inDays === 0 ? "today" : inDays === 1 ? "tomorrow" : `in ${inDays} days`}${g.project ? `, in ${g.project}` : ""}. Renew it, or let it go.` }
    })
    .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

const cell = (s: string | number | undefined) => {
  const v = String(s ?? "")
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function registerCsv(r: { grants: GrantRow[]; exceptions: ExceptionRow[] }): string {
  const rows = [
    ["kind", "id", "tool", "covers", "project", "folder", "max uses", "created", "expires", "granted by", "why"],
    ...r.grants.map((g) => ["grant", g.id, g.tool, g.covers, g.project, g.folder, g.maxUses, g.createdAt, g.expiresAt, g.grantedBy, g.why]),
    ...r.exceptions.map((e) => ["exception", "", "", e.kind, e.project, "", "", e.at, "", e.who, e.why]),
  ]
  return rows.map((row) => row.map((c) => cell(c as string | number | undefined)).join(",")).join("\r\n") + "\r\n"
}
