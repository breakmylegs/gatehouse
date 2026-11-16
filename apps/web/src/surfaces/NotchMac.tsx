// Mac fork (owner, 14 Nov): what waits on you, beside the notch. Codehouse.app loads this page with ?view=notch in a
// small panel next to the notch (packaging/mac/Notch.swift), so another app can keep the notch itself. It shows
// nothing while nothing waits; with requests waiting, a black wing with how many and the highest risk; a click opens
// the list, with the same Deny and Allow once as a row of Approvals (QuickDecision): a Severe request, a question or a
// plan opens the main window instead. The little fighter waits beside each one (owner, 16 Nov). A request stays until
// it is decided, here, in the window or on the phone. Only what a row shows is shown: the project, what it is and its
// risk, never the command.
import type { PendingView } from "@gatehouse/shared/ws-protocol"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Fighter } from "../components/Fighter"
import { QuickDecision } from "../components/QuickDecision"
import { RiskBadge } from "../components/RiskBadge"
import { riskBand } from "../lib/format"
import { onShell, tellShell } from "../lib/shell"
import { usePending } from "../store"
import "../notch-mac.css"

const BANDS = ["Low", "Moderate", "High", "Severe"] as const

const what = (p: PendingView) =>
  p.request.kind === "question"
    ? "Question from Claude"
    : p.request.kind === "plan"
      ? "Plan to approve"
      : p.request.toolName === "Bash" || p.request.toolName === "PowerShell"
        ? "Run shell command"
        : p.request.toolName

/** Asks the window to show a request in full: the main window, on Approvals. */
const openInWindow = (id: string) => tellShell(`notch-open:${id}`)

export function NotchMac() {
  const pending = usePending()
  const [open, setOpen] = useState(false)
  // Against the notch, or under the menu bar of a screen without one (the window says which).
  const [free, setFree] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const top = pending.reduce((m, p) => Math.max(m, BANDS.indexOf(riskBand(p.request.verdict.risk))), 0)

  useEffect(() => {
    // Beside the black notch, dark whatever the window's theme.
    document.documentElement.dataset.view = "notch"
    document.documentElement.dataset.theme = "dark"
  }, [])
  useEffect(
    () =>
      onShell((m) => {
        if (m === "notch-place:free") setFree(true)
        else if (m === "notch-place:notch") setFree(false)
      }),
    [],
  )
  useEffect(() => {
    if (pending.length === 0) setOpen(false)
  }, [pending.length])
  // The window is as big as what is shown, and hides when nothing waits.
  useLayoutEffect(() => {
    if (pending.length === 0) return tellShell("notch:hide")
    const el = box.current
    if (!el) return
    const say = () => tellShell(`notch:size:${Math.ceil(el.offsetWidth)}:${Math.ceil(el.offsetHeight)}`)
    say()
    const ro = new ResizeObserver(say)
    ro.observe(el)
    return () => ro.disconnect()
  }, [pending.length, open])

  if (pending.length === 0) return null
  const label = `${pending.length} waiting on you, the highest ${BANDS[top]} risk`
  return (
    <div
      ref={box}
      className="notch"
      data-open={open ? "" : undefined}
      data-free={free ? "" : undefined}
      data-risk={BANDS[top]!.toLowerCase()}
    >
      <button
        type="button"
        className="notch-wing"
        aria-expanded={open}
        aria-label={open ? `Close the list: ${label}` : `Open the list: ${label}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="notch-dot" aria-hidden="true" />
        <span className="notch-count">{pending.length}</span>
      </button>
      {open ? (
        <ul className="notch-list" aria-label="Waiting on you">
          {pending.map((p) => (
            <li key={p.request.id} className="notch-item">
              <Fighter mode="waiting" />
              <span className="grid min-w-0 gap-0.5">
                <span className="truncate text-[12.5px] text-mut">{p.request.project}</span>
                <span className="truncate text-[14px] font-semibold">{what(p)}</span>
                <RiskBadge risk={p.request.verdict.risk} className="w-fit text-[11.5px]" />
              </span>
              {p.request.kind === "permission" ? (
                <QuickDecision view={p} variant="row" onMore={() => openInWindow(p.request.id)} />
              ) : (
                <button type="button" className="btn btn-strong !min-h-7 !px-2.5 !text-[13px]" onClick={() => openInWindow(p.request.id)}>
                  Open
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
