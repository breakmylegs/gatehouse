import { useEffect, useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

type Level = "trace" | "debug" | "info" | "warn" | "error" | "fatal"
interface Entry {
  at: string
  level?: Level
  message: string
  fields?: Record<string, string>
  source: string
}
interface Sig {
  key: string
  type: string
  message: string
  count: number
  last: string
  frames: Array<{ fn?: string; file: string; line: number; source?: { file: string; line: number } }>
  task: string
}
interface Reply {
  entries: Entry[]
  read: string[]
  refused: string[]
}

const SINCE: Record<string, number | undefined> = { "Last hour": 3600_000, "Last day": 86_400_000, Everything: undefined }

/** E-038: the project's log lines, from Codehouse's own commands and its listed log files, redacted, searched. */
export function LogsPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [text, setText] = useState("")
  const [level, setLevel] = useState<Level | "">("")
  const [since, setSince] = useState("Last day")
  const [r, setR] = useState<Reply>()
  const [error, setError] = useState<string>()
  const [sigs, setSigs] = useState<Sig[]>()
  const errors = () => void send({ type: "log_errors", sessionId }).then((x) => (x.ok ? setSigs((x.data as { signatures: Sig[] }).signatures) : setError(x.error?.message ?? "The errors could not be read")))
  const fix = (s: Sig) => void send({ type: "prompt", sessionId, text: s.task }).then((x) => (x.ok ? toast("Asked Claude to fix it", { id: "logs" }) : toast.error(x.error?.message ?? "It was not sent", { id: "logs" })))
  const load = () => {
    const ms = SINCE[since]
    void send({ type: "logs_query", sessionId, ...(text.trim() ? { text: text.trim() } : {}), ...(level ? { level } : {}), ...(ms ? { since: new Date(Date.now() - ms).toISOString() } : {}) }).then((x) =>
      x.ok ? (setR(x.data as Reply), setError(undefined)) : setError(x.error?.message ?? "The logs could not be read"),
    )
  }
  useEffect(load, [sessionId, level, since])
  return (
    <section aria-label="Logs" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Logs</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          load()
        }}
      >
        <input className="field" aria-label="Search the logs" placeholder="Search" value={text} onChange={(e) => setText(e.target.value)} />
        <select className="field" aria-label="Lowest level" value={level} onChange={(e) => setLevel(e.target.value as Level | "")}>
          <option value="">Any level</option>
          {(["debug", "info", "warn", "error", "fatal"] as const).map((l) => (
            <option key={l} value={l}>
              {l} and above
            </option>
          ))}
        </select>
        <select className="field" aria-label="Time" value={since} onChange={(e) => setSince(e.target.value)}>
          {Object.keys(SINCE).map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <button type="submit" className="btn !min-h-7">
          Search
        </button>
        <button type="button" className="btn !min-h-7" onClick={errors}>
          Errors
        </button>
      </form>
      {sigs ? (
        <div className="grid gap-2">
          {/* E-039: errors grouped by signature, frames mapped to source, each with a fix task. */}
          {!sigs.length ? <p className="m-0 text-mut">No errors in the log lines kept.</p> : null}
          {sigs.map((s) => (
            <div key={s.key} className="grid gap-0.5">
              <span>
                <strong>{s.count}×</strong> <span className="mono break-words">{s.type}: {s.message}</span>
              </span>
              {s.frames.slice(0, 3).map((f, i) => (
                <span key={i} className="mono break-words text-[12px] text-mut">
                  {f.source ? `${f.source.file}:${f.source.line}` : `${f.file}:${f.line}`}
                  {f.fn ? ` (${f.fn})` : ""}
                </span>
              ))}
              <button type="button" className="btn !min-h-7 justify-self-start" onClick={() => fix(s)}>
                Ask Claude to fix
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {error ? <p className="m-0">{error}</p> : null}
      {r?.refused.length ? <p className="m-0 text-mut">Not read, because your rules do not allow reading them by themselves: {r.refused.join(", ")}.</p> : null}
      {!r ? (
        <p className="m-0 text-mut">Reading…</p>
      ) : !r.entries.length ? (
        <p className="m-0 text-mut">No lines. Codehouse keeps what its own commands print, and the files listed in .codehouse/logs.yml (files: [path, ...]).</p>
      ) : (
        <ul className="m-0 grid list-none gap-0.5 p-0">
          {r.entries.map((e, i) => (
            <li key={i} className="mono break-words text-[12px]">
              <span className="text-mut">{e.at.slice(11, 19)}</span> {e.level ? <strong>{e.level.toUpperCase()}</strong> : null} {e.message}
              {e.fields ? <span className="text-mut"> {Object.entries(e.fields).map(([k, v]) => `${k}=${v}`).join(" ")}</span> : null}
              <span className="text-mut"> ({e.source})</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
