import { useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

/** E-063: the effort and billing log of the session's project, as CSV; kept on this computer, and deletable. */
export function EffortPanel({ sessionId, project, onClose }: { sessionId: string; project: string; onClose: () => void }) {
  const [csv, setCsv] = useState<string>()
  const [all, setAll] = useState(false)
  const [energy, setEnergy] = useState<{ localWh: number; modelWh: number | string; carbonGrams: number | string; basis: string; figures: { deviceWatts?: number; modelWhPer1kTokens?: number; gridGramsPerKwh?: number } }>()
  const [figures, setFigures] = useState({ deviceWatts: "", modelWhPer1kTokens: "", gridGramsPerKwh: "" })
  async function loadEnergy() {
    const x = await send({ type: "energy_estimate", sessionId, ...(all ? { all: true } : {}) })
    if (!x.ok) return void toast.error(x.error?.message ?? "No estimate", { id: "effort" })
    const d = x.data as NonNullable<typeof energy>
    setEnergy(d)
    setFigures({ deviceWatts: String(d.figures.deviceWatts ?? ""), modelWhPer1kTokens: String(d.figures.modelWhPer1kTokens ?? ""), gridGramsPerKwh: String(d.figures.gridGramsPerKwh ?? "") })
  }
  async function saveFigures() {
    const n = (v: string) => (v.trim() === "" ? null : Number(v))
    const x = await send({ type: "energy_figures", deviceWatts: n(figures.deviceWatts), modelWhPer1kTokens: n(figures.modelWhPer1kTokens), gridGramsPerKwh: n(figures.gridGramsPerKwh) })
    if (!x.ok) return void toast.error(x.error?.message ?? "Not saved", { id: "effort" })
    await loadEnergy()
  }
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
      <div className="grid gap-1 border-t border-line pt-2">
        <button type="button" className="btn !min-h-7 justify-self-start" onClick={() => void loadEnergy()}>
          Estimate the energy and carbon
        </button>
        {energy ? (
          <>
            <p className="m-0" role="status">
              An estimate: this computer {energy.localWh} Wh; the models {typeof energy.modelWh === "number" ? `${energy.modelWh} Wh` : energy.modelWh}; carbon {typeof energy.carbonGrams === "number" ? `${energy.carbonGrams} g CO2e` : energy.carbonGrams}.
            </p>
            <p className="m-0 text-mut">{energy.basis}.</p>
            <div className="flex flex-wrap items-end gap-2">
              {(
                [
                  ["deviceWatts", "This computer at full load (W)"],
                  ["modelWhPer1kTokens", "The models (Wh per 1,000 tokens)"],
                  ["gridGramsPerKwh", "Your grid (g CO2e per kWh)"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="grid gap-1">
                  <span className="text-xs text-mut">{label}</span>
                  <input className="field w-28" inputMode="decimal" value={figures[k]} onChange={(e) => setFigures({ ...figures, [k]: e.target.value })} />
                </label>
              ))}
              <button type="button" className="btn !min-h-7" onClick={() => void saveFigures()}>
                Save the figures
              </button>
            </div>
          </>
        ) : null}
      </div>
    </section>
  )
}
