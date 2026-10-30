import type { PendingView, SessionInfo } from "@gatehouse/shared/ws-protocol"
import clsx from "clsx"
import { diffLines } from "diff"
import { memo, useEffect, useId, useMemo, useRef, useState } from "react"
import Markdown from "react-markdown"
import { Virtuoso } from "react-virtuoso"
import remarkGfm from "remark-gfm"
import { toast } from "sonner"
import { emptyTranscript, type Item, type Todo } from "../lib/transcript"
import { describeActivity, describePulse } from "../lib/activity"
import { groupItems, summarise } from "../lib/groups"
import { useNow } from "../lib/useNow"
import { ApprovalCard } from "../components/ApprovalCard"
import { QuickDecision } from "../components/QuickDecision"
import { money } from "../lib/format"
import { send, usePending, useSessionList, useStore } from "../store"
import { MODELS } from "./Sessions"
import { SessionCode } from "../components/SessionCode"
import { Menu, type MenuItem } from "../components/Menu"
import { ChangesPane } from "../components/ChangesPane"
import { TerminalPane } from "../components/TerminalPane"
import { FilesPanel, Viewer, type Opened } from "../components/FilesPanel"
import { PlusMenu } from "../components/PlusMenu"
import { api } from "../lib/api"
import { sessionCode } from "../lib/codes"
import { EFFORTS, MODE_OPTIONS, uiModeOf, wireOf, type EffortId, type UiMode } from "../lib/modes"

/** Moves a session to a mode. Extreme approval is Manual plus the session flag, so both are set in order. */
async function changeMode(session: SessionInfo, m: UiMode) {
  const w = wireOf(m)
  if (session.mode !== w.mode) await send({ type: "set_mode", sessionId: session.id, mode: w.mode })
  if ((session.extreme === true) !== w.extreme)
    await send({ type: "set_extreme", sessionId: session.id, on: w.extreme })
}

const SLASH: Array<{ cmd: string; help: string }> = [
  { cmd: "/plan", help: "Switch this session to Plan" },
  { cmd: "/default", help: "Switch this session to Manual" },
  { cmd: "/accept-edits", help: "Switch this session to Accept edits" },
  { cmd: "/auto", help: "Switch this session to Auto" },
  { cmd: "/extreme", help: "Turn Extreme approval on or off for this session" },
  { cmd: "/effort", help: "Set effort: low, medium, high, xhigh or max" },
  { cmd: "/model", help: "Change model, for example /model claude-sonnet-5-5" },
  { cmd: "/stop", help: "Interrupt the current turn" },
  { cmd: "/close", help: "End this session" },
]

