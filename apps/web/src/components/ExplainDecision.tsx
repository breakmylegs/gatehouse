import { useState } from "react"
import { api } from "../lib/api"

interface Explanation {
  trace: Array<{ stage: string; result: string; rules?: string[] }>
  fixed: boolean
  change?: string
}

/**
 * D-020: why a request was asked, stage by stage (floor, deny rules, remembered rules, Codehouse's own checks, ask and
 * allow rules), and the smallest change that would alter it. A floor decision says it cannot be changed. Read only:
 * the rules judge the request again, and nothing is recorded or decided.
 */
export function ExplainDecision({ id }: { id: string }) {
  const [open, setOpen] = useState(false)
  const [x, setX] = useState<Explanation | null>()
  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && x === undefined) {
      const r = await api<Explanation>("GET", `/api/pending/${encodeURIComponent(id)}/explain`)
      setX(r.ok && r.data ? r.data : null)
    }
  }
  return (
    <div className="grid gap-1">
      <button type="button" className="btn w-fit !min-h-7 !text-[12.5px]" aria-expanded={open} onClick={() => void toggle()}>
        {open ? "Hide how it was decided" : "How it was decided"}
      </button>
      {open ? (
        x === undefined ? (
          <span className="text-[12.5px] text-mut">Reading…</span>
        ) : x === null ? (
          <span className="text-[12.5px] text-mut">It could not be explained now.</span>
        ) : (
          <div className="grid gap-1 text-[12.5px]">
            <ol className="m-0 grid gap-0.5 pl-5" aria-label="How it was decided">
              {x.trace.map((t, i) => (
                <li key={i}>
                  <span className="text-mut">{t.stage}:</span> {t.result}
                </li>
              ))}
            </ol>
            <span className={x.fixed ? "font-semibold" : undefined}>
              {x.fixed ? "Cannot be changed: the floor decides this, and no rule, setting or approval overrides it." : `What would change it: ${x.change ?? ""}`}
            </span>
          </div>
        )
      ) : null}
    </div>
  )
}
