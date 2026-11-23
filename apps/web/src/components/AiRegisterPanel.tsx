import { useEffect, useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

interface Entry {
  project: string
  provider: string
  model: string
  purpose: string
  classification: string
  card: { checkedAt?: string } | null
  cardOf?: string
  firstUse: string
  lastUse: string
}

/** E-069: every model the project's sessions used, with its data-boundary card and first and last use. */
export function AiRegisterPanel({ sessionId, project, onClose }: { sessionId: string; project: string; onClose: () => void }) {
  const [all, setAll] = useState(false)
  const [r, setR] = useState<{ entries: Entry[]; markdown: string }>()
  useEffect(() => {
    void send({ type: "ai_register", sessionId, ...(all ? { all: true } : {}) }).then((x) => {
      if (x.ok) setR(x.data as NonNullable<typeof r>)
      else toast.error(x.error?.message ?? "No register", { id: "register" })
    })
  }, [sessionId, all])
  return (
    <section aria-label="AI system register" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">AI system register</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
        Every project, not just {project}
      </label>
      {r && !r.entries.length ? <p className="m-0 text-mut">No model has answered here yet.</p> : null}
      {r?.entries.length ? (
        <ul className="m-0 grid list-none gap-1 p-0">
          {r.entries.map((e) => (
            <li key={`${e.project}|${e.provider}|${e.model}|${e.purpose}`}>
              <strong>{e.model}</strong> <span className="text-mut">({e.provider}, {e.purpose}{all ? `, ${e.project}` : ""})</span>: {e.classification};{" "}
              {e.card ? `card ${e.cardOf && e.cardOf !== e.model ? `of ${e.cardOf}` : "of its own"}, checked ${e.card.checkedAt ?? "never"}` : <span className="font-semibold">no card</span>}
              <span className="text-mut">
                {" "}
                · first {e.firstUse.slice(0, 10)}, last {e.lastUse.slice(0, 10)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {r ? (
        <button type="button" className="btn !min-h-7 justify-self-start" onClick={() => void navigator.clipboard.writeText(r.markdown).then(() => toast("Copied", { id: "register" }))}>
          Copy as Markdown
        </button>
      ) : null}
    </section>
  )
}
