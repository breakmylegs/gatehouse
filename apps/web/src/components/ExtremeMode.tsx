import { useState } from "react"
import { api } from "../lib/api"
import { useStore } from "../store"

/** Saves the one setting without touching the others, so it can never undo a change made elsewhere. */
export async function setExtreme(on: boolean): Promise<string | undefined> {
  const cur = await api<{ saved: Record<string, unknown> }>("GET", "/api/settings")
  if (!cur.ok) return cur.error ?? "The settings could not be read."
  const body: Record<string, unknown> = { ...(cur.data?.saved ?? {}) }
  if (on) body.extremeApproval = true
  else delete body.extremeApproval
  const r = await api("PUT", "/api/settings", body)
  return r.ok ? undefined : (r.errors ?? [r.error ?? "Not saved"]).join(" ")
}

/** Settings: turn Extreme approval mode on (after a plain warning) or off. */
export function ExtremePanel() {
  const on = useStore((s) => s.health?.extremeApproval ?? false)
  const [sure, setSure] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string>()

  async function change(next: boolean) {
    setBusy(true)
    const err = await setExtreme(next)
    setBusy(false)
    setSure(false)
    setMsg(err ?? (next ? "Extreme approval mode is on." : "Extreme approval mode is off."))
  }

  return (
    <fieldset className="m-0 grid gap-2 border-0 p-0">
      <legend className="mb-1 text-sm font-semibold">Extreme approval mode</legend>
      <p className="m-0">
        Approves every request that would otherwise wait for you. Your phone gets a notice for each
        one that says it was approved automatically because Extreme approval mode is on.
      </p>
      <p className="m-0 text-xs text-mut">
        Still blocked, always: everything on the floor list (secrets, destructive commands),
        anything the rules deny, the kill switch, and any failure to decide or to record the
        decision. Questions from Claude and plan approvals still wait for your answer. Every
        automatic approval is written to the audit log.
      </p>
      {on ? (
        <div>
          <button className="btn btn-deny" disabled={busy} onClick={() => void change(false)}>
            Turn Extreme approval mode off
          </button>
        </div>
      ) : (
        <>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />I
            understand that Claude can then run anything the rules do not forbid, on this computer,
            without asking me.
          </label>
          <div>
            <button
              className="btn btn-primary"
              disabled={!sure || busy}
              onClick={() => void change(true)}
            >
              Turn Extreme approval mode on
            </button>
          </div>
        </>
      )}
      {msg ? (
        <p role="status" className="m-0">
          {msg}
        </p>
      ) : null}
    </fieldset>
  )
}

/** A bar across the top, on every screen, while the mode is on. It cannot be dismissed, only turned off. */
export function ExtremeBanner() {
  const on = useStore((s) => s.health?.extremeApproval ?? false)
  const [busy, setBusy] = useState(false)
  if (!on) return null
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 border-b border-line bg-hi px-4 py-1.5 text-[13px] font-semibold"
    >
      <span>
        Extreme approval mode is on: requests that would ask you are approved automatically. The
        floor and the rules still block.
      </span>
      <button
        className="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          await setExtreme(false)
          setBusy(false)
        }}
      >
        Turn off
      </button>
    </div>
  )
}
