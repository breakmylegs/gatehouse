import { EventEmitter } from "node:events"
import { Effort, type Verdict } from "@gatehouse/shared"
import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import type { Options, Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import { findProjectRoot, type Policy, type PwshWorker, type PolicyEngine } from "@gatehouse/policy"
import { projectName, sanitiseEnv, uuidv7 } from "@gatehouse/shared"
import type { GatehouseConfig } from "@gatehouse/shared/node"
import { checkOrg, type AccountMonitor, type QueryFn } from "./account.js"
import type { ApproverClient } from "./approver-client.js"
import type { Broker } from "./broker.js"
import { createCanUseTool } from "./canuse.js"
import type { CheckpointManager } from "./checkpoints.js"
import {
  createEventHook,
  createFloorHook,
  createPostToolHook,
  type SessionHookDeps,
} from "./hooks.js"
import type { HostAudit } from "./hostaudit.js"
import type { HostKillSwitch } from "./kill.js"
import {
  assertSafeOptions,
  isAllowedMode,
  isShadowWarning,
  outOfProcessServers,
  SafetyError,
  type SessionMode,
} from "./safety.js"
import type { UsageStore } from "./usage.js"
import { LEVELS, type Limiter, type ResourceLevel } from "./limits.js"
import { MAIN_ACCOUNT, type Accounts } from "./accounts.js"
import {
  CARRY_ON_PROMPT,
  CarryOn,
  carryOnLimits,
  RESUME_PROMPT,
  type CarryOnStatus,
} from "./carry-on.js"
import { planLimits, type PlanUsage } from "./plan-usage.js"

export class OrgGuardError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}
/** The folder for a new session cannot be used or made. */
export class SessionFolderError extends Error {}

/** A chat stays in Plan mode: it can read and search, never change files or run commands. */
export class ChatModeError extends Error {
  constructor() {
    super(
      "A chat stays in Plan mode, so it never changes files or runs commands. Start a coding session for that.",
    )
  }
}

/**
 * Makes sure the project folder exists. A folder that is missing is created, with any parent folders it needs, so
 * a whole new path can be typed in. A relative path, a path that is a file, or a drive that is not there is
 * refused with a plain message (a missing folder otherwise shows up as a misleading "program failed to launch").
 */
export function ensureFolder(cwd: string, log: (line: string) => void = () => undefined): void {
  if (!path.isAbsolute(cwd))
    throw new SessionFolderError(
      `"${cwd}" is not a full folder path. Type the whole path, for example C:\\dev\\my-project.`,
    )
  let stat: fs.Stats | undefined
  try {
    stat = fs.statSync(cwd)
  } catch {
    stat = undefined
  }
  if (stat) {
    if (!stat.isDirectory()) throw new SessionFolderError(`"${cwd}" is a file, not a folder.`)
    return
  }
  const root = path.parse(path.resolve(cwd)).root
  if (!fs.existsSync(root))
    throw new SessionFolderError(
      `The drive ${root} does not exist, so the folder cannot be created.`,
    )
  try {
    fs.mkdirSync(cwd, { recursive: true })
  } catch (e) {
    throw new SessionFolderError(
      `The folder "${cwd}" could not be created: ${(e as Error).message}`,
    )
  }
  log(`created the project folder ${cwd}`)
}

/** cwd, or cwd-2, cwd-3 and so on: the first that does not exist, or (unless emptyIsFree is false) is empty. */
export function freeFolder(cwd: string, emptyIsFree = true): string {
  const free = (p: string) => {
    if (!fs.existsSync(p)) return true
    if (!emptyIsFree) return false
    try {
      return fs.statSync(p).isDirectory() && fs.readdirSync(p).length === 0
    } catch {
      return false
    }
  }
  if (free(cwd)) return cwd
  for (let n = 2; n < 100; n++) if (free(`${cwd}-${n}`)) return `${cwd}-${n}`
  throw new SessionFolderError(
    `There are already 99 projects called ${path.basename(cwd)}. Choose another name.`,
  )
}

const sameFolder = (a: string, b: string) =>
  path
    .resolve(a)
    .replace(/[\\/]+$/, "")
    .toLowerCase() ===
  path
    .resolve(b)
    .replace(/[\\/]+$/, "")
    .toLowerCase()

/** git init, so checkpoints work from the first edit. A failure is logged; the project still starts. */
function gitInit(cwd: string, log: (line: string) => void): Promise<void> {
  return new Promise((resolve) =>
    execFile("git", ["init", "--quiet"], { cwd, windowsHide: true, timeout: 30_000 }, (e) => {
      if (e)
        log(`git init failed in ${cwd} (${e.message.split("\n")[0]}); checkpoints are off there`)
      resolve()
    }),
  )
}

export class KillSwitchEngagedError extends Error {
  constructor() {
    super("The kill switch is engaged. Re-arm it on the desktop before starting a session.")
  }
}

export type SessionState = "starting" | "idle" | "running" | "waiting" | "error" | "ended"

