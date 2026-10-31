import { readInit, type SessionMeta } from "./lib/sessionMeta"
import type { UpdateStatus } from "./lib/update"
import type {
  ClientCommand,
  Health,
  PendingView,
  ServerEvent,
  SessionInfo,
} from "@gatehouse/shared/ws-protocol"
import { toast } from "sonner"
import { useMemo } from "react"
import { create } from "zustand"
import { tellShell } from "./lib/shell"
import { Connection, type ConnState, type Reply, takeToken } from "./lib/connection"
import {
  addSystem,
  addUser,
  emptyTranscript,
  markStopping,
  reduce,
  reduceHistory,
  withHistory,
  type Transcript,
} from "./lib/transcript"
import { nextActivity, nextPulse, type Activity, type Pulse } from "./lib/activity"
import { fromRecord, laterDecision, type Decision } from "./lib/decision"

/** The main Claude account: Claude Code's usual sign-in on this computer. */
export const MAIN_ACCOUNT = "main"

export type Route =
  | "approvals"
  | "sessions"
  | "workspace"
  | "policy"
  | "audit"
  | "devices"
  | "settings"
  | "first-run"
  | "setup"
  | "guide"
  | "approver"
  | "usage"
  | "dashboard"
  | "chat"

export interface ResolvedView {
  id: string
  sessionId: string
  summary: string
  outcome: string
  at: string
  view?: PendingView
}

/** Something that happened in a session, for Lately on the Dashboard. Kept for this window only. */
export interface Notice {
  id: string
  at: number
  sessionId?: string
  text: string
}
const MAX_NOTICES = 30
let noticeSeq = 0

export interface UsageTotals {
  costUsd: number
  inputTokens: number
  outputTokens: number
  turns: number
}

export interface Usage {
  total?: UsageTotals
  bySession?: Record<string, UsageTotals>
  byProject?: Record<string, UsageTotals>
  byModel?: Record<string, UsageTotals>
  byDay?: Record<string, UsageTotals>
}

export interface State {
  conn: ConnState
  attempt: number
  hasToken: boolean
  sessions: Record<string, SessionInfo>
  pending: Record<string, PendingView>
  resolved: Record<string, ResolvedView>
  health?: Health
  /** Updates to JCVC itself, from the Host. */
  update?: UpdateStatus
  setUpdate: (u: UpdateStatus) => void
  usage?: Usage
  expectedOrg?: string
  transcripts: Record<string, Transcript>
  /** What each running session is doing now, for the line under its transcript. */
  activity: Record<string, Activity>
  /** When anything last arrived in each running turn, and its tokens. */
  pulse: Record<string, Pulse>
  /** Each session's terminal pane: what it printed, and whether a command is running. */
  term: Record<string, TermState>
  audit: unknown[]
  /** What happened lately, newest first: Claude told you, turns ended, Extreme runs ended. */
  notices: Notice[]
  /** The account whose sessions the window shows, and that new sessions start on. */
  activeAccount: string
  setActiveAccount: (id: string) => void
  /** How each tool call was decided, by its id (unique across sessions), for the line on its card. */
  decisions: Record<string, Decision>
  addDecisions: (items: Array<{ toolUseId: string; d: Decision }>) => void
  route: Route
  selectedSession?: string
  selectedRequest?: string
  theme: "light" | "dark"
  notify: boolean
  /** Requests you have looked at. A new one stays lit on the board until it is in here. */
  seen: Record<string, true>
  /** The help pane on the right. */
  helpOpen: boolean
  setHelpOpen: (open: boolean) => void
  markSeen: (id: string) => void
  /** "auto", a built-in picture id, or "user:<file name>". */
  jcPic: string
  setupDone: boolean
  handleEvent: (e: ServerEvent) => void
  setRoute: (r: Route) => void
  selectSession: (id: string | undefined) => void
  /** Sessions shown side by side in the workspace, left to right. At most three. */
  panes: string[]
  /** Slash commands, skills, connectors and plugins each session reported when it started. */
  meta: Record<string, SessionMeta>
  setPane: (index: number, id: string) => void
  openBeside: (id: string) => void
  closePane: (index: number) => void
  selectRequest: (id: string | undefined) => void
  setTheme: (t: "light" | "dark") => void
  setNotify: (on: boolean) => void
  setSetupDone: (done: boolean) => void
  setJcPic: (pic: string) => void
  addUserText: (
    sessionId: string,
    text: string,
    images?: Array<{ url: string; name: string }>,
    /** Sent while Claude works: Claude reads it at its next step. */
    queued?: boolean,
  ) => void
  termAppend: (sessionId: string, chunk: TermChunk) => void
  termStarted: (sessionId: string, runId: string) => void
  termClear: (sessionId: string) => void
}

