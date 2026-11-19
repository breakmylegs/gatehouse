import { useEffect, useState } from "react"
import { api } from "../lib/api"

/**
 * D-076 and D-100: what an accepted change costs, by project, with the rework in it (undone changes and failed test
 * runs, and sessions that ended with no change), and an estimate for the next one from that history, with its range
 * and how many sessions it rests on.
 */
interface Band {
  low: number
  median: number
  high: number
}
interface Estimate {
  samples: number
  enough: boolean
  costUsd?: Band
  minutes?: Band
}
interface Project {
  project: string
  costUsd: number
  changes: number
  costPerChange?: number
  undos: number
  failedTestRuns: number
  sessions: number
  sessionsWithoutChange: number
  costWithoutChange: number
  estimate: Estimate
}
interface Data {
  total: { costUsd: number; changes: number; costPerChange?: number; undos: number; failedTestRuns: number }
  projects: Project[]
}

const usd = (n: number) => `$${n < 10 ? n.toFixed(2) : n.toFixed(0)}`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function estimateText(e: Estimate): string {
  if (!e.enough || !e.costUsd)
    return `Not enough history for an estimate yet: ${plural(e.samples, "session")} with a change, and it needs 5.`
  const time = e.minutes ? `, ${e.minutes.low} to ${e.minutes.high} minutes of Claude's time` : ""
  return `A change here usually costs ${usd(e.costUsd.low)} to ${usd(e.costUsd.high)} (typically ${usd(e.costUsd.median)})${time}, from ${plural(e.samples, "session")}.`
}

export function Outcomes({ days }: { days: number }) {
  const [d, setD] = useState<Data>()
  useEffect(() => {
    void api<Data>("GET", `/api/insights/outcomes?days=${days}`).then((r) => setD(r.ok ? r.data : undefined))
  }, [days])
  if (!d || !d.projects.length) return null
  return (
    <section aria-label="Cost per change" className="grid gap-2">
      <h2 className="m-0 text-[18px]">Cost per change</h2>
      <p className="m-0 max-w-[720px] text-[13px] text-mut">
        A change is a commit a session made. Its cost is everything spent in the project, so work later undone, failed test runs and sessions that changed nothing are in it.
      </p>
      <p className="m-0" role="status">
        {d.total.costPerChange !== undefined
          ? `${usd(d.total.costPerChange)} a change: ${usd(d.total.costUsd)} over ${plural(d.total.changes, "change")}, with ${plural(d.total.undos, "undo")} and ${plural(d.total.failedTestRuns, "failed test run")}.`
          : `${usd(d.total.costUsd)} spent and no change committed yet in this period.`}
      </p>
      <ul className="m-0 grid list-none gap-2 p-0 text-[13px]">
        {d.projects.slice(0, 12).map((p) => (
          <li key={p.project} className="grid gap-0.5">
            <span>
              <span className="font-semibold">{p.project}</span>:{" "}
              {p.costPerChange !== undefined ? `${usd(p.costPerChange)} a change (${usd(p.costUsd)} over ${plural(p.changes, "change")})` : `${usd(p.costUsd)}, no change yet`}
              {p.undos || p.failedTestRuns ? `; rework: ${plural(p.undos, "undo")}, ${plural(p.failedTestRuns, "failed test run")}` : ""}
              {p.sessionsWithoutChange ? `; ${plural(p.sessionsWithoutChange, "session")} with no change cost ${usd(p.costWithoutChange)}` : ""}.
            </span>
            <span className="text-mut">{estimateText(p.estimate)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
