import { useEffect, useRef, useState } from "react"
import { api } from "../lib/api"
import { updateCall } from "../lib/update"
import { useStore } from "../store"
import { releaseDate, ReleaseNotes, releaseStanding, useChangelog, type ReleaseEntry } from "./ChangelogPanel"

/** O42: one summary on a session's timeline, as the Host keeps it (apps/host/src/session-timeline.ts). */
export interface SummaryNode {
  at: string
  from: string
  summary: string
  activity: { you: number; claude: number; tools: number }
}

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
const day = (iso: string) => new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" })

/** A point on the strip: a summary, or (O46) a Codehouse release published while the session ran. */
type Point = { kind: "summary"; key: string; at: number; node: SummaryNode } | { kind: "release"; key: string; at: number; release: ReleaseEntry }

/**
 * The summaries and the releases on one strip, in time order. A release is shown when it was published between the
 * start of the first summary and now: the releases this install's own track published while the session ran.
 */
export function timelinePoints(nodes: SummaryNode[], releases: ReleaseEntry[], now = Date.now()): Point[] {
  const points: Point[] = nodes.map((n) => ({ kind: "summary", key: `s:${n.at}`, at: Date.parse(n.at), node: n }))
  const first = nodes.length ? Math.min(...nodes.map((n) => Date.parse(n.from))) : NaN
  for (const r of releases) {
    const at = Date.parse(r.date)
    if (Number.isFinite(at) && at >= first && at <= now) points.push({ kind: "release", key: `r:${r.version}`, at, release: r })
  }
  return points.sort((a, b) => a.at - b.at)
}

/**
 * O42 (owner, 16 Nov): "a timeline button on the bar at the top. It opens timeline that can be scrolled left and right.
 * When a user presses one of the nodes (that shows a date and time stamp) it shows the summary of what happened in the
 * 10 mins prior to that". The summaries Claude wrote every ten minutes, oldest on the left, scrolled to the newest.
 * O46 (owner, 20 Nov): the releases of Codehouse published meanwhile are points too, diamonds labelled "Release
 * 2.0.523", with the same notes as the changelog (O44), the version you run marked, and Update now for a newer one.
 */
