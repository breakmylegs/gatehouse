import clsx from "clsx"
import { useEffect, useMemo, useState } from "react"
import { ApprovalCard } from "../components/ApprovalCard"
import { RiskBadge } from "../components/RiskBadge"
import { QuickDecision } from "../components/QuickDecision"
import { SessionCode } from "../components/SessionCode"
import { describeActivity } from "../lib/activity"
import { api } from "../lib/api"
import { money, stamp } from "../lib/format"
import { notifyLine } from "../lib/rail"
import { titleOf } from "../lib/sessionActions"
import { dayOf } from "../lib/usage"
import { useNow } from "../lib/useNow"
import { send, usePending, useSessionList, useStore } from "../store"

const STATE: Record<string, string> = {
  starting: "Starting",
  idle: "Ready",
  running: "Working",
  waiting: "Needs you",
  error: "Stopped with an error",
  ended: "Ended",
}

const count = (v: number) =>
  v >= 1_000_000
    ? `${(v / 1_000_000).toFixed(1)}M`
    : v >= 1000
      ? `${(v / 1000).toFixed(1)}K`
      : `${v}`

/**
 * The page at the top of the sidebar (owner, 31 Oct): what needs you, what is wrong, what each session is doing,
 * today in numbers and what happened lately. Everything links to where you act on it.
 */
