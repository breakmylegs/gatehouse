import crypto from "node:crypto"
import { EventEmitter } from "node:events"
import WebSocket from "ws"
import type { RemoteVia } from "../server.js"

/**
 * O41: Codehouse's side of Neighbourhood Watch. Codehouse opens the connection (wss, port 443), so nothing at your
 * desk needs port forwarding. It proves it is the computer that paired by signing CNW's challenge with its own key,
 * then joins the Host as one more client: the Host's events go to CNW, and CNW's commands come in with who sent
 * them, through the same checks as the desktop (the floor, the policy, the audit log), recorded with the channel cnw.
 * It reconnects with a growing, jittered wait, and stops trying when CNW says the computer is not paired (4401) or
 * was removed (4403). Keep-alives every 25 s keep a home router's NAT from dropping it.
 */
export interface ConnectorOptions {
  /** CNW's address, https://... */
  url: string
  computerId: string
  /** The Ed25519 private key, PKCS#8 DER. */
  privateKey: Buffer
  /** SHA-256 of CNW's certificate, pinned at pairing; a different certificate stops the connection. */
  certSha256?: string
  version: string
  /** Joins the Host as a client; returns the socket-like object the Host sends events to. */
  attach: (socket: VirtualSocket, via: RemoteVia) => void
  log: (line: string) => void
  /** For tests. */
  createSocket?: (url: string, opts: WebSocket.ClientOptions) => WebSocket
}

/** What the Host's server needs from a client socket: send, readyState, OPEN, bufferedAmount, and message and close. */
export class VirtualSocket extends EventEmitter {
  readonly OPEN = 1
  readyState = 1
  bufferedAmount = 0
  constructor(readonly out: (text: string) => void) {
    super()
  }
  send(text: string): void {
    this.out(text)
  }
  close(): void {
    this.readyState = 3
    this.emit("close")
  }
  terminate(): void {
    this.close()
  }
}

export class CnwConnector extends EventEmitter {
  readonly #o: ConnectorOptions
  #ws: WebSocket | undefined
  #tabs = new Map<string, VirtualSocket>()
  #attempt = 0
  #stopped = false
  #timer: NodeJS.Timeout | undefined
  #ping: NodeJS.Timeout | undefined
  status: "off" | "connecting" | "connected" | "refused" = "off"

  constructor(o: ConnectorOptions) {
    super()
    this.#o = o
  }

  start(): void {
    this.#stopped = false
    this.#connect()
  }

  stop(): void {
    this.#stopped = true
    clearTimeout(this.#timer)
    clearInterval(this.#ping)
    for (const t of this.#tabs.values()) t.close()
    this.#tabs.clear()
    this.#ws?.close(1000, "stopped")
    this.#set("off")
  }

  #set(s: CnwConnector["status"]): void {
    this.status = s
    this.emit("status", s)
  }

  #connect(): void {
    if (this.#stopped) return
    this.#set("connecting")
    const url = new URL("/agent", this.#o.url)
    url.protocol = url.protocol === "http:" ? "ws:" : "wss:"
    const opts: WebSocket.ClientOptions = {
      handshakeTimeout: 15_000,
      maxPayload: 4 * 1024 * 1024,
      ...(this.#o.certSha256
        ? {
            checkServerIdentity: (_host: string, cert: { raw?: Buffer }) =>
              cert.raw && crypto.createHash("sha256").update(cert.raw).digest("hex") === this.#o.certSha256
                ? undefined
                : new Error("Neighbourhood Watch's certificate is not the one it had when you paired."),
          }
        : {}),
    }
    const ws = (this.#o.createSocket ?? ((u, o) => new WebSocket(u, o)))(url.toString(), opts)
    this.#ws = ws
    ws.on("message", (raw: Buffer) => this.#message(raw.toString("utf8")))
    ws.on("close", (code: number) => this.#closed(code))
    ws.on("error", (e: Error) => this.#o.log(`neighbourhood watch: ${e.message}`))
  }

  #message(text: string): void {
    let m: { type?: string; challenge?: string; from?: string; signedIn?: boolean; data?: unknown }
    try {
      m = JSON.parse(text)
    } catch {
      return
    }
    if (m.type === "challenge" && typeof m.challenge === "string") {
      const key = crypto.createPrivateKey({ key: this.#o.privateKey, format: "der", type: "pkcs8" })
      const signature = crypto.sign(null, Buffer.from(m.challenge), key).toString("base64url")
      this.#raw({ type: "hello", computer: this.#o.computerId, signature, version: this.#o.version })
      return
    }
    if (m.type === "welcome") {
      this.#attempt = 0
      this.#set("connected")
      clearInterval(this.#ping)
      this.#ping = setInterval(() => this.#ws?.ping(), 25_000)
      this.#ping.unref?.()
      return
    }
    if ((m.type === "snapshot" || m.type === "command") && typeof m.from === "string") {
      const tab = this.#tab(m.from, m.signedIn !== false)
      if (m.type === "command") tab.emit("message", Buffer.from(JSON.stringify(m.data)))
    }
  }

  /** One client in the Host per CNW user, so replies and events reach them; made on first use. */
  #tab(user: string, signedIn: boolean): VirtualSocket {
    const key = `${user}\n${signedIn}`
    let t = this.#tabs.get(key)
    if (!t) {
      t = new VirtualSocket((text) => this.#raw({ type: text.includes('"type":"reply"') ? "reply" : "event", to: user, data: JSON.parse(text) }))
      this.#tabs.set(key, t)
      this.#o.attach(t, { user, signedIn })
    }
    return t
  }

  #raw(msg: unknown): void {
    if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(JSON.stringify(msg))
  }

  #closed(code: number): void {
    clearInterval(this.#ping)
    for (const t of this.#tabs.values()) t.close()
    this.#tabs.clear()
    if (this.#stopped) return
    if (code === 4401 || code === 4403) {
      this.#o.log(`neighbourhood watch refused this computer (${code}); pair it again`)
      this.#set("refused")
      return
    }
    // 1 s, 2 s, 4 s... up to 5 minutes, with up to a third added at random so many computers do not retry together.
    const base = Math.min(300_000, 1000 * 2 ** this.#attempt++)
    const wait = base + Math.random() * base * 0.33
    this.#set("connecting")
    this.#timer = setTimeout(() => this.#connect(), wait)
    this.#timer.unref?.()
  }
}

/** Makes this computer's key pair for pairing: the public half as SPKI DER, the private half as PKCS#8 DER. */
export function newComputerKey(): { publicKey: string; privateKey: Buffer } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
  return {
    publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
    privateKey: privateKey.export({ format: "der", type: "pkcs8" }) as Buffer,
  }
}
