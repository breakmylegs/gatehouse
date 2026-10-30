import { z } from "zod"
import { EscalationRequest } from "./contracts.js"

/**
 * The WebSocket API between the Host and the desktop UI. Commands are what the UI may ask for, events are
 * what the Host tells the UI. Every command is validated here at the edge: a mode other than default or plan
 * cannot even be expressed (invariant 3), and the phone's limited powers are enforced in the broker.
 */

const Id = z.string().min(1).max(200)
const Mode = z.enum(["default", "acceptEdits", "plan", "auto"])
export const Effort = z.enum(["low", "medium", "high", "xhigh", "max"])
export type Effort = z.infer<typeof Effort>
const Message = z.string().max(500)

export const ClientCommand = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_session"),
    cwd: z.string().min(1).max(4096),
    model: z.string().min(1).max(200).optional(),
    mode: Mode.optional(),
    effort: Effort.optional(),
    /** Extreme approval for this session: what would ask you is approved, audited and told to the phone. */
    extreme: z.boolean().optional(),
    resume: Id.optional(),
    fork: z.boolean().optional(),
    /** A new project: cwd is a folder in the projects folder that must be new, so a number is added if it is taken. */
    freshFolder: z.boolean().optional(),
    /** A chat rather than a coding session: the Host gives it a folder of its own and ignores cwd. */
    kind: z.enum(["code", "chat"]).optional(),
    /** The first thing said in a chat, which names its folder. */
    title: z.string().max(2000).optional(),
  }),
  z.object({ type: z.literal("close_session"), sessionId: Id }),
  z.object({ type: z.literal("prompt"), sessionId: Id, text: z.string().min(1).max(100_000) }),
  z.object({ type: z.literal("interrupt"), sessionId: Id }),
  /** Stops the turn and every background task now. */
  z.object({ type: z.literal("stop_session"), sessionId: Id }),
  /** Ends the Claude process at once and starts it again on the same conversation, under the same id. */
  z.object({ type: z.literal("force_stop"), sessionId: Id }),
  z.object({ type: z.literal("set_mode"), sessionId: Id, mode: Mode }),
  z.object({ type: z.literal("set_effort"), sessionId: Id, effort: Effort }),
  z.object({ type: z.literal("set_extreme"), sessionId: Id, on: z.boolean() }),
  z.object({
    type: z.literal("set_model"),
    sessionId: Id,
    model: z.string().min(1).max(200).optional(),
  }),
  z.object({
    type: z.literal("approve"),
    requestId: Id,
    message: Message.optional(),
    updatedInput: z.record(z.string(), z.unknown()).optional(),
    remember: z.boolean().optional(),
  }),
  z.object({ type: z.literal("deny"), requestId: Id, message: Message.optional() }),
  z.object({
    type: z.literal("answer"),
    requestId: Id,
    answers: z.record(z.string(), z.string().min(1).max(4000)),
  }),
  z.object({ type: z.literal("remember_preview"), requestId: Id }),
  /** Your own command in the session's folder, from the terminal pane. Desktop only; not checked by the Approver. */
  z.object({
    type: z.literal("term_run"),
    sessionId: Id,
    command: z.string().min(1).max(8000),
  }),
  z.object({ type: z.literal("term_stop"), sessionId: Id }),
  /** Restart JCVC, after a setting that needs it. The window app does it; elsewhere the reply says it cannot. */
  z.object({ type: z.literal("restart") }),
  z.object({ type: z.literal("kill") }),
  z.object({ type: z.literal("rearm") }),
  z.object({
    type: z.literal("checkpoint_list"),
    cwd: z.string().min(1).max(4096),
    sessionId: Id.optional(),
  }),
  z.object({
    type: z.literal("checkpoint_preview"),
    cwd: z.string().min(1).max(4096),
    ref: z.string().min(1).max(500),
  }),
  z.object({
    type: z.literal("checkpoint_restore"),
    cwd: z.string().min(1).max(4096),
    ref: z.string().min(1).max(500),
    sessionId: Id,
    confirm: z.boolean(),
  }),
  /** What changed since a checkpoint of this session (its first, unless one is named), file by file. */
  z.object({
    type: z.literal("changes"),
    sessionId: Id,
    ref: z.string().min(1).max(500).optional(),
  }),
  /** Puts these files back as they were at the checkpoint, after a safety checkpoint. */
  z.object({
    type: z.literal("undo_files"),
    sessionId: Id,
    ref: z.string().min(1).max(500),
    paths: z.array(z.string().min(1).max(4096)).min(1).max(500),
    confirm: z.boolean(),
  }),
  z.object({ type: z.literal("list_history"), dir: z.string().min(1).max(4096).optional() }),
  /** Your title (null removes it), pin or archive for a session, by its Claude Code id. */
  z.object({
    type: z.literal("session_meta"),
    sdkSessionId: z.string().min(1).max(200),
    title: z.string().max(120).nullable().optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
    /** Its folder, for a past session, so the title can be written into its transcript. */
    cwd: z.string().min(1).max(4096).optional(),
  }),
  /** What was said in a past session, for export. */
  z.object({
    type: z.literal("history_messages"),
    sdkSessionId: z.string().min(1).max(200),
    cwd: z.string().min(1).max(4096).optional(),
  }),
  /** Past sessions whose words contain the query. */
  z.object({ type: z.literal("search_history"), query: z.string().min(2).max(200) }),
  /** How full a session's context is. */
  z.object({ type: z.literal("context_usage"), sessionId: Id }),
  z.object({ type: z.literal("refresh_account") }),
  z.object({ type: z.literal("signin_start"), method: z.enum(["claudeai", "sso"]) }),
  z.object({ type: z.literal("signin_status") }),
  z.object({ type: z.literal("signin_cancel") }),
])
export type ClientCommand = z.infer<typeof ClientCommand>

