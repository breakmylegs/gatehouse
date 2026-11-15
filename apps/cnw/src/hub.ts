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
/** Commands one browser may send in a minute. */
export const MAX_COMMANDS_A_MINUTE = 240

export interface Socket {
  send(data: string): void
  close(code?: number, reason?: string): void
}

interface Agent {
  socket: Socket
  computer: Computer
  version?: string
  connectedAt: number
  lastSeen: number
}

interface Watcher {
  socket: Socket
  user: string
  sent: number[]
}

export class Hub {
  readonly #agents = new Map<string, Agent>()
  readonly #watchers = new Map<string, Set<Watcher>>()
  readonly #challenges = new WeakMap<Socket, string>()
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
    let m: { type?: string; computer?: string; signature?: string; version?: string; to?: string; data?: unknown }
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
      this.#agents.set(computer.id, { socket, computer, ...(m.version ? { version: String(m.version).slice(0, 40) } : {}), connectedAt: t, lastSeen: t })
      socket.send(JSON.stringify({ type: "welcome" }))
      this.#broadcast(computer.id, { type: "computer_online", online: true })
      return computer.id
    }
    const [id, agent] = known
    agent.lastSeen = this.#now()
    if (m.type === "event") this.#broadcast(id, { type: "event", data: m.data })
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
        this.#broadcast(id, { type: "computer_online", online: false })
      }
  }

  watch(computerId: string, socket: Socket, user: string): () => void {
    const w: Watcher = { socket, user, sent: [] }
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
    agent.socket.send(JSON.stringify({ type: "command", from: w.user, data }))
    return "sent"
  }

  /** Each paired computer, and whether it is connected now. */
  status(): Array<{ id: string; label: string; online: boolean; version?: string; lastSeen?: number }> {
    return this.computers().map((c) => {
      const a = this.#agents.get(c.id)
      return { id: c.id, label: c.label, online: Boolean(a), ...(a?.version ? { version: a.version } : {}), ...(a ? { lastSeen: a.lastSeen } : {}) }
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
