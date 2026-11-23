import { useEffect, useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

interface Proc {
  pid: number
  name: string
  started?: string
  ports: number[]
}

/** E-029: what this session started and left running, with its ports; a process stops only after you confirm. */
export function ProcessesPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [procs, setProcs] = useState<Proc[]>()
  const [asking, setAsking] = useState<number>()
  const [waiting, setWaiting] = useState<Array<{ id: number; label: string; sessionId?: string; reason: string }>>([])
  const load = () => {
    void send({ type: "session_processes", sessionId }).then((r) => setProcs(r.ok ? (r.data as { processes: Proc[] }).processes : []))
    // E-049: Codehouse's own jobs waiting for memory or CPU, and why.
    void send({ type: "scheduler_status" }).then((r) => r.ok && setWaiting((r.data as { waiting: typeof waiting }).waiting))
  }
  useEffect(load, [sessionId])
  async function stop(pid: number) {
    const r = await send({ type: "stop_process", sessionId, pid, confirm: true })
    setAsking(undefined)
    if (!r.ok) return void toast.error(r.error?.message ?? "It was not stopped", { id: "procs" })
    toast(`Stopped ${pid}`, { id: "procs" })
    load()
  }
  const since = (iso?: string) => {
    if (!iso) return ""
    const m = Math.round((Date.now() - Date.parse(iso)) / 60_000)
    return m < 1 ? ", just started" : m < 60 ? `, running ${m} min` : `, running ${Math.round(m / 60)} h`
  }
  return (
    <section aria-label="Ports and processes" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Ports and processes</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      {waiting.length ? (
        <div className="grid gap-0.5">
          <strong>Waiting to start</strong>
          {waiting.map((w) => (
            <span key={w.id}>
              {w.label}
              {w.sessionId && w.sessionId !== sessionId ? " (another session)" : ""}: <span className="text-mut">{w.reason}</span>
            </span>
          ))}
        </div>
      ) : null}
      {!procs ? (
        <p className="m-0 text-mut">Reading…</p>
      ) : !procs.length ? (
        <p className="m-0 text-mut">Nothing this session started is running (on Windows, inside its job).</p>
      ) : (
        <ul className="m-0 grid list-none gap-1 p-0">
          {procs.map((p) => (
            <li key={p.pid} className="flex flex-wrap items-center gap-2">
              <span>
                <span className="mono">{p.name}</span> ({p.pid}){p.ports.length ? `, listening on ${p.ports.join(", ")}` : ""}
                {since(p.started)}
              </span>
              {asking === p.pid ? (
                <span role="group" aria-label={`Confirm stopping ${p.name}`} className="flex items-center gap-2">
                  <span className="text-mut">Stop it and what it started?</span>
                  <button type="button" className="btn btn-primary !min-h-7" onClick={() => void stop(p.pid)}>
                    Stop it
                  </button>
                  <button type="button" className="btn !min-h-7" onClick={() => setAsking(undefined)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button type="button" className="btn !min-h-7" onClick={() => setAsking(p.pid)}>
                  Stop…
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
