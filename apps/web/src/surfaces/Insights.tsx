import { useCallback, useEffect, useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { toast } from "sonner"
import { api } from "../lib/api"

export interface RuleStats {
  ruleId: string
  evaluated: number
  escalated: number
  approved: number
  denied: number
  timedOut: number
  approvalRate?: number
  medianWaitMs?: number
}
export interface Analytics {
  evaluations: number
  byOutcome: { allow: number; deny: number; escalate: number }
  escalationRate: number
  judgeAllowed: number
  byRule: RuleStats[]
  human: { answered: number; approved: number; denied: number; timedOut: number }
  byChannel: { desktop: number; phone: number }
  timeToDecideMs: { count: number; p50?: number; p90?: number; max?: number }
  perDay: Array<{ day: string; allow: number; deny: number; escalate: number }>
}
interface Suggestion {
  candidate: { tool: string; command?: string; path?: string }
  preview: string
  approvals: number
  lastSeen: string
  ruleIds: string[]
}

export const seconds = (ms: number | undefined) =>
  ms === undefined
    ? "none yet"
    : ms < 1000
      ? "under a second"
      : ms < 90_000
        ? `${Math.round(ms / 1000)} s`
        : `${Math.round(ms / 60_000)} min`
export const percent = (x: number | undefined) =>
  x === undefined ? "no answers" : `${Math.round(x * 100)}%`

export function Insights() {
  const [days, setDays] = useState(30)
  const [a, setA] = useState<Analytics>()
  const [sug, setSug] = useState<Suggestion[]>([])
  const [error, setError] = useState<string>()

  const load = useCallback(async () => {
    const [x, y] = await Promise.all([
      api<Analytics>("GET", `/api/analytics?days=${days}`),
      api<Suggestion[]>("GET", "/api/suggestions"),
    ])
    if (x.ok && x.data) {
      setA(x.data)
      setError(undefined)
    } else setError(x.error ?? "The figures could not be worked out")
    if (y.ok && y.data) setSug(y.data)
  }, [days])
  useEffect(() => {
    void load()
  }, [load])

  async function accept(s: Suggestion) {
    const r = await api("POST", "/api/suggestions/accept", { candidate: s.candidate })
    if (!r.ok) return setError(r.error ?? "That rule could not be added")
    toast("Rule added. It allows exactly that and nothing else.")
    await load()
  }

  if (error && !a)
    return (
      <p role="alert" className="font-semibold text-sev">
        {error}
      </p>
    )
  if (!a) return <p className="text-mut">Working it out…</p>

  const top = a.byRule.filter((r) => r.escalated > 0).slice(0, 8)
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end gap-4">
        <label className="grid gap-1">
          <span className="text-[13px] text-mut">Period</span>
          <select className="field" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </label>
        <p role="status" className="m-0 max-w-[620px]">
          {a.evaluations === 0
            ? "Nothing was decided in this period."
            : `${a.evaluations.toLocaleString("en-GB")} calls were decided. ${a.byOutcome.escalate} (${percent(a.escalationRate)}) asked you. You took a median of ${seconds(a.timeToDecideMs.p50)} to answer, and 9 in 10 within ${seconds(a.timeToDecideMs.p90)}.`}
          {a.judgeAllowed > 0 ? ` The judge allowed ${a.judgeAllowed}.` : ""}
        </p>
      </div>
      {error ? (
        <p role="alert" className="m-0 font-semibold text-sev">
          {error}
        </p>
      ) : null}

      <section aria-label="Asked you, by rule" className="grid gap-2">
        <h2 className="m-0 text-[18px]">What asks you most</h2>
        {top.length === 0 ? (
          <p className="m-0 text-mut">No rule asked you in this period.</p>
        ) : (
          <>
            <div
              role="img"
              aria-label={`Bar chart of requests that asked you, by rule. ${top.map((r) => `${r.ruleId} ${r.escalated}`).join(", ")}.`}
              style={{ height: 40 + top.length * 28 }}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={top} layout="vertical" margin={{ left: 40, right: 24 }}>
                  <CartesianGrid horizontal={false} stroke="var(--c-line)" />
                  <XAxis type="number" allowDecimals={false} stroke="var(--c-mut)" />
                  <YAxis
                    type="category"
                    dataKey="ruleId"
                    width={150}
                    stroke="var(--c-mut)"
                    tick={{ fill: "var(--c-tx)", fontSize: 13 }}
                  />
                  <Tooltip
                    cursor={{ fill: "var(--c-s2)" }}
                    contentStyle={{ background: "var(--c-s1)", border: "1px solid var(--c-line)" }}
                  />
                  <Bar
                    dataKey="escalated"
                    name="Asked you"
                    fill="var(--c-acc)"
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Requests that asked you, by rule</caption>
              <thead>
                <tr className="border-b border-line text-[13px] text-mut">
                  <th className="py-1 pr-3 font-semibold">Rule</th>
                  <th className="py-1 pr-3 text-right font-semibold">Asked</th>
                  <th className="py-1 pr-3 text-right font-semibold">Approved</th>
                  <th className="py-1 pr-3 text-right font-semibold">Denied</th>
                  <th className="py-1 pr-3 text-right font-semibold">Timed out</th>
                  <th className="py-1 pr-3 text-right font-semibold">Approval rate</th>
                  <th className="py-1 text-right font-semibold">Median wait</th>
                </tr>
              </thead>
              <tbody>
                {top.map((r) => (
                  <tr key={r.ruleId} className="border-b border-line">
                    <td className="mono py-1 pr-3">{r.ruleId}</td>
                    <td className="py-1 pr-3 text-right">{r.escalated}</td>
                    <td className="py-1 pr-3 text-right">{r.approved}</td>
                    <td className="py-1 pr-3 text-right">{r.denied}</td>
                    <td className="py-1 pr-3 text-right">{r.timedOut}</td>
                    <td className="py-1 pr-3 text-right">{percent(r.approvalRate)}</td>
                    <td className="py-1 text-right">{seconds(r.medianWaitMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section aria-label="Each day" className="grid gap-2">
        <h2 className="m-0 text-[18px]">Each day</h2>
        {a.perDay.length === 0 ? (
          <p className="m-0 text-mut">No days to show.</p>
        ) : (
          <div
            role="img"
            aria-label="Stacked bar chart of calls each day: allowed automatically, blocked by policy, and asked you."
            style={{ height: 220 }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={a.perDay}>
                <CartesianGrid vertical={false} stroke="var(--c-line)" />
                <XAxis
                  dataKey="day"
                  stroke="var(--c-mut)"
                  tickFormatter={(d: string) => d.slice(5)}
                />
                <YAxis allowDecimals={false} stroke="var(--c-mut)" />
                <Tooltip
                  cursor={{ fill: "var(--c-s2)" }}
                  contentStyle={{ background: "var(--c-s1)", border: "1px solid var(--c-line)" }}
                />
                <Legend />
                <Bar
                  dataKey="allow"
                  name="Allowed automatically"
                  stackId="d"
                  fill="var(--c-ok)"
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="deny"
                  name="Blocked by policy"
                  stackId="d"
                  fill="var(--c-sev)"
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="escalate"
                  name="Asked you"
                  stackId="d"
                  fill="var(--c-acc)"
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <details>
          <summary className="cursor-pointer">Show the figures as a table</summary>
          <table className="mt-2 w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line text-[13px] text-mut">
                <th className="py-1 pr-3 font-semibold">Day</th>
                <th className="py-1 pr-3 text-right font-semibold">Allowed</th>
                <th className="py-1 pr-3 text-right font-semibold">Blocked</th>
                <th className="py-1 text-right font-semibold">Asked you</th>
              </tr>
            </thead>
            <tbody>
              {a.perDay.map((d) => (
                <tr key={d.day} className="border-b border-line">
                  <td className="py-1 pr-3">{d.day}</td>
                  <td className="py-1 pr-3 text-right">{d.allow}</td>
                  <td className="py-1 pr-3 text-right">{d.deny}</td>
                  <td className="py-1 text-right">{d.escalate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>

      <section aria-label="Suggested rules" className="grid gap-2">
        <h2 className="m-0 text-[18px]">Suggested rules</h2>
        <p className="m-0 text-mut">
          Calls you approved at least three times and never refused. Each suggestion allows one
          exact command or one exact file, nothing wider, and is checked again when you add it. Only
          you can add one, here on the desktop.
        </p>
        {sug.length === 0 ? (
          <p className="m-0">No suggestions yet.</p>
        ) : (
          <ul className="m-0 list-none divide-y divide-line border-y border-line p-0">
            {sug.map((s) => (
              <li
                key={JSON.stringify(s.candidate)}
                className="grid grid-cols-[1fr_auto] items-center gap-3 py-2"
              >
                <span>
                  <span className="mono block [overflow-wrap:anywhere]">{s.preview}</span>
                  <span className="block text-[13px] text-mut">
                    Approved {s.approvals} times, last on{" "}
                    {new Date(s.lastSeen).toLocaleDateString("en-GB")}. Usually asked by{" "}
                    {s.ruleIds.join(", ")}.
                  </span>
                </span>
                <button className="btn" onClick={() => void accept(s)}>
                  Add this rule
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
