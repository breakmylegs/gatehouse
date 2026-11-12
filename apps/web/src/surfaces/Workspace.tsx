import { MemoryGiven, useMemoryGiven } from "../components/MemoryGiven"
import { Decisions } from "../components/Decisions"
import { Architecture } from "../components/Architecture"
import { TestsFirstBanner, TestsFirstStart } from "../components/TestsFirst"
import { Requirements } from "../components/Requirements"
import { Evidence } from "../components/Evidence"
import { SessionDetails } from "../components/SessionDetails"
import { CounterexampleCards } from "../components/CounterexampleCards"
import { InstructionsReview } from "../components/InstructionsReview"
import { InjectionFlags } from "../components/InjectionFlags"
import { BranchNav, BranchSteps, useBranchSteps } from "../components/BranchNav"
import {
  aboveCap,
  type PendingView,
  type ResourceLevel,
  type SessionInfo,
} from "@gatehouse/shared/ws-protocol"
import clsx from "clsx"
import { diffLines } from "diff"
import {
  createContext,
  isValidElement,
  memo,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react"
import Markdown from "react-markdown"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import remarkGfm from "remark-gfm"
import { toast } from "sonner"
import {
  addSystem,
  emptyTranscript,
  type Item,
  type Picture as Shown,
  type Todo,
} from "../lib/transcript"
import { usePictures } from "../lib/pictures"
import { describeActivity, describePulse } from "../lib/activity"
import { groupItems, summarise, summaryItems } from "../lib/groups"
import { ProgressCard, StepList } from "../components/ProgressCard"
import { carryOnFrom } from "../lib/redo"
import { findIn } from "../lib/find"
import { FindBar } from "../components/FindBar"
import { RecapCard } from "../components/RecapCard"
import { SideAnswerCard } from "../components/SideAnswer"
import { askSideQuestion } from "../lib/btw"
import { COMPOSE_EVENT, composeIn } from "../lib/compose"
import { chooseMention, mentionAt, writeRanges } from "../lib/mentions"
import {
  LOCAL_PAGE,
  OpenLocalPage,
  readViewerPrefs,
  useOpenWhatClaudeWrites,
} from "../lib/viewerPrefs"
import { useNow } from "../lib/useNow"
import { ApprovalCard } from "../components/ApprovalCard"
import { QuickDecision } from "../components/QuickDecision"
import { clock, longStamp, money, stamp } from "../lib/format"
import { MAIN_ACCOUNT, send, usePending, useSessionList, useStore } from "../store"
import { PlanMeter } from "../components/PlanMeter"
import { MODELS, StartProgress } from "./Sessions"
import { SessionCode } from "../components/SessionCode"
import { Menu, type MenuItem } from "../components/Menu"
import { MoreLines, shownLines } from "../components/MoreLines"
import { parseFindings, REVIEW_FENCE, ReviewCard, ReviewSession } from "../components/ReviewCard"
import { Walkthrough } from "../components/Walkthrough"
import { Timeline } from "../components/Timeline"
import { SearchPane } from "../components/SearchPane"
import { GitPane } from "../components/GitPane"
import { PictureViewer } from "../components/PictureViewer"
import { RenameDialog } from "../components/RenameDialog"
import { archiveSession, copyConversation, setSessionMeta, titleOf } from "../lib/sessionActions"
import { useShallow } from "zustand/react/shallow"
import { CopyButton } from "../components/CopyButton"
import { openExport } from "../components/ExportDialog"
import { SourcesPane } from "../components/SourcesPane"
import { sourcesOf } from "../lib/sources"
import { useDismiss } from "../lib/useDismiss"
import { ChangesPane } from "../components/ChangesPane"
import { TerminalPane } from "../components/TerminalPane"
import { FilesPanel, Viewer, type Opened } from "../components/FilesPanel"
import { PlusMenu } from "../components/PlusMenu"
import { VoiceButton } from "../components/VoiceButton"
import { ArtifactsPane } from "../components/ArtifactsPane"
import { api } from "../lib/api"
import { describeDecision, fromRecord } from "../lib/decision"
import { sessionCode } from "../lib/codes"
import {
  readPaneView,
  savePaneView,
  SIZES,
  stepSize,
  type Detail,
  type PaneView,
} from "../lib/paneView"
import { EFFORTS, MODE_OPTIONS, uiModeOf, wireOf, type EffortId, type UiMode } from "../lib/modes"
import { Icon, type IconName } from "../components/Icon"
import { EmptyState } from "../components/EmptyState"
import { loadBars } from "../lib/load"
import { useScreenReaderMode } from "../lib/screenReader"
import { inShell, tellShell } from "../lib/shell"

/** This page is a session's own window (B16): ?view=pane&session=<id>. */
const poppedOut = new URLSearchParams(location.search).get("view") === "pane"
import { attachedName, relInside, splitAttachments, type AttachedFile } from "../lib/attachments"
import { FileChip } from "../components/FileChip"
import { PastedCard } from "../components/PastedCard"
import { isLargePaste, textToBase64 } from "../lib/paste"
import { CompareBar } from "../components/CompareBar"
import { FallbackButton } from "../components/FallbackButton"
import { GoalDialog } from "../components/GoalDialog"
import { startReview } from "../lib/review"
import { runTestsUntilPass } from "../lib/testLoop"

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
  { cmd: "/btw", help: "Ask a side question about this session, without interrupting it" },
  {
    cmd: "/tell",
    help: "Send a message to another session by its code, e.g. /tell GT 407 run the tests",
  },
  { cmd: "/stop", help: "Stop the turn and anything in the background" },
  { cmd: "/close", help: "End this session" },
]

/** The workspace: one session, or up to four side by side (two by two when four), each with its own everything. */
export function Workspace() {
  const sessions = useStore((s) => s.sessions)
  const storePanes = useStore((s) => s.panes)
  const selected = useStore((s) => s.selectedSession)
  const selectSession = useStore((s) => s.selectSession)
  const setRoute = useStore((s) => s.setRoute)
  const setPane = useStore((s) => s.setPane)
  const focusPane = useStore((s) => s.focusPane)
  const setFocusPane = useStore((s) => s.setFocusPane)
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
            {list.length === 0 ? (
              <EmptyState picture="empty-sessions">
                <p className="m-0 mt-1 text-mut">
                  No sessions are running. Start one from the Sessions page.
                </p>
              </EmptyState>
            ) : (
              <p className="m-0 mt-1 text-mut">
                Choose a session to see its transcript and work with it.
              </p>
            )}
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
      className="panes grid min-h-0 flex-1"
      data-count={panes.length}
      style={
        panes.length === 4
          ? {
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gridTemplateRows: "repeat(2, minmax(0, 1fr))",
            }
          : {
              gridTemplateColumns: `repeat(${panes.length}, minmax(0, 1fr))`,
              gridTemplateRows: "minmax(0, 1fr)",
            }
      }
    >
      {panes.map((id, i) => (
        // The pane you click or type in has focus; with several on screen it is marked.
        <div
          key={`${i}:${id}`}
          className="pane-slot grid min-h-0 min-w-0"
          data-focus={
            panes.length > 1 && i === Math.min(focusPane, panes.length - 1) ? "" : undefined
          }
          onFocusCapture={() => setFocusPane(i)}
          onMouseDown={() => setFocusPane(i)}
        >
          <SessionPane
            sessionId={id}
            index={i}
            panes={panes}
            onChangeSession={(next) => setPane(i, next)}
          />
        </div>
      ))}
    </div>
  )
}

const DETAIL_LABEL: Record<Detail, string> = {
  summary: "Summary: what was said, and what needs you",
  normal: "Normal: each run of work on one line",
  verbose: "Verbose: every tool call and Claude's thinking, open",
}
/** The view the transcript is drawn in, for the parts that open by themselves in Verbose. */
const DetailView = createContext<Detail>("normal")

const STATE_WORDS: Record<SessionInfo["state"], string> = {
  starting: "Starting",
  idle: "Ready",
  running: "Working",
  waiting: "Needs you",
  error: "Stopped with an error",
  ended: "Ended",
}

type Side =
  | "plan"
  | "files"
  | "search"
  | "changes"
  | "git"
  | "terminal"
  | "artifacts"
  | "sources"
  | "memory"
  | "details"
