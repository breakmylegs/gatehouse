// Mac fork (owner, 25 Nov): what Codehouse.app's notification of a request is told, on the Host's "attention" line
// (main.ts). Only the request's id, its kind, its risk band and whether Allow once may be offered: never the command,
// a path or the project, since a notification can show on a locked screen or a shared one. The notification offers Deny
// for every permission, and Allow once only where `allow` is true; the page checks the same again before it sends an
// answer (apps/web/src/lib/notify-mac.ts), and the Host's own checks apply as to any answer from the desktop.
import type { PendingView } from "./broker.js"

/** Allow once is offered on the notification only below this risk (High and Severe open the window instead). */
export const NOTIFY_ALLOW_BELOW = 70

export type NotifyBand = "low" | "moderate" | "high" | "severe"

export function notifyBand(risk: number): NotifyBand {
  return risk >= 85 ? "severe" : risk >= NOTIFY_ALLOW_BELOW ? "high" : risk >= 40 ? "moderate" : "low"
}

/** A permission below High, not one that must not be approvable by a stray keystroke. */
export function notifyMayAllow(view: PendingView): boolean {
  const r = view.request
  return r.kind === "permission" && r.verdict.risk < NOTIFY_ALLOW_BELOW && !view.defaultToNo
}

export function attentionDetail(view: PendingView): {
  id: string
  kind: PendingView["request"]["kind"]
  band: NotifyBand
  allow: boolean
} {
  const r = view.request
  return { id: r.id, kind: r.kind, band: notifyBand(r.verdict.risk), allow: notifyMayAllow(view) }
}
