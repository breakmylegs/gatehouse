import { ClaudeImport } from "../components/ClaudeImport"
import { SECTION_KEY } from "../lib/settingsSection"
import { createContext, useContext, useEffect, useRef, useState } from "react"
import { UpdatesPanel } from "../components/UpdatesPanel"
import { ChangelogPanel } from "../components/ChangelogPanel"
import { ViewerSetting } from "../components/ViewerSetting"
import {
  AppearancePanel,
  GoTo,
  NotifyKindsSetting,
  UsageLimitsPanel,
} from "../components/SettingsPanels"
import { TempFilesPanel } from "../components/TempFilesPanel"
import { QuickKeyPanel } from "../components/QuickKeyPanel"
import { VoiceSetting } from "../components/VoiceButton"
import { setScreenReaderMode, useScreenReaderMode } from "../lib/screenReader"

/** Settings: screen reader mode (B40). */
function ScreenReaderSetting() {
  const on = useScreenReaderMode()
  return (
    <>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => setScreenReaderMode(e.target.checked)}
        />
        <span>Show each conversation as one plain list, for a screen reader</span>
      </label>
      <p className="m-0 text-xs text-mut">
        Normally only the messages on screen are drawn, which keeps long conversations quick but
        hides the rest from a screen reader. With this on, every message is there, in order, so you
        can move through all of it and find text. Very long conversations may scroll more slowly.
      </p>
    </>
  )
}
import { ProvidersPanel } from "../components/ProvidersPanel"
import { RoutinesPanel } from "../components/RoutinesPanel"
import { toast } from "sonner"
import { api } from "../lib/api"
import { EFFORTS } from "../lib/modes"
import { send, useStore } from "../store"

interface Config {
  redactTerms: string[]
  expectedOrg?: string
  workspaceRoots?: string[]
  projectsFolder?: string
  digestTime?: string | null
  quietHours?: { start: string; end: string; tz: string; phone?: boolean }
  phoneExpiryMs: number
  hardTimeoutMs: number
  checkpoints: { beforeEscalation: boolean; editBursts: boolean; burstWindowMs: number }
  rulesPath?: string
  extremeCarryOn?: { turns: number; usd: number; noTurnLimit?: boolean; noSpendLimit?: boolean }
  planLimitPause?: { percent: number; off?: boolean; noAutoResume?: boolean }
  effortCap?: string
  maxSessions?: number
  spendCapUsd?: number
  outputStyle?: string
  worktreeLocation?: { where: "beside" | "inside" | "folder"; folder?: string }
  pullRequests?: { branchPrefix?: string; create?: boolean; draft?: boolean; fixChecks?: boolean }
  browserTools?: boolean
  telemetry?: { file?: boolean; endpoint?: string }
  globalInstructions?: string
  profile?: { callMe?: string; work?: string }
  keepAwake?: boolean
  recapByClaude?: boolean
  chatHandoff?: { target?: "edge" | "browser" | "app"; edgeProfile?: string; appLink?: boolean }
}

/** Extreme approval's limits after each message of yours. No limit keeps the highest number for an older version. */
const CARRY_TURNS = ["25", "50", "100", "200", "500", "none"] as const
/** Where sessions pause for the plan's 5-hour limit (owner): a percentage, or never. */
const PAUSE_AT = ["80", "85", "90", "95", "99", "off"] as const
const CARRY_USD = ["25", "50", "100", "250", "500", "1000", "none"] as const
/** The choices, with a value saved by hand or by another version among them, in order. */
const withCurrent = (list: readonly string[], v: string) =>
  list.includes(v)
    ? [...list]
    : [...list.filter((n) => /^\d+$/.test(n)), v]
        .sort((a, b) => Number(a) - Number(b))
        .concat(list.filter((n) => !/^\d+$/.test(n)))
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
  projects: string
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
  /** A number, or "none" for no limit. */
  ecTurns: string
  plPause: string
  plResume: boolean
  effortCap: string
  maxSessions: string
  spendCap: string
  /** The output style new coding sessions start with, by name; "" for Claude Code's default. */
  style: string
  /** Where new worktrees go, and the folder when it is one you choose. */
  wtWhere: "beside" | "inside" | "folder"
  wtFolder: string
  /** Pull requests from a session in a worktree. */
  prPrefix: string
  prCreate: boolean
  prDraft: boolean
  prFix: boolean
  /** Browser tools: a coding session may look at a page on this computer. */
  browser: boolean
  telFile: boolean
  telEndpoint: string
  ecUsd: string
  /** What every session is told at its start. */
  instr: string
  /** What Claude should call you, and your work (Profile). */
  callMe: string
  work: string
  /** Keep the computer awake while a session works. */
  awake: boolean
  /** While you were away, written by Claude. */
  recap: boolean
  /** Open in Claude (CH-06). */
  handoff: "edge" | "browser" | "app"
  edgeProfile: string
  appLink: boolean
}