export interface SessionInfo {
  id: string
  cwd: string
  project: string
  /** Absent for a coding session. */
  kind?: "code" | "chat"
  model?: string
  mode: SessionMode
  effort?: Effort
  extreme?: boolean
  state: SessionState
  sdkSessionId?: string
  pendingApprovals: number
  createdAt: string
  error?: string
  /** Yours: a title, a pin, archived. */
  title?: string
  pinned?: boolean
  archived?: boolean
  /** The Claude Code conversation this one carries on from: the screen shows what was said there. */
  historyFrom?: string
  /** Brought back after JCVC restarted or updated, or after you force-stopped it, and whether a turn was cut off. */
  restarted?: { wasRunning: boolean; forced?: boolean }
  /** What is still working in the background after the turn ended, by description. */
  background?: string[]
  /** Extreme approval carrying on by itself: turns and spend since your last message, and why it stopped. */
  carryOn?: CarryOnStatus
  /** How much of this computer the session may use. Absent where JCVC cannot limit it. */
  resources?: ResourceLevel
  /** Which signed-in account it runs on. Absent for the main one. */
  account?: string
  /** You asked to compact while a turn ran: it compacts when the turn ends. */
  compactPending?: boolean
}

export interface SessionEvents {
  message: [SDKMessage]
  state: [SessionInfo]
  event: [
    {
      type:
        | "notification"
        | "stop"
        | "subagent_start"
        | "subagent_stop"
        | "decision"
        | "interrupted"
        | "carry_on"
        | "carry_on_end"
      data: Record<string, unknown>
    },
  ]
}

export interface SessionDeps {
  queryFn: QueryFn
  /** Your title, pin and archive for a Claude Code session id. Absent where they are not kept. */
  sessionMeta?: (sdkSessionId: string | undefined) => {
    title?: string
    pinned?: boolean
    archived?: boolean
  }
  /** What a Claude Code session last ran with (model, effort, mode, resources), so Resume starts it the same way. */
  resumeSettings?: (sdkSessionId: string) => {
    model?: string
    effort?: string
    mode?: SessionMode
    extreme?: boolean
    resources?: ResourceLevel
  }
  /** Where chats get their folders: %LOCALAPPDATA%\Gatehouse\chats. Absent where chats are not offered. */
  chatsDir?: string
  /** Runs each session inside a job object with its resource limits. Absent where that is not possible. */
  limiter?: Limiter
  /** The accounts signed in beside the main one. Absent where there is only the main one. */
  accounts?: Accounts
  config: () => GatehouseConfig
  policy: () => Policy | undefined
  engine: PolicyEngine
  pwsh: PwshWorker | undefined
  audit: HostAudit
  broker: Broker
  approver: ApproverClient
  kill: HostKillSwitch
  usage: UsageStore
  checkpoints: CheckpointManager
  account: AccountMonitor
  /** Builds the in-process Companion for a session. */
  companion: (s: { sessionId: string; cwd: string }) => Record<string, unknown>
  managedDetected: () => Promise<boolean | undefined>
  localRulesPath?: string
  /** Tells the phone about a request that Extreme approval mode approved. */
  notifyAutoApproved?: (toolName: string, project: string) => void
  log: (line: string) => void
}

export interface StartSessionOptions {
  cwd: string
  model?: string
  mode?: SessionMode
  effort?: Effort
  extreme?: boolean
  resume?: string
  fork?: boolean
  /** A new project in the projects folder: the folder must be new (a number is added if the name is taken). */
  freshFolder?: boolean
  /** A chat, not a coding session: it gets a folder of its own under the data folder, named from title. */
  kind?: "code" | "chat"
  /** The first thing said in a chat, which names its folder. */
  title?: string
  /**
   * Brought back after JCVC restarted: the same id, so the screen finds its panes again, and its original start
   * time. A chat keeps its folder.
   */
  restore?: { id: string; createdAt: string; wasRunning: boolean; forced?: boolean }
  /** How much of this computer it may use; High (no limits) when not given. */
  resources?: ResourceLevel
  /** The account to run it on; the main one when not given. */
  account?: string
}

/**
 * Added to Claude's instructions in a chat. Its folder is outside your workspace folders, so the rules already
 * block edits there; this keeps it talking rather than reaching for tools.
 */
export const CHAT_PROMPT =
  "This is a chat in Jean-Claude Van Code, not a coding session. Answer in plain language, and look things up on the web when that helps. Do not create, edit or run files or commands unless the person asks; if they want something built, suggest they start a coding session for it."

/** A prompt stream the Host pushes user messages into. It makes interrupt, mode and model changes possible. */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  #items: SDKUserMessage[] = []
  #waiting: ((r: IteratorResult<SDKUserMessage>) => void) | undefined
  #closed = false

  push(text: string): void {
    const msg: SDKUserMessage = {
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
    }
    if (this.#waiting) {
      const w = this.#waiting
      this.#waiting = undefined
      w({ value: msg, done: false })
    } else this.#items.push(msg)
  }

  end(): void {
    this.#closed = true
    this.#waiting?.({ value: undefined, done: true })
    this.#waiting = undefined
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.#items.shift()
        if (item) return Promise.resolve({ value: item, done: false })
        if (this.#closed) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve) => (this.#waiting = resolve))
      },
    }
  }
}

