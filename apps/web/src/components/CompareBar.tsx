import { toast } from "sonner"
import { money } from "../lib/format"
import { send, useStore } from "../store"
import { MODELS } from "../surfaces/Sessions"

/** A model's name as the pickers show it. */
const modelName = (id: string | undefined, local?: boolean) =>
  local
    ? (id ?? "A model on this computer")
    : (MODELS.find((m) => m.id === (id ?? ""))?.label ?? id ?? "Default model")

/**
 * B22: over each of the chats started side by side with the same message, which model it is, what it cost and how
 * long it took to answer, and Keep this one, which records your choice and closes the others.
 */
export function CompareBar({ sessionId }: { sessionId: string }) {
  const compare = useStore((s) => s.compare)
  const session = useStore((s) => s.sessions[sessionId])
  const cost = useStore((s) => s.usage?.bySession?.[sessionId]?.costUsd)
  const firstAt = useStore(
    (s) => s.transcripts[sessionId]?.items.find((i) => i.kind === "text")?.at,
  )
  if (!compare || !compare.ids.includes(sessionId) || !session) return null
  const seconds =
    firstAt !== undefined ? Math.max(0, Math.round((firstAt - compare.at) / 1000)) : undefined
  async function keep() {
    if (!compare) return
    const others = compare.ids.filter((id) => id !== sessionId)
    const r = await send({ type: "compare_chosen", kept: sessionId, others })
    if (!r.ok) {
      toast.error(r.error?.message ?? "Your choice could not be recorded, so nothing was closed")
      return
    }
    for (const id of others) void send({ type: "close_session", sessionId: id })
    useStore.setState({ compare: undefined, panes: [sessionId], selectedSession: sessionId })
    toast("Kept this answer; the others are closed.")
  }
  return (
    <div
      className="compare-bar"
      role="group"
      aria-label={`Comparing ${compare.ids.length} answers`}
    >
      <strong>{modelName(session.model, session.local)}</strong>
      <span className="text-mut">
        {seconds !== undefined ? `answered in ${seconds} s` : "answering"}
        {cost !== undefined ? `, ${money(cost)}` : ""}
      </span>
      <button
        type="button"
        className="btn btn-primary ml-auto !min-h-7"
        onClick={() => void keep()}
      >
        Keep this one
      </button>
    </div>
  )
}
