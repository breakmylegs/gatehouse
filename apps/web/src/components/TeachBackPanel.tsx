import { useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

interface Result {
  modules: number
  covered: string[]
  gaps: Array<{ module: string; files: string[]; lines: number }>
  lines: number
}

/** E-071: explain the change in a few lines; what the explanation leaves out of the change is listed. */
export function TeachBackPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [text, setText] = useState("")
  const [r, setR] = useState<Result>()
  async function check() {
    const x = await send({ type: "teach_back", sessionId, explanation: text.trim() })
    if (x.ok) setR(x.data as Result)
    else toast.error(x.error?.message ?? "Not checked", { id: "teach" })
  }
  return (
    <section aria-label="Teach-back check" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Explain the change</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      <label className="grid gap-1">
        <span className="text-xs text-mut">In a few lines, what this change does and where</span>
        <textarea className="field min-h-20" value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <button type="button" className="btn btn-primary !min-h-7 justify-self-start" disabled={text.trim().length < 10} onClick={() => void check()}>
        Check my explanation
      </button>
      {r ? (
        r.gaps.length ? (
          <div className="grid gap-1">
            <span className="font-semibold">
              Your explanation covers {r.covered.length} of the {r.modules} modules the change touches. It does not mention:
            </span>
            <ul className="m-0 grid gap-0.5 pl-5">
              {r.gaps.map((g) => (
                <li key={g.module}>
                  {g.module} ({g.lines} lines: {g.files.slice(0, 4).join(", ")}
                  {g.files.length > 4 ? `, and ${g.files.length - 4} more` : ""})
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="m-0">It mentions every module the change touches ({r.modules}).</p>
        )
      ) : null}
      {r && r.lines < 50 ? <p className="m-0 text-mut">The change is small ({r.lines} lines), so this says little.</p> : null}
    </section>
  )
}
