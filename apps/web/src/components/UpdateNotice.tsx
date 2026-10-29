import { useEffect, useId, useState } from "react"
import { createPortal } from "react-dom"
import { useStore } from "../store"
import { noteLines, updateCall, type UpdateStatus } from "../lib/update"

/**
 * The header button when a newer version is out, the update dialog it opens, and the line that says how the last
 * update went. Updating is one choice: JCVC downloads only what changed, closes, switches and opens again.
 */
export function UpdateNotice() {
  const update = useStore((s) => s.update)
  const conn = useStore((s) => s.conn)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (conn === "open") void updateCall("GET", "/api/update")
  }, [conn])

  if (!update) return null
  const target = update.latest?.version
  const showButton = update.available && update.canInstall && target !== undefined
  return (
    <>
      {showButton ? (
        <button className="btn btn-primary" onClick={() => setOpen(true)} aria-haspopup="dialog">
          {update.phase === "ready" ? `Update ready: ${target}` : `Update to ${target}`}
        </button>
      ) : null}
      {/* Outside the header, so it does not take on the header's colours and button styles. */}
      {open && target
        ? createPortal(
            <UpdateDialog update={update} onClose={() => setOpen(false)} />,
            document.body,
          )
        : null}
    </>
  )
}

/** How the last switch went, once, under the header. */
export function UpdateResult() {
  const r = useStore((s) => s.update?.lastResult)
  if (!r) return null
  const text = r.ok
    ? r.mode === "rollback"
      ? `JCVC went back to ${r.to}. Version ${r.from} is skipped; you can offer it again in Settings.`
      : `JCVC was updated to ${r.to}.`
    : `The update to ${r.to} did not start, so JCVC went back to ${r.from}. ${r.reason ?? ""} It will not be offered again until a newer version comes out.`
  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b border-line bg-s1 px-4 py-2 text-sm"
    >
      <span className={r.ok ? "" : "font-semibold"}>{text}</span>
      <button
        className="btn ml-auto"
        onClick={() => void updateCall("POST", "/api/update/dismiss")}
      >
        Dismiss
      </button>
    </div>
  )
}

function UpdateDialog({ update, onClose }: { update: UpdateStatus; onClose: () => void }) {
  const titleId = useId()
  const sessions = useStore((s) => s.sessions)
  const running = Object.values(sessions).filter(
    (x) => x.state !== "ended" && x.state !== "error",
  ).length
  const target = update.latest?.version as string
  // The Host keeps "Update now": it switches as soon as the version is ready, even if this dialog is closed.
  const wanted = update.applyWhenReady === target

  useEffect(() => {
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && update.phase !== "applying" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose, update.phase])

  const go = () => void updateCall("POST", "/api/update/install", { version: target })
  const p = update.progress
  const pct = p && p.total > 0 ? Math.min(100, Math.round((p.done / p.total) * 100)) : undefined
  const busy = update.phase === "applying" || wanted

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/30">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="panel grid w-[520px] max-w-[92vw] gap-3 p-5"
      >
        <h2 id={titleId} className="m-0 text-lg font-semibold">
          JCVC {target} is {update.phase === "ready" ? "ready" : "available"}
        </h2>
        <p className="m-0 text-sm text-mut">You have {update.current}.</p>
        {update.latest?.notes ? (
          <div>
            <h3 className="m-0 mb-1 text-sm font-semibold">What is new</h3>
            <ul className="m-0 max-h-48 overflow-auto pl-5 text-sm">
              {noteLines(update.latest.notes).map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {running > 0 ? (
          <p className="m-0 text-sm">
            {running === 1 ? "1 session is" : `${running} sessions are`} open. Updating closes JCVC,
            which stops them; you can resume them from Sessions afterwards.
          </p>
        ) : null}
        {update.phase === "preparing" && p ? (
          <div className="grid gap-1" aria-live="polite">
            <span className="text-sm">
              {p.label}
              {pct !== undefined ? `, ${pct}%` : ""}
            </span>
            <progress className="w-full" max={p.total || 1} value={p.done} aria-label={p.label} />
          </div>
        ) : null}
        {wanted && update.phase !== "applying" ? (
          <p className="m-0 text-sm" aria-live="polite">
            JCVC switches to {target} as soon as it is ready. You can close this and keep working.
          </p>
        ) : null}
        {update.phase === "applying" ? (
          <p className="m-0 text-sm" aria-live="polite">
            JCVC is closing to switch to {target}. It opens again by itself in a moment.
          </p>
        ) : null}
        {update.phase === "failed" && update.error ? (
          <p className="m-0 text-sm font-semibold" role="alert">
            {update.error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" onClick={go} disabled={busy}>
            {update.phase === "failed" ? "Try again" : wanted ? "Updating" : "Update now"}
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={() => {
              void updateCall("POST", "/api/update/skip", { version: target })
              onClose()
            }}
          >
            Skip this version
          </button>
          <button className="btn" onClick={onClose} disabled={update.phase === "applying"}>
            Later
          </button>
        </div>
      </div>
    </div>
  )
}
