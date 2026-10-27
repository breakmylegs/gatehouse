import clsx from "clsx"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { splitByHighlights } from "@gatehouse/shared/highlight"
import {
  answer,
  awaitConfirmation,
  enableNotifications,
  isIos,
  isStandalone,
  kill,
  loadPending,
  register,
  unlock,
  type PendingItem,
  type Session,
} from "./core"
import { storage, type DeviceInfo, type KeyMaterial, type Settings } from "./storage"

type Route = { name: "home" } | { name: "detail"; id: string } | { name: "settings" }

const bandOf = (r: number) => (r >= 85 ? "Severe" : r >= 70 ? "High" : r >= 40 ? "Moderate" : "Low")
const SHAPE: Record<string, string> = {
  Low: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2z",
  Moderate: "M8 1.5 14.5 8 8 14.5 1.5 8z",
  High: "M8 1.5 15 14H1z",
  Severe: "M5 1.5h6L14.5 5v6L11 14.5H5L1.5 11V5z",
}

function Risk({ risk }: { risk: number }) {
  const band = bandOf(risk)
  const hot = band === "High" || band === "Severe"
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border border-current py-0.5 pl-2 pr-3 text-[15px] font-semibold",
        band === "Low" ? "text-ok" : band === "Moderate" ? "text-warn" : "text-sev",
        band === "Severe" && "bg-sev !text-bg",
      )}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path
          d={SHAPE[band]}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        {hot ? (
          <path d="M8 6v4M8 12v.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        ) : null}
      </svg>
      {band} risk {risk}
    </span>
  )
}

