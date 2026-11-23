/**
 * E-054, a night shift planner and morning report (Expansion E4). At the end of the day you queue tasks, each with the
 * tasks it depends on, a budget and whether it runs with Extreme approval. They run overnight, a task only once the
 * tasks it depends on are done (one whose dependency failed is skipped), each through the scheduler (E-049) and with
 * its budget as the session's spend cap. The night's budget stops the run when it is reached: no task starts after
 * that. The morning report gives each task's status, its evidence (claims Verified or Contradicted, D-009), its cost and
 * the decisions still waiting for you.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

export interface NightTask {
  id: string
  prompt: string
  folder: string
  dependsOn?: string[]
  /** Its spend cap, in US dollars. */
  budgetUsd?: number
  extreme?: boolean
}

export type TaskStatus = "waiting" | "running" | "done" | "failed" | "skipped" | "not run"

export interface TaskOutcome {
  status: TaskStatus
  sessionId?: string
  costUsd: number
  why?: string
}

export interface NightRun {
  id: string
  tasks: NightTask[]
  budgetUsd: number
  outcomes: Record<string, TaskOutcome>
  startedAt?: string
  endedAt?: string
  stopped?: string
}

/** Tasks in an order where each comes after those it depends on; why not, when a dependency is missing or circular. */
export function order(tasks: NightTask[]): { order: string[] } | { problem: string } {
  const ids = new Set(tasks.map((t) => t.id))
  for (const t of tasks) for (const d of t.dependsOn ?? []) if (!ids.has(d)) return { problem: `${t.id} depends on ${d}, which is not queued` }
  const out: string[] = []
  const state = new Map<string, "visiting" | "done">()
  const visit = (id: string): string | undefined => {
    if (state.get(id) === "done") return undefined
    if (state.get(id) === "visiting") return `the tasks depend on each other in a circle, through ${id}`
    state.set(id, "visiting")
    for (const d of tasks.find((t) => t.id === id)!.dependsOn ?? []) {
      const p = visit(d)
      if (p) return p
    }
    state.set(id, "done")
    out.push(id)
    return undefined
  }
  for (const t of tasks) {
    const p = visit(t.id)
    if (p) return { problem: p }
  }
  return { order: out }
}

export interface NightDeps {
  /** Runs a task's session to its end; its cost, and whether it ended well. */
  runTask: (t: NightTask) => Promise<{ sessionId: string; ok: boolean; costUsd: number; why?: string }>
  save: (run: NightRun) => void
}

export function newNight(tasks: NightTask[], budgetUsd: number): NightRun {
  return { id: crypto.randomBytes(6).toString("hex"), tasks, budgetUsd, outcomes: Object.fromEntries(tasks.map((t) => [t.id, { status: "waiting" as TaskStatus, costUsd: 0 }])) }
}

/** Runs the night: in dependency order, within the night's budget. */
export async function runNight(run: NightRun, d: NightDeps, now = () => new Date()): Promise<NightRun> {
  const o = order(run.tasks)
  const r: NightRun = { ...run, outcomes: { ...run.outcomes }, startedAt: now().toISOString() }
  if ("problem" in o) {
    r.stopped = `The night did not start: ${o.problem}.`
    for (const t of r.tasks) r.outcomes[t.id] = { status: "not run", costUsd: 0, why: o.problem }
    r.endedAt = now().toISOString()
    d.save(r)
    return r
  }
  const spent = () => Object.values(r.outcomes).reduce((s, x) => s + x.costUsd, 0)
  for (const id of o.order) {
    const t = r.tasks.find((x) => x.id === id)!
    const failedDep = (t.dependsOn ?? []).find((dep) => r.outcomes[dep]?.status !== "done")
    if (failedDep) {
      r.outcomes[id] = { status: "skipped", costUsd: 0, why: `${failedDep} did not finish` }
      d.save(r)
      continue
    }
    if (r.stopped || spent() >= r.budgetUsd) {
      r.stopped ??= `The night's budget of $${r.budgetUsd} was reached, so no more tasks started.`
      r.outcomes[id] = { status: "not run", costUsd: 0, why: "the night's budget was reached" }
      d.save(r)
      continue
    }
    r.outcomes[id] = { status: "running", costUsd: 0 }
    d.save(r)
    // A task's own cap is never more than what is left of the night's budget.
    const left = r.budgetUsd - spent()
    const capped = { ...t, budgetUsd: Math.min(t.budgetUsd ?? left, left) }
    const x = await d.runTask(capped).catch((e: Error) => ({ sessionId: "", ok: false, costUsd: 0, why: e.message }))
    r.outcomes[id] = { status: x.ok ? "done" : "failed", sessionId: x.sessionId, costUsd: x.costUsd, ...(x.why ? { why: x.why } : {}) }
    d.save(r)
  }
  r.endedAt = now().toISOString()
  d.save(r)
  return r
}

export interface ReportLine {
  task: string
  status: TaskStatus
  costUsd: number
  evidence: string
  openDecisions: number
  why?: string
}

/** The morning report: each task's status, evidence, cost and the decisions still waiting. */
export function morningReport(
  run: NightRun,
  info: (sessionId: string) => { claims?: Array<{ outcome: string }> } | undefined,
  pending: (sessionId: string) => number,
): { lines: ReportLine[]; totalUsd: number; stopped?: string } {
  const lines = run.tasks.map((t) => {
    const o = run.outcomes[t.id]!
    const claims = o.sessionId ? (info(o.sessionId)?.claims ?? []) : []
    const v = claims.filter((c) => c.outcome === "verified").length
    const c = claims.filter((c) => c.outcome === "contradicted").length
    const evidence = !claims.length ? "no claims checked" : `${v} Verified, ${c} Contradicted, ${claims.length - v - c} Unverified`
    return { task: t.id, status: o.status, costUsd: Math.round(o.costUsd * 100) / 100, evidence, openDecisions: o.sessionId ? pending(o.sessionId) : 0, ...(o.why ? { why: o.why } : {}) }
  })
  return { lines, totalUsd: Math.round(lines.reduce((s, l) => s + l.costUsd, 0) * 100) / 100, ...(run.stopped ? { stopped: run.stopped } : {}) }
}

/** Night runs, in the data folder. */
export class NightStore {
  constructor(readonly file: string) {}
  all(): NightRun[] {
    try {
      return (JSON.parse(fs.readFileSync(this.file, "utf8")) as { runs?: NightRun[] }).runs ?? []
    } catch {
      return []
    }
  }
  save(r: NightRun): void {
    const runs = [...this.all().filter((x) => x.id !== r.id), r].slice(-30)
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify({ v: 1, runs }, null, 1))
    fs.renameSync(`${this.file}.tmp`, this.file)
  }
  latest(): NightRun | undefined {
    return this.all().at(-1)
  }
}
