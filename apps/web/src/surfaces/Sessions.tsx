import type { SessionInfo } from "@gatehouse/shared/ws-protocol"
import NumberFlow from "@number-flow/react"
import { useState } from "react"
import { toast } from "sonner"
import { money } from "../lib/format"
import { send, useSessionList, useStore } from "../store"

export const MODELS: Array<{ id: string; label: string }> = [
  { id: "", label: "Default model" },
  { id: "claude-opus-5-5", label: "Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5" },
  { id: "claude-fable-5-1", label: "Fable 5.1" },
]

const STATE: Record<SessionInfo["state"], { label: string; shape: string; rank: number }> = {
  waiting: { label: "Waiting on you", shape: "M5 1 9 9H1z", rank: 0 },
  error: { label: "Error", shape: "M1 1l8 8M9 1 1 9", rank: 1 },
  running: { label: "Running", shape: "M2 1l7 4-7 4z", rank: 2 },
  starting: { label: "Starting", shape: "M5 1v4l3 2", rank: 3 },
  idle: { label: "Idle", shape: "M3 1v8M7 1v8", rank: 4 },
  ended: { label: "Ended", shape: "M1 5h8", rank: 5 },
}

function StateMark({ state }: { state: SessionInfo["state"] }) {
  const s = STATE[state]
  const strong = state === "waiting" || state === "error"
  return (
    <span className={`inline-flex items-center gap-1.5 ${strong ? "font-semibold text-sev" : ""}`}>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path
          d={s.shape}
          fill={state === "waiting" || state === "running" ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {s.label}
    </span>
  )
}

export function Sessions() {
  const sessions = useSessionList()
  const usage = useStore((s) => s.usage)
  const setRoute = useStore((s) => s.setRoute)
  const selectSession = useStore((s) => s.selectSession)
  const [cwd, setCwd] = useState("")
  const [model, setModel] = useState("")
  const [mode, setMode] = useState<"default" | "plan">("default")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const sorted = [...sessions].sort(
    (a, b) => STATE[a.state].rank - STATE[b.state].rank || b.createdAt.localeCompare(a.createdAt),
  )

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    const r = await send({
      type: "create_session",
      cwd: cwd.trim(),
      ...(model ? { model } : {}),
      mode,
    })
    setBusy(false)
    if (!r.ok) {
      setError(r.error?.message ?? "The session did not start")
      return
    }
    const id = (r.data as { sessionId: string }).sessionId
    toast("Session started")
    selectSession(id)
    setRoute("workspace")
  }

  return (
    <div className="mx-auto grid max-w-[1100px] gap-6 p-6">
      <header className="flex items-baseline gap-4">
        <h1 className="m-0 text-[22px] font-semibold">Sessions</h1>
        <span className="text-mut">
          Spend so far: <strong>{money(usage?.total?.costUsd ?? 0)}</strong>
        </span>
      </header>

      <form onSubmit={create} className="panel grid gap-3 p-4" aria-label="Start a session">
        <h2 className="m-0 text-sm font-semibold">Start a session</h2>
        <div className="grid grid-cols-[1fr_180px_140px_auto] items-end gap-3 max-[900px]:grid-cols-1">
          <label className="grid gap-1">
            <span>Folder</span>
            <input
              className="field mono"
              required
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="C:\dev\my-project"
              spellCheck={false}
            />
          </label>
          <label className="grid gap-1">
            <span>Model</span>
            <select className="field" value={model} onChange={(e) => setModel(e.target.value)}>
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span>Mode</span>
            <select
              className="field"
              value={mode}
              onChange={(e) => setMode(e.target.value as "default" | "plan")}
            >
              <option value="default">Default</option>
              <option value="plan">Plan</option>
            </select>
          </label>
          <button className="btn btn-primary" disabled={busy || !cwd.trim()}>
            {busy ? "Starting…" : "Start"}
          </button>
        </div>
        <p className="m-0 text-xs text-mut">
          Sessions only ever run in Default or Plan mode. Anything risky waits for your decision.
        </p>
        {error ? (
          <p role="alert" className="m-0 font-semibold text-sev">
            {error}
          </p>
        ) : null}
      </form>

      {sorted.length === 0 ? (
        <p className="text-mut">No sessions yet. Start one above.</p>
      ) : (
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">Sessions, those waiting on you first</caption>
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-mut">
              <th className="py-1.5 pr-3 font-semibold">State</th>
              <th className="py-1.5 pr-3 font-semibold">Project</th>
              <th className="py-1.5 pr-3 font-semibold">Model</th>
              <th className="py-1.5 pr-3 font-semibold">Mode</th>
              <th className="py-1.5 pr-3 text-right font-semibold">Pending</th>
              <th className="py-1.5 font-semibold"> </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr key={s.id} className="border-b border-line">
                <td className="py-1.5 pr-3">
                  <StateMark state={s.state} />
                </td>
                <td className="py-1.5 pr-3">
                  <span className="block font-semibold">{s.project}</span>
                  <span className="mono block text-xs text-mut [overflow-wrap:anywhere]">
                    {s.cwd}
                  </span>
                  {s.error ? <span className="block text-xs text-sev">{s.error}</span> : null}
                </td>
                <td className="py-1.5 pr-3">{s.model ?? "Default"}</td>
                <td className="py-1.5 pr-3">{s.mode === "plan" ? "Plan" : "Default"}</td>
                <td className="py-1.5 pr-3 text-right">
                  <NumberFlow value={s.pendingApprovals} />
                </td>
                <td className="py-1.5 text-right">
                  <button
                    className="btn"
                    onClick={() => {
                      selectSession(s.id)
                      setRoute("workspace")
                    }}
                  >
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
