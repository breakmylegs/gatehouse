import { ImportedChats } from "./ImportedChats"
import { toast } from "sonner"
import { inAnHour, isSnoozed, snoozedUntil, snoozeSession, tomorrowMorning, wakeSession } from "../lib/snooze"
import NumberFlow from "@number-flow/react"
import clsx from "clsx"
import { useEffect, useState } from "react"
import {
  groupByFolder,
  groupChats,
  isHiddenEnded,
  notifyLine,
  readHideEnded,
  saveHideEnded,
} from "../lib/rail"
import { setRailMode, useRailMode, type RailMode } from "../lib/railMode"
import { type Route, send, usePendingCount, useSessionList, useStore } from "../store"
import { askAbout } from "../lib/askAbout"
import { switchSide } from "../lib/switchSide"
import { dropToShell } from "../lib/shell"
import { applyOrder, dropChange, moveBefore, moveBy, readOrder, saveOrder } from "../lib/rail-order"
import { arrangeSections, hueOf, isProjectSection, monogram, readSections, saveSections, setSection, type SectionPrefs } from "../lib/project-marks"
import { openExport } from "./ExportDialog"
import { Icon, type IconName } from "./Icon"
import { NAV_SECTIONS, openingPage, sectionOf } from "../lib/sections"
import { Menu } from "./Menu"
import { SessionCode } from "./SessionCode"
import { RenameDialog } from "./RenameDialog"
import { ProjectDialog } from "./ProjectDialog"
import { HandOffDialog } from "./HandOffDialog"
import { canFork, forkSession, handOff } from "../lib/fork"
import {
  archiveEnded,
  archiveSession,
  copyConversation,
  copySessionId,
  setSessionMeta,
  titleOf,
} from "../lib/sessionActions"
import type { SessionInfo } from "@gatehouse/shared/ws-protocol"
import { EmptyState } from "./EmptyState"
import { keyLabel } from "../lib/platform-mac" // Mac fork
import { Disclosure } from "./DisclosureMac" // Mac fork

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
const FOLDED_KEY = "gatehouse.rail.folded"

