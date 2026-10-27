import { WS_SUBPROTOCOL, WS_TOKEN_PREFIX } from "@gatehouse/shared/ws-protocol"
import type { ClientCommand, ServerEvent } from "@gatehouse/shared/ws-protocol"

export type ConnState = "connecting" | "open" | "closed"

export interface Reply {
  ok: boolean
  data?: unknown
  error?: { code: string; message: string }
}

type Pending = { resolve: (r: Reply) => void; timer: ReturnType<typeof setTimeout> }

/**
 * The one WebSocket to the Host. It reconnects with back-off, never sends anything it cannot
 * match to a reply, and gives every command a time limit so the UI cannot wait for ever.
 */
export class Connection {
  #ws: WebSocket | undefined
  #pending = new Map<string, Pending>()
  #n = 0
  #attempt = 0
  #stopped = false
  #retry: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly token: string,
    private readonly onEvent: (e: ServerEvent) => void,
    private readonly onState: (s: ConnState, attempt: number) => void,
    private readonly url = `ws://${location.host}/ws`,
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
    const ws = new WebSocket(this.url, [WS_SUBPROTOCOL, WS_TOKEN_PREFIX + this.token])
    this.#ws = ws
    ws.onopen = () => {
      this.#attempt = 0
      this.onState("open", 0)
    }
    ws.onmessage = (m) => {
      let e: ServerEvent
      try {
        e = JSON.parse(String(m.data)) as ServerEvent
      } catch {
        return
      }
      if (e.type === "reply" && e.cmdId) {
        const p = this.#pending.get(e.cmdId)
        if (p) {
          clearTimeout(p.timer)
          this.#pending.delete(e.cmdId)
          p.resolve({ ok: e.ok, data: e.data, error: e.error })
        }
        return
      }
      this.onEvent(e)
    }
    ws.onclose = () => {
      if (this.#ws !== ws) return
      for (const [id, p] of this.#pending) {
        clearTimeout(p.timer)
        p.resolve({ ok: false, error: { code: "disconnected", message: "The connection to the Host was lost" } })
        this.#pending.delete(id)
      }
      this.onState("closed", this.#attempt)
      if (this.#stopped) return
      const wait = Math.min(15_000, 500 * 2 ** this.#attempt++)
      this.#retry = setTimeout(() => this.#open(), wait)
    }
  }

  send(command: ClientCommand, timeoutMs = 60_000): Promise<Reply> {
    const ws = this.#ws
    if (!ws || ws.readyState !== WebSocket.OPEN)
      return Promise.resolve({
        ok: false,
        error: { code: "disconnected", message: "Not connected to the Host" },
      })
    const cmdId = `c${++this.#n}`
    return new Promise<Reply>((resolve) => {
      const timer = setTimeout(() => {
        this.#pending.delete(cmdId)
        resolve({ ok: false, error: { code: "timeout", message: "The Host did not answer in time" } })
      }, timeoutMs)
      this.#pending.set(cmdId, { resolve, timer })
      ws.send(JSON.stringify({ cmdId, command }))
    })
  }
}

/** Reads the per-launch token from the address fragment, keeps it for this tab only, and removes it from the address bar. */
export function takeToken(): string | undefined {
  const m = /(?:^|[#&])token=([A-Za-z0-9_-]+)/.exec(location.hash)
  if (m?.[1]) {
    sessionStorage.setItem("gatehouse.token", m[1])
    history.replaceState(null, "", location.pathname + location.search)
    return m[1]
  }
  return sessionStorage.getItem("gatehouse.token") ?? undefined
}
