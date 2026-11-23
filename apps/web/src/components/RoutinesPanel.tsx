import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { clock, money } from "../lib/format"
import { send, useStore } from "../store"
import { isMac } from "../lib/platform-mac" // Mac fork

interface Routine {
  id: string
  name: string
  folder: string
  prompt: string
  time: string
  days: string[]
  extreme?: boolean
  worktree?: boolean
  phone?: boolean
  enabled: boolean
  lastRun?: string
  /** Absent: on a schedule. */
  trigger?: { kind: "commit" | "files" } | { kind: "webhook"; hasToken?: boolean; filters?: Array<{ field: string; equals: string }> }
  /** T-119: once, at this local time, instead of on days. */
  once?: string
  /** T-119: where each run goes. */
  into?: "new" | "continue"
}

type Starts = "schedule" | "once" | "commit" | "files" | "webhook"

/** T-120: the address a program on this computer calls to start a routine. */
export const hookAddress = (id: string, origin = window.location.origin) => `${origin}/hook/${encodeURIComponent(id)}`

/** T-122: a routine a session drafted, for you to read and save, or dismiss. */
interface Draft {
  id: string
  folder: string
  name: string
  prompt: string
  time: string
  days: string[]
}

/** When a routine starts, in words. */
export function startsText(x: Pick<Routine, "time" | "days" | "trigger"> & { once?: string; into?: string }): string {
  if (x.trigger?.kind === "commit") return "on a new commit"
  if (x.trigger?.kind === "files") return "when files change"
  if (x.trigger?.kind === "webhook") return `when a program on this computer calls it${x.trigger.filters?.length ? `, if ${x.trigger.filters.map((f) => `${f.field} is ${f.equals}`).join(" and ")}` : ""}`
  if (x.once) return `once, ${new Date(x.once).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`
  if (x.into === "continue") return `${x.time}, ${x.days.join(" ")}, carrying on its last conversation`
  return `${x.time}, ${x.days.join(" ")}`
}

const DAYS = [
  ["mon", "Mon"],
  ["tue", "Tue"],
  ["wed", "Wed"],
  ["thu", "Thu"],
  ["fri", "Fri"],
  ["sat", "Sat"],
  ["sun", "Sun"],
] as const
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri"]

/** G23: one time a routine ran (apps/host/src/routines.ts). */
interface RoutineRun {
  routineId: string
  name: string
  sessionId: string
  at: string
  branch?: string
}

const SHOWN_RUNS = 10

/**
 * G23: the review inbox. The latest runs, each with how its session stands, what is waiting for you in it (a blocked
 * action waits there for you, it does not fail), what it changed so far and what it cost, and Open.
 */
export function RoutineRuns() {
  const [runs, setRuns] = useState<RoutineRun[]>()
  useEffect(() => {
    void api<{ runs: RoutineRun[] }>("GET", "/api/routines/runs").then((r) =>
      setRuns(r.ok && r.data ? r.data.runs.slice(0, SHOWN_RUNS) : []),
    )
  }, [])
  if (!runs?.length) return null
  return (
    <section aria-labelledby="routine-runs" className="grid gap-1">
      <h3 id="routine-runs" className="m-0 text-[14px]">
        Recent runs
      </h3>
      <ul className="m-0 grid list-none gap-1 p-0">
        {runs.map((x) => (
          <RunRow key={`${x.sessionId}-${x.at}`} run={x} />
        ))}
      </ul>
    </section>
  )
}

