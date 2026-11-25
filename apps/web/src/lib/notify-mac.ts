// Mac fork (owner, 25 Nov): Deny and Allow once from the Mac's notification of a request (packaging/mac/
// AppDelegate.swift). The window passes the button to this page as notify-deny:<id> or notify-allow:<id>, and the
// page answers as a row of Approvals does, so the Host's checks (D-021's friction among them) apply as to any answer
// from the desktop. Allow once goes only for a permission below High that is not "default to no", checked here again
// whatever the notification offered (the Host's apps/host/src/notify-mac.ts decides what it offers); anything else,
// or an answer the Host refused, opens the window on the request instead (notify-open:<id>). The notification never
// showed the command, so an Allow once from it counts as one given without the card opened.
import type { PendingView } from "@gatehouse/shared/ws-protocol"
import { useStore } from "../store"
import { decideFull } from "./decide"
import { tellShell } from "./shell"

/** As the Host's NOTIFY_ALLOW_BELOW: High (70) and over is never allowed from a notification. */
export const NOTIFY_ALLOW_BELOW = 70

export function notifyMayAllow(view: PendingView): boolean {
  const r = view.request
  return r.kind === "permission" && r.verdict.risk < NOTIFY_ALLOW_BELOW && !view.defaultToNo
}

/** Acts on notify-deny:<id> or notify-allow:<id>. False for any other message. */
export function fromNotification(m: string): boolean {
  const hit = /^notify-(deny|allow):([A-Za-z0-9-]{1,64})$/.exec(m)
  if (!hit) return false
  const [, button, id] = hit as unknown as [string, "deny" | "allow", string]
  const view = useStore.getState().pending[id]
  // Decided already, here, on the phone or by a timeout: nothing to do.
  if (!view) return true
  const open = () => tellShell(`notify-open:${id}`)
  if (button === "allow" && !notifyMayAllow(view)) {
    open()
    return true
  }
  void decideFull(
    button === "deny"
      ? { type: "deny", requestId: id }
      : {
          type: "approve",
          requestId: id,
          opened: false,
          shownMs: Math.min(86_400_000, Math.max(0, Date.now() - Date.parse(view.request.createdAt) || 0)),
        },
  ).then((r) => {
    if (r.error) open()
  })
  return true
}
