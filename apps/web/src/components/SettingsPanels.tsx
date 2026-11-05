import clsx from "clsx"
import { useEffect, useId, useState } from "react"
import {
  applyAppearance,
  CODE_SIZES,
  cleanFont,
  readAppearance,
  saveAppearance,
  type Appearance,
} from "../lib/appearance"
import { readKinds, saveKinds, type NotifyKinds } from "../lib/notifyKinds"
import { useNow } from "../lib/useNow"
import { useStore } from "../store"
import { ago, money, PLAN_HIGH, readPlan, resets, type PlanUsage } from "./PlanMeter"

/**
 * Panels for the Settings sections added on 4 Nov, after Claude's desktop app (owner: "I want this level of UI and
 * features"): Appearance, your usage limits, and the pages under Customize. Each is Codehouse's own look.
 */

/** One row: a label and what it does on the left, the control on the right. */
function Row({
  label,
  help,
  children,
}: {
  label: string
  help?: string
  children: (id: string) => React.ReactNode
}) {
  const id = useId()
  return (
    <div className="settings-row">
      <span className="grid gap-0.5">
        <label htmlFor={id}>{label}</label>
        {help ? <span className="text-xs text-mut">{help}</span> : null}
      </span>
      {children(id)}
    </div>
  )
}

/** Settings, General, Appearance: the theme, how a conversation shows, code and movement. */
export function AppearancePanel() {
  const theme = useStore((s) => s.theme)
  const follows = useStore((s) => s.themeFollows)
  const [a, setA] = useState<Appearance>(readAppearance)
  const [font, setFont] = useState(a.codeFont)
  const set = (patch: Partial<Appearance>) => {
    const next = { ...a, ...patch }
    setA(next)
    saveAppearance(next)
  }
  return (
    <div className="grid gap-1">
      <Row label="Theme" help="Following Windows changes with it while Codehouse runs.">
        {(id) => (
          <select
            id={id}
            className="field w-auto"
            value={follows ? "system" : theme}
            onChange={(e) => {
              const v = e.target.value
              if (v === "system") useStore.getState().followSystem()
              else useStore.getState().setTheme(v as "light" | "dark")
            }}
          >
            <option value="system">Follow Windows</option>
            <option value="light">Codehouse light</option>
            <option value="dark">Codehouse dark</option>
          </select>
        )}
      </Row>
      <Row
        label="Transcript text size"
        help="How a conversation opens; each pane's own menu still changes it."
      >
        {(id) => (
          <select
            id={id}
            className="field w-auto"
            value={a.textSize}
            onChange={(e) => set({ textSize: Number(e.target.value) as Appearance["textSize"] })}
          >
            <option value={90}>Small</option>
            <option value={100}>Medium</option>
            <option value={115}>Large</option>
            <option value={130}>Larger</option>
          </select>
        )}
      </Row>
      <Row label="Transcript width">
        {(id) => (
          <select
            id={id}
            className="field w-auto"
            value={a.width}
            onChange={(e) => set({ width: e.target.value as Appearance["width"] })}
          >
            <option value="narrow">Narrow</option>
            <option value="wide">Wide</option>
          </select>
        )}
      </Row>
      <Row
        label="Default transcript view"
        help="Summary keeps what you and Claude say; Verbose opens every tool call and Claude's thinking."
      >
        {(id) => (
          <select
            id={id}
            className="field w-auto"
            value={a.detail}
            onChange={(e) => set({ detail: e.target.value as Appearance["detail"] })}
          >
            <option value="summary">Summary</option>
            <option value="normal">Normal</option>
            <option value="verbose">Verbose</option>
          </select>
        )}
      </Row>
      <Row label="Motion" help="Reduce turns off movement and animation, whatever Windows says.">
        {(id) => (
          <select
            id={id}
            className="field w-auto"
            value={a.motion}
            onChange={(e) => set({ motion: e.target.value as Appearance["motion"] })}
          >
            <option value="system">Follow Windows</option>
            <option value="reduced">Reduce</option>
          </select>
        )}
      </Row>
      <Row
        label="Code font"
        help="A monospace font installed on this computer, for code, files, diffs and the terminal."
      >
        {(id) => (
          <input
            id={id}
            className="field mono w-56"
            placeholder="Cascadia Mono"
            value={font}
            maxLength={60}
            onChange={(e) => setFont(e.target.value)}
            onBlur={() => set({ codeFont: cleanFont(font) })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                set({ codeFont: cleanFont(font) })
              }
            }}
          />
        )}
      </Row>
      <Row
        label="Code font size"
        help="Applies to code blocks, open files, diffs and command output."
      >
        {(id) => (
          <select
            id={id}
            className="field w-auto"
            value={a.codeSize}
            onChange={(e) => set({ codeSize: Number(e.target.value) })}
          >
            {CODE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n ? `${n} px` : "Default"}
              </option>
            ))}
          </select>
        )}
      </Row>
    </div>
  )
}

