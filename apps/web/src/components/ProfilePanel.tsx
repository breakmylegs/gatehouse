import { useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

interface FnTime {
  fn: string
  where: string
  selfMs: number
  totalMs: number
}
interface FlameNode {
  name: string
  value: number
  children: FlameNode[]
}
interface Reply {
  top: FnTime[]
  flame: FlameNode
  ms: number
  summary: string
}

/** A flame graph: each row a level of calls, each box as wide as its share of the time. */
function Flame({ node, total, depth = 0 }: { node: FlameNode; total: number; depth?: number }) {
  if (depth > 24 || node.value <= 0) return null
  return (
    <div className="grid" style={{ width: `${(node.value / Math.max(1, total)) * 100}%`, minWidth: 0 }}>
      <div title={`${node.name}: ${node.value} ms`} className="mono truncate border border-[color:var(--bg)] bg-[color:var(--accent)] px-1 text-[11px] text-[color:var(--bg)]">
        {node.name}
      </div>
      <div className="flex">
        {node.children.map((c, i) => (
          <Flame key={i} node={c} total={node.value} depth={depth + 1} />
        ))}
      </div>
    </div>
  )
}

/** E-041: a command run once with Node's CPU profiler (never an inspector port), its top functions and flame graph. */
export function ProfilePanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [command, setCommand] = useState("node index.js")
  const [busy, setBusy] = useState(false)
  const [r, setR] = useState<Reply>()
  const [error, setError] = useState<string>()
  const [leaks, setLeaks] = useState<{ snapshots: number; growth: Array<{ name: string; counts: number[]; bytes: number[] }>; summary: string }>()
  async function lookForLeaks() {
    setBusy(true)
    setError(undefined)
    const x = await send({ type: "leak_check", sessionId, command: command.trim() })
    setBusy(false)
    if (x.ok) setLeaks(x.data as NonNullable<typeof leaks>)
    else setError(x.error?.message ?? "It was not checked")
  }
  async function go() {
    setBusy(true)
    setError(undefined)
    const x = await send({ type: "profile_run", sessionId, command: command.trim() })
    setBusy(false)
    if (x.ok) setR(x.data as Reply)
    else setError(x.error?.message ?? "It was not profiled")
  }
  const tell = (text: string) => void send({ type: "prompt", sessionId, text }).then((x) => (x.ok ? toast("Sent to Claude", { id: "profile" }) : toast.error(x.error?.message ?? "It was not sent", { id: "profile" })))
  return (
    <section aria-label="Profile" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Profile</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid flex-1 gap-1">
          <span className="text-xs text-mut">A Node command of this project, run once</span>
          <input className="field mono" value={command} onChange={(e) => setCommand(e.target.value)} />
        </label>
        <button type="button" className="btn btn-primary !min-h-7" disabled={busy || !command.trim()} onClick={() => void go()}>
          {busy ? "Working…" : "Profile"}
        </button>
        <button type="button" className="btn !min-h-7" disabled={busy || !command.trim()} onClick={() => void lookForLeaks()}>
          Look for leaks
        </button>
      </div>
      <p className="m-0 text-xs text-mut">
        It runs as a Codehouse action, judged by your rules first, with Node&apos;s CPU profiler writing a file. No inspector
        port is opened, and any --inspect in NODE_OPTIONS is taken out.
      </p>
      {error ? <p className="m-0">{error}</p> : null}
      {leaks ? (
        <div className="grid gap-1">
          {/* E-042: heap snapshots while it worked; what kept growing. */}
          <p className="m-0 text-mut">
            {leaks.snapshots} heap snapshots. {leaks.growth.length ? "These kept growing:" : "Nothing kept growing."}
          </p>
          {leaks.growth.slice(0, 8).map((g) => (
            <span key={g.name} className="mono">
              {g.name}: {g.counts.join(" → ")} objects
            </span>
          ))}
          {leaks.growth.length ? (
            <button type="button" className="btn !min-h-7 justify-self-start" onClick={() => tell(leaks.summary)}>
              Tell Claude
            </button>
          ) : null}
        </div>
      ) : null}
      {r ? (
        <>
          <p className="m-0 text-mut">{r.ms} ms. The functions that took the most time themselves:</p>
          <ol className="m-0 grid gap-0.5 pl-5">
            {r.top.slice(0, 10).map((f) => (
              <li key={`${f.fn} ${f.where}`} className="break-words">
                <span className="mono">{f.fn}</span> <span className="text-mut">({f.where || "native"})</span>: {f.selfMs} ms, {f.totalMs} ms with what it called
              </li>
            ))}
          </ol>
          <div className="overflow-x-auto" aria-label="Flame graph">
            <Flame node={r.flame} total={r.flame.value} />
          </div>
          <button type="button" className="btn !min-h-7 justify-self-start" onClick={() => tell(r.summary)}>
            Tell Claude
          </button>
        </>
      ) : null}
    </section>
  )
}
