import type { PendingView } from "@gatehouse/shared/ws-protocol"
import { useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

/** The tools a session can be allowed for good from a card, as the Host allows them. */
const GRANTABLE = new Set(["WebFetch", "WebSearch"])
/** What even a grant does not allow: a fetch after a prompt-injection flag, a command copied from a page. */
const NOT_GRANTED = new Set(["tainted-egress", "untrusted-content"])

/**
 * Owner, 13 Nov ("I should be able to just approve all web fetches ... rather than having to approve one at a time"):
 * one click allows every call of this tool for the rest of the session, and the ones of it waiting now. On the desktop
 * only; it ends with the session.
 */
export function GrantAll({ view, className }: { view: PendingView; className?: string }) {
  const [busy, setBusy] = useState(false)
  const req = view.request
  if (req.kind !== "permission" || !GRANTABLE.has(req.toolName) || NOT_GRANTED.has(req.verdict.ruleId)) return null
  return (
    <button
      type="button"
      className={className ?? "btn"}
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        const r = await send({ type: "grant_tool", sessionId: req.sessionId, tool: req.toolName as "WebFetch" | "WebSearch" })
        setBusy(false)
        if (!r.ok) return void toast.error(r.error?.message ?? "It could not be allowed")
        const n = (r.data as { allowed?: number } | undefined)?.allowed ?? 0
        toast(`Every ${req.toolName} in this session is allowed now${n > 1 ? `, and the ${n} waiting were allowed` : ""}.`)
      }}
    >
      Allow all {req.toolName} in this session
    </button>
  )
}