/** Each side panel's icon from the Codehouse pack. */
const SIDE_ICON: Record<Side, IconName> = {
  plan: "plan",
  files: "files",
  search: "search",
  changes: "changes",
  git: "checkpoint",
  terminal: "terminal",
  artifacts: "artifacts",
  sources: "sources",
  memory: "memory",
  details: "usage",
}
const SIDE_LABEL: Record<Side, string> = {
  plan: "Plan",
  files: "Files",
  search: "Search",
  changes: "Changes",
  git: "Git",
  terminal: "Terminal",
  artifacts: "Artifacts",
  sources: "Sources",
  memory: "Memory",
  details: "Details",
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
  const barFolded = useStore((s) => s.barFolded)
  const setBarFolded = useStore((s) => s.setBarFolded)
  // Text size and spacing, kept for this session (owner, 31 Oct).
  const [view, setViewState] = useState<PaneView>(() => readPaneView(sessionId))
  useEffect(() => setViewState(readPaneView(sessionId)), [sessionId])
  const setView = (next: PaneView) => {
    setViewState(next)
    savePaneView(sessionId, next)
  }
  const [renaming, setRenaming] = useState(false)
  const [goalOpen, setGoalOpen] = useState(false)
  const [bypassOpen, setBypassOpen] = useState(false)
  // G31: the evidence for this session's work, above its transcript.
  const [walkthrough, setWalkthrough] = useState(false)
  // C-010: every call of the session from the audit log, in order.
  const [timeline, setTimeline] = useState(false)
  // D-003: the change's evidence pack.
  const [evidence, setEvidence] = useState(false)
  // D-033: the project's requirements and their trace matrix.
  const [requirements, setRequirements] = useState(false)
  // D-042, D-043: the project's architecture and its drift.
  const [architecture, setArchitecture] = useState(false)
  // D-038: the session's decisions as ADR drafts.
  const [decisions, setDecisions] = useState(false)
  // D-036: starting tests-first mode.
  const [testsFirst, setTestsFirst] = useState(false)
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
  // Settings, Viewer: a page or picture Claude writes opens in the viewer by itself, and a link to a page on this
  // computer opens there (kept in this window, read at each use).
  const cwd = session?.cwd
  const openWritten = useCallback(
    (file: string) => {
      if (cwd) setOpened({ kind: "file", rel: relInside(cwd, file) ?? file })
    },
    [cwd],
  )
  useOpenWhatClaudeWrites(
    selected,
    selected ? transcript.items : undefined,
    openWritten,
    readViewerPrefs().autoOpen,
  )
  const openLocalPage = useCallback((url: string) => setOpened({ kind: "browser", url }), [])

  // Runs of tool calls read as one line each, opened on demand.
  // Calls refused or waiting on you stay in Summary (W1-12).
  const keepIds = useStore(
    useShallow((st) => [
      ...Object.entries(st.decisions)
        .filter(([, d]) => d.outcome === "deny")
        .map(([id]) => id),
      ...Object.values(st.pending).map((p) => p.request.toolUseId),
    ]),
  )
  const shownItems = useMemo(
    () =>
      groupItems(
        view.detail === "summary"
          ? summaryItems(transcript.items, new Set(keepIds))
          : transcript.items,
      ),
    [transcript.items, view.detail, keepIds],
  )
  // CH-03: the versions of each of your messages in a chat, for the "2 of 3" arrows.
  const isChat = session?.kind === "chat"
  const branchSteps = useBranchSteps(
    session?.id ?? "",
    isChat,
    session?.state ?? "",
    isChat ? transcript.items.filter((i) => i.kind === "user" && !i.queued).map((i) => i.id) : [],
  )
  // Owner, 31 Oct: a quick way back to the latest, and a resumed or restarted session opens at its latest.
  const scroller = useRef<VirtuosoHandle>(null)
  const screenReader = useScreenReaderMode()
  const [atEnd, setAtEnd] = useState(true)
  // Read by the list's own callbacks, which keep the first render's values.
  const following = useRef(true)
  const toLatest = (smooth = false) =>
    scroller.current?.scrollToIndex({
      index: "LAST",
      align: "end",
      ...(smooth ? { behavior: "smooth" } : {}),
    })
  // Find in this conversation (Ctrl+F): which lines match, and which one is shown.
  const paneRef = useRef<HTMLDivElement>(null)
  const [finding, setFinding] = useState(false)
  const [findQuery, setFindQuery] = useState("")
  const [findAt, setFindAt] = useState(0)
  const hits = useMemo(
    () => (finding ? findIn(shownItems, findQuery) : []),
    [finding, shownItems, findQuery],
  )
  const hitSet = useMemo(() => new Set(hits), [hits])
  const current = hits.length ? hits[Math.min(findAt, hits.length - 1)] : undefined
  useEffect(() => {
    if (current === undefined) return
    following.current = false
    scroller.current?.scrollToIndex({ index: current, align: "center" })
  }, [current])
  const stepFind = (by: 1 | -1) =>
    setFindAt((a) =>
      hits.length ? (Math.min(a, hits.length - 1) + by + hits.length) % hits.length : 0,
    )
  const closeFind = () => {
    setFinding(false)
    setFindQuery("")
    paneRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus()
  }
  const historyShown = useRef(false)
  const hasHistory = shownItems.some((i) => i.id.startsWith("h") || i.id.startsWith("g-h"))
  useEffect(() => {
    if (!hasHistory || historyShown.current) return
    historyShown.current = true
    // The conversation read back arrives after the pane opened at the top: go to its end.
    requestAnimationFrame(() => toLatest())
  }, [hasHistory])
  const tools = useRef<Partial<Record<Side, HTMLButtonElement | null>>>({})
  const toggleSide = (t: Side) => setSide((s) => (s === t ? null : t))
  // An artifact's card in the transcript opens the Artifacts panel (Stitch, R8).
  const openArtifacts = useCallback(() => setSide("artifacts"), [])
  // CH-03: exactly what this chat was told it remembers, when its Memory panel is open.
  const memoryGiven = useMemoryGiven(sessionId, side === "memory")
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
  // Each artifact a chat saves shows in its panel at once.
  const artifactSaves = transcript.items.filter(
    (i) =>
      i.kind === "tool" && i.name === "mcp__companion__save_artifact" && i.result !== undefined,
  ).length
  // What the chat found on the web and read (W1-10), numbered as Claude is told to cite them.
  const sourceCount = chat ? sourcesOf(transcript.items).length : 0
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
    // B27, B28: a second session in Plan mode reviews this one's uncommitted changes, changing nothing.
    ...(chat || session.local
      ? []
      : [
          { kind: "separator" as const },
          // B29: the project's own test command as the goal, run and fixed until it passes.
          {
            label: "Run the tests until they pass",
            onSelect: () => void runTestsUntilPass(session),
          },
          { label: "Review the changes", onSelect: () => void startReview(session, "review") },
          {
            label: "Security review of the changes",
            onSelect: () => void startReview(session, "security"),
          },
        ]),
    { kind: "separator" },
    ...(panes.length > 1 ? [{ label: "Close this pane", onSelect: () => closePane(index) }] : []),
    // B16: a window of its own, in the Codehouse window only; closing that window brings it back here.
    ...(inShell() && !poppedOut
      ? [
          {
            label: "Pop out into its own window",
            onSelect: () => {
              tellShell(`popout:${session.id}`)
              if (panes.length > 1) closePane(index)
            },
          },
        ]
      : []),
    {
      label: "Stop",
      disabled: !busy,
      onSelect: () => void send({ type: "stop_session", sessionId: session.id }),
    },
    { label: "Rename...", onSelect: () => setRenaming(true) },
    // Owner, 9 Nov: past the limits in Settings only by a bypass for this session, with a time or a most it may spend.
    session.bypass
      ? { label: "End the limit bypass", onSelect: () => void setBypass(session.id, null) }
      : { label: "Bypass the limits...", onSelect: () => setBypassOpen(true) },
    // D-025: a dead-man timer for Extreme approval: it pauses if nothing is heard from you in time.
    ...(session.extreme
      ? session.deadman
        ? [{ label: `Dead-man timer off (now ${session.deadman.minutes} min)`, onSelect: () => void send({ type: "set_deadman", sessionId: session.id, minutes: null }) }]
        : [5, 15, 30, 60].map((m) => ({
            label: `Dead-man timer: ${m} minutes`,
            onSelect: () => void send({ type: "set_deadman", sessionId: session.id, minutes: m }),
          }))
      : []),
    // B25: carry on until a check passes, while Extreme approval carries on.
    ...(chat
      ? []
      : [
          {
            label: session.goal ? "Change the goal..." : "Set a goal...",
            onSelect: () => setGoalOpen(true),
          },
        ]),
    {
      label: session.pinned ? "Unpin" : "Pin to the top",
      onSelect: () =>
        void setSessionMeta(
          session,
          { pinned: !session.pinned },
          session.pinned ? `Unpinned ${titleOf(session)}.` : `Pinned ${titleOf(session)}.`,
        ),
    },
    { label: "Copy conversation", onSelect: () => void copyConversation(session) },
    {
      label: "Export...",
      onSelect: () =>
        openExport({
          title: titleOf(session),
          cwd: session.cwd,
          sessionId: session.id,
          ...(session.sdkSessionId ? { sdkSessionId: session.sdkSessionId } : {}),
        }),
    },
    ...(chat ? [] : [{ label: "Walkthrough...", onSelect: () => setWalkthrough(true) }]),
    ...(chat ? [] : [{ label: "Timeline...", onSelect: () => setTimeline(true) }]),
    ...(chat ? [] : [{ label: "Evidence...", onSelect: () => setEvidence(true) }]),
    ...(chat ? [] : [{ label: "Requirements...", onSelect: () => setRequirements(true) }]),
    ...(chat ? [] : [{ label: "Architecture...", onSelect: () => setArchitecture(true) }]),
    ...(chat ? [] : [{ label: "Decisions...", onSelect: () => setDecisions(true) }]),
    ...(chat || session.testsFirst ? [] : [{ label: "Tests first...", onSelect: () => setTestsFirst(true) }]),
    { kind: "separator" },
    {
      label: "Larger text",
      disabled: view.size >= SIZES[SIZES.length - 1]!,
      onSelect: () => setView({ ...view, size: stepSize(view.size, 1) }),
    },
    {
      label: "Smaller text",
      disabled: view.size <= SIZES[0]!,
      onSelect: () => setView({ ...view, size: stepSize(view.size, -1) }),
    },
    {
      label: view.density === "compact" ? "Comfortable spacing" : "Compact spacing",
      onSelect: () =>
        setView({ ...view, density: view.density === "compact" ? "comfortable" : "compact" }),
    },
    { kind: "separator" },
    ...(["summary", "normal", "verbose"] as const).map((d) => ({
      label: DETAIL_LABEL[d],
      checked: view.detail === d,
      onSelect: () => setView({ ...view, detail: d }),
    })),
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
      ref={paneRef}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
          e.preventDefault()
          setFinding(true)
        }
      }}
      className="pane relative grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto]"
      data-rail={side ? "open" : undefined}
      data-density={view.density}
      style={{ "--pane-scale": view.size / 100 } as React.CSSProperties}
      data-side={side ?? "none"}
      data-viewer={opened ? "" : undefined}
      aria-label={`Session ${session.project}`}
    >
      {/* O21: what this session runs on, its context, connectors, changes and background work. */}
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
                  {session.paused
                    ? "Paused"
                    : session.state === "idle" && background.length
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
          {chat && session.local ? (
            // A model on this computer, named as text: no vendor logo (ADR 0011).
            <span className="truncate text-xs text-mut">
              <span className="mr-1.5 rounded border border-line px-1.5 py-px font-medium text-tx">
                {session.localLabel ?? "On this computer"} · {session.model}
              </span>
              A chat in Plan mode: it reads files, and never changes them or searches the web
            </span>
          ) : chat && session.about ? (
            // Ask about code (owner, 6 Nov): which session it is about, and that it changes nothing.
            <span className="truncate text-xs text-mut">
              About the code session {session.about.title}: Claude reads its files and what was said
              in it, and never changes anything
            </span>
          ) : chat ? (
            <span className="truncate text-xs text-mut">
              {session.research ? "A research chat" : "A chat"}
              {session.chatProject ? ` in the project ${session.chatProject}` : ""}, in Plan mode:
              Claude reads and searches, and never changes files
            </span>
          ) : (
            <span className="mono truncate text-xs text-mut">{session.cwd}</span>
          )}
        </span>
        {/* A chat has no project, so none of the project panels; it has what it made to show you. */}
        {chat ? (
          <span role="group" aria-label="Side panels" className="flex items-center gap-1">
            <button
              ref={(el) => {
                tools.current.artifacts = el
              }}
              type="button"
              className="pane-tool"
              aria-pressed={side === "artifacts"}
              aria-controls={`rail-${session.id}`}
              onClick={() => toggleSide("artifacts")}
            >
              <Icon name="artifacts" size={14} />
              Artifacts
            </button>
            <button
              ref={(el) => {
                tools.current.sources = el
              }}
              type="button"
              className="pane-tool"
              aria-pressed={side === "sources"}
              aria-controls={`rail-${session.id}`}
              onClick={() => toggleSide("sources")}
            >
              <Icon name="sources" size={14} />
              Sources{sourceCount ? ` ${sourceCount}` : ""}
            </button>
            <button
              ref={(el) => {
                tools.current.memory = el
              }}
              type="button"
              className="pane-tool"
              aria-pressed={side === "memory"}
              aria-controls={`rail-${session.id}`}
              onClick={() => toggleSide("memory")}
            >
              <Icon name="memory" size={14} />
              Memory
            </button>
            <button
              ref={(el) => {
                tools.current.details = el
              }}
              type="button"
              className="pane-tool"
              aria-pressed={side === "details"}
              aria-controls={`rail-${session.id}`}
              onClick={() => toggleSide("details")}
            >
              <Icon name="usage" size={14} />
              Details
            </button>
          </span>
        ) : (
          <span role="group" aria-label="Side panels" className="flex items-center gap-1">
            {(["plan", "files", "search", "changes", "git", "terminal"] as const).map((t) => (
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
                <Icon name={SIDE_ICON[t]} size={14} />
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
            <button
              ref={(el) => {
                tools.current.details = el
              }}
              type="button"
              className="pane-tool"
              aria-pressed={side === "details"}
              aria-controls={`rail-${session.id}`}
              onClick={() => toggleSide("details")}
            >
              <Icon name="usage" size={14} />
              Details
            </button>
          </span>
        )}
      </header>
      {walkthrough ? (
        <div className="max-h-[60vh] overflow-auto px-3 pt-2">
          <Walkthrough sessionId={session.id} onClose={() => setWalkthrough(false)} />
        </div>
      ) : null}
      {timeline ? (
        <div className="max-h-[60vh] overflow-auto px-3 pt-2">
          <Timeline sessionId={session.id} onClose={() => setTimeline(false)} />
        </div>
      ) : null}
      {testsFirst ? (
        <div className="px-3 pt-2">
          <TestsFirstStart sessionId={session.id} {...(session.goal ? { goal: session.goal } : {})} onClose={() => setTestsFirst(false)} />
        </div>
      ) : null}
      {decisions ? (
        <div className="max-h-[60vh] overflow-auto px-3 pt-2">
          <Decisions sessionId={session.id} onClose={() => setDecisions(false)} />
        </div>
      ) : null}
      {architecture ? (
        <div className="max-h-[60vh] overflow-auto px-3 pt-2">
          <Architecture sessionId={session.id} onClose={() => setArchitecture(false)} />
        </div>
      ) : null}
      {requirements ? (
        <div className="max-h-[60vh] overflow-auto px-3 pt-2">
          <Requirements sessionId={session.id} onClose={() => setRequirements(false)} />
        </div>
      ) : null}
      {evidence ? (
        <div className="max-h-[60vh] overflow-auto px-3 pt-2">
          <Evidence sessionId={session.id} onClose={() => setEvidence(false)} />
        </div>
      ) : null}
      {goalOpen ? (
        <GoalDialog
          current={session.goal}
          extreme={session.extreme === true}
          onClose={() => setGoalOpen(false)}
          onSave={(check) =>
            void send({ type: "set_goal", sessionId: session.id, check }).then((r) =>
              r.ok
                ? toast(check ? `Goal set: carry on until ${check} passes.` : "Goal cleared.")
                : toast.error(r.error?.message ?? "The goal was not changed"),
            )
          }
        />
      ) : null}
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
        <DetailView.Provider value={view.detail}>
          <OpenLocalPage.Provider value={openLocalPage}>
            <section
              aria-label="Transcript"
              className="pane-transcript relative min-h-0"
              onKeyDown={(e) => {
                if (e.ctrlKey && e.shiftKey && e.key === "End") {
                  e.preventDefault()
                  toLatest()
                }
              }}
            >
              <RecapCard sessionId={session.id} />
              <SideAnswerCard sessionId={session.id} />
              {finding ? (
                <FindBar
                  query={findQuery}
                  count={hits.length}
                  at={Math.min(findAt, Math.max(0, hits.length - 1))}
                  onQuery={(q) => {
                    setFindQuery(q)
                    setFindAt(0)
                  }}
                  onStep={stepFind}
                  onClose={closeFind}
                />
              ) : null}
              <BranchSteps.Provider value={{ sessionId: session.id, steps: branchSteps }}>
                {(() => {
                  // One message as drawn in either list.
                  const itemAt = (index: number, it: (typeof shownItems)[number]) => (
                    <div
                      className={clsx(
                        "pane-item mx-auto max-w-[var(--transcript-width,860px)]",
                        hitSet.has(index) && "find-hit",
                        index === current && "find-current",
                      )}
                    >
                      {it.kind === "group" ? (
                        <ToolGroup
                          tools={it.tools}
                          onOpenArtifact={openArtifacts}
                          onOpenFile={(file) => {
                            // A file outside the folder opens by its full path; the Host lets the pane read it only if
                            // this session wrote or edited it (owner, 4 Nov).
                            setOpened({ kind: "file", rel: relInside(session.cwd, file) ?? file })
                          }}
                        />
                      ) : (
                        <ItemView item={it} sessionId={session.id} />
                      )}
                    </div>
                  )
                  return screenReader ? (
                    // Screen reader mode (B40): every message in order, in one plain list a screen reader can move through.
                    <ol
                      className="pane-linear m-0 h-full list-none overflow-y-auto p-0"
                      aria-label="Conversation"
                    >
                      {shownItems.length === 0 ? (
                        <li className="mx-auto max-w-[var(--transcript-width,860px)] p-6 text-mut">
                          Nothing yet. Write a prompt below to start the work.
                        </li>
                      ) : null}
                      {shownItems.map((it, index) => (
                        <li key={`${view.detail}:${it.id}`}>{itemAt(index, it)}</li>
                      ))}
                    </ol>
                  ) : (
                    <Virtuoso
                      ref={scroller}
                      style={{ height: "100%" }}
                      data={shownItems}
                      followOutput="smooth"
                      atBottomThreshold={80}
                      atBottomStateChange={(b) => {
                        following.current = b
                        setAtEnd(b)
                      }}
                      // A message that grows once shown (a picture loading, a tool line opened) keeps the end in view too,
                      // unless you have scrolled up to read.
                      totalListHeightChanged={() => {
                        if (following.current) toLatest()
                      }}
                      initialTopMostItemIndex={Math.max(0, shownItems.length - 1)}
                      computeItemKey={(_, it) => `${view.detail}:${it.id}`}
                      itemContent={itemAt}
                      components={{
                        EmptyPlaceholder: () => (
                          <p className="mx-auto max-w-[var(--transcript-width,860px)] p-6 text-mut">
                            Nothing yet. Write a prompt below to start the work.
                          </p>
                        ),
                      }}
                    />
                  )
                })()}
              </BranchSteps.Provider>
              {atEnd || shownItems.length === 0 ? null : (
                <button
                  type="button"
                  className="jump-latest"
                  aria-label="Jump to latest"
                  onClick={() => toLatest(true)}
                >
                  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                    <path
                      d="M8 2.5v10M3.5 8.5 8 13l4.5-4.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              )}
            </section>
          </OpenLocalPage.Provider>
        </DetailView.Provider>
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
            {side === "details" ? (
              <SessionDetails
                session={session}
                chat={chat}
                onOpenChanges={chat ? undefined : () => toggleSide("changes")}
              />
            ) : side === "artifacts" ? (
              <ArtifactsPane sessionId={session.id} refresh={artifactSaves} />
            ) : side === "sources" ? (
              <SourcesPane items={transcript.items} />
            ) : side === "memory" ? (
              <MemoryGiven entries={memoryGiven} />
            ) : side === "terminal" ? (
              <TerminalPane sessionId={session.id} cwd={session.cwd} />
            ) : side === "changes" ? (
              <ChangesPane sessionId={session.id} cwd={session.cwd} />
            ) : side === "search" ? (
              <SearchPane sessionId={session.id} onOpen={setOpened} />
            ) : side === "git" ? (
              <GitPane sessionId={session.id} onOpen={setOpened} />
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

      <CompareBar sessionId={session.id} />
      <footer className="bg-s1 px-3 pb-2 pt-1.5">
        {session.state === "error" ? <StoppedLine session={session} /> : null}
        {session.state === "starting" ? <ComingBack session={session} /> : null}
        {session.paused ? <PausedLine session={session} paused={session.paused} /> : null}
        {!session.paused && session.bypass ? <BypassLine session={session} /> : null}
        <CounterexampleCards session={session} />
        {session.kind === "chat" ? null : <InstructionsFor session={session} />}
        <InjectionFlags session={session} />
        {!session.paused && !session.bypass && bypassOpen ? (
          <div className="pane-stopped">
            <BypassForm session={session} onClose={() => setBypassOpen(false)} />
          </div>
        ) : null}
        {session.forkOf ? (
          // CH-07: carried on from an imported claude.ai chat, and not synced back.
          <p role="note" className="m-0 mb-1 text-[12.5px] text-mut">
            Continued in Codehouse. Not synced to claude.ai.
          </p>
        ) : null}
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
          <ActivityLine sessionId={session.id} cwd={session.cwd} compact={barFolded} />
        ) : background.length ? (
          <BackgroundLine tasks={background} />
        ) : null}
        {/* The plan while there is one to follow: steps done, in progress and not started (owner, 2 Nov). */}
        {session.testsFirst ? <TestsFirstBanner sessionId={session.id} /> : null}
        {(transcript.todos.length &&
          (session.state === "running" || transcript.todos.some((t) => t.status !== "completed"))) ||
        session.assumptions?.some((a) => !a.verified) ? (
          <ProgressCard todos={transcript.todos} sessionId={session.id} {...(session.assumptions ? { assumptions: session.assumptions } : {})} />
        ) : null}
        <Composer sessionId={session.id} disabled={ended} starting={session.state === "starting"} />
        {/* What the session runs on, under the prompt box where you look when you send. */}
        {barFolded ? (
          <div className="composer-bar" role="group" aria-label="Session bar, folded">
            {/* Folded, it still says what is set, in a line of small text, and keeps the plan ring (owner, 3 Nov). */}
            <span className="composer-summary">{settingsSummary(session, chat)}</span>
            <button type="button" className="composer-link" onClick={() => setBarFolded(false)}>
              Show model and settings
            </button>
            <span className="ml-auto flex items-center gap-2">
              <PlanMeter
                account={session.account ?? MAIN_ACCOUNT}
                idle={session.state === "idle"}
              />
              <StopButton sessionId={session.id} busy={busy} />
            </span>
          </div>
        ) : (
          <div className="composer-bar" role="group" aria-label="Model, effort and mode">
            <ContextMeter
              sessionId={session.id}
              state={session.state}
              pending={session.compactPending === true}
              chat={session.kind === "chat"}
            />
            <label className="composer-pick" title="Model">
              <span className="sr-only">Model</span>
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
            {/* A model on this computer has no effort to set (B18), so the picker is not offered for it. */}
            {session.local ? null : (
              <label className="composer-pick" title="Effort: how hard Claude thinks">
                <span className="sr-only">Effort</span>
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
                    <option
                      key={x.id}
                      value={x.id}
                      // Above the cap in Settings: shown, so you know it exists, but not chosen (B18).
                      disabled={
                        session.effortCap !== undefined && aboveCap(x.id, session.effortCap)
                      }
                    >
                      {x.label} effort
                      {session.effortCap !== undefined && aboveCap(x.id, session.effortCap)
                        ? " (above the limit in Settings)"
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {chat ? (
              <span className="composer-pick">Plan mode, always, in a chat</span>
            ) : (
              <label className="composer-pick" title="Mode: what Claude may do without asking you">
                <span className="sr-only">Mode</span>
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
              <label className="composer-pick" title={LEVEL_NOTES[session.resources as Level]}>
                <span className="sr-only">This PC’s processor and memory</span>
                <select
                  className="composer-select"
                  value={session.resources}
                  disabled={ended}
                  aria-describedby={`lvl-${session.id}`}
                  onChange={(e) => void changeResources(session.id, e.target.value as Level)}
                >
                  {LEVEL_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {session.resources ? (
              // What the level means, said where you choose it (owner, 1 Nov): in its tooltip and to a screen reader, so the
              // line stays short (owner, 3 Nov).
              <span id={`lvl-${session.id}`} className="sr-only">
                {LEVEL_NOTES[session.resources as Level]}
              </span>
            ) : null}
            {ended ? null : <LoadBars sessionId={session.id} />}
            <span className="ml-auto flex items-center gap-2">
              <PlanMeter
                account={session.account ?? MAIN_ACCOUNT}
                idle={session.state === "idle"}
              />
              <button
                type="button"
                className="btn composer-icon composer-icon-sm"
                aria-label="Hide settings"
                title="Hide settings"
                onClick={() => setBarFolded(true)}
              >
                <Icon name="close" size={12} />
              </button>
              <StopButton sessionId={session.id} busy={busy} />
            </span>
          </div>
        )}
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

type Level = ResourceLevel
/** Most first, as the picker lists them (owner: five levels). */
export const LEVEL_OPTIONS: Array<{ id: Level; label: string }> = [
  { id: "high", label: "High: no limits" },
  { id: "higher", label: "Higher: three quarters of the processor, 8 GB" },
  { id: "medium", label: "Medium: half the processor, 4 GB" },
  { id: "low", label: "Low: a fifth of the processor, 2 GB" },
  { id: "lowest", label: "Lowest: a tenth of the processor, 1 GB" },
]
/** What each level lets the session use, said when you choose it. */
export const LEVEL_WORDS: Record<Level, string> = {
  high: "High: no limits for this session.",
  higher:
    "Higher: this session and the commands it runs may use three quarters of the processor and 8 GB of memory. A command that needs more memory fails.",
  medium:
    "Medium: this session and the commands it runs may use half the processor and 4 GB of memory, and give way to what you are doing. A command that needs more memory fails.",
  low: "Low: this session and the commands it runs may use a fifth of the processor and 2 GB of memory, and give way to what you are doing. A command that needs more memory fails.",
  lowest:
    "Lowest: this session and the commands it runs may use a tenth of the processor and 1 GB of memory, and give way to what you are doing. A command that needs more memory fails.",
}

/**
 * The level in a few words beside its picker (owner, 1 Nov: "say what sort of limits it puts on hardware and concurrent
 * processes"). The values are the Host's LEVELS in apps/host/src/limits.ts. Every command the session runs shares the
 * one limit: however many run at once, together they get no more.
 */
export const LEVEL_NOTES: Record<Level, string> = {
  high: "No limits on processor or memory.",
  higher: "Three quarters of the processor and 8 GB, shared by everything it runs at once.",
  medium: "Half the processor and 4 GB, shared by everything it runs at once; gives way to you.",
  low: "A fifth of the processor and 2 GB, shared by everything it runs at once; gives way to you.",
  lowest:
    "A tenth of the processor and 1 GB, shared by everything it runs at once; gives way to you.",
}

/** What a session is set to, in a few words, for the folded line: "Opus 5.5, High effort, Auto, Medium". */
export function settingsSummary(s: SessionInfo, chat: boolean): string {
  const model = MODELS.find((m) => m.id === (s.model ?? ""))?.label ?? s.model ?? "Default model"
  const effort = EFFORTS.find((e) => e.id === s.effort)?.label
  const mode = chat ? "Plan mode" : MODE_OPTIONS.find((m) => m.id === uiModeOf(s))?.label
  const level = s.resources
    ? LEVEL_OPTIONS.find((o) => o.id === s.resources)?.label.split(":")[0]
    : undefined
  return [
    model,
    effort ? `${effort} effort` : undefined,
    mode,
    level,
    s.goal ? `goal: ${s.goal}` : undefined,
  ]
    .filter(Boolean)
    .join(", ")
}

/** A level for one session, applied at once to it and to everything it started (owner, 30 Oct). */
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
  chat = false,
}: {
  sessionId: string
  state: SessionInfo["state"]
  /** You asked to compact while a turn ran: it compacts when the turn ends. */
  pending: boolean
  /** A chat talks of Claude, not Claude Code. */
  chat?: boolean
}) {
  const claude = chat ? "Claude" : "Claude Code"
  const [u, setU] = useState<ContextUsage>()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  const closeBox = useCallback(() => setOpen(false), [])
  useDismiss(open, closeBox, box)
  const read = useRef(false)
  const known = u !== undefined
  const between = state === "idle"
  useEffect(() => {
    // Once when the pane opens, whatever the session is doing; then after every turn.
    if (read.current && state !== "idle") return
    read.current = true
    let gone = false
    let retry: ReturnType<typeof setTimeout> | undefined
    const ask = () =>
      void send({ type: "context_usage", sessionId }).then((r) => {
        if (gone) return
        if (r.ok && r.data) setU(r.data as ContextUsage)
        // A session still starting has nothing to say yet (owner, 1 Nov: an empty Context bar): ask again soon.
        else if (!known) retry = setTimeout(ask, 15_000)
      })
    ask()
    return () => {
      gone = true
      clearTimeout(retry)
    }
  }, [sessionId, state, known])
  const pct = u ? Math.max(0, Math.round(u.percentage)) : undefined
  const used = (u?.categories ?? [])
    .filter((c) => (c.kind ?? "used") === "used" && c.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 6)
  const worth = pct !== undefined && pct >= COMPACT_WORTH
  const advice =
    pct === undefined
      ? "Codehouse reads this after each turn."
      : pct >= COMPACT_SOON
        ? `Compact now: the conversation is nearly full, and ${claude} will soon summarise it by itself, at a moment it chooses.`
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
            ? `You asked ${claude} to compact the conversation.`
            : `You asked ${claude} to compact the conversation when this turn ends.`,
        ),
      },
    }))
    void send({ type: "compact", sessionId }).then((r) => {
      if (!r.ok) toast.error(r.error?.message ?? "Compacting did not start")
    })
  }
  return (
    <span className="relative" ref={box}>
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
        <span className="text-mut">Context</span> {pct !== undefined ? `${pct}%` : "–"}
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
              {pending
                ? "Compacts after this turn"
                : between
                  ? "Compact now"
                  : "Compact after this turn"}
            </button>
          </span>
          <p className="m-0 text-[12.5px] text-mut">
            How much of what Claude can hold in mind this conversation uses. When it is nearly full,
            {claude} summarises the older parts by itself and the conversation carries on.
          </p>
        </div>
      ) : null}
    </span>
  )
}

/**
 * Why a session stopped, in its own words, and a way to start it again on the same conversation (owner, 31 Oct:
 * "it is not clear why").
 */
/** D-059: a message refused because the project's instructions changed outside Codehouse. */
const INSTRUCTIONS_EVENT = "codehouse-instructions-changed"

/** D-059: the review of a change to what the project tells Claude, looked at again after each turn and refusal. */
function InstructionsFor({ session }: { session: SessionInfo }) {
  const [refused, setRefused] = useState(0)
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent<string>).detail === session.id) setRefused((n) => n + 1)
    }
    window.addEventListener(INSTRUCTIONS_EVENT, on)
    return () => window.removeEventListener(INSTRUCTIONS_EVENT, on)
  }, [session.id])
  // Only when the Host says the instructions changed, or a message was refused for it; looked at again each time.
  if (!session.instructionsChanged && !refused) return null
  return <InstructionsReview cwd={session.cwd} nonce={refused * 2 + (session.instructionsChanged ? 1 : 0)} />
}

