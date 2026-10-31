import clsx from "clsx"
import { useEffect, useState } from "react"
import { api } from "../lib/api"
import { useNow } from "../lib/useNow"

/** The account's plan limits, as the Host reads them from Claude Code's own /usage data. */
export interface PlanUsage {
  plan?: string
  limits: Array<{ label: string; percent: number; resetsAt?: string; group: "session" | "weekly" }>
  extra?: { used: number; limit: number; currency: string; percent: number }
  at: string
}

/** From this share of a window, the meter says so in its colour as well as its number. */
export const PLAN_HIGH = 80
const FRESH_MS = 60_000
const EVERY_MS = 5 * 60_000

const cache = new Map<
  string,
  { at: number; value: PlanUsage | null; pending?: Promise<PlanUsage | null> }
>()

/** Asked once a minute at most, whatever the number of panes showing it. */
export async function readPlan(account: string, fresh = false): Promise<PlanUsage | null> {
  const c = cache.get(account)
  if (c?.pending) return c.pending
  if (c && !fresh && Date.now() - c.at < FRESH_MS) return c.value
  const pending = api<{ usage: PlanUsage | null }>(
    "GET",
    `/api/plan-usage?account=${encodeURIComponent(account)}${fresh ? "&fresh=1" : ""}`,
  ).then((r) => {
    const value = r.ok ? (r.data?.usage ?? null) : (c?.value ?? null)
    cache.set(account, { at: Date.now(), value })
    return value
  })
  cache.set(account, { at: c?.at ?? 0, value: c?.value ?? null, pending })
  return pending
}

/** For tests: forget what was read. */
export const forgetPlan = () => cache.clear()

function resets(iso: string | undefined, now: number): string | undefined {
  if (!iso) return undefined
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return undefined
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  return new Date(now).toDateString() === d.toDateString()
    ? `Resets at ${time}`
    : `Resets ${d.toLocaleDateString("en-GB", { weekday: "short" })} ${time}`
}

const money = (n: number, currency: string) =>
  n.toLocaleString("en-GB", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 2,
  })

function ago(iso: string, now: number): string {
  const min = Math.round((now - new Date(iso).getTime()) / 60_000)
  return min < 1 ? "just now" : min === 1 ? "a minute ago" : `${min} minutes ago`
}

/**
 * How much of your plan's limits the account has used, beside the prompt box: a small ring for the 5-hour window
 * (or the fullest one), opening to every window and extra usage. Hidden where the plan has no limits to show.
 */
export function PlanMeter({ account, idle }: { account: string; idle: boolean }) {
  const [u, setU] = useState<PlanUsage | null>(() => cache.get(account)?.value ?? null)
  const [open, setOpen] = useState(false)
  const now = useNow(30_000)
  useEffect(() => {
    let gone = false
    const read = (fresh = false) =>
      void readPlan(account, fresh).then((v) => {
        if (!gone) setU(v)
      })
    // When the pane opens, after each turn, and every few minutes.
    read()
    const t = setInterval(() => read(), EVERY_MS)
    return () => {
      gone = true
      clearInterval(t)
    }
  }, [account, idle])
  if (!u || (!u.limits.length && !u.extra)) return null
  const main = u.limits.find((l) => l.group === "session") ?? u.limits[0]
  const pct = Math.round(main?.percent ?? u.extra?.percent ?? 0)
  const high = pct >= PLAN_HIGH
  const r = 6.5
  const around = 2 * Math.PI * r
  return (
    <span className="relative">
      <button
        type="button"
        className="plan-meter"
        aria-expanded={open}
        aria-label={`Plan usage: ${main ? `${main.label} ${pct}% used` : `extra usage ${pct}% used`}. Shows your plan limits`}
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <circle cx="8" cy="8" r={r} className="plan-ring-track" />
          <circle
            cx="8"
            cy="8"
            r={r}
            className={clsx("plan-ring-fill", high && "plan-ring-high")}
            strokeDasharray={`${(around * Math.min(100, pct)) / 100} ${around}`}
            transform="rotate(-90 8 8)"
          />
        </svg>
        <span className="tabular-nums">{pct}%</span>
      </button>
      {open ? (
        <div role="group" aria-label="Your plan limits" className="plan-panel panel">
          <p className="m-0 flex items-baseline justify-between gap-3">
            <strong>Your plan limits</strong>
            {u.plan ? (
              <span className="text-[12.5px] text-mut">
                {u.plan.charAt(0).toUpperCase() + u.plan.slice(1)}
              </span>
            ) : null}
          </p>
          <ul className="m-0 grid list-none gap-3 p-0">
            {u.limits.map((l) => (
              <li key={l.label} className="grid gap-1">
                <span className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span>{l.label}</span>
                  <span className="tabular-nums text-mut">
                    {[resets(l.resetsAt, now), `${Math.round(l.percent)}%`]
                      .filter(Boolean)
                      .join("  ")}
                  </span>
                </span>
                <span className="plan-bar" aria-hidden="true">
                  <span
                    className={clsx("plan-bar-fill", l.percent >= PLAN_HIGH && "plan-ring-high")}
                    style={{ width: `${Math.min(100, l.percent)}%` }}
                  />
                </span>
              </li>
            ))}
            {u.extra ? (
              <li className="grid gap-1">
                <span className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span>Extra usage</span>
                  <span className="tabular-nums text-mut">
                    {money(u.extra.used, u.extra.currency)} of{" "}
                    {money(u.extra.limit, u.extra.currency)}
                  </span>
                </span>
                <span className="plan-bar" aria-hidden="true">
                  <span
                    className="plan-bar-fill"
                    style={{ width: `${Math.min(100, u.extra.percent)}%` }}
                  />
                </span>
              </li>
            ) : null}
          </ul>
          <p className="m-0 flex items-center justify-between gap-3 text-[12.5px] text-mut">
            <span>Updated {ago(u.at, now)}</span>
            <button
              type="button"
              className="btn !min-h-7 !text-[12.5px]"
              onClick={() =>
                void readPlan(account, true).then((v) => {
                  setU(v)
                })
              }
            >
              Refresh
            </button>
          </p>
        </div>
      ) : null}
    </span>
  )
}
