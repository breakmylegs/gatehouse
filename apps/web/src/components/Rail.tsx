import { ImportedChats } from "./ImportedChats"
import NumberFlow from "@number-flow/react"
import clsx from "clsx"
import { useEffect, useState } from "react"
import {
  groupByFolder,
  groupChats,
  isHiddenEnded,
  notifyLine,
  RAIL_PAGES,
  readHideEnded,
  readRailPages,
  saveHideEnded,
  saveRailPages,
} from "../lib/rail"
import { setRailMode, useRailMode, type RailMode } from "../lib/railMode"
import { type Route, send, usePendingCount, useSessionList, useStore } from "../store"
import { askAbout } from "../lib/askAbout"
import { openExport } from "./ExportDialog"
import { Icon, type IconName } from "./Icon"
import { Menu, type MenuItem } from "./Menu"
import { SessionCode } from "./SessionCode"
import { RenameDialog } from "./RenameDialog"
import { ProjectDialog } from "./ProjectDialog"
import { HandOffDialog } from "./HandOffDialog"
import { canFork, forkSession, handOff } from "../lib/fork"
import {
  archiveEnded,
  archiveSession,
  copyConversation,
  setSessionMeta,
  titleOf,
} from "../lib/sessionActions"
import type { SessionInfo } from "@gatehouse/shared/ws-protocol"
import { EmptyState } from "./EmptyState"
import { keyLabel } from "../lib/platform-mac" // Mac fork

/** Opens the Ctrl+K palette from a button. */
export const openPalette = () => window.dispatchEvent(new Event("codeh:palette"))

const STATE_MARK: Record<string, { text: string; className: string; icon: IconName }> = {
  waiting: { text: "Needs you", className: "font-semibold text-warn", icon: "needs-you" },
  running: { text: "Working", className: "text-shell-tx", icon: "working" },
  starting: { text: "Starting", className: "text-shell-mut", icon: "waiting" },
  error: { text: "Stopped", className: "text-sev", icon: "failed" },
  ended: { text: "Ended", className: "text-shell-mut", icon: "ended" },
  paused: { text: "Paused", className: "font-semibold text-warn", icon: "paused" },
}

/** Each page's icon from the Codehouse pack, where the sidebar shows it. */
const PAGE_ICON: Partial<Record<Route, IconName>> = {
  approvals: "needs-you",
  sessions: "code",
  board: "plan",
  usage: "usage",
  projects: "projects",
  memory: "memory",
  prompts: "prompts",
  marketplace: "marketplace",
  doctor: "done",
  policy: "policy",
  audit: "audit-log",
  approver: "approver",
  devices: "devices",
  settings: "settings",
  guide: "help",
}

const FOLDED_KEY = "gatehouse.rail.folded"

/** The folders you folded in the sidebar, as you left them (owner, 31 Oct, U8). */
function readFolded(): Record<string, boolean> {
  try {
    const v = JSON.parse(localStorage.getItem(FOLDED_KEY) ?? "{}") as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(v)
        .filter(([, on]) => on === true)
        .map(([k]) => [k, true as boolean]),
    )
  } catch {
    return {}
  }
}

