import { useEffect, useState } from "react"
import { api } from "../lib/api"

interface Finding {
  file?: string
  line?: number
  severity: "high" | "medium" | "low"
  text: string
}
interface Review {
  at: string
  findings: Finding[]
  truncated: boolean
  model: string
}

const SEVERITY: Record<Finding["severity"], string> = { high: "High", medium: "Medium", low: "Low" }

/**
 * C-043: a second model's review of this session's change, through the runtime or gateway on this computer. It reads
 * the diff (secrets left out, the rest redacted) and has no tools: it can only point things out, never change them.
 */
export function ReviewPanel({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<{ review: Review | null; available: boolean }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => {
    void api<{ review: Review | null; available: boolean }>("GET", `/api/review?session=${encodeURIComponent(sessionId)}`).then((r) => {
      if (r.ok && r.data && typeof r.data.available === "boolean") setState(r.data)
      else setState({ review: null, available: false })
    })
  }, [sessionId])
  async function ask() {
    setBusy(true)
    setError(undefined)
    const r = await api<{ review: Review }>("POST", "/api/review", { session: sessionId })
    setBusy(false)
    if (!r.ok || !r.data) return setError(r.error ?? "The reviewer did not answer.")
    setState({ review: r.data.review, available: true })
  }
  if (!state) return <p className="m-0 text-[13px] text-mut">Reading...</p>
  if (!state.available)
    return <p className="m-0 text-[13px] text-mut">No reviewer is set. Choose a model on your runtime or gateway in Settings, Models.</p>
  const r = state.review
  return (
    <div className="grid gap-2 text-[13px]">
      <span className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn !min-h-7" disabled={busy} onClick={() => void ask()}>
          {busy ? "Reviewing..." : r ? "Review the change again" : "Ask another model to review the change"}
        </button>
        {r ? (
          <span className="text-mut">
            {r.model}, {new Date(r.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
            {r.truncated ? ", the change was too long to send in full" : ""}
          </span>
        ) : null}
      </span>
      {error ? <p role="alert" className="m-0">{error}</p> : null}
      {r ? (
        r.findings.length ? (
          <ul className="m-0 grid list-none gap-1.5 p-0" aria-label="What the reviewer found">
            {r.findings.map((f, i) => (
              <li key={i} className="grid gap-0.5 rounded-md border border-line p-2">
                <span className="text-xs text-mut">
                  {SEVERITY[f.severity]}
                  {f.file ? ` · ${f.file}${f.line ? `:${f.line}` : ""}` : ""}
                </span>
                <span className="whitespace-pre-wrap">{f.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-mut">The reviewer found nothing wrong.</p>
        )
      ) : null}
      <p className="m-0 text-xs text-mut">
        It sees only the change since the last commit, with secret files left out and the rest redacted, and it has no
        tools: it can point things out, never change them.
      </p>
    </div>
  )
}
