import { useAppearance } from "./components/SettingsPanels"
import { lazy, Suspense, useEffect, useState } from "react"
import { Toaster } from "sonner"
import { Announcer } from "./components/Announcer"
import { CommandDeck } from "./components/CommandDeck"
import { ExportDialog } from "./components/ExportDialog"
import { CommandPalette } from "./components/CommandPalette"
import { Approvals } from "./surfaces/Approvals"
import { Devices } from "./surfaces/Devices"
import { FirstRun } from "./surfaces/FirstRun"
import { Setup } from "./surfaces/Setup"
import { HelpPane } from "./components/HelpPane"
import { Rail } from "./components/Rail"
import { RailResizer, savedRailWidth } from "./components/RailResizer"
import { ShortcutSheet } from "./components/ShortcutSheet"
import { railOrder, readHideEnded } from "./lib/rail"
import { copyLatest } from "./lib/sessionActions"
import { startShell } from "./lib/quickKey"
import { UpdateNotice, UpdateResult } from "./components/UpdateNotice"
import { Guide } from "./surfaces/Guide"
import { Sessions } from "./surfaces/Sessions"
import { START_ROUTE, usePendingCount, useStore } from "./store"

const Audit = lazy(() => import("./surfaces/Audit").then((m) => ({ default: m.Audit })))
const Policy = lazy(() => import("./surfaces/Policy").then((m) => ({ default: m.Policy })))
const Approver = lazy(() => import("./surfaces/Approver").then((m) => ({ default: m.Approver })))
const Settings = lazy(() => import("./surfaces/Settings").then((m) => ({ default: m.Settings })))
const Workspace = lazy(() => import("./surfaces/Workspace").then((m) => ({ default: m.Workspace })))
const NewChat = lazy(() => import("./surfaces/NewChat").then((m) => ({ default: m.NewChat })))
const Usage = lazy(() => import("./surfaces/Usage").then((m) => ({ default: m.Usage })))
const MemoryPage = lazy(() => import("./surfaces/Memory").then((m) => ({ default: m.MemoryPage })))
const ImportedChat = lazy(() =>
  import("./surfaces/ImportedChat").then((m) => ({ default: m.ImportedChat })),
)
const Marketplace = lazy(() =>
  import("./surfaces/Marketplace").then((m) => ({ default: m.Marketplace })),
)
const Home = lazy(() => import("./surfaces/Home").then((m) => ({ default: m.Home })))
const Doctor = lazy(() => import("./surfaces/Doctor").then((m) => ({ default: m.Doctor })))
const Prompts = lazy(() => import("./surfaces/Prompts").then((m) => ({ default: m.Prompts })))
const Projects = lazy(() => import("./surfaces/Projects").then((m) => ({ default: m.Projects })))
const Dashboard = lazy(() => import("./surfaces/Dashboard").then((m) => ({ default: m.Dashboard })))

const RAIL_HIDDEN = "gatehouse.rail.hidden"

