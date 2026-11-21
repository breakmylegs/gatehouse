import { useState } from "react"
import { api } from "../lib/api"
import { Explanation, type ExplanationData } from "./Explanation"

/**
 * D-020: why a request was asked, stage by stage (floor, deny rules, remembered rules, Codehouse's own checks, ask and
 * allow rules), and the smallest change that would alter it, at the depth chosen for approvals (D-088). Read only: the
 * rules judge the request again, and nothing is recorded or decided.
 */
export function ExplainDecision({ id }: { id: string }) {
  const [open, setOpen] = useState(false)
  const [x, setX] = useState<ExplanationData | null>()
  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && x === undefined) {
      const r = await api<ExplanationData>("GET", `/api/pending/${encodeURIComponent(id)}/explain`)
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
          <Explanation area="approvals" x={x} />
        )
      ) : null}
    </div>
  )
}
