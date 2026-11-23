import { useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

/** E-077: a signed handover pack across your projects, and checking one you were given. */
export function HandoverPackPanel({ onClose }: { onClose: () => void }) {
  const [by, setBy] = useState("")
  const [note, setNote] = useState("")
  const [shown, setShown] = useState<{ markdown: string; trustedKey?: boolean; mine: boolean }>()
  async function make() {
    const x = await send({ type: "handover_pack", by: by.trim(), note })
    if (!x.ok) return void toast.error(x.error?.message ?? "Not made", { id: "handover" })
    const d = x.data as { signed: unknown; markdown: string }
    const a = document.createElement("a")
    a.href = URL.createObjectURL(new Blob([JSON.stringify(d.signed, null, 2)], { type: "application/json" }))
    a.download = `handover-${new Date().toISOString().slice(0, 10)}.codehouse-handover.json`
    a.click()
    URL.revokeObjectURL(a.href)
    setShown({ markdown: d.markdown, mine: true })
  }
  async function check(file: File) {
    let signed: unknown
    try {
      signed = JSON.parse(await file.text())
    } catch {
      return void toast.error("That file is not a handover pack", { id: "handover" })
    }
    const x = await send({ type: "handover_open", signed })
    if (!x.ok) return void toast.error(x.error?.message ?? "Refused", { id: "handover" })
    setShown({ ...(x.data as { markdown: string; trustedKey: boolean }), mine: false })
  }
  return (
    <section aria-label="Handover pack" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Handover pack</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="m-0 text-mut">Across all your projects: open sessions, decisions waiting, grants expiring within a week, routines and a summary. Redacted, then signed with this computer's key.</p>
      <label className="grid gap-1">
        <span className="text-xs text-mut">From</span>
        <input className="field" value={by} onChange={(e) => setBy(e.target.value)} />
      </label>
      <label className="grid gap-1">
        <span className="text-xs text-mut">What the next person should know</span>
        <textarea className="field min-h-16" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary !min-h-7" disabled={!by.trim()} onClick={() => void make()}>
          Make and save the pack
        </button>
        <label className="btn !min-h-7 cursor-pointer">
          Check a pack you were given
          <input type="file" accept=".json" className="sr-only" onChange={(e) => e.target.files?.[0] && void check(e.target.files[0])} />
        </label>
      </div>
      {shown ? (
        <>
          <p className="m-0" role="status">
            {shown.mine ? "Saved and signed." : `The pack verifies: nothing was changed after it was signed${shown.trustedKey ? ", by a key you trust" : ""}.`}
          </p>
          <pre className="m-0 max-h-60 overflow-auto whitespace-pre-wrap text-xs">{shown.markdown}</pre>
        </>
      ) : null}
    </section>
  )
}
