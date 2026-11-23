import { useEffect, useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

interface TraceRow {
  traceId: string
  root: string
  spans: number
  start: number
  ms: number
  error: boolean
}
interface SpanNode {
  spanId: string
  name: string
  service?: string
  start: number
  end: number
  status?: "ok" | "error"
  attributes: Record<string, string>
  children: SpanNode[]
}

function Tree({ nodes, origin, total, depth = 0 }: { nodes: SpanNode[]; origin: number; total: number; depth?: number }) {
  return (
    <>
      {nodes.map((n) => (
        <div key={n.spanId} className="grid gap-0.5">
          <div className="flex items-center gap-2 text-[12px]" style={{ paddingLeft: depth * 14 }}>
            <span className={`mono ${n.status === "error" ? "font-bold" : ""}`}>
              {n.name}
              {n.status === "error" ? " (error)" : ""}
            </span>
            <span className="text-mut">{n.end - n.start} ms</span>
            {/* Where the span sits in its trace, as a bar. */}
            <span aria-hidden="true" className="relative h-1.5 min-w-24 flex-1 rounded bg-[color:var(--line)]">
              <span className="absolute h-1.5 rounded bg-[color:var(--accent)]" style={{ left: `${((n.start - origin) / Math.max(1, total)) * 100}%`, width: `${Math.max(1, ((n.end - n.start) / Math.max(1, total)) * 100)}%` }} />
            </span>
          </div>
          {n.children.length ? <Tree nodes={n.children} origin={origin} total={total} depth={depth + 1} /> : null}
        </div>
      ))}
    </>
  )
}

/** E-040: traces the project's app sent to the receiver on this computer, each as a span tree. */
export function TracesPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [list, setList] = useState<{ on: boolean; port: number; traces: TraceRow[] }>()
  const [open, setOpen] = useState<{ row: TraceRow; tree: SpanNode[] }>()
  const [env, setEnv] = useState<string[]>()
  const [error, setError] = useState<string>()
  const load = () => void send({ type: "traces_list", sessionId }).then((x) => (x.ok ? setList(x.data as NonNullable<typeof list>) : setError(x.error?.message ?? "The traces could not be read")))
  useEffect(load, [sessionId])
  const show = (row: TraceRow) => void send({ type: "trace_tree", sessionId, traceId: row.traceId }).then((x) => x.ok && setOpen({ row, tree: (x.data as { tree: SpanNode[] }).tree }))
  const token = () => void send({ type: "trace_token", sessionId }).then((x) => (x.ok ? setEnv((x.data as { env: string[] }).env) : toast.error(x.error?.message ?? "No token was made", { id: "traces" })))
  return (
    <section aria-label="Traces" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Traces</h2>
        <span className="flex gap-2">
          <button type="button" className="btn !min-h-7" onClick={load}>
            Refresh
          </button>
          <button type="button" className="btn !min-h-7" onClick={onClose}>
            Close
          </button>
        </span>
      </div>
      {error ? <p className="m-0">{error}</p> : null}
      {list && !list.on ? <p className="m-0 text-mut">The trace receiver is off. Switch it on in Settings, Connectors, Traces, then start Codehouse again.</p> : null}
      {list?.on ? (
        <div className="grid gap-1">
          <p className="m-0 text-mut">
            Receiving OTLP JSON on 127.0.0.1:{list.port}, only with this project&apos;s token, never from a web page, up to 4 MB a request. Attributes are redacted before they are kept.
          </p>
          <button type="button" className="btn !min-h-7 justify-self-start" onClick={token}>
            Make a new token for this project
          </button>
          {env ? (
            <div className="grid gap-1">
              <span className="text-mut">Set these for the app (shown once; making another stops this one):</span>
              <pre className="mono m-0 whitespace-pre-wrap break-all">{env.join("\n")}</pre>
              <button type="button" className="btn !min-h-7 justify-self-start" onClick={() => void navigator.clipboard.writeText(env.join("\n")).then(() => toast("Copied", { id: "traces" }))}>
                Copy
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {list?.traces.length ? (
        <ul className="m-0 grid list-none gap-0.5 p-0">
          {list.traces.map((t) => (
            <li key={t.traceId}>
              <button type="button" className="link text-left" onClick={() => show(t)}>
                {t.root || t.traceId}
              </button>{" "}
              <span className="text-mut">
                {t.spans} span(s), {t.ms} ms{t.error ? ", with an error" : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : list?.on ? (
        <p className="m-0 text-mut">No traces yet for this project.</p>
      ) : null}
      {open ? (
        <div className="grid gap-1">
          <strong>{open.row.root}</strong>
          <Tree nodes={open.tree} origin={open.row.start} total={open.row.ms} />
        </div>
      ) : null}
    </section>
  )
}
