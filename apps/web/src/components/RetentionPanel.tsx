import { useEffect, useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

interface Status {
  project: string
  classification: string
  days: Record<string, number>
  holds: Array<{ id: string; project?: string; kind?: string; reason: string; placedAt: string }>
}

/** E-066: how long the project's evidence and logs are kept, and the legal holds that suspend deletion. */
export function RetentionPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [s, setS] = useState<Status>()
  const [reason, setReason] = useState("")
  const [all, setAll] = useState(false)
  async function load() {
    const x = await send({ type: "retention_status", sessionId })
    if (x.ok) setS(x.data as Status)
    else toast.error(x.error?.message ?? "Not read", { id: "retention" })
  }
  useEffect(() => {
    void load()
  }, [sessionId])
  async function place() {
    if (!reason.trim()) return
    const x = await send({ type: "legal_hold_place", sessionId, reason: reason.trim(), ...(all ? { all: true } : {}) })
    if (!x.ok) return void toast.error(x.error?.message ?? "Not placed", { id: "retention" })
    setReason("")
    toast("Legal hold placed", { id: "retention" })
    await load()
  }
  async function release(holdId: string) {
    if (!confirm("Release this legal hold? What it kept is deleted when its retention has passed.")) return
    const x = await send({ type: "legal_hold_release", sessionId, holdId })
    if (!x.ok) return void toast.error(x.error?.message ?? "Not released", { id: "retention" })
    await load()
  }
  return (
    <section aria-label="Retention and legal hold" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Retention and legal hold</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      {s ? (
        <p className="m-0">
          {s.project} is {s.classification}: evidence packs are kept {s.days.evidence} days and log lines {s.days.logs}. Audit files are never deleted.
        </p>
      ) : null}
      {s?.holds.length ? (
        <ul className="m-0 grid list-none gap-1 p-0">
          {s.holds.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-2">
              <strong>{h.project ?? "Every project"}</strong>
              <span>
                {h.kind ?? "everything"}, since {h.placedAt.slice(0, 10)}: {h.reason}
              </span>
              <button type="button" className="btn !min-h-7" onClick={() => void release(h.id)}>
                Release
              </button>
            </li>
          ))}
        </ul>
      ) : s ? (
        <p className="m-0 text-mut">No legal hold.</p>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid flex-1 gap-1">
          <span className="text-xs text-mut">Reason for a legal hold</span>
          <input className="field" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          Every project
        </label>
        <button type="button" className="btn btn-primary !min-h-7" disabled={!reason.trim()} onClick={() => void place()}>
          Place a legal hold
        </button>
      </div>
    </section>
  )
}