export function App() {
  const [device, setDevice] = useState<DeviceInfo | null | undefined>(undefined)
  const [keys, setKeys] = useState<KeyMaterial>()
  const [settings, setSettings] = useState<Settings>({ lockScreenDetail: false })
  const [session, setSession] = useState<Session>()
  const [items, setItems] = useState<PendingItem[]>([])
  const [route, setRoute] = useState<Route>({ name: "home" })
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [browserOk, setBrowserOk] = useState(false)

  useEffect(() => {
    void (async () => {
      setDevice((await storage.device()) ?? null)
      setKeys(await storage.keys())
      setSettings(await storage.settings())
    })()
  }, [])

  // A notification opens the app at #/r/<id>. The hash is only read here, never used to hold anything private.
  useEffect(() => {
    const read = () => {
      const m = /^#\/r\/(.+)$/.exec(location.hash)
      if (m?.[1]) setRoute({ name: "detail", id: decodeURIComponent(m[1]) })
    }
    read()
    addEventListener("hashchange", read)
    return () => removeEventListener("hashchange", read)
  }, [])

  const refresh = useCallback(async () => {
    if (!session || !keys) return
    try {
      setItems(await loadPending(session, keys))
      setError(undefined)
    } catch (e) {
      const status = (e as { status?: number }).status
      if (status === 401) setSession(undefined)
      else setError((e as Error).message)
    }
  }, [session, keys])

  useEffect(() => {
    if (!session) return
    void refresh()
    const t = setInterval(() => void refresh(), 5000)
    const out = setTimeout(() => setSession(undefined), Math.max(0, session.expiresAt - Date.now()))
    const vis = () => document.visibilityState === "visible" && void refresh()
    document.addEventListener("visibilitychange", vis)
    const bc = new BroadcastChannel("gatehouse")
    bc.onmessage = () => void refresh()
    return () => {
      clearInterval(t)
      clearTimeout(out)
      document.removeEventListener("visibilitychange", vis)
      bc.close()
    }
  }, [session, refresh])

  async function doUnlock() {
    if (!device) return
    setBusy(true)
    setError(undefined)
    try {
      setSession(await unlock(device))
    } catch (e) {
      setError(friendly(e))
    } finally {
      setBusy(false)
    }
  }

  if (device === undefined) return <Frame title="Gatehouse">{null}</Frame>

  if (!isStandalone() && !browserOk)
    return (
      <Frame title="Add Gatehouse to your Home Screen">
        <InstallGuide ios={isIos()} onSkip={() => setBrowserOk(true)} />
      </Frame>
    )

  if (!device)
    return (
      <Frame title="Pair this phone">
        <Pair
          onPaired={async (d) => {
            setDevice(d)
            setKeys(await storage.keys())
          }}
        />
      </Frame>
    )

  if (!session)
    return (
      <Frame title="Gatehouse">
        <div className="grid gap-4 p-5">
          <p className="m-0">
            Locked. Use Face ID to see what is waiting for you on <strong>{device.name}</strong>'s
            desktop.
          </p>
          {error ? (
            <p role="alert" className="m-0 font-semibold text-sev">
              {error}
            </p>
          ) : null}
          <button className="btn btn-primary" disabled={busy} onClick={() => void doUnlock()}>
            {busy ? "Waiting for Face ID…" : "Unlock with Face ID"}
          </button>
        </div>
      </Frame>
    )

  if (route.name === "settings")
    return (
      <Frame title="Settings" back={() => setRoute({ name: "home" })}>
        <SettingsScreen
          device={device}
          session={session}
          settings={settings}
          onSettings={async (s) => {
            setSettings(s)
            await storage.setSettings(s)
          }}
          onForget={async () => {
            await storage.forget()
            setDevice(null)
            setKeys(undefined)
            setSession(undefined)
          }}
        />
      </Frame>
    )

  if (route.name === "detail") {
    const item = items.find((i) => i.relayId === route.id)
    return (
      <Frame
        title="Request"
        back={() => {
          history.replaceState(null, "", location.pathname)
          setRoute({ name: "home" })
        }}
      >
        {item ? (
          <Detail
            key={item.relayId}
            item={item}
            session={session}
            device={device}
            onDone={refresh}
          />
        ) : (
          <p className="p-5">
            {items.length === 0 && !error
              ? "Loading…"
              : "This request is no longer waiting. It was answered on another screen or it expired."}
          </p>
        )}
      </Frame>
    )
  }

  const waiting = items.filter((i) => !i.resolved)
  const done = items.filter((i) => i.resolved)
  return (
    <Frame
      title="Waiting on you"
      action={
        <button className="btn !min-h-11 !px-4" onClick={() => setRoute({ name: "settings" })}>
          Settings
        </button>
      }
    >
      <div className="grid gap-4 p-4">
        {error ? (
          <p role="alert" className="m-0 font-semibold text-sev">
            {error}
          </p>
        ) : null}
        {waiting.length === 0 ? (
          <div className="panel p-5">
            <h2 className="m-0 text-[19px] font-semibold">All clear</h2>
            <p className="m-0 mt-1 text-mut">
              Nothing needs a decision. You will get a notification when something does.
            </p>
          </div>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0" aria-label="Waiting requests">
            {waiting.map((i) => (
              <li key={i.relayId}>
                <button
                  className="panel grid w-full gap-1.5 p-4 text-left"
                  onClick={() => setRoute({ name: "detail", id: i.relayId })}
                >
                  <span className="font-semibold">
                    {i.opened ? title(i.opened.payload.kind, i.opened.payload.toolName) : "Request"}
                  </span>
                  <span className="truncate text-[15px] text-mut">
                    {i.opened?.payload.project ?? ""}
                  </span>
                  {i.opened ? (
                    <Risk risk={i.opened.payload.verdict.risk} />
                  ) : (
                    <span className="text-sev">Cannot be opened</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        {done.length > 0 ? (
          <section aria-label="Just decided">
            <h2 className="m-0 mb-1 text-[15px] font-semibold text-mut">Just decided</h2>
            <ul className="m-0 list-none p-0 text-[15px] text-mut">
              {done.map((i) => (
                <li key={i.relayId} className="py-0.5">
                  {i.opened?.payload.project ?? "Request"}: {i.resolved?.summary}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Frame>
  )
}

const title = (kind: string, tool: string) =>
  kind === "question"
    ? "Question from Claude"
    : kind === "plan"
      ? "Plan to approve"
      : tool === "Bash" || tool === "PowerShell"
        ? "Run shell command"
        : tool

function friendly(e: unknown): string {
  const m = (e as Error).message ?? "Something went wrong"
  if ((e as Error).name === "NotAllowedError")
    return "Face ID was cancelled or did not match. Nothing was sent."
  return m
}

function Frame({
  title,
  back,
  action,
  children,
}: {
  title: string
  back?: () => void
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="mx-auto grid h-full max-w-[560px] grid-rows-[auto_1fr]">
      <header className="safe-top flex items-center gap-3 border-b border-line bg-s1 px-4 pb-3">
        {back ? (
          <button className="btn !min-h-11 !px-4" onClick={back} aria-label="Back to the list">
            Back
          </button>
        ) : null}
        <h1 className="m-0 min-w-0 flex-1 truncate text-[20px] font-semibold">{title}</h1>
        {action}
      </header>
      <main className="min-h-0 overflow-auto">{children}</main>
    </div>
  )
}

function InstallGuide({ ios, onSkip }: { ios: boolean; onSkip: () => void }) {
  return (
    <div className="grid gap-4 p-5">
      <p className="m-0">
        An iPhone only allows notifications for apps on the Home Screen, so add Gatehouse there
        first.
      </p>
      {ios ? (
        <ol className="m-0 grid gap-2 pl-5">
          <li>Tap the Share button at the bottom of Safari.</li>
          <li>
            Scroll down and tap <strong>Add to Home Screen</strong>.
          </li>
          <li>
            Tap <strong>Add</strong>, then open Gatehouse from your Home Screen.
          </li>
        </ol>
      ) : (
        <p className="m-0">
          Use your browser's menu to install this app, then open it from your Home Screen.
        </p>
      )}
      <button className="btn" onClick={onSkip}>
        Continue in the browser anyway
      </button>
      <p className="m-0 text-[15px] text-mut">
        Without the Home Screen app you will not get notifications.
      </p>
    </div>
  )
}

function Pair({ onPaired }: { onPaired: (d: DeviceInfo) => Promise<void> }) {
  const [code, setCode] = useState("")
  const [name, setName] = useState("iPhone")
  const [step, setStep] = useState<"code" | "waiting">("code")
  const [fp, setFp] = useState("")
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const abort = useRef<AbortController>(undefined)
  useEffect(() => () => abort.current?.abort(), [])

  async function go(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const p = await register(code, name.trim() || "iPhone", true)
      setFp(p.fingerprint)
      setStep("waiting")
      abort.current = new AbortController()
      onPaired(await awaitConfirmation(p.pairingId, p.code, abort.current.signal)).catch(
        () => undefined,
      )
    } catch (err) {
      setError(friendly(err))
    } finally {
      setBusy(false)
    }
  }

  if (step === "waiting")
    return (
      <div className="grid gap-4 p-5">
        <p className="m-0">Check that your computer shows these six digits, then confirm there.</p>
        <p
          className="mono m-0 text-[40px] font-semibold tracking-[0.2em]"
          aria-label={`Fingerprint ${fp.split("").join(" ")}`}
        >
          {fp}
        </p>
        <p role="status" className="m-0 text-mut">
          Waiting for the computer to confirm…
        </p>
        <p className="m-0 text-[15px] text-mut">
          If the digits are different, close this app and do not confirm. Someone else may be
          answering the pairing.
        </p>
      </div>
    )

  return (
    <form onSubmit={go} className="grid gap-4 p-5" aria-label="Pair this phone">
      <p className="m-0">
        On your computer, open Gatehouse, go to Devices and choose Show a pairing code. Type it
        here.
      </p>
      <label className="grid gap-1">
        <span className="font-semibold">Pairing code</span>
        <input
          className="field mono uppercase tracking-[0.15em]"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={8}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          autoComplete="off"
          required
        />
      </label>
      <label className="grid gap-1">
        <span className="font-semibold">Name for this phone</span>
        <input
          className="field"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          required
        />
      </label>
      <p className="m-0 text-[15px] text-mut">
        Next, your phone asks to create a passkey with Face ID, then to allow notifications.
      </p>
      {error ? (
        <p role="alert" className="m-0 font-semibold text-sev">
          {error}
        </p>
      ) : null}
      <button className="btn btn-primary" disabled={busy || code.trim().length !== 8}>
        {busy ? "Working…" : "Pair"}
      </button>
    </form>
  )
}

function Detail({
  item,
  session,
  device,
  onDone,
}: {
  item: PendingItem
  session: Session
  device: DeviceInfo
  onDone: () => Promise<void>
}) {
  const o = item.opened
  const [confirmAllow, setConfirmAllow] = useState(false)
  const [messaging, setMessaging] = useState(false)
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [sent, setSent] = useState(false)
  const [picked, setPicked] = useState<Record<string, string>>({})

  const input = (o?.payload.input ?? {}) as Record<string, unknown>
  const command =
    typeof input.command === "string"
      ? input.command
      : o?.oversize
        ? ""
        : JSON.stringify(input, null, 2)
  const segs = useMemo(
    () =>
      (o?.payload.verdict.segments ?? []).filter((s) => s.outcome !== "allow").map((s) => s.text),
    [o],
  )
  const parts = useMemo(() => splitByHighlights(command, segs), [command, segs])

  async function send(what: Parameters<typeof answer>[3]) {
    setBusy(true)
    setError(undefined)
    try {
      await answer(session, device, item, what)
      setSent(true)
      setConfirmAllow(false)
      void onDone()
    } catch (e) {
      setError(friendly(e))
    } finally {
      setBusy(false)
    }
  }

  if (!o || item.error)
    return (
      <p role="alert" className="p-5 font-semibold text-sev">
        {item.error ?? "This request cannot be shown."}
      </p>
    )

  const questions = (Array.isArray(input.questions) ? input.questions : []) as Array<{
    question: string
    options?: Array<{ label: string; description?: string }>
  }>
  const resolved = item.resolved

  return (
    <div className="grid min-h-full grid-rows-[1fr_auto]">
      <div className="grid content-start gap-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="m-0 text-[19px] font-semibold">
            {title(o.payload.kind, o.payload.toolName)}
          </h2>
          <Risk risk={o.payload.verdict.risk} />
        </div>
        <p className="m-0 text-mut">{o.payload.project}</p>

        {o.payload.kind === "question" ? (
          questions.map((q) => (
            <fieldset key={q.question} className="m-0 grid gap-2 border-0 p-0">
              <legend className="mb-1 font-semibold">{q.question}</legend>
              {(q.options ?? []).map((opt) => (
                <label key={opt.label} className="panel flex items-start gap-3 p-3">
                  <input
                    type="radio"
                    name={q.question}
                    className="mt-1 h-5 w-5"
                    checked={picked[q.question] === opt.label}
                    onChange={() => setPicked((p) => ({ ...p, [q.question]: opt.label }))}
                  />
                  <span>
                    {opt.label}
                    {opt.description ? (
                      <span className="block text-[15px] text-mut">{opt.description}</span>
                    ) : null}
                  </span>
                </label>
              ))}
            </fieldset>
          ))
        ) : o.oversize ? (
          <div className="panel p-4">
            <p className="m-0 font-semibold">Too long to show on the phone</p>
            <p className="m-0 mt-1">
              This is about {o.oversize.characters.toLocaleString("en-GB")} characters. You can deny
              it here, or decide on your computer.
            </p>
          </div>
        ) : (
          <pre className="cmd" aria-label="What will run">
            {parts.map((p, i) =>
              p.hit ? (
                <mark key={i} className="seg">
                  {p.text}
                </mark>
              ) : (
                <span key={i}>{p.text}</span>
              ),
            )}
          </pre>
        )}
        {segs.length > 0 && !o.oversize && o.payload.kind !== "question" ? (
          <p className="m-0 text-[15px] text-mut">
            Underlined: the part that caused the escalation.
          </p>
        ) : null}

        <dl className="m-0 grid grid-cols-[72px_1fr] gap-x-3 gap-y-1">
          <dt className="text-mut">Where</dt>
          <dd className="m-0 mono text-[15px] [overflow-wrap:anywhere]">{o.payload.cwd}</dd>
          <dt className="text-mut">Rule</dt>
          <dd className="m-0 mono text-[15px]">{o.payload.verdict.ruleId}</dd>
          <dt className="text-mut">Why</dt>
          <dd className="m-0">{o.payload.verdict.reason}</dd>
        </dl>

        {messaging ? (
          <label className="grid gap-1">
            <span className="font-semibold">Message to Claude</span>
            <textarea
              className="field"
              rows={3}
              maxLength={500}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
        ) : null}
        {error ? (
          <p role="alert" className="m-0 font-semibold text-sev">
            {error}
          </p>
        ) : null}
      </div>

      <div className="safe-bottom grid gap-3 border-t border-line bg-s1 px-4 pt-3">
        <div role="status" aria-live="polite" className="font-semibold empty:hidden">
          {resolved ? resolved.summary : sent ? "Sent. Waiting for your computer to apply it." : ""}
        </div>
        {resolved || sent ? null : o.payload.kind === "question" ? (
          <>
            <button
              className="btn btn-primary"
              disabled={busy || questions.some((q) => !picked[q.question])}
              onClick={() => void send({ answers: picked })}
            >
              {busy ? "Waiting for Face ID…" : "Send answer with Face ID"}
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                void send({ decision: "deny", message: "The user declined to answer." })
              }
            >
              Decline
            </button>
          </>
        ) : confirmAllow ? (
          <div role="group" aria-label="Confirm allow" className="grid gap-2">
            <p className="m-0 font-semibold">Allow this once?</p>
            <button
              className="btn btn-strong"
              disabled={busy}
              onClick={() => void send({ decision: "allow", ...(message ? { message } : {}) })}
            >
              {busy ? "Waiting for Face ID…" : "Allow with Face ID"}
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => setConfirmAllow(false)}
              autoFocus
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void send({ decision: "deny", ...(message ? { message } : {}) })}
            >
              {busy ? "Waiting for Face ID…" : "Deny"}
            </button>
            <div className="grid grid-cols-2 gap-3">
              <button className="btn" disabled={busy} onClick={() => setMessaging((m) => !m)}>
                {messaging ? "Hide message" : "Add a message"}
              </button>
              <button
                className="btn btn-strong"
                disabled={busy || Boolean(o.oversize)}
                onClick={() => setConfirmAllow(true)}
              >
                Allow once…
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function SettingsScreen({
  device,
  session,
  settings,
  onSettings,
  onForget,
}: {
  device: DeviceInfo
  session: Session
  settings: Settings
  onSettings: (s: Settings) => Promise<void>
  onForget: () => Promise<void>
}) {
  const [confirmKill, setConfirmKill] = useState(false)
  const [confirmForget, setConfirmForget] = useState(false)
  const [msg, setMsg] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function run(fn: () => Promise<void>, ok: string) {
    setBusy(true)
    setMsg(undefined)
    try {
      await fn()
      setMsg(ok)
    } catch (e) {
      setMsg(friendly(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-5 p-4">
      <section className="grid gap-2" aria-label="Notifications">
        <h2 className="m-0 text-[19px] font-semibold">Notifications</h2>
        <button
          className="btn"
          disabled={busy}
          onClick={() => void run(() => enableNotifications(session), "Notifications are on.")}
        >
          Turn on notifications
        </button>
        <label className="panel flex items-start gap-3 p-3">
          <input
            type="checkbox"
            className="mt-1 h-5 w-5"
            checked={settings.lockScreenDetail}
            onChange={(e) => void onSettings({ ...settings, lockScreenDetail: e.target.checked })}
          />
          <span>
            Show details on the lock screen
            <span className="block text-[15px] text-mut">
              Off by default. When off, a notification only says "Approval needed". When on, it can
              show the project and the start of the command to anyone who sees your screen.
            </span>
          </span>
        </label>
      </section>

      <section className="grid gap-2" aria-label="Kill switch">
        <h2 className="m-0 text-[19px] font-semibold">Kill switch</h2>
        <p className="m-0 text-mut">
          Stops every session and denies everything waiting. Only the computer can switch it off
          again.
        </p>
        {confirmKill ? (
          <div role="group" aria-label="Confirm the kill switch" className="grid gap-2">
            <button
              className="btn btn-danger"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await kill(session, device)
                  setConfirmKill(false)
                }, "Kill switch sent. Check your computer.")
              }
            >
              {busy ? "Waiting for Face ID…" : "Stop everything with Face ID"}
            </button>
            <button className="btn" onClick={() => setConfirmKill(false)} autoFocus>
              Cancel
            </button>
          </div>
        ) : (
          <button className="btn btn-danger" onClick={() => setConfirmKill(true)}>
            Kill switch…
          </button>
        )}
      </section>

      <section className="grid gap-2" aria-label="This phone">
        <h2 className="m-0 text-[19px] font-semibold">This phone</h2>
        <p className="m-0 text-mut">
          Paired as {device.name}. To stop it answering, revoke it in Gatehouse on your computer.
        </p>
        {confirmForget ? (
          <div role="group" aria-label="Confirm forgetting this phone" className="grid gap-2">
            <p className="m-0">Forget the keys on this phone? You will need to pair again.</p>
            <button className="btn btn-danger" onClick={() => void onForget()}>
              Forget this phone
            </button>
            <button className="btn" onClick={() => setConfirmForget(false)} autoFocus>
              Keep
            </button>
          </div>
        ) : (
          <button className="btn" onClick={() => setConfirmForget(true)}>
            Forget this phone…
          </button>
        )}
      </section>
      {msg ? (
        <p role="status" className="m-0 font-semibold">
          {msg}
        </p>
      ) : null}
    </div>
  )
}