function RunRow({ run }: { run: RoutineRun }) {
  const session = useStore((s) => s.sessions[run.sessionId])
  const cost = useStore((s) => s.usage?.bySession?.[run.sessionId]?.costUsd)
  const seq = useStore((s) => s.transcripts[run.sessionId]?.seq ?? 0)
  const selectSession = useStore((s) => s.selectSession)
  const setRoute = useStore((s) => s.setRoute)
  const [files, setFiles] = useState<number>()
  const open = session !== undefined
  useEffect(() => {
    if (!open) return
    let gone = false
    void send({ type: "changes", sessionId: run.sessionId }).then((r) => {
      if (!gone && r.ok) setFiles(((r.data as { files?: unknown[] }).files ?? []).length)
    })
    return () => {
      gone = true
    }
  }, [open, run.sessionId, seq])
  const waiting = session?.pendingApprovals ?? 0
  return (
    <li className="panel flex flex-wrap items-center gap-x-3 gap-y-1 p-2 text-[13px]">
      <strong>{run.name}</strong>
      <span className="text-mut">{clock(run.at)}</span>
      {run.branch ? <span className="mono text-mut">{run.branch}</span> : null}
      <span>
        {!open
          ? "closed"
          : waiting
            ? `${waiting === 1 ? "1 action waits" : `${waiting} actions wait`} for you`
            : session.state}
      </span>
      {files !== undefined ? (
        <span className="text-mut">
          {files === 0
            ? "nothing changed"
            : files === 1
              ? "1 file changed"
              : `${files} files changed`}
        </span>
      ) : null}
      {cost !== undefined ? <span className="text-mut">{money(cost)}</span> : null}
      {open ? (
        <button
          type="button"
          className="btn !min-h-7 ml-auto !text-[13px]"
          aria-label={`Open the run of ${run.name}`}
          onClick={() => {
            selectSession(run.sessionId)
            setRoute("workspace")
          }}
        >
          Open
        </button>
      ) : null}
    </li>
  )
}

/**
 * B34: routines in Settings. Each starts a normal session on its days and time while Codehouse is open, through every
 * check a session you start goes through.
 */
