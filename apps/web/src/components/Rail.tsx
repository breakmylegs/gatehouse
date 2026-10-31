import { AccountsDialog } from "./AccountsDialog"
import NumberFlow from "@number-flow/react"
import clsx from "clsx"
import { useMemo, useState } from "react"
import { groupByFolder, notifyLine, RAIL_PAGES, readRailPages, saveRailPages } from "../lib/rail"
import { MAIN_ACCOUNT, type Route, send, usePendingCount, useSessionList, useStore } from "../store"
import { Menu, type MenuItem } from "./Menu"
import { SessionCode } from "./SessionCode"
import { RenameDialog } from "./RenameDialog"
import { archiveSession, exportOpenSession, setSessionMeta, titleOf } from "../lib/sessionActions"
import type { SessionInfo } from "@gatehouse/shared/ws-protocol"

/** Opens the Ctrl+K palette from a button. */
export const openPalette = () => window.dispatchEvent(new Event("jcvc:palette"))

const STATE_MARK: Record<string, { text: string; className: string }> = {
  waiting: { text: "Needs you", className: "text-sign" },
  running: { text: "Working", className: "text-shell-tx" },
  starting: { text: "Starting", className: "text-shell-mut" },
  error: { text: "Stopped", className: "text-sev" },
  ended: { text: "Ended", className: "text-shell-mut" },
}

/**
 * The rail on the left: what needs you, your sessions grouped by folder, the pages you pinned, and at the foot the
 * state of JCVC, the kill switch and your profile menu, which holds every other page. The arrangement follows the
 * desktop coding apps people know (owner, 30 Oct); the look is JCVC's own.
 */
