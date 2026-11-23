/**
 * E-063, the effort and billing log (Expansion E5). For each project and day: your active time (a minute counts once
 * when you worked in one of the project's sessions in it: typed, clicked, sent a prompt or answered a request), the
 * agent's time (each turn's duration) and the cost (the change in each session's reported cost). It exports as CSV for
 * a timesheet or an invoice, stays in a file on this computer, and can be deleted, a project's or all of it. Nothing in
 * it is sent anywhere: this module only reads and writes its own file.
 */
import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "@gatehouse/shared/node"
import { localDay } from "./usage.js"

export interface EffortDay {
  humanMs: number
  agentMs: number
  costUsd: number
}

interface EffortFile {
  /** Day (YYYY-MM-DD), then project. */
  days: Record<string, Record<string, EffortDay>>
}

const MINUTE = 60_000
const zero = (): EffortDay => ({ humanMs: 0, agentMs: 0, costUsd: 0 })

export class EffortLog {
  readonly #file: string | undefined
  readonly #now: () => Date
  #data: EffortFile = { days: {} }
  /** The minute last counted for each project, so a minute counts once. */
  readonly #lastMinute = new Map<string, number>()
  /** Each session's cumulative cost last seen, to turn it into changes. */
  readonly #lastCost = new Map<string, number>()
  #writing: Promise<void> = Promise.resolve()

  constructor(file?: string, now: () => Date = () => new Date()) {
    this.#file = file
    this.#now = now
    if (file && fs.existsSync(file)) {
      try {
        const v = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<EffortFile> & Record<string, unknown>
        // Read tolerantly: what a newer version added is kept.
        if (v && typeof v.days === "object" && v.days) this.#data = { ...v, days: v.days }
      } catch {
        // A damaged log starts again empty, as the usage file does.
      }
    }
  }

  #day(project: string): EffortDay {
    return ((this.#data.days[localDay(this.#now())] ??= {})[project] ??= zero())
  }

  /** You were active in a project's session now. */
  active(project: string): void {
    const minute = Math.floor(this.#now().getTime() / MINUTE)
    if (this.#lastMinute.get(project) === minute) return
    this.#lastMinute.set(project, minute)
    this.#day(project).humanMs += MINUTE
    void this.flush()
  }

  /** A turn's result: its duration is agent time; the cost is cumulative per session, so only the change is added. */
  turn(sessionId: string, project: string, result: Record<string, unknown>): void {
    const d = this.#day(project)
    if (typeof result.duration_ms === "number" && result.duration_ms > 0) d.agentMs += result.duration_ms
    if (typeof result.total_cost_usd === "number") {
      const before = this.#lastCost.get(sessionId)
      const add = before === undefined || result.total_cost_usd < before ? result.total_cost_usd : result.total_cost_usd - before
      this.#lastCost.set(sessionId, result.total_cost_usd)
      d.costUsd += add
    }
    void this.flush()
  }

  /** The log as CSV, one row a day and project, then the totals; only `project` when given, and only from..to (both included). */
  csv(o: { project?: string; from?: string; to?: string } = {}): string {
    const rows: string[] = ["date,project,human_minutes,agent_minutes,cost_usd"]
    const total = zero()
    for (const day of Object.keys(this.#data.days).sort()) {
      if ((o.from && day < o.from) || (o.to && day > o.to)) continue
      for (const project of Object.keys(this.#data.days[day]!).sort()) {
        if (o.project && project !== o.project) continue
        const e = this.#data.days[day]![project]!
        total.humanMs += e.humanMs
        total.agentMs += e.agentMs
        total.costUsd += e.costUsd
        rows.push([day, cell(project), minutes(e.humanMs), minutes(e.agentMs), e.costUsd.toFixed(2)].join(","))
      }
    }
    rows.push(["total", o.project ? cell(o.project) : "", minutes(total.humanMs), minutes(total.agentMs), total.costUsd.toFixed(2)].join(","))
    return rows.join("\r\n") + "\r\n"
  }

  /** Deletes a project's records, or all of them, and says how many days it held. */
  async delete(project?: string): Promise<number> {
    let n = 0
    for (const [day, byProject] of Object.entries(this.#data.days)) {
      for (const p of Object.keys(byProject)) {
        if (project !== undefined && p !== project) continue
        delete byProject[p]
        n++
      }
      if (!Object.keys(byProject).length) delete this.#data.days[day]
    }
    if (project === undefined) this.#lastMinute.clear()
    else this.#lastMinute.delete(project)
    await this.flush()
    return n
  }

  async flush(): Promise<void> {
    const file = this.#file
    if (!file) return
    const text = JSON.stringify(this.#data, null, 2) + "\n"
    this.#writing = this.#writing.then(async () => {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      await writeFileAtomic(file, text)
    })
    await this.#writing.catch(() => undefined)
  }
}

const minutes = (ms: number) => (Math.round(ms / 6000) / 10).toFixed(1)
/** A project name as a CSV cell: quoted when it needs it, and never read as a formula by a spreadsheet. */
function cell(s: string): string {
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}
