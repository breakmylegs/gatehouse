import { useEffect, useRef, useState } from "react"
import { api } from "../lib/api"

/** O42: one summary on a session's timeline, as the Host keeps it (apps/host/src/session-timeline.ts). */
export interface SummaryNode {
  at: string
  from: string
  summary: string
  activity: { you: number; claude: number; tools: number }
}

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
const day = (iso: string) => new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" })

/**
 * O42 (owner, 16 Nov): "a timeline button on the bar at the top. It opens timeline that can be scrolled left and right.
 * When a user presses one of the nodes (that shows a date and time stamp) it shows the summary of what happened in the
 * 10 mins prior to that". The summaries Claude wrote every ten minutes, oldest on the left, scrolled to the newest.
 */
export function SummaryTimeline({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [nodes, setNodes] = useState<SummaryNode[]>()
  const [enabled, setEnabled] = useState(true)
  const [error, setError] = useState<string>()
  const [chosen, setChosen] = useState<number>()
  const strip = useRef<HTMLOListElement>(null)

  useEffect(() => {
    let live = true
    const load = async () => {
      const r = await api<{ nodes: SummaryNode[]; enabled: boolean }>("GET", `/api/sessions/${encodeURIComponent(sessionId)}/timeline`)
      if (!live) return
      if (!r.ok || !r.data) return setError(r.error ?? "The timeline could not be read.")
      setError(undefined)
      setEnabled(r.data.enabled)
      setNodes((was) => {
        // The newest is chosen when it first opens, and when a new one arrives while the newest was chosen.
        const next = r.data!.nodes
        setChosen((c) => (c === undefined || (was && c === was.length - 1) ? next.length - 1 : c))
        return next
      })
    }
    void load()
    const t = setInterval(() => void load(), 60_000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [sessionId])

  // Scrolled to the newest, at the right.
  useEffect(() => {
    const el = strip.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [nodes?.length])

  const node = chosen !== undefined && chosen >= 0 ? nodes?.[chosen] : undefined
  return (
    <section className="panel grid gap-2 p-3" aria-label="Timeline: what happened, every ten minutes">
      <div className="flex items-center gap-2">
        <strong>Timeline</strong>
        <span className="text-xs text-mut">What happened, summed up by Claude every ten minutes.</span>
        <button type="button" className="btn ml-auto !min-h-7 !px-2.5 !text-[13px]" onClick={onClose}>
          Close
        </button>
      </div>
      {error ? (
        <p role="alert" className="m-0 text-sev">
          {error}
        </p>
      ) : !nodes ? (
        <p className="m-0 text-mut">Loading.</p>
      ) : nodes.length === 0 ? (
        <p className="m-0 text-mut">
          {enabled
            ? "Nothing yet. The first summary comes ten minutes after this session starts doing something."
            : "Summaries are off. Turn them on in Settings, Sessions, Timeline."}
        </p>
      ) : (
        <>
          <ol ref={strip} className="summary-timeline m-0 flex list-none gap-1 overflow-x-auto p-0 pb-1" aria-label="Summaries, oldest first">
            {nodes.map((n, i) => (
              <li key={n.at} className="shrink-0">
                <button
                  type="button"
                  className="summary-node"
                  aria-pressed={i === chosen}
                  aria-label={`${day(n.at)} ${time(n.at)}: the ten minutes before`}
                  onClick={() => setChosen(i)}
                >
                  <span className="summary-dot" aria-hidden="true" />
                  <span className="text-[12px] text-mut">{day(n.at)}</span>
                  <span className="text-[13px] font-semibold">{time(n.at)}</span>
                </button>
              </li>
            ))}
          </ol>
          {node ? (
            <div className="grid gap-1" aria-live="polite">
              <span className="text-xs text-mut">
                {day(node.from)} {time(node.from)} to {time(node.at)}: {node.activity.you} from you, {node.activity.claude} from Claude,{" "}
                {node.activity.tools === 1 ? "1 tool call" : `${node.activity.tools} tool calls`}
              </span>
              <p className="m-0">{node.summary}</p>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
