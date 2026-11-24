import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"

interface Frame {
  name: string
  file?: string
  line: number
}
interface DebugState {
  adapter: string
  program: string
  state: "starting" | "running" | "stopped" | "ended"
  reason?: string
  frames?: Frame[]
  variables?: Array<{ name: string; value: string; type?: string }>
  breakpoints: Record<string, number[]>
  output: string
}

/** Breakpoints typed as "file:line" a line each, gathered by file. */
export function parseBreakpoints(text: string): Record<string, number[]> {
  const out: Record<string, number[]> = {}
  for (const raw of text.split(/\r?\n/)) {
    const m = /^(.+?):(\d+)\s*$/.exec(raw.trim())
    if (m) (out[m[1]!.trim()] ??= []).push(Number(m[2]))
  }
  return out
}

const STATE_WORDS: Record<DebugState["state"], string> = { starting: "Starting", running: "Running", stopped: "Stopped", ended: "Ended" }

/**
 * G37 (owner's connector items, 9 Nov): the debugger for this session, with the adapters named in Settings. Start a
 * program from the folder with breakpoints, then continue or step; a stop shows the stack and the top frame's
 * variables (redacted by the Host). Claude can use it too, through the Companion, and every action is in the audit log
 * with who took it. Nothing is evaluated in the program.
 */
export function DebugPanel({ sessionId, onClose, onOpen }: { sessionId: string; onClose: () => void; onOpen?: (file: string, line: number) => void }) {
  const [adapters, setAdapters] = useState<Array<{ name: string; kind: string }>>()
  const [state, setState] = useState<DebugState | null>(null)
  const [adapter, setAdapter] = useState("")
  const [program, setProgram] = useState("")
  const [args, setArgs] = useState("")
  const [bps, setBps] = useState("")
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const r = await api<{ adapters: Array<{ name: string; kind: string }>; state: DebugState | null }>("GET", `/api/debug?session=${encodeURIComponent(sessionId)}`)
    if (!r.ok || !r.data) return
    setAdapters(r.data.adapters)
    setState(r.data.state)
    setAdapter((a) => a || r.data!.adapters[0]?.name || "")
  }
  useEffect(() => {
    void load()
    // Claude may be debugging too: what it did shows here.
    const t = setInterval(() => void load(), 3000)
    return () => clearInterval(t)
  }, [sessionId])

  const act = async (action: string, body: Record<string, unknown> = {}) => {
    setBusy(true)
    const r = await api<{ state: DebugState | null }>("POST", `/api/debug/${action}`, { session: sessionId, ...body })
    setBusy(false)
    if (!r.ok || !r.data) return void toast.error(r.error ?? "The debugger could not do that.", { id: "debug" })
    setState(r.data.state)
  }

  const live = state && state.state !== "ended"
  return (
    <section aria-label="Debugger" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 text-[15px]">Debugger</h2>
        <button type="button" className="btn ml-auto !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      {!adapters ? (
        <p className="m-0 text-mut">Reading…</p>
      ) : !adapters.length ? (
        <p className="m-0 text-mut">No debug adapter is named. Add one in Settings, Connectors, Debug adapters (debugpy, js-debug or netcoredbg, installed on this computer).</p>
      ) : (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void act("start", { adapter, program, args: args.trim() ? args.trim().split(/\s+/) : [], breakpoints: parseBreakpoints(bps) })
          }}
        >
          <div className="flex flex-wrap gap-2">
            <label className="grid gap-1">
              Adapter
              <select className="field" value={adapter} onChange={(e) => setAdapter(e.target.value)}>
                {adapters.map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.name} ({a.kind})
                  </option>
                ))}
              </select>
            </label>
            <label className="grid flex-1 gap-1">
              Program, from the folder
              <input className="field mono" value={program} placeholder="app.py" onChange={(e) => setProgram(e.target.value)} required />
            </label>
            <label className="grid flex-1 gap-1">
              Arguments
              <input className="field mono" value={args} onChange={(e) => setArgs(e.target.value)} />
            </label>
          </div>
          <label className="grid gap-1">
            Breakpoints, file:line a line each
            <textarea className="field mono min-h-[3.5rem]" value={bps} placeholder="app.py:12" onChange={(e) => setBps(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn btn-primary !min-h-7" disabled={busy || !program.trim()}>
              {live ? "Start again" : "Start"}
            </button>
            {live ? (
              <>
                <button type="button" className="btn !min-h-7" disabled={busy || state.state !== "stopped"} onClick={() => void act("continue")}>
                  Continue
                </button>
                <button type="button" className="btn !min-h-7" disabled={busy || state.state !== "stopped"} onClick={() => void act("next")}>
                  Step over
                </button>
                <button type="button" className="btn !min-h-7" disabled={busy || state.state !== "stopped"} onClick={() => void act("stepIn")}>
                  Step into
                </button>
                <button type="button" className="btn !min-h-7" disabled={busy || state.state !== "stopped"} onClick={() => void act("stepOut")}>
                  Step out
                </button>
                <button type="button" className="btn !min-h-7" disabled={busy || state.state !== "running"} onClick={() => void act("pause")}>
                  Pause
                </button>
                <button type="button" className="btn !min-h-7" disabled={busy} onClick={() => void act("stop")}>
                  Stop
                </button>
              </>
            ) : null}
          </div>
        </form>
      )}
      {state ? (
        <section aria-label="Where the program is" aria-live="polite" className="grid gap-1">
          <p className="m-0">
            <strong>{STATE_WORDS[state.state]}</strong> {state.program} under {state.adapter}
            {state.reason ? `: ${state.reason}` : ""}
          </p>
          {state.frames?.length ? (
            <div>
              <h3 className="m-0 text-[13px]">Stack</h3>
              <ol className="m-0 grid list-none gap-0.5 p-0">
                {state.frames.map((f, i) => (
                  <li key={i}>
                    {f.file && onOpen ? (
                      <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-left text-inherit underline" onClick={() => onOpen(f.file!, f.line)}>
                        {f.name} <span className="mono text-mut">{f.file}:{f.line}</span>
                      </button>
                    ) : (
                      <span>
                        {f.name} <span className="mono text-mut">{f.file ? `${f.file}:${f.line}` : `outside the folder, line ${f.line}`}</span>
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          {state.variables?.length ? (
            <div>
              <h3 className="m-0 text-[13px]">Variables</h3>
              <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5">
                {state.variables.map((v) => (
                  <div key={v.name} className="contents">
                    <dt className="mono">{v.name}</dt>
                    <dd className="mono m-0 [overflow-wrap:anywhere]">
                      {v.value}
                      {v.type ? <span className="text-mut"> ({v.type})</span> : null}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
          {state.output.trim() ? <pre className="m-0 max-h-40 overflow-auto whitespace-pre-wrap text-[12.5px] text-mut">{state.output.slice(-3000)}</pre> : null}
        </section>
      ) : null}
    </section>
  )
}
