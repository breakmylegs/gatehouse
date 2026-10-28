import fs from "node:fs"
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
import { checkHostRequest } from "./server-guard.js"
import { KillSwitchEngagedError, OrgGuardError, type SessionManager } from "./sessions.js"
import type { UsageStore } from "./usage.js"

export interface HostApp {
  manager: SessionManager
  broker: Broker
  kill: HostKillSwitch
  checkpoints: CheckpointManager
  usage: UsageStore
  account: AccountMonitor
  audit: HostAudit
  engine: PolicyEngine
  policy: () => Policy | undefined
  pwsh: PwshWorker | undefined
  health: () => Health
  expectedOrg: () => string | undefined
  /** Policy, audit and settings endpoints for the desktop UI. Absent in tests that do not need them. */
  admin?: AdminContext
  /** The phone channel. Absent in tests that do not need it. */
  phone?: PhoneService
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
          .send("Gatehouse host is running. The interface is served here once it has been built."),
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
  }

  /** Called when something outside the server changes health (the Approver restarting, a sign-in check). */
  announceHealth(): void {
    this.#broadcast({ type: "health", health: this.#opts.app.health() })
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
          ...(cmd.resume ? { resume: cmd.resume } : {}),
          ...(cmd.fork !== undefined ? { fork: cmd.fork } : {}),
        })
        return { sessionId: s.id, info: s.info() }
      }
      case "close_session":
        await this.#session(cmd.sessionId).close()
        return undefined
      case "prompt":
        this.#session(cmd.sessionId).prompt(cmd.text)
        return undefined
      case "interrupt":
        await this.#session(cmd.sessionId).interrupt()
        return undefined
      case "set_mode":
        await this.#session(cmd.sessionId).setMode(cmd.mode)
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
      case "kill":
        return await a.kill.engage("desktop", "Kill switch from the desktop")
      case "rearm":
        return await a.kill.rearm("desktop")
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
      case "refresh_account": {
        const snapshot = await a.account.refresh()
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
  if (e instanceof SafetyError) return new CommandError("safety", e.message)
  return new CommandError("failed", (e as Error).message ?? "The command failed")
}
