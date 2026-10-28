import { useEffect, useState } from "react"
import { JcvcPicker } from "../components/JcvcPicker"
import { toast } from "sonner"
import { api } from "../lib/api"
import { useStore } from "../store"

interface Config {
  redactTerms: string[]
  expectedOrg?: string
  workspaceRoots?: string[]
  digestTime?: string | null
  quietHours?: { start: string; end: string; tz: string; phone?: boolean }
  phoneExpiryMs: number
  hardTimeoutMs: number
  checkpoints: { beforeEscalation: boolean; editBursts: boolean; burstWindowMs: number }
  rulesPath?: string
}
interface SettingsData {
  path: string
  saved: Partial<Config>
  running: Config
  workspaceRootsInEffect: string[]
  quietHoursInPolicy: { start: string; end: string; tz: string; phone?: boolean } | null
}

const lines = (t: string) =>
  t
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)

export function Settings() {
  const [data, setData] = useState<SettingsData>()
  const [error, setError] = useState<string>()
  const [errors, setErrors] = useState<string[]>()
  const [busy, setBusy] = useState(false)
  const [restart, setRestart] = useState(false)

  const [org, setOrg] = useState("")
  const [roots, setRoots] = useState("")
  const [quiet, setQuiet] = useState(false)
  const [qStart, setQStart] = useState("22:00")
  const [qEnd, setQEnd] = useState("07:00")
  const [qTz, setQTz] = useState("Europe/London")
  const [qPhone, setQPhone] = useState(false)
  const [phoneMin, setPhoneMin] = useState(10)
  const [hardMin, setHardMin] = useState(30)
  const [digestOn, setDigestOn] = useState(true)
  const [digestAt, setDigestAt] = useState("08:00")
  const [terms, setTerms] = useState("")
  const [cpEsc, setCpEsc] = useState(true)
  const [cpBurst, setCpBurst] = useState(true)

  const notify = useStore((s) => s.notify)
  const jcMode = useStore((s) => s.jcMode)
  const setJcMode = useStore((s) => s.setJcMode)
  const setNotify = useStore((s) => s.setNotify)

  useEffect(() => {
    void (async () => {
      const r = await api<SettingsData>("GET", "/api/settings")
      if (!r.ok || !r.data) return setError(r.error ?? "Settings could not be read")
      const d = r.data
      setData(d)
      const c = { ...d.running, ...d.saved } as Config
      setOrg(c.expectedOrg ?? "")
      setRoots((d.saved.workspaceRoots ?? []).join("\n"))
      const q = d.saved.quietHours ?? d.quietHoursInPolicy
      setQuiet(Boolean(q))
      if (q) {
        setQStart(q.start)
        setQEnd(q.end)
        setQTz(q.tz)
        setQPhone(q.phone === true)
      }
      setPhoneMin(Math.round(c.phoneExpiryMs / 60_000))
      setHardMin(Math.round(c.hardTimeoutMs / 60_000))
      setDigestOn(c.digestTime !== null)
      setDigestAt(c.digestTime ?? "08:00")
      setTerms(c.redactTerms.join("\n"))
      setCpEsc(c.checkpoints.beforeEscalation)
      setCpBurst(c.checkpoints.editBursts)
    })()
  }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!data) return
    setBusy(true)
    setErrors(undefined)
    const body: Record<string, unknown> = {
      ...data.saved,
      redactTerms: lines(terms),
      phoneExpiryMs: Math.round(phoneMin * 60_000),
      hardTimeoutMs: Math.round(hardMin * 60_000),
      checkpoints: { ...data.running.checkpoints, beforeEscalation: cpEsc, editBursts: cpBurst },
    }
    if (org.trim()) body.expectedOrg = org.trim()
    else delete body.expectedOrg
    const rl = lines(roots)
    if (rl.length) body.workspaceRoots = rl
    else delete body.workspaceRoots
    body.digestTime = digestOn ? digestAt : null
    if (quiet) body.quietHours = { start: qStart, end: qEnd, tz: qTz, phone: qPhone }
    else delete body.quietHours
    const r = await api<{ restartRequired: boolean }>("PUT", "/api/settings", body)
    setBusy(false)
    if (!r.ok) return setErrors(r.errors ?? [r.error ?? "The settings were not saved"])
    setRestart(r.data?.restartRequired === true)
    toast("Settings saved")
  }

  if (error)
    return (
      <p role="alert" className="p-6 font-semibold text-sev">
        {error}
      </p>
    )
  if (!data) return <p className="p-6 text-mut">Loading…</p>

  return (
    <form onSubmit={save} className="mx-auto grid max-w-[760px] gap-6 p-6" aria-label="Settings">
      <h1 className="m-0 text-[22px] font-semibold">Settings</h1>
      {restart ? (
        <p role="status" className="panel m-0 p-3 font-semibold">
          Saved. Restart JCVC for these changes to take effect.
        </p>
      ) : null}

      <fieldset className="m-0 grid gap-3 border-0 p-0">
        <legend className="mb-1 text-sm font-semibold">Organisation and workspaces</legend>
        <Field
          label="Expected organisation"
          help="Sessions refuse to start unless the signed-in account belongs to this organisation."
        >
          <input
            className="field"
            value={org}
            onChange={(e) => setOrg(e.target.value)}
            placeholder="ACN - Premium"
          />
        </Field>
        <Field
          label="Workspace roots"
          help={`One folder per line. Leave empty to use the rules file${data.workspaceRootsInEffect.length ? ` (now: ${data.workspaceRootsInEffect.join(", ")})` : ""}.`}
        >
          <textarea
            className="field mono"
            rows={3}
            value={roots}
            onChange={(e) => setRoots(e.target.value)}
            spellCheck={false}
          />
        </Field>
      </fieldset>

      <fieldset className="m-0 grid gap-3 border-0 p-0">
        <legend className="mb-1 text-sm font-semibold">Quiet hours and timeouts</legend>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={quiet} onChange={(e) => setQuiet(e.target.checked)} />
          Hold phone notifications during quiet hours
        </label>
        {quiet ? (
          <div className="grid grid-cols-3 gap-3 max-[700px]:grid-cols-1">
            <Field label="From">
              <input
                className="field"
                type="time"
                value={qStart}
                onChange={(e) => setQStart(e.target.value)}
                required
              />
            </Field>
            <Field label="Until">
              <input
                className="field"
                type="time"
                value={qEnd}
                onChange={(e) => setQEnd(e.target.value)}
                required
              />
            </Field>
            <Field label="Time zone">
              <input
                className="field"
                value={qTz}
                onChange={(e) => setQTz(e.target.value)}
                required
              />
            </Field>
            <label className="col-span-3 flex items-center gap-2 max-[700px]:col-span-1">
              <input
                type="checkbox"
                checked={qPhone}
                onChange={(e) => setQPhone(e.target.checked)}
              />
              Still tell the phone during quiet hours
            </label>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-3 max-[700px]:grid-cols-1">
          <Field label="Phone request expires after (minutes)" help="At least 1 minute.">
            <input
              className="field"
              type="number"
              min={1}
              step={1}
              value={phoneMin}
              onChange={(e) => setPhoneMin(Number(e.target.value))}
            />
          </Field>
          <Field
            label="Desktop request times out after (minutes)"
            help="An unanswered request is then denied."
          >
            <input
              className="field"
              type="number"
              min={1}
              step={1}
              value={hardMin}
              onChange={(e) => setHardMin(Number(e.target.value))}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="m-0 grid gap-2 border-0 p-0">
        <legend className="mb-1 text-sm font-semibold">Daily digest</legend>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={digestOn}
            onChange={(e) => setDigestOn(e.target.checked)}
          />
          Send a short summary of the last 24 hours to the phone each day
        </label>
        {digestOn ? (
          <Field
            label="Send it after"
            help="Local time. If the computer is asleep then, it is sent at the next check. It only goes if a phone is paired."
          >
            <input
              className="field w-40"
              type="time"
              value={digestAt}
              onChange={(e) => setDigestAt(e.target.value)}
              required
            />
          </Field>
        ) : null}
      </fieldset>

      <fieldset className="m-0 grid gap-3 border-0 p-0">
        <legend className="mb-1 text-sm font-semibold">Redaction list</legend>
        <Field
          label="Words to hide"
          help="One per line. Client names and internal host names. They are replaced before anything is saved or sent, in the audit log and to the phone."
        >
          <textarea
            className="field"
            rows={4}
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            spellCheck={false}
          />
        </Field>
      </fieldset>

      <fieldset className="m-0 grid gap-2 border-0 p-0">
        <legend className="mb-1 text-sm font-semibold">Checkpoints</legend>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={cpEsc} onChange={(e) => setCpEsc(e.target.checked)} />
          Take a checkpoint before anything that waits for your decision
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={cpBurst} onChange={(e) => setCpBurst(e.target.checked)} />
          Take a checkpoint before the first edit after a quiet spell
        </label>
      </fieldset>

      <fieldset className="m-0 grid gap-2 border-0 p-0">
        <legend className="mb-1 text-sm font-semibold">Setup</legend>
        <div>
          <button
            type="button"
            className="btn"
            onClick={() => {
              useStore.getState().setSetupDone(false)
              useStore.getState().setRoute("setup")
            }}
          >
            Run the setup wizard again
          </button>
        </div>
      </fieldset>

      <fieldset className="m-0 grid gap-2 border-0 p-0">
        <legend className="mb-1 text-sm font-semibold">Jean-Claude mode</legend>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={jcMode} onChange={(e) => setJcMode(e.target.checked)} />
          Show a faint picture in the background
        </label>
        <p className="m-0 text-xs text-mut">
          Optional. It puts a very faint picture behind the screens and changes nothing else. It
          works with the light and dark themes. The start-up picture always shows. This choice
          applies to this window only.
        </p>
        {jcMode ? <JcvcPicker /> : null}
      </fieldset>

      <fieldset className="m-0 grid gap-2 border-0 p-0">
        <legend className="mb-1 text-sm font-semibold">Notifications</legend>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={notify}
            onChange={async (e) => {
              if (
                e.target.checked &&
                typeof Notification !== "undefined" &&
                Notification.permission !== "granted"
              ) {
                const p = await Notification.requestPermission()
                if (p !== "granted") {
                  toast.error("The browser did not allow notifications.")
                  return
                }
              }
              setNotify(e.target.checked)
            }}
          />
          Show a browser notification when a decision is waiting
        </label>
        <p className="m-0 text-xs text-mut">
          The notification never shows the command or file names. This choice applies to this
          browser only.
        </p>
      </fieldset>

      {errors?.length ? (
        <ul role="alert" className="m-0 font-semibold text-sev">
          {errors.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center gap-3">
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Saving…" : "Save settings"}
        </button>
        <span className="text-xs text-mut">
          Stored in <span className="mono">{data.path}</span>
        </span>
      </div>
    </form>
  )
}

function Field({
  label,
  help,
  children,
}: {
  label: string
  help?: string
  children: React.ReactNode
}) {
  return (
    <label className="grid gap-1">
      <span>{label}</span>
      {children}
      {help ? <span className="text-xs text-mut">{help}</span> : null}
    </label>
  )
}
