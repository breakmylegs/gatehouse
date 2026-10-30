import { useEffect, useRef, useState } from "react"
import { JcvcPicker } from "../components/JcvcPicker"
import { UpdatesPanel } from "../components/UpdatesPanel"
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

/** What the form shows, as typed. Saved as a whole: the Host checks every field each time. */
interface Values {
  org: string
  roots: string
  quiet: boolean
  qStart: string
  qEnd: string
  qTz: string
  qPhone: boolean
  phoneMin: number
  hardMin: number
  digestOn: boolean
  digestAt: string
  terms: string
  cpEsc: boolean
  cpBurst: boolean
}

function valuesOf(d: SettingsData): Values {
  const c = { ...d.running, ...d.saved } as Config
  const q = d.saved.quietHours ?? d.quietHoursInPolicy
  return {
    org: c.expectedOrg ?? "",
    roots: (d.saved.workspaceRoots ?? []).join("\n"),
    quiet: Boolean(q),
    qStart: q?.start ?? "22:00",
    qEnd: q?.end ?? "07:00",
    qTz: q?.tz ?? "Europe/London",
    qPhone: q?.phone === true,
    phoneMin: Math.round(c.phoneExpiryMs / 60_000),
    hardMin: Math.round(c.hardTimeoutMs / 60_000),
    digestOn: c.digestTime !== null,
    digestAt: c.digestTime ?? "08:00",
    terms: c.redactTerms.join("\n"),
    cpEsc: c.checkpoints.beforeEscalation,
    cpBurst: c.checkpoints.editBursts,
  }
}

/** The settings file as the Host wants it, keeping anything this page does not show. */
function bodyOf(d: SettingsData, v: Values): Record<string, unknown> {
  const body: Record<string, unknown> = {
    ...d.saved,
    redactTerms: lines(v.terms),
    phoneExpiryMs: Math.round(v.phoneMin * 60_000),
    hardTimeoutMs: Math.round(v.hardMin * 60_000),
    checkpoints: { ...d.running.checkpoints, beforeEscalation: v.cpEsc, editBursts: v.cpBurst },
  }
  if (v.org.trim()) body.expectedOrg = v.org.trim()
  else delete body.expectedOrg
  const rl = lines(v.roots)
  if (rl.length) body.workspaceRoots = rl
  else delete body.workspaceRoots
  body.digestTime = v.digestOn ? v.digestAt : null
  if (v.quiet) body.quietHours = { start: v.qStart, end: v.qEnd, tz: v.qTz, phone: v.qPhone }
  else delete body.quietHours
  return body
}

const same = (a: Values, b: Values) => JSON.stringify(a) === JSON.stringify(b)

/** How long a switch waits before saving, so a few quick clicks make one save and one toast. */
const SETTLE_MS = 300

/**
 * Settings save as you change them (owner, 29 Oct): a switch or a choice at once, a typed field when you leave it
 * or press Enter. Each save says so in a toast; the newest replaces the last.
 */
