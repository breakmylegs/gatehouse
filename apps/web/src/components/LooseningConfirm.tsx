import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"

/** D-024: the Host's answer to a change that loosens what it asks or refuses: what, the phrase, and the wait. */
export interface LooseningAsk {
  what: string
  phrase: string
  minutes: number
}

export const looseningIn = (detail: unknown): LooseningAsk | undefined =>
  (detail as { loosening?: LooseningAsk } | undefined)?.loosening

/** Asks for the phrase; once typed, the change is sent again and applies after the wait. */
export function LooseningConfirm({ ask, busy, onConfirm }: { ask: LooseningAsk; busy: boolean; onConfirm: (phrase: string) => void }) {
  const [typed, setTyped] = useState("")
  return (
    <section aria-label="Loosening" className="panel grid gap-2 p-3">
      <span>
        This loosens what Codehouse asks or refuses: <strong>{ask.what}</strong>. It applies {ask.minutes} minutes after you
        confirm, your phone is told, and you can cancel it until then.
      </span>
      <label className="grid gap-1">
        <span>
          To go ahead, type <strong className="mono">{ask.phrase}</strong>
        </span>
        <input className="field mono" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
      </label>
      <button type="button" className="btn justify-self-start" disabled={busy || typed !== ask.phrase} onClick={() => onConfirm(typed)}>
        Loosen in {ask.minutes} minutes
      </button>
    </section>
  )
}

interface Pending {
  id: string
  what: string
  appliesAt: string
}

/** What waits to loosen, with when it applies and a way to cancel it. Nothing shows when nothing waits. */
export function LooseningList({ refresh = 0 }: { refresh?: number }) {
  const [pending, setPending] = useState<Pending[]>([])
  const load = async () => {
    const r = await api<{ pending: Pending[] }>("GET", "/api/loosening")
    if (r.ok && r.data) setPending(r.data.pending)
  }
  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 30_000)
    return () => clearInterval(t)
  }, [refresh])
  async function cancel(id: string) {
    const r = await api<{ pending: Pending[] }>("POST", `/api/loosening/${encodeURIComponent(id)}/cancel`)
    if (!r.ok || !r.data) return toast.error(r.error ?? "It could not be cancelled", { id: "loosening" })
    setPending(r.data.pending)
    toast("Cancelled", { id: "loosening" })
  }
  if (!pending.length) return null
  return (
    <ul className="m-0 grid list-none gap-1 p-0 text-[13px]" aria-label="Waiting to loosen">
      {pending.map((p) => (
        <li key={p.id} className="panel flex flex-wrap items-center gap-2 p-2">
          <span>
            Loosens at {new Date(p.appliesAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}: {p.what}
          </span>
          <button type="button" className="btn !min-h-7" onClick={() => void cancel(p.id)}>
            Cancel
          </button>
        </li>
      ))}
    </ul>
  )
}
