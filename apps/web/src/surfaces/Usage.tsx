import clsx from "clsx"
import { useEffect, useMemo, useState } from "react"
import { api } from "../lib/api"
import { money } from "../lib/format"
import { titleOf } from "../lib/sessionActions"
import {
  niceTicks,
  rangeFor,
  startedAt,
  summarise,
  type Filter,
  type Report,
  type Row,
} from "../lib/usage"
import { useStore } from "../store"

const RANGES = [
  { days: 1, label: "Today" },
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
]

const count = (v: number) =>
  v >= 1_000_000
    ? `${(v / 1_000_000).toFixed(1)}M`
    : v >= 1000
      ? `${(v / 1000).toFixed(1)}K`
      : `${v}`

/**
 * Token use and cost over time, by project, model and session, with filters in one row above it all (owner, 30
 * Oct). The figures come from the Host for the range you choose; every chart has a table view.
 */
export function Usage() {
  const [days, setDays] = useState(7)
  const [filter, setFilter] = useState<Filter>({})
  const [report, setReport] = useState<Report>()
  const [error, setError] = useState<string>()
  const sessions = useStore((s) => s.sessions)
  const allTime = useStore((s) => s.usage?.total)
  const [digest, setDigest] = useState<{ text: string }>()
  useEffect(() => {
    void api<{ text: string }>("GET", "/api/digest").then(
      (r) => r.ok && r.data && setDigest(r.data),
    )
  }, [])

  useEffect(() => {
    let gone = false
    const { from, to } = rangeFor(days)
    void api<Report>("GET", `/api/usage/report?from=${from}&to=${to}`).then((r) => {
      if (gone) return
      if (r.ok && r.data && typeof r.data.days === "object" && r.data.days) {
        setReport({ ...r.data, daysWithoutCells: r.data.daysWithoutCells ?? {} })
        setError(undefined)
      } else setError(r.error ?? "Usage could not be read")
    })
    return () => {
      gone = true
    }
  }, [days])

  const all = useMemo(() => (report ? summarise(report) : undefined), [report])
  const s = useMemo(() => (report ? summarise(report, filter) : undefined), [report, filter])
  const sessionName = (id: string) => {
    const open = sessions[id]
    if (open) return titleOf(open)
    const at = startedAt(id)
    const project = all?.bySession.find((r) => r.key === id)?.project ?? "A session"
    return at
      ? `${project}, ${at.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
      : project
  }
  const set = (k: keyof Filter, v: string) =>
    setFilter((f) => {
      const next = { ...f }
      if (v) next[k] = v
      else delete next[k]
      // A session belongs to one project: choosing another project clears it.
      if (k === "project") delete next.session
      return next
    })

  return (
    <div className="grid max-w-[1100px] gap-5 p-6">
      <div>
        <h1 className="m-0">Usage</h1>
        <p className="m-0 mt-1 text-mut">
          What your sessions spent and used, as Claude Code reports it after each turn.
          {allTime ? ` All time: ${money(allTime.costUsd)}.` : ""}
        </p>
      </div>
      {digest ? (
        <section aria-label="Last 24 hours" className="panel grid gap-1 p-4">
          <h2 className="m-0 text-[16px]">Last 24 hours</h2>
          <p className="m-0">{digest.text}</p>
        </section>
      ) : null}

      <div role="group" aria-label="Filters" className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1">
          <span className="text-[13px] text-mut">Dates</span>
          <select className="field" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {RANGES.map((r) => (
              <option key={r.days} value={r.days}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-[13px] text-mut">Project</span>
          <select
            className="field"
            value={filter.project ?? ""}
            onChange={(e) => set("project", e.target.value)}
          >
            <option value="">All projects</option>
            {(all?.byProject ?? []).map((p) => (
              <option key={p.key} value={p.key}>
                {p.key}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-[13px] text-mut">Session</span>
          <select
            className="field"
            value={filter.session ?? ""}
            onChange={(e) => set("session", e.target.value)}
          >
            <option value="">All sessions</option>
            {(all?.bySession ?? [])
              .filter((r) => !filter.project || r.project === filter.project)
              .map((r) => (
                <option key={r.key} value={r.key}>
                  {sessionName(r.key)}
                </option>
              ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-[13px] text-mut">Model</span>
          <select
            className="field"
            value={filter.model ?? ""}
            onChange={(e) => set("model", e.target.value)}
          >
            <option value="">All models</option>
            {(all?.byModel ?? []).map((m) => (
              <option key={m.key} value={m.key}>
                {m.key}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <p role="alert" className="m-0 font-semibold text-sev">
          {error}
        </p>
      ) : null}
      {s ? (
        <>
          <section aria-label="Totals" className="grid grid-cols-4 gap-3 max-[800px]:grid-cols-2">
            <Tile label="Cost" value={money(s.total.costUsd)} hero />
            <Tile label="Input tokens" value={count(s.total.inputTokens)} />
            <Tile label="Output tokens" value={count(s.total.outputTokens)} />
            <Tile label="Turns" value={s.turnsKnown ? count(s.total.turns) : "Not kept by model"} />
          </section>
          {s.unsplitDays > 0 ? (
            <p className="m-0 text-[13px] text-mut">
              {s.unsplitDays === 1 ? "One day" : `${s.unsplitDays} days`} in this range{" "}
              {s.unsplitDays === 1 ? "is" : "are"} from before JCVC kept usage by session, when it
              kept only a total for each day.{" "}
              {filter.project || filter.session || filter.model
                ? "They are left out while a filter is on."
                : "They count in the totals and by day, not by project, model or session."}
            </p>
          ) : null}
          <Card title="Cost by day" rows={s.byDay} kind="day">
            <Columns rows={s.byDay} />
          </Card>
          <div className="grid grid-cols-2 gap-4 max-[900px]:grid-cols-1">
            <Card title="By project" rows={s.byProject} kind="name">
              <Bars rows={s.byProject} name={(r) => r.key} />
            </Card>
            <Card title="By model" rows={s.byModel} kind="name">
              <Bars rows={s.byModel} name={(r) => r.key} />
            </Card>
          </div>
          <Card title="By session" rows={s.bySession} kind="name" nameOf={sessionName}>
            <Bars rows={s.bySession.slice(0, 12)} name={(r) => sessionName(r.key)} />
          </Card>
        </>
      ) : error ? null : (
        <p className="m-0 text-mut">Reading usage.</p>
      )}
    </div>
  )
}

function Tile({ label, value, hero }: { label: string; value: string; hero?: boolean }) {
  return (
    <div className="panel grid gap-1 p-4">
      <span className="text-[13px] text-mut">{label}</span>
      <span className={clsx("font-semibold", hero ? "text-[40px] leading-tight" : "text-[24px]")}>
        {value}
      </span>
    </div>
  )
}

/** A chart with its table view one click away; both show the same rows. */
function Card({
  title,
  rows,
  kind,
  nameOf,
  children,
}: {
  title: string
  rows: Row[]
  kind: "day" | "name"
  nameOf?: (key: string) => string
  children: React.ReactNode
}) {
  const [table, setTable] = useState(false)
  return (
    <section aria-label={title} className="panel grid gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="m-0 text-[16px]">{title}</h2>
        <button
          type="button"
          className="btn !min-h-7 !text-[13px]"
          aria-pressed={table}
          onClick={() => setTable((v) => !v)}
        >
          {table ? "Show the chart" : "Show as a table"}
        </button>
      </div>
      {rows.every((r) => r.costUsd === 0 && r.outputTokens === 0) ? (
        <p className="m-0 text-mut">Nothing in this range.</p>
      ) : table ? (
        <table className="usage-table">
          <thead>
            <tr>
              <th scope="col">{kind === "day" ? "Day" : "Name"}</th>
              <th scope="col">Cost</th>
              <th scope="col">Input tokens</th>
              <th scope="col">Output tokens</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{nameOf ? nameOf(r.key) : r.key}</td>
                <td>{money(r.costUsd)}</td>
                <td>{r.inputTokens.toLocaleString("en-GB")}</td>
                <td>{r.outputTokens.toLocaleString("en-GB")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        children
      )}
    </section>
  )
}

/** Axis ticks are clean steps, so whole dollars unless they are below one: $0, $20, $0.20. */
export const axisMoney = (v: number) =>
  v === 0 ? "$0" : v < 1 ? `$${v.toFixed(2)}` : `$${Number.isInteger(v) ? v : v.toFixed(1)}`

const W = 760
const H = 200
const PAD = { left: 44, right: 8, top: 10, bottom: 26 }

/**
 * Cost by day as columns: one hue, at most 24px wide, rounded at the data end and square on the baseline. Each
 * day's slot is the hover and focus target, and says the day, cost and tokens.
 */
function Columns({ rows }: { rows: Row[] }) {
  const [at, setAt] = useState<number>()
  const max = Math.max(...rows.map((r) => r.costUsd), 0)
  const ticks = niceTicks(max)
  const top = ticks.at(-1) || 1
  const slot = (W - PAD.left - PAD.right) / Math.max(1, rows.length)
  const bar = Math.min(24, slot * 0.7)
  const y = (v: number) => PAD.top + (H - PAD.top - PAD.bottom) * (1 - v / top)
  const every = Math.ceil(rows.length / 10)
  const label = (r: Row) =>
    new Date(`${r.key}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
  const shown = at !== undefined ? rows[at] : undefined
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="usage-chart w-full"
        role="group"
        aria-label="Cost by day"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line className="usage-grid" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
            <text className="usage-axis" x={PAD.left - 6} y={y(t) + 4} textAnchor="end">
              {axisMoney(t)}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const x = PAD.left + i * slot + (slot - bar) / 2
          const h = Math.max(0, y(0) - y(r.costUsd))
          const rad = Math.min(4, h / 2, bar / 2)
          return (
            <g
              key={r.key}
              tabIndex={0}
              role="img"
              aria-label={`${label(r)}: ${money(r.costUsd)}, ${r.outputTokens.toLocaleString("en-GB")} output tokens`}
              className="usage-slot"
              data-on={at === i ? "" : undefined}
              onPointerEnter={() => setAt(i)}
              onPointerLeave={() => setAt(undefined)}
              onFocus={() => setAt(i)}
              onBlur={() => setAt(undefined)}
            >
              {/* The whole slot answers the pointer, not only the painted bar. */}
              <rect
                x={PAD.left + i * slot}
                y={PAD.top}
                width={slot}
                height={H - PAD.top - PAD.bottom}
                fill="transparent"
              />
              {h > 0 ? (
                <path
                  className="usage-bar"
                  d={`M${x},${y(0)} V${y(r.costUsd) + rad} Q${x},${y(r.costUsd)} ${x + rad},${y(r.costUsd)} H${x + bar - rad} Q${x + bar},${y(r.costUsd)} ${x + bar},${y(r.costUsd) + rad} V${y(0)} Z`}
                />
              ) : null}
              {i % every === 0 ? (
                <text
                  className="usage-axis"
                  x={PAD.left + i * slot + slot / 2}
                  y={H - 8}
                  textAnchor="middle"
                >
                  {label(r)}
                </text>
              ) : null}
            </g>
          )
        })}
        <line className="usage-base" x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} />
      </svg>
      {shown ? (
        <div role="status" className="usage-tip panel" style={tipAt(at as number, slot)}>
          <strong>{money(shown.costUsd)}</strong>
          <span className="text-mut">{label(shown)}</span>
          <span className="text-mut">
            {shown.inputTokens.toLocaleString("en-GB")} in,{" "}
            {shown.outputTokens.toLocaleString("en-GB")} out
          </span>
        </div>
      ) : null}
    </div>
  )
}

