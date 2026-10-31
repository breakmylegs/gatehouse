import type { PendingView, SessionInfo } from "@gatehouse/shared/ws-protocol"
import clsx from "clsx"
import { diffLines } from "diff"
import { memo, useEffect, useId, useMemo, useRef, useState } from "react"
import Markdown from "react-markdown"
import { Virtuoso } from "react-virtuoso"
import remarkGfm from "remark-gfm"
import { toast } from "sonner"
import { addSystem, emptyTranscript, type Item, type Picture as Shown, type Todo } from "../lib/transcript"
import { usePictures } from "../lib/pictures"
import { describeActivity, describePulse } from "../lib/activity"
import { groupItems, summarise } from "../lib/groups"
import { useNow } from "../lib/useNow"
import { ApprovalCard } from "../components/ApprovalCard"
import { QuickDecision } from "../components/QuickDecision"
import { money, stamp } from "../lib/format"
import { MAIN_ACCOUNT, send, usePending, useSessionList, useStore } from "../store"
import { PlanMeter } from "../components/PlanMeter"
import { MODELS } from "./Sessions"
import { SessionCode } from "../components/SessionCode"
import { Menu, type MenuItem } from "../components/Menu"
import { PictureViewer } from "../components/PictureViewer"
import { RenameDialog } from "../components/RenameDialog"
import { archiveSession, exportOpenSession, setSessionMeta, titleOf } from "../lib/sessionActions"
import { ChangesPane } from "../components/ChangesPane"
import { TerminalPane } from "../components/TerminalPane"
import { FilesPanel, Viewer, type Opened } from "../components/FilesPanel"
import { PlusMenu } from "../components/PlusMenu"
import { api } from "../lib/api"
import { describeDecision, fromRecord } from "../lib/decision"
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
  { cmd: "/stop", help: "Stop the turn and anything in the background" },
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
      <div className="min-h-0 flex-1 overflow-auto">
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
      </div>
    )
  }

  return (
    <div
      className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] divide-x divide-line"
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
  const [renaming, setRenaming] = useState(false)
  const [lastUrl, setLastUrl] = useState("http://localhost:5173/")
  // A file from one session is never shown in another.
  useEffect(() => setOpened(undefined), [selected])
  // How this session's tool calls were decided, read back from the audit log, so the lines show after a reload.
  const addDecisions = useStore((s) => s.addDecisions)
  useEffect(() => {
    let gone = false
    void api<{ records: unknown[] }>(
      "GET",
      `/api/audit?session=${encodeURIComponent(sessionId)}&limit=500`,
    ).then((r) => {
      if (gone || !r.ok || !Array.isArray(r.data?.records)) return
      addDecisions(
        r.data.records.map(fromRecord).filter((x): x is NonNullable<typeof x> => x !== undefined),
      )
    })
    return () => {
      gone = true
    }
  }, [sessionId, addDecisions])
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
  // A turn that ended can leave subagents or commands working; the session is busy until they finish.
  const background = session.background ?? []
  const busy = running || background.length > 0
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
      label: "Stop",
      disabled: !busy,
      onSelect: () => void send({ type: "stop_session", sessionId: session.id }),
    },
    { label: "Rename...", onSelect: () => setRenaming(true) },
    {
      label: session.pinned ? "Unpin" : "Pin to the top",
      onSelect: () =>
        void setSessionMeta(
          session,
          { pinned: !session.pinned },
          session.pinned ? `Unpinned ${titleOf(session)}.` : `Pinned ${titleOf(session)}.`,
        ),
    },
    { label: "Export as Markdown", onSelect: () => exportOpenSession(session) },
    { kind: "separator" },
    {
      label: "Close session",
      danger: true,
      disabled: session.state === "ended",
      onSelect: () => void send({ type: "close_session", sessionId: session.id }),
    },
    { label: "Archive", danger: true, onSelect: () => void archiveSession(session) },
  ]

  return (
    <div
      className="pane relative grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto]"
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
            label={`${titleOf(session)}: switch, open beside, rename, interrupt or close`}
            className="pane-title"
            button={
              <>
                <span className="min-w-[6ch] truncate">{titleOf(session)}</span>
                <span className="shrink-0 text-[12.5px] font-normal text-mut">
                  {session.state === "idle" && background.length
                    ? "Working in the background"
                    : STATE_WORDS[session.state]}
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
      {renaming ? (
        <RenameDialog
          current={session.title}
          fallback={session.project}
          onClose={() => setRenaming(false)}
          onSave={(title) =>
            void setSessionMeta(
              session,
              { title },
              title ? `Renamed to ${title}.` : `${session.project} has its own name again.`,
            )
          }
        />
      ) : null}

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
                {it.kind === "group" ? (
                  <ToolGroup tools={it.tools} />
                ) : (
                  <ItemView item={it} sessionId={session.id} />
                )}
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
        ) : background.length ? (
          <BackgroundLine tasks={background} />
        ) : null}
        <Composer sessionId={session.id} disabled={ended} />
        {/* What the session runs on, under the prompt box where you look when you send. */}
        <div className="composer-bar" role="group" aria-label="Model, effort and mode">
          <ContextMeter
            sessionId={session.id}
            state={session.state}
            pending={session.compactPending === true}
          />
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
          {session.resources ? (
            <label className="composer-pick">
              <span className="text-mut">Resources</span>
              <select
                className="composer-select"
                value={session.resources}
                disabled={ended}
                onChange={(e) => void changeResources(session.id, e.target.value as Level)}
              >
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </label>
          ) : null}
          <span className="ml-auto flex items-center gap-2">
            <PlanMeter account={session.account ?? MAIN_ACCOUNT} idle={session.state === "idle"} />
            <StopButton sessionId={session.id} busy={busy} />
          </span>
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
    <div className="grid max-h-[40vh] overflow-y-auto">
      {view.request.kind === "permission" ? (
        <QuickDecision view={view} variant="panel" onMore={() => onOpen(view.request.id)} />
      ) : (
        <div className="mb-2">
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

type Level = "low" | "medium" | "high"
/** What each level lets the session use, said when you choose it. */
export const LEVEL_WORDS: Record<Level, string> = {
  high: "High: no limits for this session.",
  medium:
    "Medium: this session and the commands it runs may use half the processor and 4 GB of memory, and give way to what you are doing. A command that needs more memory fails.",
  low: "Low: this session and the commands it runs may use a fifth of the processor and 2 GB of memory, and give way to what you are doing. A command that needs more memory fails.",
}

/** Low, Medium or High for one session, applied at once to it and to everything it started (owner, 30 Oct). */
async function changeResources(sessionId: string, level: Level) {
  const r = await send({ type: "set_resources", sessionId, level })
  if (r.ok) toast(LEVEL_WORDS[level], { id: "resources" })
  else toast.error(r.error?.message ?? "The limits were not changed", { id: "resources" })
}

/** What the session is doing while a turn runs: thinking, writing a file, running a command. */
interface ContextUsage {
  percentage: number
  totalTokens: number
  maxTokens: number
  categories: Array<{ name: string; tokens: number; kind?: string }>
}

const tokens = (n: number) => (n < 1000 ? `${n}` : `${Math.round(n / 1000)}k`)

/** From this full, compacting is worth it; from the second, it is pressing. Claude Code compacts by itself near the limit. */
export const COMPACT_WORTH = 60
export const COMPACT_SOON = 80

/**
 * How full the conversation is: what Claude holds in mind for this session, as a share of what it can. Always shown;
 * read when the pane opens and after each turn, from the last response and local estimates (no extra calls to count
 * tokens). Opens to what fills it, and to Compact now, which summarises the older parts between turns.
 */
function ContextMeter({
  sessionId,
  state,
  pending,
}: {
  sessionId: string
  state: SessionInfo["state"]
  /** You asked to compact while a turn ran: it compacts when the turn ends. */
  pending: boolean
}) {
  const [u, setU] = useState<ContextUsage>()
  const [open, setOpen] = useState(false)
  const read = useRef(false)
  const between = state === "idle"
  useEffect(() => {
    // Once when the pane opens, whatever the session is doing; then after every turn.
    if (read.current && state !== "idle") return
    read.current = true
    let gone = false
    void send({ type: "context_usage", sessionId }).then((r) => {
      if (!gone && r.ok && r.data) setU(r.data as ContextUsage)
    })
    return () => {
      gone = true
    }
  }, [sessionId, state])
  const pct = u ? Math.max(0, Math.round(u.percentage)) : undefined
  const used = (u?.categories ?? [])
    .filter((c) => (c.kind ?? "used") === "used" && c.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 6)
  const worth = pct !== undefined && pct >= COMPACT_WORTH
  const advice =
    pct === undefined
      ? "JCVC reads this after each turn."
      : pct >= COMPACT_SOON
        ? "Compact now: the conversation is nearly full, and Claude Code will soon summarise it by itself, at a moment it chooses."
        : worth
          ? "Worth compacting now. It summarises the older parts, so Claude keeps the thread and has room to work."
          : `Not needed yet. Compacting is worth it from about ${COMPACT_WORTH}%.`
  // Owner, 31 Oct: Compact can be pressed while Claude works; it then compacts when the turn ends.
  function compact() {
    setOpen(false)
    useStore.setState((s) => ({
      transcripts: {
        ...s.transcripts,
        [sessionId]: addSystem(
          s.transcripts[sessionId] ?? emptyTranscript(),
          between
            ? "You asked Claude Code to compact the conversation."
            : "You asked Claude Code to compact the conversation when this turn ends.",
        ),
      },
    }))
    void send({ type: "compact", sessionId }).then((r) => {
      if (!r.ok) toast.error(r.error?.message ?? "Compacting did not start")
    })
  }
  return (
    <span className="relative">
      <button
        type="button"
        className="ctx-meter"
        aria-expanded={open}
        aria-label={
          u && pct !== undefined
            ? `Context ${pct}% used, ${tokens(u.totalTokens)} of ${tokens(u.maxTokens)} tokens${worth ? ", worth compacting" : ""}`
            : "Context, not read yet"
        }
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-mut">Context</span> {pct !== undefined ? `${pct}%` : null}
        <span className="ctx-track" aria-hidden="true">
          <span
            className={clsx("ctx-fill", pct !== undefined && pct >= COMPACT_SOON && "ctx-high")}
            style={{ width: `${Math.min(100, pct ?? 0)}%` }}
          />
        </span>
        {worth ? <span className="ctx-advice">Compact</span> : null}
      </button>
      {open ? (
        <div role="group" aria-label="What fills the context" className="ctx-panel panel">
          {u ? (
            <>
              <p className="m-0 font-semibold">
                {tokens(u.totalTokens)} of {tokens(u.maxTokens)} tokens
              </p>
              <ul className="m-0 grid list-none gap-0.5 p-0 text-[13px]">
                {used.map((c) => (
                  <li key={c.name} className="flex justify-between gap-4">
                    <span>{c.name}</span>
                    <span className="tabular-nums text-mut">{tokens(c.tokens)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <p
            className={clsx(
              "m-0 text-[13px]",
              pct !== undefined && pct >= COMPACT_SOON && "font-semibold",
            )}
          >
            {advice}
          </p>
          <span className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={clsx("btn !min-h-7", worth && "btn-primary")}
              disabled={pending || state === "starting" || state === "ended" || state === "error"}
              onClick={compact}
            >
              {pending ? "Compacts after this turn" : between ? "Compact now" : "Compact after this turn"}
            </button>
          </span>
          <p className="m-0 text-[12.5px] text-mut">
            How much of what Claude can hold in mind this conversation uses. When it is nearly full,
            Claude Code summarises the older parts by itself and the conversation carries on.
          </p>
        </div>
      ) : null}
    </span>
  )
}

/** What is still working after the turn ended: subagents and commands Claude left running. */
function BackgroundLine({ tasks }: { tasks: string[] }) {
  const named = tasks.filter(Boolean)
  return (
    <div className="activity">
      <span className="activity-dot" aria-hidden="true" />
      <span role="status" className="font-semibold">
        {tasks.length === 1 ? "1 task" : `${tasks.length} tasks`} working in the background
      </span>
      {named.length ? <span className="text-mut">{named.join(", ")}</span> : null}
    </div>
  )
}

/** Seconds after Stop before Force stop is offered, for a session that does not stop when asked. */
export const FORCE_AFTER_MS = 5000

/**
 * Stops the session there and then: the turn and everything in the background. If it is still working a few
 * seconds later, Force stop ends its Claude process and starts it again on the same conversation.
 */
function StopButton({ sessionId, busy }: { sessionId: string; busy: boolean }) {
  const [askedAt, setAskedAt] = useState<number>()
  const now = useNow(1000)
  useEffect(() => {
    if (!busy) setAskedAt(undefined)
  }, [busy])
  if (!busy) return null
  const stuck = askedAt !== undefined && now - askedAt >= FORCE_AFTER_MS
  return (
    <span className="flex gap-2">
      {stuck ? (
        <button
          type="button"
          className="btn btn-deny !min-h-7 font-semibold"
          onClick={() =>
            void send({ type: "force_stop", sessionId }, 60_000).then((r) => {
              if (!r.ok) toast.error(r.error?.message ?? "It could not be force-stopped")
            })
          }
        >
          Force stop
        </button>
      ) : null}
      <button
        type="button"
        className="btn btn-deny !min-h-7"
        onClick={() => {
          setAskedAt(Date.now())
          void send({ type: "stop_session", sessionId })
        }}
      >
        {askedAt !== undefined && !stuck ? "Stopping" : "Stop"}
      </button>
    </span>
  )
}

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

interface Picture {
  id: string
  name: string
  url: string
  /** Where it was saved in the session's folder; absent while it is being attached. */
  rel?: string
}
let pictureSeq = 0

function Composer({ sessionId, disabled }: { sessionId: string; disabled: boolean }) {
  // One composer per pane in split view, so its id must be its own.
  const composerId = useId()
  // What you typed and had not sent comes back after JCVC restarts.
  const draftKey = `gatehouse.draft.${sessionId}`
  const [text, setText] = useState(() => localStorage.getItem(draftKey) ?? "")
  useEffect(() => {
    if (text) localStorage.setItem(draftKey, text)
    else localStorage.removeItem(draftKey)
  }, [text, draftKey])
  const [active, setActive] = useState(0)
  const area = useRef<HTMLTextAreaElement>(null)
  const addUserText = useStore((s) => s.addUserText)
  const meta = useStore((s) => s.meta[sessionId])
  const insert = (more: string) => {
    setText((t) => (t && !/\s$/.test(t) ? t + " " : t) + more)
    area.current?.focus()
  }
  // Pictures you paste, drop or add: shown as thumbnails, saved into the session's folder, and sent as references
  // with your message, so the prompt box keeps only what you typed (owner, 30 Oct).
  const [pictures, setPictures] = useState<Picture[]>([])
  const [viewing, setViewing] = useState<{ url: string; name: string }>()
  async function attachPictures(files: File[]): Promise<boolean> {
    const chosen = files.filter((f) => /^image\/(png|jpeg|gif|webp)$/.test(f.type))
    if (chosen.length === 0) return false
    await Promise.all(
      chosen.map(async (f) => {
        const id = `p${++pictureSeq}`
        const url = URL.createObjectURL(f)
        const name = f.name && f.name !== "image.png" ? f.name : "Pasted picture"
        setPictures((p) => [...p, { id, name, url }])
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
        if (r.ok && r.data) {
          const rel = r.data.rel
          setPictures((p) => p.map((x) => (x.id === id ? { ...x, rel } : x)))
        } else {
          setPictures((p) => p.filter((x) => x.id !== id))
          URL.revokeObjectURL(url)
          toast.error(r.error ?? "The picture was not attached")
        }
      }),
    )
    area.current?.focus()
    return true
  }
  /** Pictures the + menu already saved into the folder: shown through the session's preview address. */
  async function addSavedPictures(rels: string[]) {
    const r = await api<{ base: string }>("POST", "/api/files/preview", { session: sessionId })
    const base = r.ok && r.data ? r.data.base : undefined
    if (!base) {
      insert(rels.map((rel) => `@${rel}`).join(" ") + " ")
      return
    }
    setPictures((p) => [
      ...p,
      ...rels.map((rel) => ({
        id: `p${++pictureSeq}`,
        name: rel.split("/").at(-1) ?? rel,
        url: base + rel.split("/").map(encodeURIComponent).join("/"),
        rel,
      })),
    ])
    area.current?.focus()
  }

  const showMenu = text.startsWith("/") && !text.includes(" ") && !text.includes("\n")
  const matches = showMenu ? SLASH.filter((c) => c.cmd.startsWith(text.toLowerCase())) : []

  async function submit() {
    const t = text.trim()
    if (!t && pictures.length === 0) return
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
          r = await send({ type: "stop_session", sessionId })
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
    if (pictures.some((p) => !p.rel)) {
      toast("A picture is still being attached. Send again in a moment.")
      return
    }
    // What Claude gets: your words, then a reference to each picture, which it opens.
    const full = [t, pictures.map((p) => `@${p.rel}`).join(" ")].filter(Boolean).join("\n\n")
    // While Claude works, the message waits for its next step (owner, 30 Oct), and says so until it is taken in.
    const st = useStore.getState().sessions[sessionId]?.state
    addUserText(
      sessionId,
      t,
      pictures.map((p) => ({ url: p.url, name: p.name })),
      st === "running" || st === "waiting",
    )
    setText("")
    setPictures([])
    const r = await send({ type: "prompt", sessionId, text: full })
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
      {pictures.length ? (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0 pl-12" aria-label="Pictures to send">
          {pictures.map((p) => (
            <li key={p.id} className="pic-chip" data-busy={p.rel ? undefined : ""}>
              <button
                type="button"
                className="pic-thumb"
                aria-label={`Show ${p.name}`}
                onClick={() => setViewing({ url: p.url, name: p.name })}
              >
                <img src={p.url} alt="" />
              </button>
              {p.rel ? null : <span className="pic-busy">Attaching</span>}
              <button
                type="button"
                className="pic-remove"
                aria-label={`Remove ${p.name}`}
                onClick={() => {
                  setPictures((all) => all.filter((x) => x.id !== p.id))
                  area.current?.focus()
                }}
              >
                <span aria-hidden="true">&times;</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {viewing ? (
        <PictureViewer
          url={viewing.url}
          name={viewing.name}
          onClose={() => setViewing(undefined)}
        />
      ) : null}
      <div className="flex items-end gap-2">
        <PlusMenu
          sessionId={sessionId}
          meta={meta}
          onInsert={insert}
          onPictures={(rels) => void addSavedPictures(rels)}
          disabled={disabled}
        />
        <textarea
          id={composerId}
          ref={area}
          className="field max-h-[30vh] w-full resize-y"
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
  const blocked = useStore(
    (st) => tools.filter((t) => st.decisions[t.toolUseId]?.outcome === "deny").length,
  )
  // What the tools gave back as pictures (a page Claude captured, a picture it read), beside the line.
  const pictures = useMemo(() => tools.flatMap((t) => t.result?.images ?? []), [tools])
  const [viewing, setViewing] = useState<Shown>()
  return (
    <div className={clsx(tools[0]?.subagent && "ml-5")}>
      <div className="tool-group-row">
        <button
          type="button"
          className="tool-group-line"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span>{summarise(tools)}</span>
          {waiting ? <span className="font-semibold text-tx">Waiting for you</span> : null}
          {blocked ? <span className="font-semibold text-sev">{blocked} blocked</span> : null}
          <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        </button>
        {pictures.length ? (
          <span className="tool-pics">
            {pictures.slice(0, 3).map((p, i) => (
              <button
                key={i}
                type="button"
                className="pic-tool"
                aria-label={`Show ${p.name}`}
                onClick={() => setViewing(p)}
              >
                <img src={p.url} alt="" />
              </button>
            ))}
            {pictures.length > 3 ? (
              <span className="text-xs text-mut">and {pictures.length - 3} more</span>
            ) : null}
          </span>
        ) : null}
      </div>
      {viewing?.url ? (
        <PictureViewer
          url={viewing.url}
          name={viewing.name}
          onClose={() => setViewing(undefined)}
        />
      ) : null}
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

/** When a message arrived, small and quiet; the full date and time for a screen reader. */
function Stamp({ at, end }: { at?: number; end?: boolean }) {
  if (!at) return null
  return (
    <time
      dateTime={new Date(at).toISOString()}
      className={clsx("msg-time", end && "text-right")}
      aria-label={new Date(at).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" })}
    >
      {stamp(at)}
    </time>
  )
}

/**
 * What you sent, with the pictures you attached, each opening large. After a restart a picture comes back from the
 * session folder, where it was saved when you attached it.
 */
function UserMessage({
  text,
  images,
  sessionId,
}: {
  text: string
  images?: Shown[]
  sessionId?: string
}) {
  const [viewing, setViewing] = useState<{ url: string; name: string }>()
  const { shown, retry } = usePictures(sessionId, images)
  return (
    <div className="ml-auto grid max-w-[80%] justify-items-end gap-1.5">
      {shown.length ? (
        <div className="flex flex-wrap justify-end gap-1.5">
          {shown.map((im, i) =>
            im.url ? (
              <button
                key={i}
                type="button"
                className="pic-sent"
                aria-label={`Show ${im.name}`}
                onClick={() => setViewing({ url: im.url as string, name: im.name })}
              >
                <img src={im.url} alt={im.name} onError={retry} />
              </button>
            ) : (
              <span key={i} className="pic-sent pic-missing">
                {im.name}
              </span>
            ),
          )}
        </div>
      ) : null}
      {text ? (
        <div className="whitespace-pre-wrap rounded-md border border-line bg-s2 px-3 py-2 [overflow-wrap:anywhere]">
          <span className="sr-only">You: </span>
          {text}
        </div>
      ) : null}
      {viewing ? (
        <PictureViewer
          url={viewing.url}
          name={viewing.name}
          onClose={() => setViewing(undefined)}
        />
      ) : null}
    </div>
  )
}

export const ItemView = memo(function ItemView({
  item,
  sessionId,
}: {
  item: Item
  sessionId?: string
}) {
  switch (item.kind) {
    case "user":
      return (
        <>
          <UserMessage text={item.text} images={item.images} sessionId={sessionId} />
          {item.queued ? (
            <p className="m-0 mt-1 flex flex-wrap items-center justify-end gap-2 text-[13px] text-mut">
              Queued: Claude reads it at its next step.
              {sessionId ? (
                <button
                  type="button"
                  className="btn !min-h-7 !text-[13px]"
                  onClick={() => void send({ type: "stop_session", sessionId })}
                >
                  Interrupt now
                </button>
              ) : null}
            </p>
          ) : (
            <Stamp at={item.at} end />
          )}
        </>
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
          <Stamp at={item.at} />
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
          {item.stopped
            ? item.text
            : item.isError
              ? `Turn ended with an error: ${item.text}`
              : "Turn finished."}
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
  // Why it was allowed, asked or stopped (F2). Your rules' allows stay quiet: most calls are those.
  const decision = useStore((st) => st.decisions[item.toolUseId])
  const said = decision ? describeDecision(decision) : undefined
  const [viewing, setViewing] = useState<Shown>()
  const setRoute = useStore((st) => st.setRoute)
  const changeable =
    decision !== undefined &&
    (decision.decidedBy === "rules" || decision.decidedBy === "judge") &&
    decision.ruleId !== "claude-code-auto" &&
    decision.ruleId !== "ask-user-question" &&
    decision.ruleId !== "exit-plan-mode"
  return (
    <details className={clsx("panel", item.subagent && "ml-5")} open={edit || undefined}>
      <summary className="flex cursor-pointer flex-wrap items-baseline gap-2 px-3 py-1.5">
        <strong>{item.name}</strong>
        <span className="mono min-w-0 flex-1 truncate text-xs text-mut">
          {isShell
            ? s("command")?.split("\n")[0]
            : (path ?? s("pattern") ?? s("description") ?? "")}
        </span>
        {said?.mark ? (
          <span className={clsx("text-xs font-semibold", said.stopped ? "text-sev" : "text-tx")}>
            {said.mark}
          </span>
        ) : null}
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
        {said ? (
          <p className="m-0 flex flex-wrap items-center gap-2 text-xs text-mut">
            <span className="[overflow-wrap:anywhere]">{said.line}</span>
            {changeable ? (
              <button
                type="button"
                className="btn !min-h-6 !text-[12px]"
                onClick={() => setRoute("policy")}
              >
                Change what Claude may do
              </button>
            ) : null}
          </p>
        ) : null}
        {isShell ? (
          <pre className="cmd">{s("command")}</pre>
        ) : edit ? (
          <DiffView oldText={s("old_string") as string} newText={s("new_string") as string} />
        ) : (
          <pre className="cmd">{JSON.stringify(input, null, 2)}</pre>
        )}
        {path ? <p className="mono m-0 text-xs text-mut [overflow-wrap:anywhere]">{path}</p> : null}
        {item.result && (item.result.text || !item.result.images?.length) ? (
          <pre className={clsx("cmd max-h-72 overflow-auto", item.result.isError && "text-sev")}>
            {item.result.text.length > 20_000
              ? item.result.text.slice(0, 20_000) +
                `\n[${item.result.text.length - 20_000} more characters not shown]`
              : item.result.text || "(no output)"}
          </pre>
        ) : null}
        {item.result?.images?.length ? (
          <span className="flex flex-wrap gap-1.5">
            {item.result.images.map((p, i) => (
              <button
                key={i}
                type="button"
                className="pic-sent"
                aria-label={`Open ${p.name}`}
                onClick={() => setViewing(p)}
              >
                <img src={p.url} alt={p.name} />
              </button>
            ))}
          </span>
        ) : null}
      </div>
      {viewing?.url ? (
        <PictureViewer
          url={viewing.url}
          name={viewing.name}
          onClose={() => setViewing(undefined)}
        />
      ) : null}
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
