import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"

interface NtfyStatus {
  enabled: boolean
  listening: boolean
  server?: string
  topic?: string
  maxRisk?: number
  lastError?: string
  sent: number
}

const LIMITS = [
  { value: 39, label: "Low risk only" },
  { value: 69, label: "Up to moderate risk (recommended)" },
  { value: 84, label: "Up to high risk" },
]

/**
 * Push notifications through ntfy. Everything goes out from this computer: JCVC posts the notification, and listens
 * for your tap on a reply topic over its own connection. Nothing has to reach in, so it works behind firewalls.
 */
export function PushPanel() {
  const [st, setSt] = useState<NtfyStatus>()
  const [server, setServer] = useState("https://ntfy.sh")
  const [maxRisk, setMaxRisk] = useState(69)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const load = useCallback(async () => {
    const r = await api<{ ntfy: NtfyStatus }>("GET", "/api/push")
    if (r.ok && r.data) {
      setSt(r.data.ntfy)
      if (r.data.ntfy.server) setServer(r.data.ntfy.server)
      if (r.data.ntfy.maxRisk !== undefined) setMaxRisk(r.data.ntfy.maxRisk)
    }
  }, [])
  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 5000)
    return () => clearInterval(t)
  }, [load])

  async function enable(newTopics = false) {
    setBusy(true)
    setError(undefined)
    const r = await api<NtfyStatus>("POST", "/api/push/ntfy/enable", { server, maxRisk, newTopics })
    setBusy(false)
    if (!r.ok) setError(r.error ?? "ntfy could not be switched on")
    else if (newTopics) toast("New topics made. Subscribe to the new one on your phone.")
    await load()
  }
  async function disable() {
    setBusy(true)
    await api("POST", "/api/push/ntfy/disable")
    setBusy(false)
    await load()
  }
  async function test() {
    setBusy(true)
    const r = await api<{ ok: boolean; error?: string }>("POST", "/api/push/ntfy/test")
    setBusy(false)
    if (r.ok && r.data?.ok) toast("Test sent. It should arrive on your phone in a few seconds.")
    else setError(r.data?.error ?? r.error ?? "The test was not sent")
  }

  const on = st?.enabled === true
  return (
    <section className="panel grid gap-3 p-5" aria-label="Push notifications with ntfy">
      <div>
        <h2 className="m-0 text-[18px]">Push notifications with ntfy</h2>
        <p className="m-0 mt-1 max-w-[72ch]">
          Get each request on your phone with Approve and Deny buttons. Everything goes out from
          this computer, and your answer comes back over a connection JCVC opens itself, so nothing
          has to reach in. It works behind company firewalls.
        </p>
      </div>
      {on ? (
        <>
          <ol className="m-0 grid gap-2 pl-5">
            <li>
              Install the free <strong>ntfy</strong> app on your iPhone or Android phone.
            </li>
            <li>
              In the app, subscribe to this topic
              {st?.server && st.server !== "https://ntfy.sh" ? (
                <>
                  {" "}
                  on the server <span className="mono">{st.server}</span>
                </>
              ) : null}
              :
              <span className="mono mt-1 block w-fit select-all rounded bg-s2 px-2 py-1 text-[15px]">
                {st?.topic}
              </span>
            </li>
            <li>
              <button type="button" className="btn" disabled={busy} onClick={() => void test()}>
                Send a test notification
              </button>
            </li>
          </ol>
          <p aria-live="polite" className="sign m-0 text-[14px]">
            {st?.listening
              ? "Listening for your answers."
              : "Not listening yet. It retries by itself."}{" "}
            Sent {st?.sent ?? 0} this run.
          </p>
          {st?.lastError ? <p className="m-0 text-[13px] text-sev">{st.lastError}</p> : null}
        </>
      ) : null}
      <div className="grid grid-cols-[minmax(0,1fr)_260px] gap-3 max-[700px]:grid-cols-1">
        <label className="grid gap-1">
          <span>ntfy server</span>
          <input
            className="field mono"
            value={server}
            onChange={(e) => setServer(e.target.value)}
          />
        </label>
        <label className="grid gap-1">
          <span>Approve from a notification</span>
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
      <div className="flex flex-wrap gap-2">
        {on ? (
          <>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void enable(false)}
            >
              Save changes
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void enable(true)}>
              Make new topics
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void disable()}>
              Switch off
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void enable(false)}
          >
            Switch on ntfy
          </button>
        )}
      </div>
      {error ? (
        <p role="alert" className="m-0 font-semibold text-sev">
          {error}
        </p>
      ) : null}
      <p className="m-0 text-xs text-mut">
        ntfy can read what it carries, so a notification shows only the project, the tool, the risk
        and a short summary with secrets and your redaction list removed. Each button works once,
        for that one request, until the phone window closes. Severe requests always need you at the
        desk. Keep the topic name private, and choose Make new topics if it gets out.
      </p>
    </section>
  )
}
