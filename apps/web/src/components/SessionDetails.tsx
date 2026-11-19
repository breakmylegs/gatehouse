import type { SessionInfo } from "@gatehouse/shared/ws-protocol"
import { useEffect, useState } from "react"
import { clock, money } from "../lib/format"
import { toast } from "sonner"
import { sidesOf } from "../lib/side"
import { MAIN_ACCOUNT, send, useStore } from "../store"
import { HeldOutPanel } from "./HeldOutPanel"
import { LocksPanel } from "./LocksPanel"
import { PlanMeter } from "./PlanMeter"

/**
 * O21 (owner, 9 Nov, with two screenshots): a session's details beside it. Where it runs (computer, folder,
 * repository and branch), how full its context is and with what, its connectors, what it changed, and what is still
 * working in the background with how long each has run. Everything is written out; nothing hides behind a hover.
 */

interface Details {
  computer: string
  cwd: string
  repo?: { name: string; top: string; branch?: string }
  connectors: Array<{ name: string; status: string; kind: string }>
}

interface Context {
  percentage: number
  totalTokens: number
  maxTokens: number
  categories: Array<{ name: string; tokens: number; kind?: string }>
  /** T-063: where Claude Code compacts the conversation by itself, in tokens, when it does. */
  autoCompactThreshold?: number
  isAutoCompactEnabled?: boolean
}

/** T-063: the rows the details show, chosen by you, kept on this computer. */
export const DETAIL_ROWS = [
  { id: "environment", label: "Environment" },
  { id: "context", label: "Context" },
  { id: "limits", label: "Usage limits" },
  { id: "connectors", label: "Connectors" },
  { id: "changes", label: "Changes" },
  { id: "checks", label: "Held-out checks and locked tests" },
  { id: "background", label: "Working in the background" },
  { id: "sides", label: "Side chats" },
] as const
export type DetailRow = (typeof DETAIL_ROWS)[number]["id"]
const ROWS_KEY = "gatehouse.details.rows"

export function readRows(): Set<DetailRow> {
  try {
    const v = JSON.parse(localStorage.getItem(ROWS_KEY) ?? "null") as unknown
    if (Array.isArray(v)) return new Set(v.filter((x): x is DetailRow => DETAIL_ROWS.some((r) => r.id === x)))
  } catch {
    // storage blocked or unreadable: every row
  }
  return new Set(DETAIL_ROWS.map((r) => r.id))
}

function saveRows(rows: Set<DetailRow>): void {
  try {
    localStorage.setItem(ROWS_KEY, JSON.stringify([...rows]))
  } catch {
    // storage blocked: the choice lasts until the window closes
  }
}

/** Where on the context meter auto-compact happens, as a share of the window; undefined when it does not. */
export function compactMark(c: Pick<Context, "autoCompactThreshold" | "isAutoCompactEnabled" | "maxTokens">): number | undefined {
  if (!c.isAutoCompactEnabled || !c.autoCompactThreshold || !c.maxTokens) return undefined
  return Math.max(0, Math.min(100, (100 * c.autoCompactThreshold) / c.maxTokens))
}

interface Changes {
  since?: { createdAt?: string; label?: string }
  files?: Array<{ added: number; removed: number }>
}

const KIND: Record<string, string> = {
  "in-process": "in Codehouse",
  "claude.ai": "claude.ai connector",
  outside: "outside Codehouse",
  unknown: "kind not known",
}

const tokens = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1000
      ? `${(n / 1000).toFixed(1)}k`
      : String(n)

/** How long something has run: "12 seconds", "3 min 4 s", "1 h 5 min". */
export function ranFor(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s} second${s === 1 ? "" : "s"}`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ${s % 60} s`
  return `${Math.floor(m / 60)} h ${m % 60} min`
}

function useNow(on: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [on])
  return now
}

