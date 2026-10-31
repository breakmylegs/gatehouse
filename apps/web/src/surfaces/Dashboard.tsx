import { useEffect, useMemo, useState } from "react"
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
        ? (health.signin.orgMessage ?? "This account is not in the organisation JCVC expects.")
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

  return (
    <div className="grid max-w-[1100px] gap-5 p-6">
      <div>
        <h1 className="m-0">Dashboard</h1>
        <p className="m-0 mt-1 text-mut">
          {pending.length === 0 && alerts.length === 0
            ? "Nothing needs you right now."
            : `${pending.length === 1 ? "1 request needs" : `${pending.length} requests need`} you${alerts.length ? `, and ${alerts.length === 1 ? "1 thing is" : `${alerts.length} things are`} not right` : ""}.`}
        </p>
      </div>

      {alerts.length ? (
        <section aria-label="Alerts" className="panel grid gap-2 border-sev p-4">
          <h2 className="m-0 text-[16px]">Not right</h2>
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
          <h2 className="m-0 text-[16px]">Needs you</h2>
          {pending.slice(0, 5).map((v) => (
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

      <section aria-label="Today" className="grid gap-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="m-0 text-[16px]">Today</h2>
          <button type="button" className="btn !min-h-7" onClick={() => setRoute("usage")}>
            Usage
          </button>
        </div>
        <div className="grid grid-cols-4 gap-3 max-[800px]:grid-cols-2">
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

      <section aria-label="Sessions" className="grid gap-2">
        <h2 className="m-0 text-[16px]">Sessions</h2>
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
          <ul className="panel m-0 grid list-none p-0">
            {open.map((s) => {
              const doing =
                s.state === "running" || s.state === "waiting"
                  ? describeActivity(activity[s.id], now, s.cwd).label
                  : (s.background?.length ?? 0) > 0
                    ? `${s.background?.length} working in the background`
                    : STATE[s.state]
              return (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0"
                >
                  <SessionCode session={s} className="!text-[13px]" />
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate font-semibold">{titleOf(s)}</span>
                    <span className="truncate text-[13px] text-mut">{doing}</span>
                  </span>
                  {usage?.bySession?.[s.id] ? (
                    <span className="text-[13px] text-mut tabular-nums">
                      {money(usage.bySession[s.id]?.costUsd ?? 0)}
                    </span>
                  ) : null}
                  <button type="button" className="btn !min-h-7" onClick={() => openSession(s.id)}>
                    Open
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section aria-label="Lately" className="grid gap-2">
        <h2 className="m-0 text-[16px]">Lately</h2>
        {notices.length === 0 ? (
          <p className="m-0 text-mut">Nothing yet since JCVC opened.</p>
        ) : (
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {notices.slice(0, 12).map((n) => (
              <li key={n.id} className="flex flex-wrap items-baseline gap-3">
                <time className="w-12 shrink-0 text-[12.5px] text-mut tabular-nums">
                  {stamp(n.at)}
                </time>
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{n.text}</span>
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

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel grid gap-1 p-4">
      <span className="text-[13px] text-mut">{label}</span>
      <span className="text-[24px] font-semibold">{value}</span>
    </div>
  )
}
