import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { send } from "../store"
import { makeDrills } from "../lib/drills"
import { Drills } from "./Drills"

interface Step {
  title: string
  symbol: string
  file: string
  note?: string
  state: "ok" | "moved" | "gone"
  at?: { file: string; line: number }
}
interface Tour {
  name: string
  title: string
  steps: Step[]
}

/**
 * D-079: the project's codebase tours, each step linked to its symbol through the code index; a step broken by a later
 * change is flagged. A step opens its file at the symbol's line.
 */
export function ToursPanel({ sessionId, onOpen, onClose }: { sessionId: string; onOpen: (file: string, line: number) => void; onClose: () => void }) {
  const [tours, setTours] = useState<Tour[]>()
  const [error, setError] = useState<string>()
  const [topic, setTopic] = useState("")
  const [drilling, setDrilling] = useState(false)
  useEffect(() => {
    void api<{ tours: Tour[] }>("GET", `/api/tours?session=${encodeURIComponent(sessionId)}`).then((r) =>
      r.ok && r.data ? setTours(r.data.tours) : setError(r.error ?? "The tours could not be read"),
    )
  }, [sessionId])
  async function ask() {
    const r = await send({ type: "tour_ask", sessionId, topic: topic.trim() })
    if (!r.ok) return void toast.error(r.error?.message ?? "Not asked", { id: "tours" })
    setTopic("")
    toast("Claude was asked to write the tour", { id: "tours" })
  }
  return (
    <section aria-label="Codebase tours" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Codebase tours</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      {error ? (
        <p role="alert" className="m-0 text-sev">
          {error}
        </p>
      ) : !tours ? (
        <p className="m-0 text-mut">Reading…</p>
      ) : !tours.length ? (
        <p className="m-0 text-mut">This project has no tours yet (.codehouse/tours).</p>
      ) : (
        tours.map((t) => (
          <div key={t.name} className="grid gap-1 border-t border-line pt-1.5">
            <span className="font-semibold">{t.title}</span>
            <ol className="m-0 grid gap-1 pl-5">
              {t.steps.map((s, i) => (
                <li key={i}>
                  {s.at ? (
                    <button type="button" className="link" onClick={() => onOpen(s.at!.file, s.at!.line)}>
                      {s.title}
                    </button>
                  ) : (
                    <span>{s.title}</span>
                  )}{" "}
                  <span className="mono text-mut">{s.symbol}</span>
                  {s.state === "moved" ? <span className="text-warn">, moved to {s.at!.file}</span> : null}
                  {s.state === "gone" ? <span className="font-semibold text-sev">, no longer in the code</span> : null}
                  {s.note ? <span className="block text-mut">{s.note}</span> : null}
                </li>
              ))}
            </ol>
          </div>
        ))
      )}
      {tours?.length ? (
        <div className="grid gap-1 border-t border-line pt-2">
          <button type="button" className="btn !min-h-7 justify-self-start" onClick={() => setDrilling(!drilling)}>
            {drilling ? "Hide the drills" : "Practise: code reading drills"}
          </button>
          {drilling ? <Drills drills={makeDrills(tours)} onOpen={onOpen} /> : null}
        </div>
      ) : null}
      <form
        className="flex flex-wrap items-end gap-2 border-t border-line pt-2"
        onSubmit={(e) => {
          e.preventDefault()
          void ask()
        }}
      >
        <label className="grid gap-1">
          <span>Ask Claude for a tour of</span>
          <input className="field w-64" value={topic} maxLength={200} placeholder="the checkout flow" onChange={(e) => setTopic(e.target.value)} />
        </label>
        <button type="submit" className="btn" disabled={!topic.trim()}>
          Ask
        </button>
      </form>
    </section>
  )
}
