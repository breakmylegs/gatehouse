import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { money } from "../lib/format"
import { send, useStore } from "../store"
import { MODELS } from "../surfaces/Sessions"

/** A model's name as the pickers show it. */
const modelName = (id: string | undefined, local?: boolean) =>
  local
    ? (id ?? "A model on this computer")
    : (MODELS.find((m) => m.id === (id ?? ""))?.label ?? id ?? "Default model")

/** G25: what a run changed so far, from its Changes. */
interface Size {
  files: number
  added: number
  removed: number
}

/**
 * G25: how a run in its own worktree is doing, to compare with the others: what it changed, its last test run, and the
 * calls the rules did not allow by themselves (asked you, or stopped).
 */
function useRunStats(sessionId: string, on: boolean) {
  const seq = useStore((s) => s.transcripts[sessionId]?.seq ?? 0)
  const testsFailing = useStore((s) => s.transcripts[sessionId]?.testsFailing)
  const hits = useStore((s) => {
    const items = s.transcripts[sessionId]?.items ?? []
    let n = 0
    for (const it of items) {
      if (it.kind !== "tool") continue
      const d = s.decisions[it.toolUseId]
      if (d && (d.outcome !== "allow" || d.decidedBy !== "rules")) n++
    }
    return n
  })
  const [size, setSize] = useState<Size>()
  useEffect(() => {
    if (!on) return
    let gone = false
    const t = setTimeout(() => {
      void send({ type: "changes", sessionId }).then((r) => {
        if (gone || !r.ok) return
        const files = (r.data as { files?: Array<{ added: number; removed: number }> }).files ?? []
        setSize({
          files: files.length,
          added: files.reduce((a, f) => a + f.added, 0),
          removed: files.reduce((a, f) => a + f.removed, 0),
        })
      })
    }, 1500)
    return () => {
      gone = true
      clearTimeout(t)
    }
  }, [on, sessionId, seq])
  return { size, testsFailing, hits }
}

/**
 * B22: over each of the chats started side by side with the same message, which model it is, what it cost and how
 * long it took to answer, and Keep this one, which records your choice and closes the others. G25: over each of the
 * runs of one prompt, each in its own worktree, what it changed, its tests, the calls that asked you or were stopped,
 * and its cost; keeping one closes the others and removes their worktrees (their branches stay), after you say yes.
 */
export function CompareBar({ sessionId }: { sessionId: string }) {
  const compare = useStore((s) => s.compare)
  const session = useStore((s) => s.sessions[sessionId])
  const sessions = useStore((s) => s.sessions)
  const cost = useStore((s) => s.usage?.bySession?.[sessionId]?.costUsd)
  const firstAt = useStore(
    (s) => s.transcripts[sessionId]?.items.find((i) => i.kind === "text")?.at,
  )
  const run = session?.kind !== "chat" && session?.worktree !== undefined
  const active = Boolean(compare?.ids.includes(sessionId) && session)
  const stats = useRunStats(sessionId, active && run)
  const [asking, setAsking] = useState(false)
  if (!compare || !active || !session) return null
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
    if (!run) {
      for (const id of others) void send({ type: "close_session", sessionId: id })
      useStore.setState({ compare: undefined, panes: [sessionId], selectedSession: sessionId })
      toast("Kept this answer; the others are closed.")
      return
    }
    // The other runs close first: a worktree a session is working in is not removed.
    const places = others.map((id) => sessions[id]?.cwd).filter((p): p is string => Boolean(p))
    await Promise.all(others.map((id) => send({ type: "close_session", sessionId: id })))
    let kept = 0
    for (const path of places) {
      const gone = await api("POST", "/api/worktrees/remove", { path, force: true })
      if (!gone.ok) kept++
    }
    useStore.setState({ compare: undefined, panes: [sessionId], selectedSession: sessionId })
    toast(
      kept
        ? `Kept this run. ${kept === 1 ? "One worktree" : `${kept} worktrees`} could not be removed; see Sessions, Worktrees.`
        : "Kept this run; the others are closed and their worktrees removed (their branches stay). Merge it back from Sessions, Worktrees.",
    )
  }
  const tests =
    stats.testsFailing === undefined
      ? "no tests run"
      : stats.testsFailing
        ? "tests failing"
        : "tests passing"
  return (
    <div
      className="compare-bar"
      role="group"
      aria-label={
        run ? `Comparing ${compare.ids.length} runs` : `Comparing ${compare.ids.length} answers`
      }
    >
      <strong>{run ? session.worktree!.branch : modelName(session.model, session.local)}</strong>
      <span className="text-mut">
        {run
          ? [
              stats.size
                ? `${stats.size.files === 1 ? "1 file" : `${stats.size.files} files`} +${stats.size.added} -${stats.size.removed}`
                : "nothing changed yet",
              tests,
              stats.hits === 1 ? "1 call asked or stopped" : `${stats.hits} calls asked or stopped`,
              ...(cost !== undefined ? [money(cost)] : []),
            ].join(", ")
          : `${seconds !== undefined ? `answered in ${seconds} s` : "answering"}${cost !== undefined ? `, ${money(cost)}` : ""}`}
      </span>
      {run && asking ? (
        <span className="ml-auto flex items-center gap-2">
          <span>
            The other runs close and their worktrees go, with any work not committed in them.
          </span>
          <button type="button" className="btn btn-primary !min-h-7" onClick={() => void keep()}>
            Keep this run
          </button>
          <button type="button" className="btn !min-h-7" onClick={() => setAsking(false)}>
            Cancel
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="btn btn-primary ml-auto !min-h-7"
          onClick={() => (run ? setAsking(true) : void keep())}
        >
          Keep this one
        </button>
      )}
    </div>
  )
}
