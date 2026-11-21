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

/** D-019: a step up the record has earned, waiting for you. */
interface Proposal {
  from: Level
  to: Level
  at: string
  reasons: string[]
}
interface ProposalsView {
  caps: Record<string, Cap>
  proposals: Record<string, Proposal>
  /** Projects whose raise waits for the phone's passkey. */
  confirming: string[]
  waitingForPhone?: boolean
}

const NAMES: Record<Level, string> = { plan: "Plan", default: "Manual", acceptEdits: "Accept edits", auto: "Auto", extreme: "Extreme approval" }
const ORDER: Level[] = ["plan", "default", "acceptEdits", "auto", "extreme"]

/**
 * C-015, Settings: projects whose record capped what a session there may do. Codehouse lowers a cap by itself from 30
 * days of the audit log; only you raise one, here. D-019: a clean record since the cap was set proposes a step up,
 * which applies only when you accept it (and, with a phone paired, confirm with its passkey).
 */
export function AutonomyPanel() {
  const [caps, setCaps] = useState<Record<string, Cap>>()
  const [raiseTo, setRaiseTo] = useState<Record<string, Level>>({})
  const [proposals, setProposals] = useState<Record<string, Proposal>>({})
  const [confirming, setConfirming] = useState<string[]>([])
  const show = (v: ProposalsView) => {
    setCaps(v.caps)
    setProposals(v.proposals ?? {})
    setConfirming(v.confirming ?? [])
  }
  const load = async () => {
    const r = await api<ProposalsView>("GET", "/api/autonomy/proposals")
    if (r.ok && r.data && typeof r.data.caps === "object") show(r.data)
    else {
      const c = await api<{ caps: Record<string, Cap> }>("GET", "/api/autonomy")
      setCaps(c.ok && c.data && typeof c.data.caps === "object" ? c.data.caps : {})
    }
  }
  useEffect(() => void load(), [])
  // While a raise waits for the phone, look again now and then, so it shows once the passkey confirms it.
  useEffect(() => {
    if (!confirming.length) return
    const t = setInterval(() => void load(), 5000)
    return () => clearInterval(t)
  }, [confirming.length])
  async function accept(project: string) {
    const r = await api<ProposalsView>("POST", `/api/autonomy/${encodeURIComponent(project)}/accept`)
    if (!r.ok || !r.data) return toast.error(r.error ?? "Not raised", { id: "autonomy" })
    show(r.data)
    toast(r.data.waitingForPhone ? "Confirm it on your phone with your passkey" : `${project} raised`, { id: "autonomy" })
  }
  async function decline(project: string) {
    const r = await api<ProposalsView>("POST", `/api/autonomy/${encodeURIComponent(project)}/decline`)
    if (!r.ok || !r.data) return toast.error(r.error ?? "Not changed", { id: "autonomy" })
    show(r.data)
    toast(`${project} stays as it is`, { id: "autonomy" })
  }
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
        ten, or fifteen). It only ever lowers: raising a project again is yours, here. When a capped project goes clean
        (twenty of your approvals none undone, three Verified done-claims, no failed sealed check and no floor deny since
        the cap), it proposes one step up; that applies only when you accept it, and with your phone paired, when you
        confirm on the phone too.
      </p>
      {caps === undefined ? null : entries.length === 0 ? (
        <p className="m-0 text-mut">No project is capped.</p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0" aria-label="Capped projects">
          {entries.map(([project, c]) => {
            const higher = ORDER.filter((l) => ORDER.indexOf(l) > ORDER.indexOf(c.level))
            const to = raiseTo[project] ?? higher[0]!
            const p = proposals[project]
            const waiting = confirming.includes(project)
            return (
              <li key={project} className="panel grid gap-1 p-2">
                <span>
                  <strong>{project}</strong>: no higher than {NAMES[c.level]}
                  {c.by === "you" ? ", as you set it" : c.reasons.length ? `, because ${c.reasons.join(" and ")}` : ""}
                </span>
                {p ? (
                  <span className="grid gap-1" role="group" aria-label={`${project} has earned a step up`}>
                    <span>
                      Earned a step up to {p.to === "extreme" ? "no cap" : NAMES[p.to]}: {p.reasons.join("; ")}.
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <button type="button" className="btn !min-h-7" disabled={waiting} onClick={() => void accept(project)}>
                        {waiting ? "Waiting for your phone…" : `Raise to ${p.to === "extreme" ? "no cap" : NAMES[p.to]}`}
                      </button>
                      <button type="button" className="btn !min-h-7" disabled={waiting} onClick={() => void decline(project)}>
                        Not now
                      </button>
                    </span>
                  </span>
                ) : null}
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
