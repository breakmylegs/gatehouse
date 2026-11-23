import { useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

interface Written {
  id: string
  title: string
  file: string
  dependsOn: string[]
  written: boolean
}

/** E-062: an epic broken into stories by Claude, written into the requirement ledger with stable ids. */
export function EpicPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [epic, setEpic] = useState("")
  const [brief, setBrief] = useState("")
  const [written, setWritten] = useState<Written[]>()
  const ask = () => void send({ type: "epic", sessionId, step: "ask", epic: epic.trim(), brief: brief.trim() }).then((x) => (x.ok ? toast("Asked Claude for the stories", { id: "epic" }) : toast.error(x.error?.message ?? "Not asked", { id: "epic" })))
  const write = () => void send({ type: "epic", sessionId, step: "write", epic: epic.trim() }).then((x) => (x.ok ? setWritten((x.data as { stories: Written[] }).stories) : toast.error(x.error?.message ?? "Not written", { id: "epic" })))
  return (
    <section aria-label="Epic" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Break down an epic</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      <input className="field" aria-label="The epic" placeholder="The epic" value={epic} onChange={(e) => setEpic(e.target.value)} />
      <textarea className="field min-h-20" aria-label="The brief" placeholder="The brief" value={brief} onChange={(e) => setBrief(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn !min-h-7" disabled={!epic.trim() || !brief.trim()} onClick={ask}>
          Ask Claude to break it down
        </button>
        <button type="button" className="btn btn-primary !min-h-7" disabled={!epic.trim()} onClick={write}>
          Write the stories into the ledger
        </button>
      </div>
      <p className="m-0 text-xs text-mut">
        Each story goes into docs/requirements with an id from the epic and its title, so breaking the epic down again keeps
        the ids; a story already there is not overwritten. Estimates come from this project&apos;s history when it has enough.
      </p>
      {written ? (
        <ul className="m-0 grid list-none gap-0.5 p-0">
          {written.map((w) => (
            <li key={w.id}>
              <span className="mono">{w.id}</span> {w.title}
              {w.dependsOn.length ? <span className="text-mut"> (after {w.dependsOn.join(", ")})</span> : null}
              {!w.written ? <span className="text-mut">, already in the ledger</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
