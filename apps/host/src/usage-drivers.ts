/**
 * What drove the usage (B15): for a range of days, how many times each tool was called, which subagents ran and
 * which skills were used, overall and by session. Counted from the audit log, where every tool call is recorded with
 * its session and its (redacted) input, so nothing new is kept. Cost and tokens by model are in UsageStore; Claude
 * Code does not say what each tool cost, so these are counts, not money.
 */
import fs from "node:fs"
import path from "node:path"
import { AuditRecord, listAuditFiles } from "@gatehouse/shared/audit"

/** The events a tool call leaves: decided by the rules or you, refused by the floor, or approved by Claude Code. */
const CALL_EVENTS = new Set([
  "decision",
  "human_decision",
  "floor_deny",
  "self_approved",
  "self_approved_failed",
])

export interface Drivers {
  tools: Record<string, number>
  subagents: Record<string, number>
  skills: Record<string, number>
}

export interface DriversReport extends Drivers {
  from: string
  to: string
  bySession: Record<string, Drivers & { project?: string }>
}

const empty = (): Drivers => ({ tools: {}, subagents: {}, skills: {} })
const bump = (m: Record<string, number>, k: string) => void (m[k] = (m[k] ?? 0) + 1)

/** A short name for what a call ran: a subagent's type or a skill's name, from its input. */
function nameIn(inputJson: string, keys: string[]): string | undefined {
  try {
    const v = JSON.parse(inputJson) as Record<string, unknown>
    for (const k of keys) {
      const s = v[k]
      if (typeof s === "string" && s.trim()) return s.trim().slice(0, 80)
    }
  } catch {
    // an input that is not JSON names nothing
  }
  return undefined
}

/** The day of a record in local time, as the Usage page counts days. */
const dayOf = (ts: string) => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function usageDrivers(
  auditDir: string,
  from: string,
  to: string,
  session?: string,
): DriversReport {
  const out: DriversReport = { from, to, ...empty(), bySession: {} }
  const seen = new Set<string>()
  // Month files run YYYY-MM; only those that can hold a day in the range are read, with a day either side, as a file
  // may be named by another clock than the local day.
  const months = new Set<string>()
  const last = new Date(`${to}T00:00:00`)
  last.setDate(last.getDate() + 1)
  const d = new Date(`${from}T00:00:00`)
  d.setDate(d.getDate() - 1)
  for (; d <= last; d.setDate(d.getDate() + 1)) months.add(dayOf(d.toISOString()).slice(0, 7))
  for (const file of listAuditFiles(auditDir)) {
    if (![...months].some((m) => file.includes(m))) continue
    for (const raw of fs.readFileSync(path.join(auditDir, file), "utf8").split("\n")) {
      if (!raw) continue
      let rec: AuditRecord
      try {
        const parsed = AuditRecord.safeParse(JSON.parse(raw))
        if (!parsed.success) continue
        rec = parsed.data
      } catch {
        continue
      }
      if (!CALL_EVENTS.has(rec.event)) continue
      const day = dayOf(rec.ts)
      if (day < from || day > to) continue
      if (session && rec.session !== session) continue
      // One call can leave more than one record (the floor's and the decision's): count it once.
      const key = rec.toolUseId ? `${rec.session}:${rec.toolUseId}` : `seq:${rec.seq}`
      if (seen.has(key)) continue
      seen.add(key)
      const s = (out.bySession[rec.session] ??= {
        ...empty(),
        ...(rec.project ? { project: rec.project } : {}),
      })
      for (const d of [out, s]) {
        bump(d.tools, rec.tool)
        if (rec.tool === "Task" || rec.tool === "Agent")
          bump(d.subagents, nameIn(rec.inputJson, ["subagent_type", "agent"]) ?? "general")
        if (rec.tool === "Skill") {
          const skill = nameIn(rec.inputJson, ["skill", "name", "command"])
          if (skill) bump(d.skills, skill)
        }
      }
    }
  }
  return out
}