export function Dashboard() {
  const health = useStore((s) => s.health)
  const conn = useStore((s) => s.conn)
  const usage = useStore((s) => s.usage)
  const notices = useStore((s) => s.notices)
  const activity = useStore((s) => s.activity)
  const setRoute = useStore((s) => s.setRoute)
  const selectSession = useStore((s) => s.selectSession)
  const selectRequest = useStore((s) => s.selectRequest)
  const pending = usePending()
  const list = useSessionList()
  const now = useNow(5000)
  const [digest, setDigest] = useState<{ text: string; askedYou?: number }>()
  useEffect(() => {
    void api<{ text: string; askedYou?: number }>("GET", "/api/digest").then(
      (r) => r.ok && r.data && setDigest(r.data),
    )
  }, [])

  const open = useMemo(
    () =>
      list
        .filter((s) => s.state !== "ended" && !s.archived)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [list],
  )
  const working = open.filter(
    (s) => s.state === "running" || s.state === "waiting" || (s.background?.length ?? 0) > 0,
  )
  const today = usage?.byDay?.[dayOf(new Date())]
  const openSession = (id: string) => {
    selectSession(id)
    setRoute("workspace")
  }

  // Each alert says what is wrong and offers the one place to put it right.
  const alerts: Array<{ text: string; action?: { label: string; go: () => void } }> = []
  if (conn !== "open") alerts.push({ text: "Not connected to the Host. Requests keep waiting." })
  if (health?.killSwitch.engaged)
    alerts.push({
      text: "The kill switch is engaged: every request is denied and no session can start.",
      action: { label: "Re-arm", go: () => void send({ type: "rearm" }) },
    })
  if (health && health.approver.state !== "up")
    alerts.push({
      text: `The Approver is ${health.approver.state}, so every request waits for you.`,
      action: { label: "Open the Approver", go: () => setRoute("approver") },
    })
  if (
    health &&
    health.signin.checked !== false &&
    (!health.signin.signedIn || !health.signin.orgOk)
  )
    alerts.push({
      text: health.signin.signedIn
        ? (health.signin.orgMessage ?? "This account is not in the organisation Codehouse expects.")
        : "You are not signed in to Claude.",
      action: { label: "Check sign-in", go: () => setRoute("first-run") },
    })
  if (health) {
    const phone = notifyLine(health)
    if (!phone.neutral && !phone.ok)
      alerts.push({
        text: `Requests are not reaching your phone: ${phone.label.replace("Notifying on ", "")}.`,
        action: { label: "Phone and notifications", go: () => setRoute("devices") },
      })
  }
  for (const s of open.filter((x) => x.state === "error"))
    alerts.push({
      text: `${titleOf(s)} stopped with an error${s.error ? `: ${s.error}` : "."}`,
      action: { label: "Open it", go: () => openSession(s.id) },
    })

  const pendingFor = (id: string) => pending.find((v) => v.request.sessionId === id)

  return (
    <div className="dash">
      <div className="dash-top">
        <h1 className="m-0">Dashboard</h1>
        <p className="dash-condition">
          <span
            aria-hidden="true"
            className={clsx("deck-dot", pending.length === 0 && alerts.length === 0 && "is-ok")}
          />
          {pending.length === 0 && alerts.length === 0
            ? "Nothing needs you right now."
            : `${pending.length === 1 ? "1 request needs" : `${pending.length} requests need`} you${alerts.length ? `, and ${alerts.length === 1 ? "1 thing is" : `${alerts.length} things are`} not right` : ""}.`}
          <span className="dash-condition-meta">
            {open.length} open, {working.length} working
          </span>
        </p>
      </div>

      <div className="dash-main">
        {alerts.length ? (
          <section aria-label="Alerts" className="dash-alerts">
            <h2 className="dash-h">Not right</h2>
            <ul className="m-0 grid list-none gap-2 p-0">
              {alerts.map((a, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-3">
                  <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">{a.text}</span>
                  {a.action ? (
                    <button type="button" className="btn !min-h-7" onClick={a.action.go}>
                      {a.action.label}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {pending.length ? (
          <section aria-label="Needs you" className="grid gap-2">
            <h2 className="dash-h">
              What needs your attention now{" "}
              <span className="dash-tag">{pending.length} waiting</span>
            </h2>
            {/* The oldest in full, as Stitch shows it, so it can be decided here; the rest as one line each. */}
            <div className="pass-wrap">
              <ApprovalCard view={pending[0]!} />
            </div>
            {pending.slice(1, 5).map((v) => (
              <QuickDecision
                key={v.request.id}
                view={v}
                variant="panel"
                onMore={() => {
                  selectRequest(v.request.id)
                  setRoute("approvals")
                }}
              />
            ))}
            {pending.length > 5 ? (
              <button type="button" className="btn w-fit" onClick={() => setRoute("approvals")}>
                {pending.length - 5} more on Approvals
              </button>
            ) : null}
          </section>
        ) : null}

        <section aria-label="Sessions" className="grid gap-2">
          <h2 className="dash-h">
            Live sessions <span className="dash-tag">{open.length} open</span>
          </h2>
          {open.length === 0 ? (
            <p className="m-0 text-mut">
              No sessions are open.{" "}
              <button
                type="button"
                className="cursor-pointer border-0 bg-transparent p-0 text-acc underline"
                onClick={() => setRoute("sessions")}
              >
                Start one
              </button>
            </p>
          ) : (
            <ul className="dash-tiles">
              {open.map((s) => {
                const doing = s.paused
                  ? "Paused at the plan limit"
                  : s.state === "running" || s.state === "waiting"
                    ? describeActivity(activity[s.id], now, s.cwd).label
                    : (s.background?.length ?? 0) > 0
                      ? `${s.background?.length} working in the background`
                      : STATE[s.state]
                const asks = pendingFor(s.id)
                return (
                  <li key={s.id} className="dash-tile" data-state={s.state}>
                    <span className="dash-tile-head">
                      <SessionCode session={s} className="!text-[13px]" />
                      <span className="dash-state">{STATE[s.state]}</span>
                      {asks ? (
                        <RiskBadge risk={asks.request.verdict.risk} className="ml-auto" />
                      ) : null}
                    </span>
                    <span className="truncate text-[15px] font-semibold">{titleOf(s)}</span>
                    <span className="truncate text-[13px] text-mut">{doing}</span>
                    <span className="dash-tile-foot">
                      <span>Open for {since(s.createdAt, now)}</span>
                      {usage?.bySession?.[s.id] ? (
                        <span className="tabular-nums">
                          {money(usage.bySession[s.id]?.costUsd ?? 0)}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className="btn !min-h-7 ml-auto"
                        onClick={() => openSession(s.id)}
                      >
                        Open
                      </button>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section aria-label="Today" className="grid gap-2">
          <div className="flex items-center justify-between gap-3">
            <h2 className="dash-h">Today</h2>
            <button type="button" className="btn !min-h-7" onClick={() => setRoute("usage")}>
              Usage
            </button>
          </div>
          <div className="grid grid-cols-4 gap-3 max-[900px]:grid-cols-2">
            <Tile label="Cost today" value={money(today?.costUsd ?? 0)} />
            <Tile label="Output tokens today" value={count(today?.outputTokens ?? 0)} />
            <Tile label="Sessions working" value={`${working.length}`} />
            <Tile
              label="Asked you, last 24 hours"
              value={digest?.askedYou !== undefined ? `${digest.askedYou}` : "Not read yet"}
            />
          </div>
          {digest ? <p className="m-0 text-[13.5px] text-mut">{digest.text}</p> : null}
        </section>
      </div>

      <section aria-label="Lately" className="dash-feed">
        <h2 className="dash-h">Lately</h2>
        {notices.length === 0 ? (
          <p className="m-0 text-mut">Nothing yet since Codehouse opened.</p>
        ) : (
          <ul className="m-0 grid list-none p-0">
            {notices.slice(0, 12).map((n) => (
              <li key={n.id} className="dash-feed-item">
                <time className="mono text-[12px] text-mut">{stamp(n.at)}</time>
                <span className="min-w-0 [overflow-wrap:anywhere]">{n.text}</span>
                {n.sessionId && list.some((s) => s.id === n.sessionId) ? (
                  <button
                    type="button"
                    className="btn !min-h-7 !text-[13px]"
                    onClick={() => openSession(n.sessionId as string)}
                  >
                    Open
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/** How long ago, in the largest whole unit: 12 min, 3 h, 2 days. */
function since(iso: string, now: number): string {
  const m = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} days`
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="dash-metric">
      <span className="dash-metric-label">{label}</span>
      <span className="dash-metric-value">{value}</span>
    </div>
  )
}