export function SessionDetails({
  session,
  chat = false,
  onOpenChanges,
}: {
  session: SessionInfo
  chat?: boolean
  onOpenChanges?: () => void
}) {
  const [details, setDetails] = useState<Details>()
  const [context, setContext] = useState<Context>()
  const [changes, setChanges] = useState<Changes>()
  const [showContext, setShowContext] = useState(true)
  const [showConnectors, setShowConnectors] = useState(false)
  const between = session.state === "idle"
  const cost = useStore((s) => s.usage?.bySession?.[session.id]?.costUsd)
  const tasks = session.backgroundTasks ?? []
  const now = useNow(tasks.length > 0)
  const [rows, setRows] = useState<Set<DetailRow>>(readRows)
  const [choosing, setChoosing] = useState(false)
  const shows = (r: DetailRow) => rows.has(r)
  const toggleRow = (r: DetailRow) =>
    setRows((cur) => {
      const next = new Set(cur)
      if (next.has(r)) next.delete(r)
      else next.add(r)
      saveRows(next)
      return next
    })
  const sessions = useStore((st) => st.sessions)
  const sides = sidesOf(session.id).filter((id) => sessions[id])
  const stopTask = async (taskId: string) => {
    const r = await send({ type: "stop_task", sessionId: session.id, taskId })
    if (!r.ok) toast.error(r.error?.message ?? "It could not be stopped", { id: "task" })
  }

  // Read when the panel opens and again after each turn.
  useEffect(() => {
    let gone = false
    void send({ type: "session_details", sessionId: session.id }).then((r) => {
      if (!gone && r.ok && r.data) setDetails(r.data as Details)
    })
    void send({ type: "context_usage", sessionId: session.id }).then((r) => {
      if (!gone && r.ok && r.data) setContext(r.data as Context)
    })
    if (!chat)
      void send({ type: "changes", sessionId: session.id }).then((r) => {
        if (!gone && r.ok && r.data) setChanges(r.data as Changes)
      })
    return () => {
      gone = true
    }
  }, [session.id, between, chat])

  const added = (changes?.files ?? []).reduce((n, f) => n + f.added, 0)
  const removed = (changes?.files ?? []).reduce((n, f) => n + f.removed, 0)
  const pct = context ? Math.max(0, Math.round(context.percentage)) : undefined
  const parts = (context?.categories ?? []).filter((c) => c.tokens > 0)
  const mark = context ? compactMark(context) : undefined

  return (
    <div className="grid gap-5 text-[14px]" aria-label="Session details">
      <div className="flex justify-end">
        <button type="button" className="btn !min-h-7 !text-[13px]" aria-expanded={choosing} onClick={() => setChoosing((v) => !v)}>
          Choose rows
        </button>
      </div>
      {choosing ? (
        <fieldset className="m-0 grid gap-1 rounded-md border border-line p-2 text-[13px]">
          <legend className="px-1">Show in Details</legend>
          {DETAIL_ROWS.filter((r) => !(chat && (r.id === "changes" || r.id === "checks"))).map((r) => (
            <label key={r.id} className="flex items-center gap-2">
              <input type="checkbox" checked={shows(r.id)} onChange={() => toggleRow(r.id)} />
              {r.label}
            </label>
          ))}
        </fieldset>
      ) : null}
      {shows("environment") ? (
      <section aria-labelledby={`env-${session.id}`}>
        <h3 id={`env-${session.id}`} className="m-0 mb-1.5 text-[14px]">
          Environment
        </h3>
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
          <dt className="text-mut">Computer</dt>
          <dd className="m-0">{details?.computer ?? "..."}</dd>
          <dt className="text-mut">Folder</dt>
          <dd className="mono m-0 break-all text-[13px]">{session.cwd}</dd>
          <dt className="text-mut">Repository</dt>
          <dd className="m-0">
            {details === undefined
              ? "..."
              : details.repo
                ? `${details.repo.name}${details.repo.branch ? `, branch ${details.repo.branch}` : ""}`
                : "Not in a git repository"}
          </dd>
          {session.worktree ? (
            <>
              <dt className="text-mut">Worktree</dt>
              <dd className="m-0">its own branch, {session.worktree.branch}</dd>
            </>
          ) : null}
          {session.model ? (
            <>
              <dt className="text-mut">Model</dt>
              <dd className="m-0">{session.model}</dd>
            </>
          ) : null}
          {session.deadman ? (
            <>
              <dt className="text-mut">Dead-man</dt>
              <dd className="m-0">
                pauses if nothing is heard from you for {session.deadman.minutes} minutes (last at{" "}
                {new Date(session.deadman.lastHeardFrom).toLocaleTimeString()})
              </dd>
            </>
          ) : null}
          {session.riskBudget !== undefined ? (
            <>
              <dt className="text-mut">Risk budget</dt>
              <dd className={session.riskBudget === 0 ? "m-0 font-semibold text-sev" : "m-0"}>
                {session.riskBudget} {session.riskBudget === 1 ? "point" : "points"} left until your next message
              </dd>
            </>
          ) : null}
          {session.claims?.length ? (
            <>
              <dt className="text-mut">Claims</dt>
              <dd className="m-0 grid gap-0.5">
                {session.claims.slice(-3).map((c, i) => (
                  <span
                    key={i}
                    className={
                      c.outcome === "verified" ? "text-ok" : c.outcome === "contradicted" ? "font-semibold text-sev" : "text-warn"
                    }
                  >
                    {c.outcome === "verified" ? "Verified" : c.outcome === "contradicted" ? "Contradicted" : "Unverified"}: {c.quote} ({c.why})
                  </span>
                ))}
              </dd>
            </>
          ) : null}
          {session.testsWeakened ? (
            <>
              <dt className="text-mut">Tests</dt>
              <dd className="m-0 font-semibold text-warn">
                weakened {session.testsWeakened === 1 ? "once" : `${session.testsWeakened} times`}, approved by
                Extreme approval: done-claims are not verified
              </dd>
            </>
          ) : null}
          {cost !== undefined ? (
            <>
              <dt className="text-mut">Spend</dt>
              <dd className="m-0">{money(cost)} this session</dd>
            </>
          ) : null}
        </dl>
      </section>
      ) : null}

      {shows("context") ? (
      <section aria-labelledby={`ctx-${session.id}`}>
        <button
          type="button"
          id={`ctx-${session.id}`}
          className="flex w-full cursor-pointer items-center justify-between border-0 bg-transparent p-0 text-left text-[14px] font-semibold text-tx"
          aria-expanded={showContext}
          onClick={() => setShowContext((v) => !v)}
        >
          <span>Context</span>
          <span className="font-normal text-mut">
            {context && pct !== undefined
              ? `${pct}% used, ${tokens(context.totalTokens)} of ${tokens(context.maxTokens)}`
              : "read after each turn"}{" "}
            <span aria-hidden="true">{showContext ? "▾" : "▸"}</span>
          </span>
        </button>
        {context && pct !== undefined ? (
          <div
            className="mt-1.5 h-1.5 overflow-hidden rounded bg-s2"
            role="meter"
            aria-label="Context used"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <div className="h-full bg-acc" style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
        ) : null}
        {mark !== undefined && context ? (
          <div className="relative h-0" aria-hidden="true">
            <span className="absolute -top-2 h-2.5 w-0.5 bg-warn" style={{ left: `${mark}%` }} />
          </div>
        ) : null}
        {context ? (
          <p className="m-0 mt-1 text-[13px] text-mut">
            {mark !== undefined && context.autoCompactThreshold
              ? `Claude Code compacts the conversation by itself at ${tokens(context.autoCompactThreshold)} (${Math.round(mark)}%), the mark on the bar.`
              : "Claude Code does not compact this conversation by itself."}
          </p>
        ) : null}
        {showContext && parts.length ? (
          <table className="mt-2 w-full border-collapse text-[13px]">
            <tbody>
              {parts.map((c) => (
                <tr key={c.name}>
                  <td className="py-0.5 pr-2">
                    {c.name}
                    {c.kind && c.kind !== "used" ? (
                      <span className="text-mut"> ({c.kind})</span>
                    ) : null}
                  </td>
                  <td className="py-0.5 text-right tabular-nums">{tokens(c.tokens)}</td>
                  <td className="w-12 py-0.5 text-right tabular-nums text-mut">
                    {context && context.maxTokens
                      ? `${((100 * c.tokens) / context.maxTokens).toFixed(1)}%`
                      : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
      ) : null}

      {shows("limits") ? (
        <section aria-label="Usage limits">
          <h3 className="m-0 mb-1.5 text-[14px]">Usage limits</h3>
          <PlanMeter account={session.account ?? MAIN_ACCOUNT} idle={session.state === "idle"} />
        </section>
      ) : null}

      {shows("connectors") ? (
      <section aria-labelledby={`con-${session.id}`}>
        <button
          type="button"
          id={`con-${session.id}`}
          className="flex w-full cursor-pointer items-center justify-between border-0 bg-transparent p-0 text-left text-[14px] font-semibold text-tx"
          aria-expanded={showConnectors}
          onClick={() => setShowConnectors((v) => !v)}
        >
          <span>Connectors</span>
          <span className="font-normal text-mut">
            {details ? `${details.connectors.length}` : "..."}{" "}
            <span aria-hidden="true">{showConnectors ? "▾" : "▸"}</span>
          </span>
        </button>
        {showConnectors && details ? (
          details.connectors.length ? (
            <ul className="m-0 mt-1.5 grid gap-1 p-0 text-[13px]">
              {details.connectors.map((c) => (
                <li key={c.name} className="flex justify-between gap-2" style={{ listStyle: "none" }}>
                  <span className="mono truncate">{c.name}</span>
                  <span className="shrink-0 text-mut">
                    {c.status}, {KIND[c.kind] ?? c.kind}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 mt-1.5 text-[13px] text-mut">None in this session.</p>
          )
        ) : null}
      </section>
      ) : null}

      {chat || !shows("changes") ? null : (
        <section aria-labelledby={`chg-${session.id}`}>
          <div className="flex items-center justify-between">
            <h3 id={`chg-${session.id}`} className="m-0 text-[14px]">
              Changes
            </h3>
            {changes?.files ? (
              <span className="tabular-nums">
                <span className="text-ok">+{added}</span>{" "}
                <span className="text-sev">&minus;{removed}</span>
                <span className="text-mut">
                  {" "}
                  in {changes.files.length} file{changes.files.length === 1 ? "" : "s"}
                </span>
              </span>
            ) : (
              <span className="text-mut">{changes ? "None yet" : "..."}</span>
            )}
          </div>
          {changes?.since?.createdAt ? (
            <p className="m-0 mt-1 text-[13px] text-mut">
              Since the checkpoint at {clock(changes.since.createdAt)}.
            </p>
          ) : null}
          {onOpenChanges && changes?.files?.length ? (
            <button type="button" className="btn mt-1.5 !min-h-7 !text-[13px]" onClick={onOpenChanges}>
              Open Changes
            </button>
          ) : null}
        </section>
      )}

      {chat || !shows("checks") ? null : <HeldOutPanel session={session} />}

      {chat || !shows("checks") ? null : <LocksPanel session={session} />}

      {shows("background") ? (
      <section aria-labelledby={`bg-${session.id}`}>
        <h3 id={`bg-${session.id}`} className="m-0 mb-1.5 text-[14px]">
          Working in the background
        </h3>
        {tasks.length ? (
          <ul className="m-0 grid gap-1 p-0 text-[13px]" aria-live="off">
            {tasks.map((t) => (
              <li key={t.id} className="flex justify-between gap-2" style={{ listStyle: "none" }}>
                <span className="min-w-0 break-words">{t.description || "A task"}</span>
                <span className="flex shrink-0 items-center gap-2 tabular-nums text-mut">
                  {ranFor(now - Date.parse(t.startedAt))}
                  <button type="button" className="btn !min-h-6 !px-2 !text-[12.5px]" aria-label={`Stop ${t.description || "this task"}`} onClick={() => void stopTask(t.id)}>
                    Stop
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-[13px] text-mut">Nothing is running in the background.</p>
        )}
      </section>
      ) : null}

      {shows("sides") ? (
        <section aria-label="Side chats">
          <h3 className="m-0 mb-1.5 text-[14px]">Side chats</h3>
          {sides.length ? (
            <ul className="m-0 grid gap-1 p-0 text-[13px]">
              {sides.map((id) => (
                <li key={id} className="flex items-center justify-between gap-2" style={{ listStyle: "none" }}>
                  <span className="min-w-0 truncate">{sessions[id]?.title ?? sessions[id]?.project ?? id}</span>
                  <button
                    type="button"
                    className="btn !min-h-6 !px-2 !text-[12.5px]"
                    onClick={() => {
                      const st = useStore.getState()
                      st.openBeside(id)
                      st.setRoute("workspace")
                    }}
                  >
                    Open
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-[13px] text-mut">No side chat started from this session is open.</p>
          )}
        </section>
      ) : null}
    </div>
  )
}
