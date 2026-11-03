import { dismissRecap, recapOf, useAwaySince } from "../lib/recap"
import { useStore } from "../store"
import { Icon } from "./Icon"

/**
 * While you were away (B14): after ten minutes or more away, each open session says what happened, in up to five
 * lines, until you choose Got it. A session where nothing happened says nothing.
 */
export function RecapCard({ sessionId }: { sessionId: string }) {
  const since = useAwaySince()
  const session = useStore((s) => s.sessions[sessionId])
  const items = useStore((s) => s.transcripts[sessionId]?.items)
  const resolved = useStore((s) => s.resolved)
  const pending = useStore((s) => s.pending)
  if (since === undefined || !session || !items) return null
  const lines = recapOf({
    since,
    cwd: session.cwd,
    items,
    decided: Object.values(resolved).filter((r) => r.sessionId === sessionId),
    waiting: Object.values(pending).filter((p) => p.request.sessionId === sessionId).length,
    state: session.state,
    ...(session.error ? { error: session.error } : {}),
  })
  if (!lines.length) return null
  const mins = Math.round((Date.now() - since) / 60_000)
  return (
    <section aria-label="While you were away" className="recap-card panel">
      <span className="flex items-center gap-2 font-semibold">
        <Icon name="checkpoint" />
        While you were away (
        {mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`})
      </span>
      <ul className="m-0 grid gap-0.5 pl-5 text-[13.5px]">
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      <div>
        <button type="button" className="btn !min-h-7" onClick={dismissRecap}>
          Got it
        </button>
      </div>
    </section>
  )
}
