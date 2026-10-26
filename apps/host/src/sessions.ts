import { EventEmitter } from "node:events"
import path from "node:path"
import type { Options, Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import { findProjectRoot, type Policy, type PwshWorker, type PolicyEngine } from "@gatehouse/policy"
import { sanitiseEnv, uuidv7 } from "@gatehouse/shared"
import type { GatehouseConfig } from "@gatehouse/shared/node"
import { checkOrg, type AccountMonitor, type QueryFn } from "./account.js"
import type { ApproverClient } from "./approver-client.js"
import type { Broker } from "./broker.js"
import { createCanUseTool } from "./canuse.js"
import type { CheckpointManager } from "./checkpoints.js"
import { createEventHook, createFloorHook, createPostToolHook, type SessionHookDeps } from "./hooks.js"
import type { HostAudit } from "./hostaudit.js"
import type { HostKillSwitch } from "./kill.js"
import { assertSafeOptions, isAllowedMode, isShadowWarning, SafetyError, type SessionMode } from "./safety.js"
import type { UsageStore } from "./usage.js"

export class OrgGuardError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
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
  model?: string
  mode: SessionMode
  state: SessionState
  sdkSessionId?: string
  pendingApprovals: number
  createdAt: string
  error?: string
}

export interface SessionEvents {
  message: [SDKMessage]
  state: [SessionInfo]
  event: [{ type: "notification" | "stop" | "subagent_start" | "subagent_stop"; data: Record<string, unknown> }]
}

export interface SessionDeps {
  queryFn: QueryFn
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
  log: (line: string) => void
}

export interface StartSessionOptions {
  cwd: string
  model?: string
  mode?: SessionMode
  resume?: string
  fork?: boolean
}