let connection: Connection | undefined

export const send = (command: ClientCommand, timeoutMs?: number): Promise<Reply> =>
  connection
    ? connection.send(command, timeoutMs)
    : Promise.resolve({
        ok: false,
        error: { code: "disconnected", message: "Not connected to the Host" },
      })

const MAX_AUDIT = 500
const MAX_RESOLVED = 100

/**
 * The page and the panes on screen, kept so the window comes back the same after JCVC restarts or updates (owner,
 * 30 Oct: nothing lost). Session ids survive a restart, because the Host brings each session back under its own.
 */
const VIEW = "gatehouse.view"
const KEPT_ROUTES: Route[] = [
  "approvals",
  "sessions",
  "workspace",
  "policy",
  "audit",
  "devices",
  "settings",
  "guide",
  "approver",
  "usage",
  "dashboard",
]
function readView(): { route: Route; panes: string[]; selectedSession?: string } {
  try {
    if (localStorage.getItem("gatehouse.setup") === "done") {
      const v = JSON.parse(localStorage.getItem(VIEW) ?? "null") as Record<string, unknown> | null
      if (v && typeof v === "object") {
        const panes = Array.isArray(v.panes)
          ? v.panes.filter((p): p is string => typeof p === "string").slice(0, 3)
          : []
        return {
          route: KEPT_ROUTES.includes(v.route as Route) ? (v.route as Route) : "approvals",
          panes,
          ...(typeof v.selectedSession === "string" ? { selectedSession: v.selectedSession } : {}),
        }
      }
    }
  } catch {
    // a value from another version, or none
  }
  return { route: "approvals", panes: [] }
}
const startView = readView()
/** The page the window opened on: the first-run checks take over from it, as they did from Approvals. */
export const START_ROUTE: Route = startView.route

const storedTheme = (): "light" | "dark" => {
  const s = localStorage.getItem("gatehouse.theme")
  if (s === "light" || s === "dark") return s
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}

export interface TermChunk {
  stream: "cmd" | "out" | "err" | "note"
  text: string
}
export interface TermState {
  chunks: TermChunk[]
  runId?: string
}
/** The terminal keeps this much of what it printed, per session. */
export const TERM_KEEP = 400_000

function termAdd(t: TermState | undefined, chunk: TermChunk): TermState {
  const chunks = [...(t?.chunks ?? []), chunk]
  let size = chunks.reduce((n, c) => n + c.text.length, 0)
  while (size > TERM_KEEP && chunks.length > 1) size -= (chunks.shift() as TermChunk).text.length
  return { ...t, chunks }
}

