import { useEffect, useState } from "react"
import { send } from "../store"

interface Repro {
  file: string
  command: string
  bug: string
  stage: "failed-before" | "verified"
  at: string
}
type Outcome = { ok: boolean; message: string }

/** E-043: a reproduction test, confirmed failing before the fix and passing after it, then locked. */
export function ReproPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [bug, setBug] = useState("")
  const [file, setFile] = useState("")
  const [command, setCommand] = useState("")
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome>()
  const [repros, setRepros] = useState<Repro[]>([])
  const load = () => void send({ type: "repro", sessionId, step: "list" }).then((x) => x.ok && setRepros((x.data as { repros: Repro[] }).repros))
  useEffect(load, [sessionId])
  async function step(s: "ask" | "before" | "after") {
    setBusy(true)
    const x = await send({ type: "repro", sessionId, step: s, ...(bug.trim() ? { bug: bug.trim() } : {}), ...(file.trim() ? { file: file.trim() } : {}), ...(command.trim() ? { command: command.trim() } : {}) })
    setBusy(false)
    if (!x.ok) return setOutcome({ ok: false, message: x.error?.message ?? "It did not work" })
    setOutcome(s === "ask" ? { ok: true, message: "Asked Claude for the test. When it says the file and the command, put them below." } : (x.data as Outcome))
    load()
  }
  return (
    <section aria-label="Reproduce a bug" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Reproduce a bug</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      <label className="grid gap-1">
        <span className="text-xs text-mut">The bug</span>
        <textarea className="field min-h-16" value={bug} onChange={(e) => setBug(e.target.value)} />
      </label>
      <button type="button" className="btn !min-h-7 justify-self-start" disabled={busy || !bug.trim()} onClick={() => void step("ask")}>
        Ask Claude for a test that fails
      </button>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1">
          <span className="text-xs text-mut">Test file</span>
          <input className="field mono" value={file} onChange={(e) => setFile(e.target.value)} />
        </label>
        <label className="grid flex-1 gap-1">
          <span className="text-xs text-mut">Command that runs only that test</span>
          <input className="field mono" value={command} onChange={(e) => setCommand(e.target.value)} />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn !min-h-7" disabled={busy || !file.trim() || !command.trim()} onClick={() => void step("before")}>
          Confirm it fails before the fix
        </button>
        <button type="button" className="btn btn-primary !min-h-7" disabled={busy || !file.trim()} onClick={() => void step("after")}>
          Confirm it passes after the fix
        </button>
      </div>
      <p className="m-0 text-xs text-mut">
        A test that passes before the fix does not reproduce the bug, and is rejected. After the fix the same test must pass,
        unchanged; it is then locked so it cannot be weakened.
      </p>
      {outcome ? <p className={`m-0 ${outcome.ok ? "" : "font-bold"}`}>{outcome.message}</p> : null}
      {repros.length ? (
        <ul className="m-0 grid list-none gap-0.5 p-0">
          {repros.map((r) => (
            <li key={r.file}>
              <button type="button" className="link mono" onClick={() => (setFile(r.file), setCommand(r.command), setBug(r.bug))}>
                {r.file}
              </button>{" "}
              <span className="text-mut">{r.stage === "verified" ? "verified and locked" : "fails before the fix; waiting for the fix"}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
