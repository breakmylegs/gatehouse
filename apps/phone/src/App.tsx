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
  loadSessions,
  register,
  sendToSession,
  signAnchor,
  startTemplate,
  stillHere,
  unlock,
  type PendingItem,
  type Session,
} from "./core"
import { describeActivity, type Activity } from "@gatehouse/shared/activity"
import type { PhoneActivity, PhoneSessions } from "@gatehouse/shared/phone-protocol"
import { storage, type DeviceInfo, type KeyMaterial, type Settings } from "./storage"
import { Icon, TabBar, type Tab } from "./TabBar" // Mac fork: Liquid Glass

type Route =
  | { name: "home" }
  | { name: "detail"; id: string }
  | { name: "settings" }
  | { name: "sessions"; open?: string }

const bandOf = (r: number) => (r >= 85 ? "Severe" : r >= 70 ? "High" : r >= 40 ? "Moderate" : "Low")
/** The Stitch risk shapes, as on the desktop: a diamond, a triangle, a hexagon and a solid square. */
const SHAPE: Record<string, string> = {
  Low: "M8 1.8 14.2 8 8 14.2 1.8 8z",
  Moderate: "M8 2 14.5 13.8H1.5z",
  High: "M4.6 2h6.8L15 8l-3.6 6H4.6L1 8z",
  Severe: "M2.5 2.5h11v11h-11z",
}

