import { useEffect, useState } from "react"
import { send, useStore } from "../store"

interface Checkpoint {
  ref: string
  createdAt: string
}

/**
 * T-042 (t3code review, O31): the first checkpoint this session saved after a message was sent, which holds the files
 * as they were then (one is saved before Claude's first edit of a turn). None: nothing was changed after it.
 */
export function checkpointAfter(list: readonly Checkpoint[], at: number): Checkpoint | undefined {
  return [...list]
    .filter((c) => Date.parse(c.createdAt) >= at)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
}

type Plan =
  | { state: "off" }
  | { state: "loading" }
  | { state: "none" }
  | { state: "ready"; ref: string; files: string[] }
  | { state: "failed"; why: string }

/**
 * In Edit, for a coding session in its own worktree: also put the files back as they were when you sent the message.
 * It shows which files would change before you send; the Host checks again, records it, then puts them back.
 */
export function EditRevert({
  sessionId,
  at,
  onRef,
}: {
  sessionId: string
  at: number
  onRef: (ref: string | undefined) => void
}) {
  const s = useStore((st) => st.sessions[sessionId])
  const [plan, setPlan] = useState<Plan>({ state: "off" })
  useEffect(() => {
    onRef(plan.state === "ready" ? plan.ref : undefined)
  }, [plan, onRef])
  if (!s || s.kind === "chat" || !s.worktree) return null

  async function turnOn() {
    if (!s) return
    setPlan({ state: "loading" })
    const list = await send({ type: "checkpoint_list", cwd: s.cwd, sessionId })
    if (!list.ok) return setPlan({ state: "failed", why: list.error?.message ?? "The checkpoints could not be read." })
    const cp = checkpointAfter((list.data as Checkpoint[]) ?? [], at)
    if (!cp) return setPlan({ state: "none" })
    const p = await send({ type: "checkpoint_preview", cwd: s.cwd, ref: cp.ref })
    if (!p.ok) return setPlan({ state: "failed", why: p.error?.message ?? "What would change could not be read." })
    const files = ((p.data as { changes?: Array<{ path: string }> }).changes ?? []).map((c) => c.path)
    setPlan(files.length ? { state: "ready", ref: cp.ref, files } : { state: "none" })
  }

  return (
    <div className="grid justify-items-end gap-1 text-[12.5px]">
      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={plan.state !== "off"}
          onChange={(e) => (e.target.checked ? void turnOn() : setPlan({ state: "off" }))}
        />
        Also put the files back as they were when you sent this
      </label>
      {plan.state === "loading" ? <span className="text-mut">Looking at what changed since…</span> : null}
      {plan.state === "none" ? <span className="text-mut">No file changed after this message: nothing to put back.</span> : null}
      {plan.state === "failed" ? (
        <span role="alert" className="font-semibold text-sev">
          {plan.why}
        </span>
      ) : null}
      {plan.state === "ready" ? (
        <span className="text-right" aria-live="polite">
          Send puts back {plan.files.length === 1 ? "1 file" : `${plan.files.length} files`}:{" "}
          <span className="mono">{plan.files.slice(0, 6).join(", ")}</span>
          {plan.files.length > 6 ? ` and ${plan.files.length - 6} more` : ""}. A checkpoint of how they are now is saved
          first.
        </span>
      ) : null}
    </div>
  )
}
