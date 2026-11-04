import { createContext, useContext, useEffect, useState } from "react"
import { api } from "../lib/api"
import { switchBranch } from "../lib/redo"

/** One of your messages on the branch a chat shows, with the other versions of it (CH-03). */
export interface BranchStep {
  id: string
  index: number
  siblings: string[]
}

interface Step extends BranchStep {
  role: "user" | "assistant" | "system"
}

/** Each of your messages in the pane, by its item id, with its versions. */
export const BranchSteps = createContext<{ sessionId?: string; steps: Map<string, BranchStep> }>({
  steps: new Map(),
})

/**
 * The versions of each of your messages in a chat: asked for again when the chat finishes a turn or opens. Your
 * messages on screen are matched to the stored branch in order, so the nth message you see is the nth you sent.
 */
export function useBranchSteps(
  sessionId: string,
  chat: boolean,
  state: string,
  userItemIds: string[],
): Map<string, BranchStep> {
  const [steps, setSteps] = useState<Step[]>([])
  const settled = state === "idle" || state === "ended"
  useEffect(() => {
    if (!chat || !settled) return
    let live = true
    void api<{ steps: Step[] }>(
      "GET",
      `/api/chat/branch?session=${encodeURIComponent(sessionId)}`,
    ).then((r) => {
      if (live && r.ok && r.data) setSteps(r.data.steps)
    })
    return () => {
      live = false
    }
  }, [sessionId, chat, settled])
  const mine = steps.filter((s) => s.role === "user")
  const out = new Map<string, BranchStep>()
  // Only when the screen and the store agree on how many messages you sent; otherwise no arrows rather than wrong ones.
  if (mine.length !== userItemIds.length) return out
  userItemIds.forEach((id, i) => out.set(id, mine[i]!))
  return out
}

/** "‹ 2 of 3 ›": the other versions of one of your messages, made by Retry and Edit. Nothing is overwritten. */
export function BranchNav({ itemId }: { itemId: string }) {
  const { sessionId, steps } = useContext(BranchSteps)
  const step = steps.get(itemId)
  const [busy, setBusy] = useState(false)
  if (!sessionId || !step || step.siblings.length < 2) return null
  const go = (to: number) => {
    const id = step.siblings[to]
    if (!id || busy) return
    setBusy(true)
    void switchBranch(sessionId, id).finally(() => setBusy(false))
  }
  const n = step.siblings.length
  return (
    <span className="branch-nav" role="group" aria-label={`Version ${step.index + 1} of ${n}`}>
      <button
        type="button"
        className="copy-btn"
        aria-label="Show the version before"
        disabled={busy || step.index === 0}
        onClick={() => go(step.index - 1)}
      >
        ‹
      </button>
      <span aria-hidden="true">
        {step.index + 1} of {n}
      </span>
      <button
        type="button"
        className="copy-btn"
        aria-label="Show the version after"
        disabled={busy || step.index === n - 1}
        onClick={() => go(step.index + 1)}
      >
        ›
      </button>
    </span>
  )
}
