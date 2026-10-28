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
import { addSystem, addUser, emptyTranscript, reduce, type Transcript } from "./lib/transcript"

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

export interface ResolvedView {
  id: string
  sessionId: string
  summary: string
  outcome: string
  at: string
  view?: PendingView
}

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
  usage?: Usage
  expectedOrg?: string
  transcripts: Record<string, Transcript>
  audit: unknown[]
  route: Route
  selectedSession?: string
  selectedRequest?: string
  theme: "light" | "dark"
  notify: boolean
  jcMode: boolean
  setupDone: boolean
  handleEvent: (e: ServerEvent) => void
  setRoute: (r: Route) => void
  selectSession: (id: string | undefined) => void
  selectRequest: (id: string | undefined) => void
  setTheme: (t: "light" | "dark") => void
  setNotify: (on: boolean) => void
  setJcMode: (on: boolean) => void
  setSetupDone: (done: boolean) => void
  addUserText: (sessionId: string, text: string) => void
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

const storedTheme = (): "light" | "dark" => {
  const s = localStorage.getItem("gatehouse.theme")
  if (s === "light" || s === "dark") return s
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}

export const useStore = create<State>((set, get) => ({
  conn: "connecting",
  attempt: 0,
  hasToken: false,
  sessions: {},
  pending: {},
  resolved: {},
  transcripts: {},
  audit: [],
  route: "approvals",
  theme: storedTheme(),
  notify: localStorage.getItem("gatehouse.notify") === "1",
  jcMode: localStorage.getItem("gatehouse.jcmode") === "1",
  setupDone: localStorage.getItem("gatehouse.setup") === "done",

  setRoute: (route) => set({ route }),
  selectSession: (selectedSession) => set({ selectedSession }),
  selectRequest: (selectedRequest) => set({ selectedRequest }),
  setTheme: (theme) => {
    localStorage.setItem("gatehouse.theme", theme)
    set({ theme })
  },
  setNotify: (notify) => {
    localStorage.setItem("gatehouse.notify", notify ? "1" : "0")
    set({ notify })
  },
  setSetupDone: (setupDone) => {
    localStorage.setItem("gatehouse.setup", setupDone ? "done" : "")
    set({ setupDone })
  },
  setJcMode: (jcMode) => {
    localStorage.setItem("gatehouse.jcmode", jcMode ? "1" : "0")
    set({ jcMode })
  },
  addUserText: (sessionId, text) =>
    set((s) => ({
      transcripts: {
        ...s.transcripts,
        [sessionId]: addUser(s.transcripts[sessionId] ?? emptyTranscript(), text),
      },
    })),

  handleEvent: (e) => {
    switch (e.type) {
      case "hello": {
        const pending: Record<string, PendingView> = {}
        for (const p of e.pending) pending[p.request.id] = p
        const sessions: Record<string, SessionInfo> = {}
        for (const i of e.sessions) sessions[i.id] = i
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
        set((s) => ({ sessions: { ...s.sessions, [e.info.id]: e.info } }))
        return
      case "sdk_message":
        set((s) => ({
          transcripts: {
            ...s.transcripts,
            [e.sessionId]: reduce(s.transcripts[e.sessionId] ?? emptyTranscript(), e.message),
          },
        }))
        return
      case "session_event": {
        if (e.event === "notify_user") {
          const text = typeof e.data.text === "string" ? e.data.text : ""
          const name = get().sessions[e.sessionId]?.project ?? "A session"
          toast(`${name}: ${text}`)
        }
        const line = describeEvent(e.event, e.data)
        if (!line) return
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
      case "audit":
        set((s) => ({ audit: [e.record, ...s.audit].slice(0, MAX_AUDIT) }))
        return
      case "usage":
        set({ usage: e.usage as Usage })
        return
      case "health":
        set({ health: e.health })
        return
      case "error":
        toast.error(e.message)
        return
      case "reply":
        return
    }
  },
}))

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
    default:
      return undefined
  }
}

function firstPending(p: Record<string, PendingView>): string | undefined {
  return Object.values(p).sort((a, b) => a.request.createdAt.localeCompare(b.request.createdAt))[0]
    ?.request.id
}

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
    new Notification("Jean-Claude Van Code", {
      body: `${what} needs your decision`,
      tag: v.request.id,
    })
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

export function useSessionList(): SessionInfo[] {
  const sessions = useStore((s) => s.sessions)
  return useMemo(() => Object.values(sessions), [sessions])
}

export function usePendingCount(): number {
  return useStore((s) => Object.keys(s.pending).length)
}