/** A command may carry a correlation id, echoed in the reply. */
export const ClientMessage = z.object({ cmdId: Id.optional(), command: ClientCommand })
export type ClientMessage = z.infer<typeof ClientMessage>

export const SessionInfo = z.object({
  id: z.string(),
  cwd: z.string(),
  project: z.string(),
  /** Absent for a coding session. */
  kind: z.enum(["code", "chat"]).optional(),
  model: z.string().optional(),
  mode: Mode,
  effort: Effort.optional(),
  extreme: z.boolean().optional(),
  state: z.enum(["starting", "idle", "running", "waiting", "error", "ended"]),
  sdkSessionId: z.string().optional(),
  pendingApprovals: z.number().int(),
  createdAt: z.string(),
  error: z.string().optional(),
  /** Yours: a title, a pin, archived. */
  title: z.string().optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  /** The Claude Code conversation this one carries on from (Resume, Fork, or after a restart): the screen shows what was said there. */
  historyFrom: z.string().optional(),
  /** Brought back after JCVC restarted or updated, or after you force-stopped it, and whether a turn was cut off. */
  restarted: z.object({ wasRunning: z.boolean(), forced: z.boolean().optional() }).optional(),
  /** What is still working in the background after the turn ended (subagents, shell commands), by description. */
  background: z.array(z.string()).optional(),
  /** Extreme approval carrying on by itself: turns and spend since your last message, and why it stopped. */
  carryOn: z
    .object({
      turns: z.number(),
      maxTurns: z.number(),
      spentUsd: z.number(),
      maxUsd: z.number(),
      ended: z.enum(["done", "turns", "spend", "stopped", "error"]).optional(),
    })
    .optional(),
})
export type SessionInfo = z.infer<typeof SessionInfo>

export const PendingView = z.object({
  request: EscalationRequest,
  /** The real, unredacted input. The desktop shows it, the phone never gets it in the clear. */
  rawInput: z.record(z.string(), z.unknown()),
  defaultToNo: z.boolean(),
  phone: z.enum(["none", "held", "delivered", "expired"]),
  hardDeadline: z.string(),
})
export type PendingView = z.infer<typeof PendingView>

