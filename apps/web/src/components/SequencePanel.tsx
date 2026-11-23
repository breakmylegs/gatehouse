import { useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

interface Result {
  participants: string[]
  calls: Array<{ resolved: boolean }>
  unresolved: Array<{ from: string; label: string; file: string; line: number }>
  mermaid: string
  artifact?: { id: string; version: number }
}

/** E-084: the calls from an entry point, as a sequence diagram in Artifacts, with what could not be resolved. */
export function SequencePanel({ sessionId, onOpenArtifacts, onClose }: { sessionId: string; onOpenArtifacts: () => void; onClose: () => void }) {
  const [entry, setEntry] = useState("")
  const [depth, setDepth] = useState(3)
  const [r, setR] = useState<Result>()
  const [busy, setBusy] = useState(false)
  async function draw() {
    if (!entry.trim()) return
    setBusy(true)
    const x = await send({ type: "sequence_diagram", sessionId, entry: entry.trim(), depth }, 120_000)
    setBusy(false)
    if (x.ok) setR(x.data as Result)
    else toast.error(x.error?.message ?? "Not drawn", { id: "sequence" })
  }
  return (
    <section aria-label="Sequence diagram" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Sequence diagram from code</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid flex-1 gap-1">
          <span className="text-xs text-mut">Entry point: file#function or file#Class.method</span>
          <input className="field" value={entry} placeholder="src/routes/orders.ts#createOrder" onChange={(e) => setEntry(e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-mut">Depth</span>
          <input className="field w-16" type="number" min={1} max={8} value={depth} onChange={(e) => setDepth(Math.min(8, Math.max(1, Number(e.target.value) || 1)))} />
        </label>
        <button type="button" className="btn btn-primary !min-h-7" disabled={busy || !entry.trim()} onClick={() => void draw()}>
          {busy ? "Reading the code…" : "Draw"}
        </button>
      </div>
      {r ? (
        <>
          <p className="m-0">
            {r.participants.length - 1} participants, {r.calls.filter((c) => c.resolved).length} calls followed
            {r.unresolved.length ? `, ${r.unresolved.length} not resolved (drawn to Unresolved):` : "."}
          </p>
          {r.unresolved.length ? (
            <ul className="m-0 grid list-none gap-0.5 p-0">
              {r.unresolved.map((u) => (
                <li key={`${u.file}:${u.line}:${u.label}`}>
                  {u.from}: {u.label} <span className="text-mut">({u.file}:{u.line})</span>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex gap-2">
            {r.artifact ? (
              <button type="button" className="btn btn-primary !min-h-7" onClick={onOpenArtifacts}>
                See the diagram in Artifacts
              </button>
            ) : null}
            <button type="button" className="btn !min-h-7" onClick={() => void navigator.clipboard.writeText(r.mermaid).then(() => toast("Copied", { id: "sequence" }))}>
              Copy the Mermaid
            </button>
          </div>
        </>
      ) : null}
    </section>
  )
}
