import { TestLockError, type TestLocks } from "./test-locks.js"
import { HeldOutError, type HeldOutChecks } from "./heldout.js"
import { runHeldOutFor } from "./heldout-session.js"
import { sessionDetails } from "./session-details.js"
import { MemoryRefusedError, type MemoryGovernor } from "./memory-governor.js"
import { MAIN_ACCOUNT, type Accounts } from "./accounts.js"
import fs from "node:fs"
import type { SignInFlow } from "./signin.js"
import type net from "node:net"
import path from "node:path"
import fastifyStatic from "@fastify/static"
import websocket from "@fastify/websocket"
import Fastify, { type FastifyInstance } from "fastify"
import type { WebSocket } from "ws"
import { checkRemember, type Policy, type PolicyEngine, type PwshWorker } from "@gatehouse/policy"
import {
  ClientMessage,
  WS_SUBPROTOCOL,
  type ClientCommand,
  type Health,
  type PendingView,
  type Resolution as WireResolution,
  type ServerEvent,
} from "@gatehouse/shared"
import type { AccountMonitor } from "./account.js"
import { registerApi, type AdminContext } from "./api.js"
import type { PhoneService } from "./relay/service.js"
import {
  Broker,
  describeResolution,
  type PendingView as BrokerView,
  type Resolution,
} from "./broker.js"
import type { CheckpointManager } from "./checkpoints.js"
import type { HostAudit } from "./hostaudit.js"
import type { HostKillSwitch } from "./kill.js"
import { SafetyError } from "./safety.js"
import { TerminalError, type TerminalManager } from "./terminal.js"
import type { SessionHistory } from "./history.js"
import { checkHostRequest } from "./server-guard.js"
import {
  KillSwitchEngagedError,
  ChatModeError,
  OrgGuardError,
  SessionFolderError,
  SessionLimitError,
  LockedTestsChangedError,
  ManagedPolicyError,
  type SessionManager,
} from "./sessions.js"
import type { UsageStore } from "./usage.js"

export interface HostApp {
  manager: SessionManager
  /** Your own commands in a session's folder. Absent in tests that do not need it. */
  terminal?: TerminalManager
  broker: Broker
  kill: HostKillSwitch
  checkpoints: CheckpointManager
  usage: UsageStore
  account: AccountMonitor
  /** D-007: the locked tests. Absent where they cannot be kept (tests). */
  locks?: TestLocks
  /** D-002: the sealed held-out checks. Absent where they cannot be kept (tests). */
  heldOut?: HeldOutChecks
  /** C-004: the memory governor, for its status and the idle sessions it offers to suspend. */
  governor?: Pick<MemoryGovernor, "status">
  /** Owner, 9 Nov: whether a limit in Settings would pause an account now (Start now checks it). */
  limits?: { over(account: string): Promise<string | undefined> }
  /** Starts Anthropic's own sign-in. Absent in tests that do not need it. */
  signIn?: SignInFlow
  /** The accounts signed in beside the main one. */
  accounts?: Accounts
  audit: HostAudit
  engine: PolicyEngine
  policy: () => Policy | undefined
  pwsh: PwshWorker | undefined
  health: () => Health
  expectedOrg: () => string | undefined
  /** Policy, audit and settings endpoints for the desktop UI. Absent in tests that do not need them. */
  admin?: AdminContext
  /** Updates to Codehouse itself. Absent in tests that do not need them. */
  updates?: import("./update/service.js").UpdateService
  /** The phone channel. Absent in tests that do not need it. */
  phone?: PhoneService
  /** Restarts Codehouse through the window app. Absent where nothing can restart it (the console launcher, tests). */
  restart?: () => void
  /** Past sessions, your titles, pins and archives, and search. Absent in tests that do not need them. */
  history?: SessionHistory
  /** Past sessions from the SDK. */
  listHistory: (dir?: string) => Promise<unknown>
  log: (line: string) => void
}

export interface HostServerOptions {
  app: HostApp
  /** The per-launch session token the UI must present. */
  token: string
  /** 0 picks a free port (tests). Always bound to 127.0.0.1. */
  port: number
  /** Built UI files. Without it, a short placeholder page is served. */
  staticDir?: string
}

class CommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

function toWire(r: Resolution): WireResolution {
  return {
    outcome: r.outcome,
    channel: r.channel,
    ...(r.message !== undefined ? { message: r.message } : {}),
    at: r.at,
    waitedMs: r.waitedMs,
    summary: describeResolution(r),
  }
}

/**
 * The Host's HTTP and WebSocket server for the desktop UI. It listens on 127.0.0.1 only. Every request
 * passes the guard (Host header, Origin, per-launch token), then the WebSocket carries typed commands in
 * and typed events out. The server holds no logic of its own: each command calls the component that owns it.
 */
