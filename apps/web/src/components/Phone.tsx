import { type ReactNode, useState } from "react"
import { cnwComputer } from "../lib/cnwConnection"
import { age } from "../lib/format"
import { setPhoneList, usePhoneList } from "../lib/phone"
import { sideOf } from "../lib/lastOpen"
import type { RailMode } from "../lib/railMode"
import { switchSide } from "../lib/switchSide"
import { useNow } from "../lib/useNow"
import type { SessionInfo } from "@gatehouse/shared/ws-protocol"
import { type Route, usePendingCount, useSessionList, useStore } from "../store"
import { Sessions } from "../surfaces/Sessions"
import { Icon, type IconName } from "./Icon"

/**
 * O55: the phone screens (`docs/design/phone-layout.md`). A bottom tab bar in place of the sidebar; the sessions as a
 * screen of their own; a session full-screen with a back button; pages made for a big screen say so. Only the layout
 * is the phone's: every request still goes to the same approval card, with every check it has on a computer.
 */

/** The pages a phone draws. The rest say "Open this on a computer" rather than being squeezed in. */
export const PHONE_PAGES: ReadonlySet<Route> = new Set<Route>([
  "approvals",
  "sessions",
  "workspace",
  "chat",
  "more",
  "first-run",
  "setup",
  "imported",
  "usage",
  "dashboard",
])

type Tab = "needs" | "code" | "chat" | "more"

/** The tab a page belongs to. */
export function tabOf(route: Route, list: RailMode, selected: SessionInfo | undefined): Tab {
  if (route === "approvals") return "needs"
  if (route === "workspace") return selected ? sideOf(selected) : "code"
  if (route === "sessions") return list
  if (route === "chat" || route === "projects" || route === "memory" || route === "prompts") return "chat"
  return "more"
}

/** The tab bar across the foot of the screen. A tab keeps its place (O54); the tab you are on goes back to its list. */
export function PhoneTabs() {
  const route = useStore((s) => s.route)
  const setRoute = useStore((s) => s.setRoute)
  const selected = useStore((s) => (s.selectedSession ? s.sessions[s.selectedSession] : undefined))
  const list = usePhoneList()
  const pending = usePendingCount()
  const working = useSessionList().filter((s) => s.kind !== "chat" && s.state === "running").length
  const current = tabOf(route, list, selected)
  const side = (m: RailMode) => {
    setPhoneList(m)
    if (current === m) setRoute("sessions")
    else switchSide(m, "sessions")
  }
  const tabs: { id: Tab; label: string; icon: IconName; badge?: string; go: () => void }[] = [
    { id: "needs", label: "Needs you", icon: "needs-you", ...(pending ? { badge: String(pending) } : {}), go: () => setRoute("approvals") },
    { id: "code", label: "Sessions", icon: "code", ...(working ? { badge: String(working) } : {}), go: () => side("code") },
    { id: "chat", label: "Ask", icon: "chat", go: () => side("chat") },
    { id: "more", label: "More", icon: "more", go: () => setRoute("more") },
  ]
  return (
    <nav className="phone-tabs" aria-label="Sections">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          className="phone-tab"
          aria-current={current === t.id ? "page" : undefined}
          aria-label={t.badge ? `${t.label}, ${t.badge}` : t.label}
          onClick={t.go}
        >
          <Icon name={t.icon} />
          <span>{t.label}</span>
          {t.badge ? (
            <span className="phone-badge" aria-hidden="true">
              {t.badge}
            </span>
          ) : null}
        </button>
      ))}
    </nav>
  )
}

/** The bar over a screen you went into: back where you came from, and its name. */
export function PhoneBack({ label, title, onBack }: { label: string; title?: string; onBack: () => void }) {
  return (
    <div className="phone-bar">
      <button type="button" className="phone-back" onClick={onBack} aria-label={`Back to ${label}`}>
        <span aria-hidden="true">‹</span> {label}
      </button>
      {title ? <h1 className="phone-title">{title}</h1> : null}
    </div>
  )
}

