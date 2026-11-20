import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"

type Level = "plan" | "default" | "acceptEdits" | "auto" | "extreme"
interface Cap {
  level: Level
  at: string
  by: "record" | "you"
  reasons: string[]
}

const NAMES: Record<Level, string> = { plan: "Plan", default: "Manual", acceptEdits: "Accept edits", auto: "Auto", extreme: "Extreme approval" }
const ORDER: Level[] = ["plan", "default", "acceptEdits", "auto", "extreme"]

/**
 * C-015, Settings: projects whose record capped what a session there may do. Codehouse lowers a cap by itself from 30
 * days of the audit log; only you raise one, here.
 */
export function AutonomyPanel() {
  const [caps, setCaps] = useState<Record<string, Cap>>()
  const [raiseTo, setRaiseTo] = useState<Record<string, Level>>({})
  const load = async () => {
    const r = await api<{ caps: Record<string, Cap> }>("GET", "/api/autonomy")
    setCaps(r.ok && r.data && typeof r.data.caps === "object" ? r.data.caps : {})
  }
  useEffect(() => void load(), [])
  async function review() {
    const r = await api<{ lowered: Array<{ project: string }>; caps: Record<string, Cap> }>("POST", "/api/autonomy/review")
    if (!r.ok || !r.data) return toast.error(r.error ?? "The record could not be read", { id: "autonomy" })
    setCaps(r.data.caps)
    toast(r.data.lowered.length ? `Lowered: ${r.data.lowered.map((l) => l.project).join(", ")}` : "Nothing to lower", { id: "autonomy" })
  }
  async function raise(project: string, level: Level) {
    const r = await api<{ caps: Record<string, Cap> }>("POST", `/api/autonomy/${encodeURIComponent(project)}/raise`, { level })
    if (!r.ok || !r.data) return toast.error(r.error ?? "Not raised", { id: "autonomy" })
    setCaps(r.data.caps)
    toast(`${project} raised to ${NAMES[level]}`, { id: "autonomy" })
  }
  const entries = Object.entries(caps ?? {})
  return (
    <div className="grid gap-2 text-[13px]">
      <p className="m-0 text-xs text-mut">
        Codehouse reads each project&apos;s last 30 days in the audit log, once a day. When the floor had to deny a call
        three times there, or you denied five, a session in that project starts no higher than Accept edits (Manual after
        ten, or fifteen). It only ever lowers: raising a project again is yours, here.
      </p>
      {caps === undefined ? null : entries.length === 0 ? (
        <p className="m-0 text-mut">No project is capped.</p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0" aria-label="Capped projects">
          {entries.map(([project, c]) => {
            const higher = ORDER.filter((l) => ORDER.indexOf(l) > ORDER.indexOf(c.level))
            const to = raiseTo[project] ?? higher[0]!
            return (
              <li key={project} className="panel grid gap-1 p-2">
                <span>
                  <strong>{project}</strong>: no higher than {NAMES[c.level]}
                  {c.by === "you" ? ", as you set it" : c.reasons.length ? `, because ${c.reasons.join(" and ")}` : ""}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <select aria-label={`Raise ${project} to`} className="field !min-h-7" value={to} onChange={(e) => setRaiseTo({ ...raiseTo, [project]: e.target.value as Level })}>
                    {higher.map((l) => (
                      <option key={l} value={l}>
                        {l === "extreme" ? "No cap" : NAMES[l]}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="btn !min-h-7" onClick={() => void raise(project, to)}>
                    Raise
                  </button>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      <button type="button" className="btn w-fit !min-h-7" onClick={() => void review()}>
        Look at the record now
      </button>
    </div>
  )
}
