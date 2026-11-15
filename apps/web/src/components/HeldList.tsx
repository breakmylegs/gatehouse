import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { endedBadly, useHeld } from "../lib/held"
import { send, useStore } from "../store"

const EMPTY: never[] = []

/** Sends one held message as an ordinary prompt; it goes back on the list if it was not taken. */
async function sendHeld(sessionId: string, text: string): Promise<boolean> {
  const st = useStore.getState()
  const state = st.sessions[sessionId]?.state
  st.addUserText(sessionId, text, undefined, state === "running" || state === "waiting")
  const r = await send({ type: "prompt", sessionId, text })
  if (!r.ok) {
    useHeld.getState().hold(sessionId, text)
    toast.error(r.error?.message ?? "The held message was not sent, so it is still held.")
    return false
  }
  return true
}

/**
 * T-039: the messages held until this turn ends, above the prompt box: each can be edited (back into the prompt
 * box), removed, or sent now. When a turn ends the first goes by itself, unless you stopped it or it failed.
 */
export function HeldList({ sessionId, onEdit }: { sessionId: string; onEdit: (text: string) => void }) {
  const held = useHeld((s) => s.held[sessionId] ?? EMPTY)
  const paused = useHeld((s) => s.paused[sessionId] === true)
  const state = useStore((s) => s.sessions[sessionId]?.state)
  const was = useRef(state)
  useEffect(() => {
    const before = was.current
    was.current = state
    if (state !== "idle" || (before !== "running" && before !== "waiting")) return
    const h = useHeld.getState()
    if (!(h.held[sessionId] ?? []).length || h.paused[sessionId]) return
    const items = useStore.getState().transcripts[sessionId]?.items ?? []
    if (endedBadly(items)) {
      h.setPaused(sessionId, true)
      return
    }
    const first = h.takeFirst(sessionId)
    if (first) void sendHeld(sessionId, first.text)
  }, [state, sessionId])

  if (!held.length) return null
  const idle = state === "idle"
  return (
    <section aria-label="Held until this turn ends" className="panel grid gap-1 p-2 text-[13px]">
      <p className="m-0 flex flex-wrap items-center justify-between gap-2 text-mut">
        {paused
          ? "The turn was stopped or failed, so these wait for you."
          : `${held.length === 1 ? "1 message goes" : `${held.length} messages go`} one at a time as each turn ends.`}
        {paused ? (
          <button
            type="button"
            className="btn !min-h-7 !text-[13px]"
            onClick={() => {
              useHeld.getState().setPaused(sessionId, false)
              if (idle) {
                const first = useHeld.getState().takeFirst(sessionId)
                if (first) void sendHeld(sessionId, first.text)
              }
            }}
          >
            Resume
          </button>
        ) : null}
      </p>
      <ol className="m-0 grid list-none gap-1 p-0">
        {held.map((h) => (
          <li key={h.id} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">{h.text}</span>
            <button
              type="button"
              className="btn !min-h-7 !text-[12.5px]"
              onClick={() => {
                const t = useHeld.getState().take(sessionId, h.id)
                if (t) onEdit(t.text)
              }}
            >
              Edit
            </button>
            <button
              type="button"
              className="btn !min-h-7 !text-[12.5px]"
              onClick={() => useHeld.getState().remove(sessionId, h.id)}
            >
              Remove
            </button>
            <button
              type="button"
              className="btn !min-h-7 !text-[12.5px]"
              onClick={() => {
                const t = useHeld.getState().take(sessionId, h.id)
                if (t) void sendHeld(sessionId, t.text)
              }}
            >
              Send now
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