/** The folders you folded in the sidebar, as you left them (owner, 31 Oct, U8). */
function readFolded(): Record<string, boolean> {
  try {
    const v = JSON.parse(localStorage.getItem(FOLDED_KEY) ?? "{}") as Record<string, unknown>
    // Folded folders, and (T-027) Working when you opened it, which is folded unless saved as open.
    return Object.fromEntries(
      Object.entries(v)
        .filter(([, on]) => typeof on === "boolean")
        .map(([k, on]) => [k, on as boolean]),
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
/** T-025, with T-026: snoozes a session and offers to undo it for a few seconds. */
function snoozeWithUndo(s: SessionInfo, until: Date): void {
  snoozeSession(s.id, until)
  toast(`Snoozed ${titleOf(s)} until ${until.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}. It wakes at once if it needs you.`, {
    id: "session",
    duration: 5000,
    action: { label: "Undo", onClick: () => wakeSession(s.id) },
  })
}

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
  // T-023: your own order of the sessions, by dragging, and the one being dragged.
  const [order, setOrder] = useState<string[]>(readOrder)
  // T-092: projects pinned to the top or archived, and whether archived ones are shown.
  const [sections, setSections] = useState<SectionPrefs>(readSections)
  const [showArchived, setShowArchived] = useState(false)
  const changeSection = (folder: string, what: "pin" | "unpin" | "archive" | "unarchive") =>
    setSections((p) => {
      const next = setSection(p, folder, what)
      saveSections(next)
      return next
    })
  const [dragging, setDragging] = useState<string>()
  const [folded, setFolded] = useState<Record<string, boolean>>(readFolded)
  // T-027: Working gathers busy sessions; fold it to keep them out of the way, kept like any folder's fold. It starts
  // open, so a session that is working is never out of sight until you choose.
  const isFolded = (key: string) => folded[key] === true
  const [renaming, setRenaming] = useState<SessionInfo>()
  const [moving, setMoving] = useState<SessionInfo>()
  const [handingOff, setHandingOff] = useState<SessionInfo>()
  const mode = useRailMode()
  // T-025: snoozed sessions, looked at again each minute and whenever a snooze changes.
  const [, setTick] = useState(0)
  useEffect(() => {
    const again = () => setTick((n) => n + 1)
    const timer = setInterval(again, 60_000)
    window.addEventListener("codeh:snooze", again)
    return () => {
      clearInterval(timer)
      window.removeEventListener("codeh:snooze", again)
    }
  }, [])
  const pending = useStore((s) => s.pending)
  const [snoozeOpen, setSnoozeOpen] = useState(false)
  // The switch follows what you open: a chat shows the Chat side, a coding session the Code side.
  const selectedKind = sessions.find((s) => s.id === selected)?.kind
  useEffect(() => {
    if (route === "chat" || route === "projects" || route === "memory" || route === "prompts")
      setRailMode("chat")
    else if (route === "sessions" || route === "dashboard") setRailMode("code")
    else if (route === "workspace" && selected)
      setRailMode(selectedKind === "chat" ? "chat" : "code")
  }, [route, selected, selectedKind])
  // O54: each side reopens the session you last had open on it, in its panes; its own page only when there is none.
  const choose = (m: RailMode) => switchSide(m)

  const go = (r: Route) => setRoute(r)
  const open = (id: string) => {
    selectSession(id)
    setRoute("workspace")
  }
  const shown = new Set(route === "workspace" ? (panes.length ? panes : [selected]) : [])
  // An ended session you have open stays in the list, so the pane you are reading never loses its entry.
  // Each side lists only its own: chats on Chat, coding sessions on Code.
  const onSide = sessions.filter((s) => (mode === "chat" ? s.kind === "chat" : s.kind !== "chat"))
  // T-025: a snoozed session leaves the list until its time, unless it needs you or is open in a pane.
  const waiting = new Set(Object.values(pending).map((v) => v.request.sessionId))
  const snoozed = onSide.filter((s) => !shown.has(s.id) && isSnoozed(s.id, waiting.has(s.id) || s.state === "error"))
  const listed = onSide.filter((s) => !snoozed.includes(s))
  const rawGroups =
    mode === "chat"
      ? groupChats(listed, { ended: hideEnded, keep: shown })
      : groupByFolder(listed, { ended: hideEnded, keep: shown, working: true })
  const arranged = arrangeSections(applyOrder(rawGroups, order), sections, showArchived)
  const groups = arranged.groups
  const hiddenEnded = hideEnded ? listed.filter((s) => isHiddenEnded(s, shown)).length : 0
  const endedAll = listed.filter((s) => isHiddenEnded(s)).length
  const placeOrder = (next: string[]) => {
    setOrder(next)
    saveOrder(next)
  }
  // T-023: a session dropped on a section, before a row or at its end: moved there when it can be, then placed.
  const dropOn = async (g: (typeof groups)[number], before?: string) => {
    const s = listed.find((x) => x.id === dragging)
    setDragging(undefined)
    if (!s || s.id === before) return
    const change = dropChange(s, g)
    if (typeof change === "object" && "refused" in change) return void toast.error(change.refused, { id: "session" })
    if (change !== "same" && !(await setSessionMeta(s, change, `Moved ${titleOf(s)} to ${g.label}.`))) return
    placeOrder(moveBefore(groups.flatMap((x) => x.sessions.map((y) => y.id)), s.id, before, g.sessions.map((y) => y.id)))
  }
  const chooseHide = (on: boolean) => {
    setHideEnded(on)
    saveHideEnded(on)
  }

  return (
    <nav
      aria-label="Sidebar"
      className="rail shell"
      // T-005: a folder dropped here opens the start-session form with it, through the window.
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault()
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        if (dropToShell(e.dataTransfer.files) === "no-shell")
          toast("Dropping a folder works in the Codehouse window on Windows. Here, start a session and choose its folder.", { id: "drop" })
      }}
    >
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

      {/* O48: the sections, the same whichever sessions the switch lists; each opens on the page last used in it. */}
      <ul className="m-0 grid list-none gap-0.5 px-2 pt-3" aria-label="Sections">
        <li>
          <button
            className="rail-item"
            onClick={() => go(mode === "chat" ? "chat" : "sessions")}
          >
            <span className="rail-item-label">
              <Icon name="new" />
              {mode === "chat" ? "New question" : "New session"}
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
        {NAV_SECTIONS.map((sec) => (
          <li key={sec.id}>
            <button
              className="rail-item"
              aria-current={sectionOf(route)?.id === sec.id ? "page" : undefined}
              onClick={() => (sec.id === "ask" ? switchSide("chat", openingPage(sec)) : go(openingPage(sec)))}
            >
              <span className="rail-item-label">
                <Icon name={sec.icon} />
                {sec.label}
              </span>
            </button>
          </li>
        ))}
      </ul>

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
            <div
              className="flex items-center justify-between px-2 py-1"
              onDragOver={(e) => {
                if (dragging) e.preventDefault()
              }}
              onDrop={(e) => {
                if (!dragging) return
                e.preventDefault()
                e.stopPropagation()
                void dropOn(g)
              }}
            >
              <button
                type="button"
                className="sign cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-shell-mut"
                aria-expanded={!isFolded(g.folder)}
                onClick={() =>
                  setFolded((f) => {
                    const next = { ...f, [g.folder]: !isFolded(g.folder) }
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
                {/* T-092: its monogram, in a colour of its own. */}
                {isProjectSection(g.folder) ? (
                  <span aria-hidden="true" className="project-mark" style={{ ["--mark-hue" as string]: String(hueOf(g.label)) }}>
                    {monogram(g.label)}
                  </span>
                ) : null}
                {g.label} <Disclosure open={!isFolded(g.folder)} />
              </button>
              <span className="flex items-center gap-1">
                <span className="text-[12px] text-shell-mut">{g.sessions.length}</span>
                {isProjectSection(g.folder) ? (
                  <Menu
                    label={`Actions for ${g.label}`}
                    className="rail-icon"
                    placement="right"
                    tone="shell"
                    button={<Icon name="more" />}
                    items={[
                      sections.pinned.includes(g.folder.toLowerCase())
                        ? { label: "Unpin project", onSelect: () => changeSection(g.folder, "unpin") }
                        : { label: "Pin project to the top", onSelect: () => changeSection(g.folder, "pin") },
                      sections.archived.includes(g.folder.toLowerCase())
                        ? { label: "Bring back from the archive", onSelect: () => changeSection(g.folder, "unarchive") }
                        : { label: "Archive project", onSelect: () => changeSection(g.folder, "archive") },
                    ]}
                  />
                ) : null}
              </span>
            </div>
            {isFolded(g.folder) ? null : (
              <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-0.5 p-0">
                {g.sessions.map((s) => {
                  // Subagents or commands still working after the turn ended count as working.
                  const mark = s.paused
                    ? STATE_MARK.paused
                    : s.state === "idle" && s.background?.length
                      ? STATE_MARK.running
                      : STATE_MARK[s.state]
                  return (
                    <li
                      key={s.id}
                      className="rail-session"
                      data-state={s.state}
                      data-dragging={dragging === s.id ? "" : undefined}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("application/x-codehouse-session", s.id)
                        e.dataTransfer.effectAllowed = "move"
                        setDragging(s.id)
                      }}
                      onDragEnd={() => setDragging(undefined)}
                      onDragOver={(e) => {
                        if (dragging) e.preventDefault()
                      }}
                      onDrop={(e) => {
                        if (!dragging) return
                        e.preventDefault()
                        e.stopPropagation()
                        void dropOn(g, s.id)
                      }}
                    >
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
                            // T-023: the keyboard's way to reorder, as dragging does.
                            {
                              label: "Move up",
                              disabled: g.sessions[0]?.id === s.id,
                              onSelect: () => placeOrder(moveBy(groups.flatMap((x) => x.sessions.map((y) => y.id)), g.sessions.map((y) => y.id), s.id, -1)),
                            },
                            {
                              label: "Move down",
                              disabled: g.sessions.at(-1)?.id === s.id,
                              onSelect: () => placeOrder(moveBy(groups.flatMap((x) => x.sessions.map((y) => y.id)), g.sessions.map((y) => y.id), s.id, 1)),
                            },
                            {
                              label: s.pinned ? "Unpin" : "Pin to the top",
                              onSelect: () =>
                                void setSessionMeta(
                                  s,
                                  { pinned: !s.pinned },
                                  s.pinned ? `Unpinned ${titleOf(s)}.` : `Pinned ${titleOf(s)}.`,
                                ),
                            },
                            ...(snoozedUntil(s.id)
                              ? [{ label: "Wake now", onSelect: () => wakeSession(s.id) }]
                              : [
                                  { label: "Snooze for an hour", onSelect: () => snoozeWithUndo(s, inAnHour()) },
                                  { label: "Snooze until tomorrow morning", onSelect: () => snoozeWithUndo(s, tomorrowMorning()) },
                                ]),
                            {
                              label: "Copy conversation",
                              onSelect: () => void copyConversation(s),
                            },
                            // T-031: the id Claude Code knows the session by (claude --resume <id>), once it has one.
                            ...(s.sdkSessionId
                              ? [{ label: "Copy session id", onSelect: () => void copySessionId(s.sdkSessionId!) }]
                              : []),
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
        {snoozed.length ? (
          <section aria-label="Snoozed sessions" className="grid gap-0.5 px-2">
            <button
              type="button"
              className="cursor-pointer border-0 bg-transparent p-0 text-left text-[13px] text-shell-mut"
              aria-expanded={snoozeOpen}
              onClick={() => setSnoozeOpen((o) => !o)}
            >
              Snoozed ({snoozed.length})
            </button>
            {snoozeOpen ? (
              <ul className="m-0 grid list-none gap-0.5 p-0">
                {snoozed.map((s) => (
                  <li key={s.id} className="flex items-center gap-1 text-[13px]">
                    <button type="button" className="min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent p-0 text-left text-shell-tx" onClick={() => open(s.id)}>
                      {titleOf(s)}
                    </button>
                    <span className="text-shell-mut">until {snoozedUntil(s.id)?.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}</span>
                    <button type="button" className="btn !min-h-6 !px-1.5 !text-[12px]" onClick={() => wakeSession(s.id)}>
                      Wake
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}
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
        {/* T-092: archived projects, out of the way until you ask. */}
        {arranged.archived > 0 || showArchived ? (
          <p className="m-0 px-2 text-[13px] text-shell-mut">
            {showArchived ? "Archived projects are shown." : arranged.archived === 1 ? "1 project is archived." : `${arranged.archived} projects are archived.`}{" "}
            <button
              type="button"
              className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-shell-tx underline"
              onClick={() => setShowArchived((v) => !v)}
            >
              {showArchived ? "Hide" : "Show"}
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