/** At the start of a session's head on a phone: back to its list (Sessions, or Ask for a question). */
export function PhoneSessionBack({ session }: { session: SessionInfo }) {
  const setRoute = useStore((st) => st.setRoute)
  const side = sideOf(session)
  const label = side === "chat" ? "Ask" : "Sessions"
  return (
    <button
      type="button"
      className="phone-back"
      aria-label={`Back to ${label}`}
      onClick={() => {
        setPhoneList(side)
        setRoute("sessions")
      }}
    >
      <span aria-hidden="true">‹</span>
    </button>
  )
}

/**
 * A session's side panels on a phone: one Panels button, which opens them as a sheet up from the foot; choosing one
 * opens it (as a sheet too) and puts this one away.
 */
export function PhonePanels({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn phone-panels-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="files" /> Panels
      </button>
      {open ? (
        <div className="phone-sheet" role="dialog" aria-modal="true" aria-label="Panels">
          <div className="phone-sheet-head">
            <h2 className="m-0 text-[17px]">Panels</h2>
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
          <div
            className="phone-panel-list"
            onClickCapture={(e) => {
              if ((e.target as HTMLElement).closest("button")) setTimeout(() => setOpen(false))
            }}
          >
            {children}
          </div>
        </div>
      ) : null}
    </>
  )
}

const STATE_ORDER: Record<string, number> = { waiting: 0, running: 1, starting: 2, idle: 3, error: 4, ended: 5 }

function stateOf(s: SessionInfo): { text: string; icon: IconName; tone: string } {
  if (s.paused) return { text: "Paused", icon: "paused", tone: "is-warn" }
  if (s.state === "waiting") return { text: "Needs you", icon: "needs-you", tone: "is-warn" }
  if (s.state === "running") return { text: "Working", icon: "working", tone: "is-run" }
  if (s.state === "starting") return { text: "Starting", icon: "waiting", tone: "" }
  if (s.state === "error") return { text: "Stopped", icon: "failed", tone: "is-sev" }
  if (s.state === "ended") return { text: "Ended", icon: "ended", tone: "" }
  return { text: "Ready", icon: "done", tone: "" }
}

