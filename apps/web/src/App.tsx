import { lazy, Suspense, useEffect, useState } from "react"
import { Toaster } from "sonner"
import { CommandPalette } from "./components/CommandPalette"
import { Approvals } from "./surfaces/Approvals"
import { Devices } from "./surfaces/Devices"
import { FirstRun } from "./surfaces/FirstRun"
import { Setup } from "./surfaces/Setup"
import { JcvcBackdrop } from "./components/JcvcBackdrop"
import { HelpPane } from "./components/HelpPane"
import { Rail } from "./components/Rail"
import { UpdateResult } from "./components/UpdateNotice"
import { Guide } from "./surfaces/Guide"
import { Sessions } from "./surfaces/Sessions"
import { usePendingCount, useStore } from "./store"

const Audit = lazy(() => import("./surfaces/Audit").then((m) => ({ default: m.Audit })))
const Policy = lazy(() => import("./surfaces/Policy").then((m) => ({ default: m.Policy })))
const Approver = lazy(() => import("./surfaces/Approver").then((m) => ({ default: m.Approver })))
const Settings = lazy(() => import("./surfaces/Settings").then((m) => ({ default: m.Settings })))
const Workspace = lazy(() => import("./surfaces/Workspace").then((m) => ({ default: m.Workspace })))
const NewChat = lazy(() => import("./surfaces/NewChat").then((m) => ({ default: m.NewChat })))

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
  const hideRail = (hidden: boolean) => {
    localStorage.setItem(RAIL_HIDDEN, hidden ? "1" : "")
    setRailHidden(hidden)
  }

  // F1 opens and closes the help for the page you are on. Ctrl+B hides and shows the sidebar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F1") {
        e.preventDefault()
        setHelpOpen(!useStore.getState().helpOpen)
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault()
        setRailHidden((h) => {
          localStorage.setItem(RAIL_HIDDEN, h ? "" : "1")
          return !h
        })
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [setHelpOpen])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // Jean-Claude mode is the only look (owner, 28 Oct): it comes in a light and a dark version and cannot be turned off.
  useEffect(() => {
    document.documentElement.dataset.jcvc = "on"
  }, [])

  // First launch: the setup wizard, once. It can be run again from Settings.
  useEffect(() => {
    if (!setupDone && route === "approvals") setRoute("setup")
  }, [setupDone, route, setRoute])

  // First run: show the checks until the account and organisation are fine.
  useEffect(() => {
    if (
      health &&
      setupDone &&
      health.signin.checked !== false &&
      (!health.signin.signedIn || !health.signin.orgOk) &&
      route === "approvals"
    )
      setRoute("first-run")
  }, [health, route, setRoute])

  const killed = health?.killSwitch.engaged ?? false

  return (
    <>
      <div className="app-shell" data-rail={railHidden ? "hidden" : undefined}>
        <a
          href="#main"
          onClick={(e) => {
            e.preventDefault()
            document.getElementById("main")?.focus()
          }}
          className="absolute left-2 top-2 z-50 -translate-y-16 rounded bg-sign px-3 py-1.5 text-sign-tx focus:translate-y-0"
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
          <Rail onHide={() => hideRail(true)} />
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
                {route === "chat" && <NewChat />}
              </Suspense>
            </main>
            <HelpPane />
          </div>
        </div>
      </div>
      {/* Outside the layout grid: each of these would otherwise take a row of it. */}
      <CommandPalette />
      <JcvcBackdrop />
      <Toaster position="bottom-right" theme={theme} closeButton />
    </>
  )
}
