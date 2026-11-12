import { useEffect, useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

/**
 * D-038: the session's decisions (questions you answered, plans you approved) drafted as architecture decision records
 * in MADR format. Edit a draft if you want, then Accept and write puts it in the project's docs/adr.
 */
interface Draft {
  seq: number
  kind: string
  title: string
  file: string
  text: string
}

export function Decisions({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [drafts, setDrafts] = useState<Draft[]>()
  const [error, setError] = useState<string>()
  const [edited, setEdited] = useState<Record<number, string>>({})
  const [written, setWritten] = useState<Record<number, string>>({})
  useEffect(() => {
    void send({ type: "adr_drafts", sessionId }).then((r) =>
      r.ok ? setDrafts((r.data as { drafts: Draft[] }).drafts) : setError(r.error?.message ?? "The decisions could not be read"),
    )
  }, [sessionId])
  return (
    <section aria-label="Decisions" className="panel grid gap-3 p-4 text-[13px]">
      <div className="flex items-center gap-2">
        <h2 className="m-0 text-[17px]">Decisions</h2>
        <span className="text-mut">Drafted as architecture decision records, for the project's docs/adr.</span>
        <button type="button" className="btn ml-auto !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      {error ? (
        <p role="alert" className="m-0 text-sev">
          {error}
        </p>
      ) : !drafts ? (
        <p className="m-0 text-mut">Reading the session…</p>
      ) : !drafts.length ? (
        <p className="m-0 text-mut">No decisions yet: a question you answer, or a plan you approve, appears here as a draft.</p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0">
          {drafts.map((d) => (
            <li key={`${d.seq}:${d.title}`} className="grid gap-1.5">
              <strong>
                {d.title} <span className="font-normal text-mut">(record {d.seq})</span>
              </strong>
              <span className="mono text-mut">{d.file}</span>
              <textarea
                className="field mono"
                rows={10}
                aria-label={`Draft of ${d.title}`}
                value={edited[d.seq] ?? d.text}
                onChange={(e) => setEdited((x) => ({ ...x, [d.seq]: e.target.value }))}
              />
              {written[d.seq] ? (
                <span className="text-ok">Written to {written[d.seq]}.</span>
              ) : (
                <button
                  type="button"
                  className="btn justify-self-start"
                  onClick={async () => {
                    const r = await send({ type: "adr_write", sessionId, file: d.file, text: edited[d.seq] ?? d.text })
                    if (!r.ok) return void toast.error(r.error?.message ?? "It could not be written")
                    setWritten((x) => ({ ...x, [d.seq]: (r.data as { file: string }).file }))
                  }}
                >
                  Accept and write
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
