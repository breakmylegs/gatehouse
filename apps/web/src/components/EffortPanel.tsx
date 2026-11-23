import { useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

/** E-063: the effort and billing log of the session's project, as CSV; kept on this computer, and deletable. */
export function EffortPanel({ sessionId, project, onClose }: { sessionId: string; project: string; onClose: () => void }) {
  const [csv, setCsv] = useState<string>()
  const [all, setAll] = useState(false)
  async function load() {
    const x = await send({ type: "effort_export", sessionId, ...(all ? { all: true } : {}) })
    if (x.ok) setCsv((x.data as { csv: string }).csv)
    else toast.error(x.error?.message ?? "Not exported", { id: "effort" })
  }
  function save() {
    if (!csv) return
    const a = document.createElement("a")
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
    a.download = `effort-${all ? "all-projects" : project}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  async function remove() {
    if (!confirm(all ? "Delete the effort log of every project?" : `Delete the effort log of ${project}?`)) return
    const x = await send({ type: "effort_delete", sessionId, ...(all ? { all: true } : {}) })
    if (x.ok) {
      setCsv(undefined)
      toast("Deleted", { id: "effort" })
    } else toast.error(x.error?.message ?? "Not deleted", { id: "effort" })
  }
  return (
    <section aria-label="Effort and billing" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Effort and billing</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="m-0 text-mut">Your active time, the agent's time and the cost, by day. Kept on this computer only.</p>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
        Every project, not just {project}
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary !min-h-7" onClick={() => void load()}>
          Show
        </button>
        <button type="button" className="btn !min-h-7" disabled={!csv} onClick={save}>
          Save as CSV
        </button>
        <button type="button" className="btn btn-deny !min-h-7" onClick={() => void remove()}>
          Delete the log
        </button>
      </div>
      {csv ? <pre className="m-0 max-h-60 overflow-auto whitespace-pre text-xs">{csv}</pre> : null}
    </section>
  )
}
