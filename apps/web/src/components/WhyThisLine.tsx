import { useEffect, useState } from "react"
import { api } from "../lib/api"

/**
 * D-081: why the line at the cursor is like this: the commit that last changed it, that commit's Codehouse session
 * note, and the decisions (ADRs) that bear on it. Every sentence says what it rests on.
 */
interface Why {
  answer: Array<{ text: string; cites: string }>
}

export function WhyThisLine({ sessionId, rel, line }: { sessionId: string; rel: string; line: number }) {
  const [why, setWhy] = useState<Why & { line: number }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => {
    setWhy(undefined)
    setError(undefined)
  }, [sessionId, rel])
  const ask = async () => {
    setBusy(true)
    const r = await api<Why>("GET", `/api/files/why?session=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(rel)}&line=${line}`)
    setBusy(false)
    if (r.ok && r.data) {
      setWhy({ ...r.data, line })
      setError(undefined)
    } else setError(r.error ?? "It could not be found out.")
  }
  return (
    <section aria-label="Why this line is like this" className="grid gap-1 border-t border-line px-4 py-2 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn" disabled={busy} onClick={() => void ask()}>
          {busy ? "Looking..." : `Why is line ${line} like this?`}
        </button>
        {error ? <span role="alert">{error}</span> : null}
      </div>
      {why ? (
        <ul className="m-0 grid list-none gap-0.5 p-0" aria-label={`Why line ${why.line} is like this`}>
          {why.answer.map((a) => (
            <li key={a.text}>
              {a.text} <span className="mono text-mut">({a.cites})</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