/** A prompt stream the Host pushes user messages into. It makes interrupt, mode and model changes possible. */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  #items: SDKUserMessage[] = []
  #waiting: ((r: IteratorResult<SDKUserMessage>) => void) | undefined
  #closed = false

  push(text: string): void {
    const msg: SDKUserMessage = { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null }
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
  readonly id = uuidv7()
  readonly cwd: string
  readonly project: string
  readonly createdAt = new Date().toISOString()
  readonly #deps: SessionDeps
  readonly #input = new InputQueue()
  readonly #decided = new Set<string>()
  #q: Query | undefined
  #state: SessionState = "starting"
  #mode: SessionMode
  #model: string | undefined
  #sdkSessionId: string | undefined
  #error: string | undefined
  #running = false
  readonly #opts: StartSessionOptions
  readonly #onBrokerChange: () => void

  constructor(deps: SessionDeps, opts: StartSessionOptions) {
    super()
    this.#deps = deps
    this.#opts = opts
    this.cwd = opts.cwd
    this.project = path.basename(findProjectRoot(opts.cwd))
    this.#mode = opts.mode ?? "default"
    this.#model = opts.model
    this.#onBrokerChange = () => this.#refreshWaiting()
    deps.broker.on("created", this.#onBrokerChange)
    deps.broker.on("resolved", this.#onBrokerChange)
  }

  info(): SessionInfo {
    return {
      id: this.id,
      cwd: this.cwd,
      project: this.project,
      ...(this.#model !== undefined ? { model: this.#model } : {}),
      mode: this.#mode,
      state: this.#state,
      ...(this.#sdkSessionId !== undefined ? { sdkSessionId: this.#sdkSessionId } : {}),
      pendingApprovals: this.#deps.broker.countFor(this.id),
      createdAt: this.createdAt,
      ...(this.#error !== undefined ? { error: this.#error } : {}),
    }
  }

  #setState(state: SessionState): void {
    if (this.#state === state) return
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
      log: d.log,
    }
    const eventHook = createEventHook(hookDeps)
    const postHook = createPostToolHook(hookDeps)
    const options: Options = {
      cwd: this.cwd,
      ...(this.#model !== undefined ? { model: this.#model } : {}),
      permissionMode: this.#mode,
      systemPrompt: { type: "preset", preset: "claude_code", snapshot: true },
      settingSources: ["user", "project", "local"],
      includePartialMessages: true,
      env: sanitiseEnv(process.env),
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
      stderr: (data) => {
        if (isShadowWarning(data)) this.#fatal(new SafetyError(4, "the SDK reported that canUseTool is shadowed"))
      },
      ...(this.#opts.resume !== undefined ? { resume: this.#opts.resume, forkSession: this.#opts.fork === true } : {}),
    }
    assertSafeOptions(options)

    this.#q = d.queryFn({ prompt: this.#input, options })
    try {
      const init = await this.#q.initializationResult()
      const managed = await d.managedDetected().catch(() => undefined)
      const snapshot = d.account.note(init.account, managed)
      if (!snapshot.org.ok) {
        // Invariant 14: nothing is sent to a session on the wrong account.
        throw new OrgGuardError(snapshot.org.code, snapshot.org.message)
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
    if (typeof m.session_id === "string" && this.#sdkSessionId === undefined) {
      this.#sdkSessionId = m.session_id
      this.emit("state", this.info())
    }
    if (msg.type === "system") {
      if (isShadowWarning(JSON.stringify(m))) this.#fatal(new SafetyError(4, "the SDK reported that canUseTool is shadowed"))
      if ((m.subtype as string) === "init" && typeof m.model === "string") this.#model = m.model
    }
    if (msg.type === "result") {
      this.#deps.usage.record(this.id, this.project, m)
      this.#running = false
      this.#setState("idle")
    }
  }

  #fatal(e: Error): void {
    this.#error = e.message
    this.#deps.log(`session ${this.id} stopped: ${e.message}`)
    this.#deps.broker.cancelSession(this.id, "The session stopped with an error")
    this.#setState("error")
    this.#q?.close()
    this.#input.end()
  }

  /** Sends the next user message. Messages sent while a turn runs are queued by the SDK. */
  prompt(text: string): void {
    if (this.#state === "error" || this.#state === "ended") throw new Error(`The session has ${this.#state}`)
    if (this.#deps.kill.isEngaged()) throw new KillSwitchEngagedError()
    this.#running = true
    this.#setState(this.#deps.broker.countFor(this.id) > 0 ? "waiting" : "running")
    this.#input.push(text)
  }

  async interrupt(): Promise<void> {
    this.#deps.broker.cancelSession(this.id)
    await this.#q?.interrupt()
    if (this.#state === "running" || this.#state === "waiting") {
      this.#running = false
      this.#setState("idle")
    }
  }

  /** Only default and plan are ever accepted (invariant 3). */
  async setMode(mode: SessionMode): Promise<void> {
    if (!isAllowedMode(mode)) throw new SafetyError(3, `permission mode "${String(mode)}" is not allowed, only default and plan`)
    await this.#q?.setPermissionMode(mode)
    this.#mode = mode
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
export class SessionManager extends EventEmitter<ManagerEvents> {
  readonly #deps: SessionDeps
  readonly #sessions = new Map<string, Session>()

  constructor(deps: SessionDeps) {
    super()
    this.#deps = deps
  }

  async start(opts: StartSessionOptions): Promise<Session> {
    if (this.#deps.kill.isEngaged()) throw new KillSwitchEngagedError()
    const config = this.#deps.config()
    // Checked again inside Session.start with the live account. This early check gives a clear message
    // when there is nothing to compare against.
    const early = checkOrg(this.#deps.account.last()?.organization ? { organization: this.#deps.account.last()?.organization } : undefined, config.expectedOrg)
    if (!early.ok && early.code === "no-expected-org") throw new OrgGuardError(early.code, early.message)
    const session = new Session(this.#deps, opts)
    session.on("state", (info) => this.emit("session", info))
    session.on("message", (message) => this.emit("message", { sessionId: session.id, message }))
    session.on("event", (e) => this.emit("event", { sessionId: session.id, type: e.type, data: e.data }))
    await session.start()
    this.#sessions.set(session.id, session)
    this.emit("session", session.info())
    return session
  }

  get(id: string): Session | undefined {
    return this.#sessions.get(id)
  }

  list(): SessionInfo[] {
    return [...this.#sessions.values()].map((s) => s.info())
  }

  async interruptAll(): Promise<void> {
    await Promise.allSettled([...this.#sessions.values()].map((s) => s.interrupt()))
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled([...this.#sessions.values()].map((s) => s.close()))
  }
}
