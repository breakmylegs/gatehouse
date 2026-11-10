import type { SessionInfo } from "@gatehouse/shared/ws-protocol"
import { useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

/**
 * D-008: a property-based test or a fuzz run found a counterexample. Pin it, and it becomes a regression test of its
 * own that checks exactly that case, locked so a session changes it only with you.
 */
export function CounterexampleCards({ session }: { session: SessionInfo }) {
  const [busy, setBusy] = useState<string>()
  const list = session.counterexamples ?? []
  if (!list.length) return null
  return (
    <div className="grid gap-1.5">
      {list.map((c) => (
        <div key={c.id} role="status" className="pane-stopped flex-wrap">
          <span className="min-w-0">
            <strong>Counterexample found</strong> by {c.framework}
            {c.test ? <> in {c.test}</> : null}: <code className="mono break-all">{c.example}</code>.{" "}
            {c.writesItself
              ? c.framework === "fuzz"
                ? "Pin locks the input the run saved, so it is tried every time."
                : "Pin writes a regression test of its own for exactly this case, and locks it."
              : "Pin asks Claude to write a regression test for exactly this case, and locks it once written."}
          </span>
          <button
            type="button"
            className="btn btn-primary !min-h-7"
            disabled={busy !== undefined}
            onClick={() => {
              setBusy(c.id)
              void send({ type: "pin_counterexample", sessionId: session.id, id: c.id }).then((r) => {
                setBusy(undefined)
                if (!r.ok) return void toast.error(r.error?.message ?? "It could not be pinned")
                const d = r.data as { file: string; by: string }
                toast(
                  d.by === "claude"
                    ? `Claude is writing ${d.file}; it is locked once written`
                    : `${d.file} is pinned and locked`,
                )
              })
            }}
          >
            {busy === c.id ? "Pinning" : "Pin as a regression test"}
          </button>
          <button
            type="button"
            className="btn !min-h-7"
            disabled={busy !== undefined}
            onClick={() => void send({ type: "dismiss_counterexample", sessionId: session.id, id: c.id })}
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  )
}
