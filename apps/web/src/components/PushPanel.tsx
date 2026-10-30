import { useCallback, useEffect, useRef, useState } from "react"
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
  const [sent, setSent] = useState<string>()
  const [confirmNew, setConfirmNew] = useState(false)
  const [typing, setTyping] = useState(false)
  const [typed, setTyped] = useState("")
  const filled = useRef(false)

  // Read every few seconds for the listening state; the boxes are filled once, so the check never undoes your typing.
  const load = useCallback(async () => {
    const r = await api<{ ntfy: NtfyStatus }>("GET", "/api/push")
    if (r.ok && r.data) {
      setSt(r.data.ntfy)
      if (filled.current) return
      filled.current = true
      if (r.data.ntfy.server) setServer(r.data.ntfy.server)
      if (r.data.ntfy.maxRisk !== undefined) setMaxRisk(r.data.ntfy.maxRisk)
    }
  }, [])
  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 5000)
    return () => clearInterval(t)
  }, [load])

  /** Saves, switching ntfy on if it was off. `topic` is one typed back in: the topic the phone already has. */
  async function enable(newTopics = false, topic?: string) {
    setBusy(true)
    setError(undefined)
    const r = await api<NtfyStatus>("POST", "/api/push/ntfy/enable", {
      server,
      maxRisk,
      newTopics,
      ...(topic !== undefined ? { topic } : {}),
    })
    setBusy(false)
    if (!r.ok) setError(r.error ?? "ntfy could not be switched on")
    else if (topic !== undefined) {
      setTyping(false)
      setTyped("")
      toast("JCVC now sends to your phone's topic. Send a test to check.")
    } else if (newTopics) toast("New topics made. Subscribe to the new one on your phone.")
    else toast(st?.enabled ? "ntfy settings saved" : "ntfy is on", { id: "settings" })
    await load()
  }
  async function disable() {
    setBusy(true)
    const r = await api("POST", "/api/push/ntfy/disable")
    setBusy(false)
    if (r.ok) toast("ntfy is off", { id: "settings" })
    else setError(r.error ?? "ntfy could not be switched off")
    await load()
  }
  async function test() {
    setBusy(true)
    const r = await api<{ ok: boolean; error?: string; at?: string }>("POST", "/api/push/ntfy/test")
    setBusy(false)
    if (r.ok && r.data?.ok) {
      const at = r.data.at
        ? ` at ${new Date(r.data.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
        : ""
      setError(undefined)
      setSent(
        `ntfy received the test${at}. If your phone shows nothing, the app is on a different topic or server, or its notifications are off.`,
      )
    } else setError(r.data?.error ?? r.error ?? "The test was not sent")
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
              <span className="mt-1 flex flex-wrap items-center gap-2">
                <span className="mono w-fit select-all rounded bg-s2 px-2 py-1 text-[15px]">
                  {st?.topic}
                </span>
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    void navigator.clipboard
                      ?.writeText(st?.topic ?? "")
                      .then(() => toast("Topic copied"))
                      .catch(() =>
                        toast.error("Could not copy. Select the topic and copy it instead."),
                      )
                  }
                >
                  Copy topic
                </button>
              </span>
              <span className="mt-1 block text-[13px] text-mut">
                To check it, open{" "}
                <span className="mono">
                  {(st?.server ?? "https://ntfy.sh").replace(/\/$/, "")}/{st?.topic}
                </span>{" "}
                in your phone&apos;s browser: test messages show there.
              </span>
              {typing ? (
                <div className="mt-2 grid max-w-[60ch] gap-2">
                  <label className="grid gap-1">
                    <span>Topic on your phone</span>
                    <input
                      className="field mono"
                      value={typed}
                      onChange={(e) => setTyped(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && typed.trim()) void enable(false, typed)
                      }}
                    />
                    <span className="text-[13px] text-mut">
                      In the ntfy app, open the subscription and copy its name (it starts with
                      jcvc-). JCVC takes only a topic it made, so nobody can guess yours.
                    </span>
                  </label>
                  {error ? (
                    <p role="alert" className="m-0 font-semibold text-sev">
                      {error}
                    </p>
                  ) : null}
                  <span className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy || !typed.trim()}
                      onClick={() => void enable(false, typed)}
                    >
                      Use this topic
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setTyping(false)
                        setError(undefined)
                      }}
                    >
                      Cancel
                    </button>
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  className="mt-1 block cursor-pointer border-0 bg-transparent p-0 text-acc underline"
                  onClick={() => setTyping(true)}
                >
                  My phone has a different topic
                </button>
              )}
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
            Sent {st?.sent ?? 0} request notification{st?.sent === 1 ? "" : "s"} this run.
          </p>
          {sent ? (
            <p className="m-0 text-[13px]" aria-live="polite">
              {sent}
            </p>
          ) : null}
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
      {confirmNew ? (
        <div
          role="group"
          aria-label="Make new topics"
          className="grid gap-2 rounded border border-line p-3"
        >
          <p className="m-0 max-w-[72ch]">
            Requests stop reaching your phone until you subscribe to the new topic in the ntfy app.
            Make new topics only if this one got out.
          </p>
          <span className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                setConfirmNew(false)
                void enable(true)
              }}
            >
              Replace the topic
            </button>
            <button
              type="button"
              className="btn btn-primary"
              autoFocus
              onClick={() => setConfirmNew(false)}
            >
              Keep this topic
            </button>
          </span>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2" hidden={confirmNew}>
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
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => setConfirmNew(true)}
            >
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
      {error && !typing ? (
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