export const useStore = create<State>((set, get) => ({
  conn: "connecting",
  attempt: 0,
  hasToken: false,
  sessions: {},
  pending: {},
  resolved: {},
  transcripts: {},
  activity: {},
  pulse: {},
  term: {},
  audit: [],
  notices: [],
  activeAccount: localStorage.getItem("gatehouse.account") || MAIN_ACCOUNT,
  // Switching shows another account's sessions; nothing on either stops (owner, 30 Oct).
  setActiveAccount: (id) =>
    set((s) => {
      localStorage.setItem("gatehouse.account", id)
      const mine = (sid: string) => (s.sessions[sid]?.account ?? MAIN_ACCOUNT) === id
      const panes = s.panes.filter(mine)
      return {
        activeAccount: id,
        panes,
        selectedSession:
          s.selectedSession && mine(s.selectedSession) ? s.selectedSession : panes[0],
      }
    }),
  decisions: {},
  addDecisions: (items) =>
    set((s) => {
      if (items.length === 0) return s
      const decisions = { ...s.decisions }
      for (const { toolUseId, d } of items)
        decisions[toolUseId] = laterDecision(decisions[toolUseId], d)
      return { decisions }
    }),
  route: startView.route,
  ...(startView.selectedSession ? { selectedSession: startView.selectedSession } : {}),
  theme: storedTheme(),
  notify: localStorage.getItem("gatehouse.notify") === "1",
  seen: {},
  helpOpen: false,
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  markSeen: (id) => set((s) => (s.seen[id] ? s : { seen: { ...s.seen, [id]: true } })),
  setupDone: localStorage.getItem("gatehouse.setup") === "done",
  jcPic: localStorage.getItem("gatehouse.jcpic") || "auto",

  setRoute: (route) => set({ route }),
  selectSession: (selectedSession) =>
    set((s) => ({
      selectedSession,
      // Opening a session shows it in the first pane, unless it is already on screen.
      panes:
        selectedSession === undefined || s.panes.includes(selectedSession)
          ? s.panes
          : [selectedSession, ...s.panes.slice(1)],
    })),
  panes: startView.panes,
  meta: {},
  setPane: (index, id) =>
    set((s) => {
      const panes = [...s.panes]
      const at = panes.indexOf(id)
      if (at >= 0 && at !== index) panes[at] = panes[index] ?? id
      panes[index] = id
      return { panes, selectedSession: index === 0 ? id : s.selectedSession }
    }),
  openBeside: (id) =>
    set((s) => {
      // With nothing split yet, the session on screen is the first pane.
      const base = s.panes.length ? s.panes : s.selectedSession ? [s.selectedSession] : []
      return base.includes(id) || base.length >= 3 ? { panes: base } : { panes: [...base, id] }
    }),
  closePane: (index) =>
    set((s) => {
      const panes = s.panes.filter((_, i) => i !== index)
      return { panes, selectedSession: panes[0] }
    }),
  selectRequest: (selectedRequest) => set({ selectedRequest }),
  setTheme: (theme) => {
    localStorage.setItem("gatehouse.theme", theme)
    set({ theme })
  },
  setNotify: (notify) => {
    localStorage.setItem("gatehouse.notify", notify ? "1" : "0")
    set({ notify })
  },
  setUpdate: (update) => set({ update }),
  setJcPic: (jcPic) => {
    localStorage.setItem("gatehouse.jcpic", jcPic)
    set({ jcPic })
  },
  setSetupDone: (setupDone) => {
    localStorage.setItem("gatehouse.setup", setupDone ? "done" : "")
    set({ setupDone })
  },
  termAppend: (sessionId, chunk) =>
    set((s) => ({ term: { ...s.term, [sessionId]: termAdd(s.term[sessionId], chunk) } })),
  termStarted: (sessionId, runId) =>
    set((s) => ({
      term: { ...s.term, [sessionId]: { chunks: s.term[sessionId]?.chunks ?? [], runId } },
    })),
  termClear: (sessionId) =>
    set((s) => ({
      term: { ...s.term, [sessionId]: { ...s.term[sessionId], chunks: [] } },
    })),
  addUserText: (sessionId, text, images, queued = false) =>
    set((s) => ({
      transcripts: {
        ...s.transcripts,
        [sessionId]: addUser(s.transcripts[sessionId] ?? emptyTranscript(), text, images, queued),
      },
      // A queued message joins the turn that is running, so what Claude is doing stays on the line.
      ...(queued
        ? {}
        : {
            activity: { ...s.activity, [sessionId]: { phase: "sent" as const, since: Date.now() } },
            pulse: { ...s.pulse, [sessionId]: { last: Date.now(), done: 0, now: 0 } },
          }),
    })),

  handleEvent: (e) => {
    switch (e.type) {
      case "hello": {
        const pending: Record<string, PendingView> = {}
        for (const p of e.pending) pending[p.request.id] = p
        const sessions: Record<string, SessionInfo> = {}
        for (const i of e.sessions) sessions[i.id] = i
        for (const i of e.sessions) loadHistory(i)
        set((s) => ({
          sessions,
          pending,
          health: e.health,
          usage: e.usage as Usage,
          ...(e.expectedOrg !== undefined ? { expectedOrg: e.expectedOrg } : {}),
          selectedRequest:
            s.selectedRequest && pending[s.selectedRequest]
              ? s.selectedRequest
              : firstPending(pending),
        }))
        return
      }
      case "session":
        loadHistory(e.info)
        set((s) => {
          const sessions = { ...s.sessions, [e.info.id]: e.info }
          // A turn that ended, by finishing, an interrupt or an error, is doing nothing any more.
          if (e.info.state === "running" || e.info.state === "waiting" || !s.activity[e.info.id])
            return { sessions }
          const activity = { ...s.activity }
          delete activity[e.info.id]
          const pulse = { ...s.pulse }
          delete pulse[e.info.id]
          return { sessions, activity, pulse }
        })
        return
      case "sdk_message": {
        const meta = readInit(e.message)
        if (meta) set((s) => ({ meta: { ...s.meta, [e.sessionId]: meta } }))
        const was = get().activity[e.sessionId]
        const next = nextActivity(was, e.message, Date.now())
        if (next !== was)
          set((s) => {
            const activity = { ...s.activity }
            if (next) activity[e.sessionId] = next
            else delete activity[e.sessionId]
            return { activity }
          })
        const beat = get().pulse[e.sessionId]
        const nextBeat = nextPulse(beat, e.message, Date.now())
        set((s) => {
          const pulse = { ...s.pulse }
          if (nextBeat) pulse[e.sessionId] = nextBeat
          else delete pulse[e.sessionId]
          return { pulse }
        })
        // A partial message changes nothing in the transcript itself.
        if ((e.message as { type?: unknown } | null)?.type === "stream_event") return
        const done = e.message as { type?: unknown; is_error?: unknown; subtype?: unknown } | null
        if (done?.type === "result")
          notice(
            e.sessionId,
            done.is_error === true || String(done.subtype ?? "").startsWith("error")
              ? "A turn ended with an error."
              : "A turn finished.",
          )
        set((s) => ({
          transcripts: {
            ...s.transcripts,
            [e.sessionId]: reduce(s.transcripts[e.sessionId] ?? emptyTranscript(), e.message),
          },
        }))
        return
      }
      case "session_event": {
        if (e.event === "decision") {
          const d = decisionOf(e.data)
          if (d) get().addDecisions([d])
          return
        }
        if (e.event === "interrupted") {
          const by = e.data.by === "kill-switch" ? "kill-switch" : "you"
          set((s) => ({
            transcripts: {
              ...s.transcripts,
              [e.sessionId]: markStopping(s.transcripts[e.sessionId] ?? emptyTranscript(), by),
            },
          }))
          return
        }
        if (e.event === "notify_user") {
          const text = typeof e.data.text === "string" ? e.data.text : ""
          const name = get().sessions[e.sessionId]?.project ?? "A session"
          toast(`${name}: ${text}`)
        }
        const line = describeEvent(e.event, e.data)
        if (!line) return
        if (e.event === "notify_user" || e.event === "carry_on_end") notice(e.sessionId, line)
        set((s) => ({
          transcripts: {
            ...s.transcripts,
            [e.sessionId]: addSystem(s.transcripts[e.sessionId] ?? emptyTranscript(), line),
          },
        }))
        return
      }
      case "approval_request": {
        const v = e.view
        set((s) => ({
          pending: { ...s.pending, [v.request.id]: v },
          selectedRequest: s.selectedRequest ?? v.request.id,
        }))
        announce(v, get())
        return
      }
      case "approval_resolved":
        // Answered here, on the phone or timed out: its notification has nothing left to ask.
        shown.get(e.id)?.close()
        shown.delete(e.id)
        set((s) => {
          const view = s.pending[e.id]
          const { [e.id]: _gone, ...rest } = s.pending
          const resolved = {
            ...s.resolved,
            [e.id]: {
              id: e.id,
              sessionId: e.sessionId,
              summary: e.resolution.summary,
              outcome: e.resolution.outcome,
              at: e.resolution.at,
              ...(view ? { view } : {}),
            },
          }
          const keys = Object.keys(resolved)
          if (keys.length > MAX_RESOLVED) delete resolved[keys[0] as string]
          return {
            pending: rest,
            resolved,
            selectedRequest:
              s.selectedRequest === e.id ? (firstPending(rest) ?? e.id) : s.selectedRequest,
          }
        })
        return
      case "phone_status":
        set((s) => {
          const p = s.pending[e.id]
          return p ? { pending: { ...s.pending, [e.id]: { ...p, phone: e.status } } } : s
        })
        return
      case "term_output":
        set((s) => ({
          term: {
            ...s.term,
            [e.sessionId]: termAdd(s.term[e.sessionId], { stream: e.stream, text: e.text }),
          },
        }))
        return
      case "term_exit":
        set((s) => {
          const t = s.term[e.sessionId]
          // An exit that belongs to an older command changes nothing.
          if (t?.runId && t.runId !== e.runId) return {}
          const said =
            e.code === 0
              ? undefined
              : {
                  stream: "note" as const,
                  text: e.code === null ? "Stopped.\n" : `Exit code ${e.code}.\n`,
                }
          const next = said ? termAdd(t, said) : { chunks: t?.chunks ?? [] }
          return { term: { ...s.term, [e.sessionId]: { chunks: next.chunks } } }
        })
        return
      case "audit": {
        set((s) => ({ audit: [e.record, ...s.audit].slice(0, MAX_AUDIT) }))
        const d = fromRecord(e.record)
        if (d) get().addDecisions([d])
        return
      }
      case "usage":
        set({ usage: e.usage as Usage })
        return
      case "health":
        set({ health: e.health })
        return
      case "update":
        set({ update: e.update as UpdateStatus })
        return
      case "error":
        toast.error(e.message)
        return
      case "reply":
        return
    }
  },
}))

