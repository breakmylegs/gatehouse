import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"

interface Routine {
  id: string
  name: string
  folder: string
  prompt: string
  time: string
  days: string[]
  extreme?: boolean
  enabled: boolean
  lastRun?: string
  /** Absent: on a schedule. */
  trigger?: { kind: "commit" | "files" }
}

type Starts = "schedule" | "commit" | "files"

/** When a routine starts, in words. */
export function startsText(x: Pick<Routine, "time" | "days" | "trigger">): string {
  if (x.trigger?.kind === "commit") return "on a new commit"
  if (x.trigger?.kind === "files") return "when files change"
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
    starts: "schedule" as Starts,
  })
  const load = async () => {
    const r = await api<{ routines: Routine[] }>("GET", "/api/routines")
    setList(r.ok && r.data ? r.data.routines : [])
  }
  useEffect(() => void load(), [])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const { starts, ...rest } = draft
    const r = await api("PUT", "/api/routines", {
      ...rest,
      enabled: true,
      ...(starts === "schedule" ? {} : { trigger: { kind: starts } }),
    })
    if (!r.ok) return toast.error(r.error ?? "The routine was not saved", { id: "routines" })
    setDraft({ ...draft, name: "", prompt: "" })
    toast("Routine saved", { id: "routines" })
    void load()
  }
  async function toggle(x: Routine) {
    const r = await api("PUT", "/api/routines", { ...x, enabled: !x.enabled })
    if (!r.ok) return toast.error(r.error ?? "Not saved", { id: "routines" })
    void load()
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
        organisation, the limit on sessions, and every rule. With Extreme approval it carries on by
        itself within your turn and spending limits; otherwise it asks you as usual. One can start
        instead on a new commit in its folder, or when files in it change: never because of its own
        session&apos;s work, at most once in 15 minutes and 12 times a day.
      </p>
      {list?.length ? (
        <ul className="m-0 grid list-none gap-2 p-0" aria-label="Your routines">
          {list.map((x) => (
            <li key={x.id} className="panel flex flex-wrap items-center gap-2 p-2">
              <span className="grid min-w-0 flex-1">
                <strong className="truncate">{x.name}</strong>
                <span className="mono truncate text-xs text-mut">
                  {startsText(x)}, {x.folder}
                  {x.extreme ? ", Extreme approval" : ""}
                  {x.lastRun ? `, last ran ${x.lastRun}` : ""}
                </span>
              </span>
              <label className="flex items-center gap-1 text-sm">
                <input type="checkbox" checked={x.enabled} onChange={() => void toggle(x)} />
                On
              </label>
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
              placeholder="C:\dev\shop"
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
              <option value="commit">On a new commit</option>
              <option value="files">When files change</option>
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
            Extreme approval
          </label>
          <button className="btn btn-primary" disabled={!draft.name.trim() || !draft.prompt.trim()}>
            Add the routine
          </button>
        </div>
      </form>
    </div>
  )
}
