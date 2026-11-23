import { useEffect, useState } from "react"
import { send } from "../store"

interface Item {
  text: string
  status: "met" | "unmet" | "person"
  why: string
}

/** E-057: the project's definition of done for this session; what only a person can check is ticked here. */
export function DodPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [items, setItems] = useState<Item[] | null>()
  const [busy, setBusy] = useState(false)
  const go = async (step: "status" | "tick" | "untick", item?: string) => {
    setBusy(true)
    const x = await send({ type: "dod", sessionId, step, ...(item ? { item } : {}) })
    setBusy(false)
    setItems(x.ok ? ((x.data as { items?: Item[] }).items ?? null) : null)
  }
  useEffect(() => {
    void go("status")
  }, [sessionId])
  return (
    <section aria-label="Definition of done" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Definition of done</h2>
        <span className="flex gap-2">
          <button type="button" className="btn !min-h-7" disabled={busy} onClick={() => void go("status")}>
            Check again
          </button>
          <button type="button" className="btn !min-h-7" onClick={onClose}>
            Close
          </button>
        </span>
      </div>
      {items === undefined ? <p className="m-0 text-mut">Checking…</p> : null}
      {items === null ? <p className="m-0 text-mut">This project has no definition of done. Add .codehouse/dod.yml: items that say what must have changed, exist, be contained or pass, and items for a person to tick.</p> : null}
      {items?.length ? (
        <ul className="m-0 grid list-none gap-1 p-0">
          {items.map((i) => (
            <li key={i.text} className="flex flex-wrap items-center gap-2">
              {i.status === "person" || i.why === "ticked by you" ? (
                <input type="checkbox" aria-label={`Tick ${i.text}`} checked={i.status === "met"} disabled={busy} onChange={(e) => void go(e.target.checked ? "tick" : "untick", i.text)} />
              ) : null}
              <strong>{i.status === "met" ? "Met" : i.status === "person" ? "To tick" : "Not met"}</strong> {i.text}
              {i.status === "unmet" ? <span className="text-mut">: {i.why}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="m-0 text-xs text-mut">Every claim that the work is done shows this status.</p>
    </section>
  )
}