export function App() {
  const route = useStore((s) => s.route)
  const setRoute = useStore((s) => s.setRoute)
  const conn = useStore((s) => s.conn)
  const health = useStore((s) => s.health)
  const theme = useStore((s) => s.theme)
  const setupDone = useStore((s) => s.setupDone)
  const setHelpOpen = useStore((s) => s.setHelpOpen)
  const pendingCount = usePendingCount()
  const [railHidden, setRailHidden] = useState(() => localStorage.getItem(RAIL_HIDDEN) === "1")
  const [railWidth, setRailWidth] = useState(savedRailWidth)
  const hideRail = (hidden: boolean) => {
    localStorage.setItem(RAIL_HIDDEN, hidden ? "1" : "")
    setRailHidden(hidden)
  }

  // F1 opens and closes the help for the page you are on. Ctrl+B hides and shows the sidebar (the palette does too,
  // through an event). Ctrl+1 to 9 show the session in that place in the sidebar (owner's plan, W1-05).
  useEffect(() => {
    const flipRail = () =>
      setRailHidden((h) => {
        localStorage.setItem(RAIL_HIDDEN, h ? "" : "1")
        return !h
      })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F1") {
        e.preventDefault()
        setHelpOpen(!useStore.getState().helpOpen)
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.code === "KeyK") {
        // The kill switch asks first; this only opens the question.
        e.preventDefault()
        window.dispatchEvent(new Event("codeh:kill"))
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.code === "KeyC") {
        e.preventDefault()
        void copyLatest("reply")
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.code === "Semicolon") {
        e.preventDefault()
        void copyLatest("code")
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault()
        flipRail()
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        const st = useStore.getState()
        const shown = new Set(
          st.route === "workspace" ? (st.panes.length ? st.panes : [st.selectedSession]) : [],
        )
        const target = railOrder(Object.values(st.sessions), readHideEnded(), shown)[
          Number(e.key) - 1
        ]
        if (!target) return
        e.preventDefault()
        st.selectSession(target.id)
        st.setRoute("workspace")
      }
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("codeh:toggle-rail", flipRail)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("codeh:toggle-rail", flipRail)
    }
  }, [setHelpOpen])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // In the Codehouse window: the quick prompt's shortcut, and what the quick prompt sent (W1-15).
  useEffect(() => startShell(), [])
  // Settings, General, Appearance: width, code font and size, and movement (owner, 4 Nov).
  useAppearance()

  // First launch: the setup wizard, once. It can be run again from Settings.
  useEffect(() => {
    if (!setupDone && (route === "approvals" || route === START_ROUTE)) setRoute("setup")
  }, [setupDone, route, setRoute])

  // First run: show the checks until the account and organisation are fine.
  useEffect(() => {
    if (
      health &&
      setupDone &&
      health.signin.checked !== false &&
      (!health.signin.signedIn || !health.signin.orgOk) &&
      (route === "approvals" || route === START_ROUTE)
    )
      setRoute("first-run")
  }, [health, route, setRoute])

  const killed = health?.killSwitch.engaged ?? false

  return (
    <>
      {/* A newer version: one thin bar across the top, above the sidebar and the page. */}
      <div className="flex h-full flex-col">
        <UpdateNotice />
        <CommandDeck />
        <div
          className="app-shell min-h-0 flex-1"
          data-rail={railHidden ? "hidden" : undefined}
          style={{ "--rail-w": `${railWidth}px` } as React.CSSProperties}
        >
          <a
            href="#main"
            onClick={(e) => {
              e.preventDefault()
              document.getElementById("main")?.focus()
            }}
            className="fixed left-2 top-2 z-50 -translate-y-16 rounded bg-sign px-3 py-1.5 text-sign-tx focus:translate-y-0"
          >
            Skip to content
          </a>
          {railHidden ? (
            <button type="button" className="btn show-rail" onClick={() => hideRail(false)}>
              <span aria-hidden="true">&raquo;</span> Sidebar
              {pendingCount > 0 ? (
                <span className="font-semibold">, {pendingCount} need you</span>
              ) : null}
            </button>
          ) : (
            <>
              <Rail onHide={() => hideRail(true)} />
              <RailResizer width={railWidth} onChange={setRailWidth} />
            </>
          )}
          <div className="grid min-h-0 min-w-0 grid-rows-[auto_1fr]">
            {conn !== "open" ? (
              <div
                role="alert"
                className="border-b border-sev bg-s1 px-4 py-2 font-semibold text-sev"
              >
                Not connected to the Host. Decisions are paused, and requests keep waiting.
                Reconnecting automatically.
              </div>
            ) : killed ? (
              <div
                role="alert"
                className="border-b border-sev bg-s1 px-4 py-2 font-semibold text-sev"
              >
                Kill switch engaged. Every request is denied and no session can start until you
                re-arm.
              </div>
            ) : (
              <div />
            )}
            <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_auto]">
              <main
                id="main"
                tabIndex={-1}
                // The workspace fills the window and scrolls only its transcript, so the prompt box always shows.
                className={
                  route === "workspace"
                    ? "flex min-h-0 flex-col overflow-hidden outline-none"
                    : "min-h-0 overflow-auto outline-none"
                }
                data-rail={railHidden ? "hidden" : undefined}
              >
                <UpdateResult />
                <Suspense fallback={<p className="p-6 text-mut">Loading…</p>}>
                  {route === "approvals" && <Approvals />}
                  {route === "sessions" && <Sessions />}
                  {route === "workspace" && <Workspace />}
                  {route === "policy" && <Policy />}
                  {route === "audit" && <Audit />}
                  {route === "devices" && <Devices />}
                  {route === "settings" && <Settings />}
                  {route === "first-run" && <FirstRun />}
                  {route === "setup" && <Setup />}
                  {route === "guide" && <Guide />}
                  {route === "approver" && <Approver />}
                  {route === "usage" && <Usage />}
                  {route === "dashboard" && <Dashboard />}
                  {route === "chat" && <NewChat />}
                  {route === "projects" && <Projects />}
                  {route === "memory" && <MemoryPage />}
                  {route === "prompts" && <Prompts />}
                  {route === "marketplace" && <Marketplace />}
                  {route === "doctor" && <Doctor />}
                  {route === "home" && <Home />}
                  {route === "imported" && <ImportedChat />}
                </Suspense>
              </main>
              <HelpPane />
            </div>
          </div>
        </div>
      </div>
      {/* Outside the layout grid: each of these would otherwise take a row of it. */}
      <CommandPalette />
      <Announcer />
      <ExportDialog />
      <ShortcutSheet />
      <Toaster position="bottom-right" theme={theme} closeButton />
    </>
  )
}