export class Session extends EventEmitter<SessionEvents> {
  readonly id: string
  readonly cwd: string
  readonly project: string
  readonly createdAt: string
  readonly #deps: SessionDeps
  readonly #input = new InputQueue()
  readonly #decided = new Set<string>()
  /** The Approver's verdicts from the PreToolUse hook (Auto and Accept edits), by toolUseID, for canUseTool. */
  readonly #verdicts = new Map<string, Verdict>()
  /** Background tasks still working (subagents, shell commands), by task id, from Claude Code's own list. */
  readonly #background = new Map<string, string>()
  /** Extreme approval's run of automatic turns since your last message. */
  readonly #carry = new CarryOn(() => carryOnLimits(this.#deps.config().extremeCarryOn))
  /** The session's total cost after its last turn, so a run counts only what it spends. */
  #lastCost = 0
  /** You asked to compact while a turn ran: it compacts when the turn ends. */
  #compactAfterTurn = false
  #resources: ResourceLevel = "high"
  readonly #account: string
  /** Its job object's name, unique to this start, for changing the limits while it runs. */
  readonly #job = `Local\\JCVC-${uuidv7()}`
  /** Tells the screen how a tool call was decided: the rule, its reason and who decided. Never the input. */
  readonly #tellDecision = (toolUseId: string, v: Verdict) => {
    try {
      this.emit("event", {
        type: "decision",
        data: {
          toolUseId,
          outcome: v.outcome,
          decidedBy: v.decidedBy,
          ruleId: v.ruleId,
          reason: v.reason,
          risk: v.risk,
        },
      })
    } catch {
      // A problem showing the decision never changes it.
    }
  }
  #q: Query | undefined
  #state: SessionState = "starting"
  #mode: SessionMode
  #model: string | undefined
  #effort: Effort | undefined
  #extreme: boolean
  #sdkSessionId: string | undefined
  #error: string | undefined
  #running = false
  readonly #opts: StartSessionOptions
  readonly #onBrokerChange: () => void

  constructor(deps: SessionDeps, opts: StartSessionOptions) {
    super()
    this.#deps = deps
    this.#opts = opts
    this.id = opts.restore?.id ?? uuidv7()
    this.createdAt = opts.restore?.createdAt ?? new Date().toISOString()
    // Resuming carries on in the same conversation, unless it forks; the first message says for certain.
    this.#sdkSessionId = opts.resume !== undefined && opts.fork !== true ? opts.resume : undefined
    this.cwd = opts.cwd
    this.project = path.basename(findProjectRoot(opts.cwd))
    this.#mode = opts.mode ?? "default"
    this.#model = opts.model
    this.#effort = opts.effort
    this.#extreme = opts.extreme === true
    this.#resources = opts.resources ?? "high"
    this.#account = opts.account ?? MAIN_ACCOUNT
    this.#onBrokerChange = () => this.#refreshWaiting()
    deps.broker.on("created", this.#onBrokerChange)
    deps.broker.on("resolved", this.#onBrokerChange)
  }

  info(): SessionInfo {
    return {
      id: this.id,
      cwd: this.cwd,
      project: this.project,
      ...(this.#opts.kind === "chat" ? { kind: "chat" as const } : {}),
      ...(this.#model !== undefined ? { model: this.#model } : {}),
      mode: this.#mode,
      ...(this.#effort !== undefined ? { effort: this.#effort } : {}),
      extreme: this.#extreme,
      state: this.#state,
      ...(this.#sdkSessionId !== undefined ? { sdkSessionId: this.#sdkSessionId } : {}),
      pendingApprovals: this.#deps.broker.countFor(this.id),
      createdAt: this.createdAt,
      ...(this.#error !== undefined ? { error: this.#error } : {}),
      ...(this.#opts.resume !== undefined ? { historyFrom: this.#opts.resume } : {}),
      ...(this.#opts.restore
        ? {
            restarted: {
              wasRunning: this.#opts.restore.wasRunning,
              ...(this.#opts.restore.forced ? { forced: true } : {}),
            },
          }
        : {}),
      ...(this.#background.size ? { background: [...this.#background.values()] } : {}),
      ...(this.#deps.limiter ? { resources: this.#resources } : {}),
      ...(this.#account !== MAIN_ACCOUNT ? { account: this.#account } : {}),
      ...(this.#compactAfterTurn ? { compactPending: true } : {}),
      ...(this.#extreme && (this.#carry.status().turns > 0 || this.#carry.status().ended)
        ? { carryOn: this.#carry.status() }
        : {}),
      ...this.#deps.sessionMeta?.(this.#sdkSessionId),
    }
  }

  #setState(state: SessionState): void {
    if (this.#state === state) return
    // An error is final. A result or an end-of-stream that arrives afterwards must not hide it.
    if (this.#state === "error") return
    this.#state = state
    this.emit("state", this.info())
  }

  #refreshWaiting(): void {
    if (this.#state === "running" || this.#state === "waiting") {
      this.#setState(this.#deps.broker.countFor(this.id) > 0 ? "waiting" : "running")
    } else if (this.#state === "idle") {
      this.emit("state", this.info()) // the pending count changed
    }
  }

  /** Builds the options and starts the SDK process. Fails if the options are unsafe or the organisation is wrong. */
  async start(): Promise<void> {
    const d = this.#deps
    const hookDeps: SessionHookDeps = {
      sessionId: this.id,
      cwd: this.cwd,
      policy: d.policy,
      pwsh: d.pwsh,
      audit: d.audit,
      kill: () => d.kill.isEngaged(),
      checkpoints: d.checkpoints,
      decided: this.#decided,
      onEvent: (type, data) => this.emit("event", { type, data }),
      onDecision: this.#tellDecision,
      log: d.log,
      mode: () => this.#mode,
      approver: d.approver,
      verdicts: this.#verdicts,
    }
    // Invariant 4: the SDK's warning that canUseTool is shadowed stops the session.
    const onStderr = (data: string) => {
      if (isShadowWarning(data))
        this.#fatal(new SafetyError(4, "the SDK reported that canUseTool is shadowed"))
    }
    const eventHook = createEventHook(hookDeps)
    const postHook = createPostToolHook(hookDeps)
    const options: Options = {
      cwd: this.cwd,
      ...(this.#model !== undefined ? { model: this.#model } : {}),
      permissionMode: this.#mode,
      ...(this.#effort !== undefined ? { effort: this.#effort } : {}),
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        snapshot: true,
        ...(this.#opts.kind === "chat" ? { append: CHAT_PROMPT } : {}),
      },
      settingSources: ["user", "project", "local"],
      includePartialMessages: true,
      // Its account's own Claude Code folder, and never a credential (invariant 6).
      env: d.accounts ? d.accounts.env(this.#account) : sanitiseEnv(process.env),
      canUseTool: createCanUseTool({
        sessionId: this.id,
        cwd: this.cwd,
        project: this.project,
        approver: d.approver,
        broker: d.broker,
        audit: d.audit,
        kill: () => d.kill.isEngaged(),
        policy: d.policy,
        engine: d.engine,
        pwsh: d.pwsh,
        checkpoints: d.checkpoints,
        ...(d.localRulesPath !== undefined ? { localRulesPath: d.localRulesPath } : {}),
        decided: this.#decided,
        verdicts: this.#verdicts,
        extreme: () => this.#extreme,
        ...(d.notifyAutoApproved ? { notifyAutoApproved: d.notifyAutoApproved } : {}),
        onDecision: this.#tellDecision,
        log: d.log,
      }),
      hooks: {
        PreToolUse: [{ hooks: [createFloorHook(hookDeps)] }],
        PostToolUse: [{ hooks: [postHook] }],
        PostToolUseFailure: [{ hooks: [postHook] }],
        Notification: [{ hooks: [eventHook] }],
        Stop: [{ hooks: [eventHook] }],
        SubagentStart: [{ hooks: [eventHook] }],
        SubagentStop: [{ hooks: [eventHook] }],
      },
      mcpServers: d.companion({ sessionId: this.id, cwd: this.cwd }) as Options["mcpServers"],
      stderr: onStderr,
      // Inside a job object with the session's limits, when JCVC can make one. Its stderr comes back to onStderr.
      ...(d.limiter
        ? { spawnClaudeCodeProcess: d.limiter.spawn(this.#job, () => this.#resources, onStderr) }
        : {}),
      ...(this.#opts.resume !== undefined
        ? { resume: this.#opts.resume, forkSession: this.#opts.fork === true }
        : {}),
    }
    assertSafeOptions(options)

    this.#q = d.queryFn({ prompt: this.#input, options })
    try {
      const init = await this.#q.initializationResult()
      const managed = await d.managedDetected().catch(() => undefined)
      // Invariant 14, per account: this account must still belong to the organisation confirmed for it.
      const snapshot = (d.accounts?.monitor(this.#account) ?? d.account).note(init.account, managed)
      if (!snapshot.org.ok) {
        // Invariant 14: nothing is sent to a session on the wrong account.
        throw new OrgGuardError(snapshot.org.code, snapshot.org.message)
      }
      // Owner, 31 Oct: only in-process MCP servers in a session. Nothing is sent to one that has another.
      const q = this.#q as unknown as { mcpServerStatus?: () => Promise<unknown> }
      if (q.mcpServerStatus) {
        const outside = outOfProcessServers(await q.mcpServerStatus())
        if (outside.length)
          throw new SafetyError(
            17,
            `MCP servers outside the process are not allowed in a session: ${outside.join(", ")}`,
          )
      }
    } catch (e) {
      this.#q.close()
      this.#input.end()
      this.#setState("error")
      this.#error = (e as Error).message
      d.broker.off("created", this.#onBrokerChange)
      d.broker.off("resolved", this.#onBrokerChange)
      throw e
    }
    this.#setState("idle")
    void this.#pump()
    // Brought back mid-run in Extreme approval: it carries on where it was, as you asked it to.
    if (this.#opts.restore?.wasRunning && !this.#opts.restore.forced) {
      this.#carry.started()
      void this.#carryOnNow({ restart: true })
    }
  }

  async #pump(): Promise<void> {
    const q = this.#q
    if (!q) return
    try {
      for await (const msg of q) {
        this.#onMessage(msg)
        this.emit("message", msg)
      }
      if (this.#state !== "error") this.#setState("ended")
    } catch (e) {
      this.#fatal(e as Error)
    } finally {
      this.#deps.broker.off("created", this.#onBrokerChange)
      this.#deps.broker.off("resolved", this.#onBrokerChange)
    }
  }

  #onMessage(msg: SDKMessage): void {
    const m = msg as unknown as Record<string, unknown>
    if (typeof m.session_id === "string" && m.session_id !== this.#sdkSessionId) {
      this.#sdkSessionId = m.session_id
      this.emit("state", this.info())
    }
    if (msg.type === "system") {
      if (isShadowWarning(JSON.stringify(m)))
        this.#fatal(new SafetyError(4, "the SDK reported that canUseTool is shadowed"))
      if ((m.subtype as string) === "init" && typeof m.model === "string") this.#model = m.model
      this.#noteBackground(m)
    }
    if (msg.type === "result") {
      this.#deps.usage.record(this.id, this.project, m)
      this.#running = false
      this.#setState("idle")
      if (typeof m.total_cost_usd === "number") this.#lastCost = m.total_cost_usd
      if (this.#compactAfterTurn) {
        // Asked for while the turn ran: it compacts now, and Extreme approval carries on after that.
        this.#compactAfterTurn = false
        try {
          this.#send("/compact")
          return
        } catch {
          this.emit("state", this.info())
        }
      }
      if (this.#extreme) void this.#afterTurn(m)
    }
  }

  /**
   * Work that carries on after a turn ends. Claude Code sends the whole list when it changes; a task that ends also
   * says so on its own. Watchers it marks ambient are not work, so they do not count.
   */
  #noteBackground(m: Record<string, unknown>): void {
    const sub = m.subtype as string
    if (sub === "background_tasks_changed" && Array.isArray(m.tasks)) {
      this.#background.clear()
      for (const t of m.tasks as Array<Record<string, unknown>>)
        if (typeof t.task_id === "string" && t.ambient !== true)
          this.#background.set(t.task_id, typeof t.description === "string" ? t.description : "")
      this.emit("state", this.info())
    } else if (
      sub === "task_notification" &&
      typeof m.task_id === "string" &&
      this.#background.delete(m.task_id)
    )
      this.emit("state", this.info())
  }

  #fatal(e: Error): void {
    this.#error = e.message
    this.#deps.log(`session ${this.id} (${this.project}) stopped with an error: ${e.message}`)
    this.#deps.broker.cancelSession(this.id, "The session stopped with an error")
    this.#setState("error")
    this.#q?.close()
    this.#input.end()
  }

  /** Your next message. Messages sent while a turn runs are queued by the SDK. It starts a new run for Extreme. */
  prompt(text: string): void {
    this.#send(text)
    this.#carry.started(this.#lastCost)
  }

  #send(text: string): void {
    if (this.#state === "error" || this.#state === "ended")
      throw new Error(`The session has ${this.#state}`)
    if (this.#deps.kill.isEngaged()) throw new KillSwitchEngagedError()
    this.#running = true
    this.#setState(this.#deps.broker.countFor(this.id) > 0 ? "waiting" : "running")
    this.#input.push(text)
  }

  /**
   * Summarises the older conversation to make room: now between turns, or straight after the turn that is running
   * (owner, 31 Oct). The screen shows it waiting.
   */
  compact(): void {
    if (this.#running) {
      this.#compactAfterTurn = true
      this.emit("state", this.info())
      return
    }
    this.#send("/compact")
  }

  /** Which signed-in account it runs on. */
  get account(): string {
    return this.#account
  }

  /** Open and able to answer: started, and neither ended nor failed. */
  get live(): boolean {
    return this.#q !== undefined && this.#state !== "error" && this.#state !== "ended"
  }

  /**
   * The account's plan limits, from Claude Code's own /usage data. The SDK marks the call experimental, so anything
   * missing or unexpected is nothing (docs/sdk-notes.md). Asks no question of Claude and touches no token.
   */
  async planUsage(): Promise<PlanUsage | undefined> {
    type Read = (o: { skipBehaviors: boolean }) => Promise<unknown>
    const q = this.#q as unknown as
      | { usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?: Read }
      | undefined
    const read = q?.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?.bind(q)
    if (!read) return undefined
    const first = planLimits(await read({ skipBehaviors: true }))
    if (first) return first
    // The first answer can come before Claude Code has fetched the numbers (probe, 31 Oct).
    await new Promise((r) => setTimeout(r, PLAN_RETRY_MS))
    return planLimits(await read({ skipBehaviors: true }))
  }

  /** How full the conversation is, from the last response and local estimates (no extra token counting). */
  async contextUsage(): Promise<unknown> {
    if (!this.#q) throw new Error("The session has not started")
    const q = this.#q as unknown as {
      getContextUsage?: (o: { detail: "summary" }) => Promise<unknown>
    }
    if (!q.getContextUsage) throw new Error("This version of Claude Code cannot report its context")
    return await q.getContextUsage({ detail: "summary" })
  }

  /** Stops the running turn. The screen hears first, so the result that follows reads as stopped, not failed. */
  async interrupt(by: "you" | "kill-switch" = "you"): Promise<void> {
    // Stopping a turn stops Extreme carrying on, until your next message, and a compact that was to follow it.
    this.#carry.stopped()
    this.#compactAfterTurn = false
    if (this.#running) this.emit("event", { type: "interrupted", data: { by } })
    this.#deps.broker.cancelSession(this.id)
    await this.#q?.interrupt()
    if (this.#state === "running" || this.#state === "waiting") {
      this.#running = false
      this.#setState("idle")
    }
  }

  /**
   * Extreme approval: after a turn, carry on by itself until Claude says the build queue is empty, a limit is
   * reached, a turn fails or you stop it (CLAUDE.md invariant 3, owner 30 Oct).
   */
  async #afterTurn(m: Record<string, unknown>): Promise<void> {
    const step = this.#carry.next({
      text: typeof m.result === "string" ? m.result : "",
      isError: m.is_error === true || String(m.subtype ?? "").startsWith("error"),
      ...(typeof m.total_cost_usd === "number" ? { costUsd: m.total_cost_usd } : {}),
      ...(typeof m.num_turns === "number" ? { steps: m.num_turns } : {}),
    })
    if (!step) return
    if (!step.go) {
      this.emit("event", {
        type: "carry_on_end",
        data: { why: step.why, turns: step.turns, spentUsd: step.spentUsd },
      })
      this.emit("state", this.info())
      return
    }
    await this.#carryOnNow({ turn: step.turn, ...(step.of !== undefined ? { of: step.of } : {}) })
  }

  /** Sends the carry-on message, once it is in the audit log. Nothing carries on that cannot be recorded. */
  async #carryOnNow(data: Record<string, unknown>): Promise<void> {
    if (this.#deps.kill.isEngaged() || this.#running) return
    if (this.#state === "error" || this.#state === "ended") return
    const written = await this.#deps.audit.record({
      session: this.id,
      event: "extreme_carry_on",
      channel: "host",
      tool: "session",
      cwd: this.cwd,
      project: this.project,
      input: data,
      verdict: {
        outcome: "allow",
        ruleId: "extreme-carry-on",
        reason:
          data.restart === true
            ? "JCVC restarted while the session was working, so it carried on where it was."
            : "Extreme approval is on, so the session carried on with its build queue by itself.",
        risk: 0,
        decidedBy: "extreme-mode",
        policyHash: this.#deps.policy()?.hash ?? "",
      },
      latencyMs: 0,
    })
    if (!written) {
      this.#carry.stopped()
      return
    }
    this.emit("event", { type: "carry_on", data })
    this.#send(data.restart === true && !this.#extreme ? RESUME_PROMPT : CARRY_ON_PROMPT)
    this.emit("state", this.info())
  }

  /** Stops everything now: the running turn and every background task. */
  async stop(by: "you" | "kill-switch" = "you"): Promise<void> {
    await this.interrupt(by)
    const q = this.#q as unknown as { stopTask?: (id: string) => Promise<void> } | undefined
    await Promise.allSettled([...this.#background.keys()].map((id) => q?.stopTask?.(id)))
  }

  /** What it takes to start this session again on the same conversation. */
  restartOptions(): StartSessionOptions {
    return {
      cwd: this.cwd,
      ...(this.#opts.kind ? { kind: this.#opts.kind } : {}),
      mode: this.#mode,
      ...(this.#model !== undefined ? { model: this.#model } : {}),
      ...(this.#effort !== undefined ? { effort: this.#effort } : {}),
      extreme: this.#extreme,
      resources: this.#resources,
      ...(this.#account !== MAIN_ACCOUNT ? { account: this.#account } : {}),
      ...(this.#sdkSessionId !== undefined ? { resume: this.#sdkSessionId } : {}),
    }
  }

  /**
   * How much of this computer the session may use: applied at once to it and everything it started, and recorded.
   * If the running job cannot be changed, the level still applies from its next start.
   */
  async setResources(level: ResourceLevel): Promise<void> {
    const limiter = this.#deps.limiter
    if (!limiter) throw new Error("JCVC cannot limit sessions here")
    if (this.#q)
      await limiter
        .set(this.#job, level)
        .catch((e: Error) => this.#deps.log(`resource limits not changed now: ${e.message}`))
    this.#resources = level
    await this.#deps.audit.record({
      session: this.id,
      event: "resources_changed",
      channel: "desktop",
      tool: "session",
      cwd: this.cwd,
      project: this.project,
      input: { level, ...LEVELS[level] },
      verdict: {
        outcome: "allow",
        ruleId: "resources-changed",
        reason: `Resources for this session set to ${level} from the desktop.`,
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: "",
      },
      latencyMs: 0,
    })
    this.emit("state", this.info())
  }

  /** Only default and plan are ever accepted (invariant 3). */
  async setMode(mode: SessionMode): Promise<void> {
    if (this.#opts.kind === "chat" && mode !== "plan") throw new ChatModeError()
    if (!isAllowedMode(mode))
      throw new SafetyError(
        3,
        `permission mode "${String(mode)}" is not allowed, only default, plan, acceptEdits and auto`,
      )
    await this.#q?.setPermissionMode(mode)
    this.#mode = mode
    this.emit("state", this.info())
  }

  /** Reasoning effort. Applied to the running session as a flag setting that carries only this one key. */
  async setEffort(effort: Effort): Promise<void> {
    await this.#q?.applyFlagSettings({ effortLevel: effort })
    this.#effort = effort
    this.emit("state", this.info())
  }

  /** Extreme approval for this session only. Written to the audit log, because it changes what gets asked. */
  async setExtreme(on: boolean): Promise<void> {
    if (this.#opts.kind === "chat" && on) throw new ChatModeError()
    this.#extreme = on
    await this.#deps.audit.record({
      session: this.id,
      event: "settings_changed",
      channel: "desktop",
      tool: "extreme-approval",
      cwd: this.cwd,
      project: this.project,
      input: { on },
      verdict: {
        outcome: "allow",
        ruleId: on ? "extreme-on" : "extreme-off",
        reason: on
          ? "Extreme approval turned on for this session from the desktop."
          : "Extreme approval turned off for this session from the desktop.",
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: "",
      },
      latencyMs: 0,
    })
    this.emit("state", this.info())
  }

  async setModel(model?: string): Promise<void> {
    await this.#q?.setModel(model)
    this.#model = model
    this.emit("state", this.info())
  }

  get running(): boolean {
    return this.#running
  }

  async close(): Promise<void> {
    this.#deps.broker.cancelSession(this.id, "The session was closed")
    this.#input.end()
    this.#q?.close()
    this.#deps.broker.off("created", this.#onBrokerChange)
    this.#deps.broker.off("resolved", this.#onBrokerChange)
    if (this.#state !== "error") this.#setState("ended")
  }
}

export interface ManagerEvents {
  session: [SessionInfo]
  message: [{ sessionId: string; message: SDKMessage }]
  event: [{ sessionId: string; type: string; data: Record<string, unknown> }]
}

/** Starts, finds and stops sessions. One SDK query() per session. */
/** How long the plan limits are kept before an open session is asked again, and the wait for unfetched numbers. */
const PLAN_FRESH_MS = 60_000
const PLAN_RETRY_MS = 2000

export class SessionManager extends EventEmitter<ManagerEvents> {
  readonly #deps: SessionDeps
  readonly #sessions = new Map<string, Session>()
  readonly #plan = new Map<
    string,
    { at: number; value?: PlanUsage; pending?: Promise<PlanUsage | undefined> }
  >()

  constructor(deps: SessionDeps) {
    super()
    this.#deps = deps
  }

  async start(opts: StartSessionOptions): Promise<Session> {
    if (this.#deps.kill.isEngaged()) throw new KillSwitchEngagedError()
    // Resume starts a conversation with what it last ran with, for anything the screen did not choose (owner, 31 Oct).
    // The mode is checked again with every other option before Claude Code starts (invariant 3).
    if (opts.resume !== undefined && !opts.restore) {
      const was = this.#deps.resumeSettings?.(opts.resume) ?? {}
      const effort = Effort.safeParse(was.effort)
      opts = {
        ...(was.model !== undefined ? { model: was.model } : {}),
        ...(effort.success ? { effort: effort.data } : {}),
        ...(was.mode !== undefined ? { mode: was.mode } : {}),
        ...(was.extreme !== undefined ? { extreme: was.extreme } : {}),
        ...(was.resources !== undefined ? { resources: was.resources } : {}),
        ...opts,
      }
    }
    const config = this.#deps.config()
    // Checked again inside Session.start with the live account. This early check gives a clear message
    // when there is nothing to compare against.
    // Each account has the organisation confirmed for it; an account JCVC does not know never starts.
    const accountId = opts.account ?? MAIN_ACCOUNT
    if (accountId !== MAIN_ACCOUNT && !this.#deps.accounts?.get(accountId))
      throw new OrgGuardError("no-expected-org", "That account is not signed in to JCVC.")
    const monitor =
      accountId === MAIN_ACCOUNT
        ? this.#deps.account
        : (this.#deps.accounts?.monitor(accountId) ?? this.#deps.account)
    const early = checkOrg(
      monitor.last()?.organization ? { organization: monitor.last()?.organization } : undefined,
      accountId === MAIN_ACCOUNT
        ? config.expectedOrg
        : this.#deps.accounts?.get(accountId)?.expectedOrg,
    )
    if (!early.ok && early.code === "no-expected-org")
      throw new OrgGuardError(early.code, early.message)
    // After the checks above, so a refused start leaves nothing behind.
    if (opts.kind === "chat" && opts.restore) {
      // A chat brought back keeps its own folder, and only a folder JCVC made for chats.
      const dir = this.#deps.chatsDir
      if (!dir || !sameFolder(path.dirname(path.resolve(opts.cwd)), dir))
        throw new SessionFolderError("That chat's folder is not one JCVC made for chats.")
      opts = { ...opts, mode: "plan", extreme: false, freshFolder: false }
    } else if (opts.kind === "chat") {
      // The folder the screen sent is ignored: a chat always gets a new one of its own.
      const dir = this.#deps.chatsDir
      if (!dir) throw new SessionFolderError("Chats are not available here.")
      fs.mkdirSync(dir, { recursive: true })
      const name = projectName(opts.title ?? "")
      // Plan mode, whatever was asked: the folder keeps a chat away from your projects, Plan mode keeps it from
      // changing anything at all, including in your workspace folders, which the rules would otherwise let it edit.
      opts = {
        ...opts,
        mode: "plan",
        extreme: false,
        freshFolder: false,
        // Every chat a folder of its own, even when an earlier one with the same name is still empty.
        cwd: freeFolder(path.join(dir, name === "project" ? "chat" : name), false),
      }
    } else if (opts.freshFolder) {
      const root = config.projectsFolder
      if (!root || !sameFolder(path.dirname(path.resolve(opts.cwd)), root))
        throw new SessionFolderError(
          "A new project goes straight into your projects folder. Set it in Settings, then try again.",
        )
      opts = { ...opts, cwd: freeFolder(path.resolve(opts.cwd)) }
    }
    ensureFolder(opts.cwd, this.#deps.log)
    if (opts.freshFolder) await gitInit(opts.cwd, this.#deps.log)
    const session = new Session(this.#deps, opts)
    session.on("state", (info) => this.emit("session", info))
    session.on("message", (message) => this.emit("message", { sessionId: session.id, message }))
    session.on("event", (e) =>
      this.emit("event", { sessionId: session.id, type: e.type, data: e.data }),
    )
    await session.start()
    this.#sessions.set(session.id, session)
    this.emit("session", session.info())
    return session
  }

  get(id: string): Session | undefined {
    return this.#sessions.get(id)
  }

  /** A notify_user from the Companion: shown on the desktop as a session event. The phone path comes later. */
  notify(sessionId: string, text: string): void {
    this.emit("event", { sessionId, type: "notify_user", data: { text } })
  }

  list(): SessionInfo[] {
    return [...this.#sessions.values()].map((s) => s.info())
  }

  /** Tells the window again about every open session with this Claude Code id, after its title or pin changed. */
  announce(sdkSessionId: string): void {
    for (const s of this.#sessions.values()) {
      const info = s.info()
      if (info.sdkSessionId === sdkSessionId) this.emit("session", info)
    }
  }

  /**
   * The account's plan limits, read on one of its open sessions, at most once a minute unless asked fresh. Nothing
   * when the account has no session open, since starting one only to ask would start Claude Code.
   */
  async planUsage(account = MAIN_ACCOUNT, fresh = false): Promise<PlanUsage | undefined> {
    const c = this.#plan.get(account)
    if (c?.pending) return c.pending
    if (c && !fresh && Date.now() - c.at < PLAN_FRESH_MS) return c.value
    const s = [...this.#sessions.values()].find((x) => x.account === account && x.live)
    if (!s) return c?.value
    const pending = s
      .planUsage()
      .catch(() => undefined)
      .then((value) => {
        const kept = value ?? c?.value
        this.#plan.set(account, { at: Date.now(), ...(kept ? { value: kept } : {}) })
        return kept
      })
    this.#plan.set(account, { ...(c ?? { at: 0 }), pending })
    return pending
  }

  /** The kill switch: every turn and every background task stops. */
  async interruptAll(): Promise<void> {
    await Promise.allSettled([...this.#sessions.values()].map((s) => s.stop("kill-switch")))
  }

  /**
   * Ends a session's Claude Code process at once, for a session that does not stop when asked, and starts it again
   * on the same conversation under the same id, so its pane and transcript stay.
   */
  async forceStop(id: string): Promise<Session> {
    const s = this.#sessions.get(id)
    if (!s) throw new Error("That session is not open")
    const again = s.restartOptions()
    const wasRunning = s.running
    const createdAt = s.createdAt
    await s.close()
    this.#sessions.delete(id)
    return await this.start({ ...again, restore: { id, createdAt, wasRunning, forced: true } })
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled([...this.#sessions.values()].map((s) => s.close()))
  }
}