useStore.subscribe((s, prev) => {
  if (
    s.route === prev.route &&
    s.panes === prev.panes &&
    s.selectedSession === prev.selectedSession
  )
    return
  try {
    localStorage.setItem(
      VIEW,
      JSON.stringify({
        route: s.route,
        panes: s.panes,
        ...(s.selectedSession ? { selectedSession: s.selectedSession } : {}),
      }),
    )
  } catch {
    // storage full or blocked: the view is only a convenience
  }
})

const historyAsked = new Set<string>()
/**
 * A session that carries on an earlier conversation (Resume, Fork, or after a restart) shows what was said there,
 * read once through the Host, with a line when a restart cut a turn off.
 */
function loadHistory(info: SessionInfo): void {
  if (!info.historyFrom || historyAsked.has(info.id)) return
  historyAsked.add(info.id)
  // Started again under the same id while this window was open (Force stop): what was said is on screen already.
  const shown = useStore.getState().transcripts[info.id]
  if (shown?.items.length) {
    if (info.restarted)
      useStore.setState((s) => ({
        transcripts: { ...s.transcripts, [info.id]: addSystem(shown, restartLine(info)) },
      }))
    return
  }
  void send(
    { type: "history_messages", sdkSessionId: info.historyFrom, cwd: info.cwd },
    60_000,
  ).then((r) => {
    if (!r.ok || !Array.isArray(r.data)) return
    let past = emptyTranscript()
    for (const m of r.data as unknown[]) past = reduceHistory(past, m)
    if (info.restarted) past = addSystem(past, restartLine(info))
    useStore.setState((s) => ({
      transcripts: { ...s.transcripts, [info.id]: withHistory(s.transcripts[info.id], past) },
    }))
  })
}

