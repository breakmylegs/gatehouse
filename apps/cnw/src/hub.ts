import crypto from "node:crypto"
import type { Computer } from "./pairing.js"
import { verifyChallenge } from "./pairing.js"

/**
 * The hub (O41): each paired computer keeps one connection open to CNW, and each browser tab watching a computer has
 * one too. The hub proves a computer is the one that paired (a fresh challenge, signed with its key), then passes the
 * browser's commands to that computer and the computer's events to every tab watching it. It reads only its own
 * envelope; what is inside is Codehouse's desktop protocol, and every check (the floor, the policy, the audit log)
 * stays on the computer, which records each command as from CNW and from whom.
 */
export const MAX_FRAME = 4 * 1024 * 1024
/**
 * A computer sends a long message (a long session's transcript, a file) as parts of at most PART characters, in order;
 * the hub puts them back together, up to MAX_MESSAGE, and passes on the whole. The same numbers as Codehouse's
 * connector (apps/host/src/cnw/connector.ts).
 */
export const PART = 256 * 1024
export const MAX_MESSAGE = 64 * 1024 * 1024
/**
 * The protocol between Codehouse and CNW: the same number as Codehouse's connector (CNW_PROTOCOL), and the same rule.
 * 1: before the number existed; 2: parts and the snapshot on reconnect. On a mismatch both sides say which one needs
 * updating (owner, 18 Nov), rather than losing what the older one cannot carry.
 */
export const PROTOCOL = 2

/** Which side needs updating, from the two protocol numbers; a side that sends none is 1. */
export function protocolGap(cnw: number, codehouse: unknown): "cnw" | "codehouse" | undefined {
  const theirs = typeof codehouse === "number" && Number.isInteger(codehouse) && codehouse > 0 ? codehouse : 1
  return theirs < cnw ? "codehouse" : theirs > cnw ? "cnw" : undefined
}

/** Messages one computer may have part-sent at once. */
const MAX_ASSEMBLING = 8
/** Commands one browser may send in a minute. */
export const MAX_COMMANDS_A_MINUTE = 240

export interface HttpAnswer {
  status: number
  contentType: string
  body: Buffer
}

export interface Socket {
  send(data: string): void
  close(code?: number, reason?: string): void
}

interface Agent {
  socket: Socket
  computer: Computer
  version?: string
  /** Which side needs updating, when this computer's Codehouse speaks another protocol version. */
  needsUpdate?: "cnw" | "codehouse"
  connectedAt: number
  lastSeen: number
}

interface Watcher {
  socket: Socket
  user: string
  /** Signed in, rather than on an allow-listed network; the computer refuses a Severe approval without it. */
  signedIn: boolean
  sent: number[]
}

