import { useEffect, useState } from "react"
import { api } from "../lib/api"
import { send, useStore } from "../store"

type SignInStatus = {
  state: "idle" | "waiting" | "finished" | "failed"
  message: string
  url?: string
}

/**
 * Sign in without leaving the app: it asks the Host to start Anthropic's own sign-in, which opens your browser.
 * The app never sees the sign-in. When the browser step ends, the Host checks the account again.
 */
export function SignInPanel() {
  const signedIn = useStore((s) => s.health?.signin.signedIn)
  const email = useStore((s) => s.health?.signin.email)
  const [status, setStatus] = useState<SignInStatus>({ state: "idle", message: "" })

  useEffect(() => {
    if (status.state !== "waiting") return
    const t = setInterval(async () => {
      const r = await send({ type: "signin_status" })
      if (r.ok) setStatus(r.data as SignInStatus)
    }, 1500)
    return () => clearInterval(t)
  }, [status.state])

  async function start(method: "claudeai" | "sso") {
    setStatus({ state: "waiting", message: "Opening your browser..." })
    const r = await send({ type: "signin_start", method })
    setStatus(
      r.ok
        ? (r.data as SignInStatus)
        : { state: "failed", message: r.error?.message ?? "The sign-in could not start." },
    )
  }

  async function cancel() {
    const r = await send({ type: "signin_cancel" })
    if (r.ok) setStatus(r.data as SignInStatus)
  }

  if (signedIn) {
    return (
      <p role="status" className="m-0">
        Signed in as {email ?? "your account"}.
      </p>
    )
  }
  const waiting = status.state === "waiting"
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <button
          className="btn btn-primary"
          disabled={waiting}
          onClick={() => void start("claudeai")}
        >
          Sign in with my Claude account
        </button>
        <button className="btn" disabled={waiting} onClick={() => void start("sso")}>
          Sign in with company single sign-on
        </button>
        {waiting ? (
          <button className="btn" onClick={() => void cancel()}>
            Cancel
          </button>
        ) : null}
      </div>
      {status.message ? (
        <p
          role="status"
          className={status.state === "failed" ? "m-0 font-semibold text-sev" : "m-0"}
        >
          {status.message}
        </p>
      ) : null}
      {status.url && waiting ? (
        <p className="m-0 text-xs text-mut">
          No browser opened? Copy this address into one:{" "}
          <span className="mono break-all select-all">{status.url}</span>
        </p>
      ) : null}
      <p className="m-0 text-xs text-mut">
        Your browser opens on Anthropic&apos;s own page. This app never sees your password or your
        sign-in. You can also sign in from a terminal with{" "}
        <code className="mono">claude auth login</code>.
      </p>
    </div>
  )
}

/** Saves the organisation the account must belong to. It applies at once, so the account is checked again. */
export function OrgForm() {
  const health = useStore((s) => s.health)
  const expectedOrg = useStore((s) => s.expectedOrg)
  const [org, setOrg] = useState("")
  const [msg, setMsg] = useState<string>()
  const [busy, setBusy] = useState(false)
  const s = health?.signin
  if (!s) return null

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const cur = await api<{ saved: Record<string, unknown> }>("GET", "/api/settings")
    const r = await api("PUT", "/api/settings", {
      ...(cur.data?.saved ?? {}),
      expectedOrg: org.trim(),
    })
    if (!r.ok) {
      setBusy(false)
      setMsg((r.errors ?? [r.error ?? "Not saved"]).join(" "))
      return
    }
    setMsg("Saved. Checking your account again, which takes a few seconds.")
    const again = await send({ type: "refresh_account" }, 120_000)
    setBusy(false)
    setMsg(
      again.ok
        ? "Saved and checked again."
        : "Saved. The check could not run just now: choose Check again.",
    )
  }

  return (
    <form
      onSubmit={save}
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
  )
}