/** Adds to Lately, newest first, naming the session. */
function notice(sessionId: string, text: string): void {
  const s = useStore.getState().sessions[sessionId]
  const name = s ? (s.title ?? s.project) : "A session"
  useStore.setState((st) => ({
    notices: [
      { id: `n${++noticeSeq}`, at: Date.now(), sessionId, text: `${name}: ${text}` },
      ...st.notices,
    ].slice(0, MAX_NOTICES),
  }))
}

/** Why a session started again under its own id, for the line in its transcript. */
function restartLine(info: SessionInfo): string {
  if (info.restarted?.forced)
    return "You force-stopped this session. It started again on the same conversation: send a message to carry on."
  return info.restarted?.wasRunning
    ? "JCVC restarted while Claude was working, so that turn stopped. Send a message to carry on."
    : "JCVC restarted. This session carries on from here."
}

/** A decision event from the Host: the verdict, never the input. */
function decisionOf(data: Record<string, unknown>): { toolUseId: string; d: Decision } | undefined {
  if (typeof data.toolUseId !== "string" || typeof data.outcome !== "string") return undefined
  return {
    toolUseId: data.toolUseId,
    d: {
      outcome: data.outcome as Decision["outcome"],
      decidedBy: (typeof data.decidedBy === "string"
        ? data.decidedBy
        : "rules") as Decision["decidedBy"],
      ruleId: typeof data.ruleId === "string" ? data.ruleId : "",
      reason: typeof data.reason === "string" ? data.reason : "",
      risk: typeof data.risk === "number" ? data.risk : 0,
      at: Date.now(),
    },
  }
}

