import { useState } from "react"
import { api } from "../lib/api"
import { send, useStore } from "../store"

function Check({
  ok,
  title,
  info,
  children,
}: {
  ok: boolean | undefined
  title: string
  /** Information only: never shown as a failure. */
  info?: boolean
  children?: React.ReactNode
}) {
  return (
    <li className="grid grid-cols-[22px_1fr] gap-2 py-2">
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        aria-hidden="true"
        className={ok ? "text-ok" : info ? "text-mut" : "text-sev"}
      >
        {ok ? (
          <path
            d="M3 8.5 6.5 12 13 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : info ? (
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
        ) : (
          <path
            d="M8 1.5 15 14H1z M8 6v4M8 12v.01"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
      </svg>
      <div>
        <strong>
          {title}
          <span className="sr-only">
            {ok ? ", passed" : info ? ", information only" : ", needs attention"}
          </span>
        </strong>
        {children ? <div className="text-mut">{children}</div> : null}
      </div>
    </li>
  )
}

export function FirstRun() {
  const health = useStore((s) => s.health)
  const expectedOrg = useStore((s) => s.expectedOrg)
  const setRoute = useStore((s) => s.setRoute)
  const [org, setOrg] = useState("")
  const [msg, setMsg] = useState<string>()
  const [busy, setBusy] = useState(false)

  if (!health) return <p className="p-6 text-mut">Waiting for the Host…</p>
  const s = health.signin
  const all = s.signedIn && s.orgOk

  async function saveOrg(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const cur = await api<{ saved: Record<string, unknown> }>("GET", "/api/settings")
    const r = await api("PUT", "/api/settings", {
      ...(cur.data?.saved ?? {}),
      expectedOrg: org.trim(),
    })
    setBusy(false)
    setMsg(
      r.ok
        ? "Saved. Restart Gatehouse, then this check will pass."
        : (r.errors ?? [r.error ?? "Not saved"]).join(" "),
    )
  }

  return (
    <div className="mx-auto grid max-w-[720px] gap-4 p-6">
      <h1 className="m-0 text-lg font-semibold">Before you start</h1>
      <p className="m-0 text-mut">Gatehouse checks four things before it lets a session run.</p>
      <ul
        className="m-0 list-none divide-y divide-line border-y border-line p-0"
        aria-label="Checks"
      >
        <Check ok={s.signedIn} title="Signed in to Claude">
          {s.signedIn
            ? `Signed in as ${s.email ?? "your account"}.`
            : "Sign in with the Claude Code app on this computer, then check again. Gatehouse never handles your sign-in."}
        </Check>
        <Check ok={s.orgOk} title="Organisation matches">
          {s.orgMessage ??
            (s.orgOk
              ? `Organisation: ${s.organization ?? "unknown"}.`
              : "Set the organisation your account must belong to.")}
        </Check>
        <Check ok={s.managedPolicy === "detected"} info title="Managed policy">
          {s.managedPolicy === "detected"
            ? "Your organisation's managed settings are in force and Gatehouse works within them."
            : s.managedPolicy === "unknown"
              ? "Not known yet. This is information only and does not stop you."
              : "No managed settings found. Information only."}
        </Check>
        <Check ok={health.approver.state === "up"} title="Approver running">
          {health.approver.state === "up"
            ? "The Approver is deciding low-risk requests."
            : "It has not started. Requests will all wait for you until it does."}
        </Check>
      </ul>

      {!s.orgOk && s.signedIn ? (
        <form
          onSubmit={saveOrg}
          className="panel grid gap-2 p-4"
          aria-label="Set the expected organisation"
        >
          <label className="grid gap-1">
            <span>Expected organisation {expectedOrg ? `(now ${expectedOrg})` : ""}</span>
            <input
              className="field"
              required
              value={org}
              onChange={(e) => setOrg(e.target.value)}
              placeholder={s.organization ?? "Organisation name"}
            />
          </label>
          <div className="flex items-center gap-3">
            <button className="btn btn-primary" disabled={busy || !org.trim()}>
              Save
            </button>
            {s.organization ? (
              <button type="button" className="btn" onClick={() => setOrg(s.organization ?? "")}>
                Use {s.organization}
              </button>
            ) : null}
          </div>
          {msg ? (
            <p role="status" className="m-0">
              {msg}
            </p>
          ) : null}
        </form>
      ) : null}

      <div className="flex gap-2">
        <button className="btn" onClick={() => void send({ type: "refresh_account" })}>
          Check again
        </button>
        <button className="btn" onClick={() => setRoute("settings")}>
          Open settings
        </button>
        {all ? (
          <button className="btn btn-primary" onClick={() => setRoute("sessions")}>
            Start a session
          </button>
        ) : null}
      </div>
      <p className="m-0 text-xs text-mut">
        Pairing a phone is optional and can be done later from Devices.
      </p>
    </div>
  )
}
