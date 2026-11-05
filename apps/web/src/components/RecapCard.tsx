import { useEffect, useState } from "react"
import { api } from "../lib/api"
import { dismissRecap, recapLines, recapOf, useAwaySince } from "../lib/recap"
import { useStore } from "../store"
import { Icon } from "./Icon"

/** How the session stands, in the words the recap is given. */
const STANDING: Record<string, string> = {
  running: "still working",
  waiting: "waiting on you",
  idle: "finished",
  ended: "stopped",
  error: "stopped with an error",
}

/**
 * While you were away (B14): after ten minutes or more away, each open session says what happened until you choose
 * Got it. Claude writes it in a few plain sentences, what was done, what is left and what waits on you (owner, 4 Nov),
 * with the short list of what happened underneath. When Claude does not write it (turned off in Settings, a model on
 * this computer, or it could not), the list is the recap, as before. A session where nothing happened says nothing.
 */
export function RecapCard({ sessionId }: { sessionId: string }) {
  const since = useAwaySince()
  const session = useStore((s) => s.sessions[sessionId])
  const items = useStore((s) => s.transcripts[sessionId]?.items)
  const resolved = useStore((s) => s.resolved)
  const pending = useStore((s) => s.pending)
  const [written, setWritten] = useState<{ key: string; asking: boolean; summary?: string }>()
  const waiting = Object.values(pending).filter((p) => p.request.sessionId === sessionId).length
  const lines =
    since !== undefined && session && items
      ? recapOf({
          since,
          cwd: session.cwd,
          items,
          decided: Object.values(resolved).filter((r) => r.sessionId === sessionId),
          waiting,
          state: session.state,
          ...(session.error ? { error: session.error } : {}),
        })
      : []
  const key = since !== undefined && lines.length ? `${sessionId}@${since}` : undefined
  useEffect(() => {
    if (!key || since === undefined || !items || !session) return
    const said = recapLines(items, since)
    if (!said.length) return
    let live = true
    setWritten({ key, asking: true })
    void api<{ summary?: string; skipped?: string }>("POST", "/api/recap", {
      session: sessionId,
      since,
      minutes: Math.round((Date.now() - since) / 60_000),
      state: STANDING[session.state] ?? session.state,
      waiting,
      lines: said.slice(-200),
    }).then((r) => {
      if (live)
        setWritten({
          key,
          asking: false,
          ...(r.ok && r.data?.summary ? { summary: r.data.summary } : {}),
        })
    })
    return () => {
      live = false
    }
    // Once for each time you come back.
  }, [key])
  if (since === undefined || !lines.length) return null
  const mine = written?.key === key ? written : undefined
  const mins = Math.round((Date.now() - since) / 60_000)
  return (
    <section aria-label="While you were away" className="recap-card panel">
      <span className="flex items-center gap-2 font-semibold">
        <Icon name="checkpoint" />
        While you were away (
        {mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`})
      </span>
      {mine?.summary ? <p className="m-0 text-[14px] leading-relaxed">{mine.summary}</p> : null}
      {mine?.asking ? (
        <p className="m-0 text-[13px] text-mut">Claude is writing a summary…</p>
      ) : null}
      <ul
        className={`m-0 grid gap-0.5 pl-5 ${mine?.summary ? "text-[12.5px] text-mut" : "text-[13.5px]"}`}
      >
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
