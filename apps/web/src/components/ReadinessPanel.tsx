import { useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

interface Section {
  name: string
  state: "ok" | "blocks" | "warn" | "not set up"
  detail: string
}
interface Report {
  ready: boolean
  reasons: string[]
  sections: Section[]
  candidate: string
  markdown: string
}

const MARK = { ok: "OK", blocks: "Blocks", warn: "Check", "not set up": "Not set up" }

/** E-058: whether the project's change is ready to release, area by area, with what blocks it. */
export function ReadinessPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [candidate, setCandidate] = useState("")
  const [r, setR] = useState<Report>()
  const [busy, setBusy] = useState(false)
  const [backout, setBackout] = useState<{ reversible: boolean; detail: string }>()
  const [record, setRecord] = useState<{ fields: Array<{ name: string; text?: string; evidence: string[]; needsInput?: string }>; markdown: string }>()
  const [schedule, setSchedule] = useState("")
  async function checkBackout() {
    setBusy(true)
    const x = await send({ type: "backout_check", sessionId })
    setBusy(false)
    if (x.ok) setBackout(x.data as NonNullable<typeof backout>)
    else toast.error(x.error?.message ?? "Not checked", { id: "release" })
  }
  async function draft() {
    setBusy(true)
    const x = await send({ type: "change_record", sessionId, ...(candidate.trim() ? { candidate: candidate.trim() } : {}), ...(schedule.trim() ? { schedule: schedule.trim() } : {}) })
    setBusy(false)
    if (x.ok) setRecord(x.data as NonNullable<typeof record>)
    else toast.error(x.error?.message ?? "Not drafted", { id: "release" })
  }
  async function check() {
    setBusy(true)
    const x = await send({ type: "release_readiness", sessionId, ...(candidate.trim() ? { candidate: candidate.trim() } : {}) })
    setBusy(false)
    if (x.ok) setR(x.data as Report)
    else toast.error(x.error?.message ?? "No report", { id: "release" })
  }
  return (
    <section aria-label="Release readiness" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Release readiness</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1">
          <span className="text-xs text-mut">Release candidate (empty: this project at its last commit)</span>
          <input className="field" value={candidate} onChange={(e) => setCandidate(e.target.value)} />
        </label>
        <button type="button" className="btn btn-primary !min-h-7" disabled={busy} onClick={() => void check()}>
          {busy ? "Working…" : "Check"}
        </button>
        <button type="button" className="btn !min-h-7" disabled={busy} onClick={() => void checkBackout()}>
          Check the backout
        </button>
      </div>
      {backout ? <p className={`m-0 ${backout.reversible ? "" : "font-semibold"}`}>{backout.reversible ? "Reversible: " : "Not reversible: "}{backout.detail}</p> : null}
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid flex-1 gap-1">
          <span className="text-xs text-mut">Schedule for the change record (empty: to give later)</span>
          <input className="field" value={schedule} onChange={(e) => setSchedule(e.target.value)} />
        </label>
        <button type="button" className="btn !min-h-7" disabled={busy} onClick={() => void draft()}>
          Draft the change record
        </button>
      </div>
      {record ? (
        <div className="grid gap-1">
          {record.fields.map((f) => (
            <span key={f.name}>
              <strong>{f.name}</strong>: {f.text ?? ""}
              {f.needsInput ? <span className="font-semibold"> Needs your input: {f.needsInput}</span> : null}
            </span>
          ))}
          <button type="button" className="btn !min-h-7 justify-self-start" onClick={() => void navigator.clipboard.writeText(record.markdown).then(() => toast("Copied", { id: "release" }))}>
            Copy the CAB pack
          </button>
        </div>
      ) : null}
      {r ? (
        <>
          <p className={`m-0 ${r.ready ? "text-ok" : "font-semibold text-sev"}`}>{r.ready ? `${r.candidate} is ready.` : `${r.candidate} is not ready.`}</p>
          <ul className="m-0 grid list-none gap-0.5 p-0">
            {r.sections.map((s) => (
              <li key={s.name}>
                <strong>{MARK[s.state]}</strong> {s.name}: <span className="text-mut">{s.detail}</span>
              </li>
            ))}
          </ul>
          <button type="button" className="btn !min-h-7 justify-self-start" onClick={() => void navigator.clipboard.writeText(r.markdown).then(() => toast("Copied", { id: "release" }))}>
            Copy the report
          </button>
        </>
      ) : null}
    </section>
  )
}