export function SummaryTimeline({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [nodes, setNodes] = useState<SummaryNode[]>()
  const [enabled, setEnabled] = useState(true)
  const [error, setError] = useState<string>()
  const [chosen, setChosen] = useState<string>()
  const strip = useRef<HTMLOListElement>(null)
  const { view } = useChangelog()
  const update = useStore((s) => s.update)

  useEffect(() => {
    let live = true
    const load = async () => {
      const r = await api<{ nodes: SummaryNode[]; enabled: boolean }>("GET", `/api/sessions/${encodeURIComponent(sessionId)}/timeline`)
      if (!live) return
      if (!r.ok || !r.data) return setError(r.error ?? "The timeline could not be read.")
      setError(undefined)
      setEnabled(r.data.enabled)
      setNodes((was) => {
        // The newest summary is chosen when it first opens, and when a new one arrives while the newest was chosen.
        const next = r.data!.nodes
        const newest = (l: SummaryNode[] | undefined) => (l?.length ? `s:${l.at(-1)!.at}` : undefined)
        setChosen((c) => (c === undefined || c === newest(was) ? newest(next) : c))
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

  const points = nodes ? timelinePoints(nodes, view?.releases ?? []) : []
  // Scrolled to the newest, at the right.
  useEffect(() => {
    const el = strip.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [points.length])

  const at = points.findIndex((p) => p.key === chosen)
  const point = at >= 0 ? points[at] : undefined
  const move = (to: number) => {
    const p = points[Math.max(0, Math.min(points.length - 1, to))]
    if (!p) return
    setChosen(p.key)
    strip.current?.querySelector<HTMLButtonElement>(`[data-key="${CSS.escape(p.key)}"]`)?.focus()
  }
  const current = update?.current
  return (
    <section className="panel grid gap-2 p-3" aria-label="Timeline: what happened, every ten minutes">
      <div className="flex items-center gap-2">
        <strong>Timeline</strong>
        <span className="text-xs text-mut">What happened, summed up by Claude every ten minutes, and the releases of Codehouse meanwhile.</span>
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
          <ol
            ref={strip}
            className="summary-timeline m-0 flex list-none gap-1 overflow-x-auto p-0 pb-1"
            aria-label="Summaries and releases, oldest first"
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") {
                e.preventDefault()
                move(e.key === "Home" ? 0 : e.key === "End" ? points.length - 1 : at + (e.key === "ArrowLeft" ? -1 : 1))
              }
            }}
          >
            {points.map((p) => {
              const pressed = p.key === chosen
              const common = {
                type: "button" as const,
                className: "summary-node",
                "data-key": p.key,
                "aria-pressed": pressed,
                // One tab stop: the chosen point, or the newest when none is.
                tabIndex: pressed || (at < 0 && p === points.at(-1)) ? 0 : -1,
                onClick: () => setChosen(p.key),
              }
              if (p.kind === "summary")
                return (
                  <li key={p.key} className="shrink-0">
                    <button {...common} aria-label={`${day(p.node.at)} ${time(p.node.at)}: the ten minutes before`}>
                      <span className="summary-dot" aria-hidden="true" />
                      <span className="text-[12px] text-mut">{day(p.node.at)}</span>
                      <span className="text-[13px] font-semibold">{time(p.node.at)}</span>
                    </button>
                  </li>
                )
              const standing = releaseStanding(p.release.version, current)
              const mark = standing === "current" ? "This version" : standing === "newer" ? "Not installed" : undefined
              return (
                <li key={p.key} className="shrink-0">
                  <button
                    {...common}
                    data-kind="release"
                    aria-label={`Release ${p.release.version}, published ${releaseDate(p.release.date)}${mark ? `, ${mark.toLowerCase()}` : ""}`}
                  >
                    <span className="summary-dot" aria-hidden="true" data-kind="release" data-mark={standing} />
                    <span className="text-[12px] text-mut">{day(p.release.date)}</span>
                    <span className="text-[13px] font-semibold">Release {p.release.version}</span>
                    {mark ? <span className="text-[11px] font-semibold">{mark}</span> : null}
                  </button>
                </li>
              )
            })}
          </ol>
          {point?.kind === "summary" ? (
            <div className="grid gap-1" aria-live="polite">
              <span className="text-xs text-mut">
                {day(point.node.from)} {time(point.node.from)} to {time(point.node.at)}: {point.node.activity.you} from you,{" "}
                {point.node.activity.claude} from Claude,{" "}
                {point.node.activity.tools === 1 ? "1 tool call" : `${point.node.activity.tools} tool calls`}
              </span>
              <p className="m-0">{point.node.summary}</p>
            </div>
          ) : point?.kind === "release" ? (
            <ReleasePoint release={point.release} />
          ) : null}
        </>
      )}
    </section>
  )
}

/** What a release point shows: its notes as text, and for a newer one, Update now through the usual update. */
function ReleasePoint({ release }: { release: ReleaseEntry }) {
  const update = useStore((s) => s.update)
  const standing = releaseStanding(release.version, update?.current)
  // The update installs the newest release only, which carries this one's changes too.
  const newest = update?.latest?.version
  const offer = standing === "newer" && update?.canInstall && update.available && newest ? newest : undefined
  return (
    <section aria-label={`Release ${release.version}`} aria-live="polite" className="grid gap-1">
      <h3 className="m-0 text-[14px]">
        Release {release.version}, published {releaseDate(release.date)}
        {standing === "current" ? ", the version you run" : standing === "newer" ? ", not installed yet" : ""}
      </h3>
      <ReleaseNotes text={release.notes} />
      {offer ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-primary !min-h-7" onClick={() => void updateCall("POST", "/api/update/install", { version: offer })}>
            {offer === release.version ? "Update now" : `Update now, to ${offer}`}
          </button>
          {offer !== release.version ? <span className="text-xs text-mut">The newest release includes this one's changes.</span> : null}
        </div>
      ) : null}
    </section>
  )
}
