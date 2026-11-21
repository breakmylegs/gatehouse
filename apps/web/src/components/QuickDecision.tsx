import { useAllowChord } from "../lib/allow-chord"
import type { PendingView } from "@gatehouse/shared/ws-protocol"
import clsx from "clsx"
import { useEffect, useRef, useState } from "react"
import { decideFull } from "../lib/decide"
import { GrantAll } from "./GrantAll"
import { commandText, riskBand } from "../lib/format"
import { useStore } from "../store"
import { RiskBadge } from "./RiskBadge"
import { ShowHidden } from "./ShowHidden"

const isShell = (tool: string) => tool === "Bash" || tool === "PowerShell"
/** The Host's wait before a deliberate approval counts (server.ts, FRICTION_WAIT_MS), and a little more. */
const FRICTION_MS = 2200

/** What the request will do, in one or a few lines: the command for a shell, else the file or address. */
function preview(view: PendingView): { text: string; more: boolean } {
  const raw = view.rawInput
  if (isShell(view.request.toolName)) {
    const all = commandText(view.request.toolName, raw)
    const lines = all.split("\n")
    const text = lines.slice(0, 3).join("\n").slice(0, 300)
    return { text, more: text.length < all.length }
  }
  for (const k of ["file_path", "notebook_path", "path", "url", "pattern", "query"]) {
    const v = raw[k]
    if (typeof v === "string" && v) return { text: v, more: true }
  }
  return { text: "", more: true }
}

const title = (view: PendingView) =>
  isShell(view.request.toolName) ? "Run shell command" : view.request.toolName

/**
 * Allow once and Deny without opening the full card: on a row of the queue, and in the workspace of the session
 * that asked. Only for permission requests; a question or a plan needs reading and goes to the full card.
 *
 * As on the full card, Ctrl+Enter and Esc work only while focus is inside it, Deny is the filled choice when
 * risk is high, and everything else (a message, an edit, remember, stopping the session) is one click away
 * under More options.
 */
