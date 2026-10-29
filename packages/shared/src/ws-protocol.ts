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
  }),
  z.object({ type: z.literal("close_session"), sessionId: Id }),
  z.object({ type: z.literal("prompt"), sessionId: Id, text: z.string().min(1).max(100_000) }),
  z.object({ type: z.literal("interrupt"), sessionId: Id }),
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
  z.object({ type: z.literal("list_history"), dir: z.string().min(1).max(4096).optional() }),
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
  model: z.string().optional(),
  mode: Mode,
  effort: Effort.optional(),
  extreme: z.boolean().optional(),
  state: z.enum(["starting", "idle", "running", "waiting", "error", "ended"]),
  sdkSessionId: z.string().optional(),
  pendingApprovals: z.number().int(),
  createdAt: z.string(),
  error: z.string().optional(),
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
  signin: z.object({
    signedIn: z.boolean(),
    email: z.string().optional(),
    organization: z.string().optional(),
    managedPolicy: z.enum(["detected", "not-detected", "unknown"]),
    orgOk: z.boolean(),
    orgMessage: z.string().optional(),
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
