import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"

interface SlackStatus {
  enabled: boolean
  connected: boolean
  channel?: string
  userId?: string
  maxRisk?: number
  hasTokens: boolean
  lastError?: string
  sent: number
}

const MANIFEST = JSON.stringify(
  {
    display_information: { name: "JCVC" },
    features: { bot_user: { display_name: "JCVC", always_online: false } },
    oauth_config: { scopes: { bot: ["chat:write", "im:write"] } },
    settings: {
      interactivity: { is_enabled: true },
      socket_mode_enabled: true,
      token_rotation_enabled: false,
    },
  },
  null,
  2,
)

const LIMITS = [
  { value: 39, label: "Low risk only" },
  { value: 69, label: "Up to moderate risk (recommended)" },
  { value: 84, label: "Up to high risk" },
]

/** Slack through Socket Mode: requests posted with buttons, your tap heard over a connection this computer opens. */
export function SlackPanel() {
  const [st, setSt] = useState<SlackStatus>()
  const [botToken, setBotToken] = useState("")
  const [appToken, setAppToken] = useState("")
  const [userId, setUserId] = useState("")
  const [channel, setChannel] = useState("")
  const [maxRisk, setMaxRisk] = useState(69)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const load = useCallback(async () => {
    const r = await api<{ slack: SlackStatus }>("GET", "/api/push")
    if (r.ok && r.data?.slack) {
      const s = r.data.slack
      setSt(s)
      if (s.userId) setUserId((v) => v || s.userId!)
      if (s.channel) setChannel((v) => v || s.channel!)
      if (s.maxRisk !== undefined) setMaxRisk(s.maxRisk)
    }
  }, [])
  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 5000)
    return () => clearInterval(t)
  }, [load])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    const r = await api<SlackStatus>("POST", "/api/push/slack/enable", {
      ...(botToken ? { botToken, appToken } : {}),
      userId,
      channel: channel || userId,
      maxRisk,
    })
    setBusy(false)
    if (!r.ok) {
      setError(r.error ?? "Slack could not be switched on")
      return
    }
    setBotToken("")
    setAppToken("")
    toast(st?.enabled ? "Slack settings saved" : "Slack is on", { id: "settings" })
    await load()
  }
  async function test() {
    setBusy(true)
    const r = await api<{ ok: boolean; error?: string }>("POST", "/api/push/slack/test")
    setBusy(false)
    if (r.ok && r.data?.ok) toast("Test sent to Slack")
    else setError(r.data?.error ?? r.error ?? "The test was not sent")
  }
  async function off(forgetTokens: boolean) {
    setBusy(true)
    const r = await api("POST", "/api/push/slack/disable", { forgetTokens })
    setBusy(false)
    if (r.ok)
      toast(forgetTokens ? "Slack is off and its tokens are forgotten" : "Slack is off", {
        id: "settings",
      })
    else setError(r.error ?? "Slack could not be switched off")
    await load()
  }

  return (
    <form
      onSubmit={save}
      className="panel grid gap-3 p-5"
      aria-label="Push notifications with Slack"
    >
      <div>
        <h2 className="m-0 text-[18px]">Push notifications with Slack</h2>
        <p className="m-0 mt-1 max-w-[72ch]">
          Get each request as a Slack message with Approve and Deny buttons. JCVC posts it and hears
          your tap over a connection it opens to Slack (Socket Mode), so nothing has to reach in.
          Only your own taps count.
        </p>
      </div>
      <details className="text-[13px]">
        <summary className="cursor-pointer font-semibold">
          Set up the Slack app (about 3 minutes)
        </summary>
        <ol className="m-0 mt-2 grid gap-1.5 pl-5">
          <li>
            In Slack's app settings, create a new app <strong>from a manifest</strong> in your
            workspace, and paste this:
            <pre className="cmd mt-1 select-all !text-[12px]">{MANIFEST}</pre>
          </li>
          <li>
            Install the app to the workspace, then copy the <strong>Bot User OAuth Token</strong>{" "}
            (starts <span className="mono">xoxb-</span>).
          </li>
          <li>
            Under Basic Information, make an <strong>App-Level Token</strong> with the scope{" "}
            <span className="mono">connections:write</span> and copy it (starts{" "}
            <span className="mono">xapp-</span>).
          </li>
          <li>
            In your Slack profile, choose the three dots, then <strong>Copy member ID</strong>{" "}
            (starts <span className="mono">U</span>).
          </li>
          <li>
            Leave the channel empty for a direct message from the app, or give a channel id the app
            is in.
          </li>
        </ol>
        <p className="m-0 mt-2 text-mut">
          A company Slack may need an administrator to approve the app.
        </p>
      </details>
      <div className="grid grid-cols-2 gap-3 max-[700px]:grid-cols-1">
        <label className="grid gap-1">
          <span>Bot token{st?.hasTokens ? " (saved; leave empty to keep it)" : ""}</span>
          <input
            className="field mono"
            type="password"
            autoComplete="off"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            placeholder="xoxb-..."
          />
        </label>
        <label className="grid gap-1">
          <span>App-level token{st?.hasTokens ? " (saved; leave empty to keep it)" : ""}</span>
          <input
            className="field mono"
            type="password"
            autoComplete="off"
            value={appToken}
            onChange={(e) => setAppToken(e.target.value)}
            placeholder="xapp-..."
          />
        </label>
        <label className="grid gap-1">
          <span>Your member id</span>
          <input
            className="field mono"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="U0123ABCD"
          />
        </label>
        <label className="grid gap-1">
          <span>Channel id (empty: a direct message to you)</span>
          <input
            className="field mono"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            placeholder="C0123ABCD"
          />
        </label>
        <label className="grid gap-1">
          <span>Approve from Slack</span>
          <select
            className="field"
            value={maxRisk}
            onChange={(e) => setMaxRisk(Number(e.target.value))}
          >
            {LIMITS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary" disabled={busy || !userId.trim()}>
          {st?.enabled ? "Save changes" : "Switch on Slack"}
        </button>
        {st?.enabled ? (
          <>
            <button type="button" className="btn" disabled={busy} onClick={() => void test()}>
              Send a test message
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void off(false)}>
              Switch off
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void off(true)}>
              Switch off and forget the tokens
            </button>
          </>
        ) : null}
        <span aria-live="polite" className="sign text-[14px]">
          {st?.enabled
            ? st.connected
              ? "Connected to Slack."
              : "Not connected yet. It retries by itself."
            : "Off"}
        </span>
      </div>
      {error || st?.lastError ? (
        <p role="alert" className="m-0 font-semibold text-sev">
          {error ?? st?.lastError}
        </p>
      ) : null}
      <p className="m-0 text-xs text-mut">
        The tokens are kept encrypted on this computer with Windows' own protection, never in the
        settings file. Slack can read what it carries, so a message shows only the project, tool,
        risk and a short redacted summary. Each button works once, and Severe requests always need
        you at the desk.
      </p>
    </form>
  )
}