/** A plain line for the transcript, or nothing for events that are only noise. */
export function describeEvent(event: string, data: Record<string, unknown>): string | undefined {
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined)
  switch (event) {
    case "notification":
      return str(data.message) ?? str(data.title)
    case "notify_user":
      return `Claude told you: ${str(data.text) ?? ""}`
    case "subagent_start":
      return `Subagent started${str(data.agent_type) ? `: ${str(data.agent_type)}` : ""}`
    case "subagent_stop":
      return "Subagent finished"
    case "carry_on":
      return data.restart === true
        ? "JCVC restarted while this session was working, so it carries on where it was."
        : `Extreme approval: carrying on by itself, turn ${String(data.turn)}${typeof data.of === "number" ? ` of ${data.of}` : ""}.`
    case "carry_on_end": {
      const why: Record<string, string> = {
        done: "the build queue is empty",
        turns: `it took ${String(data.turns)} turns by itself, the most allowed after one message`,
        spend: `it spent $${Number(data.spentUsd ?? 0).toFixed(2)} since your last message, the most allowed`,
        stopped: "you stopped it",
        error: "a turn ended with an error",
        stalled: "its last two turns did no work, so nothing seems left to do",
      }
      const limit = data.why === "turns" || data.why === "spend"
      return `Stopped carrying on: ${why[String(data.why)] ?? "it was told to"}.${limit ? " Send a message to carry on, or raise the limit in Settings, Extreme approval." : ""}`
    }
    default:
      return undefined
  }
}

function firstPending(p: Record<string, PendingView>): string | undefined {
  return Object.values(p).sort((a, b) => a.request.createdAt.localeCompare(b.request.createdAt))[0]
    ?.request.id
}

/** The notifications on screen, by request, so each goes when its request is decided. */
const shown = new Map<string, Notification>()

/** Tells the user without moving focus: a toast always, a browser notification only if they turned it on. */
function announce(v: PendingView, s: State): void {
  tellShell("attention")
  const project = v.request.project
  const what =
    v.request.kind === "question"
      ? "A question"
      : v.request.kind === "plan"
        ? "A plan"
        : "An action"
  toast(`${what} in ${project} needs you`, {
    action: { label: "Open", onClick: () => useStore.getState().selectRequest(v.request.id) },
  })
  if (s.notify && typeof Notification !== "undefined" && Notification.permission === "granted") {
    // Detail stays out of the notification: it can show on a locked screen or be mirrored.
    const n = new Notification("Jean-Claude Van Code", {
      body: `${what} needs your decision`,
      tag: v.request.id,
    })
    shown.set(v.request.id, n)
    n.onclick = () => {
      window.focus()
      const st = useStore.getState()
      st.selectRequest(v.request.id)
      st.setRoute("approvals")
      if (!st.pending[v.request.id]) toast("That request was already decided.", { id: "stale" })
      n.close()
    }
  }
}

export function startConnection(): boolean {
  const token = takeToken()
  if (!token) return false
  useStore.setState({ hasToken: true })
  connection = new Connection(
    token,
    (e) => useStore.getState().handleEvent(e),
    (conn, attempt) => useStore.setState({ conn, attempt }),
  )
  connection.start()
  return true
}

export const pendingList = (s: Pick<State, "pending">): PendingView[] =>
  Object.values(s.pending).sort((a, b) => a.request.createdAt.localeCompare(b.request.createdAt))

/** Selectors that build a new array each call must not go straight into useStore (zustand 5 would re-render for ever). */
export function usePending(): PendingView[] {
  const pending = useStore((s) => s.pending)
  return useMemo(() => pendingList({ pending }), [pending])
}

/** The sessions of the account the window shows. Approvals from every account stay on Approvals. */
export function useSessionList(): SessionInfo[] {
  const sessions = useStore((s) => s.sessions)
  const account = useStore((s) => s.activeAccount)
  return useMemo(
    () => Object.values(sessions).filter((x) => (x.account ?? MAIN_ACCOUNT) === account),
    [sessions, account],
  )
}

/** The account new sessions start on, as the Host wants it: nothing for the main one. */
export function accountForNew(): { account?: string } {
  const a = useStore.getState().activeAccount
  return a && a !== MAIN_ACCOUNT ? { account: a } : {}
}

export function usePendingCount(): number {
  return useStore((s) => Object.keys(s.pending).length)
}
