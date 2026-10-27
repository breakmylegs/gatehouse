import NumberFlow from "@number-flow/react"
import clsx from "clsx"
import { lazy, Suspense, useEffect } from "react"
import { Toaster } from "sonner"
import { Approvals } from "./surfaces/Approvals"
import { Devices } from "./surfaces/Devices"
import { FirstRun } from "./surfaces/FirstRun"
import { Sessions } from "./surfaces/Sessions"
import { type Route, send, usePendingCount, useStore } from "./store"

const Audit = lazy(() => import("./surfaces/Audit").then((m) => ({ default: m.Audit })))
const Policy = lazy(() => import("./surfaces/Policy").then((m) => ({ default: m.Policy })))
const Settings = lazy(() => import("./surfaces/Settings").then((m) => ({ default: m.Settings })))
const Workspace = lazy(() => import("./surfaces/Workspace").then((m) => ({ default: m.Workspace })))

const NAV: Array<{ route: Route; label: string }> = [
  { route: "approvals", label: "Approvals" },
  { route: "sessions", label: "Sessions" },
  { route: "workspace", label: "Workspace" },
  { route: "policy", label: "Policy" },
  { route: "audit", label: "Audit log" },
  { route: "devices", label: "Devices" },
  { route: "settings", label: "Settings" },
]

export function App() {
  const route = useStore((s) => s.route)
  const setRoute = useStore((s) => s.setRoute)
  const conn = useStore((s) => s.conn)
  const attempt = useStore((s) => s.attempt)
  const health = useStore((s) => s.health)
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const pendingCount = usePendingCount()

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // First run: show the checks until the account and organisation are fine.
  useEffect(() => {
    if (health && (!health.signin.signedIn || !health.signin.orgOk) && route === "approvals")
      setRoute("first-run")
  }, [health, route, setRoute])

  const killed = health?.killSwitch.engaged ?? false

  return (
    <div className="grid h-full grid-rows-[auto_auto_1fr]">
      <a
        href="#main"
        onClick={(e) => {
          e.preventDefault()
          document.getElementById("main")?.focus()
        }}
        className="absolute left-2 top-2 z-50 -translate-y-16 rounded bg-s1 px-3 py-1.5 focus:translate-y-0"
      >
        Skip to content
      </a>
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-s1 px-4 py-2">
        <strong className="mr-2 text-sm">Gatehouse</strong>
        <button
          className="btn"
          onClick={() => setRoute("approvals")}
          aria-label={`Approvals, ${pendingCount} waiting`}
        >
          Needs you <NumberFlow value={pendingCount} className="font-semibold" />
        </button>
        <StatusPill
          ok={conn === "open"}
          label={
            conn === "open"
              ? "Host connected"
              : conn === "connecting"
                ? `Connecting${attempt ? ` (try ${attempt + 1})` : ""}`
                : "Host disconnected"
          }
        />
        {health ? (
          <>
            <StatusPill
              ok={health.approver.state === "up"}
              label={`Approver ${health.approver.state === "up" ? "up" : health.approver.state}`}
            />
            <StatusPill
              ok={health.relay.state === "connected"}
              neutral={health.relay.state === "not-configured"}
              label={
                health.relay.state === "not-configured"
                  ? "Phone relay not set up"
                  : health.relay.state === "connected"
                    ? `Phone relay connected, ${health.relay.devices} device${health.relay.devices === 1 ? "" : "s"}`
                    : "Phone relay unreachable"
              }
            />
          </>
        ) : null}
        <span className="ml-auto" />
        <button className="btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? "Light theme" : "Dark theme"}
        </button>
        {killed ? (
          <button className="btn btn-primary" onClick={() => void send({ type: "rearm" })}>
            Re-arm sessions
          </button>
        ) : (
          <button
            className="btn btn-deny"
            onClick={() => {
              if (
                window.confirm(
                  "Stop everything now? This denies all pending requests and refuses new sessions until you re-arm.",
                )
              )
                void send({ type: "kill" })
            }}
          >
            Kill switch
          </button>
        )}
      </header>
      {killed ? (
        <div role="alert" className="border-b border-sev bg-s2 px-4 py-2 font-semibold text-sev">
          Kill switch engaged. Every request is denied and no session can start until you re-arm.
        </div>
      ) : (
        <div />
      )}
      <div className="grid min-h-0 grid-cols-[190px_1fr] max-[900px]:grid-cols-1">
        <nav
          aria-label="Surfaces"
          className="overflow-auto border-r border-line bg-s1 p-2 max-[900px]:border-b max-[900px]:border-r-0"
        >
          <ul className="m-0 grid list-none gap-0.5 p-0 max-[900px]:grid-flow-col">
            {NAV.map((n) => (
              <li key={n.route}>
                <button
                  className={clsx(
                    "flex w-full items-center justify-between rounded-md border-0 bg-transparent px-2.5 py-1.5 text-left hover:bg-s2",
                    route === n.route && "bg-s2 font-semibold",
                  )}
                  aria-current={route === n.route ? "page" : undefined}
                  onClick={() => setRoute(n.route)}
                >
                  {n.label}
                  {n.route === "approvals" && pendingCount > 0 ? (
                    <span className="rounded-full bg-acc px-2 text-xs font-semibold text-acc-tx">
                      {pendingCount}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <main id="main" tabIndex={-1} className="min-h-0 overflow-auto outline-none">
          <Suspense fallback={<p className="p-6 text-mut">Loading…</p>}>
            {route === "approvals" && <Approvals />}
            {route === "sessions" && <Sessions />}
            {route === "workspace" && <Workspace />}
            {route === "policy" && <Policy />}
            {route === "audit" && <Audit />}
            {route === "devices" && <Devices />}
            {route === "settings" && <Settings />}
            {route === "first-run" && <FirstRun />}
          </Suspense>
        </main>
      </div>
      <Toaster position="bottom-right" theme={theme} closeButton />
    </div>
  )
}

function StatusPill({ ok, label, neutral }: { ok: boolean; label: string; neutral?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-mut">
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        {ok ? (
          <circle cx="5" cy="5" r="4" fill="currentColor" className="text-ok" />
        ) : neutral ? (
          <circle cx="5" cy="5" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
        ) : (
          <path d="M5 1 9 9H1z" fill="currentColor" className="text-sev" />
        )}
      </svg>
      {label}
    </span>
  )
}
