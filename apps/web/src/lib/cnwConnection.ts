import type { ClientCommand, ServerEvent } from "@gatehouse/shared/ws-protocol"
import type { ConnState, Reply } from "./connection"

/**
 * O41: the interface served by Codehouse Neighbourhood Watch talks to one computer through CNW, with the same shape as
 * the Host connection: events in, commands out with a reply each. CNW wraps each frame ({ type: "event" | "reply",
 * data }); this unwraps it. Signing in to CNW is the page's cookie, so no token is sent here.
 */
export class CnwConnection {
  #ws: WebSocket | undefined
  #pending = new Map<string, { resolve: (r: Reply) => void; timer: ReturnType<typeof setTimeout> }>()
  #n = 0
  #attempt = 0
  #stopped = false
  #retry: ReturnType<typeof setTimeout> | undefined
  /** Whether the computer itself is connected to CNW now. */
  online = false

  constructor(
    private readonly computer: string,
    private readonly onEvent: (e: ServerEvent) => void,
    private readonly onState: (s: ConnState, attempt: number) => void,
    private readonly url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/${encodeURIComponent(computer)}`,
  ) {}

  start(): void {
    this.#stopped = false
    this.#open()
  }

  stop(): void {
    this.#stopped = true
    clearTimeout(this.#retry)
    this.#ws?.close()
  }

  #open(): void {
    this.onState("connecting", this.#attempt)
    const ws = new WebSocket(this.url)
    this.#ws = ws
    ws.onmessage = (m) => {
      let f: { type?: string; online?: boolean; data?: ServerEvent; why?: string }
      try {
        f = JSON.parse(String(m.data))
      } catch {
        return
      }
      if (f.type === "computer_online") {
        this.online = f.online === true
        this.#attempt = 0
        // Back online is not caught up: the page shows it is reconnecting until the computer's greeting (its whole
        // state) has arrived.
        this.onState("connecting", 0)
        return
      }
      const e = f.data
      if (!e) return
      if (f.type === "event" && e.type === "hello") this.onState("open", 0)
      if (e.type === "reply" && e.cmdId) {
        const p = this.#pending.get(e.cmdId)
        if (p) {
          clearTimeout(p.timer)
          this.#pending.delete(e.cmdId)
          p.resolve({ ok: e.ok, data: e.data, error: e.error })
        }
        return
      }
      if (f.type === "event") this.onEvent(e)
    }
    ws.onclose = (ev) => {
      if (this.#ws !== ws) return
      for (const [id, p] of this.#pending) {
        clearTimeout(p.timer)
        p.resolve({ ok: false, error: { code: "disconnected", message: "The connection to Neighbourhood Watch was lost" } })
        this.#pending.delete(id)
      }
      this.onState("closed", this.#attempt)
      // 4401: not signed in. Back to the sign-in page rather than trying again.
      if (ev.code === 4401) return void location.assign("/")
      if (this.#stopped) return
      const wait = Math.min(15_000, 500 * 2 ** this.#attempt++)
      this.#retry = setTimeout(() => this.#open(), wait)
    }
  }

  send(command: ClientCommand, timeoutMs = 60_000): Promise<Reply> {
    const ws = this.#ws
    if (!ws || ws.readyState !== WebSocket.OPEN || !this.online)
      return Promise.resolve({ ok: false, error: { code: "disconnected", message: "That computer is not connected to Neighbourhood Watch" } })
    const cmdId = `n${++this.#n}`
    return new Promise<Reply>((resolve) => {
      const timer = setTimeout(() => {
        this.#pending.delete(cmdId)
        resolve({ ok: false, error: { code: "timeout", message: "The computer did not answer in time" } })
      }, timeoutMs)
      this.#pending.set(cmdId, { resolve, timer })
      ws.send(JSON.stringify({ cmdId, command }))
    })
  }
}

/** The computer this page shows, in CNW: ?computer=<id>. Undefined outside CNW. */
export function cnwComputer(): string | undefined {
  if (import.meta.env.VITE_CODEHOUSE_REMOTE !== "cnw") return undefined
  return new URLSearchParams(location.search).get("computer") ?? undefined
}