function StoppedLine({ session }: { session: SessionInfo }) {
  const [busy, setBusy] = useState(false)
  return (
    <div role="alert" className="pane-stopped">
      <span>
        <strong>Stopped with an error:</strong>{" "}
        {session.error ??
          `${session.kind === "chat" ? "Claude" : "Claude Code"} did not say why. The Host's log (host.log) may say more.`}
      </span>
      {session.error ? <CopyButton text={session.error} what="the error" /> : null}
      {session.sdkSessionId ? (
        <button
          type="button"
          className="btn !min-h-7"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void send({ type: "force_stop", sessionId: session.id }, 120_000).then((r) => {
              setBusy(false)
              if (!r.ok) toast.error(r.error?.message ?? "It could not be started again")
            })
          }}
        >
          {busy ? "Starting again" : "Start again"}
        </button>
      ) : null}
      <FallbackButton session={session} />
    </div>
  )
}

/** Owner, 9 Nov: how long a bypass of the limits may last, in minutes, and how much it may spend, in dollars. */
export const BYPASS_MINUTES = [30, 60, 180, 480, 1440] as const
export const BYPASS_USD = [5, 10, 25, 50, 100] as const

const minutesLabel = (m: number) =>
  m < 60 ? `${m} minutes` : m === 60 ? "1 hour" : `${m / 60} hours`

