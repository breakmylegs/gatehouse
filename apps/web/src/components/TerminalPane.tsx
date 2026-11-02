import clsx from "clsx"
import { useEffect, useId, useRef, useState } from "react"
import { send, useStore } from "../store"

/**
 * Your own terminal in a session's folder: type a PowerShell command, see what it prints. One command runs at a
 * time; Up and Down bring back earlier ones. It is not Claude's: commands here do not pass the Approver, the same as
 * a PowerShell window you open yourself, and each is recorded in the audit log.
 */
export function TerminalPane({ sessionId, cwd }: { sessionId: string; cwd: string }) {
  const term = useStore((s) => s.term[sessionId])
  const termAppend = useStore((s) => s.termAppend)
  const termStarted = useStore((s) => s.termStarted)
  const termClear = useStore((s) => s.termClear)
  const [command, setCommand] = useState("")
  const [history, setHistory] = useState<string[]>([])
  const [back, setBack] = useState(-1)
  const [busy, setBusy] = useState(false)
  const out = useRef<HTMLPreElement>(null)
  const id = useId()
  const running = Boolean(term?.runId)
  const chunks = term?.chunks ?? []

  // Follow the output as it arrives.
  useEffect(() => {
    const el = out.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chunks.length])

  async function run(e: React.FormEvent) {
    e.preventDefault()
    const text = command.trim()
    if (!text || running || busy) return
    setBusy(true)
    termAppend(sessionId, { stream: "cmd", text: `PS ${cwd}> ${text}\n` })
    setHistory((h) => (h.at(-1) === text ? h : [...h, text].slice(-100)))
    setBack(-1)
    setCommand("")
    const r = await send({ type: "term_run", sessionId, command: text })
    setBusy(false)
    if (r.ok) termStarted(sessionId, (r.data as { runId: string }).runId)
    else
      termAppend(sessionId, { stream: "err", text: `${r.error?.message ?? "It did not run."}\n` })
  }

  function recall(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return
    if (!history.length) return
    e.preventDefault()
    const next =
      e.key === "ArrowUp"
        ? back < 0
          ? history.length - 1
          : Math.max(0, back - 1)
        : back < 0 || back >= history.length - 1
          ? -1
          : back + 1
    setBack(next)
    setCommand(next < 0 ? "" : (history[next] ?? ""))
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto_auto] gap-2">
      <pre ref={out} className="term-out" tabIndex={0} aria-label="Terminal output" aria-live="off">
        {chunks.length === 0 ? (
          <span className="text-mut">
            Commands run with PowerShell in {cwd}. Output appears here.
          </span>
        ) : (
          chunks.map((c, i) => (
            <span key={i} className={clsx(`term-${c.stream}`)}>
              {c.text}
            </span>
          ))
        )}
      </pre>
      <form onSubmit={run} className="flex items-center gap-2">
        <label htmlFor={id} className="mono shrink-0 text-xs text-mut">
          PS&gt;
        </label>
        <input
          id={id}
          className="field mono min-w-0 flex-1 !text-[13px]"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={recall}
          spellCheck={false}
          autoComplete="off"
          aria-label="Command"
        />
        {running ? (
          <button
            type="button"
            className="btn btn-deny !min-h-8"
            onClick={() => void send({ type: "term_stop", sessionId })}
          >
            Stop
          </button>
        ) : (
          <button className="btn !min-h-8" disabled={busy || !command.trim()}>
            Run
          </button>
        )}
        <button type="button" className="btn !min-h-8" onClick={() => termClear(sessionId)}>
          Clear
        </button>
      </form>
      <p className="m-0 text-[12.5px] text-mut">
        Your own commands, one at a time. They do not go through the Approver, like a PowerShell
        window you open yourself, and each is recorded in the audit log. A program that asks a
        question as it runs gets no answer: Stop ends it.
      </p>
    </div>
  )
}
