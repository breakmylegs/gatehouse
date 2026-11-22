import { useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

/** E-019: a price sheet and its signature, kept only when they verify against the key in the managed folder. */
export function PriceSheetImport() {
  const [sheet, setSheet] = useState<File>()
  const [sig, setSig] = useState<File>()
  const [busy, setBusy] = useState(false)
  async function go() {
    if (!sheet || !sig) return
    setBusy(true)
    const r = await send({ type: "price_sheet_import", sheet: await sheet.text(), signature: await sig.text() })
    setBusy(false)
    if (!r.ok) return void toast.error(r.error?.message ?? "The price sheet was not kept", { id: "prices" })
    const d = r.data as { items: number; currency: string }
    toast(`Price sheet kept: ${d.items} price(s) in ${d.currency}`, { id: "prices" })
  }
  return (
    <div className="grid gap-2">
      <label className="grid gap-1">
        <span className="text-xs text-mut">Price sheet (prices.json)</span>
        <input type="file" accept=".json,application/json" onChange={(e) => setSheet(e.target.files?.[0])} />
      </label>
      <label className="grid gap-1">
        <span className="text-xs text-mut">Its signature (prices.sig)</span>
        <input type="file" accept=".sig,text/plain" onChange={(e) => setSig(e.target.files?.[0])} />
      </label>
      <button type="button" className="btn !min-h-7 justify-self-start" disabled={!sheet || !sig || busy} onClick={() => void go()}>
        {busy ? "Checking…" : "Import"}
      </button>
      <p className="m-0 text-xs text-mut">
        Kept only when its signature verifies against the key in the managed folder (prices-key.json, or osv-key.json),
        which only an administrator can change. An apply&apos;s card then shows the monthly change its plan makes. Nothing
        is fetched; Doctor shows the sheet in use.
      </p>
    </div>
  )
}
