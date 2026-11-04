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
/** The one effort scale, least first (B18). Every provider's own setting is mapped onto it, or it has none. */
export const EFFORT_ORDER = Effort.options
/** The effort to use: the one asked for, no higher than the cap (when there is one). */
export function capEffort(e: Effort | undefined, cap: Effort | undefined): Effort | undefined {
  if (!cap) return e
  if (!e) return undefined
  return EFFORT_ORDER.indexOf(e) > EFFORT_ORDER.indexOf(cap) ? cap : e
}
/** Whether an effort is above the cap. */
export const aboveCap = (e: Effort, cap: Effort | undefined): boolean =>
  cap !== undefined && EFFORT_ORDER.indexOf(e) > EFFORT_ORDER.indexOf(cap)
/**
 * How much of this computer a session may use, least first (owner: five levels). Low, Medium and High keep the
 * meaning they had when there were three, so a level saved by an older version means the same.
 */
export const RESOURCE_LEVELS = ["lowest", "low", "medium", "higher", "high"] as const
export const ResourceLevel = z.enum(RESOURCE_LEVELS)
export type ResourceLevel = z.infer<typeof ResourceLevel>
const Message = z.string().max(500)

export const ClientCommand = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_session"),
    cwd: z.string().min(1).max(4096),
    /** The account to run it on; the main one when absent. */
    account: z.string().max(20).optional(),
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
    /** A chat project: its instructions and knowledge files go with this chat. */
    chatProject: z.string().max(60).optional(),
    /** Instructions for this one session, added to the global and project ones. */
    instructions: z.string().max(8000).optional(),
    /** A research chat (W1-10): Claude plans its questions, searches, reads the best sources and cites each claim. */
    research: z.boolean().optional(),
    /** A chat with a model on this computer instead of Claude (ADR 0011), by the name you allowed. */
    localModel: z
      .string()
      .regex(/^[\w.:/-]{1,100}$/)
      .optional(),
    /** With resume and fork: carry on from this message of the conversation (Retry and Edit). */
    resumeAt: z.string().max(100).optional(),
    /** The session this one replaces in its pane (Retry and Edit), so Chat keeps both as branches. */
    replaces: Id.optional(),
    /** Start in a new git worktree of the repository cwd is in (B10), from a branch, tag or commit. */
    worktree: z.object({ base: z.string().max(100).optional() }).optional(),
  }),
  z.object({ type: z.literal("close_session"), sessionId: Id }),
  /** New chat or the quick prompt is open: have a chat ready for the first message (the warm chat). */
  z.object({ type: z.literal("warm_chat") }),
  z.object({ type: z.literal("prompt"), sessionId: Id, text: z.string().min(1).max(100_000) }),
  z.object({ type: z.literal("interrupt"), sessionId: Id }),
  /** Stops the turn and every background task now. */
  z.object({ type: z.literal("stop_session"), sessionId: Id }),
  /** Ends the Claude process at once and starts it again on the same conversation, under the same id. */
  z.object({ type: z.literal("force_stop"), sessionId: Id }),
  /** Starts a session again that Codehouse paused at the plan limit, before the limit resets. */
  z.object({ type: z.literal("resume_session"), sessionId: Id }),
  /** How much of this computer a session may use: Low, Medium or High. */
  z.object({
    type: z.literal("set_resources"),
    sessionId: Id,
    level: ResourceLevel,
  }),
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
  /** Restart Codehouse, after a setting that needs it. The window app does it; elsewhere the reply says it cannot. */
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
  /** One changed file as it was at the checkpoint and as it is now, for the side-by-side diff (B11). Read only. */
  z.object({
    type: z.literal("change_versions"),
    sessionId: Id,
    ref: z.string().min(1).max(500),
    path: z.string().min(1).max(4096),
  }),
  /** Puts these files back as they were at the checkpoint, after a safety checkpoint. */
  z.object({
    type: z.literal("undo_files"),
    sessionId: Id,
    ref: z.string().min(1).max(500),
    paths: z.array(z.string().min(1).max(4096)).min(1).max(500),
    confirm: z.boolean(),
  }),
  /** Puts back one change in a file (B12), against the version shown, after a safety checkpoint. */
  z.object({
    type: z.literal("undo_change"),
    sessionId: Id,
    ref: z.string().min(1).max(500),
    path: z.string().min(1).max(4096),
    hunk: z.number().int().min(0).max(100_000),
    afterHash: z.string().regex(/^[0-9a-f]{64}$/),
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
    /** The project to group it under in the sidebar; null takes it out of one. */
    group: z.string().min(1).max(60).nullable().optional(),
    /** Its folder, for a past session, so the title can be written into its transcript. */
    cwd: z.string().min(1).max(4096).optional(),
  }),
  /** B21: a chat carried on with another model you allow; recorded before the new chat starts. */
  z.object({
    type: z.literal("fallback_used"),
    from: Id,
    model: z.string().min(1).max(100),
  }),
  /** B25: the check to carry on until it passes, or null for none. */
  z.object({
    type: z.literal("set_goal"),
    sessionId: Id,
    check: z.string().min(1).max(300).nullable(),
  }),
  /** B22: of chats started side by side with the same message, the one you kept; recorded, the rest are closed. */
  z.object({
    type: z.literal("compare_chosen"),
    kept: Id,
    others: z.array(Id).min(1).max(3),
  }),
  /** What was said in a past session, for export. */
  z.object({
    type: z.literal("history_messages"),
    sdkSessionId: z.string().min(1).max(200),
    cwd: z.string().min(1).max(4096).optional(),
    /** The whole conversation from its start, for an export (W1-13), not the first page. */
    all: z.boolean().optional(),
  }),
  /** Past sessions whose words contain the query. */
  z.object({ type: z.literal("search_history"), query: z.string().min(2).max(200) }),
  /** How full a session's context is. */
  z.object({ type: z.literal("context_usage"), sessionId: Id }),
  /** Summarise the older conversation: now between turns, or straight after the running one. */
  z.object({ type: z.literal("compact"), sessionId: Id }),
  z.object({ type: z.literal("refresh_account"), account: z.string().max(20).optional() }),
  z.object({
    type: z.literal("signin_start"),
    method: z.enum(["claudeai", "sso"]),
    account: z.string().max(20).optional(),
  }),
  z.object({ type: z.literal("signin_status"), account: z.string().max(20).optional() }),
  z.object({ type: z.literal("signin_cancel"), account: z.string().max(20).optional() }),
  /** Several accounts at once: add one, confirm the organisation it reports, remove it, sign it in privately. */
  z.object({ type: z.literal("account_add"), label: z.string().max(60) }),
  z.object({ type: z.literal("account_confirm_org"), account: z.string().max(20) }),
  z.object({ type: z.literal("account_remove"), account: z.string().max(20) }),
  z.object({ type: z.literal("account_private_window"), account: z.string().max(20) }),
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
  /** The project it is grouped under in the sidebar (owner, 2 Nov). Older versions ignore it. */
  group: z.string().optional(),
  /** The Claude Code conversation this one carries on from (Resume, Fork, or after a restart): the screen shows what was said there. */
  historyFrom: z.string().optional(),
  /**
   * Brought back after Codehouse restarted or updated, after you force-stopped it, or after its Claude Code crashed, and
   * whether a turn was cut off.
   */
  restarted: z
    .object({
      wasRunning: z.boolean(),
      forced: z.boolean().optional(),
      crashed: z.boolean().optional(),
    })
    .optional(),
  /** What is still working in the background after the turn ended (subagents, shell commands), by description. */
  background: z.array(z.string()).optional(),
  /** How much of this computer the session may use. Absent where Codehouse cannot limit it. */
  resources: ResourceLevel.optional(),
  /** Which signed-in account it runs on. Absent for the main one. */
  account: z.string().optional(),
  /** You asked to compact while a turn ran: it compacts when the turn ends. */
  compactPending: z.boolean().optional(),
  /** The chat project this chat belongs to. */
  chatProject: z.string().optional(),
  /** The instructions given for this session alone. */
  instructions: z.string().optional(),
  /** A research chat (W1-10). */
  research: z.boolean().optional(),
  /** B39: one run of a plugin's evaluation, with the plugin on or off. Not brought back after a restart. */
  evaluation: z.object({ plugin: z.string(), with: z.boolean() }).optional(),
  /** Runs on a model on this computer, not Claude (ADR 0011). `model` names it. */
  local: z.boolean().optional(),
  /** The most effort Settings allows (B18). Absent: no cap. */
  effortCap: Effort.optional(),
  /** B25: the check Extreme approval carries on until it passes. */
  goal: z.string().max(300).optional(),
  /** Where a local chat's words go: "On this computer", or a provider through your gateway (ADR 0010). */
  localLabel: z.string().max(120).optional(),
  /** A fork from a point in a conversation: its earlier conversation is shown up to this message only. */
  historyUntil: z.string().max(100).optional(),
  /** Works in a git worktree Codehouse made for it (B10). Absent from older Hosts. */
  worktree: z.object({ branch: z.string(), repo: z.string() }).optional(),
  /**
   * Paused because the plan's 5-hour limit reached its pause point. It starts again by itself when the limit resets
   * (`until`, when known), or when you start it.
   */
  paused: z
    .object({
      until: z.string().optional(),
      /** The percentage of the limit used when it paused. */
      percent: z.number(),
      /** A turn was running when it paused, so starting it again carries on where it stopped. */
      wasRunning: z.boolean(),
      /** B20: why. Absent: the plan's 5-hour limit. "spend": today's spending reached the cap in Settings. */
      reason: z.enum(["spend"]).optional(),
    })
    .optional(),
  /** Extreme approval carrying on by itself: turns and spend since your last message, and why it stopped. */
  carryOn: z
    .object({
      turns: z.number(),
      /** Absent: no limit. */
      maxTurns: z.number().optional(),
      spentUsd: z.number(),
      /** Absent: no limit. */
      maxUsd: z.number().optional(),
      ended: z.enum(["done", "goal", "turns", "spend", "stopped", "error", "stalled"]).optional(),
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
  /** Every signed-in account, the main one first. Absent from older Hosts. */
  accounts: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        signedIn: z.boolean(),
        email: z.string().optional(),
        organization: z.string().optional(),
        expectedOrg: z.string().optional(),
        orgOk: z.boolean(),
      }),
    )
    .optional(),
  signin: z.object({
    signedIn: z.boolean(),
    email: z.string().optional(),
    organization: z.string().optional(),
    managedPolicy: z.enum(["detected", "not-detected", "unknown"]),
    orgOk: z.boolean(),
    orgMessage: z.string().optional(),
    /**
     * False while the first sign-in check since Codehouse started is still running (about 20 seconds: it starts Claude
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
  /** Updates to Codehouse itself: what is installed, what is newer, and how far a download has got. */
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
