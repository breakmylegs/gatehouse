import type { AuditRecord } from "@gatehouse/shared/audit"
import type { UsageReport } from "./usage.js"

/**
 * D-076 (frontier, Insight and evidence): cost per outcome. An outcome is an accepted change: a commit a session made
 * and Codehouse noted (commit_lineage_noted, D-030). Its cost is everything spent in the project over the days asked
 * for, so the spend on work that was later undone, on failing test runs that had to be run again, and in sessions
 * that ended with no change at all is in it, not left out. The rework is shown beside it: undone changes
 * (files_undone, change_undone, edit_files_reverted) and failed test runs (tool_failed of a test).
 *
 * D-100: estimates from that history. A session that made at least one change is one sample (its spend and time per
 * change); an estimate is the middle 80% of the samples (the 10th to the 90th percentile, nearest rank) with the
 * median and the sample size, and with fewer than five samples it says there is not enough history.
 */
export const MIN_SAMPLES = 5

type Rec = Pick<AuditRecord, "event" | "session" | "inputJson"> & { project?: string }

export interface Estimate {
  samples: number
  enough: boolean
  costUsd?: { low: number; median: number; high: number }
  minutes?: { low: number; median: number; high: number }
}

export interface ProjectOutcomes {
  project: string
  costUsd: number
  changes: number
  /** Everything spent over the changes made, rework and changeless sessions included; absent with no change. */
  costPerChange?: number
  undos: number
  failedTestRuns: number
  sessions: number
  sessionsWithoutChange: number
  costWithoutChange: number
  estimate: Estimate
}

export interface Outcomes {
  from: string
  to: string
  total: { costUsd: number; changes: number; costPerChange?: number; undos: number; failedTestRuns: number }
  projects: ProjectOutcomes[]
}

interface SessionTally {
  project: string
  costUsd: number
  durationMs: number
  changes: number
  undos: number
  failed: number
}

const UNDO = new Set(["files_undone", "change_undone", "edit_files_reverted"])

const isTest = (r: Rec) => {
  try {
    return (JSON.parse(r.inputJson ?? "{}") as { test?: unknown }).test === true
  } catch {
    return false
  }
}

/** The nearest-rank percentile of sorted numbers. */
const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]!

/** An interval and its sample size, or "not enough history" below MIN_SAMPLES. */
export function estimateFrom(costs: number[], minutes: number[]): Estimate {
  const n = costs.length
  if (n < MIN_SAMPLES) return { samples: n, enough: false }
  const band = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b)
    return { low: pct(s, 0.1), median: pct(s, 0.5), high: pct(s, 0.9) }
  }
  return { samples: n, enough: true, costUsd: band(costs), ...(minutes.length === n ? { minutes: band(minutes) } : {}) }
}

/** Outcomes over a usage report's days and the audit records of the same days. */
export function outcomes(report: UsageReport, records: Rec[]): Outcomes {
  const sessions = new Map<string, SessionTally>()
  const of = (id: string, project: string) => {
    let s = sessions.get(id)
    if (!s) sessions.set(id, (s = { project, costUsd: 0, durationMs: 0, changes: 0, undos: 0, failed: 0 }))
    return s
  }
  for (const cells of Object.values(report.days))
    for (const [id, cell] of Object.entries(cells)) {
      const s = of(id, cell.project)
      s.costUsd += cell.total.costUsd
      s.durationMs += cell.total.durationMs
    }
  for (const r of records) {
    if (!r.session) continue
    const known = sessions.get(r.session)
    // A session that spent nothing in these days still counts its changes, under the project the record names.
    const s = known ?? (r.project ? of(r.session, r.project) : undefined)
    if (!s) continue
    if (r.event === "commit_lineage_noted") s.changes++
    else if (UNDO.has(r.event)) s.undos++
    else if (r.event === "tool_failed" && isTest(r)) s.failed++
  }
  const byProject = new Map<string, SessionTally[]>()
  for (const s of sessions.values()) byProject.set(s.project, [...(byProject.get(s.project) ?? []), s])
  const round = (n: number) => Math.round(n * 10000) / 10000
  const projects: ProjectOutcomes[] = []
  for (const [project, list] of byProject) {
    const costUsd = list.reduce((a, s) => a + s.costUsd, 0)
    const changes = list.reduce((a, s) => a + s.changes, 0)
    const without = list.filter((s) => !s.changes)
    const withChange = list.filter((s) => s.changes > 0)
    projects.push({
      project,
      costUsd: round(costUsd),
      changes,
      ...(changes ? { costPerChange: round(costUsd / changes) } : {}),
      undos: list.reduce((a, s) => a + s.undos, 0),
      failedTestRuns: list.reduce((a, s) => a + s.failed, 0),
      sessions: list.length,
      sessionsWithoutChange: without.length,
      costWithoutChange: round(without.reduce((a, s) => a + s.costUsd, 0)),
      estimate: estimateFrom(
        withChange.map((s) => round(s.costUsd / s.changes)),
        withChange.filter((s) => s.durationMs > 0).map((s) => Math.round(s.durationMs / s.changes / 60_000)),
      ),
    })
  }
  projects.sort((a, b) => b.costUsd - a.costUsd || a.project.localeCompare(b.project))
  const costUsd = projects.reduce((a, p) => a + p.costUsd, 0)
  const changes = projects.reduce((a, p) => a + p.changes, 0)
  return {
    from: report.from,
    to: report.to,
    total: {
      costUsd: round(costUsd),
      changes,
      ...(changes ? { costPerChange: round(costUsd / changes) } : {}),
      undos: projects.reduce((a, p) => a + p.undos, 0),
      failedTestRuns: projects.reduce((a, p) => a + p.failedTestRuns, 0),
    },
    projects,
  }
}
