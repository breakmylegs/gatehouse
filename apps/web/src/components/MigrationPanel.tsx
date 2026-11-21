import { useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

interface WaveFile {
  file: string
  callable: boolean
  captured?: string
  compared?: string
  deltas?: Array<{ words: string }>
}
interface Plan {
  id: string
  goal: string
  waves: Array<{ n: number; files: WaveFile[] }>
}
interface State {
  toCapture: string[]
  toCompare: string[]
  done: boolean
  changed: number
}
interface Reply {
  plan: Plan
  states: State[]
  failed?: Array<{ file: string; why: string }>
}

/**
 * D-067: a migration planned in waves from a folder's own imports, leaves first. For each wave: capture its files'
 * behaviour before it changes, ask Claude to do that wave only, then compare. A wave is done only with both.
 */
export function MigrationPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [goal, setGoal] = useState("")
  const [folder, setFolder] = useState("src")
  const [busy, setBusy] = useState<string>()
  const [r, setR] = useState<Reply>()

  async function plan() {
    setBusy("plan")
    const res = await send({ type: "migration_plan", sessionId, folder: folder.trim(), goal: goal.trim() })
    setBusy(undefined)
    if (!res.ok) return void toast.error(res.error?.message ?? "It could not be planned", { id: "migration" })
    setR(res.data as Reply)
  }
  async function step(wave: number, s: "capture" | "compare" | "ask") {
    if (!r) return
    setBusy(`${wave}:${s}`)
    const res = await send({ type: "migration_wave", sessionId, planId: r.plan.id, wave, step: s })
    setBusy(undefined)
    if (!res.ok) return void toast.error(res.error?.message ?? "That did not work", { id: "migration" })
    const next = res.data as Reply
    setR(next)
    if (next.failed?.length) toast.error(`${next.failed.length} file(s) could not be ${s === "capture" ? "captured" : "compared"}: ${next.failed[0]!.why}`, { id: "migration" })
    else if (s === "ask") toast(`Claude was asked to do wave ${wave}`, { id: "migration" })
  }

  return (
    <section aria-label="Migration plan" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Plan a migration</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      {!r ? (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void plan()
          }}
        >
          <label className="grid gap-1">
            <span>What the migration is</span>
            <input className="field" value={goal} maxLength={300} placeholder="Move from CommonJS to ES modules" onChange={(e) => setGoal(e.target.value)} />
          </label>
          <label className="grid gap-1">
            <span>Folder, from the project&apos;s folder</span>
            <input className="field mono w-64" value={folder} onChange={(e) => setFolder(e.target.value)} />
          </label>
          <button type="submit" className="btn w-fit" disabled={!goal.trim() || busy !== undefined}>
            {busy === "plan" ? "Planning…" : "Plan it in waves"}
          </button>
        </form>
      ) : (
        <>
          <p className="m-0 text-mut">
            {r.plan.goal}: {r.plan.waves.length} waves, leaves first. Capture a wave before it changes, ask Claude to do it, then compare.
          </p>
          <ol className="m-0 grid list-none gap-2 p-0" aria-label="Waves">
            {r.plan.waves.map((w, i) => {
              const st = r.states[i]!
              return (
                <li key={w.n} className="grid gap-1 border-t border-line pt-2">
                  <span className="font-semibold">
                    Wave {w.n}: {st.done ? (st.changed ? `done, ${st.changed} behaviour change(s)` : "done, no behaviour changed") : st.toCapture.length ? `${st.toCapture.length} file(s) to capture` : `${st.toCompare.length} file(s) to compare`}
                  </span>
                  <span className="mono text-[12.5px] [overflow-wrap:anywhere]">{w.files.map((f) => f.file).join(", ")}</span>
                  {w.files.flatMap((f) => (f.deltas ?? []).map((d, k) => <span key={`${f.file}:${k}`}>{d.words}</span>))}
                  <span className="flex flex-wrap gap-2">
                    <button type="button" className="btn !min-h-7" disabled={busy !== undefined} onClick={() => void step(w.n, "capture")}>
                      {busy === `${w.n}:capture` ? "Capturing…" : "Capture before"}
                    </button>
                    <button type="button" className="btn !min-h-7" disabled={busy !== undefined || st.toCapture.length > 0} onClick={() => void step(w.n, "ask")}>
                      Ask Claude to do this wave
                    </button>
                    <button type="button" className="btn !min-h-7" disabled={busy !== undefined || st.toCapture.length > 0} onClick={() => void step(w.n, "compare")}>
                      {busy === `${w.n}:compare` ? "Comparing…" : "Compare after"}
                    </button>
                  </span>
                </li>
              )
            })}
          </ol>
        </>
      )}
    </section>
  )
}