/**
 * The rail on the left: what needs you, your sessions grouped by folder, the pages you pinned, and at the foot the
 * state of Codehouse, the kill switch and your profile menu, which holds every other page. The arrangement follows the
 * desktop coding apps people know (owner, 30 Oct); the look is Codehouse's own.
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
  const [hideEnded, setHideEnded] = useState(readHideEnded)
  // The palette's "Hide ended sessions" reaches the list through an event, as Search reaches the palette.
  useEffect(() => {
    const flip = () =>
      setHideEnded((h) => {
        saveHideEnded(!h)
        return !h
      })
    window.addEventListener("codeh:hide-ended", flip)
    return () => window.removeEventListener("codeh:hide-ended", flip)
  }, [])
  const [pinned, setPinned] = useState<Route[]>(readRailPages)
  const [editing, setEditing] = useState(false)
  const [folded, setFolded] = useState<Record<string, boolean>>(readFolded)
  const [renaming, setRenaming] = useState<SessionInfo>()
  const [moving, setMoving] = useState<SessionInfo>()
  const [handingOff, setHandingOff] = useState<SessionInfo>()
  const mode = useRailMode()
  // The switch follows what you open: a chat shows the Chat side, a coding session the Code side.
  const selectedKind = sessions.find((s) => s.id === selected)?.kind
  useEffect(() => {
    if (route === "chat" || route === "projects" || route === "memory" || route === "prompts")
      setRailMode("chat")
    else if (route === "sessions" || route === "dashboard") setRailMode("code")
    else if (route === "workspace" && selected)
      setRailMode(selectedKind === "chat" ? "chat" : "code")
  }, [route, selected, selectedKind])
  const choose = (m: RailMode) => {
    setRailMode(m)
    setRoute(m === "chat" ? "chat" : "sessions")
  }

  const go = (r: Route) => setRoute(r)
  const open = (id: string) => {
    selectSession(id)
    setRoute("workspace")
  }
  const shown = new Set(route === "workspace" ? (panes.length ? panes : [selected]) : [])
  // An ended session you have open stays in the list, so the pane you are reading never loses its entry.
  // Each side lists only its own: chats on Chat, coding sessions on Code.
  const listed = sessions.filter((s) => (mode === "chat" ? s.kind === "chat" : s.kind !== "chat"))
  const groups =
    mode === "chat"
      ? groupChats(listed, { ended: hideEnded, keep: shown })
      : groupByFolder(listed, { ended: hideEnded, keep: shown })
  const hiddenEnded = hideEnded ? listed.filter((s) => isHiddenEnded(s, shown)).length : 0
  const endedAll = listed.filter((s) => isHiddenEnded(s)).length
  const chooseHide = (on: boolean) => {
    setHideEnded(on)
    saveHideEnded(on)
  }

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
      {/* The wordmark is in the command deck above (Stitch, R2). */}
      <div className="flex items-center gap-2 px-3 pt-3">
        <button
          className="sign-pill min-w-0 flex-1 justify-between"
          data-on={pendingCount > 0 ? "" : undefined}
          aria-current={route === "approvals" ? "page" : undefined}
          onClick={() => go("approvals")}
          aria-label={`Approvals, ${pendingCount} waiting`}
        >
          Needs you <NumberFlow value={pendingCount} className="n" />
        </button>
        <button
          type="button"
          className="rail-icon"
          aria-label="Hide the sidebar (Ctrl+B)"
          onClick={onHide}
        >
          <Icon name="sidebar-hide" />
        </button>
      </div>

      <div role="radiogroup" aria-label="Chats or coding" className="rail-switch mx-3 mt-3">
        {(["chat", "code"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            className="rail-switch-option"
            onClick={() => choose(m)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                e.preventDefault()
                choose(m === "chat" ? "code" : "chat")
              }
            }}
          >
            <Icon name={m} size={15} />
            {/* Owner, 6 Nov: not a general Claude chat, but asking about your code sessions from outside them. */}
            {m === "chat" ? "Ask about code" : "Code"}
          </button>
        ))}
      </div>

      {mode === "chat" ? (
        <ul className="m-0 grid list-none gap-0.5 px-2 pt-3">
          {(
            [
              ["chat", "new", "New question"],
              ["projects", "projects", "Projects"],
              ["memory", "memory", "Memory"],
              ["prompts", "prompts", "Prompts"],
            ] as const satisfies ReadonlyArray<readonly [Route, IconName, string]>
          ).map(([r, mark, label]) => (
            <li key={r}>
              <button
                className="rail-item"
                aria-current={route === r ? "page" : undefined}
                onClick={() => go(r)}
              >
                <span className="rail-item-label">
                  <Icon name={mark} />
                  {label}
                </span>
              </button>
            </li>
          ))}
          <li>
            <button className="rail-item" onClick={openPalette}>
              <span className="rail-item-label">
                <Icon name="search" />
                Search
              </span>
              <kbd className="!border-shell-line !bg-shell-2 !text-shell-mut">
                {keyLabel("Ctrl K")}
              </kbd>
            </button>
          </li>
        </ul>
      ) : (
        <ul className="m-0 grid list-none gap-0.5 px-2 pt-3">
          <li>
            <button
              className="rail-item"
              aria-current={route === "dashboard" ? "page" : undefined}
              onClick={() => go("dashboard")}
            >
              <span className="rail-item-label">
                <Icon name="home" />
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
              <span className="rail-item-label">
                <Icon name="new" />
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
              <span className="rail-item-label">
                <Icon name="new" />
                Ask about code
              </span>
            </button>
          </li>
          <li>
            <button className="rail-item" onClick={openPalette}>
              <span className="rail-item-label">
                <Icon name="search" />
                Search
              </span>
              <kbd className="!border-shell-line !bg-shell-2 !text-shell-mut">
                {keyLabel("Ctrl K")}
              </kbd>
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
                  <span className="rail-item-label">
                    <Icon name={PAGE_ICON[r] ?? "more"} />
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
                <span className="rail-item-label">
                  <Icon name="more" />
                  More
                </span>
              }
              items={more}
            />
          </li>
        </ul>
      )}

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
        <div className="flex items-center justify-between px-2 pb-1">
          <span className="text-[12px] font-semibold uppercase tracking-wide text-shell-mut">
            {mode === "chat" ? "Questions" : "Sessions"}
          </span>
          <Menu
            label="Sessions list options"
            className="rail-icon"
            tone="shell"
            align="end"
            button={<Icon name="more" />}
            items={[
              hideEnded
                ? { label: "Show ended sessions", onSelect: () => chooseHide(false) }
                : { label: "Hide ended sessions", onSelect: () => chooseHide(true) },
              {
                label: endedAll ? `Archive all ended (${endedAll})` : "Archive all ended",
                disabled: endedAll === 0,
                onSelect: () => void archiveEnded(sessions),
              },
            ]}
          />
        </div>
        {groups.length === 0 && hiddenEnded === 0 ? (
          <EmptyState picture={mode === "chat" ? "empty-chats" : "empty-sessions"}>
            <p className="m-0 text-[13.5px] text-shell-mut">
              {mode === "chat"
                ? "No questions yet. Choose New question to ask about one of your code sessions and its code, without interrupting it."
                : "No sessions yet. Choose New session to start one."}
            </p>
          </EmptyState>
        ) : null}
        {groups.map((g) => (
          <section key={g.folder} aria-label={`Sessions in ${g.label}`} className="mb-2">
            <div className="flex items-center justify-between px-2 py-1">
              <button
                type="button"
                className="sign cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-shell-mut"
                aria-expanded={!folded[g.folder]}
                onClick={() =>
                  setFolded((f) => {
                    const next = { ...f, [g.folder]: !f[g.folder] }
                    try {
                      localStorage.setItem(FOLDED_KEY, JSON.stringify(next))
                    } catch {
                      // storage blocked: the fold lasts until the window closes
                    }
                    return next
                  })
                }
              >
                {/* A project's group has the projects icon, so it is not taken for a folder. */}
                {g.folder.startsWith("project:") ? (
                  <Icon name="projects" size={13} className="mr-1 inline align-[-2px]" />
                ) : null}
                {g.label} <span aria-hidden="true">{folded[g.folder] ? "▸" : "▾"}</span>
              </button>
              <span className="text-[12px] text-shell-mut">{g.sessions.length}</span>
            </div>
            {folded[g.folder] ? null : (
              <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-0.5 p-0">
                {g.sessions.map((s) => {
                  // Subagents or commands still working after the turn ended count as working.
                  const mark = s.paused
                    ? STATE_MARK.paused
                    : s.state === "idle" && s.background?.length
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
                        {/* The state as a small icon alone, the working one turning (owner, 3 Nov); its word is the
                            tooltip and what a screen reader says. */}
                        {mark ? (
                          <span
                            className={clsx("inline-flex shrink-0 items-center", mark.className)}
                            title={mark.text}
                          >
                            <Icon
                              name={mark.icon}
                              size={14}
                              className={mark.icon === "working" ? "state-spin" : undefined}
                            />
                            <span className="sr-only">{mark.text}</span>
                          </span>
                        ) : null}
                      </button>
                      <span className="rail-session-menu">
                        <Menu
                          label={`Actions for ${titleOf(s)}`}
                          className="rail-icon"
                          placement="right"
                          tone="shell"
                          button={<Icon name="more" />}
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
                            // B13: a copy that carries on separately, or a side task for a new session.
                            {
                              label: "Fork",
                              disabled: !canFork(s),
                              onSelect: () => void forkSession(s.id),
                            },
                            ...(s.kind === "chat" || s.local
                              ? []
                              : [
                                  {
                                    label: "Hand off a side task...",
                                    onSelect: () => setHandingOff(s),
                                  },
                                  // Owner, 6 Nov: ask about this session and its code from outside it.
                                  ...(s.state === "ended" || s.state === "error"
                                    ? []
                                    : [
                                        {
                                          label: "Ask about this session...",
                                          onSelect: () => askAbout(s.id),
                                        },
                                      ]),
                                ]),
                            { kind: "separator" },
                            { label: "Rename...", onSelect: () => setRenaming(s) },
                            { label: "Move to a project...", onSelect: () => setMoving(s) },
                            {
                              label: s.pinned ? "Unpin" : "Pin to the top",
                              onSelect: () =>
                                void setSessionMeta(
                                  s,
                                  { pinned: !s.pinned },
                                  s.pinned ? `Unpinned ${titleOf(s)}.` : `Pinned ${titleOf(s)}.`,
                                ),
                            },
                            {
                              label: "Copy conversation",
                              onSelect: () => void copyConversation(s),
                            },
                            {
                              label: "Export...",
                              onSelect: () =>
                                openExport({
                                  title: titleOf(s),
                                  cwd: s.cwd,
                                  sessionId: s.id,
                                  ...(s.sdkSessionId ? { sdkSessionId: s.sdkSessionId } : {}),
                                }),
                            },
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
        {mode === "chat" ? <ImportedChats /> : null}
        {hiddenEnded > 0 ? (
          <p className="m-0 px-2 text-[13px] text-shell-mut">
            {hiddenEnded === 1
              ? "1 ended session is hidden."
              : `${hiddenEnded} ended sessions are hidden.`}{" "}
            <button
              type="button"
              className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-shell-tx underline"
              onClick={() => chooseHide(false)}
            >
              Show
            </button>
          </p>
        ) : null}
      </div>

      <RailFoot />
      {handingOff ? (
        <HandOffDialog
          from={titleOf(handingOff)}
          worktreeFirst={handingOff.worktree !== undefined}
          onClose={() => setHandingOff(undefined)}
          onStart={(task, worktree) => {
            const from = handingOff
            setHandingOff(undefined)
            void handOff(from.id, task, { worktree })
          }}
        />
      ) : null}
      {moving ? (
        <ProjectDialog
          current={moving.group ?? (moving.kind === "chat" ? moving.chatProject : undefined)}
          onClose={() => setMoving(undefined)}
          onSave={(group) =>
            void setSessionMeta(
              moving,
              { group },
              group
                ? `Moved ${titleOf(moving)} to ${group}.`
                : `${titleOf(moving)} is listed by its folder again.`,
            )
          }
        />
      ) : null}
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
  // Approvals is always there, as the pill at the top, and is not part of the order you set.
  const kept = pinned.includes("approvals") ? (["approvals"] as Route[]) : []
  const order: Route[] = pinned.filter((r) => r !== "approvals")
  const set = (next: Route[]) => onChange([...kept, ...next])
  return (
    <div
      role="group"
      aria-label="Edit sidebar"
      className="mx-2 mt-2 grid gap-1.5 rounded border border-shell-line bg-shell-2 p-3"
      onKeyDown={(e) => e.key === "Escape" && onDone()}
    >
      <span className="text-[13px] font-semibold">Show in the sidebar</span>
      {[
        ...order,
        ...RAIL_PAGES.map((x) => x.route).filter((r) => r !== "approvals" && !order.includes(r)),
      ].map((r) => {
        const page = RAIL_PAGES.find((x) => x.route === r)
        if (!page) return null
        const at = order.indexOf(r)
        const move = (by: -1 | 1) => {
          const next = [...order]
          const [it] = next.splice(at, 1)
          next.splice(at + by, 0, it!)
          set(next)
        }
        return (
          <div key={r} className="flex items-center gap-2 text-[13.5px]">
            <label className="flex flex-1 items-center gap-2">
              <input
                type="checkbox"
                checked={at >= 0}
                onChange={(e) =>
                  set(e.target.checked ? [...order, r] : order.filter((x) => x !== r))
                }
              />
              {page.label}
            </label>
            {at >= 0 ? (
              <>
                <button
                  type="button"
                  className="btn !min-h-6 !px-2 !text-[12px]"
                  aria-label={`Move ${page.label} up`}
                  disabled={at === 0}
                  onClick={() => move(-1)}
                >
                  Up
                </button>
                <button
                  type="button"
                  className="btn !min-h-6 !px-2 !text-[12px]"
                  aria-label={`Move ${page.label} down`}
                  disabled={at === order.length - 1}
                  onClick={() => move(1)}
                >
                  Down
                </button>
              </>
            ) : null}
          </div>
        )
      })}
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

/** The foot of the rail: how Codehouse is. The kill switch and your profile menu are in the command deck. */
function RailFoot() {
  const conn = useStore((s) => s.conn)
  const attempt = useStore((s) => s.attempt)
  const health = useStore((s) => s.health)
  return (
    <div className="grid gap-2 border-t border-shell-line px-3 py-3">
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
    </div>
  )
}