export function RoutinesPanel() {
  const [list, setList] = useState<Routine[]>()
  const [draft, setDraft] = useState({
    name: "",
    folder: "",
    prompt: "",
    time: "08:00",
    days: WEEKDAYS,
    extreme: false,
    worktree: false,
    phone: false,
    starts: "schedule" as Starts,
    once: "",
    into: "new" as "new" | "continue",
    filterField: "",
    filterEquals: "",
  })
  /** T-120: a routine's token, shown once when it is made or replaced. */
  const [shown, setShown] = useState<{ id: string; name: string; token: string }>()
  const [drafts, setDrafts] = useState<Draft[]>([])
  const load = async () => {
    const r = await api<{ routines: Routine[] }>("GET", "/api/routines")
    setList(r.ok && r.data ? r.data.routines : [])
    const d = await api<{ drafts: Draft[] }>("GET", "/api/routines/drafts")
    setDrafts((d.ok && d.data?.drafts) || [])
  }
  async function dismiss(d: Draft) {
    const r = await api("DELETE", `/api/routines/drafts/${encodeURIComponent(d.id)}`)
    if (!r.ok) return toast.error(r.error ?? "Not dismissed", { id: "routines" })
    void load()
  }
  /** Puts a draft into the form below, for you to read, change and save; Extreme approval stays off. */
  function useDraft(d: Draft) {
    setDraft({ ...draft, name: d.name, folder: d.folder, prompt: d.prompt, time: d.time, days: d.days, extreme: false, starts: "schedule" })
    void dismiss(d)
    toast("The draft is in the form below. Read it, change what you like, then save it.", { id: "routines" })
  }
  useEffect(() => void load(), [])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const { starts, once, into, filterField, filterEquals, ...rest } = draft
    const r = await api<{ routine: Routine; token?: string }>("PUT", "/api/routines", {
      ...rest,
      enabled: true,
      ...(starts === "commit" || starts === "files" ? { trigger: { kind: starts } } : {}),
      ...(starts === "webhook"
        ? { trigger: { kind: "webhook", ...(filterField.trim() ? { filters: [{ field: filterField.trim(), equals: filterEquals }] } : {}) } }
        : {}),
      ...(starts === "once" ? { once } : {}),
      ...(into === "continue" ? { into } : {}),
    })
    if (!r.ok) return toast.error(r.error ?? "The routine was not saved", { id: "routines" })
    setDraft({ ...draft, name: "", prompt: "" })
    if (r.data?.token) setShown({ id: r.data.routine.id, name: r.data.routine.name, token: r.data.token })
    toast("Routine saved", { id: "routines" })
    void load()
  }
  async function toggle(x: Routine) {
    const r = await api("PUT", "/api/routines", { ...x, enabled: !x.enabled })
    if (!r.ok) return toast.error(r.error ?? "Not saved", { id: "routines" })
    void load()
  }
  /** T-119: one run now, whatever its schedule, recorded as yours. */
  async function runNow(x: Routine) {
    const r = await api<{ sessionId: string }>("POST", `/api/routines/${encodeURIComponent(x.id)}/run`)
    if (!r.ok) return toast.error(r.error ?? "It did not start", { id: "routines" })
    toast.success(`${x.name} started`, { id: "routines" })
    void load()
  }
  /** T-120: a new token; the old one stops working. */
  async function newToken(x: Routine) {
    const r = await api<{ token: string }>("POST", `/api/routines/${encodeURIComponent(x.id)}/hook-token`)
    if (!r.ok || !r.data) return toast.error(r.error ?? "No new token", { id: "routines" })
    setShown({ id: x.id, name: x.name, token: r.data.token })
  }
  async function remove(x: Routine) {
    const r = await api("DELETE", `/api/routines/${encodeURIComponent(x.id)}`)
    if (!r.ok) return toast.error(r.error ?? "Not removed", { id: "routines" })
    void load()
  }

  return (
    <div className="grid gap-3">
      <p className="m-0 text-xs text-mut">
        A routine starts a session by itself on the days and at the time you choose, while Codehouse
        is open (within an hour of it, if the computer was asleep), and sends it your prompt. It
        goes through every check a session you start does: the kill switch, your sign-in and
        organisation, the limit on sessions, and every rule. With Max approval it carries on by
        itself within your turn and spending limits; otherwise it asks you as usual. One can start
        instead on a new commit in its folder, when files in it change, or when a program on this
        computer calls its address with its own token: never because of its own session&apos;s work,
        at most once in 15 minutes and 12 times a day.
      </p>
      {drafts.length ? (
        <section aria-label="Drafted by a session" className="grid gap-1.5">
          <h3 className="m-0 text-sm">Drafted by a session</h3>
          <ul className="m-0 grid list-none gap-2 p-0">
            {drafts.map((d) => (
              <li key={d.id} className="panel grid gap-1 p-2">
                <span className="flex flex-wrap items-center gap-2">
                  <strong className="min-w-0 flex-1 truncate">{d.name}</strong>
                  <button type="button" className="btn !min-h-7 !text-[13px]" onClick={() => useDraft(d)}>
                    Use this draft
                  </button>
                  <button
                    type="button"
                    className="btn !min-h-7 !text-[13px]"
                    aria-label={`Dismiss ${d.name}`}
                    onClick={() => void dismiss(d)}
                  >
                    Dismiss
                  </button>
                </span>
                <span className="mono truncate text-xs text-mut">
                  {startsText({ time: d.time, days: d.days as Routine["days"] })}, {d.folder}
                </span>
                <span className="line-clamp-3 whitespace-pre-wrap text-[13px]">{d.prompt}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {list?.length ? (
        <ul className="m-0 grid list-none gap-2 p-0" aria-label="Your routines">
          {list.map((x) => (
            <li key={x.id} className="panel flex flex-wrap items-center gap-2 p-2">
              <span className="grid min-w-0 flex-1">
                <strong className="truncate">{x.name}</strong>
                <span className="mono truncate text-xs text-mut">
                  {startsText(x)}, {x.folder}
                  {x.extreme ? ", Max approval" : ""}
                  {x.worktree ? ", in a new worktree" : ""}
                  {x.phone ? ", can be started from the phone" : ""}
                  {x.lastRun ? `, last ran ${x.lastRun}` : ""}
                </span>
              </span>
              <label className="flex items-center gap-1 text-sm">
                <input type="checkbox" checked={x.enabled} onChange={() => void toggle(x)} />
                On
              </label>
              <button type="button" className="btn !min-h-7 !text-[13px]" onClick={() => void runNow(x)}>
                Run now
              </button>
              {x.trigger?.kind === "webhook" ? (
                <button type="button" className="btn !min-h-7 !text-[13px]" onClick={() => void newToken(x)}>
                  New token
                </button>
              ) : null}
              <button
                type="button"
                className="btn !min-h-7 !text-[13px]"
                aria-label={`Remove ${x.name}`}
                onClick={() => void remove(x)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : list ? (
        <p className="m-0 text-mut">No routines yet.</p>
      ) : null}
      {shown ? (
        <section aria-label="Its address and token" className="panel grid gap-1.5 p-2 text-[13px]">
          <strong>{shown.name}: its address and token</strong>
          <span>
            A program on this computer starts it by sending a POST, with a JSON body if you like, to this address with
            this token as a bearer token. The token is shown only now; Codehouse keeps only a hash of it. Values from the
            body fill placeholders such as {"{{action}}"} in the prompt, and are given to Claude as untrusted data.
          </span>
          <code className="mono break-all">{hookAddress(shown.id)}</code>
          <code className="mono break-all">{shown.token}</code>
          <span className="flex gap-1">
            <button type="button" className="btn !min-h-7 !text-[13px]" onClick={() => void navigator.clipboard?.writeText(`curl -X POST -H "Authorization: Bearer ${shown.token}" -H "Content-Type: application/json" -d "{}" ${hookAddress(shown.id)}`)}>
              Copy as a curl command
            </button>
            <button type="button" className="btn !min-h-7 !text-[13px]" onClick={() => setShown(undefined)}>
              Done
            </button>
          </span>
        </section>
      ) : null}
      <RoutineRuns />
      <form className="grid gap-2" onSubmit={(e) => void add(e)} aria-label="Add a routine">
        <div className="grid grid-cols-2 gap-2 max-[700px]:grid-cols-1">
          <label className="grid gap-1 text-sm">
            <span>Name</span>
            <input
              className="field"
              maxLength={60}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span>Folder</span>
            <input
              className="field mono"
              placeholder={isMac() ? "/Users/you/dev/shop" : "C:\\dev\\shop"} // Mac fork
              value={draft.folder}
              onChange={(e) => setDraft({ ...draft, folder: e.target.value })}
            />
          </label>
        </div>
        <label className="grid gap-1 text-sm">
          <span>Prompt</span>
          <textarea
            className="field"
            rows={3}
            maxLength={8000}
            value={draft.prompt}
            onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
          />
        </label>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm">
            <span>Starts</span>
            <select
              className="field"
              value={draft.starts}
              onChange={(e) => setDraft({ ...draft, starts: e.target.value as Starts })}
            >
              <option value="schedule">On a schedule</option>
              <option value="once">Once</option>
              <option value="commit">On a new commit</option>
              <option value="files">When files change</option>
              <option value="webhook">When a program on this computer calls it</option>
            </select>
          </label>
          {draft.starts === "webhook" ? (
            <>
              <label className="grid gap-1 text-sm">
                <span>Only if the field</span>
                <input className="field mono" placeholder="action" value={draft.filterField} onChange={(e) => setDraft({ ...draft, filterField: e.target.value })} />
              </label>
              <label className="grid gap-1 text-sm">
                <span>is</span>
                <input className="field mono" placeholder="opened" value={draft.filterEquals} onChange={(e) => setDraft({ ...draft, filterEquals: e.target.value })} />
              </label>
            </>
          ) : null}
          {draft.starts === "once" ? (
            <label className="grid gap-1 text-sm">
              <span>When</span>
              <input className="field" type="datetime-local" value={draft.once} onChange={(e) => setDraft({ ...draft, once: e.target.value })} />
            </label>
          ) : null}
          <label className="grid gap-1 text-sm">
            <span>Each run</span>
            <select className="field" value={draft.into} onChange={(e) => setDraft({ ...draft, into: e.target.value as "new" | "continue" })}>
              <option value="new">In a new conversation</option>
              <option value="continue">Carries on the last one, while it is open</option>
            </select>
          </label>
          {draft.starts === "schedule" ? (
            <>
              <label className="grid gap-1 text-sm">
                <span>Time</span>
                <input
                  className="field"
                  type="time"
                  value={draft.time}
                  onChange={(e) => setDraft({ ...draft, time: e.target.value })}
                />
              </label>
              <fieldset className="m-0 flex flex-wrap gap-2 border-0 p-0">
                <legend className="mb-1 p-0 text-sm">Days</legend>
                {DAYS.map(([id, label]) => (
                  <label key={id} className="flex items-center gap-1 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.days.includes(id)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          days: e.target.checked
                            ? [...draft.days, id]
                            : draft.days.filter((d) => d !== id),
                        })
                      }
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
            </>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.extreme}
              onChange={(e) => setDraft({ ...draft, extreme: e.target.checked })}
            />
            Max approval
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.worktree}
              onChange={(e) => setDraft({ ...draft, worktree: e.target.checked })}
            />
            In a new worktree each time
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.phone}
              onChange={(e) => setDraft({ ...draft, phone: e.target.checked })}
            />
            Can be started from the phone
          </label>
          <button className="btn btn-primary" disabled={!draft.name.trim() || !draft.prompt.trim()}>
            Add the routine
          </button>
        </div>
      </form>
    </div>
  )
}