/** Which Windows notifications you get, each on its own; they need notifications on above. */
export function NotifyKindsSetting({ on }: { on: boolean }) {
  const [k, setK] = useState<NotifyKinds>(readKinds)
  const set = (patch: Partial<NotifyKinds>) => {
    const next = { ...k, ...patch }
    setK(next)
    saveKinds(next)
  }
  const box = (key: keyof NotifyKinds, label: string, help: string) => (
    <label className="flex items-start gap-2 pl-6">
      <input
        type="checkbox"
        className="mt-1"
        disabled={!on}
        checked={k[key]}
        onChange={(e) => set({ [key]: e.target.checked })}
      />
      <span className="grid">
        <span>{label}</span>
        <span className="text-xs text-mut">{help}</span>
      </span>
    </label>
  )
  return (
    <div className="grid gap-1.5" role="group" aria-label="Which notifications">
      {box(
        "requests",
        "Requests that need you",
        "An action, a question or a plan waiting on your decision.",
      )}
      {box(
        "completions",
        "Response completions",
        "When a reply that took a while finishes and Codehouse is not in front. Useful for long tasks.",
      )}
      {box("queueEmpty", "Build queue empty", "When a session says its build queue is empty.")}
    </div>
  )
}

/** Put the kept appearance on the page once the window opens. */
export function useAppearance(): void {
  useEffect(() => applyAppearance(readAppearance()), [])
}

/** Settings, Usage: the plan's limits in full, as the ring beside the prompt box shows them. */
export function UsageLimitsPanel() {
  const account = useStore((s) => s.activeAccount)
  const [u, setU] = useState<PlanUsage | null | undefined>()
  const now = useNow(30_000)
  const read = (fresh = false) => void readPlan(account, fresh).then(setU)
  useEffect(() => read(), [account])
  if (u === undefined) return <p className="m-0 text-mut">Reading your plan&apos;s limits…</p>
  if (!u || (!u.limits.length && !u.extra))
    return (
      <p className="m-0 text-mut">
        No limits to show yet. They appear once a session is open on this account.
      </p>
    )
  return (
    <div className="grid gap-3">
      {u.plan ? <p className="m-0 text-sm font-semibold">Plan: {u.plan}</p> : null}
      {u.limits.map((l) => (
        <div key={l.label} className="grid gap-1">
          <span className="flex justify-between gap-3 text-sm">
            <span>{l.label}</span>
            <span className="text-mut">
              {[resets(l.resetsAt, now), `${Math.round(l.percent)}% used`]
                .filter(Boolean)
                .join(", ")}
            </span>
          </span>
          <span className="plan-bar" aria-hidden="true">
            <span
              className={clsx("plan-bar-fill", l.percent >= PLAN_HIGH && "plan-ring-high")}
              style={{ width: `${Math.min(100, l.percent)}%` }}
            />
          </span>
        </div>
      ))}
      {u.extra ? (
        <p className="m-0 text-sm">
          Extra usage: {money(u.extra.used, u.extra.currency)} of{" "}
          {money(u.extra.limit, u.extra.currency)}
        </p>
      ) : null}
      <span className="flex items-center gap-2 text-xs text-mut">
        Last updated {ago(u.at, now)}
        <button type="button" className="btn !min-h-7" onClick={() => read(true)}>
          Refresh
        </button>
        <button
          type="button"
          className="btn !min-h-7"
          onClick={() => useStore.getState().setRoute("usage")}
        >
          Open the Usage page
        </button>
      </span>
    </div>
  )
}

/** A Settings section that is a page of its own elsewhere: what it holds, and the way there. */
export function GoTo({
  text,
  label,
  route,
}: {
  text: string
  label: string
  route: Parameters<ReturnType<typeof useStore.getState>["setRoute"]>[0]
}) {
  return (
    <div className="grid gap-2">
      <p className="m-0 text-[13.5px] text-mut">{text}</p>
      <span>
        <button type="button" className="btn" onClick={() => useStore.getState().setRoute(route)}>
          {label}
        </button>
      </span>
    </div>
  )
}