export function Settings() {
  const [data, setData] = useState<SettingsData>()
  const [error, setError] = useState<string>()
  const [errors, setErrors] = useState<string[]>()
  const [restart, setRestart] = useState(false)
  const [v, setV] = useState<Values>()
  // The last values the Host accepted, and the latest on screen, for saves that run after a render.
  const saved = useRef<Values>(undefined)
  const latest = useRef<Values>(undefined)
  const dataRef = useRef<SettingsData>(undefined)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const notify = useStore((s) => s.notify)
  const setNotify = useStore((s) => s.setNotify)

  useEffect(() => {
    void (async () => {
      const r = await api<SettingsData>("GET", "/api/settings")
      if (!r.ok || !r.data) return setError(r.error ?? "Settings could not be read")
      const start = valuesOf(r.data)
      dataRef.current = r.data
      saved.current = start
      latest.current = start
      setData(r.data)
      setV(start)
    })()
    return () => clearTimeout(timer.current)
  }, [])

  /** Saves what is on screen now, if it changed. Saves run one at a time, in order. */
  function save(what: string) {
    queue.current = queue.current.then(async () => {
      const d = dataRef.current
      const now = latest.current
      if (!d || !now || (saved.current && same(now, saved.current))) return
      const body = bodyOf(d, now)
      const r = await api<{ restartRequired: boolean }>("PUT", "/api/settings", body)
      if (!r.ok) {
        const why = r.errors ?? [r.error ?? "The settings were not saved"]
        setErrors(why)
        toast.error(`${what} not saved: ${why[0]}`, { id: "settings" })
        return
      }
      saved.current = now
      dataRef.current = { ...d, saved: body as Partial<Config> }
      setErrors(undefined)
      const needsRestart = r.data?.restartRequired === true
      if (needsRestart) setRestart(true)
      toast(needsRestart ? `${what} saved. Restart JCVC for it to take effect.` : `${what} saved`, {
        id: "settings",
      })
    })
  }

  /** Changes the form without saving: typing in a field. */
  function edit(patch: Partial<Values>) {
    const next = { ...(latest.current as Values), ...patch }
    latest.current = next
    setV(next)
  }
  /** Changes the form and saves it shortly: a switch, a choice or a time. */
  function change(patch: Partial<Values>, what: string) {
    edit(patch)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => save(what), SETTLE_MS)
  }
  /** Saves a typed field now: when you leave it or press Enter. */
  function commit(what: string) {
    clearTimeout(timer.current)
    save(what)
  }
  const typed = (what: string) => ({
    onBlur: () => commit(what),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault()
        commit(what)
      }
    },
  })

  if (error)
    return (
      <p role="alert" className="p-6 font-semibold text-sev">
        {error}
      </p>
    )
  if (!data || !v) return <p className="p-6 text-mut">Loading…</p>

  return (
    <div className="sheet mx-auto grid max-w-[1040px] gap-0 p-6" aria-label="Settings">
      <h1 className="m-0">Settings</h1>
      <p className="m-0 text-mut">
        Changes save as you make them. A typed setting saves when you leave the box or press Enter.
      </p>
      {restart ? (
        <p role="status" className="panel m-0 p-3 font-semibold">
          Saved. Restart JCVC for these changes to take effect.
        </p>
      ) : null}
      {errors?.length ? (
        <ul role="alert" className="m-0 font-semibold text-sev">
          {errors.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}

      <fieldset className="m-0 grid gap-3 border-0 p-0">
        <legend className="mb-1 text-sm font-semibold">Organisation and workspaces</legend>
        <Field
          label="Expected organisation"
          help="Sessions refuse to start unless the signed-in account belongs to this organisation. For example: ACN - Premium."
        >
          <input
            className="field"
            value={v.org}
            onChange={(e) => edit({ org: e.target.value })}
            {...typed("Expected organisation")}
          />
        </Field>
        <Field
          label="Workspace roots"
          help={`One folder per line. Leave empty to use the rules file${data.workspaceRootsInEffect.length ? ` (now: ${data.workspaceRootsInEffect.join(", ")})` : ""}. Saves when you leave the box.`}
        >
          <textarea
            className="field mono"
            rows={3}
            value={v.roots}
            onChange={(e) => edit({ roots: e.target.value })}
            onBlur={() => commit("Workspace roots")}
            spellCheck={false}
          />
        </Field>
      </fieldset>

      <fieldset className="m-0 grid gap-3 border-0 p-0">
        <legend className="mb-1 text-sm font-semibold">Quiet hours and timeouts</legend>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={v.quiet}
            onChange={(e) => change({ quiet: e.target.checked }, "Quiet hours")}
          />
          Hold phone notifications during quiet hours
        </label>
        {v.quiet ? (
          <div className="grid grid-cols-3 gap-3 max-[700px]:grid-cols-1">
            <Field label="From">
              <input
                className="field"
                type="time"
                value={v.qStart}
                onChange={(e) =>
                  e.target.value && change({ qStart: e.target.value }, "Quiet hours")
                }
                required
              />
            </Field>
            <Field label="Until">
              <input
                className="field"
                type="time"
                value={v.qEnd}
                onChange={(e) => e.target.value && change({ qEnd: e.target.value }, "Quiet hours")}
                required
              />
            </Field>
            <Field label="Time zone">
              <input
                className="field"
                value={v.qTz}
                onChange={(e) => edit({ qTz: e.target.value })}
                {...typed("Time zone")}
                required
              />
            </Field>
            <label className="col-span-3 flex items-center gap-2 max-[700px]:col-span-1">
              <input
                type="checkbox"
                checked={v.qPhone}
                onChange={(e) => change({ qPhone: e.target.checked }, "Quiet hours")}
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
              value={v.phoneMin}
              onChange={(e) => edit({ phoneMin: Number(e.target.value) })}
              {...typed("Phone expiry")}
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
              value={v.hardMin}
              onChange={(e) => edit({ hardMin: Number(e.target.value) })}
              {...typed("Desktop timeout")}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="m-0 grid gap-2 border-0 p-0">
        <legend className="mb-1 text-sm font-semibold">Daily digest</legend>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={v.digestOn}
            onChange={(e) => change({ digestOn: e.target.checked }, "Daily digest")}
          />
          Send a short summary of the last 24 hours to the phone each day
        </label>
        {v.digestOn ? (
          <Field
            label="Send it after"
            help="Local time. If the computer is asleep then, it is sent at the next check. It only goes if a phone is paired."
          >
            <input
              className="field w-40"
              type="time"
              value={v.digestAt}
              onChange={(e) =>
                e.target.value && change({ digestAt: e.target.value }, "Daily digest")
              }
              required
            />
          </Field>
        ) : null}
      </fieldset>

      <fieldset className="m-0 grid gap-3 border-0 p-0">
        <legend className="mb-1 text-sm font-semibold">Redaction list</legend>
        <Field
          label="Words to hide"
          help="One per line. Client names and internal host names. They are replaced before anything is saved or sent, in the audit log and to the phone. Saves when you leave the box."
        >
          <textarea
            className="field"
            rows={4}
            value={v.terms}
            onChange={(e) => edit({ terms: e.target.value })}
            onBlur={() => commit("Redaction list")}
            spellCheck={false}
          />
        </Field>
      </fieldset>

      <fieldset className="m-0 grid gap-2 border-0 p-0">
        <legend className="mb-1 text-sm font-semibold">Checkpoints</legend>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={v.cpEsc}
            onChange={(e) => change({ cpEsc: e.target.checked }, "Checkpoints")}
          />
          Take a checkpoint before anything that waits for your decision
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={v.cpBurst}
            onChange={(e) => change({ cpBurst: e.target.checked }, "Checkpoints")}
          />
          Take a checkpoint before the first edit after a quiet spell
        </label>
      </fieldset>

      <fieldset className="m-0 grid gap-2 border-0 p-0">
        <legend className="mb-1 text-sm font-semibold">Updates</legend>
        <UpdatesPanel />
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
        <legend className="mb-1 text-sm font-semibold">Background picture</legend>
        <p className="m-0 text-xs text-mut">
          JCVC always shows a faint Jean-Claude picture behind the screens, in the light and the
          dark theme. Choose which one, or add your own.
        </p>
        <JcvcPicker />
      </fieldset>

      <fieldset className="m-0 grid gap-2 border-0 p-0">
        <legend className="mb-1 text-sm font-semibold">Notifications</legend>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={notify}
            onChange={async (e) => {
              const on = e.target.checked
              if (
                on &&
                typeof Notification !== "undefined" &&
                Notification.permission !== "granted"
              ) {
                const p = await Notification.requestPermission()
                if (p !== "granted") {
                  toast.error("The browser did not allow notifications.", { id: "settings" })
                  return
                }
              }
              setNotify(on)
              toast(on ? "Browser notifications on" : "Browser notifications off", {
                id: "settings",
              })
            }}
          />
          Show a browser notification when a decision is waiting
        </label>
        <p className="m-0 text-xs text-mut">
          The notification never shows the command or file names. This choice applies to this
          browser only.
        </p>
      </fieldset>

      <p className="m-0 text-xs text-mut">
        Stored in <span className="mono">{data.path}</span>
      </p>
    </div>
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