/** Inside the chart: centred on its day, but kept clear of the edges, so it never runs off the page. */
function tipAt(i: number, slot: number): React.CSSProperties {
  const pct = (x: number) => `${(x / W) * 100}%`
  const start = PAD.left + i * slot
  const mid = start + slot / 2
  // Beside its day near an edge, so it covers neither the edge nor the column it describes.
  if (mid / W > 0.75) return { left: pct(start), transform: "translateX(-100%)" }
  if (mid / W < 0.25) return { left: pct(start + slot) }
  return { left: pct(mid), transform: "translateX(-50%)" }
}

/** Horizontal bars, largest first, each labelled with its name and cost; tokens beside it. */
function Bars({ rows, name }: { rows: Row[]; name: (r: Row) => string }) {
  const max = Math.max(...rows.map((r) => r.costUsd), 0) || 1
  return (
    <ul className="m-0 grid list-none gap-2 p-0">
      {rows.map((r) => (
        <li key={r.key} className="grid gap-0.5">
          <span className="flex justify-between gap-3 text-[13.5px]">
            <span className="min-w-0 truncate">{name(r)}</span>
            <span className="shrink-0 font-semibold tabular-nums">{money(r.costUsd)}</span>
          </span>
          <span className="usage-track" aria-hidden="true">
            <span className="usage-fill" style={{ width: `${(r.costUsd / max) * 100}%` }} />
          </span>
          <span className="text-[12px] text-mut tabular-nums">
            {r.inputTokens.toLocaleString("en-GB")} input, {r.outputTokens.toLocaleString("en-GB")}{" "}
            output tokens
          </span>
        </li>
      ))}
    </ul>
  )
}
