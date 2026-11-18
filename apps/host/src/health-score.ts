/**
 * E-099 (expansion, Wave E1): the health score. Seven factors, each with its last 30 days by day and where to look:
 *   canaries      the invariant canaries' runs (E-100), from the audit log
 *   crashes       starts after the Host stopped unexpectedly (E-096), from the audit log
 *   memory        sessions refused because memory was short, from the audit log
 *   flaky         test files that passed only on their retry (a developer's machine: dev-checks.json)
 *   gate          the gate's results (a developer's machine: dev-checks.json)
 *   updates       whether the update check works
 *   audit         whether the audit chain verifies
 * The overall status is the worst factor's, never a weighted sum: one failing factor is never hidden by six good ones.
 * A factor with nothing to go on is "none" and does not count.
 */
import fs from "node:fs"
import path from "node:path"
import type { FastifyInstance } from "fastify"
import { listAuditFiles, verifyAudit } from "@gatehouse/shared/audit"

export type FactorState = "ok" | "warn" | "fail" | "none"
export type FactorId = "canaries" | "crashes" | "memory" | "flaky" | "gate" | "updates" | "audit"

export interface Factor {
  id: FactorId
  label: string
  state: FactorState
  detail: string
  /** Incidents each day, oldest first, the last 30 days. */
  trend: number[]
  /** The page that shows where it comes from. */
  source: "doctor" | "audit" | "settings"
}

export interface HealthScore {
  state: Exclude<FactorState, "none">
  factors: Factor[]
  at: string
}

export const DAYS = 30
const DAY = 24 * 60 * 60_000

export interface DevChecks {
  flaky?: Array<{ file: string; at: string }>
  gates?: Array<{ ok: boolean; at: string }>
}

interface Rec {
  ts: number
  event: string
  input?: Record<string, unknown>
}

/** The audit records of the last `DAYS` days with one of these events, read from the newest month files only. */
export function recentRecords(dir: string, events: ReadonlySet<string>, now: number): Rec[] {
  const from = now - DAYS * DAY
  const out: Rec[] = []
  let files: string[] = []
  try {
    files = listAuditFiles(dir)
  } catch {
    return out
  }
  // Each file is a month: two are enough for thirty days.
  for (const file of files.slice(-2)) {
    let text = ""
    try {
      text = fs.readFileSync(path.join(dir, file), "utf8")
    } catch {
      continue
    }
    for (const line of text.split("\n")) {
      if (!line) continue
      // Cheap first: most records are something else.
      if (![...events].some((e) => line.includes(`"${e}"`))) continue
      try {
        const r = JSON.parse(line) as { ts?: string; event?: string; input?: Record<string, unknown> }
        const ts = Date.parse(r.ts ?? "")
        if (r.event && events.has(r.event) && ts >= from) out.push({ ts, event: r.event, ...(r.input ? { input: r.input } : {}) })
      } catch {
        // a torn line: left out
      }
    }
  }
  return out
}

/** Counts by day, oldest first. */
export function byDay(times: number[], now: number): number[] {
  const out = new Array<number>(DAYS).fill(0)
  for (const t of times) {
    const back = Math.floor((now - t) / DAY)
    if (back >= 0 && back < DAYS) out[DAYS - 1 - back]! += 1
  }
  return out
}

const rank: Record<FactorState, number> = { none: 0, ok: 1, warn: 2, fail: 3 }

/** The worst factor's state; all "none" is ok. */
export function overall(factors: Factor[]): HealthScore["state"] {
  const worst = factors.reduce<FactorState>((w, f) => (rank[f.state] > rank[w] ? f.state : w), "none")
  return worst === "none" ? "ok" : worst
}

