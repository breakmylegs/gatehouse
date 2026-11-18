import { useEffect, useState } from "react"
import { api } from "../lib/api"
import { useStore, type Route } from "../store"

type State = "ok" | "warn" | "fail" | "none"
interface Factor {
  id: string
  label: string
  state: State
  detail: string
  trend: number[]
  source: "doctor" | "audit" | "settings"
}
interface Score {
  state: Exclude<State, "none">
  factors: Factor[]
  at: string
}

const WORD: Record<State, string> = { ok: "Good", warn: "Look at this", fail: "Not right", none: "No data" }
const CLS: Record<State, string> = { ok: "text-ok", warn: "text-warn", fail: "text-sev", none: "text-mut" }

/** Thirty days of incidents as small bars, oldest left; described in words for a screen reader. */
function Trend({ days, label }: { days: number[]; label: string }) {
  const max = Math.max(1, ...days)
  const total = days.reduce((a, b) => a + b, 0)
  return (
    <svg width={days.length * 4} height={18} role="img" aria-label={`${label}: ${total} in 30 days`} className="shrink-0">
      {days.map((n, i) => (
        <rect key={i} x={i * 4} y={18 - Math.max(1, (n / max) * 18)} width={3} height={Math.max(1, (n / max) * 18)} className={n ? "fill-current text-warn" : "fill-current text-line"} />
      ))}
    </svg>
  )
}

/**
 * E-099: the health score. The worst factor decides the whole (one bad factor is never averaged away); each factor
 * shows its last 30 days and opens where it comes from. `compact` is the dashboard's tile.
 */
export function HealthScore({ compact = false }: { compact?: boolean }) {
  const setRoute = useStore((s) => s.setRoute)
  const [score, setScore] = useState<Score>()
  useEffect(() => {
    let gone = false
    void api<Score>("GET", "/api/health-score").then((r) => {
      if (!gone && r.ok && r.data) setScore(r.data)
    })
    return () => {
      gone = true
    }
  }, [])
  if (!score) return compact ? null : <p className="m-0 text-mut">Reading the health score.</p>
  const shown = compact ? score.factors.filter((f) => f.state === "warn" || f.state === "fail") : score.factors
  return (
    <section aria-label="Health" className="grid gap-2">
      <h2 className="dash-h">
        Health: <span className={CLS[score.state]}>{WORD[score.state]}</span>
      </h2>
      {compact && !shown.length ? <p className="m-0 text-[13.5px] text-mut">Every check over the last 30 days is good.</p> : null}
      <ul className="m-0 grid list-none gap-1 p-0">
        {shown.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center gap-3 text-[13.5px]">
            <strong className="min-w-40">{f.label}</strong>
            <span className={`min-w-24 font-semibold ${CLS[f.state]}`}>{WORD[f.state]}</span>
            <Trend days={f.trend} label={f.label} />
            <span className="min-w-0 flex-1">{f.detail}</span>
            <button type="button" className="btn !min-h-7" onClick={() => setRoute(f.source as Route)}>
              {f.source === "audit" ? "Audit log" : f.source === "settings" ? "Settings" : "Doctor"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