/** The list a Sessions or Ask tab opens on: needs you first, then working, then the rest; ended ones last. */
export function PhoneSessions() {
  const side = usePhoneList()
  const now = useNow()
  const selectSession = useStore((s) => s.selectSession)
  const setRoute = useStore((s) => s.setRoute)
  const [starting, setStarting] = useState(false)
  const all = useSessionList().filter((s) => sideOf(s) === side && !s.archived)
  const live = all.filter((s) => s.state !== "ended")
  const ended = all.filter((s) => s.state === "ended")
  const sorted = [
    ...[...live].sort((a, b) => (STATE_ORDER[a.state] ?? 9) - (STATE_ORDER[b.state] ?? 9) || (b.activeAt ?? b.createdAt).localeCompare(a.activeAt ?? a.createdAt)),
    ...[...ended].sort((a, b) => (b.activeAt ?? b.createdAt).localeCompare(a.activeAt ?? a.createdAt)).slice(0, 10),
  ]
  if (starting && side === "code")
    return (
      <div className="phone-screen">
        <PhoneBack label="Sessions" onBack={() => setStarting(false)} />
        <Sessions />
      </div>
    )
  const computer = cnwComputer()
  return (
    <div className="phone-screen">
      <div className="phone-head">
        <h1 className="m-0 text-[28px]">{side === "chat" ? "Ask about code" : "Sessions"}</h1>
        {computer ? (
          <a className="phone-link" href="/">
            All computers
          </a>
        ) : null}
      </div>
      <button
        type="button"
        className="btn btn-primary phone-wide"
        onClick={() => (side === "chat" ? setRoute("chat") : setStarting(true))}
      >
        <Icon name="new" /> {side === "chat" ? "New question" : "New session"}
      </button>
      {sorted.length === 0 ? (
        <p className="text-mut">{side === "chat" ? "No questions yet." : "No sessions on this computer yet."}</p>
      ) : (
        <ul className="phone-list" aria-label={side === "chat" ? "Questions" : "Sessions"}>
          {sorted.map((s) => {
            const st = stateOf(s)
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className="phone-row"
                  data-state={s.state}
                  onClick={() => {
                    selectSession(s.id)
                    setRoute("workspace")
                  }}
                >
                  <span className="phone-row-main">
                    <span className="phone-row-name">{s.title ?? s.project}</span>
                    <span className="phone-row-sub">
                      {s.title ? `${s.project}, ` : ""}
                      {age(s.activeAt ?? s.createdAt, now)} ago
                    </span>
                  </span>
                  <span className={`phone-state ${st.tone}`}>
                    <Icon name={st.icon} /> {st.text}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** More: the other pages, the computers in Neighbourhood Watch, and the kill switch (a phone can always use it). */
export function PhoneMore() {
  const setRoute = useStore((s) => s.setRoute)
  const killed = useStore((s) => s.health?.killSwitch.engaged ?? false)
  const pages: { route: Route; label: string; icon: IconName }[] = [
    { route: "dashboard", label: "Dashboard", icon: "home" },
    { route: "usage", label: "Usage", icon: "usage" },
    { route: "board", label: "Board", icon: "projects" },
    { route: "policy", label: "Policy", icon: "policy" },
    { route: "audit", label: "Audit log", icon: "audit-log" },
    { route: "approver", label: "Approver", icon: "approver" },
    { route: "mcp", label: "MCP servers", icon: "marketplace" },
    { route: "marketplace", label: "Marketplace", icon: "marketplace" },
    { route: "devices", label: "Devices", icon: "devices" },
    { route: "settings", label: "Settings", icon: "settings" },
  ]
  return (
    <div className="phone-screen">
      <div className="phone-head">
        <h1 className="m-0 text-[28px]">More</h1>
      </div>
      {cnwComputer() ? (
        <a className="btn phone-wide" href="/">
          <Icon name="devices" /> All computers
        </a>
      ) : null}
      <ul className="phone-list" aria-label="Pages">
        {pages.map((p) => (
          <li key={p.route}>
            <button type="button" className="phone-row" onClick={() => setRoute(p.route)}>
              <span className="phone-row-main">
                <span className="phone-row-name">
                  <Icon name={p.icon} /> {p.label}
                </span>
                {PHONE_PAGES.has(p.route) ? null : <span className="phone-row-sub">Best on a computer</span>}
              </span>
              <span aria-hidden="true" className="text-mut">
                ›
              </span>
            </button>
          </li>
        ))}
      </ul>
      {killed ? (
        <p className="phone-note is-sev" role="status">
          The kill switch is on. Every request is denied until you re-arm it on a computer.
        </p>
      ) : (
        <button
          type="button"
          className="btn btn-deny phone-wide"
          onClick={() => window.dispatchEvent(new Event("codeh:kill"))}
        >
          <Icon name="kill-switch" /> Kill switch
        </button>
      )}
    </div>
  )
}

/** A page made for a big screen, opened on a phone. */
export function PhoneElsewhere({ route }: { route: Route }) {
  const setRoute = useStore((s) => s.setRoute)
  return (
    <div className="phone-screen">
      <PhoneBack label="More" onBack={() => setRoute("more")} />
      <div className="phone-elsewhere">
        <h1 className="m-0 text-[22px]">Open this on a computer</h1>
        <p className="text-mut">
          {route === "policy" || route === "approver"
            ? "Rules are edited where you can see them whole, with their tests beside them."
            : "This page is made for a bigger screen, and a phone would squeeze it."}{" "}
          Open Codehouse on a computer, or this address in a wider window:
        </p>
        <p className="phone-address mono">{location.href}</p>
      </div>
    </div>
  )
}