export function healthScore(o: {
  records: Rec[]
  dev?: DevChecks
  updates?: { checkError?: string }
  auditOk: boolean
  now: number
}): HealthScore {
  const { now } = o
  const recent = (t: number, days: number) => now - t < days * DAY
  const of = (event: string) => o.records.filter((r) => r.event === event)

  const runs = of("canary_run").sort((a, b) => a.ts - b.ts)
  const failedRuns = runs.filter((r) => Number(r.input?.failed ?? 0) > 0)
  const last = runs.at(-1)
  const canaries: Factor = {
    id: "canaries",
    label: "Safety checks",
    source: "doctor",
    trend: byDay(failedRuns.map((r) => r.ts), now),
    ...(!last
      ? { state: "none", detail: "No run in the last 30 days." }
      : Number(last.input?.failed ?? 0) > 0
        ? { state: "fail", detail: "The last run had a check failing, so no session starts." }
        : failedRuns.length
          ? { state: "warn", detail: `All passed at the last run; ${failedRuns.length} run${failedRuns.length === 1 ? "" : "s"} in 30 days had one failing.` }
          : { state: "ok", detail: `Every run passed (${runs.length} in 30 days).` }),
  }

  const crashTimes = of("host_crash_restart").map((r) => r.ts)
  const crashes: Factor = {
    id: "crashes",
    label: "Unexpected stops",
    source: "doctor",
    trend: byDay(crashTimes, now),
    ...(crashTimes.some((t) => recent(t, 1))
      ? { state: "warn", detail: `Codehouse stopped unexpectedly ${crashTimes.filter((t) => recent(t, 1)).length} time(s) in the last day.` }
      : { state: "ok", detail: crashTimes.length ? `${crashTimes.length} in 30 days, none in the last day.` : "None in 30 days." }),
  }

  const memTimes = of("memory_refused").map((r) => r.ts)
  const memory: Factor = {
    id: "memory",
    label: "Memory",
    source: "settings",
    trend: byDay(memTimes, now),
    ...(memTimes.some((t) => recent(t, 1))
      ? { state: "warn", detail: `A session was refused for short memory ${memTimes.filter((t) => recent(t, 1)).length} time(s) in the last day.` }
      : { state: "ok", detail: memTimes.length ? `${memTimes.length} refusal(s) in 30 days, none in the last day.` : "No session refused for memory in 30 days." }),
  }

  const flakyTimes = (o.dev?.flaky ?? []).map((f) => Date.parse(f.at)).filter((t) => recent(t, DAYS))
  const flakyFiles = new Set((o.dev?.flaky ?? []).filter((f) => recent(Date.parse(f.at), 7)).map((f) => f.file))
  const flaky: Factor = {
    id: "flaky",
    label: "Flaky test files",
    source: "doctor",
    trend: byDay(flakyTimes, now),
    ...(o.dev?.flaky === undefined
      ? { state: "none", detail: "Not a development computer: no test runs here." }
      : flakyFiles.size
        ? { state: "warn", detail: `${flakyFiles.size} file(s) passed only on their retry this week: ${[...flakyFiles].slice(0, 3).join(", ")}${flakyFiles.size > 3 ? " and more" : ""}.` }
        : { state: "ok", detail: "No test file needed its retry this week." }),
  }

  const gates = (o.dev?.gates ?? []).filter((g) => recent(Date.parse(g.at), DAYS)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  const gate: Factor = {
    id: "gate",
    label: "Gate results",
    source: "doctor",
    trend: byDay(gates.filter((g) => !g.ok).map((g) => Date.parse(g.at)), now),
    ...(!gates.length
      ? { state: "none", detail: "No gate run here in 30 days." }
      : gates.at(-1)!.ok
        ? { state: "ok", detail: `The last gate passed (${gates.filter((g) => g.ok).length} of ${gates.length} in 30 days).` }
        : { state: "warn", detail: "The last gate failed." }),
  }

  const updates: Factor = {
    id: "updates",
    label: "Updates",
    source: "settings",
    trend: new Array<number>(DAYS).fill(0),
    ...(o.updates === undefined
      ? { state: "none", detail: "Updates are not checked here." }
      : o.updates.checkError
        ? { state: "warn", detail: `The last update check did not work: ${o.updates.checkError}` }
        : { state: "ok", detail: "Updates are checked as they should be." }),
  }

  const audit: Factor = {
    id: "audit",
    label: "Audit log",
    source: "audit",
    trend: new Array<number>(DAYS).fill(0),
    ...(o.auditOk ? { state: "ok", detail: "The audit chain verifies." } : { state: "fail", detail: "The audit chain does not verify." }),
  }

  const factors = [canaries, crashes, memory, flaky, gate, updates, audit]
  return { state: overall(factors), factors, at: new Date(now).toISOString() }
}

export const HEALTH_EVENTS = new Set(["canary_run", "host_crash_restart", "memory_refused"])

/** dev-checks.json in the data folder: written by the test runner and the gate on a developer's computer. */
export function readDevChecks(dataDir: string): DevChecks | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, "dev-checks.json"), "utf8")) as DevChecks
  } catch {
    return undefined
  }
}

/** GET /api/health-score, worked out at most once a minute. */
export function registerHealthScoreRoutes(
  app: FastifyInstance,
  ctx: { auditDir: string; dataDir: string; updates?: () => { checkError?: string } | undefined },
): void {
  let cached: { at: number; value: HealthScore } | undefined
  app.get("/api/health-score", async () => {
    const now = Date.now()
    if (cached && now - cached.at < 60_000) return cached.value
    const dev = readDevChecks(ctx.dataDir)
    const updates = ctx.updates?.()
    const value = healthScore({
      records: recentRecords(ctx.auditDir, HEALTH_EVENTS, now),
      ...(dev ? { dev } : {}),
      ...(updates ? { updates } : {}),
      auditOk: verifyAudit(ctx.auditDir).ok,
      now,
    })
    cached = { at: now, value }
    return value
  })
}
