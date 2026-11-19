import { useEffect, useState } from "react"
import { api } from "../lib/api"

/**
 * D-090: how long Claude's work takes per change, measured, as a range, against your own baseline (the same period
 * just before), overall and by project. Worked out on this computer from its own usage data.
 */
interface Band {
  low: number
  median: number
  high: number
}
interface Estimate {
  samples: number
  enough: boolean
  minutes?: Band
}
interface Row {
  project: string
  now: Estimate
  baseline: Estimate
  trend: "faster" | "slower" | "about the same" | "not enough history"
}
interface Data {
  days: number
  overall: Row
  projects: Row[]
}

const range = (e: Estimate) =>
  e.enough && e.minutes ? `${e.minutes.low} to ${e.minutes.high} minutes (typically ${e.minutes.median}) over ${e.samples} sessions` : `not enough history (${e.samples} of 5 sessions)`

export function timeText(r: Row, days: number): string {
  const trend = r.trend === "not enough history" ? "" : ` That is ${r.trend === "about the same" ? "about the same as" : `${r.trend} than`} your baseline.`
  return `${r.project}: a change took ${range(r.now)} in the last ${days} days; ${range(r.baseline)} in the ${days} days before.${trend}`
}

export function MeasuredTime({ days }: { days: number }) {
  const [d, setD] = useState<Data>()
  useEffect(() => {
    void api<Data>("GET", `/api/insights/time?days=${Math.max(7, days)}`).then((r) => setD(r.ok ? r.data : undefined))
  }, [days])
  if (!d || (!d.overall.now.samples && !d.overall.baseline.samples)) return null
  return (
    <section aria-label="Measured time" className="grid gap-2">
      <h2 className="m-0 text-[18px]">Measured time per change</h2>
      <p className="m-0 max-w-[720px] text-[13px] text-mut">
        Claude&apos;s own time on each change, measured, against your baseline: the same measure over the period before. Worked out on this computer.
      </p>
      <ul className="m-0 grid list-none gap-1 p-0 text-[13px]">
        {[d.overall, ...d.projects.slice(0, 10)].map((r) => (
          <li key={r.project} className={r === d.overall ? "font-semibold" : ""}>
            {timeText(r, d.days)}
          </li>
        ))}
      </ul>
    </section>
  )
}