function valuesOf(d: SettingsData): Values {
  const c = { ...d.running, ...d.saved } as Config
  const q = d.saved.quietHours ?? d.quietHoursInPolicy
  return {
    org: c.expectedOrg ?? "",
    roots: (d.saved.workspaceRoots ?? []).join("\n"),
    projects: d.saved.projectsFolder ?? "",
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
    ecTurns: c.extremeCarryOn?.noTurnLimit ? "none" : String(c.extremeCarryOn?.turns ?? 200),
    plPause: c.planLimitPause?.off ? "off" : String(c.planLimitPause?.percent ?? 95),
    plResume: c.planLimitPause?.noAutoResume !== true,
    effortCap: c.effortCap ?? "",
    maxSessions: c.maxSessions ? String(c.maxSessions) : "",
    spendCap: c.spendCapUsd ? String(c.spendCapUsd) : "",
    style: c.outputStyle ?? "",
    wtWhere: c.worktreeLocation?.where ?? "beside",
    wtFolder: c.worktreeLocation?.folder ?? "",
    prPrefix: c.pullRequests?.branchPrefix ?? "codehouse/",
    prCreate: c.pullRequests?.create === true,
    prDraft: c.pullRequests?.draft !== false,
    prFix: c.pullRequests?.fixChecks === true,
    browser: c.browserTools === true,
    telFile: c.telemetry?.file === true,
    telEndpoint: c.telemetry?.endpoint ?? "",
    ecUsd: c.extremeCarryOn?.noSpendLimit ? "none" : String(c.extremeCarryOn?.usd ?? 500),
    instr: c.globalInstructions ?? "",
    callMe: c.profile?.callMe ?? "",
    work: c.profile?.work ?? "",
    awake: c.keepAwake !== false,
    recap: c.recapByClaude !== false,
    handoff: c.chatHandoff?.target ?? "edge",
    edgeProfile: c.chatHandoff?.edgeProfile ?? "Default",
    appLink: c.chatHandoff?.appLink === true,
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
  if (v.projects.trim()) body.projectsFolder = v.projects.trim().replace(/[\\/]+$/, "")
  else delete body.projectsFolder
  if (v.instr.trim()) body.globalInstructions = v.instr.trim()
  else delete body.globalInstructions
  // Anything a newer version keeps beside the profile stays.
  const { callMe: _c, work: _w, ...profileKeep } = d.saved.profile ?? {}
  const profile = {
    ...profileKeep,
    ...(v.callMe.trim() ? { callMe: v.callMe.trim() } : {}),
    ...(v.work.trim() ? { work: v.work.trim() } : {}),
  }
  if (Object.keys(profile).length) body.profile = profile
  else delete body.profile
  if (v.awake) delete body.keepAwake
  else body.keepAwake = false
  if (v.recap) delete body.recapByClaude
  else body.recapByClaude = false
  // Open in Claude: what this page sets, over anything else kept there (the address templates).
  const handoff: Record<string, unknown> = {
    ...((d.saved.chatHandoff as Record<string, unknown> | undefined) ?? {}),
  }
  delete handoff.target
  delete handoff.edgeProfile
  delete handoff.appLink
  if (v.handoff !== "edge") handoff.target = v.handoff
  if (v.edgeProfile !== "Default") handoff.edgeProfile = v.edgeProfile
  if (v.appLink) handoff.appLink = true
  if (Object.keys(handoff).length) body.chatHandoff = handoff
  else delete body.chatHandoff
  body.digestTime = v.digestOn ? v.digestAt : null
  if (v.quiet) body.quietHours = { start: v.qStart, end: v.qEnd, tz: v.qTz, phone: v.qPhone }
  else delete body.quietHours
  // Anything a newer version keeps beside the limits stays.
  const { noTurnLimit: _t, noSpendLimit: _s, ...keep } = d.saved.extremeCarryOn ?? {}
  body.extremeCarryOn = {
    ...keep,
    turns: v.ecTurns === "none" ? 500 : Number(v.ecTurns),
    usd: v.ecUsd === "none" ? 1000 : Number(v.ecUsd),
    ...(v.ecTurns === "none" ? { noTurnLimit: true } : {}),
    ...(v.ecUsd === "none" ? { noSpendLimit: true } : {}),
  }
  if (v.effortCap) body.effortCap = v.effortCap
  else delete body.effortCap
  if (v.maxSessions) body.maxSessions = Number(v.maxSessions)
  else delete body.maxSessions
  if (v.spendCap) body.spendCapUsd = Number(v.spendCap)
  else delete body.spendCapUsd
  // A name the Host accepts, or none: half-typed or odd names are not saved.
  if (STYLE_NAME.test(v.style.trim())) body.outputStyle = v.style.trim()
  else delete body.outputStyle
  // Pull requests: only what differs from the defaults is written; anything a newer version keeps there stays.
  const { branchPrefix: _bp, create: _cr, draft: _dr, fixChecks: _fc, ...prKeep } =
    d.saved.pullRequests ?? {}
  const prefix = v.prPrefix.trim()
  const pr = {
    ...prKeep,
    ...(prefix && prefix !== "codehouse/" && BRANCH_PREFIX.test(prefix)
      ? { branchPrefix: prefix }
      : {}),
    ...(v.prCreate ? { create: true } : {}),
    ...(v.prDraft ? {} : { draft: false }),
    ...(v.prFix ? { fixChecks: true } : {}),
  }
  if (Object.keys(pr).length) body.pullRequests = pr
  else delete body.pullRequests
  if (v.browser) body.browserTools = true
  else delete body.browserTools
  // Beside the project is the default and is not written; anything a newer version keeps there stays.
  const { where: _w2, folder: _f2, ...wtKeep } = d.saved.worktreeLocation ?? { where: "beside" }
  const folder = v.wtFolder.trim().replace(/[\\/]+$/, "")
  if (v.wtWhere === "beside" && !Object.keys(wtKeep).length) delete body.worktreeLocation
  else if (v.wtWhere === "folder" && !folder) delete body.worktreeLocation
  else
    body.worktreeLocation = {
      ...wtKeep,
      where: v.wtWhere,
      ...(v.wtWhere === "folder" ? { folder } : {}),
    }
  if (v.telFile || v.telEndpoint.trim())
    body.telemetry = {
      ...(d.saved.telemetry ?? {}),
      file: v.telFile,
      ...(v.telEndpoint.trim() ? { endpoint: v.telEndpoint.trim() } : {}),
    }
  else delete body.telemetry
  if (body.telemetry && !v.telEndpoint.trim())
    delete (body.telemetry as { endpoint?: string }).endpoint
  // Absent is 95%, so the default is not written; a percentage is kept beside off for an older reader.
  const { off: _o, ...pauseKeep } = d.saved.planLimitPause ?? { percent: 95 }
  const { noAutoResume: _r, ...pauseRest } = pauseKeep as {
    noAutoResume?: boolean
    percent: number
  }
  if (v.plPause === "95" && v.plResume && !d.saved.planLimitPause) delete body.planLimitPause
  else
    body.planLimitPause = {
      ...pauseRest,
      ...(v.plPause === "off" ? { off: true } : { percent: Number(v.plPause) }),
      ...(v.plResume ? {} : { noAutoResume: true }),
    }
  return body
}

const same = (a: Values, b: Values) => JSON.stringify(a) === JSON.stringify(b)

/** What each setting is until you change it: the Host's own defaults, so a changed group can say so. */
export const DEFAULT_VALUES: Values = {
  org: "",
  roots: "",
  projects: "",
  quiet: false,
  qStart: "22:00",
  qEnd: "07:00",
  qTz: "Europe/London",
  qPhone: false,
  phoneMin: 10,
  hardMin: 30,
  digestOn: true,
  digestAt: "08:00",
  terms: "",
  cpEsc: true,
  cpBurst: true,
  ecTurns: "200",
  plPause: "95",
  plResume: true,
  effortCap: "",
  maxSessions: "",
  spendCap: "",
  style: "",
  wtWhere: "beside",
  wtFolder: "",
  prPrefix: "codehouse/",
  prCreate: false,
  prDraft: true,
  prFix: false,
  browser: false,
  telFile: false,
  telEndpoint: "",
  ecUsd: "500",
  instr: "",
  callMe: "",
  work: "",
  awake: true,
  recap: true,
  handoff: "edge",
  edgeProfile: "Default",
  appLink: false,
}
const differs = (v: Values, keys: Array<keyof Values>) =>
  keys.some((k) => v[k] !== DEFAULT_VALUES[k])

/**
 * The sections, in groups and in order, as in Claude's desktop app (owner, 4 Nov): your preferences, this computer,
 * and what you add. The one you last used is kept.
 */
export const SECTION_GROUPS = [
  [
    "Preferences",
    [
      ["general", "General"],
      ["account", "Account and plan"],
      ["privacy", "Privacy"],
      ["usage", "Usage"],
      ["capabilities", "Capabilities"],
      ["sessions", "Sessions"],
      ["phone", "Phone and notifications"],
    ],
  ],
  [
    "This computer",
    [
      ["system", "System"],
      ["updates", "Updates"],
      ["changelog", "Changelog"],
      ["developer", "Developer"],
    ],
  ],
  [
    "Customize",
    [
      ["skills", "Skills"],
      ["connectors", "Connectors"],
      ["plugins", "Plugins"],
    ],
  ],
] as const
type SectionEntry = (typeof SECTION_GROUPS)[number][1][number]
export const SECTIONS: readonly SectionEntry[] = SECTION_GROUPS.flatMap(
  ([, list]) => list as readonly SectionEntry[],
)
type SectionId = SectionEntry[0]
function readSection(): SectionId {
  try {
    const k = localStorage.getItem(SECTION_KEY)
    return SECTIONS.find(([id]) => id === k)?.[0] ?? "general"
  } catch {
    return "general"
  }
}

/** Which section is open and what is typed in the search box, for the groups to follow. */
const SettingsView = createContext<{
  query: string
  section: SectionId
  /** A group says whether it matches the search, so the page can say when none does. */
  report: (title: string, hit: boolean) => void
}>({
  query: "",
  section: "general",
  report: () => undefined,
})

/**
 * One group of settings. It shows while its section is open, or, while you search, when anything in it matches by
 * its title, a label or its help text. A group that differs from its defaults says so.
 */
function Group({
  section,
  title,
  gap,
  changed,
  children,
}: {
  section: SectionId
  title: string
  gap: string
  changed?: boolean
  children: React.ReactNode
}) {
  const { query, section: open, report } = useContext(SettingsView)
  const ref = useRef<HTMLFieldSetElement>(null)
  const [hit, setHit] = useState(true)
  useEffect(() => {
    const now = !query || (ref.current?.textContent ?? "").toLowerCase().includes(query)
    setHit(now)
    report(title, now)
  })
  return (
    <fieldset
      ref={ref}
      hidden={query ? !hit : section !== open}
      className={`m-0 grid ${gap} border-0 p-0`}
    >
      <legend className="mb-1 text-sm font-semibold">
        {title}
        {changed ? (
          <span className="ml-2 text-xs font-normal text-acc">Changed from the default</span>
        ) : null}
      </legend>
      {children}
    </fieldset>
  )
}

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
  const [restarting, setRestarting] = useState<{ busy: boolean; error?: string }>({ busy: false })

  /** Restart Codehouse now: the window app closes and opens it again. Open sessions stop, as with an update. */
  async function restartNow() {
    setRestart(true)
    setRestarting({ busy: true })
    const r = await send({ type: "restart" })
    if (!r.ok)
      setRestarting({
        busy: false,
        error: r.error?.message ?? "Codehouse could not restart itself.",
      })
  }
  const [v, setV] = useState<Values>()
  // The last values the Host accepted, and the latest on screen, for saves that run after a render.
  const saved = useRef<Values>(undefined)
  const latest = useRef<Values>(undefined)
  const dataRef = useRef<SettingsData>(undefined)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const notify = useStore((s) => s.notify)
  const appVersion = useStore((s) => s.update?.current)
  const setNotify = useStore((s) => s.setNotify)
  const [section, setSectionState] = useState<SectionId>(readSection)
  const [search, setSearch] = useState("")
  const query = search.trim().toLowerCase()
  // Which groups match the search, as they report it.
  const hits = useRef(new Map<string, boolean>())
  const [, bump] = useState(0)
  const report = (title: string, hit: boolean) => {
    if (hits.current.get(title) === hit) return
    hits.current.set(title, hit)
    bump((n) => n + 1)
  }
  const nothing = Boolean(query) && ![...hits.current.values()].some(Boolean)
  const setSection = (id: SectionId) => {
    setSectionState(id)
    setSearch("")
    try {
      localStorage.setItem(SECTION_KEY, id)
    } catch {
      // storage blocked: the section lasts until the window closes
    }
  }

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
      if (needsRestart)
        toast(`${what} saved. It takes effect when Codehouse restarts.`, {
          id: "settings",
          action: { label: "Restart now", onClick: () => void restartNow() },
        })
      else toast(`${what} saved`, { id: "settings" })
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

  const orgChanged = differs(v, ["org", "roots", "projects"])
  const phoneChanged = v.quiet || differs(v, ["phoneMin", "hardMin"])
  const digestChanged =
    differs(v, ["digestOn"]) || (v.digestOn && v.digestAt !== DEFAULT_VALUES.digestAt)
  const extremeChanged = differs(v, ["ecTurns", "ecUsd"])
  const pauseChanged = differs(v, ["plPause", "plResume"])
  const effortChanged = differs(v, ["effortCap"])
  const styleChanged = differs(v, ["style"])
  const worktreeChanged = differs(v, ["wtWhere", "wtFolder"])
  const prChanged = differs(v, ["prPrefix", "prCreate", "prDraft", "prFix"])
  const browserChanged = differs(v, ["browser"])
  const limitChanged = differs(v, ["maxSessions", "spendCap"])
  const telemetryChanged = differs(v, ["telFile", "telEndpoint"])
  const instrChanged = differs(v, ["instr"])
  const profileChanged = differs(v, ["callMe", "work"])
  const privacyChanged = differs(v, ["terms"])
  const checkpointsChanged = differs(v, ["cpEsc", "cpBurst"])
  const sectionChanged: Partial<Record<SectionId, boolean>> = {
    account: orgChanged || profileChanged,
    sessions: extremeChanged || checkpointsChanged || instrChanged,
    phone: phoneChanged || digestChanged,
    privacy: privacyChanged,
  }

  return (
    <div className="sheet mx-auto grid max-w-[1040px] gap-0 p-6" aria-label="Settings">
      <h1 className="m-0">Settings</h1>
      <p className="m-0 text-mut">
        Changes save as you make them. A typed setting saves when you leave the box or press Enter.
      </p>
      {restart ? (
        <RestartPrompt
          onLater={() => setRestart(false)}
          onRestart={() => void restartNow()}
          state={restarting}
        />
      ) : null}
      {errors?.length ? (
        <ul role="alert" className="m-0 font-semibold text-sev">
          {errors.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4 grid items-start gap-6 md:grid-cols-[210px_minmax(0,1fr)]">
        <div className="grid gap-3 md:sticky md:top-4">
          <input
            type="search"
            className="field"
            aria-label="Search settings"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <nav aria-label="Settings sections" className="settings-nav grid gap-0.5">
            {SECTION_GROUPS.map(([heading, list]) => (
              <div key={heading} role="group" aria-label={heading} className="grid gap-0.5">
                <span className="settings-nav-heading" aria-hidden="true">
                  {heading}
                </span>
                {list.map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    aria-current={!query && section === id ? "page" : undefined}
                    onClick={() => setSection(id)}
                  >
                    <span>{label}</span>
                    {sectionChanged[id] ? <span className="text-xs text-acc">Changed</span> : null}
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </div>
        <SettingsView.Provider value={{ query, section, report }}>
          <div className="grid gap-5">
            <Group
              section="account"
              title="Organisation and workspaces"
              gap="gap-3"
              changed={orgChanged}
            >
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
                label="Where new projects go"
                help="Start a session without choosing a folder and the project gets a new folder in here, named from your first prompt. It counts as one of your workspace folders. For example C:\dev. Restart Codehouse after changing it."
              >
                <span className="flex flex-wrap gap-2">
                  <input
                    className="field mono min-w-[260px] flex-1"
                    value={v.projects}
                    onChange={(e) => edit({ projects: e.target.value })}
                    spellCheck={false}
                    {...typed("Projects folder")}
                  />
                  <button
                    type="button"
                    className="btn"
                    onClick={async () => {
                      const r = await api<{ path: string | null }>("POST", "/api/pick-folder", {
                        start: v.projects.trim(),
                      })
                      if (r.ok && r.data?.path) change({ projects: r.data.path }, "Projects folder")
                      else if (!r.ok)
                        toast.error(
                          r.error ?? "The folder window could not open. Type the folder instead.",
                          {
                            id: "settings",
                          },
                        )
                    }}
                  >
                    Choose a folder...
                  </button>
                </span>
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
            </Group>

            <Group
              section="phone"
              title="Quiet hours and timeouts"
              gap="gap-3"
              changed={phoneChanged}
            >
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
                      onChange={(e) =>
                        e.target.value && change({ qEnd: e.target.value }, "Quiet hours")
                      }
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
            </Group>

            <Group
              section="sessions"
              title="Instructions for every session"
              gap="gap-2"
              changed={instrChanged}
            >
              <Field
                label="What every session is told when it starts"
                help="In your own words, for example how you like answers. Up to 8000 characters. A session also gets its project's and its own instructions after these. Takes effect for sessions started from now on."
              >
                <textarea
                  className="field"
                  rows={5}
                  maxLength={8000}
                  value={v.instr}
                  onChange={(e) => edit({ instr: e.target.value })}
                  onBlur={() => commit("Instructions")}
                />
              </Field>
            </Group>

            <Group section="sessions" title="Extreme approval" gap="gap-3" changed={extremeChanged}>
              <p className="m-0 text-xs text-mut">
                A session in Extreme approval carries on by itself until Claude says its build queue
                is empty. It also stops when two turns in a row do no work, when you press Stop, or
                at these limits after each message of yours.
              </p>
              <div className="grid grid-cols-2 gap-3 max-[700px]:grid-cols-1">
                <Field label="Most automatic turns">
                  <select
                    className="field"
                    value={v.ecTurns}
                    onChange={(e) => change({ ecTurns: e.target.value }, "Extreme approval")}
                  >
                    {withCurrent(CARRY_TURNS, v.ecTurns).map((n) => (
                      <option key={n} value={n}>
                        {n === "none" ? "No limit" : `${n} turns`}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Most spending">
                  <select
                    className="field"
                    value={v.ecUsd}
                    onChange={(e) => change({ ecUsd: e.target.value }, "Extreme approval")}
                  >
                    {withCurrent(CARRY_USD, v.ecUsd).map((n) => (
                      <option key={n} value={n}>
                        {n === "none" ? "No limit" : `$${Number(n).toLocaleString("en-GB")}`}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </Group>

            <Group section="sessions" title="Routines" gap="gap-2">
              <RoutinesPanel />
            </Group>

            <Group section="sessions" title="How many at once" gap="gap-2" changed={limitChanged}>
              <Field
                label="Most sessions and chats open at once"
                help="Each one runs its own Claude Code, which uses processor and memory however its own level is set. At the limit a new one is refused until you close one; those already open are not touched, and ones coming back after a restart still come back."
              >
                <select
                  className="field"
                  value={v.maxSessions}
                  onChange={(e) => change({ maxSessions: e.target.value }, "How many at once")}
                >
                  <option value="">No limit</option>
                  {["2", "4", "6", "8", "12", "16"].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Most spending a day, over every session"
                help="Only money really spent: extra usage beyond your plan, and models through a gateway that charge. Work inside your plan costs nothing more, so it never counts; the plan limit has its own pause. At the limit every session pauses until midnight, or until you raise it; Start now starts one sooner."
              >
                <select
                  className="field"
                  value={v.spendCap}
                  onChange={(e) => change({ spendCap: e.target.value }, "How many at once")}
                >
                  <option value="">No limit</option>
                  {withCurrent(["10", "25", "50", "100", "250", "500"], v.spendCap || "10").map(
                    (n) => (
                      <option key={n} value={n}>
                        ${n}
                      </option>
                    ),
                  )}
                </select>
              </Field>
            </Group>

            <Group section="sessions" title="Output style" gap="gap-2" changed={styleChanged}>
              <OutputStyleField
                value={v.style}
                onChange={(style) => change({ style }, "Output style")}
                onType={(style) => edit({ style })}
                onDone={() => commit("Output style")}
              />
            </Group>

            <Group
              section="sessions"
              title="Worktree location"
              gap="gap-2"
              changed={worktreeChanged}
            >
              <Field
                label="Where new worktrees go"
                help="A session started in a worktree works in a separate copy of its project, on a branch of its own. Beside the project puts it in a folder next to the project's own. Inside the project puts it in the project's .codehouse folder, kept out of git on this computer; tools that search the whole project may see it. A folder you choose must be inside your workspace folders, or a session there could change nothing."
              >
                <select
                  className="field"
                  value={v.wtWhere}
                  onChange={(e) =>
                    change({ wtWhere: e.target.value as Values["wtWhere"] }, "Worktree location")
                  }
                >
                  <option value="beside">Beside the project</option>
                  <option value="inside">Inside the project</option>
                  <option value="folder">A folder you choose</option>
                </select>
              </Field>
              {v.wtWhere === "folder" ? (
                <Field
                  label="Worktree folder"
                  help="Each project's worktrees go in a folder named after it in here, for example C:\dev\worktrees."
                >
                  <span className="flex flex-wrap gap-2">
                    <input
                      className="field mono min-w-[260px] flex-1"
                      value={v.wtFolder}
                      onChange={(e) => edit({ wtFolder: e.target.value })}
                      spellCheck={false}
                      {...typed("Worktree location")}
                    />
                    <button
                      type="button"
                      className="btn"
                      onClick={async () => {
                        const r = await api<{ path: string | null }>("POST", "/api/pick-folder", {
                          start: v.wtFolder.trim(),
                        })
                        if (r.ok && r.data?.path)
                          change({ wtFolder: r.data.path }, "Worktree location")
                        else if (!r.ok)
                          toast.error(
                            r.error ?? "The folder window could not open. Type the folder instead.",
                            { id: "settings" },
                          )
                      }}
                    >
                      Choose a folder...
                    </button>
                  </span>
                </Field>
              ) : null}
            </Group>

            <Group section="sessions" title="Viewer" gap="gap-2">
              <ViewerSetting />
            </Group>

            <Group section="sessions" title="Browser tools" gap="gap-2" changed={browserChanged}>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={v.browser}
                  onChange={(e) => change({ browser: e.target.checked }, "Browser tools")}
                />
                Let coding sessions look at pages on this computer to check their work
              </label>
              <p className="m-0 text-[13px] text-mut">
                Claude gets a picture of a page a server on this computer shows (localhost only), and
                its text with your private words taken out. Pictures cannot be redacted. Edge takes
                each picture out of sight, in a profile made for it and removed straight after; a look
                takes about 20 seconds. Claude cannot click or type into the page. Applies to sessions
                started from now on; chats never have it.
              </p>
            </Group>

            <Group section="sessions" title="Pull requests" gap="gap-2" changed={prChanged}>
              <Field
                label="Branch prefix"
                help="What the name of each new worktree's branch starts with, for example your initials and a slash. Letters, numbers, dots, dashes, underscores and slashes."
              >
                <input
                  className="field mono"
                  value={v.prPrefix}
                  maxLength={40}
                  spellCheck={false}
                  onChange={(e) => edit({ prPrefix: e.target.value })}
                  aria-invalid={v.prPrefix.trim() !== "" && !BRANCH_PREFIX.test(v.prPrefix.trim())}
                  {...typed("Pull requests")}
                />
              </Field>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={v.prCreate}
                  onChange={(e) => change({ prCreate: e.target.checked }, "Pull requests")}
                />
                Open a pull request when a session in a worktree finishes its work
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={v.prDraft}
                  disabled={!v.prCreate}
                  onChange={(e) => change({ prDraft: e.target.checked }, "Pull requests")}
                />
                As a draft
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={v.prFix}
                  disabled={!v.prCreate}
                  onChange={(e) => change({ prFix: e.target.checked }, "Pull requests")}
                />
                Fix checks that fail on it
              </label>
              <p className="m-0 text-[13px] text-mut">
                Claude pushes the session's own branch and opens the pull request with gh. Each push
                and each gh command asks you first, as always, unless Extreme approval is on for that
                session. Sessions not in a worktree are never asked to push.
              </p>
            </Group>

            <Group section="sessions" title="Effort" gap="gap-2" changed={effortChanged}>
              <Field
                label="Most effort a session may use"
                help="Higher effort thinks longer and uses more of your plan. Sessions started above this run at it, and the picker under each prompt box offers nothing higher. Models on this computer have no effort setting."
              >
                <select
                  className="field"
                  value={v.effortCap}
                  onChange={(e) => change({ effortCap: e.target.value }, "Effort")}
                >
                  <option value="">No limit</option>
                  {EFFORTS.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </Field>
            </Group>

            <Group section="sessions" title="Plan limit" gap="gap-2" changed={pauseChanged}>
              <Field
                label="Pause every session when the 5-hour limit reaches"
                help="Sessions paused for the limit start again by themselves when it resets. Pausing a little short of the limit means the turn in hand is not cut off part way."
              >
                <select
                  className="field"
                  value={v.plPause}
                  onChange={(e) => change({ plPause: e.target.value }, "Plan limit")}
                >
                  {withCurrent(PAUSE_AT, v.plPause).map((n) => (
                    <option key={n} value={n}>
                      {n === "off"
                        ? "Never: run to the limit"
                        : `${n}%${n === "95" ? " (recommended)" : ""}`}
                    </option>
                  ))}
                </select>
              </Field>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={v.plResume}
                  onChange={(e) => change({ plResume: e.target.checked }, "Plan limit")}
                />
                Start paused sessions again by themselves when the limit resets
              </label>
              <p className="m-0 text-xs text-mut">
                A session that was working carries on where it stopped. In Extreme approval its turn
                and spending limits still apply. Off, each waits for you to press Start now.
              </p>
              {v.plPause === "off" || Number(v.plPause) >= 99 ? (
                <p role="note" className="m-0 text-[13px] text-warn">
                  Cost: at the limit Claude Code stops the work itself, part way through a turn. If
                  your plan has extra usage switched on, work past the limit is charged as extra
                  usage instead, which can cost a lot with several sessions running. Plan usage, the
                  ring under each prompt box, shows where you are.
                </p>
              ) : null}
            </Group>

            <Group section="phone" title="Daily digest" gap="gap-2" changed={digestChanged}>
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
            </Group>

            <Group section="privacy" title="Redaction list" gap="gap-3" changed={privacyChanged}>
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
            </Group>

            <Group section="sessions" title="Other AI providers" gap="gap-2">
              <ProvidersPanel
                onSaved={(providers) => {
                  // Saved on its own: the next save of this page keeps it rather than what was loaded.
                  const d = dataRef.current
                  if (d)
                    dataRef.current = { ...d, saved: { ...d.saved, providers } as Partial<Config> }
                }}
              />
            </Group>

            <Group section="sessions" title="Checkpoints" gap="gap-2" changed={checkpointsChanged}>
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
            </Group>

            <Group section="updates" title="Updates" gap="gap-2">
              <UpdatesPanel />
            </Group>

            <Group section="changelog" title="Changelog" gap="gap-2">
              <ChangelogPanel {...(appVersion ? { current: appVersion } : {})} />
            </Group>

            <Group section="account" title="Profile" gap="gap-3" changed={profileChanged}>
              <Field
                label="What should Claude call you?"
                help="Told to every session at its start. Saved when you leave the box."
              >
                <input
                  className="field max-w-sm"
                  maxLength={60}
                  value={v.callMe}
                  onChange={(e) => edit({ callMe: e.target.value })}
                  {...typed("Profile")}
                />
              </Field>
              <Field
                label="What best describes your work?"
                help="For example: chief architect, consultant, data engineer. Saved when you leave the box."
              >
                <input
                  className="field max-w-sm"
                  maxLength={120}
                  value={v.work}
                  onChange={(e) => edit({ work: e.target.value })}
                  {...typed("Profile")}
                />
              </Field>
            </Group>

            <Group section="general" title="Appearance" gap="gap-2">
              <AppearancePanel />
            </Group>

            <Group section="usage" title="Your usage limits" gap="gap-2">
              <UsageLimitsPanel />
            </Group>

            <Group section="capabilities" title="Memory" gap="gap-2">
              <GoTo
                text="Chats remember facts and preferences you ask them to keep, for every chat or for one project. You can see, change and forget each one."
                label="View and manage memory"
                route="memory"
              />
            </Group>

            <Group section="capabilities" title="Artifacts" gap="gap-2">
              <p className="m-0 text-[13.5px] text-mut">
                A chat can show a page, a picture or a small tool beside the conversation. It runs
                in a sandbox with no network and no access to this computer, and is labelled
                AI-generated.
              </p>
            </Group>

            <Group
              section="system"
              title="Keep the computer awake"
              gap="gap-2"
              changed={differs(v, ["awake"])}
            >
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={v.awake}
                  onChange={(e) => change({ awake: e.target.checked }, "Keep the computer awake")}
                />
                Keep the computer awake while a session works
              </label>
              <p className="m-0 text-xs text-mut">
                So a long build is not cut off when Windows would sleep. The display can still turn
                off, and closing the lid still puts the computer to sleep. In the Codehouse window
                only.
              </p>
            </Group>

            <Group section="system" title="Start and run" gap="gap-2">
              <p className="m-0 text-[13.5px] text-mut">
                Codehouse keeps running in the system tray when you close its window, so decisions
                can still reach you; Quit Codehouse is in the tray menu. Starting it when you sign
                in to Windows is chosen in the installer.
              </p>
            </Group>

            <Group section="developer" title="Local MCP servers" gap="gap-2">
              <p className="m-0 text-[13.5px] text-mut">
                This computer&apos;s IT policy stops MCP servers that run as their own programs from
                loading into a session, so Codehouse uses only servers inside the session (its own
                Companion). A session that finds another one stops before it runs anything.
              </p>
            </Group>

            <Group section="skills" title="Skills" gap="gap-2">
              <GoTo
                text="Skills are instructions Claude can use by name. Make one from a saved prompt in a session's project, or use those your projects and plugins bring."
                label="Open Prompts"
                route="prompts"
              />
            </Group>

            <Group section="connectors" title="Connectors" gap="gap-2">
              <p className="m-0 text-[13.5px] text-mut">
                Connectors your organisation set up in Claude show under + in a session, in
                Connectors. Each call to one goes to your rules like any other tool call.
              </p>
            </Group>

            <Group section="plugins" title="Plugins" gap="gap-2">
              <GoTo
                text="Add plugins from the marketplaces Claude Code knows on this computer, see what each holds, and check whether one helps before you rely on it."
                label="Open the Marketplace"
                route="marketplace"
              />
            </Group>

            <Group section="general" title="Setup" gap="gap-2">
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
            </Group>

            <Group section="system" title="Quick prompt" gap="gap-2">
              <QuickKeyPanel />
            </Group>

            <Group section="developer" title="Telemetry" gap="gap-2" changed={telemetryChanged}>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={v.telFile}
                  onChange={(e) => change({ telFile: e.target.checked }, "Telemetry")}
                />
                Write each decision to a trace file in the data folder (OpenTelemetry)
              </label>
              <Field
                label="Or send them to a collector on this computer"
                help="An address on this computer only, such as http://127.0.0.1:4318/v1/traces. Each decision says the tool, what was decided, the rule, the risk, who decided and how long it took; never a prompt, a command, a path, a file name or a project name. Saved when you leave the box."
              >
                <input
                  className="field mono"
                  placeholder="http://127.0.0.1:4318/v1/traces"
                  value={v.telEndpoint}
                  onChange={(e) => edit({ telEndpoint: e.target.value })}
                  onBlur={() => commit("Telemetry")}
                />
              </Field>
            </Group>

            <Group section="general" title="Screen reader" gap="gap-2">
              <ScreenReaderSetting />
            </Group>

            <Group section="general" title="Voice typing" gap="gap-2">
              <VoiceSetting />
            </Group>

            <Group section="system" title="Temporary files" gap="gap-2">
              <TempFilesPanel />
            </Group>

            <Group section="privacy" title="Chats from claude.ai" gap="gap-2">
              <ClaudeImport />
            </Group>

            <Group
              section="privacy"
              title="Open in Claude"
              gap="gap-2"
              changed={differs(v, ["handoff", "edgeProfile", "appLink"])}
            >
              <p className="m-0 text-[13px] text-mut">
                Where an imported chat opens in claude.ai. You sign in there, in Edge or the Claude
                app; Codehouse never sees it and reads nothing back.
              </p>
              <fieldset className="m-0 grid gap-1 border-0 p-0">
                <legend className="sr-only">Open in</legend>
                {(
                  [
                    ["edge", "An Edge app window"],
                    ["browser", "Your default browser"],
                    ["app", "The Claude app"],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="handoff"
                      checked={v.handoff === value}
                      onChange={() => change({ handoff: value }, "Open in Claude")}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              <label className="flex items-center gap-2">
                <span>Edge profile</span>
                <select
                  className="field !min-h-7 !py-0"
                  value={v.edgeProfile}
                  onChange={(e) => change({ edgeProfile: e.target.value }, "Open in Claude")}
                >
                  {[
                    "Default",
                    "Profile 1",
                    "Profile 2",
                    "Profile 3",
                    "Profile 4",
                    "Profile 5",
                    "Guest Profile",
                  ].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={v.appLink}
                  onChange={(e) => change({ appLink: e.target.checked }, "Open in Claude")}
                />
                Let the Claude app open them
              </label>
              <p className="m-0 text-xs text-mut">
                The Claude app's link is not documented by Anthropic, so it is off unless you turn
                it on. When the app is not installed, Edge is used instead.
              </p>
            </Group>

            <Group section="phone" title="Notifications" gap="gap-2">
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
              <NotifyKindsSetting on={notify} />
              <p className="m-0 text-xs text-mut">
                The notification never shows the command or file names. This choice applies to this
                browser only.
              </p>
            </Group>

            <Group
              section="phone"
              title="While you were away"
              gap="gap-2"
              changed={differs(v, ["recap"])}
            >
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={v.recap}
                  onChange={(e) => change({ recap: e.target.checked }, "While you were away")}
                />
                Have Claude write what happened in plain English
              </label>
              <p className="m-0 text-xs text-mut">
                When you come back after ten minutes or more, a small model reads what you and
                Claude said while you were away, with your private words taken out first, and writes
                a few sentences: what was done, what is left and what waits on you. It has no tools
                and is recorded in the audit log. A chat on a model on this computer is never sent.
                Off, the card lists what happened instead.
              </p>
            </Group>

            {nothing ? (
              <p role="status" className="m-0 text-mut">
                Nothing in Settings matches “{search.trim()}”.
              </p>
            ) : null}
            <p className="m-0 text-xs text-mut">
              Stored in <span className="mono">{data.path}</span>
            </p>
          </div>
        </SettingsView.Provider>
      </div>
    </div>
  )
}

/** Restart now or later, after a setting that only takes effect when Codehouse restarts. */
function RestartPrompt({
  state,
  onRestart,
  onLater,
}: {
  state: { busy: boolean; error?: string }
  onRestart: () => void
  onLater: () => void
}) {
  // A restart closes every account's sessions, not only the one on show.
  const open = Object.values(useStore((s) => s.sessions)).filter(
    (s) => s.state !== "ended" && s.state !== "error",
  ).length
  return (
    <div role="group" aria-label="Restart Codehouse" className="panel m-0 grid gap-2 p-3">
      <p role="status" className="m-0 font-semibold">
        {state.busy
          ? "Restarting Codehouse. It closes and opens again by itself in a few seconds."
          : "Saved. This change takes effect when Codehouse restarts. Restart now?"}
      </p>
      {!state.busy && open > 0 ? (
        <p className="m-0 text-[13.5px]">
          {open} session{open === 1 ? " is" : "s are"} open. {open === 1 ? "It comes" : "They come"}{" "}
          back by {open === 1 ? "itself" : "themselves"} after the restart; a turn that is running
          stops.
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="m-0 text-[13.5px] font-semibold text-sev">
          {state.error}
        </p>
      ) : null}
      {state.busy ? null : (
        <div className="flex gap-2">
          <button type="button" className="btn btn-primary" onClick={onRestart}>
            Restart now
          </button>
          <button type="button" className="btn" onClick={onLater}>
            Later
          </button>
        </div>
      )}
    </div>
  )
}

/** A branch prefix as the Host accepts it (apps/host/src/worktrees.ts BRANCH_PREFIX). */
const BRANCH_PREFIX = /^(?![-/.])(?!.*\.\.)(?!.*\/\/)(?!.*\.lock\/?$)[A-Za-z0-9._/-]{1,40}$/

/** An output style's name as the Host accepts it (apps/host/src/safety.ts OUTPUT_STYLE_NAME). */
const STYLE_NAME = /^[A-Za-z0-9][\w .-]{0,59}$/
/** Claude Code's own styles. Yours live in its output-styles folder and are chosen by name. */
const BUILT_IN_STYLES = ["Explanatory", "Learning"]

/**
 * Output style (owner's Settings overhaul): how Claude writes its answers in new coding sessions, by name. Chats have
 * their own instructions and are not changed.
 */
function OutputStyleField({
  value,
  onChange,
  onType,
  onDone,
}: {
  value: string
  onChange: (v: string) => void
  onType: (v: string) => void
  onDone: () => void
}) {
  const [own, setOwn] = useState(value !== "" && !BUILT_IN_STYLES.includes(value))
  const choice = own ? "own" : value
  return (
    <>
      <Field
        label="How Claude writes its answers in new coding sessions"
        help="Default is Claude Code's usual way. Explanatory adds notes on why it did things; Learning leaves small parts for you to write. Your own style is one you saved in Claude Code's output styles folder, chosen by its name. Sessions already open keep theirs; chats are not changed."
      >
        <select
          className="field"
          value={choice}
          onChange={(e) => {
            const next = e.target.value
            setOwn(next === "own")
            onChange(next === "own" ? "" : next)
          }}
        >
          <option value="">Default</option>
          {BUILT_IN_STYLES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
          <option value="own">Your own…</option>
        </select>
      </Field>
      {own ? (
        <Field
          label="Your style's name"
          help="As its file names it, without .md. Letters, numbers, spaces, dots, dashes and underscores."
        >
          <input
            className="field"
            value={value}
            maxLength={60}
            onChange={(e) => onType(e.target.value)}
            onBlur={onDone}
            onKeyDown={(e) => e.key === "Enter" && onDone()}
            aria-invalid={value.trim() !== "" && !STYLE_NAME.test(value.trim())}
          />
        </Field>
      ) : null}
    </>
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
  const { query } = useContext(SettingsView)
  const match = query !== "" && `${label} ${help ?? ""}`.toLowerCase().includes(query)
  return (
    <label
      className={match ? "grid gap-1 rounded-md bg-hi px-2 py-1" : "grid gap-1"}
      data-match={match || undefined}
    >
      <span>{label}</span>
      {children}
      {help ? <span className="text-xs text-mut">{help}</span> : null}
    </label>
  )
}