function setBypass(
  sessionId: string,
  b: { minutes?: number; maxUsd?: number } | null,
): Promise<boolean> {
  return send(
    b === null
      ? { type: "set_limit_bypass", sessionId, end: true }
      : { type: "set_limit_bypass", sessionId, ...b },
  ).then((r) => {
    if (!r.ok) toast.error(r.error?.message ?? "The bypass could not be changed")
    else
      toast(b === null ? "The limits in Settings apply to this session again" : "Bypass set", {
        id: "bypass",
      })
    return r.ok
  })
}

/**
 * Owner, 9 Nov: going past the limits in Settings, for this session only, with a time, a most it may spend, or both.
 * Whichever runs out first ends it, and the session pauses again until you set another.
 */
function BypassForm({ session, onClose }: { session: SessionInfo; onClose?: () => void }) {
  const [minutes, setMinutes] = useState("")
  const [usd, setUsd] = useState("")
  const [busy, setBusy] = useState(false)
  const maxUsd = usd.trim() ? Number(usd) : undefined
  const usdBad = maxUsd !== undefined && !(Number.isFinite(maxUsd) && maxUsd > 0 && maxUsd <= 1000)
  const ready = (minutes !== "" || maxUsd !== undefined) && !usdBad
  return (
    <div className="grid gap-1.5" role="group" aria-label="Bypass the limits for this session">
      <span className="text-[13px]">
        Keep going past the limits in Settings, for this session only. Give it a time, a most it
        may spend, or both; when either runs out it pauses again.
      </span>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-0.5 text-[13px]">
          <span>For</span>
          <select
            className="field !min-h-7 !py-0"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          >
            <option value="">No time limit</option>
            {BYPASS_MINUTES.map((m) => (
              <option key={m} value={m}>
                {minutesLabel(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-0.5 text-[13px]">
          <span>Spending at most, in $</span>
          <input
            className="field !min-h-7 w-28 !py-0"
            inputMode="decimal"
            list={`bypass-usd-${session.id}`}
            placeholder="No limit"
            value={usd}
            aria-invalid={usdBad || undefined}
            onChange={(e) => setUsd(e.target.value)}
          />
          <datalist id={`bypass-usd-${session.id}`}>
            {BYPASS_USD.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </label>
        <button
          type="button"
          className="btn btn-primary !min-h-7"
          disabled={!ready || busy}
          onClick={() => {
            setBusy(true)
            void setBypass(session.id, {
              ...(minutes ? { minutes: Number(minutes) } : {}),
              ...(maxUsd !== undefined ? { maxUsd } : {}),
            }).then((ok) => {
              setBusy(false)
              if (ok) onClose?.()
            })
          }}
        >
          {busy ? "Setting" : "Keep going"}
        </button>
        {onClose ? (
          <button type="button" className="btn !min-h-7" onClick={onClose}>
            Cancel
          </button>
        ) : null}
      </div>
      {usdBad ? (
        <span className="text-[13px] text-sev">Give an amount above $0 and at most $1,000.</span>
      ) : !ready ? (
        <span className="text-[12.5px] text-mut">Choose a time, an amount, or both.</span>
      ) : null}
    </div>
  )
}

/** A bypass running: how long it has left and what it may still spend, and a way to end it now. */
function BypassLine({ session }: { session: SessionInfo }) {
  const b = session.bypass!
  const parts = [
    b.until ? `until ${clock(b.until) || "later today"}` : "",
    b.maxUsd !== undefined
      ? `up to $${b.maxUsd.toFixed(2)} of spending ($${b.spentUsd.toFixed(2)} so far)`
      : "",
  ].filter(Boolean)
  return (
    <div role="status" className="pane-stopped">
      <span>
        <strong>Limits bypassed</strong> for this session {parts.join(" or ")}, whichever comes
        first. Then the limits in Settings apply again and it pauses if they are still over.
      </span>
      <button type="button" className="btn !min-h-7" onClick={() => void setBypass(session.id, null)}>
        End the bypass
      </button>
    </div>
  )
}

/**
 * A session Codehouse paused at a limit in Settings (owner, 31 Oct; 9 Nov): why, when it starts again by itself, Start
 * now for once the limit is no longer over, and a bypass to keep going past it.
 */
function PausedLine({
  session,
  paused,
}: {
  session: SessionInfo
  paused: NonNullable<SessionInfo["paused"]>
}) {
  const [busy, setBusy] = useState(false)
  return (
    <div role="status" className="pane-stopped flex-wrap">
      {paused.reason === "heartbeat" ? (
        // D-025: nothing was heard from you in time.
        <span>
          <strong>Paused.</strong> Nothing was heard from you within this session's dead-man timer, so
          Extreme approval stopped it. Start it again when you are back.
        </span>
      ) : paused.reason === "risk" ? (
        // D-018: the session's risk budget is spent.
        <span>
          <strong>Paused.</strong> This session's risk budget is spent: Extreme approval approved as much
          as Settings allows without you. Start it again when you have looked; its budget is then full.
        </span>
      ) : paused.reason === "spend" ? (
        // B20: today's spending over every session reached the cap in Settings.
        <span>
          <strong>Paused.</strong> Today's extra spending beyond your plan reached the most Settings
          allows a day, so Codehouse stopped this session
          {paused.wasRunning ? " part way through a turn" : ""}. It starts again by itself tomorrow,
          or sooner if you raise the limit in Settings, Sessions.
        </span>
      ) : (
        <span>
          <strong>Paused.</strong> The plan's 5-hour limit reached {Math.round(paused.percent)}%, so
          Codehouse stopped this session{paused.wasRunning ? " part way through a turn" : ""}.{" "}
          {paused.until && clock(paused.until)
            ? `It starts again by itself when the limit resets at ${clock(paused.until)}.`
            : "It starts again by itself when the limit resets."}
        </span>
      )}
      <button
        type="button"
        className="btn !min-h-7"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          void send({ type: "resume_session", sessionId: session.id }).then((r) => {
            setBusy(false)
            if (!r.ok) toast.error(r.error?.message ?? "It could not be started")
          })
        }}
      >
        {busy ? "Starting" : "Start now"}
      </button>
      <BypassForm session={session} />
      {/* B21: or carry a chat on now with a model you allow, no looser with your words than Claude. */}
      <FallbackButton session={session} />
    </div>
  )
}

/**
 * A session still starting, usually one Codehouse is bringing back after a restart (owner, 31 Oct: one sat on Starting
 * with nothing to say how long, and End did nothing). It shows the seconds so far and lets you close it.
 */
function ComingBack({ session }: { session: SessionInfo }) {
  const since = useRef(Date.now()).current
  const [busy, setBusy] = useState(false)
  return (
    <div className="mb-2 grid gap-1.5">
      <StartProgress
        since={since}
        what={session.restarted ? "Bringing this session back" : "Starting this session"}
        note="A session with a long conversation takes a while to read back, and Codehouse brings two back at a time, so with several open this can take a few minutes. If it has not started after five minutes, Codehouse stops waiting and offers Start again."
      />
      <span>
        <button
          type="button"
          className="btn !min-h-7"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void send({ type: "close_session", sessionId: session.id }).then((r) => {
              setBusy(false)
              if (!r.ok) toast.error(r.error?.message ?? "It could not be closed")
            })
          }}
        >
          {busy ? "Closing" : "Close this session"}
        </button>
      </span>
    </div>
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
/**
 * Two small bars for what this session's processes use now (owner, 1 Nov): its share of the processor, and its memory
 * against its level's cap or this computer's. Nothing until the first reading, or where Codehouse cannot measure it.
 */
function LoadBars({ sessionId }: { sessionId: string }) {
  const load = useStore((s) => s.load[sessionId])
  if (!load) return null
  const b = loadBars(load)
  return (
    <span className="load-bars" role="img" aria-label={b.words} title={b.words}>
      <span className="load-bar" data-high={b.cpu >= 80 ? "" : undefined}>
        <span style={{ width: `${b.cpu}%` }} />
      </span>
      <span className="load-bar is-mem" data-high={b.memory >= 85 ? "" : undefined}>
        <span style={{ width: `${b.memory}%` }} />
      </span>
    </span>
  )
}

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

function ActivityLine({
  sessionId,
  cwd,
  compact = false,
}: {
  sessionId: string
  cwd: string
  /** Folded: the label alone, without the detail and counts. */
  compact?: boolean
}) {
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
      {detail && !compact ? <span className="text-mut tabular-nums">{detail}</span> : null}
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

function Composer({
  sessionId,
  disabled,
  starting = false,
}: {
  sessionId: string
  disabled: boolean
  /** Still coming back after a restart: you can write, and send once it has started. */
  starting?: boolean
}) {
  // One composer per pane in split view, so its id must be its own.
  const composerId = useId()
  // What you typed and had not sent comes back after Codehouse restarts.
  const draftKey = `gatehouse.draft.${sessionId}`
  const [text, setText] = useState(() => localStorage.getItem(draftKey) ?? "")
  useEffect(() => {
    if (text) localStorage.setItem(draftKey, text)
    else localStorage.removeItem(draftKey)
  }, [text, draftKey])
  const [active, setActive] = useState(0)
  // F15: the @ word at the cursor, and the session's files that match it.
  const [mention, setMention] = useState<{ start: number; query: string }>()
  const [found, setFound] = useState<string[]>([])
  const [foundAt, setFoundAt] = useState(0)
  useEffect(() => {
    if (!mention) {
      setFound([])
      return
    }
    let gone = false
    const t = setTimeout(() => {
      void api<{ files: string[] }>(
        "GET",
        `/api/files/find?session=${encodeURIComponent(sessionId)}&q=${encodeURIComponent(mention.query)}`,
      ).then((r) => {
        if (gone) return
        setFound(r.ok && r.data ? r.data.files : [])
        setFoundAt(0)
      })
    }, 120)
    return () => {
      gone = true
      clearTimeout(t)
    }
  }, [mention, sessionId])
  const pickMention = (rel: string) => {
    if (!mention) return
    const next = chooseMention(text, mention, rel)
    setText(next.text)
    setMention(undefined)
    requestAnimationFrame(() => {
      area.current?.focus()
      area.current?.setSelectionRange(next.caret, next.caret)
    })
  }
  const area = useRef<HTMLTextAreaElement>(null)
  const addUserText = useStore((s) => s.addUserText)
  const meta = useStore((s) => s.meta[sessionId])
  const insert = (more: string) => {
    setText((t) => (t && !/\s$/.test(t) ? t + " " : t) + more)
    area.current?.focus()
  }
  // Edit on a message you sent puts it here to change and send again; what you had typed is kept above it.
  useEffect(() => {
    const onCompose = (e: Event) => {
      const d = (e as CustomEvent<{ sessionId: string; text: string }>).detail
      if (d?.sessionId !== sessionId) return
      setText((t) => (t.trim() ? `${t}\n\n${d.text}` : d.text))
      requestAnimationFrame(() => {
        const a = area.current
        if (!a) return
        a.focus()
        a.setSelectionRange(a.value.length, a.value.length)
      })
    }
    window.addEventListener(COMPOSE_EVENT, onCompose)
    return () => window.removeEventListener(COMPOSE_EVENT, onCompose)
  }, [sessionId])
  // Pictures you paste, drop or add: shown as thumbnails, saved into the session's folder, and sent as references
  // with your message, so the prompt box keeps only what you typed (owner, 30 Oct).
  const [pictures, setPictures] = useState<Picture[]>([])
  // Other files you attached: an icon each, named to Claude with @ when you send (owner, 3 Nov).
  const [files, setFiles] = useState<AttachedFile[]>([])
  // A large paste: a card above the box, sent as a text file with the message (owner, 4 Nov).
  const [pasted, setPasted] = useState<Array<{ id: string; text: string }>>([])
  const addFiles = (rels: string[]) => {
    setFiles((f) => [
      ...f,
      ...rels
        .filter((rel) => !f.some((x) => x.rel === rel))
        .map((rel) => ({ rel, name: attachedName(rel) })),
    ])
    area.current?.focus()
  }
  const [viewing, setViewing] = useState<{ url: string; name: string }>()
  const [dropping, setDropping] = useState(false)
  /**
   * Files dropped on the prompt row: pictures as thumbnails, as when pasted; any other file is sent to the Host, which
   * checks its name against the policy and copies it into the session's attachments, and is mentioned in the prompt,
   * as Add files does.
   */
  async function attachDropped(files: File[]): Promise<void> {
    const picture = (f: File) => /^image\/(png|jpeg|gif|webp)$/.test(f.type)
    await attachPictures(files.filter(picture))
    const others = files.filter((f) => !picture(f)).slice(0, 20)
    const mentions: string[] = []
    for (const f of others) {
      if (f.size > 20 * 1024 * 1024) {
        toast.error(`${f.name}: over 20 MB, so it was not attached.`)
        continue
      }
      const data = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "")
        reader.readAsDataURL(f)
      })
      const r = await api<{ rel: string }>("POST", "/api/files/attach-data", {
        session: sessionId,
        kind: "file",
        name: f.name,
        type: f.type || "application/octet-stream",
        data,
      })
      if (r.ok && r.data) mentions.push(r.data.rel)
      else toast.error(`${f.name}: ${r.error ?? "it was not attached"}`)
    }
    if (mentions.length) addFiles(mentions)
  }
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
    if (!t && pictures.length === 0 && files.length === 0 && pasted.length === 0) return
    if (starting) {
      toast(
        "This session is still starting. What you wrote stays here: send it once it is ready.",
        { id: "starting" },
      )
      return
    }
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
        case "/btw": {
          // A side question, answered from what was said while the session carries on; never sent to it.
          if (!arg) {
            toast("Write your question after /btw, for example /btw how far has it got?", {
              id: "btw",
            })
            return
          }
          setText("")
          void askSideQuestion(
            sessionId,
            arg,
            useStore.getState().transcripts[sessionId]?.items ?? [],
          )
          return
        }
        case "/tell": {
          // G18: a message to another open session, by its code, without leaving this one.
          const m = /^\/tell\s+([A-Za-z]{2,3})\s*(\d{3})\s+([\s\S]+)$/i.exec(t)
          if (!m) {
            toast(
              "Write /tell, a session's code and your message, for example /tell GT 407 run the tests",
              {
                id: "tell",
              },
            )
            return
          }
          const code = `${m[1]!.toUpperCase()} ${m[2]}`
          const target = Object.values(useStore.getState().sessions).find(
            (s) => sessionCode(s) === code && s.state !== "ended" && s.state !== "error",
          )
          if (!target || target.id === sessionId) {
            toast.error(
              target ? "That is this session: just write here." : `No open session is ${code}.`,
            )
            return
          }
          r = await send({ type: "tell", from: sessionId, to: target.id, text: m[3]! })
          if (r.ok) {
            addUserText(
              target.id,
              m[3]!,
              undefined,
              target.state === "running" || target.state === "waiting",
            )
            toast(`Sent to ${code}`, { id: "tell" })
          }
          break
        }
        case "/stop":
          r = await send({ type: "stop_session", sessionId })
          break
        case "/close":
          r = await send({ type: "close_session", sessionId })
          break
        default: {
          // A Claude Code command or skill this session offers (the plus menu lists them) goes to Claude as typed.
          const own = useStore.getState().meta[sessionId]
          const name = (cmd ?? "").slice(1)
          if (own && (own.slashCommands.includes(name) || own.skills.includes(name))) {
            const st = useStore.getState().sessions[sessionId]?.state
            addUserText(sessionId, t, undefined, st === "running" || st === "waiting")
            setText("")
            r = await send({ type: "prompt", sessionId, text: t })
            if (!r.ok) toast.error(r.error?.message ?? "The prompt was not sent")
            return
          }
          toast.error(`Unknown command ${cmd}. Type / to see the list.`)
          return
        }
      }
      if (!r.ok) toast.error(r.error?.message ?? "That did not work")
      setText("")
      return
    }
    if (pictures.some((p) => !p.rel)) {
      toast("A picture is still being attached. Send again in a moment.")
      return
    }
    // Each large paste goes into the session's attachments as a text file, checked and recorded as a dropped file is.
    const pastedRels: string[] = []
    for (const [i, p] of pasted.entries()) {
      const r = await api<{ rel: string }>("POST", "/api/files/attach-data", {
        session: sessionId,
        kind: "file",
        name: pasted.length > 1 ? `pasted-text-${i + 1}.txt` : "pasted-text.txt",
        type: "text/plain",
        data: textToBase64(p.text),
      })
      if (!r.ok || !r.data) {
        toast.error(r.error ?? "The pasted text was not attached, so nothing was sent")
        return
      }
      pastedRels.push(r.data.rel)
    }
    // What Claude gets: your words, then a reference to each file and picture, which it opens.
    const named = [...files.map((f) => f.rel), ...pastedRels].map((rel) => `@${rel}`).join(" ")
    // F15: "@file:10-20" written out as "@file (lines 10 to 20)", so Claude reads those lines.
    const said = writeRanges(t)
    const full = [said, named, pictures.map((p) => `@${p.rel}`).join(" ")]
      .filter(Boolean)
      .join("\n\n")
    // While Claude works, the message waits for its next step (owner, 30 Oct), and says so until it is taken in.
    const st = useStore.getState().sessions[sessionId]?.state
    addUserText(
      sessionId,
      [said, named].filter(Boolean).join("\n\n"),
      pictures.map((p) => ({ url: p.url, name: p.name })),
      st === "running" || st === "waiting",
    )
    setText("")
    setPictures([])
    setFiles([])
    setPasted([])
    const r = await send({ type: "prompt", sessionId, text: full })
    if (!r.ok) {
      // D-059: the change to the project's instructions is shown above the prompt box for you to read.
      if (r.error?.code === "instructions-changed")
        window.dispatchEvent(new CustomEvent(INSTRUCTIONS_EVENT, { detail: sessionId }))
      toast.error(r.error?.message ?? "The prompt was not sent")
    }
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
      {mention && found.length > 0 && matches.length === 0 ? (
        <ul
          role="listbox"
          aria-label="Files"
          className="panel absolute bottom-full left-0 z-10 mb-1 m-0 w-[460px] max-w-full list-none p-1"
        >
          {found.map((rel, i) => (
            <li key={rel} role="option" aria-selected={i === foundAt}>
              <button
                className={clsx(
                  "mono w-full truncate rounded border-0 bg-transparent px-2 py-1 text-left text-[13px]",
                  i === foundAt && "bg-s2",
                )}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pickMention(rel)
                }}
              >
                {rel}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <label htmlFor={composerId} className="sr-only">
        Prompt
      </label>
      {pasted.length ? (
        <ul
          className="m-0 flex list-none flex-wrap gap-2 p-0 pl-12"
          aria-label="Pasted text to send"
        >
          {pasted.map((p) => (
            <li key={p.id}>
              <PastedCard
                text={p.text}
                onChange={(text) =>
                  setPasted((all) => all.map((x) => (x.id === p.id ? { ...x, text } : x)))
                }
                onRemove={() => {
                  setPasted((all) => all.filter((x) => x.id !== p.id))
                  area.current?.focus()
                }}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {files.length ? (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0 pl-12" aria-label="Files to send">
          {files.map((f) => (
            <li key={f.rel}>
              <FileChip
                name={f.name}
                onRemove={() => {
                  setFiles((all) => all.filter((x) => x.rel !== f.rel))
                  area.current?.focus()
                }}
              />
            </li>
          ))}
        </ul>
      ) : null}
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
                <Icon name="close" size={12} />
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
      {/*
        One box, as Claude Code's own (owner, 3 Nov): + at the left, send and the microphone at the right, and the text
        between, which grows with what you write up to a limit and then scrolls. Drop files anywhere on it (owner, 1
        Nov): pictures as thumbnails, other files mentioned.
      */}
      <div
        className="composer-row composer-box"
        data-drop={dropping ? "" : undefined}
        onDragOver={(e) => {
          if (disabled || !e.dataTransfer.types.includes("Files")) return
          e.preventDefault()
          setDropping(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false)
        }}
        onDrop={(e) => {
          setDropping(false)
          const files = [...e.dataTransfer.files]
          if (disabled || !files.length) return
          e.preventDefault()
          void attachDropped(files)
        }}
      >
        <PlusMenu
          sessionId={sessionId}
          meta={meta}
          onInsert={insert}
          onPictures={(rels) => void addSavedPictures(rels)}
          onFiles={addFiles}
          disabled={disabled}
        />
        <textarea
          id={composerId}
          ref={area}
          className="composer-input"
          onPaste={(e) => {
            const files = [...e.clipboardData.files]
            if (files.length) {
              e.preventDefault()
              void attachPictures(files)
              return
            }
            const pastedText = e.clipboardData.getData("text/plain")
            if (isLargePaste(pastedText)) {
              e.preventDefault()
              setPasted((p) => [...p, { id: `t${++pictureSeq}`, text: pastedText }])
            }
          }}
          rows={1}
          maxLength={100_000}
          disabled={disabled}
          title="Enter sends, Shift+Enter adds a line, / for commands, @ for files"
          placeholder={
            disabled ? "This session has ended" : "Write a prompt, / for commands, @ for files"
          }
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setActive(0)
            setMention(mentionAt(e.target.value, e.target.selectionStart ?? e.target.value.length))
          }}
          onKeyDown={(e) => {
            if (mention && found.length > 0) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault()
                setFoundAt(
                  (a) => (a + (e.key === "ArrowDown" ? 1 : -1) + found.length) % found.length,
                )
                return
              }
              if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
                e.preventDefault()
                pickMention(found[foundAt] ?? found[0]!)
                return
              }
            }
            if (mention && e.key === "Escape") {
              e.preventDefault()
              setMention(undefined)
              return
            }
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
        <span className="composer-tools">
          <VoiceButton target={area} disabled={disabled} />
          <button
            type="button"
            className="btn composer-icon composer-send"
            aria-label="Send"
            title="Send (Enter)"
            disabled={
              disabled ||
              (!text.trim() && pictures.length === 0 && files.length === 0 && pasted.length === 0)
            }
            onClick={() => void submit()}
          >
            <Icon name="send" />
          </button>
        </span>
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
        <StepList todos={todos} />
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
export const ToolGroup = memo(function ToolGroup({
  tools,
  onOpenArtifact,
  onOpenFile,
}: {
  tools: Array<Extract<Item, { kind: "tool" }>>
  onOpenArtifact?: () => void
  /** Opens a file Claude made beside the chat (owner, 3 Nov). */
  onOpenFile?: (file: string) => void
}) {
  // Files Claude made here, once each, with the newest version: a card to open each (owner, 3 Nov).
  const made = [
    ...new Set(
      tools
        .filter((t) => t.name === "Write" && t.result && !t.result.isError)
        .map((t) => t.input.file_path)
        .filter((p): p is string => typeof p === "string"),
    ),
  ]
  // What a chat saved to show you, as cards under the line (Stitch, R8), not folded away in it.
  const artifacts = tools.filter(
    (t) => t.name === "mcp__companion__save_artifact" && t.result && !t.result.isError,
  )
  const [open, setOpen] = useState(useContext(DetailView) === "verbose")
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
          onKeyDown={(e) => {
            // The tool rows as a tree (W1-12): Right opens, Left closes, Up and Down move between rows.
            if (e.key === "ArrowRight" && !open) setOpen(true)
            else if (e.key === "ArrowLeft" && open) setOpen(false)
            else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              const rows = [
                ...(e.currentTarget
                  .closest(".pane-transcript")
                  ?.querySelectorAll<HTMLElement>(".tool-group-line") ?? []),
              ]
              const at = rows.indexOf(e.currentTarget)
              rows[at + (e.key === "ArrowDown" ? 1 : -1)]?.focus()
            } else return
            e.preventDefault()
          }}
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
      {onOpenFile
        ? made.map((file) => {
            const name = file.split(/[\\/]/).at(-1) ?? file
            return (
              <div key={file} className="made-file">
                <FileChip name={name} />
                <span className="min-w-0 truncate">{name}</span>
                <button
                  type="button"
                  className="btn !min-h-7 !px-2 text-[13px]"
                  aria-label={`Open ${name}`}
                  onClick={() => onOpenFile(file)}
                >
                  Open
                </button>
              </div>
            )
          })
        : null}
      {artifacts.map((t) => (
        <ArtifactCard
          key={t.id}
          title={typeof t.input.title === "string" ? t.input.title : "Artifact"}
          kind={t.input.kind === "svg" ? "svg" : "html"}
          onOpen={onOpenArtifact}
        />
      ))}
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
      aria-label={longStamp(at)}
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
  point,
  itemId,
}: {
  text: string
  /** The item it is on screen, for its versions (CH-03). */
  itemId?: string
  images?: Shown[]
  sessionId?: string
  /** Where Retry and Edit carry on from. */
  point?: { before?: string; first?: boolean }
}) {
  const [viewing, setViewing] = useState<{ url: string; name: string }>()
  const [editing, setEditing] = useState<string>()
  const canFork = Boolean(sessionId && point && (point.before || point.first))
  const { shown, retry } = usePictures(sessionId, images)
  const { words, files } = splitAttachments(text)
  return (
    <div className="ml-auto grid max-w-[80%] justify-items-end gap-1.5">
      {files.length ? (
        <div
          className="flex flex-wrap justify-end gap-1.5"
          aria-label="Files you sent"
          role="group"
        >
          {files.map((f) => (
            <FileChip key={f.rel} name={f.name} />
          ))}
        </div>
      ) : null}
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
      {editing !== undefined && sessionId && point ? (
        <form
          className="grid w-full min-w-[min(520px,100%)] gap-1.5"
          aria-label="Edit your message"
          onSubmit={(e) => {
            e.preventDefault()
            const said = editing.trim()
            if (said)
              void carryOnFrom(sessionId, point, said).then((ok) => ok && setEditing(undefined))
          }}
        >
          <textarea
            className="field"
            rows={Math.min(10, Math.max(2, editing.split("\n").length))}
            autoFocus
            value={editing}
            onChange={(e) => setEditing(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(undefined)
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                e.currentTarget.form?.requestSubmit()
              }
            }}
          />
          <span className="flex justify-end gap-2">
            <button type="button" className="btn !min-h-7" onClick={() => setEditing(undefined)}>
              Cancel
            </button>
            <button className="btn btn-primary !min-h-7" disabled={!editing.trim()}>
              Send
            </button>
          </span>
        </form>
      ) : words ? (
        <div className="whitespace-pre-wrap rounded-md border border-line bg-s2 px-3 py-2 [overflow-wrap:anywhere]">
          <span className="sr-only">You: </span>
          {words}
        </div>
      ) : null}
      {text ? (
        <div className="msg-actions">
          {itemId ? <BranchNav itemId={itemId} /> : null}
          <CopyButton text={text} what="your message" />
          {sessionId && canFork && point ? (
            <button
              type="button"
              className="copy-btn"
              aria-label="Retry: carry on from just before this message, sending it again"
              onClick={() => void carryOnFrom(sessionId, point, text)}
            >
              <Icon name="auto" size={14} className="copy-icon" />
              Retry
            </button>
          ) : null}
          {sessionId ? (
            <button
              type="button"
              className="copy-btn"
              aria-label={
                canFork
                  ? "Edit your message and carry on from it"
                  : "Edit your message in the prompt box"
              }
              onClick={() => (canFork ? setEditing(text) : composeIn(sessionId, text))}
            >
              <Icon name="rename" size={14} className="copy-icon" />
              Edit
            </button>
          ) : null}
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

/**
 * A code block with its language and a Copy button, as in the ChatGPT and Claude apps (owner, 1 Nov). A review's
 * findings block (G16) shows as the review card instead, when it reads as findings.
 */
function CodeBlock({ children, ...rest }: ComponentProps<"pre">) {
  const pre = useRef<HTMLPreElement>(null)
  const code = isValidElement<{ className?: string; children?: unknown }>(children)
    ? children
    : undefined
  const language = /language-([\w+#.-]+)/.exec(code?.props.className ?? "")?.[1]
  const findings =
    language === REVIEW_FENCE && typeof code?.props.children === "string"
      ? parseFindings(code.props.children)
      : undefined
  if (findings) return <ReviewCard findings={findings} />
  return (
    <div className="code-block">
      <div className="code-head">
        <span className="mono text-xs text-mut">{language ?? "code"}</span>
        <CopyButton text={() => pre.current?.textContent ?? ""} what="the code" />
      </div>
      <pre ref={pre} {...rest}>
        {children}
      </pre>
    </div>
  )
}
/**
 * A link in Claude's words. One to a page on this computer opens in the pane's viewer when Settings, Viewer says so;
 * every other link goes where it always went (the window sends it to your browser).
 */
function TranscriptLink({ href, children, ...rest }: ComponentProps<"a">) {
  const openHere = useContext(OpenLocalPage)
  const local = typeof href === "string" && LOCAL_PAGE.test(href)
  return (
    <a
      {...rest}
      href={href}
      onClick={(e) => {
        if (!local || !openHere || !readViewerPrefs().localLinks) return
        e.preventDefault()
        openHere(href!)
      }}
    >
      {children}
    </a>
  )
}

const MARKDOWN_PARTS = { pre: CodeBlock, a: TranscriptLink }

/**
 * What Claude said. Copy gives the Markdown to a plain editor and the formatted text to Word or Outlook, as the
 * ChatGPT and Claude apps do.
 */
function ClaudeText({ text, at, subagent }: { text: string; at?: number; subagent?: string }) {
  const body = useRef<HTMLDivElement>(null)
  return (
    <div
      className={clsx(
        "[overflow-wrap:anywhere] [&_code]:font-[var(--font-code)] [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-s2 [&_pre]:p-3 [&_table]:border-collapse [&_td]:border [&_td]:border-line [&_td]:px-2 [&_th]:border [&_th]:border-line [&_th]:px-2",
        subagent && "ml-5 border-l-2 border-line pl-3",
      )}
    >
      <div ref={body}>
        <Markdown remarkPlugins={[remarkGfm]} components={MARKDOWN_PARTS}>
          {text}
        </Markdown>
      </div>
      <div className="msg-actions justify-start">
        <CopyButton
          text={text}
          html={() => plainHtml(body.current)}
          what={subagent ? "the subagent's reply" : "Claude's reply"}
        />
        <Stamp at={at} />
      </div>
    </div>
  )
}

/** The rendered reply as html for pasting, without the code blocks' own Copy bars. */
function plainHtml(el: HTMLElement | null): string | undefined {
  if (!el) return undefined
  const copy = el.cloneNode(true) as HTMLElement
  for (const bar of copy.querySelectorAll(".code-head")) bar.remove()
  return copy.innerHTML
}

export const ItemView = memo(function ItemView({
  item,
  sessionId,
}: {
  item: Item
  sessionId?: string
}) {
  const verbose = useContext(DetailView) === "verbose"
  switch (item.kind) {
    case "user":
      return (
        <>
          <UserMessage
            text={item.text}
            images={item.images}
            sessionId={sessionId}
            itemId={item.id}
            point={{
              ...(item.before ? { before: item.before } : {}),
              ...(item.first ? { first: true } : {}),
            }}
          />
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
        <ReviewSession.Provider value={sessionId}>
          <ClaudeText text={item.text} at={item.at} subagent={item.subagent} />
        </ReviewSession.Provider>
      )
    case "thinking":
      return (
        <details className="text-mut" open={verbose || undefined}>
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
          {item.isError && !item.stopped ? (
            <>
              {" "}
              <CopyButton text={item.text} what="the error" />
            </>
          ) : null}
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
  // A file from a chat project's knowledge, which the chat's own folder holds a copy of (W1-07).
  const knowledge =
    item.name === "Read" && path !== undefined && /[\\/]knowledge[\\/][^\\/]+$/.test(path)
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
    <details
      className={clsx("panel", item.subagent && "ml-5")}
      open={edit || useContext(DetailView) === "verbose" || undefined}
    >
      <summary className="flex cursor-pointer flex-wrap items-baseline gap-2 px-3 py-1.5">
        <strong>{item.name}</strong>
        {knowledge ? (
          <span className="text-xs font-semibold text-acc">Project knowledge</span>
        ) : null}
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
          <div className="copyable">
            <pre className="cmd">{s("command")}</pre>
            <CopyButton text={s("command") ?? ""} what="the command" />
          </div>
        ) : edit ? (
          <div className="copyable">
            <DiffView oldText={s("old_string") as string} newText={s("new_string") as string} />
            <CopyButton
              text={s("new_string") as string}
              what="the new text"
              label="Copy new text"
            />
          </div>
        ) : (
          <div className="copyable">
            <pre className="cmd">{JSON.stringify(input, null, 2)}</pre>
            <CopyButton text={JSON.stringify(input, null, 2)} what="the input" />
          </div>
        )}
        {path ? (
          <p className="m-0 flex flex-wrap items-center gap-2">
            <span className="mono text-xs text-mut [overflow-wrap:anywhere]">{path}</span>
            <CopyButton text={path} what="the path" label="Copy path" />
          </p>
        ) : null}
        {item.result && (item.result.text || !item.result.images?.length) ? (
          <div className="copyable">
            <pre className={clsx("cmd max-h-72 overflow-auto", item.result.isError && "text-sev")}>
              {item.result.text.length > 20_000
                ? item.result.text.slice(0, 20_000) +
                  `\n[${item.result.text.length - 20_000} more characters not shown]`
                : item.result.text || "(no output)"}
            </pre>
            {item.result.text ? (
              <CopyButton text={item.result.text} what="the output" label="Copy output" />
            ) : null}
          </div>
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
  const [all, setAll] = useState(false)
  const lines = useMemo(
    () =>
      diffLines(oldText, newText).flatMap((p, i) =>
        p.value
          .replace(/\n$/, "")
          .split("\n")
          .map((line, j) => ({ key: `${i}-${j}`, line, added: p.added, removed: p.removed })),
      ),
    [oldText, newText],
  )
  return (
    <pre className="cmd max-h-96 overflow-auto !p-0" aria-label="Changes">
      {shownLines(lines, all).map((l) => (
        <div
          key={l.key}
          className={clsx(
            "px-3",
            l.added && "bg-hi font-semibold",
            l.removed && "text-sev line-through decoration-1",
          )}
        >
          <span aria-hidden="true" className="mr-2 inline-block w-3 select-none">
            {l.added ? "+" : l.removed ? "-" : " "}
          </span>
          <span className="sr-only">
            {l.added ? "Added: " : l.removed ? "Removed: " : "Unchanged: "}
          </span>
          {l.line}
        </div>
      ))}
      <MoreLines total={lines.length} all={all} onShow={() => setAll(true)} />
    </pre>
  )
}

/** An artifact Claude saved, in the reply where it was made: its title and kind, and Open beside the chat. */
function ArtifactCard({
  title,
  kind,
  onOpen,
}: {
  title: string
  kind: "svg" | "html"
  onOpen?: () => void
}) {
  return (
    <div className="artifact-card" role="group" aria-label={`Artifact: ${title}`}>
      <span aria-hidden="true" className="artifact-icon">
        {kind === "svg" ? "◇" : "▤"}
      </span>
      <span className="grid min-w-0">
        <span className="truncate font-semibold">{title}</span>
        <span className="text-[12px] text-mut">
          {kind === "svg" ? "A picture (SVG)" : "A page (HTML)"}, shown in a sandbox
        </span>
      </span>
      {onOpen ? (
        <button type="button" className="btn ml-auto !min-h-7" onClick={onOpen}>
          Open
        </button>
      ) : null}
    </div>
  )
}
