import type { PendingView } from "@gatehouse/shared/ws-protocol"
import clsx from "clsx"
import { useState } from "react"
import { decide } from "../lib/decide"
import { commandText } from "../lib/format"
import { useStore } from "../store"
import { RiskBadge } from "./RiskBadge"

const isShell = (tool: string) => tool === "Bash" || tool === "PowerShell"

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

  async function run(outcome: "allow" | "deny") {
    setBusy(true)
    setError(undefined)
    const failed = await decide(
      outcome === "allow"
        ? { type: "approve", requestId: req.id }
        : { type: "deny", requestId: req.id },
    )
    setBusy(false)
    if (failed) setError(failed)
  }

  const off = busy || !connected
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
      disabled={off}
      onClick={() => void run("allow")}
      {...(variant === "panel" ? { "aria-keyshortcuts": "Control+Enter" } : {})}
    >
      Allow once
      {variant === "panel" ? (
        <span>
          <kbd>Ctrl</kbd>+<kbd>Enter</kbd>
        </span>
      ) : null}
    </button>
  )

  if (variant === "row")
    return (
      <div
        role="group"
        aria-label={`Decide ${title(view)} from ${req.project}`}
        className="grid justify-items-end gap-1"
      >
        <div className="flex gap-1.5 [&_.btn]:!min-h-7 [&_.btn]:!px-2.5 [&_.btn]:!text-[13px]">
          {denyBtn}
          {allowBtn}
        </div>
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
      onKeyDown={(e) => {
        if (off) return
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          void run("allow")
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
      {shown.text ? (
        <pre className="cmd max-h-24 overflow-auto !py-1.5 !text-[13px]">{shown.text}</pre>
      ) : null}
      <p className="m-0 text-[13.5px]">
        <span className="text-mut">Why: </span>
        {req.verdict.reason}
      </p>
      <div className="flex flex-wrap items-center gap-2 [&_.btn]:gap-2">
        {denyBtn}
        {allowBtn}
        <button type="button" className="btn" onClick={onMore}>
          {shown.more ? "See everything and more options" : "More options"}
        </button>
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