function Risk({ risk, className }: { risk: number; className?: string }) {
  const band = bandOf(risk)
  return (
    <span className={clsx("risk-badge", `risk-${band.toLowerCase()}`, className)}>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path
          d={SHAPE[band]}
          fill={band === "Severe" ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
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

  if (device === undefined) return <Frame title="Codehouse">{null}</Frame>

  if (!isStandalone() && !browserOk)
    return (
      <Frame title="Add Codehouse to your Home Screen">
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
      <Frame title="Codehouse">
        <div className="grid gap-4 p-5">
          <p className="m-0">Locked. Use Face ID to see what is waiting for you.</p>
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

  // Mac fork: the tab bar of the three screens you move between, with how many requests wait on you.
  const bar = (active: Tab) => (
    <TabBar
      active={active}
      waiting={items.filter((i) => !i.resolved).length}
      go={(t) =>
        setRoute(t === "home" ? { name: "home" } : t === "settings" ? { name: "settings" } : { name: "sessions" })
      }
    />
  )

  if (route.name === "settings")
    return (
      <Frame title="Settings" bar={bar("settings")}>
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

  if (route.name === "sessions")
    return (
      <SessionsScreen
        session={session}
        keys={keys}
        device={device}
        open={route.open}
        go={(open) => setRoute(open === null ? { name: "home" } : { name: "sessions", ...(open ? { open } : {}) })}
        bar={bar("sessions")}
      />
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
    <Frame title="Waiting on you" bar={bar("home")}>
      <div className="grid gap-4 p-4">
        {error ? (
          <p role="alert" className="m-0 font-semibold text-sev">
            {error}
          </p>
        ) : null}
        {waiting.length === 0 ? (
          <div className="panel p-5">
            <h2 className="m-0 text-[22px] font-semibold">All clear</h2>
            <p className="m-0 mt-1 text-mut">
              Nothing needs a decision. You will get a notification when something does.
            </p>
          </div>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0" aria-label="Waiting requests">
            {waiting.map((i) => (
              <li key={i.relayId}>
                <button
                  className="panel row-link grid w-full gap-1.5 p-4 text-left"
                  onClick={() => setRoute({ name: "detail", id: i.relayId })}
                >
                  <span className="font-semibold">
                    {i.opened ? title(i.opened.payload.kind, i.opened.payload.toolName) : "Request"}
                  </span>
                  <span className="truncate text-[15px] text-mut">
                    {i.opened?.payload.project ?? ""}
                  </span>
                  {i.opened ? (
                    <Risk risk={i.opened.payload.verdict.risk} className="justify-self-start" />
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
            <h2 className="m-0 mb-1 text-[17px] font-semibold text-mut">Just decided</h2>
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

// Mac fork: Liquid Glass (glass.css). The content scrolls under the header and, on the three screens you move between,
// under the tab bar; a screen opened from one of them has the glass back button instead.
function Frame({
  title,
  back,
  action,
  bar,
  children,
}: {
  title: string
  back?: () => void
  action?: React.ReactNode
  bar?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="frame mx-auto h-full max-w-[560px]" data-bar={bar ? "" : undefined}>
      <main className="frame-main">{children}</main>
      <header className="frame-head safe-top flex gap-3 px-4 pb-2">
        {back ? (
          <button className="back glass" onClick={back} aria-label="Back to the list">
            <Icon name="back" />
          </button>
        ) : null}
        <h1
          className={clsx(
            "m-0 min-w-0 flex-1 truncate",
            back ? "inline-title self-center" : "large-title",
          )}
        >
          {title}
        </h1>
        {action}
      </header>
      {bar}
    </div>
  )
}

function InstallGuide({ ios, onSkip }: { ios: boolean; onSkip: () => void }) {
  return (
    <div className="grid gap-4 p-5">
      <p className="m-0">
        An iPhone only allows notifications for apps on the Home Screen, so add Codehouse there
        first.
      </p>
      {ios ? (
        <ol className="m-0 grid gap-2 pl-5">
          <li>Tap the Share button at the bottom of Safari.</li>
          <li>
            Scroll down and tap <strong>Add to Home Screen</strong>.
          </li>
          <li>
            Tap <strong>Add</strong>, then open Codehouse from your Home Screen.
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
        On your computer, open Codehouse, go to Devices and choose Show a pairing code. Type it
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
          <h2 className="m-0 text-[22px] font-semibold">
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
          {o.payload.effects ? (
            <>
              <dt className="text-mut">Effects</dt>
              <dd className="m-0 grid gap-0.5" aria-label="What it would delete or throw away">
                <span className={o.payload.effects.reversible ? undefined : "font-semibold"}>
                  {o.payload.effects.kind === "discard"
                    ? `Throws away work not committed in ${o.payload.effects.count}${o.payload.effects.more ? " or more" : ""} files`
                    : `Deletes ${o.payload.effects.count}${o.payload.effects.more ? " or more" : ""} ${o.payload.effects.count === 1 && !o.payload.effects.more ? "file" : "files"}`}
                </span>
                {o.payload.effects.paths.length ? (
                  <span className="mono text-[14px] [overflow-wrap:anywhere]">
                    {o.payload.effects.paths.join(", ")}
                    {o.payload.effects.more ||
                    o.payload.effects.count > o.payload.effects.paths.length
                      ? ", and more"
                      : ""}
                  </span>
                ) : null}
                <span className={o.payload.effects.reversible ? "text-mut" : "text-sev"}>
                  {o.payload.effects.undo}
                </span>
              </dd>
            </>
          ) : null}
          {o.payload.verdict.expanded?.length || o.payload.verdict.unknownEffects?.length ? (
            <>
              {/* D-013: what it would also run. */}
              <dt className="text-mut">Also runs</dt>
              <dd className="m-0 grid gap-1" aria-label="What this would also run">
                {(o.payload.verdict.expanded ?? []).map((e, i) => (
                  <span key={i} className="grid">
                    <span className="text-[14px] text-mut">{e.from}</span>
                    <code className="mono text-[14px] [overflow-wrap:anywhere]">{e.line}</code>
                  </span>
                ))}
                {(o.payload.verdict.unknownEffects ?? []).map((u, i) => (
                  <span key={`u${i}`} className="font-semibold">
                    Unknown effects: {u}
                  </span>
                ))}
              </dd>
            </>
          ) : null}
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

      <div className="action-bar glass grid gap-3">{/* Mac fork: pinned, in glass */}
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
            {o.payload.verdict.risk >= SEVERE_RISK ? (
              <HoldToAllow
                busy={busy}
                onAllow={() => void send({ decision: "allow", ...(message ? { message } : {}) })}
              />
            ) : (
              <button
                className="btn btn-strong"
                disabled={busy}
                onClick={() => void send({ decision: "allow", ...(message ? { message } : {}) })}
              >
                {busy ? "Waiting for Face ID…" : "Allow with Face ID"}
              </button>
            )}
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

const STATE_WORDS: Record<string, string> = {
  starting: "Starting",
  idle: "Ready",
  running: "Working",
  waiting: "Needs you",
  error: "Stopped with an error",
  paused: "Paused",
}

/** How often the sessions are fetched while the screen is in front of you, and when a snapshot counts as old. */
const SESSIONS_EVERY_MS = 3_000
const OLD_AFTER_MS = 90_000

type PhoneSession = PhoneSessions["sessions"][number]

/** The desktop's live line, from what the computer shared: "Running a shell command (npm test)", "12 s". */
function liveLine(a: PhoneActivity, now: number): { label: string; detail: string } {
  const since = Date.parse(a.since)
  const base = { since: Number.isFinite(since) ? Math.min(since, now) : now }
  const act: Activity =
    a.phase === "preparing"
      ? { phase: "preparing", ...base, tool: a.tool ?? "a tool", chars: a.chars ?? 0, head: "", ...(a.target ? { target: a.target } : {}) }
      : a.phase === "running"
        ? { phase: "running", ...base, tool: a.tool ?? "a tool", toolUseId: "", ...(a.target ? { target: a.target } : {}) }
        : { phase: a.phase as "sent" | "thinking" | "replying", ...base }
  const { label, detail } = describeActivity(act, now)
  return { label, detail }
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`
}

function Working() {
  return <span className="spinner" aria-hidden="true" />
}

/**
 * G32 (O18, owner 30 Oct), and the owner on 11 Nov ("a way to actually see the sessions remotely and be able to send
 * prompts and see the ongoing status of the session"): the sessions open on your computer, what each is doing now and
 * its conversation, sent end to end encrypted and opened here with this phone's key, fetched every few seconds while
 * the screen is in front of you. A message to a session, and Interrupt, are each signed with Face ID and checked and
 * recorded on the computer before they reach the session.
 */
function SessionsScreen({
  session,
  keys,
  device,
  open,
  go,
  bar,
}: {
  session: Session
  keys: KeyMaterial | undefined
  device: DeviceInfo
  open: string | undefined
  /** A session's id opens it, undefined is the list, null is the home screen. */
  go: (open: string | undefined | null) => void
  /** Mac fork: the tab bar, shown on the list. */
  bar: React.ReactNode
}) {
  const [data, setData] = useState<PhoneSessions>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string>()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!keys) return
    let gone = false
    const load = () => {
      if (document.visibilityState === "hidden") return
      loadSessions(session, keys).then(
        (d) => !gone && (setData(d), setError(undefined)),
        (e: unknown) => !gone && setError(friendly(e)),
      )
    }
    load()
    const t = setInterval(load, SESSIONS_EVERY_MS)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    document.addEventListener("visibilitychange", load)
    return () => {
      gone = true
      clearInterval(t)
      clearInterval(tick)
      document.removeEventListener("visibilitychange", load)
    }
  }, [session, keys])
  useEffect(() => setSaid(undefined), [open])
  async function act(run: () => Promise<void>, done: string): Promise<boolean> {
    setBusy(true)
    setSaid(undefined)
    try {
      await run()
      setSaid(done)
      return true
    } catch (e) {
      setSaid(friendly(e))
      return false
    } finally {
      setBusy(false)
    }
  }
  const chosen = open ? data?.sessions.find((s) => s.id === open) : undefined
  const old = data?.at && now - Date.parse(data.at) > OLD_AFTER_MS ? (
    <p role="status" className="m-0 px-4 pt-3 text-[15px] text-warn">
      Your computer last shared its sessions {ago(now - Date.parse(data.at))}. It may be asleep, or Codehouse may be
      closed.
    </p>
  ) : null
  let body: React.ReactNode
  if (error)
    body = (
      <p role="alert" className="m-0 p-5 font-semibold text-sev">
        {error}
      </p>
    )
  else if (!data) body = <p className="m-0 p-5 text-mut">Loading…</p>
  else if (open)
    body = chosen ? (
      <SessionView
        s={chosen}
        now={now}
        busy={busy}
        said={said}
        old={old}
        onSend={(text) =>
          act(
            () => sendToSession(session, device, { sessionId: chosen.id, text }),
            "Sent. It shows here once your computer checks the signature.",
          )
        }
        onInterrupt={() =>
          void act(
            () => sendToSession(session, device, { sessionId: chosen.id, interrupt: true }),
            "Sent. The session stops once your computer checks the signature.",
          )
        }
        onRequests={() => go(null)}
      />
    ) : (
      <p className="m-0 p-5 text-mut">This session is no longer open on your computer.</p>
    )
  else
    body = (
      <>
        {old}
        {/* Mac fork: the sessions first, then what you can start and the audit log. */}
        {data.sessions.length ? (
          <ul className="m-0 grid list-none gap-3 p-4" aria-label="Sessions">
            {data.sessions.map((s) => (
              <li key={s.id}>
                <button
                  className="panel row-link grid w-full gap-1 p-4 text-left text-[inherit]"
                  onClick={() => go(s.id)}
                >
                  <span className="font-semibold [overflow-wrap:anywhere]">{s.title ?? s.project}</span>
                  <StateLine s={s} now={now} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 p-5 text-mut">
            No sessions to show yet. They appear here a moment after your computer shares them.
          </p>
        )}
        {data.templates?.length ? (
          <section aria-label="Start" className="grid gap-2 px-4 pt-4">
            <h2 className="m-0 text-[17px] font-semibold">Start</h2>
            {data.templates.map((t) => (
              <button
                key={t.id}
                className="btn justify-self-start"
                disabled={busy}
                aria-label={`Start ${t.name} with Face ID`}
                onClick={() =>
                  void act(() => startTemplate(session, device, t.id), `${t.name} starts once your computer checks the signature.`)
                }
              >
                {t.name}
              </button>
            ))}
          </section>
        ) : null}
        {said ? (
          <p role="status" className="m-0 px-4 pt-2 text-[15px]">
            {said}
          </p>
        ) : null}
        {data.auditHead ? (
          <section aria-label="Audit log" className="grid gap-2 px-4 pt-4">
            <h2 className="m-0 text-[17px] font-semibold">Audit log</h2>
            <p className="m-0 text-[15px] text-mut">
              Anchor it here and no one can later rewrite what it holds up to record {data.auditHead.seq.toLocaleString("en-GB")} without it
              showing. Your computer anchors it every day itself; one from this phone, with Face ID, is stronger.
            </p>
            <button
              className="btn justify-self-start"
              disabled={busy}
              onClick={() => {
                const head = data.auditHead!
                void act(() => signAnchor(session, device, head), "Sent. Your computer keeps the anchor once it checks the signature.")
              }}
            >
              Anchor with Face ID
            </button>
          </section>
        ) : null}
      </>
    )
  return (
    // Mac fork: the list is a tab; a session opened from it has the back button.
    <Frame
      title={chosen ? (chosen.title ?? chosen.project) : "Sessions"}
      {...(open ? { back: () => go(undefined) } : { bar })}
    >
      {body}
    </Frame>
  )
}

/** How a session stands: its state, how many requests wait on you, and, while it works, what it is doing. */
function StateLine({ s, now }: { s: PhoneSession; now: number }) {
  const working = s.state === "running"
  const live = s.activity && (working || s.state === "waiting") ? liveLine(s.activity, now) : undefined
  return (
    <span className="grid gap-0.5 text-[15px] text-mut">
      <span className="flex items-center gap-2">
        {working ? <Working /> : <span className={`dot dot-${s.state}`} aria-hidden="true" />}
        <span>
          {STATE_WORDS[s.state] ?? s.state}
          {s.waiting ? `, ${s.waiting === 1 ? "1 request waits" : `${s.waiting} requests wait`} for you` : ""}
          {s.mode && MODE_WORDS[s.mode] ? `, ${MODE_WORDS[s.mode]}` : ""}
        </span>
      </span>
      {live ? (
        <span className="[overflow-wrap:anywhere] text-tx">
          {live.label}
          {live.detail ? <span className="text-mut">, {live.detail}</span> : null}
        </span>
      ) : null}
    </span>
  )
}

const MODE_WORDS: Record<string, string> = {
  default: "Manual",
  plan: "Plan",
  acceptEdits: "Accept edits",
  auto: "Auto",
  extreme: "Extreme approval",
}

/** One session: how it stands, its conversation, and a message box. New steps keep it scrolled to the end. */
function SessionView({
  s,
  now,
  busy,
  said,
  old,
  onSend,
  onInterrupt,
  onRequests,
}: {
  s: PhoneSession
  now: number
  busy: boolean
  said: string | undefined
  old: React.ReactNode
  onSend: (text: string) => Promise<boolean>
  onInterrupt: () => void
  onRequests: () => void
}) {
  const [message, setMessage] = useState("")
  const end = useRef<HTMLDivElement>(null)
  const steps = s.recent ?? []
  const last = steps.at(-1)
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" })
  }, [steps.length, last?.text])
  return (
    <div className="grid min-h-full grid-rows-[auto_1fr_auto]">
      <section aria-label="Status" className="grid gap-2 border-b border-line px-4 py-3">
        <StateLine s={s} now={now} />
        {s.waiting ? (
          <button className="btn justify-self-start" onClick={onRequests}>
            {s.waiting === 1 ? "Answer the request" : `Answer ${s.waiting} requests`}
          </button>
        ) : null}
      </section>
      <div className="min-h-0">
        {old}
        {steps.length ? (
          <ol className="m-0 grid list-none gap-3 p-4" aria-label="Conversation">
            {steps.map((e, i) => (
              <li
                key={i}
                className={clsx(
                  "[overflow-wrap:anywhere] whitespace-pre-wrap",
                  e.who === "you" && "ml-8 justify-self-end rounded-lg bg-s2 px-3 py-2",
                  e.who === "tool" && "font-code text-[14px] text-mut",
                )}
              >
                <span className="sr-only">{e.who === "you" ? "You: " : e.who === "claude" ? "Claude: " : "Tool: "}</span>
                {e.text}
              </li>
            ))}
          </ol>
        ) : s.latest ? (
          <pre className="m-0 whitespace-pre-wrap p-4 text-[14px] [overflow-wrap:anywhere]">{s.latest}</pre>
        ) : (
          <p className="m-0 p-4 text-[15px] text-mut">Nothing has been said in it yet.</p>
        )}
        <div ref={end} />
      </div>
      <form
        className="action-bar glass grid gap-2" // Mac fork: in glass
        onSubmit={(e) => {
          e.preventDefault()
          if (!message.trim()) return
          void onSend(message).then((ok) => ok && setMessage(""))
        }}
      >
        <label className="grid gap-1">
          <span className="font-semibold">Message to this session</span>
          <textarea
            className="field"
            rows={2}
            maxLength={4000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
        {/* Mac fork: Send takes the room it needs on one line. */}
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <button type="submit" className="btn btn-primary" disabled={busy || !message.trim()}>
            {busy ? "Waiting for Face ID…" : "Send with Face ID"}
          </button>
          {s.state === "running" || s.state === "waiting" ? (
            <button type="button" className="btn" disabled={busy} onClick={onInterrupt}>
              Interrupt…
            </button>
          ) : null}
        </div>
        {said ? (
          <p role="status" className="m-0 text-[15px]">
            {said}
          </p>
        ) : null}
      </form>
    </div>
  )
}

/** U4: Severe, from risk 85; on the phone its Allow is held, not tapped. */
const SEVERE_RISK = 85
const HOLD_MS = 1500

/**
 * U4 (C2, decided 9 Nov): a Severe request is allowed on the phone by pressing and holding for a moment, then letting
 * go, and then Face ID. A tap does nothing. The answer is sent from the release itself, which is what lets Face ID
 * ask: Safari only asks for a passkey from a person's own gesture.
 */
function HoldToAllow({ busy, onAllow }: { busy: boolean; onAllow: () => void }) {
  const since = useRef<number | undefined>(undefined)
  const [holding, setHolding] = useState(false)
  const [short, setShort] = useState(false)
  return (
    <>
      <button
        className="btn btn-strong hold-to-allow"
        disabled={busy}
        data-holding={holding ? "" : undefined}
        onPointerDown={() => {
          since.current = Date.now()
          setHolding(true)
          setShort(false)
        }}
        onPointerCancel={() => {
          since.current = undefined
          setHolding(false)
        }}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => {
          const held = since.current !== undefined && Date.now() - since.current >= HOLD_MS
          since.current = undefined
          setHolding(false)
          if (held) onAllow()
          else setShort(true)
        }}
      >
        {busy
          ? "Waiting for Face ID…"
          : holding
            ? "Keep holding, then let go"
            : "Hold to allow with Face ID"}
      </button>
      {short ? (
        <p role="status" className="m-0 text-[15px]">
          This is Severe: press and hold for a moment, then let go.
        </p>
      ) : null}
    </>
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
        <h2 className="m-0 text-[22px] font-semibold">Notifications</h2>
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

      <section className="grid gap-2" aria-label="Still here">
        <h2 className="m-0 text-[22px] font-semibold">Still here</h2>
        <p className="m-0 text-mut">
          A session with a dead-man timer pauses if Codehouse hears nothing from you in time. Anything you do here counts;
          so does this.
        </p>
        <button
          className="btn"
          disabled={busy}
          onClick={() => void run(async () => stillHere(session, device), "Codehouse knows you are there.")}
        >
          {busy ? "Waiting for Face ID…" : "I'm still here"}
        </button>
      </section>

      <section className="grid gap-2" aria-label="Kill switch">
        <h2 className="m-0 text-[22px] font-semibold">Kill switch</h2>
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
        <h2 className="m-0 text-[22px] font-semibold">This phone</h2>
        <p className="m-0 text-mut">
          Paired as {device.name}. To stop it answering, revoke it in Codehouse on your computer.
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