export class Hub {
  readonly #agents = new Map<string, Agent>()
  /** Uplift phase 5: each computer's connections and drops, the newest 50, for Server, Health. */
  readonly #history = new Map<string, Array<{ at: number; event: "connected" | "dropped" }>>()
  #note(id: string, event: "connected" | "dropped"): void {
    this.#history.set(id, [...(this.#history.get(id) ?? []), { at: this.#now(), event }].slice(-50))
  }
  history(id: string): Array<{ at: number; event: "connected" | "dropped" }> {
    return [...(this.#history.get(id) ?? [])]
  }
  readonly #watchers = new Map<string, Set<Watcher>>()
  readonly #challenges = new WeakMap<Socket, string>()
  readonly #http = new Map<string, { resolve: (r: HttpAnswer) => void; timer: ReturnType<typeof setTimeout> }>()
  /** Messages arriving in parts, per computer connection: id to the parts so far. */
  readonly #parts = new WeakMap<Socket, Map<string, { of: number; got: string[]; size: number }>>()
  readonly #now: () => number

  constructor(
    readonly computers: () => Computer[],
    now: () => number = Date.now,
  ) {
    this.#now = now
  }

  /** A computer has connected: it is sent a challenge to sign. */
  agentOpened(socket: Socket): void {
    const challenge = crypto.randomBytes(32).toString("base64url")
    this.#challenges.set(socket, challenge)
    socket.send(JSON.stringify({ type: "challenge", challenge }))
  }

  /** A frame from a computer. Returns the computer's id once it has proved itself. */
  agentMessage(socket: Socket, raw: string): string | undefined {
    if (raw.length > MAX_FRAME) return void socket.close(1009, "too large")
    let m: { type?: string; computer?: string; signature?: string; version?: string; protocol?: unknown; to?: string; data?: unknown }
    try {
      m = JSON.parse(raw)
    } catch {
      return void socket.close(1007, "not JSON")
    }
    const known = [...this.#agents.entries()].find(([, a]) => a.socket === socket)
    if (!known) {
      const challenge = this.#challenges.get(socket)
      const computer = this.computers().find((c) => c.id === m.computer)
      if (m.type !== "hello" || !challenge || !computer || typeof m.signature !== "string" || !verifyChallenge(computer, challenge, m.signature)) {
        socket.close(4401, "not paired")
        return undefined
      }
      this.#challenges.delete(socket)
      // A second connection from the same computer replaces the first.
      this.#agents.get(computer.id)?.socket.close(4409, "replaced")
      const t = this.#now()
      // The protocol handshake (owner, 18 Nov): a Codehouse from before it sends no number, and is older.
      const needsUpdate = protocolGap(PROTOCOL, m.protocol)
      this.#agents.set(computer.id, { socket, computer, ...(m.version ? { version: String(m.version).slice(0, 40) } : {}), ...(needsUpdate ? { needsUpdate } : {}), connectedAt: t, lastSeen: t })
      this.#note(computer.id, "connected")
      socket.send(JSON.stringify({ type: "welcome", protocol: PROTOCOL }))
      this.#broadcast(computer.id, { type: "computer_online", online: true })
      // Back after a drop: each tab already open is sent the computer's state afresh, so no view is left stale with
      // whatever it missed in the gap. One snapshot for each user, as watch() asks for one.
      const users = new Set([...(this.#watchers.get(computer.id) ?? [])].map((w) => w.user))
      for (const user of users) socket.send(JSON.stringify({ type: "snapshot", from: user }))
      return computer.id
    }
    const [id, agent] = known
    agent.lastSeen = this.#now()
    if (m.type === "part") {
      const whole = this.#assemble(socket, m as unknown as { id?: unknown; n?: unknown; of?: unknown; data?: unknown })
      if (whole === "refused") return void socket.close(1009, "message too large")
      if (whole === undefined) return id
      // The whole message, handled as if it had come in one frame (its size was checked part by part).
      return this.#handle(socket, id, agent, whole)
    }
    return this.#handle(socket, id, agent, m)
  }

  /**
   * Adds a part; the whole message once its last part is in; "refused" for parts out of order, a message over
   * MAX_MESSAGE, or too many at once.
   */
  #assemble(socket: Socket, p: { id?: unknown; n?: unknown; of?: unknown; data?: unknown }): Record<string, unknown> | "refused" | undefined {
    if (typeof p.id !== "string" || p.id.length > 64 || typeof p.n !== "number" || typeof p.of !== "number" || typeof p.data !== "string") return "refused"
    if (p.of < 1 || p.of > Math.ceil(MAX_MESSAGE / PART) || p.data.length > PART) return "refused"
    const all = this.#parts.get(socket) ?? new Map<string, { of: number; got: string[]; size: number }>()
    this.#parts.set(socket, all)
    let a = all.get(p.id)
    if (!a) {
      if (p.n !== 0 || all.size >= MAX_ASSEMBLING) return "refused"
      a = { of: p.of, got: [], size: 0 }
      all.set(p.id, a)
    }
    if (p.of !== a.of || p.n !== a.got.length) return "refused"
    a.got.push(p.data)
    a.size += p.data.length
    if (a.size > MAX_MESSAGE) return "refused"
    if (a.got.length < a.of) return undefined
    all.delete(p.id)
    try {
      return JSON.parse(a.got.join("")) as Record<string, unknown>
    } catch {
      return "refused"
    }
  }

  #handle(socket: Socket, id: string, _agent: Agent, msg: Record<string, unknown>): string | undefined {
    const m = msg as { type?: string; to?: string; data?: unknown }
    if (m.type === "part") return void socket.close(1007, "a part inside parts")
    // An event the computer addressed to one CNW user (its Host connection for that user: their replies and what it
    // sends them) goes to that user's tabs only; one with no address goes to every tab.
    if (m.type === "event") {
      const text = JSON.stringify({ type: "event", data: m.data })
      for (const w of this.#watchers.get(id) ?? []) if (typeof m.to !== "string" || w.user === m.to) w.socket.send(text)
    }
    if (m.type === "http_reply" && typeof (m as { id?: unknown }).id === "string") {
      const r = m as unknown as { id: string; status: number; contentType?: string; body?: string }
      const p = this.#http.get(r.id)
      if (p) {
        clearTimeout(p.timer)
        this.#http.delete(r.id)
        p.resolve({ status: Number(r.status) || 502, contentType: String(r.contentType ?? "application/json"), body: Buffer.from(String(r.body ?? ""), "base64") })
      }
    }
    // A reply to one tab's command goes to that tab only.
    if (m.type === "reply" && typeof m.to === "string") {
      for (const w of this.#watchers.get(id) ?? []) if (w.user === m.to.split("#")[0]) w.socket.send(JSON.stringify({ type: "reply", to: m.to, data: m.data }))
    }
    return id
  }

  agentClosed(socket: Socket): void {
    for (const [id, a] of this.#agents)
      if (a.socket === socket) {
        this.#agents.delete(id)
        this.#note(id, "dropped")
        this.#broadcast(id, { type: "computer_online", online: false })
      }
  }

  watch(computerId: string, socket: Socket, user: string, signedIn = true): () => void {
    const w: Watcher = { socket, user, signedIn, sent: [] }
    const set = this.#watchers.get(computerId) ?? new Set()
    set.add(w)
    this.#watchers.set(computerId, set)
    socket.send(JSON.stringify({ type: "computer_online", online: this.#agents.has(computerId) }))
    // Ask the computer for its current state, for this tab.
    this.#agents.get(computerId)?.socket.send(JSON.stringify({ type: "snapshot", from: user }))
    return () => set.delete(w)
  }

  /** A command from a browser for its computer, with the user it came from. */
  command(computerId: string, socket: Socket, raw: string): "sent" | "offline" | "refused" {
    const w = [...(this.#watchers.get(computerId) ?? [])].find((x) => x.socket === socket)
    if (!w || raw.length > MAX_FRAME) return "refused"
    const t = this.#now()
    w.sent = w.sent.filter((s) => t - s < 60_000)
    if (w.sent.length >= MAX_COMMANDS_A_MINUTE) return "refused"
    w.sent.push(t)
    let data: unknown
    try {
      data = JSON.parse(raw)
    } catch {
      return "refused"
    }
    const agent = this.#agents.get(computerId)
    if (!agent) return "offline"
    agent.socket.send(JSON.stringify({ type: "command", from: w.user, signedIn: w.signedIn, data }))
    return "sent"
  }

  /**
   * Uplift phase 3: a command CNW's own pages send for a user (an answer from the inbox), as that user's tab would.
   * The computer's floor and policy decide, as for any command, and it records who sent it.
   */
  commandAs(computerId: string, user: string, signedIn: boolean, data: unknown): "sent" | "offline" {
    const agent = this.#agents.get(computerId)
    if (!agent) return "offline"
    agent.socket.send(JSON.stringify({ type: "command", from: user, signedIn, data }))
    return "sent"
  }

  /**
   * A page's call to its computer's own API (files, settings and the rest), passed to the computer and answered by its
   * Host, as at the desk. 60 s at most; the user it came from goes with it.
   */
  http(computerId: string, req: { method: string; path: string; body?: string; user: string; signedIn: boolean }): Promise<HttpAnswer> {
    const agent = this.#agents.get(computerId)
    if (!agent) return Promise.resolve({ status: 503, contentType: "application/json", body: Buffer.from(JSON.stringify({ error: "That computer is not connected." })) })
    const id = crypto.randomUUID()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#http.delete(id)
        resolve({ status: 504, contentType: "application/json", body: Buffer.from(JSON.stringify({ error: "The computer did not answer in time." })) })
      }, 60_000)
      this.#http.set(id, { resolve, timer })
      agent.socket.send(JSON.stringify({ type: "http", id, ...req }))
    })
  }

  /** Each paired computer, and whether it is connected now. */
  status(): Array<{ id: string; label: string; tags?: string[]; online: boolean; version?: string; lastSeen?: number; needsUpdate?: "cnw" | "codehouse" }> {
    return this.computers().map((c) => {
      const a = this.#agents.get(c.id)
      return { id: c.id, label: c.label, ...(c.tags?.length ? { tags: c.tags } : {}), online: Boolean(a), ...(a?.version ? { version: a.version } : {}), ...(a ? { lastSeen: a.lastSeen } : {}), ...(a?.needsUpdate ? { needsUpdate: a.needsUpdate } : {}) }
    })
  }

  /** A removed computer is disconnected at once. */
  forget(computerId: string): void {
    this.#agents.get(computerId)?.socket.close(4403, "removed")
    this.#agents.delete(computerId)
  }

  #broadcast(computerId: string, msg: unknown): void {
    const text = JSON.stringify(msg)
    for (const w of this.#watchers.get(computerId) ?? []) w.socket.send(text)
  }
}