export class HostServer {
  readonly #opts: HostServerOptions
  readonly #fastify: FastifyInstance
  readonly #clients = new Set<WebSocket>()
  readonly #rawSockets = new Set<net.Socket>()
  #port = 0
  dropped = 0

  constructor(opts: HostServerOptions) {
    this.#opts = opts
    this.#fastify = Fastify({ logger: false, bodyLimit: 1_048_576, trustProxy: false })
  }

  get port(): number {
    return this.#port
  }

  get clientCount(): number {
    return this.#clients.size
  }

  /** ready states (0 connecting, 1 open, 2 closing, 3 closed) of the sockets the plugin still tracks. */
  get socketStates(): number[] {
    const wss = (this.#fastify as unknown as { websocketServer?: { clients?: Set<WebSocket> } })
      .websocketServer
    return [...(wss?.clients ?? [])].map((c) => c.readyState)
  }

  get address(): string | undefined {
    const a = this.#fastify.server.address()
    return typeof a === "object" && a !== null ? a.address : undefined
  }

  async start(): Promise<number> {
    const app = this.#fastify
    // The port is known only after listen, so the guard reads it from the live address.
    app.addHook("onRequest", async (req, reply) => {
      const result = checkHostRequest(req.raw, { token: this.#opts.token, port: this.#port })
      if (!result.ok)
        return reply
          .code(result.status)
          .header("cache-control", "no-store")
          .send({ error: result.error })
      return undefined
    })
    await app.register(websocket, {
      options: {
        maxPayload: 1 << 20,
        handleProtocols: (protocols: Set<string>) =>
          protocols.has(WS_SUBPROTOCOL) ? WS_SUBPROTOCOL : false,
      },
    })
    app.get("/ws", { websocket: true }, (socket) => this.#onSocket(socket))
    app.get("/api/state", async () => this.#snapshot())
    if (this.#opts.app.admin) registerApi(app, this.#opts.app.admin)

    const dir = this.#opts.staticDir
    if (dir && fs.existsSync(path.join(dir, "index.html"))) {
      // index: false because "/" is declared below, and fastify-static would declare it a second time.
      await app.register(fastifyStatic, { root: dir, wildcard: false, index: false })
      app.get("/", (_req, reply) => reply.sendFile("index.html"))
    } else {
      app.get("/", (_req, reply) =>
        reply
          .type("text/plain; charset=utf-8")
          .send("Codehouse host is running. The interface is served here once it has been built."),
      )
    }
    this.#wireEvents()
    app.server.on("connection", (sock: net.Socket) => {
      this.#rawSockets.add(sock)
      sock.on("close", () => this.#rawSockets.delete(sock))
    })
    await app.listen({ host: "127.0.0.1", port: this.#opts.port })
    this.#port = (app.server.address() as { port: number }).port
    return this.#port
  }

  async close(): Promise<void> {
    // Ask politely, then insist: a client that never answers the close handshake must not hold the Host open.
    // The websocket plugin keeps its own list of sockets, including ones that are part-way through
    // closing, so that list (not ours) is the one to finish off.
    const wss = (this.#fastify as unknown as { websocketServer?: { clients?: Set<WebSocket> } })
      .websocketServer
    const all = (): WebSocket[] => [...new Set([...this.#clients, ...(wss?.clients ?? [])])]
    for (const c of all()) c.close(1001, "host stopping")
    const force = setTimeout(() => {
      for (const c of all()) c.terminate()
      this.#fastify.server.closeAllConnections?.()
      // Sockets of upgrade attempts (including refused ones) are no longer tracked by the HTTP server.
      for (const sock of this.#rawSockets) sock.destroy()
    }, 500)
    try {
      await this.#fastify.close()
    } finally {
      clearTimeout(force)
    }
  }

  // ---- events out ----

  #snapshot(): Extract<ServerEvent, { type: "hello" }> {
    const a = this.#opts.app
    return {
      type: "hello",
      sessions: a.manager.list(),
      pending: a.broker.list().map((v) => v as unknown as PendingView),
      health: a.health(),
      usage: a.usage.snapshot(),
      ...(a.expectedOrg() !== undefined ? { expectedOrg: a.expectedOrg() as string } : {}),
    }
  }

  #send(socket: WebSocket, event: ServerEvent): void {
    if (socket.readyState !== socket.OPEN) return
    // A UI that cannot keep up must not make the Host buffer the transcript without limit.
    if (event.type === "sdk_message" && socket.bufferedAmount > 8_000_000) {
      this.dropped++
      return
    }
    socket.send(JSON.stringify(event))
  }

  #broadcast(event: ServerEvent): void {
    for (const c of this.#clients) this.#send(c, event)
  }

  #wireEvents(): void {
    const a = this.#opts.app
    a.manager.on("session", (info) => this.#broadcast({ type: "session", info }))
    a.manager.on("message", ({ sessionId, message }) =>
      this.#broadcast({ type: "sdk_message", sessionId, message }),
    )
    a.manager.on("event", ({ sessionId, type, data }) =>
      this.#broadcast({ type: "session_event", sessionId, event: type, data }),
    )
    a.broker.on("created", (view: BrokerView) =>
      this.#broadcast({ type: "approval_request", view: view as unknown as PendingView }),
    )
    a.broker.on("resolved", ({ id, sessionId, resolution }) =>
      this.#broadcast({ type: "approval_resolved", id, sessionId, resolution: toWire(resolution) }),
    )
    a.broker.on("phone", ({ id, status }) => this.#broadcast({ type: "phone_status", id, status }))
    a.audit.onRecord = (record) => this.#broadcast({ type: "audit", record })
    a.usage.onChange = (usage) => this.#broadcast({ type: "usage", usage })
    a.kill.on("changed", () => this.#broadcast({ type: "health", health: a.health() }))
    a.phone?.on("health", () => this.#broadcast({ type: "health", health: a.health() }))
    a.updates?.on("status", (update) => this.#broadcast({ type: "update", update }))
    a.terminal?.on(
      "output",
      (e: { sessionId: string; runId: string; stream: "out" | "err"; text: string }) =>
        this.#broadcast({ type: "term_output", ...e }),
    )
    a.terminal?.on(
      "exit",
      (e: { sessionId: string; runId: string; code: number | null; signal?: string }) =>
        this.#broadcast({ type: "term_exit", ...e }),
    )
  }

  /** Called when something outside the server changes health (the Approver restarting, a sign-in check). */
  announceHealth(): void {
    this.#broadcast({ type: "health", health: this.#opts.app.health() })
  }

  #signIn(account?: string): SignInFlow {
    if (account && account !== MAIN_ACCOUNT) {
      const accounts = this.#accounts()
      if (!accounts.get(account))
        throw new CommandError("unknown-account", "There is no such account")
      return accounts.signIn(account)
    }
    const f = this.#opts.app.signIn
    if (!f) throw new CommandError("unavailable", "Signing in from the app is not available here")
    return f
  }

  #accounts(): Accounts {
    const a = this.#opts.app.accounts
    if (!a) throw new CommandError("unavailable", "More accounts are not available here")
    return a
  }

  /** Adding, confirming and removing an account are recorded, as other changes from the desktop are. */
  async #auditAccount(
    event: string,
    input: Record<string, unknown>,
    reason: string,
  ): Promise<void> {
    await this.#opts.app.audit.record({
      session: "desktop",
      event,
      channel: "desktop",
      tool: "accounts",
      input,
      verdict: {
        outcome: "allow",
        ruleId: event.replace(/_/g, "-"),
        reason,
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: "",
      },
      latencyMs: 0,
    })
  }

  /** An undo from the Changes pane, after it was made (a safety checkpoint was saved first). */
  async #auditUndo(
    event: string,
    session: string,
    cwd: string,
    input: Record<string, unknown>,
    reason: string,
  ): Promise<void> {
    await this.#opts.app.audit.record({
      session,
      event,
      channel: "desktop",
      tool: "checkpoint",
      cwd,
      input,
      verdict: {
        outcome: "allow",
        ruleId: event.replace(/_/g, "-"),
        reason,
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: "",
      },
      latencyMs: 0,
    })
  }

  // ---- commands in ----

  #onSocket(socket: WebSocket): void {
    this.#clients.add(socket)
    this.#send(socket, this.#snapshot())
    socket.on("message", (raw: Buffer) => {
      void this.#onMessage(socket, raw.toString("utf8"))
    })
    socket.on("close", () => this.#clients.delete(socket))
    socket.on("error", () => this.#clients.delete(socket))
  }

  async #onMessage(socket: WebSocket, text: string): Promise<void> {
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      this.#send(socket, {
        type: "reply",
        ok: false,
        error: { code: "invalid-json", message: "The message is not valid JSON" },
      })
      return
    }
    const parsed = ClientMessage.safeParse(json)
    const cmdId =
      typeof (json as { cmdId?: unknown } | null)?.cmdId === "string"
        ? (json as { cmdId: string }).cmdId
        : undefined
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      this.#send(socket, {
        type: "reply",
        ...(cmdId ? { cmdId } : {}),
        ok: false,
        error: {
          code: "invalid-command",
          message: `${issue?.path.join(".") || "command"}: ${issue?.message ?? "is not valid"}`,
        },
      })
      return
    }
    try {
      const data = await this.#handle(parsed.data.command)
      this.#send(socket, {
        type: "reply",
        ...(parsed.data.cmdId ? { cmdId: parsed.data.cmdId } : {}),
        ok: true,
        ...(data !== undefined ? { data } : {}),
      })
    } catch (e) {
      const err = e instanceof CommandError ? e : classify(e)
      this.#opts.app.log(`command ${parsed.data.command.type} failed: ${err.code}`)
      this.#send(socket, {
        type: "reply",
        ...(parsed.data.cmdId ? { cmdId: parsed.data.cmdId } : {}),
        ok: false,
        error: { code: err.code, message: err.message },
      })
    }
  }

  #session(id: string) {
    const s = this.#opts.app.manager.get(id)
    if (!s) throw new CommandError("unknown-session", "There is no such session")
    return s
  }

  #history(): SessionHistory {
    const h = this.#opts.app.history
    if (!h) throw new CommandError("unavailable", "Past sessions are not available here")
    return h
  }

  #knownCwd(cwd: string): void {
    const known = this.#opts.app.manager
      .list()
      .some((s) => path.resolve(s.cwd).toLowerCase() === path.resolve(cwd).toLowerCase())
    if (!known) throw new CommandError("unknown-folder", "That folder does not belong to a session")
  }

  async #handle(cmd: ClientCommand): Promise<unknown> {
    const a = this.#opts.app
    switch (cmd.type) {
      case "create_session": {
        const s = await a.manager.start({
          cwd: cmd.cwd,
          ...(cmd.model ? { model: cmd.model } : {}),
          ...(cmd.mode ? { mode: cmd.mode } : {}),
          ...(cmd.effort ? { effort: cmd.effort } : {}),
          ...(cmd.extreme !== undefined ? { extreme: cmd.extreme } : {}),
          ...(cmd.resume ? { resume: cmd.resume } : {}),
          ...(cmd.fork !== undefined ? { fork: cmd.fork } : {}),
          ...(cmd.freshFolder ? { freshFolder: true } : {}),
          ...(cmd.kind ? { kind: cmd.kind } : {}),
          ...(cmd.title ? { title: cmd.title } : {}),
          ...(cmd.chatProject ? { chatProject: cmd.chatProject } : {}),
          ...(cmd.instructions ? { instructions: cmd.instructions } : {}),
          ...(cmd.research ? { research: true } : {}),
          ...(cmd.about ? { aboutId: cmd.about } : {}),
          ...(cmd.account ? { account: cmd.account } : {}),
          ...(cmd.localModel ? { localModel: cmd.localModel } : {}),
          ...(cmd.resumeAt ? { resumeAt: cmd.resumeAt } : {}),
          ...(cmd.replaces ? { replaces: cmd.replaces } : {}),
          ...(cmd.worktree ? { worktree: cmd.worktree } : {}),
        })
        return { sessionId: s.id, info: s.info() }
      }
      case "warm_chat":
        a.manager.warmChat()
        return undefined
      case "pin_counterexample":
        return await this.#session(cmd.sessionId).pinCounterexample(cmd.id)
      case "dismiss_counterexample":
        this.#session(cmd.sessionId).dismissCounterexample(cmd.id)
        return undefined
      case "locks_state": {
        const s = this.#session(cmd.sessionId)
        if (!a.locks) throw new CommandError("unavailable", "Locked tests are not available here")
        return await a.locks.state(s.cwd)
      }
      case "lock_test":
      case "unlock_test":
      case "locks_accept": {
        const l = a.locks
        if (!l) throw new CommandError("unavailable", "Locked tests are not available here")
        const s = cmd.type === "locks_accept" ? undefined : this.#session(cmd.sessionId)
        const cwd = s?.cwd ?? (cmd.type === "locks_accept" ? cmd.cwd : "")
        let paths: string[]
        try {
          if (cmd.type === "lock_test") paths = [await l.lock(cwd, cmd.path)]
          else if (cmd.type === "unlock_test") {
            await l.unlock(cwd, cmd.path)
            paths = [cmd.path]
          } else {
            paths = await l.changedOutside(cwd)
            await l.accept(cwd)
          }
        } catch (e) {
          if (e instanceof TestLockError) throw new CommandError("invalid", e.message)
          throw e
        }
        const event =
          cmd.type === "lock_test" ? "test_locked" : cmd.type === "unlock_test" ? "test_unlocked" : "test_locks_accepted"
        const written = await a.audit.record({
          session: s?.id ?? "desktop",
          event,
          channel: "desktop",
          tool: "locks",
          cwd,
          input: { paths },
          verdict: {
            outcome: "allow",
            ruleId: "locked-test",
            reason:
              event === "test_locked"
                ? "You locked a test: a session changes it only with you."
                : event === "test_unlocked"
                  ? "You unlocked a test."
                  : "You accepted locked tests as they now are, after they changed outside Codehouse.",
            risk: 0,
            decidedBy: "human-desktop",
            policyHash: "",
          },
          latencyMs: 0,
        })
        if (!written) a.log("locks: the change could not be recorded in the audit log")
        return await l.state(cwd)
      }
      case "heldout_list": {
        // The desktop only: this socket is the desktop's, never the phone's or a push channel's.
        const s = this.#session(cmd.sessionId)
        const h = a.heldOut
        if (!h) throw new CommandError("unavailable", "Held-out checks are not available here")
        return { project: s.project, ...(await h.list(s.project)) }
      }
      case "heldout_add":
      case "heldout_remove":
      case "heldout_command": {
        const s = this.#session(cmd.sessionId)
        const h = a.heldOut
        if (!h) throw new CommandError("unavailable", "Held-out checks are not available here")
        try {
          if (cmd.type === "heldout_add") await h.add(s.project, cmd.name, cmd.content)
          else if (cmd.type === "heldout_remove") await h.remove(s.project, cmd.name)
          else await h.setCommand(s.project, cmd.command)
        } catch (e) {
          if (e instanceof HeldOutError) throw new CommandError("invalid", e.message)
          throw e
        }
        // Recorded without the name or the content: that a check was added, removed, or the command changed.
        await a.audit.record({
          session: s.id,
          event: "sealed_check_changed",
          channel: "desktop",
          tool: "heldout",
          cwd: s.cwd,
          project: s.project,
          input: { change: cmd.type.slice("heldout_".length) },
          verdict: {
            outcome: "allow",
            ruleId: "heldout-checks",
            reason: "You changed this project's sealed held-out checks.",
            risk: 0,
            decidedBy: "human-desktop",
            policyHash: "",
          },
          latencyMs: 0,
        })
        return await h.summary(s.project)
      }
      case "heldout_run": {
        const s = this.#session(cmd.sessionId)
        const h = a.heldOut
        if (!h) throw new CommandError("unavailable", "Held-out checks are not available here")
        try {
          return await runHeldOutFor(s, h, a.audit, "you")
        } catch (e) {
          if (e instanceof HeldOutError) throw new CommandError("invalid", e.message)
          throw e
        }
      }
      case "memory_status": {
        const st = (await a.governor?.status()) ?? { over: false }
        return {
          ...st,
          idle: a.manager.idle().map((i) => ({ id: i.id, title: i.title ?? i.project, project: i.project })),
        }
      }
      case "suspend_session": {
        // Recorded before it applies; refused when it cannot be.
        const s = this.#session(cmd.sessionId)
        const written = await a.audit.record({
          session: s.id,
          event: "session_suspended",
          channel: "desktop",
          tool: "session",
          cwd: s.cwd,
          project: s.project,
          input: { why: "memory" },
          verdict: {
            outcome: "allow",
            ruleId: "memory-governor",
            reason: "You suspended this idle session to free memory.",
            risk: 0,
            decidedBy: "human-desktop",
            policyHash: "",
          },
          latencyMs: 0,
        })
        if (!written) throw new CommandError("audit-failure", "It could not be recorded, so it was not suspended")
        a.terminal?.stop(s.id)
        return { info: await a.manager.suspend(s.id) }
      }
      case "close_session":
        a.terminal?.stop(cmd.sessionId)
        // One that could not come back after a restart is only put away.
        if (!a.manager.get(cmd.sessionId) && a.manager.dismiss(cmd.sessionId)) return undefined
        await this.#session(cmd.sessionId).close()
        return undefined
      case "term_run": {
        const t = a.terminal
        if (!t) throw new CommandError("unavailable", "The terminal is not available here")
        const s = this.#session(cmd.sessionId)
        try {
          return await t.run(s.id, s.cwd, cmd.command)
        } catch (e) {
          if (e instanceof TerminalError) throw new CommandError("terminal", e.message)
          throw e
        }
      }
      case "term_stop":
        return { stopped: a.terminal?.stop(cmd.sessionId) ?? false }
      case "prompt":
        this.#session(cmd.sessionId).prompt(cmd.text)
        return undefined
      case "tell": {
        // G18: your message to another session, sent from this one's prompt box. It is yours, so it is a prompt like
        // any other there; the record says where it came from and went, and how long it was, never the words.
        if (cmd.from === cmd.to)
          throw new Error("Use the prompt box itself to talk to this session.")
        const target = this.#session(cmd.to)
        this.#session(cmd.from)
        target.prompt(cmd.text)
        await this.#opts.app.audit.record({
          session: cmd.to,
          event: "message_relayed",
          channel: "desktop",
          tool: "session",
          cwd: target.cwd,
          input: { from: cmd.from, to: cmd.to, chars: cmd.text.length },
          verdict: {
            outcome: "allow",
            ruleId: "message-relayed",
            reason: "You sent a message to this session from another session's prompt box (/tell).",
            risk: 0,
            decidedBy: "human-desktop",
            policyHash: "",
          },
          latencyMs: 0,
        })
        return undefined
      }
      case "review_dismiss": {
        // G16: a finding on a review card you chose not to fix. Recorded (redacted, like every record) before the card
        // lets it go; not recorded, it stays.
        const s = this.#session(cmd.sessionId)
        const recorded = await this.#opts.app.audit.record({
          session: cmd.sessionId,
          event: "review_finding_dismissed",
          channel: "desktop",
          tool: "review",
          cwd: s.cwd,
          input: { file: cmd.file, summary: cmd.summary },
          verdict: {
            outcome: "deny",
            ruleId: "review-dismissed",
            reason: "You dismissed a finding from a review of this session's changes.",
            risk: 0,
            decidedBy: "human-desktop",
            policyHash: "",
          },
          latencyMs: 0,
        })
        if (!recorded) throw new Error("It could not be recorded, so it stays.")
        return undefined
      }
      case "interrupt":
        await this.#session(cmd.sessionId).interrupt()
        return undefined
      case "stop_session":
        await this.#session(cmd.sessionId).stop()
        return undefined
      case "resume_session": {
        // A session a limit paused, started again by you. Owner, 9 Nov: only once no limit in Settings would pause it
        // again; past a limit it takes a bypass, with a time or a most it may spend.
        const s = this.#session(cmd.sessionId)
        const over = await a.limits?.over(s.account)
        if (over)
          throw new Error(`${over} Bypass the limits for this session, with a time or a most it may spend, to keep going.`)
        await s.resume("you")
        return undefined
      }
      case "set_limit_protection":
        // The earlier form, from before 9 Nov: a time only.
        await this.#session(cmd.sessionId).setBypass(
          cmd.offMinutes === null ? null : { minutes: cmd.offMinutes },
        )
        return undefined
      case "set_limit_bypass":
        await this.#session(cmd.sessionId).setBypass(
          cmd.end
            ? null
            : {
                ...(cmd.minutes !== undefined ? { minutes: cmd.minutes } : {}),
                ...(cmd.maxUsd !== undefined ? { maxUsd: cmd.maxUsd } : {}),
              },
        )
        return undefined
      case "set_resources":
        await this.#session(cmd.sessionId).setResources(cmd.level)
        return undefined
      case "force_stop":
        return { info: (await a.manager.forceStop(cmd.sessionId)).info() }
      case "set_mode":
        await this.#session(cmd.sessionId).setMode(cmd.mode)
        return undefined
      case "set_effort":
        await this.#session(cmd.sessionId).setEffort(cmd.effort)
        return undefined
      case "set_goal":
        await this.#session(cmd.sessionId).setGoal(cmd.check ?? undefined)
        return undefined
      case "set_extreme":
        await this.#session(cmd.sessionId).setExtreme(cmd.on)
        return undefined
      case "set_model":
        await this.#session(cmd.sessionId).setModel(cmd.model)
        return undefined
      case "approve": {
        const r = a.broker.resolve(
          cmd.requestId,
          {
            kind: "decision",
            decision: "allow",
            ...(cmd.message !== undefined ? { message: cmd.message } : {}),
            ...(cmd.updatedInput !== undefined ? { updatedInput: cmd.updatedInput } : {}),
            ...(cmd.remember ? { remember: true } : {}),
            ...(cmd.remember && cmd.rememberFor ? { rememberFor: cmd.rememberFor } : {}),
          },
          "desktop",
        )
        return resolveResult(r)
      }
      case "deny":
        return resolveResult(
          a.broker.resolve(
            cmd.requestId,
            {
              kind: "decision",
              decision: "deny",
              ...(cmd.message !== undefined ? { message: cmd.message } : {}),
            },
            "desktop",
          ),
        )
      case "answer":
        return resolveResult(
          a.broker.resolve(cmd.requestId, { kind: "answers", answers: cmd.answers }, "desktop"),
        )
      case "remember_preview": {
        const view = a.broker.get(cmd.requestId)
        if (!view) throw new CommandError("unknown-request", "That request is not waiting any more")
        return await checkRemember(
          a.engine,
          a.policy(),
          { toolName: view.request.toolName, input: view.rawInput },
          { cwd: view.request.cwd },
          a.pwsh,
        )
      }
      case "restart":
        if (!a.restart)
          throw new CommandError(
            "unavailable",
            "Codehouse cannot restart itself from here. Quit it from the tray icon and open it again.",
          )
        a.restart()
        return { restarting: true }
      case "kill":
        return await a.kill.engage("desktop", "Kill switch from the desktop")
      case "rearm":
        return await a.kill.rearm("desktop")
      case "changes": {
        const s = this.#session(cmd.sessionId)
        return await a.checkpoints.changes(s.cwd, s.id, cmd.ref)
      }
      case "change_versions": {
        const s = this.#session(cmd.sessionId)
        return await a.checkpoints.versions(s.cwd, cmd.ref, cmd.path)
      }
      case "undo_files": {
        const s = this.#session(cmd.sessionId)
        if (!cmd.confirm) throw new CommandError("not-confirmed", "Undoing needs your confirmation")
        const done = await a.checkpoints.undoFiles(s.cwd, cmd.ref, cmd.paths, s.id, true)
        await this.#auditUndo(
          "files_undone",
          s.id,
          s.cwd,
          { paths: cmd.paths, ref: cmd.ref },
          "Files were put back as they were at a checkpoint, from the desktop.",
        )
        return done
      }
      case "undo_change": {
        const s = this.#session(cmd.sessionId)
        if (!cmd.confirm) throw new CommandError("not-confirmed", "Undoing needs your confirmation")
        const done = await a.checkpoints.undoChange(s.cwd, {
          ref: cmd.ref,
          path: cmd.path,
          hunk: cmd.hunk,
          afterHash: cmd.afterHash,
          sessionId: s.id,
          confirm: true,
        })
        await this.#auditUndo(
          "change_undone",
          s.id,
          s.cwd,
          { path: cmd.path, hunk: cmd.hunk, ref: cmd.ref },
          "One change in a file was put back as it was at a checkpoint, from the desktop.",
        )
        return done
      }
      case "checkpoint_list":
        this.#knownCwd(cmd.cwd)
        return await a.checkpoints.list(cmd.cwd, cmd.sessionId)
      case "checkpoint_preview":
        this.#knownCwd(cmd.cwd)
        return await a.checkpoints.preview(cmd.cwd, cmd.ref)
      case "checkpoint_restore":
        this.#knownCwd(cmd.cwd)
        if (!cmd.confirm)
          throw new CommandError("not-confirmed", "Restoring needs confirmation after the preview")
        return await a.checkpoints.restore(cmd.cwd, cmd.ref, cmd.sessionId, true)
      case "list_history":
        return await a.listHistory(cmd.dir)
      case "session_meta": {
        const h = this.#history()
        const live = a.manager.list().find((s) => s.sdkSessionId === cmd.sdkSessionId)
        const meta = await h.setMeta(
          cmd.sdkSessionId,
          {
            ...(cmd.title !== undefined ? { title: cmd.title } : {}),
            ...(cmd.pinned !== undefined ? { pinned: cmd.pinned } : {}),
            ...(cmd.archived !== undefined ? { archived: cmd.archived } : {}),
            ...(cmd.group !== undefined ? { group: cmd.group } : {}),
          },
          live?.cwd ?? cmd.cwd,
          a.log,
        )
        a.manager.announce(cmd.sdkSessionId)
        return meta
      }
      case "fallback_used": {
        // B21: only a chat, only to a model you allow on this computer or its gateway; recorded by session and model.
        const from = a.manager.get(cmd.from)?.info()
        if (!from || from.kind !== "chat")
          throw new Error("Only a chat can be carried on with another model.")
        const local = a.admin?.config().providers?.local
        if (!local?.models.some((m) => m.name === cmd.model))
          throw new Error("That model is not one you allow in Settings, Other AI providers.")
        // The same data boundary as Claude or stricter: this computer, or a gateway whose provider keeps nothing or 30
        // days at most. One whose provider's keeping is not known is not offered.
        if (local.kind === "gateway" && local.keeps !== "nothing" && local.keeps !== "30-days")
          throw new Error(
            "That gateway's provider may keep more than Claude does, so a chat is not carried on there.",
          )
        const recorded = await this.#opts.app.audit.record({
          session: cmd.from,
          event: "fallback_used",
          channel: "desktop",
          tool: "fallback",
          input: { from: from.model ?? "default", to: cmd.model, kind: local.kind },
          verdict: {
            outcome: "allow",
            ruleId: "fallback-used",
            reason:
              "You carried a chat on with another model you allow, whose data boundary is the same or stricter.",
            risk: 0,
            decidedBy: "human-desktop",
            policyHash: "",
          },
          latencyMs: 0,
        })
        if (!recorded) throw new Error("It could not be recorded, so the chat was not carried on.")
        return undefined
      }
      case "compare_chosen": {
        // B22: which answer you kept, by session and model, never what was said. The screen closes the rest.
        // G25: or which of several runs of one prompt, each in its own worktree, by session and branch.
        const all = [cmd.kept, ...cmd.others].map((id) => a.manager.get(id)?.info())
        const runs = all.every((s) => s && s.kind !== "chat" && s.worktree)
        if (!runs && all.some((s) => !s || s.kind !== "chat"))
          throw new Error(
            "Only chats started side by side, or runs each in its own worktree, can be compared.",
          )
        const model = (s: (typeof all)[number]) => s?.model ?? "default"
        const which = (s: (typeof all)[number]) => ({
          session: s?.id,
          model: model(s),
          ...(runs ? { branch: s?.worktree?.branch } : {}),
        })
        await this.#opts.app.audit.record({
          session: cmd.kept,
          event: "compare_chosen",
          channel: "desktop",
          tool: "compare",
          input: {
            kept: which(all[0]),
            others: all.slice(1).map(which),
          },
          verdict: {
            outcome: "allow",
            ruleId: "compare-chosen",
            reason: runs
              ? "You kept one of several runs of the same prompt, each in its own worktree."
              : "You kept one of several answers compared side by side.",
            risk: 0,
            decidedBy: "human-desktop",
            policyHash: "",
          },
          latencyMs: 0,
        })
        return undefined
      }
      case "history_messages":
        return cmd.all
          ? await this.#history().allMessages(cmd.sdkSessionId, cmd.cwd)
          : await this.#history().messages(cmd.sdkSessionId, cmd.cwd)
      case "search_history":
        return await this.#history().search(cmd.query)
      case "context_usage":
        return await this.#session(cmd.sessionId).contextUsage()
      case "session_details": {
        const s = this.#session(cmd.sessionId)
        return await sessionDetails(s.cwd, () => s.mcpStatus())
      }
      case "compact":
        this.#session(cmd.sessionId).compact()
        return undefined
      case "signin_start":
        return this.#signIn(cmd.account).start(cmd.method)
      case "signin_status":
        return this.#signIn(cmd.account).status()
      case "signin_cancel":
        return this.#signIn(cmd.account).cancel()
      case "account_add": {
        const added = await this.#accounts().add(cmd.label)
        await this.#auditAccount(
          "account_added",
          { account: added.id, label: added.label },
          `The account ${added.label} was added from the desktop.`,
        )
        this.announceHealth()
        return added
      }
      case "account_confirm_org": {
        const confirmed = await this.#accounts().confirmOrg(cmd.account)
        await this.#auditAccount(
          "account_org_confirmed",
          { account: confirmed.id, organization: confirmed.expectedOrg },
          `The account ${confirmed.label} must belong to ${confirmed.expectedOrg ?? "its organisation"}, as confirmed from the desktop.`,
        )
        this.announceHealth()
        return confirmed
      }
      case "account_remove":
        await this.#accounts().remove(cmd.account)
        await this.#auditAccount(
          "account_removed",
          { account: cmd.account },
          "An account was removed from the desktop.",
        )
        this.announceHealth()
        return undefined
      case "account_private_window":
        this.#accounts().openPrivate(cmd.account)
        return undefined
      case "refresh_account": {
        const snapshot =
          cmd.account && cmd.account !== MAIN_ACCOUNT
            ? await this.#accounts().monitor(cmd.account).refresh()
            : await a.account.refresh()
        // Every open window shows the new result, not only the one that asked.
        this.announceHealth()
        return snapshot
      }
    }
  }
}

function resolveResult(r: ReturnType<Broker["resolve"]>): unknown {
  if (r.ok) return { resolution: toWire(r.resolution) }
  throw new CommandError(
    r.reason === "not-pending" ? "unknown-request" : r.reason,
    r.detail ?? "The answer was not accepted",
  )
}

function classify(e: unknown): CommandError {
  if (e instanceof OrgGuardError) return new CommandError(`org-guard.${e.code}`, e.message)
  if (e instanceof KillSwitchEngagedError) return new CommandError("kill-switch", e.message)
  if (e instanceof SessionFolderError) return new CommandError("folder-missing", e.message)
  if (e instanceof SessionLimitError) return new CommandError("session-limit", e.message)
  if (e instanceof MemoryRefusedError) return new CommandError("memory", e.message)
  if (e instanceof LockedTestsChangedError) return new CommandError("locked-tests", e.message)
  if (e instanceof ManagedPolicyError) return new CommandError("managed-policy", e.message)
  if (e instanceof ChatModeError) return new CommandError("chat-mode", e.message)
  if (e instanceof SafetyError) return new CommandError("safety", e.message)
  return new CommandError("failed", (e as Error).message ?? "The command failed")
}
