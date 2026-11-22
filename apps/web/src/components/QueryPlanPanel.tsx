import { useEffect, useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

interface Finding {
  file: string
  line: number
  sql: string
  plan: string[]
  scans: string[]
  suggest: string[]
  sort?: boolean
  error?: string
}
interface Reply {
  queries: number
  findings: Finding[]
  notRun?: string
}

/** E-014: the queries this change adds, explained in a throwaway database; full scans flagged with an index to add. */
export function QueryPlanPanel({ sessionId, onOpen, onClose }: { sessionId: string; onOpen: (file: string, line: number) => void; onClose: () => void }) {
  const [r, setR] = useState<Reply>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    void send({ type: "query_plan", sessionId }).then((x) => (x.ok ? setR(x.data as Reply) : setError(x.error?.message ?? "The queries could not be explained")))
  }, [sessionId])
  const copy = (text: string) => void navigator.clipboard.writeText(text).then(() => toast("Copied", { id: "plan" }))
  return (
    <section aria-label="Query plans" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Query plans</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      {error ? (
        <p className="m-0 text-mut">{error}</p>
      ) : !r ? (
        <p className="m-0 text-mut">Explaining the added queries…</p>
      ) : !r.queries ? (
        <p className="m-0 text-mut">This change adds no SQL query Codehouse can find in TypeScript, JavaScript, Python or C#.</p>
      ) : r.notRun ? (
        <p className="m-0">{r.notRun}</p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {r.findings.map((f) => (
            <li key={`${f.file}:${f.line}:${f.sql}`} className="grid gap-1">
              <button type="button" className="link justify-self-start text-left" onClick={() => onOpen(f.file, f.line)}>
                {f.file}:{f.line}
              </button>
              <code className="mono block whitespace-pre-wrap break-words text-mut">{f.sql}</code>
              {f.error ? (
                <span>Not explained: {f.error}</span>
              ) : f.scans.length ? (
                <span>
                  Reads every row of {f.scans.join(", ")}.
                  {f.suggest.map((s) => (
                    <span key={s} className="mt-1 flex flex-wrap items-center gap-2">
                      <code className="mono">{s}</code>
                      <button type="button" className="btn !min-h-7" onClick={() => copy(s)}>
                        Copy
                      </button>
                    </span>
                  ))}
                </span>
              ) : (
                <span>Uses an index{f.sort ? ", with a temporary sort for its ORDER BY" : ""}.</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