export const Resolution = z.object({
  outcome: z.enum(["allow", "deny", "timeout", "cancelled"]),
  channel: z.enum(["desktop", "phone", "push", "timeout", "host"]),
  message: z.string().optional(),
  at: z.string(),
  waitedMs: z.number(),
  /** A plain sentence for the UI, for example "Approved on desktop at 14:02". */
  summary: z.string(),
})
export type Resolution = z.infer<typeof Resolution>

export const Health = z.object({
  approver: z.object({
    state: z.enum(["stopped", "starting", "up", "down"]),
    policyHash: z.string().optional(),
    errors: z.array(z.string()).default([]),
  }),
  relay: z.object({
    state: z.enum(["not-configured", "connected", "unreachable"]),
    devices: z.number().int().default(0),
  }),
  /**
   * The push channels that are switched on, and whether each one works now: ntfy listening for your answers, Slack
   * connected. Absent from older Hosts.
   */
  push: z.array(z.object({ channel: z.enum(["ntfy", "slack"]), ok: z.boolean() })).optional(),
  signin: z.object({
    signedIn: z.boolean(),
    email: z.string().optional(),
    organization: z.string().optional(),
    managedPolicy: z.enum(["detected", "not-detected", "unknown"]),
    orgOk: z.boolean(),
    orgMessage: z.string().optional(),
    /**
     * False while the first sign-in check since JCVC started is still running (about 20 seconds: it starts Claude
     * Code to ask). signedIn and orgOk mean nothing until it is true. Absent from older Hosts.
     */
    checked: z.boolean().optional(),
  }),
  killSwitch: z.object({
    engaged: z.boolean(),
    since: z.string().optional(),
    by: z.string().optional(),
    approverConfirmed: z.boolean(),
  }),
  pwsh: z.object({ running: z.boolean(), languageMode: z.string().optional() }),
})
export type Health = z.infer<typeof Health>

export const ServerEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    sessions: z.array(SessionInfo),
    pending: z.array(PendingView),
    health: Health,
    usage: z.unknown(),
    expectedOrg: z.string().optional(),
  }),
  z.object({ type: z.literal("session"), info: SessionInfo }),
  z.object({ type: z.literal("sdk_message"), sessionId: z.string(), message: z.unknown() }),
  z.object({
    type: z.literal("session_event"),
    sessionId: z.string(),
    event: z.string(),
    data: z.record(z.string(), z.unknown()),
  }),
  z.object({ type: z.literal("approval_request"), view: PendingView }),
  z.object({
    type: z.literal("approval_resolved"),
    id: z.string(),
    sessionId: z.string(),
    resolution: Resolution,
  }),
  z.object({
    type: z.literal("phone_status"),
    id: z.string(),
    status: z.enum(["none", "held", "delivered", "expired"]),
  }),
  z.object({
    type: z.literal("term_output"),
    sessionId: z.string(),
    runId: z.string(),
    stream: z.enum(["out", "err"]),
    text: z.string(),
  }),
  z.object({
    type: z.literal("term_exit"),
    sessionId: z.string(),
    runId: z.string(),
    code: z.number().int().nullable(),
    signal: z.string().optional(),
  }),
  z.object({ type: z.literal("audit"), record: z.unknown() }),
  z.object({ type: z.literal("usage"), usage: z.unknown() }),
  z.object({ type: z.literal("health"), health: Health }),
  /** Updates to JCVC itself: what is installed, what is newer, and how far a download has got. */
  z.object({ type: z.literal("update"), update: z.unknown() }),
  z.object({
    type: z.literal("reply"),
    cmdId: z.string().optional(),
    ok: z.boolean(),
    data: z.unknown().optional(),
    error: z.object({ code: z.string(), message: z.string() }).optional(),
  }),
  z.object({ type: z.literal("error"), message: z.string() }),
])
export type ServerEvent = z.infer<typeof ServerEvent>

export const WS_SUBPROTOCOL = "gatehouse.v1"
export const WS_TOKEN_PREFIX = "token."
