import { useEffect, useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

interface Playbook {
  id: string
  name: string
  steps: string[]
  checklist: Array<{ text: string }>
}
interface Item {
  text: string
  status: "met" | "unmet" | "person"
  why: string
}

const MARK = { met: "Met", unmet: "Unmet", person: "For a person" }

/** E-053: the project's playbooks; start one, then verify its checklist against the change. */
export function PlaybooksPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [list, setList] = useState<Playbook[]>()
  const [results, setResults] = useState<{ id: string; items: Item[] }>()
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void send({ type: "playbooks", sessionId, step: "list" }).then((x) => setList(x.ok ? (x.data as { playbooks: Playbook[] }).playbooks : []))
  }, [sessionId])
  const start = (id: string) => void send({ type: "playbooks", sessionId, step: "start", id }).then((x) => (x.ok ? toast("Playbook given to Claude", { id: "playbooks" }) : toast.error(x.error?.message ?? "Not started", { id: "playbooks" })))
  async function verify(id: string) {
    setBusy(true)
    const x = await send({ type: "playbooks", sessionId, step: "verify", id })
    setBusy(false)
    if (x.ok) setResults({ id, items: (x.data as { items: Item[] }).items })
    else toast.error(x.error?.message ?? "Not verified", { id: "playbooks" })
  }
  return (
    <section aria-label="Playbooks" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Playbooks</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      {!list ? (
        <p className="m-0 text-mut">Reading…</p>
      ) : !list.length ? (
        <p className="m-0 text-mut">This project has no playbooks. Add YAML files to .codehouse/playbooks: a name, its steps, and a checklist whose items can say what must have changed, exist, be contained, or pass.</p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {list.map((p) => (
            <li key={p.id} className="grid gap-1">
              <strong>{p.name}</strong>
              <span className="text-mut">
                {p.steps.length} step(s), {p.checklist.length} checklist item(s)
              </span>
              <span className="flex flex-wrap gap-2">
                <button type="button" className="btn !min-h-7" onClick={() => start(p.id)}>
                  Start
                </button>
                <button type="button" className="btn btn-primary !min-h-7" disabled={busy} onClick={() => void verify(p.id)}>
                  Verify the checklist
                </button>
              </span>
              {results?.id === p.id ? (
                <ul className="m-0 grid list-none gap-0.5 p-0">
                  {results.items.map((i) => (
                    <li key={i.text}>
                      <strong>{MARK[i.status]}</strong> {i.text}
                      {i.status !== "met" ? <span className="text-mut">: {i.why}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
