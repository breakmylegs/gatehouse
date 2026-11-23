import { useEffect, useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

interface S {
  name: string
  email: string
  score: number
  files: string[]
  last: string
}

/** E-079: who should review this change, from the history of the files it touches, recent work counting most. */
export function ReviewersPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [r, setR] = useState<{ suggestions: S[]; files: number }>()
  useEffect(() => {
    void send({ type: "reviewers", sessionId }, 120_000).then((x) => (x.ok ? setR(x.data as NonNullable<typeof r>) : toast.error(x.error?.message ?? "Not read", { id: "reviewers" })))
  }, [sessionId])
  return (
    <section aria-label="Reviewer suggestions" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Who should review this</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      {!r ? (
        <p className="m-0 text-mut">Reading the history…</p>
      ) : !r.suggestions.length ? (
        <p className="m-0 text-mut">Nobody else has worked on the {r.files} file(s) this change touches.</p>
      ) : (
        <ol className="m-0 grid gap-1 pl-5">
          {r.suggestions.map((s) => (
            <li key={s.email}>
              <strong>{s.name}</strong> <span className="text-mut">({s.email})</span>: knows {s.files.slice(0, 3).join(", ")}
              {s.files.length > 3 ? ` and ${s.files.length - 3} more` : ""}; last worked on them {s.last}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