export function Rail({ onHide }: { onHide: () => void }) {
  const route = useStore((s) => s.route)
  const setRoute = useStore((s) => s.setRoute)
  const selected = useStore((s) => s.selectedSession)
  const panes = useStore((s) => s.panes)
  const selectSession = useStore((s) => s.selectSession)
  const openBeside = useStore((s) => s.openBeside)
  const pendingCount = usePendingCount()
  const sessions = useSessionList()
  const groups = useMemo(() => groupByFolder(sessions), [sessions])
  const [pinned, setPinned] = useState<Route[]>(readRailPages)
  const [editing, setEditing] = useState(false)
  const [folded, setFolded] = useState<Record<string, boolean>>({})
  const [renaming, setRenaming] = useState<SessionInfo>()

  const go = (r: Route) => setRoute(r)
  const open = (id: string) => {
    selectSession(id)
    setRoute("workspace")
  }
  const shown = new Set(route === "workspace" ? (panes.length ? panes : [selected]) : [])

  const more: MenuItem[] = [
    ...RAIL_PAGES.filter((p) => !pinned.includes(p.route)).map((p) => ({
      label: p.label,
      onSelect: () => go(p.route),
    })),
    { kind: "separator" as const },
    { label: "Edit sidebar...", onSelect: () => setEditing(true) },
  ]

  return (
    <nav aria-label="Sidebar" className="rail shell">
      <div className="flex items-center justify-between gap-2 px-3 pt-3">
        <span className="flex items-baseline gap-2">
          <strong className="sign text-[19px] tracking-tight [font-stretch:85%]">JCVC</strong>
          <span className="sign text-[12.5px] font-normal text-shell-mut">
            Jean-Claude Van Code
          </span>
        </span>
        <button
          type="button"
          className="rail-icon"
          aria-label="Hide the sidebar (Ctrl+B)"
          onClick={onHide}
        >
          <span aria-hidden="true">&laquo;</span>
        </button>
      </div>

      <div className="px-3 pt-3">
        <button
          className="sign-pill w-full justify-between"
          data-on={pendingCount > 0 ? "" : undefined}
          aria-current={route === "approvals" ? "page" : undefined}
          onClick={() => go("approvals")}
          aria-label={`Approvals, ${pendingCount} waiting`}
        >
          Needs you <NumberFlow value={pendingCount} className="n" />
        </button>
      </div>

      <ul className="m-0 grid list-none gap-0.5 px-2 pt-3">
        <li>
          <button
            className="rail-item"
            aria-current={route === "dashboard" ? "page" : undefined}
            onClick={() => go("dashboard")}
          >
            <span>
              <span aria-hidden="true" className="mr-2 inline-block w-3 text-center">
                &#8962;
              </span>
              Dashboard
            </span>
          </button>
        </li>
        <li>
          <button
            className="rail-item"
            aria-current={route === "sessions" ? "page" : undefined}
            onClick={() => go("sessions")}
          >
            <span>
              <span aria-hidden="true" className="mr-2 inline-block w-3 text-center">
                +
              </span>
              New session
            </span>
          </button>
        </li>
        <li>
          <button
            className="rail-item"
            aria-current={route === "chat" ? "page" : undefined}
            onClick={() => go("chat")}
          >
            <span>
              <span aria-hidden="true" className="mr-2 inline-block w-3 text-center">
                +
              </span>
              New chat
            </span>
          </button>
        </li>
        <li>
          <button className="rail-item" onClick={openPalette}>
            <span>
              <span aria-hidden="true" className="mr-2 inline-block w-3 text-center">
                /
              </span>
              Search
            </span>
            <kbd className="!border-shell-line !bg-shell-2 !text-shell-mut">Ctrl K</kbd>
          </button>
        </li>
        {pinned.map((r) => {
          const page = RAIL_PAGES.find((p) => p.route === r)
          if (!page || r === "approvals") return null
          return (
            <li key={r}>
              <button
                className="rail-item"
                aria-current={route === r ? "page" : undefined}
                onClick={() => go(r)}
              >
                <span>
                  <span aria-hidden="true" className="mr-2 inline-block w-3" />
                  {page.label}
                </span>
              </button>
            </li>
          )
        })}
        <li>
          <Menu
            label="More pages"
            className="rail-item"
            placement="right"
            tone="shell"
            button={
              <span>
                <span aria-hidden="true" className="mr-2 inline-block w-3 text-center">
                  &middot;&middot;&middot;
                </span>
                More
              </span>
            }
            items={more}
          />
        </li>
      </ul>

      {editing ? (
        <EditSidebar
          pinned={pinned}
          onChange={(next) => {
            setPinned(next)
            saveRailPages(next)
          }}
          onDone={() => setEditing(false)}
        />
      ) : null}

      <div
        className="rail-sessions min-h-0 overflow-y-auto overflow-x-hidden px-2 pb-2 pt-4"
        aria-label="Sessions"
      >
        {groups.length === 0 ? (
          <p className="m-0 px-2 text-[13.5px] text-shell-mut">
            No sessions yet. Choose New session to start one.
          </p>
        ) : null}
        {groups.map((g) => (
          <section key={g.folder} aria-label={`Sessions in ${g.label}`} className="mb-2">
            <div className="flex items-center justify-between px-2 py-1">
              <button
                type="button"
                className="sign cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-shell-mut"
                aria-expanded={!folded[g.folder]}
                onClick={() => setFolded((f) => ({ ...f, [g.folder]: !f[g.folder] }))}
              >
                {g.label} <span aria-hidden="true">{folded[g.folder] ? "▸" : "▾"}</span>
              </button>
              <span className="text-[12px] text-shell-mut">{g.sessions.length}</span>
            </div>
            {folded[g.folder] ? null : (
              <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-0.5 p-0">
                {g.sessions.map((s) => {
                  // Subagents or commands still working after the turn ended count as working.
                  const mark =
                    s.state === "idle" && s.background?.length
                      ? STATE_MARK.running
                      : STATE_MARK[s.state]
                  return (
                    <li key={s.id} className="rail-session" data-state={s.state}>
                      <button
                        className="rail-item !pr-9"
                        aria-current={shown.has(s.id) ? "page" : undefined}
                        onClick={() => open(s.id)}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <SessionCode session={s} className="!text-[12.5px]" />
                          <span className="truncate">{titleOf(s)}</span>
                        </span>
                        {mark ? (
                          <span className={clsx("shrink-0 text-[12px]", mark.className)}>
                            {mark.text}
                          </span>
                        ) : null}
                      </button>
                      <span className="rail-session-menu">
                        <Menu
                          label={`Actions for ${titleOf(s)}`}
                          className="rail-icon"
                          placement="right"
                          tone="shell"
                          button={<span aria-hidden="true">&middot;&middot;&middot;</span>}
                          items={[
                            { label: "Open", onSelect: () => open(s.id) },
                            {
                              label: "Open beside",
                              disabled: route === "workspace" && shown.has(s.id),
                              onSelect: () => {
                                openBeside(s.id)
                                setRoute("workspace")
                              },
                            },
                            { kind: "separator" },
                            { label: "Rename...", onSelect: () => setRenaming(s) },
                            {
                              label: s.pinned ? "Unpin" : "Pin to the top",
                              onSelect: () =>
                                void setSessionMeta(
                                  s,
                                  { pinned: !s.pinned },
                                  s.pinned ? `Unpinned ${titleOf(s)}.` : `Pinned ${titleOf(s)}.`,
                                ),
                            },
                            { label: "Export as Markdown", onSelect: () => exportOpenSession(s) },
                            { kind: "separator" },
                            {
                              label: "Close session",
                              danger: true,
                              disabled: s.state === "ended",
                              onSelect: () => void send({ type: "close_session", sessionId: s.id }),
                            },
                            {
                              label: "Archive",
                              danger: true,
                              onSelect: () => void archiveSession(s),
                            },
                          ]}
                        />
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        ))}
      </div>

      <RailFoot />
      {renaming ? (
        <RenameDialog
          current={renaming.title}
          fallback={renaming.project}
          onClose={() => setRenaming(undefined)}
          onSave={(title) =>
            void setSessionMeta(
              renaming,
              { title },
              title ? `Renamed to ${title}.` : `${renaming.project} has its own name again.`,
            )
          }
        />
      ) : null}
    </nav>
  )
}

/** Which pages sit in the rail. The rest stay one click away under More. */
function EditSidebar({
  pinned,
  onChange,
  onDone,
}: {
  pinned: Route[]
  onChange: (next: Route[]) => void
  onDone: () => void
}) {
  return (
    <div
      role="group"
      aria-label="Edit sidebar"
      className="mx-2 mt-2 grid gap-1.5 rounded border border-shell-line bg-shell-2 p-3"
      onKeyDown={(e) => e.key === "Escape" && onDone()}
    >
      <span className="text-[13px] font-semibold">Show in the sidebar</span>
      {RAIL_PAGES.filter((p) => p.route !== "approvals").map((p) => (
        <label key={p.route} className="flex items-center gap-2 text-[13.5px]">
          <input
            type="checkbox"
            checked={pinned.includes(p.route)}
            onChange={(e) =>
              onChange(
                RAIL_PAGES.map((x) => x.route).filter((r) =>
                  r === p.route ? e.target.checked : pinned.includes(r),
                ),
              )
            }
          />
          {p.label}
        </label>
      ))}
      <div>
        <button type="button" className="btn !min-h-7 !text-[13px]" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  )
}

function Dot({ ok, neutral, label }: { ok: boolean; neutral?: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
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

/** The foot of the rail: how JCVC is, the kill switch, and your profile menu with every other page. */
function RailFoot() {
  const [confirmKill, setConfirmKill] = useState(false)
  const conn = useStore((s) => s.conn)
  const attempt = useStore((s) => s.attempt)
  const health = useStore((s) => s.health)
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const setRoute = useStore((s) => s.setRoute)
  const helpOpen = useStore((s) => s.helpOpen)
  const setHelpOpen = useStore((s) => s.setHelpOpen)
  const killed = health?.killSwitch.engaged ?? false
  const activeAccount = useStore((s) => s.activeAccount)
  const setActiveAccount = useStore((s) => s.setActiveAccount)
  const [managing, setManaging] = useState(false)
  const accounts = health?.accounts ?? []
  // The account on show is the one named here; the main one's sign-in is the one Health has always carried.
  const shown = accounts.find((a) => a.id === activeAccount)
  const signin =
    shown && shown.id !== MAIN_ACCOUNT
      ? { signedIn: shown.signedIn, email: shown.email, organization: shown.organization }
      : health?.signin

  const who = signin?.signedIn
    ? (signin.email?.split("@")[0] ?? "Signed in")
    : health
      ? "Not signed in"
      : "Connecting"

  return (
    <div className="grid gap-2 border-t border-shell-line px-3 py-3">
      {managing ? <AccountsDialog onClose={() => setManaging(false)} /> : null}
      <div role="status" className="flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-shell-mut">
        <Dot
          ok={conn === "open"}
          label={
            conn === "open"
              ? "Host"
              : conn === "connecting"
                ? `Connecting${attempt ? ` (try ${attempt + 1})` : ""}`
                : "Host disconnected"
          }
        />
        {health ? (
          <>
            {health.signin.checked === false ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="activity-dot !h-2 !w-2" aria-hidden="true" />
                Checking sign-in
              </span>
            ) : null}
            <Dot
              ok={health.approver.state === "up"}
              label={
                health.approver.state === "up" ? "Approver" : `Approver ${health.approver.state}`
              }
            />
            <Dot {...notifyLine(health)} />
          </>
        ) : null}
      </div>
      {killed ? (
        <button
          className="btn btn-primary justify-center"
          onClick={() => void send({ type: "rearm" })}
        >
          Re-arm sessions
        </button>
      ) : confirmKill ? (
        <div role="group" aria-label="Confirm the kill switch" className="grid gap-2">
          <span className="text-[13.5px] font-semibold">
            Deny everything and stop new sessions?
          </span>
          <button
            className="btn btn-deny justify-center"
            onClick={() => {
              setConfirmKill(false)
              void send({ type: "kill" })
            }}
          >
            Yes, stop everything
          </button>
          <button className="btn justify-center" onClick={() => setConfirmKill(false)} autoFocus>
            Cancel
          </button>
        </div>
      ) : (
        <button className="btn btn-deny justify-center" onClick={() => setConfirmKill(true)}>
          Kill switch
        </button>
      )}
      <Menu
        label={`Your profile and settings: ${who}`}
        className="rail-profile"
        placement="above"
        tone="shell"
        button={
          <>
            <span className="grid min-w-0 text-left">
              <span className="truncate font-semibold">{who}</span>
              {signin?.organization ? (
                <span className="truncate text-[12px] text-shell-mut">{signin.organization}</span>
              ) : null}
            </span>
            <span aria-hidden="true">&#9662;</span>
          </>
        }
        items={[
          ...(signin?.email ? [{ kind: "heading" as const, label: signin.email }] : []),
          // Each account, the one on show ticked; choosing one shows its sessions and stops nothing.
          ...(accounts.length > 1
            ? accounts.map((a) => ({
                label: `${a.label}${a.email ? `, ${a.email}` : ""}`,
                checked: a.id === activeAccount,
                onSelect: () => setActiveAccount(a.id),
              }))
            : []),
          { label: "Accounts...", onSelect: () => setManaging(true) },
          { kind: "separator" as const },
          { label: "Settings", onSelect: () => setRoute("settings") },
          { label: "What Claude may do", onSelect: () => setRoute("policy") },
          { label: "Approver", onSelect: () => setRoute("approver") },
          { label: "Audit log", onSelect: () => setRoute("audit") },
          { label: "Phone and notifications", onSelect: () => setRoute("devices") },
          { kind: "separator" },
          {
            label: theme === "dark" ? "Jean-Claude light" : "Jean-Claude dark",
            onSelect: () => setTheme(theme === "dark" ? "light" : "dark"),
          },
          { label: "Help for this page", hint: "F1", onSelect: () => setHelpOpen(!helpOpen) },
          { label: "User guide", onSelect: () => setRoute("guide") },
          { label: "Search and commands", hint: "Ctrl K", onSelect: openPalette },
        ]}
      />
    </div>
  )
}