/** The workspace: one session, or up to three side by side, each with its own transcript, files and composer. */
export function Workspace() {
  const sessions = useStore((s) => s.sessions)
  const storePanes = useStore((s) => s.panes)
  const selected = useStore((s) => s.selectedSession)
  const selectSession = useStore((s) => s.selectSession)
  const setRoute = useStore((s) => s.setRoute)
  const setPane = useStore((s) => s.setPane)
  const sessionList = useSessionList()
  const list = useMemo(
    () => [...sessionList].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [sessionList],
  )
  const panes = useMemo(() => {
    const live = storePanes.filter((id) => sessions[id])
    return live.length ? live : selected && sessions[selected] ? [selected] : []
  }, [storePanes, sessions, selected])
  const session = panes[0] ? sessions[panes[0]] : undefined

  if (!session) {
    return (
      <div className="mx-auto mt-14 grid max-w-xl gap-4 px-6">
        <div>
          <h1 className="m-0">Pick a session</h1>
          <p className="m-0 mt-1 text-mut">
            {list.length === 0
              ? "No sessions are running. Start one from the Sessions page."
              : "Choose a session to see its transcript and work with it."}
          </p>
        </div>
        {list.length > 0 ? (
          <div className="panel overflow-hidden">
            {list.map((s) => (
              <button
                key={s.id}
                className="board-row grid-cols-[auto_minmax(0,1fr)_auto]"
                data-lit={s.state === "waiting" ? "" : undefined}
                onClick={() => selectSession(s.id)}
              >
                <SessionCode session={s} className="!text-[15px]" />
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-semibold">{s.project}</span>
                  <span className="mono block truncate text-xs text-mut">{s.cwd}</span>
                </span>
                <span className="text-[13px] text-mut">
                  {s.state === "waiting" ? "Waiting on you" : s.state}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <div>
          <button className="btn" onClick={() => setRoute("sessions")}>
            Go to sessions
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="grid h-full min-h-0 divide-x divide-line"
      style={{ gridTemplateColumns: `repeat(${panes.length}, minmax(0, 1fr))` }}
    >
      {panes.map((id, i) => (
        <SessionPane
          key={`${i}:${id}`}
          sessionId={id}
          index={i}
          panes={panes}
          onChangeSession={(next) => setPane(i, next)}
        />
      ))}
    </div>
  )
}

const STATE_WORDS: Record<SessionInfo["state"], string> = {
  starting: "Starting",
  idle: "Ready",
  running: "Working",
  waiting: "Needs you",
  error: "Stopped with an error",
  ended: "Ended",
}

type Side = "plan" | "files" | "changes" | "terminal"
const SIDE_LABEL: Record<Side, string> = {
  plan: "Plan",
  files: "Files",
  changes: "Changes",
  terminal: "Terminal",
}

function SessionPane({
  sessionId,
  index,
  panes,
  onChangeSession,
}: {
  sessionId: string
  index: number
  panes: string[]
  onChangeSession: (id: string) => void
}) {
  const sessions = useStore((s) => s.sessions)
  const selected = sessionId
  const setRoute = useStore((s) => s.setRoute)
  const selectRequest = useStore((s) => s.selectRequest)
  const openBeside = useStore((s) => s.openBeside)
  const closePane = useStore((s) => s.closePane)
  const transcript =
    useStore((s) => (selected ? s.transcripts[selected] : undefined)) ?? emptyTranscript()
  const allPending = usePending()
  const pending = useMemo(
    () => allPending.filter((p) => p.request.sessionId === selected),
    [allPending, selected],
  )
  const sessionList = useSessionList()
  const list = useMemo(
    () => [...sessionList].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [sessionList],
  )
  const session = selected ? sessions[selected] : undefined
  const [opened, setOpened] = useState<Opened>()
  const [side, setSide] = useState<Side | null>(null)
  const [lastUrl, setLastUrl] = useState("http://localhost:5173/")
  // A file from one session is never shown in another.
  useEffect(() => setOpened(undefined), [selected])
  useEffect(() => {
    if (opened?.kind === "browser") setLastUrl(opened.url)
  }, [opened])

  // Runs of tool calls read as one line each, opened on demand.
  const shownItems = useMemo(() => groupItems(transcript.items), [transcript.items])
  const tools = useRef<Partial<Record<Side, HTMLButtonElement | null>>>({})
  const toggleSide = (t: Side) => setSide((s) => (s === t ? null : t))
  // Closing puts focus back on the button that opened it, so the keyboard does not lose its place.
  const closeRail = () => {
    const was = side
    setSide(null)
    if (was) tools.current[was]?.focus()
  }
  if (!session) return null

  const running = session.state === "running" || session.state === "waiting"
  const ended = session.state === "ended" || session.state === "error"
  const chat = session.kind === "chat"
  const others = list.filter((s) => !panes.includes(s.id))
  // Each item says what it does, so it reads right out of context. A session shown in another pane swaps places.
  const titleMenu: MenuItem[] = [
    ...list
      .filter((s) => s.id !== session.id)
      .map((s) => ({
        label: `Show ${sessionCode(s)} ${s.project} here`,
        onSelect: () => onChangeSession(s.id),
      })),
    ...(panes.length < 3 && index === panes.length - 1
      ? others.map((s) => ({
          label: `Open ${sessionCode(s)} ${s.project} beside`,
          onSelect: () => openBeside(s.id),
        }))
      : []),
    { kind: "separator" },
    ...(panes.length > 1 ? [{ label: "Close this pane", onSelect: () => closePane(index) }] : []),
    {
      label: "Interrupt",
      disabled: !running,
      onSelect: () => void send({ type: "interrupt", sessionId: session.id }),
    },
    {
      label: "Close session",
      danger: true,
      disabled: session.state === "ended",
      onSelect: () => void send({ type: "close_session", sessionId: session.id }),
    },
  ]

  return (
    <div
      className="pane relative grid h-full min-w-0 grid-rows-[auto_1fr_auto]"
      data-rail={side ? "open" : undefined}
      data-side={side ?? "none"}
      data-viewer={opened ? "" : undefined}
      aria-label={`Session ${session.project}`}
    >
      <header className="pane-head">
        <SessionCode session={session} className="!text-[16px]" />
        {/* Never narrower than the name and its state: the side panel buttons wrap below instead. */}
        <span className="grid min-w-[11rem] flex-1">
          <Menu
            label={`${session.project}: switch, open beside, interrupt or close`}
            className="pane-title"
            button={
              <>
                <span className="min-w-[6ch] truncate">{session.project}</span>
                <span className="shrink-0 text-[12.5px] font-normal text-mut">
                  {STATE_WORDS[session.state]}
                </span>
                <span aria-hidden="true" className="text-[12px]">
                  &#9662;
                </span>
              </>
            }
            items={titleMenu}
          />
          {chat ? (
            <span className="truncate text-xs text-mut">
              A chat, in Plan mode: Claude reads and searches, and never changes files
            </span>
          ) : (
            <span className="mono truncate text-xs text-mut">{session.cwd}</span>
          )}
        </span>
        {/* A chat has no project, so none of the project panels. */}
        {chat ? null : (
          <span role="group" aria-label="Side panels" className="flex items-center gap-1">
            {(["plan", "files", "changes", "terminal"] as const).map((t) => (
              <button
                key={t}
                ref={(el) => {
                  tools.current[t] = el
                }}
                type="button"
                className="pane-tool"
                aria-pressed={side === t}
                aria-controls={`rail-${session.id}`}
                onClick={() => toggleSide(t)}
              >
                {SIDE_LABEL[t]}
              </button>
            ))}
            <button
              type="button"
              className="pane-tool"
              aria-pressed={opened?.kind === "browser"}
              onClick={() =>
                setOpened(
                  opened?.kind === "browser" ? undefined : { kind: "browser", url: lastUrl },
                )
              }
            >
              Browser
            </button>
          </span>
        )}
      </header>

      <div className="pane-body min-h-0">
        <section aria-label="Transcript" className="pane-transcript min-h-0">
          <Virtuoso
            style={{ height: "100%" }}
            data={shownItems}
            followOutput="smooth"
            initialTopMostItemIndex={Math.max(0, shownItems.length - 1)}
            computeItemKey={(_, it) => it.id}
            itemContent={(_, it) => (
              <div className="mx-auto max-w-[860px] px-5 py-1.5">
                {it.kind === "group" ? <ToolGroup tools={it.tools} /> : <ItemView item={it} />}
              </div>
            )}
            components={{
              EmptyPlaceholder: () => (
                <p className="mx-auto max-w-[860px] p-6 text-mut">
                  Nothing yet. Write a prompt below to start the work.
                </p>
              ),
            }}
          />
        </section>
        {opened ? (
          <Viewer
            key={opened.kind === "file" ? opened.rel : "browser"}
            sessionId={session.id}
            opened={opened}
            onClose={() => setOpened(undefined)}
            onNavigate={setOpened}
          />
        ) : null}
        <aside
          id={`rail-${session.id}`}
          aria-label={side ? SIDE_LABEL[side] : "Files"}
          className="pane-rail min-h-0 grid-rows-[auto_1fr] border-l border-line bg-s1"
          onKeyDown={(e) => {
            if (e.key === "Escape" && side) {
              e.stopPropagation()
              closeRail()
            }
          }}
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-2">
            <h2 className="m-0 text-[15px]">{side ? SIDE_LABEL[side] : "Files"}</h2>
            <button type="button" className="btn !min-h-7 !text-[13px]" onClick={closeRail}>
              Close
            </button>
          </div>
          <div
            className={clsx(
              "min-h-0 p-4",
              side === "terminal" ? "overflow-hidden" : "overflow-auto",
            )}
          >
            {side === "terminal" ? (
              <TerminalPane sessionId={session.id} cwd={session.cwd} />
            ) : side === "changes" ? (
              <ChangesPane sessionId={session.id} cwd={session.cwd} />
            ) : side === "files" ? (
              <FilesPanel
                sessionId={session.id}
                cwd={session.cwd}
                items={transcript.items}
                onOpen={setOpened}
              />
            ) : (
              <>
                <TodoPanel todos={transcript.todos} />
                <SessionFacts sessionId={session.id} />
              </>
            )}
          </div>
        </aside>
      </div>

      <footer className="border-t border-line bg-s1 p-3">
        {pending[0] ? (
          <SessionRequest
            view={pending[0]}
            more={pending.length - 1}
            onOpen={(id) => {
              selectRequest(id)
              setRoute("approvals")
            }}
          />
        ) : running ? (
          <ActivityLine sessionId={session.id} cwd={session.cwd} />
        ) : null}
        <Composer sessionId={session.id} disabled={ended} />
        {/* What the session runs on, under the prompt box where you look when you send. */}
        <div className="composer-bar" role="group" aria-label="Model, effort and mode">
          <label className="composer-pick">
            <span className="text-mut">Model</span>
            <select
              className="composer-select"
              value={
                MODELS.some((m) => m.id === (session.model ?? "")) ? (session.model ?? "") : ""
              }
              disabled={ended}
              onChange={(e) =>
                void send({
                  type: "set_model",
                  sessionId: session.id,
                  ...(e.target.value ? { model: e.target.value } : {}),
                })
              }
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="composer-pick">
            <span className="text-mut">Effort</span>
            <select
              className="composer-select"
              value={session.effort ?? ""}
              disabled={ended}
              onChange={(e) =>
                e.target.value &&
                void send({
                  type: "set_effort",
                  sessionId: session.id,
                  effort: e.target.value as EffortId,
                })
              }
            >
              <option value="" disabled>
                Model default
              </option>
              {EFFORTS.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
          {chat ? (
            <span className="composer-pick">Plan mode, always, in a chat</span>
          ) : (
            <label className="composer-pick">
              <span className="text-mut">Mode</span>
              <select
                className="composer-select"
                value={uiModeOf(session)}
                disabled={ended}
                onChange={(e) => void changeMode(session, e.target.value as UiMode)}
              >
                {MODE_OPTIONS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {running ? (
            <button
              type="button"
              className="btn btn-deny ml-auto !min-h-7"
              onClick={() => void send({ type: "interrupt", sessionId: session.id })}
            >
              Interrupt
            </button>
          ) : null}
        </div>
      </footer>
    </div>
  )
}

/**
 * The oldest request from this session, decided here. A permission gets Allow once and Deny in place; a question
 * or a plan needs reading, so it shows the full card.
 */
function SessionRequest({
  view,
  more,
  onOpen,
}: {
  view: PendingView
  more: number
  onOpen: (id: string) => void
}) {
  return (
    <div className="grid">
      {view.request.kind === "permission" ? (
        <QuickDecision view={view} variant="panel" onMore={() => onOpen(view.request.id)} />
      ) : (
        <div className="mb-2 max-h-[55vh] overflow-auto">
          <ApprovalCard view={view} />
        </div>
      )}
      {more > 0 ? (
        <p className="m-0 mb-2 flex items-center gap-3 text-[13.5px]">
          {more} more from this session after this one.
          <button type="button" className="btn" onClick={() => onOpen(view.request.id)}>
            Open the queue
          </button>
        </p>
      ) : null}
    </div>
  )
}

/** What the session is doing while a turn runs: thinking, writing a file, running a command. */
function ActivityLine({ sessionId, cwd }: { sessionId: string; cwd: string }) {
  const activity = useStore((s) => s.activity[sessionId])
  const pulse = useStore((s) => s.pulse[sessionId])
  const now = useNow(1000)
  const line = describeActivity(activity, now, cwd)
  const beat = describePulse(pulse, now)
  const detail = [line.detail, beat.tokens, beat.quiet].filter(Boolean).join(", ")
  if (beat.stuck)
    return (
      <div className="activity" data-stuck="">
        <span className="activity-dot" aria-hidden="true" />
        <span role="status" className="font-semibold">
          Possibly stuck: {line.label.charAt(0).toLowerCase() + line.label.slice(1)}
        </span>
        <span className="text-mut tabular-nums">{detail}</span>
        <span className="basis-full pl-[19px] text-[13px]">
          Nothing has arrived for {Math.round((now - (pulse?.last ?? now)) / 60_000)} min and
          nothing is waiting for you. Interrupt stops this turn and keeps what was done.
        </span>
      </div>
    )
  return (
    <div className="activity">
      <span className="activity-dot" aria-hidden="true" />
      <span role="status" className="font-semibold">
        {line.label}
      </span>
      {detail ? <span className="text-mut tabular-nums">{detail}</span> : null}
      {line.hint ? (
        <span className="basis-full pl-[19px] text-[13px] text-mut">{line.hint}</span>
      ) : null}
    </div>
  )
}

function Composer({ sessionId, disabled }: { sessionId: string; disabled: boolean }) {
  // One composer per pane in split view, so its id must be its own.
  const composerId = useId()
  const [text, setText] = useState("")
  const [active, setActive] = useState(0)
  const area = useRef<HTMLTextAreaElement>(null)
  const addUserText = useStore((s) => s.addUserText)
  const meta = useStore((s) => s.meta[sessionId])
  const insert = (more: string) => {
    setText((t) => (t && !/\s$/.test(t) ? t + " " : t) + more)
    area.current?.focus()
  }
  async function attachPictures(files: File[]): Promise<boolean> {
    const pictures = files.filter((f) => /^image\/(png|jpeg|gif|webp)$/.test(f.type))
    if (pictures.length === 0) return false
    for (const f of pictures) {
      const data = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "")
        reader.readAsDataURL(f)
      })
      const r = await api<{ rel: string }>("POST", "/api/files/attach-data", {
        session: sessionId,
        name: f.name,
        type: f.type,
        data,
      })
      if (r.ok && r.data) insert(`@${r.data.rel} `)
      else toast.error(r.error ?? "The picture was not attached")
    }
    return true
  }

  const showMenu = text.startsWith("/") && !text.includes(" ") && !text.includes("\n")
  const matches = showMenu ? SLASH.filter((c) => c.cmd.startsWith(text.toLowerCase())) : []

  async function submit() {
    const t = text.trim()
    if (!t) return
    if (t.startsWith("/")) {
      const [cmd, ...rest] = t.split(/\s+/)
      const arg = rest.join(" ")
      let r
      switch (cmd?.toLowerCase()) {
        case "/plan":
          r = await send({ type: "set_mode", sessionId, mode: "plan" })
          break
        case "/default":
          r = await send({ type: "set_mode", sessionId, mode: "default" })
          break
        case "/accept-edits":
          r = await send({ type: "set_mode", sessionId, mode: "acceptEdits" })
          break
        case "/auto":
          r = await send({ type: "set_mode", sessionId, mode: "auto" })
          break
        case "/extreme": {
          const cur = useStore.getState().sessions[sessionId]?.extreme === true
          r = await send({ type: "set_extreme", sessionId, on: !cur })
          break
        }
        case "/effort":
          r = EFFORTS.some((x) => x.id === arg)
            ? await send({ type: "set_effort", sessionId, effort: arg as EffortId })
            : {
                ok: false,
                error: { code: "bad-effort", message: "Use low, medium, high, xhigh or max" },
              }
          break
        case "/model":
          r = await send({ type: "set_model", sessionId, ...(arg ? { model: arg } : {}) })
          break
        case "/stop":
          r = await send({ type: "interrupt", sessionId })
          break
        case "/close":
          r = await send({ type: "close_session", sessionId })
          break
        default:
          toast.error(`Unknown command ${cmd}. Type / to see the list.`)
          return
      }
      if (!r.ok) toast.error(r.error?.message ?? "That did not work")
      setText("")
      return
    }
    addUserText(sessionId, t)
    setText("")
    const r = await send({ type: "prompt", sessionId, text: t })
    if (!r.ok) toast.error(r.error?.message ?? "The prompt was not sent")
  }

  return (
    <div className="relative grid gap-1">
      {matches.length > 0 ? (
        <ul
          role="listbox"
          aria-label="Commands"
          className="panel absolute bottom-full left-0 z-10 mb-1 m-0 w-[420px] list-none p-1"
        >
          {matches.map((c, i) => (
            <li key={c.cmd} role="option" aria-selected={i === active}>
              <button
                className={clsx(
                  "flex w-full gap-3 rounded border-0 bg-transparent px-2 py-1 text-left",
                  i === active && "bg-s2",
                )}
                onMouseDown={(e) => {
                  e.preventDefault()
                  setText(c.cmd + " ")
                  area.current?.focus()
                }}
              >
                <span className="mono font-semibold">{c.cmd}</span>
                <span className="text-mut">{c.help}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <label htmlFor={composerId} className="sr-only">
        Prompt
      </label>
      <div className="flex items-end gap-2">
        <PlusMenu sessionId={sessionId} meta={meta} onInsert={insert} disabled={disabled} />
        <textarea
          id={composerId}
          ref={area}
          className="field w-full resize-y"
          onPaste={(e) => {
            const files = [...e.clipboardData.files]
            if (files.length) {
              e.preventDefault()
              void attachPictures(files)
            }
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            const files = [...e.dataTransfer.files]
            if (!files.length) return
            e.preventDefault()
            void attachPictures(files).then((ok) => {
              if (!ok) toast("Use the plus button to add files other than pictures.")
            })
          }}
          rows={2}
          maxLength={100_000}
          disabled={disabled}
          placeholder={
            disabled
              ? "This session has ended"
              : "Write a prompt. Enter sends, Shift+Enter adds a line. / for commands."
          }
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setActive(0)
          }}
          onKeyDown={(e) => {
            if (matches.length > 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault()
              setActive(
                (a) => (a + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length,
              )
            } else if (matches.length > 0 && e.key === "Tab") {
              e.preventDefault()
              setText((matches[active]?.cmd ?? text) + " ")
            } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void submit()
            }
          }}
        />
      </div>
    </div>
  )
}

function TodoPanel({ todos }: { todos: Todo[] }) {
  return (
    <section aria-label="Todo list">
      <h2 className="m-0 mb-2 text-[15px]">Todo list</h2>
      {todos.length === 0 ? (
        <p className="m-0 text-mut">Claude has not made a list yet.</p>
      ) : (
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {todos.map((t, i) => (
            <li key={i} className="flex items-start gap-2">
              <span aria-hidden="true" className="mt-0.5 w-4 shrink-0 text-center">
                {t.status === "completed" ? "✓" : t.status === "in_progress" ? "▶" : "○"}
              </span>
              <span className={t.status === "completed" ? "text-mut line-through" : undefined}>
                {t.content}
                <span className="sr-only">{`, ${t.status.replace("_", " ")}`}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function SessionFacts({ sessionId }: { sessionId: string }) {
  const cost = useStore((s) => s.usage?.bySession?.[sessionId]?.costUsd)
  return cost === undefined ? null : (
    <p className="mt-6 text-mut">
      Spend this session: <strong>{money(cost)}</strong>
    </p>
  )
}

/**
 * A run of tool calls as one line, "Ran 2 commands, read schema.ts", that opens to each call and its output. It
 * says when one of them is waiting for you.
 */
const ToolGroup = memo(function ToolGroup({
  tools,
}: {
  tools: Array<Extract<Item, { kind: "tool" }>>
}) {
  const [open, setOpen] = useState(false)
  const waiting = useStore((st) =>
    tools.some(
      (t) =>
        !t.result && Object.values(st.pending).some((p) => p.request.toolUseId === t.toolUseId),
    ),
  )
  return (
    <div className={clsx(tools[0]?.subagent && "ml-5")}>
      <button
        type="button"
        className="tool-group-line"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{summarise(tools)}</span>
        {waiting ? <span className="font-semibold text-tx">Waiting for you</span> : null}
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <div className="grid gap-1.5 pt-1.5">
          {tools.map((t) => (
            <ToolCard key={t.id} item={t} />
          ))}
        </div>
      ) : null}
    </div>
  )
})

export const ItemView = memo(function ItemView({ item }: { item: Item }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="ml-auto max-w-[80%] whitespace-pre-wrap rounded-md border border-line bg-s2 px-3 py-2 [overflow-wrap:anywhere]">
          <span className="sr-only">You: </span>
          {item.text}
        </div>
      )
    case "text":
      return (
        <div
          className={clsx(
            "[overflow-wrap:anywhere] [&_code]:font-[var(--font-code)] [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-s2 [&_pre]:p-3 [&_table]:border-collapse [&_td]:border [&_td]:border-line [&_td]:px-2 [&_th]:border [&_th]:border-line [&_th]:px-2",
            item.subagent && "ml-5 border-l-2 border-line pl-3",
          )}
        >
          <Markdown remarkPlugins={[remarkGfm]}>{item.text}</Markdown>
        </div>
      )
    case "thinking":
      return (
        <details className="text-mut">
          <summary className="cursor-pointer">Thinking</summary>
          <p className="whitespace-pre-wrap">{item.text}</p>
        </details>
      )
    case "tool":
      return <ToolCard item={item} />
    case "result":
      return (
        <p className={clsx("m-0 text-xs", item.isError ? "font-semibold text-sev" : "text-mut")}>
          {item.isError ? "Turn ended with an error: " : "Turn finished. "}
          {item.isError ? item.text : ""}
          {item.costUsd !== undefined ? ` Session cost so far ${money(item.costUsd)}.` : ""}
        </p>
      )
    case "system":
      return <p className="m-0 text-xs text-mut">{item.text}</p>
  }
})

function ToolCard({ item }: { item: Extract<Item, { kind: "tool" }> }) {
  const input = item.input
  const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : undefined)
  const isShell = item.name === "Bash" || item.name === "PowerShell"
  const path = s("file_path") ?? s("path")
  const edit =
    item.name === "Edit" && s("old_string") !== undefined && s("new_string") !== undefined
  const waiting = useStore(
    (st) =>
      !item.result && Object.values(st.pending).some((p) => p.request.toolUseId === item.toolUseId),
  )
  return (
    <details className={clsx("panel", item.subagent && "ml-5")} open={edit || undefined}>
      <summary className="flex cursor-pointer flex-wrap items-baseline gap-2 px-3 py-1.5">
        <strong>{item.name}</strong>
        <span className="mono min-w-0 flex-1 truncate text-xs text-mut">
          {isShell
            ? s("command")?.split("\n")[0]
            : (path ?? s("pattern") ?? s("description") ?? "")}
        </span>
        {item.result ? (
          <span
            className={clsx("text-xs", item.result.isError ? "font-semibold text-sev" : "text-mut")}
          >
            {item.result.isError ? "Failed" : "Done"}
          </span>
        ) : waiting ? (
          <span className="text-xs font-semibold">Waiting for you</span>
        ) : (
          <span className="text-xs text-mut">No result yet</span>
        )}
      </summary>
      <div className="grid gap-2 border-t border-line p-3">
        {isShell ? (
          <pre className="cmd">{s("command")}</pre>
        ) : edit ? (
          <DiffView oldText={s("old_string") as string} newText={s("new_string") as string} />
        ) : (
          <pre className="cmd">{JSON.stringify(input, null, 2)}</pre>
        )}
        {path ? <p className="mono m-0 text-xs text-mut [overflow-wrap:anywhere]">{path}</p> : null}
        {item.result ? (
          <pre className={clsx("cmd max-h-72 overflow-auto", item.result.isError && "text-sev")}>
            {item.result.text.length > 20_000
              ? item.result.text.slice(0, 20_000) +
                `\n[${item.result.text.length - 20_000} more characters not shown]`
              : item.result.text || "(no output)"}
          </pre>
        ) : null}
      </div>
    </details>
  )
}

/** Line diff with +/- markers as well as colour, so it reads in any theme and without colour. */
function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const parts = useMemo(() => diffLines(oldText, newText), [oldText, newText])
  return (
    <pre className="cmd max-h-96 overflow-auto !p-0" aria-label="Changes">
      {parts.flatMap((p, i) =>
        p.value
          .replace(/\n$/, "")
          .split("\n")
          .map((line, j) => (
            <div
              key={`${i}-${j}`}
              className={clsx(
                "px-3",
                p.added && "bg-hi font-semibold",
                p.removed && "text-sev line-through decoration-1",
              )}
            >
              <span aria-hidden="true" className="mr-2 inline-block w-3 select-none">
                {p.added ? "+" : p.removed ? "-" : " "}
              </span>
              <span className="sr-only">
                {p.added ? "Added: " : p.removed ? "Removed: " : "Unchanged: "}
              </span>
              {line}
            </div>
          )),
      )}
    </pre>
  )
}