export function QuickDecision({
  view,
  variant,
  onMore,
}: {
  view: PendingView
  variant: "row" | "panel"
  onMore?: () => void
}) {
  const req = view.request
  const connected = useStore((s) => s.conn === "open")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const shownAt = useRef(Date.now())
  // D-021: after approvals too fast to read, the Host asks for a deliberate one. Owner, 16 Nov: this card only showed
  // the refusal and sent the same plain allow again, so it was refused however long you waited. Now Allow waits two
  // seconds, then sends the deliberate approval the Host asked for, as the full card does.
  const [friction, setFriction] = useState<"waiting" | "ready">()
  useEffect(() => setFriction(undefined), [req.id])
  useEffect(() => {
    if (friction !== "waiting") return
    const t = setTimeout(() => setFriction("ready"), FRICTION_MS)
    return () => clearTimeout(t)
  }, [friction])

  async function run(outcome: "allow" | "deny") {
    if (outcome === "allow" && friction === "waiting") return
    setBusy(true)
    setError(undefined)
    const r = await decideFull(
      outcome === "allow"
        ? // D-021: approved from a row: the card was never opened.
          {
            type: "approve",
            requestId: req.id,
            opened: false,
            shownMs: Date.now() - shownAt.current,
            ...(friction === "ready" ? { deliberate: true } : {}),
          }
        : { type: "deny", requestId: req.id },
    )
    setBusy(false)
    if (r.code === "friction") {
      setFriction("waiting")
      setError(
        "You approved several requests faster than they could be read. Look at what this one does; Allow works again in two seconds.",
      )
    } else if (r.error) setError(r.error)
  }

  const off = busy || !connected
  // D-092: allowing High or Severe by keyboard takes two presses within two seconds.
  const chord = useAllowChord(riskBand(req.verdict.risk) === "High" || riskBand(req.verdict.risk) === "Severe")
  const denyBtn = (
    <button
      type="button"
      className={clsx("btn", view.defaultToNo ? "btn-primary" : "btn-strong")}
      disabled={off}
      onClick={() => void run("deny")}
    >
      Deny{variant === "panel" ? <kbd>Esc</kbd> : null}
    </button>
  )
  const allowBtn = (
    <button
      type="button"
      className={clsx("btn", view.defaultToNo ? "btn-strong" : "btn-primary")}
      disabled={off || friction === "waiting"}
      onClick={() => void run("allow")}
      // Enter or Space on Allow is a key press like any other for the chord (D-092); a pointer click is not.
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return
        e.preventDefault()
        e.stopPropagation()
        if (chord.press("button-key")) void run("allow")
      }}
      {...(variant === "panel" ? { "aria-keyshortcuts": "Control+Enter" } : {})}
    >
      {friction === "waiting" ? "Read it first" : friction === "ready" ? "Yes, allow it" : "Allow once"}
      {variant === "panel" ? <kbd>Ctrl Enter</kbd> : null}
    </button>
  )

  // Backlog U4: a Severe request is never allowed from a row, where its command is not shown; Read it first opens
  // the full card. Deny stays one click.
  const severe = riskBand(req.verdict.risk) === "Severe"
  if (variant === "row")
    return (
      <div
        role="group"
        aria-label={`Decide ${title(view)} from ${req.project}`}
        className="grid justify-items-end gap-1"
      >
        <div className="flex gap-1.5 [&_.btn]:!min-h-7 [&_.btn]:!px-2.5 [&_.btn]:!text-[13px]">
          {denyBtn}
          {severe ? (
            <button type="button" className="btn btn-strong" onClick={onMore}>
              Read it first
            </button>
          ) : (
            allowBtn
          )}
        </div>
        <span className="[&_.btn]:!min-h-7 [&_.btn]:!px-2.5 [&_.btn]:!text-[13px]">
          <GrantAll view={view} />
        </span>
        {error ? (
          <p role="alert" className="m-0 text-[12.5px] font-semibold text-sev">
            {error}
          </p>
        ) : null}
      </div>
    )

  const shown = preview(view)
  return (
    <section
      aria-labelledby={`q-${req.id}`}
      tabIndex={-1}
      className="quick-decision"
      data-risk={riskBand(req.verdict.risk).toLowerCase()}
      onKeyDown={(e) => {
        if (off) return
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          if (chord.press("ctrl-enter")) void run("allow")
        } else if (e.key === "Enter" && chord.armed && !(e.target instanceof HTMLButtonElement)) {
          e.preventDefault()
          if (chord.press("enter")) void run("allow")
        } else if (e.key === "Escape") {
          e.preventDefault()
          void run("deny")
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="sign rounded-sm bg-sign px-2 text-[13px] text-sign-tx">
          Waiting on you
        </span>
        <h2 id={`q-${req.id}`} className="m-0 text-[17px]">
          {title(view)}
        </h2>
        <RiskBadge risk={req.verdict.risk} className="ml-auto text-[12.5px]" />
      </div>
      <p className="m-0 text-[13.5px]">
        <span className="text-mut">Why: </span>
        {req.verdict.reason}{" "}
        <span className="mono whitespace-nowrap text-[12px] text-mut">
          Rule {req.verdict.ruleId}
        </span>
      </p>
      {shown.text ? (
        <div className="pass-cmd">
          <div className="pass-cmd-head">
            <span>{isShell(req.toolName) ? "Command" : "Target"}</span>
            <span className="mono">{req.toolName}</span>
          </div>
          <pre className="cmd max-h-24 overflow-auto !py-1.5 !text-[13px]">
            <ShowHidden text={shown.text} />
          </pre>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 [&_.btn]:gap-2">
        {denyBtn}
        <button type="button" className="btn" onClick={onMore}>
          {shown.more ? "See everything and more options" : "More options"}
        </button>
        <span className="ml-auto flex flex-wrap gap-2">
          <GrantAll view={view} />
          {allowBtn}
        </span>
        {!connected ? (
          <span role="alert" className="text-[13px] font-semibold text-sev">
            Not connected to the Host. Decisions are paused until it is back.
          </span>
        ) : view.defaultToNo ? (
          <span className="text-[13px]">Risk is high: check it before you allow.</span>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="m-0 text-[13px] font-semibold text-sev">
          {error}
        </p>
      ) : null}
    </section>
  )
}
