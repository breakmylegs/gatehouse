import { useEffect, useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

interface Data {
  areas: Array<{ language: string; area: string; accepts: number; undos: number; explains: number }>
  suggestions: Array<{ language: string; area: string; reason: string }>
}

/** E-073: topics to learn, from what you accepted, undid and asked to have explained; kept on this computer only. */
export function SkillsPanel({ onClose }: { onClose: () => void }) {
  const [d, setD] = useState<Data>()
  async function load() {
    const x = await send({ type: "skills" })
    if (x.ok) setD(x.data as Data)
    else toast.error(x.error?.message ?? "Not read", { id: "skills" })
  }
  useEffect(() => {
    void load()
  }, [])
  async function remove() {
    if (!confirm("Delete the record of what you accepted, undid and asked about?")) return
    const x = await send({ type: "skills_delete" })
    if (x.ok) await load()
    else toast.error(x.error?.message ?? "Not deleted", { id: "skills" })
  }
  return (
    <section aria-label="Topics to learn" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Topics to learn</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="m-0 text-mut">From the agent's edits you accepted, the changes you undid and the explanations you asked for. Counts only, on this computer only.</p>
      {d?.suggestions.length ? (
        <ul className="m-0 grid gap-0.5 pl-5">
          {d.suggestions.map((s) => (
            <li key={`${s.language}|${s.area}`}>{s.reason}</li>
          ))}
        </ul>
      ) : d ? (
        <p className="m-0">No topic stands out yet.</p>
      ) : null}
      {d?.areas.length ? (
        <details>
          <summary className="cursor-pointer">Every area ({d.areas.length})</summary>
          <ul className="m-0 grid list-none gap-0.5 p-0">
            {d.areas.map((a) => (
              <li key={`${a.language}|${a.area}`}>
                {a.language} in {a.area}: {a.accepts} accepted, {a.undos} undone, {a.explains} explained
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <button type="button" className="btn btn-deny !min-h-7 justify-self-start" onClick={() => void remove()}>
        Delete the record
      </button>
    </section>
  )
}
