import crypto from "node:crypto"
import { EventEmitter } from "node:events"
import WebSocket from "ws"
import type { RemoteVia } from "../server.js"
import { checkRootPem, pemSha256, verifies, verifyOptions, type Trust } from "./trust.js"

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
  /** SHA-256 of CNW's leaf certificate, pinned at a pairing made before ADR 0020; used only when there is no trust. */
  certSha256?: string
  /** ADR 0020: CNW's root (or the system's store), against which every connection is verified, chain and address. */
  trust?: Trust
  version: string
  /** Joins the Host as a client; returns the socket-like object the Host sends events to. */
  attach: (socket: VirtualSocket, via: RemoteVia) => void
  log: (line: string) => void
  /** A call to this Host's own API, as the desktop makes it; for CNW's pages. */
  localHttp?: (req: { method: string; path: string; body?: string; user: string; signedIn: boolean }) => Promise<{ status: number; contentType: string; body: Buffer }>
  /** For tests. */
  createSocket?: (url: string, opts: WebSocket.ClientOptions) => WebSocket
}

/**
 * A message longer than this goes to CNW as parts ({ type: "part", id, n, of, data }), put back together there. Shared
 * with CNW's hub (apps/cnw/src/hub.ts, which keeps its own copy of both numbers).
 */
export const PART = 256 * 1024
/** The most one message may be, in parts: a reply over it is answered "too large" instead. */
export const MAX_MESSAGE = 64 * 1024 * 1024

/**
 * The protocol between Codehouse and CNW, raised whenever either side's messages change in a way the other must know
 * (owner, 18 Nov: a stale CNW image lost histories after the sync fix). 1: before this number existed (no parts, no
 * resync); 2: messages in parts and the snapshot on reconnect. Shared with CNW's hub (apps/cnw/src/hub.ts, PROTOCOL).
 */
export const CNW_PROTOCOL = 2

/** How long a computer that refused CNW's certificate waits before it looks again (and tells CNW again). */
export const REFUSED_RETRY_MS = 15 * 60_000

/** What Codehouse signs to tell CNW it refused its certificate. Never the challenge alone, so it cannot sign anyone in. */
export const refusedText = (challenge: string): string => `cnw-refused:${challenge}`

/** Which side needs updating, from the two protocol numbers; a side that sends none is 1. */
export function protocolGap(codehouse: number, cnw: unknown): "cnw" | "codehouse" | undefined {
  const theirs = typeof cnw === "number" && Number.isInteger(cnw) && cnw > 0 ? cnw : 1
  return theirs < codehouse ? "cnw" : theirs > codehouse ? "codehouse" : undefined
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
  /** Why it was refused: CNW does not know this computer (removed), or its certificate changed. */
  refusal: "removed" | "certificate" | undefined
  /** ADR 0020: a leaf-pinned pairing moved to CNW's root; the service keeps it. */
  movedTo: Trust | undefined
  /** Connected, but the two sides speak different versions of the protocol: which one needs updating. */
  needsUpdate: "cnw" | "codehouse" | undefined
  /** Whether CNW's certificate has been checked against the pin on this connection (or there is no pin). */
  #pinned = false
  #pinFailed = false

  constructor(o: ConnectorOptions) {
    super()
    this.#o = o
  }

  start(): void {
    this.#stopped = false
    this.#pinFailed = false
    this.refusal = undefined
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

  /** The trust this connection uses: the pinned root or the system's store, or the old leaf pin. */
  #trust(): Trust | undefined {
    return this.movedTo ?? this.#o.trust ?? (this.#o.certSha256 ? { kind: "leaf", sha256: this.#o.certSha256 } : undefined)
  }

  #set(s: CnwConnector["status"]): void {
    this.status = s
    this.emit("status", s)
  }

  #connect(): void {
    if (this.#stopped) return
    // Refused for its certificate, it stays refused while it looks again: only a connection that verifies ends that.
    if (this.refusal !== "certificate") this.#set("connecting")
    const url = new URL("/agent", this.#o.url)
    url.protocol = url.protocol === "http:" ? "ws:" : "wss:"
    const trust = this.#trust()
    // ADR 0020: with CNW's root (or the system's store) every connection is verified by Node, the chain and the address,
    // before "open"; a certificate that does not verify fails the connection and nothing is sent.
    // A pairing from before (a leaf pin): the certificate is not checked against any authority, so the pin is checked
    // by hand on "upgrade", before "open", and the connection ends there if it differs (#raw waits for it).
    const pin = trust?.kind === "leaf" ? trust.sha256 : undefined
    const opts: WebSocket.ClientOptions = {
      handshakeTimeout: 15_000,
      maxPayload: 4 * 1024 * 1024,
      ...(pin ? { rejectUnauthorized: false } : trust ? verifyOptions(trust) : {}),
    }
    const ws = (this.#o.createSocket ?? ((u, o) => new WebSocket(u, o)))(url.toString(), opts)
    this.#ws = ws
    this.#pinned = !pin
    if (pin)
      ws.on("upgrade", (res: { socket: { getPeerCertificate?: (detailed: boolean) => { raw?: Buffer } } }) => {
        const raw = res.socket.getPeerCertificate?.(false)?.raw
        if (raw && crypto.createHash("sha256").update(raw).digest("hex") === pin) {
          this.#pinned = true
          return
        }
        this.#pinFailed = true
        this.#o.log("neighbourhood watch: its certificate is not the one it had when you paired, so nothing was sent; trust it again or pair it again")
        ws.terminate()
      })
    ws.on("message", (raw: Buffer) => this.#message(raw.toString("utf8")))
    ws.on("close", (code: number, reason: Buffer) => this.#closed(code, reason))
    ws.on("error", (e: NodeJS.ErrnoException) => {
      // A certificate that does not verify against the root (or the system's store), or names another address.
      if (trust && trust.kind !== "leaf" && isCertificateError(e)) {
        this.#pinFailed = true
        this.#o.log(`neighbourhood watch: CNW's certificate changed (${e.code ?? e.message}), so nothing was sent; trust it again or pair it again`)
        return
      }
      this.#o.log(`neighbourhood watch: ${e.message}`)
    })
  }

  /** ADR 0020: the leaf pin moves to CNW's root, once a fresh connection verifies against it. */
  async #moveToRoot(raw: string): Promise<void> {
    const pem = checkRootPem(raw)
    if (typeof pem !== "string") return this.#o.log(`neighbourhood watch: ${pem.error} It stays pinned on its certificate.`)
    const why = await verifies(new URL(this.#o.url), { ca: [pem], rejectUnauthorized: true })
    if (why) return this.#o.log(`neighbourhood watch: its certificate does not check against the root it gave (${why}); it stays pinned on its certificate`)
    this.movedTo = { kind: "root", pem, sha256: pemSha256(pem) }
    this.#o.log("neighbourhood watch: now trusts CNW's root certificate, so its renewed certificates keep connecting")
    this.emit("trust", this.movedTo)
  }

  /**
   * Tells CNW this computer refused its certificate, so its board says so rather than "never connected". Over a
   * connection that is not trusted, so it carries only this computer's id and a signature over "cnw-refused:" and
   * CNW's challenge: it cannot sign anyone in (hello signs the challenge alone), and nothing else is sent.
   */
  #tellRefused(): Promise<void> {
    return new Promise((resolve) => {
      const url = new URL("/agent", this.#o.url)
      url.protocol = url.protocol === "http:" ? "ws:" : "wss:"
      let ws: WebSocket
      try {
        ws = (this.#o.createSocket ?? ((u, o) => new WebSocket(u, o)))(url.toString(), { handshakeTimeout: 15_000, maxPayload: 64 * 1024, rejectUnauthorized: false })
      } catch {
        return resolve()
      }
      const done = () => (clearTimeout(t), ws.terminate(), resolve())
      const t = setTimeout(done, 20_000)
      t.unref?.()
      ws.on("message", (raw: Buffer) => {
        let m: { type?: string; challenge?: unknown }
        try {
          m = JSON.parse(raw.toString("utf8"))
        } catch {
          return done()
        }
        if (m.type !== "challenge" || typeof m.challenge !== "string" || m.challenge.length > 200) return done()
        const key = crypto.createPrivateKey({ key: this.#o.privateKey, format: "der", type: "pkcs8" })
        const signature = crypto.sign(null, Buffer.from(refusedText(m.challenge)), key).toString("base64url")
        ws.send(JSON.stringify({ type: "refused", computer: this.#o.computerId, reason: "certificate", signature }), () => done())
      })
      ws.on("error", () => done())
      ws.on("close", () => done())
    })
  }

  #message(text: string): void {
    let m: { type?: string; challenge?: string; from?: string; signedIn?: boolean; data?: unknown; protocol?: unknown }
    try {
      m = JSON.parse(text)
    } catch {
      return
    }
    if (m.type === "challenge" && typeof m.challenge === "string") {
      const key = crypto.createPrivateKey({ key: this.#o.privateKey, format: "der", type: "pkcs8" })
      const signature = crypto.sign(null, Buffer.from(m.challenge), key).toString("base64url")
      this.#raw({ type: "hello", computer: this.#o.computerId, signature, version: this.#o.version, protocol: CNW_PROTOCOL })
      return
    }
    if (m.type === "welcome") {
      this.#attempt = 0
      this.refusal = undefined
      // ADR 0020: a pairing pinned on its leaf moves to CNW's root while the leaf still matches (this connection was
      // checked against it), once a fresh connection verifies against that root, chain and address.
      const ca = (m as { ca?: unknown }).ca
      if (this.#trust()?.kind === "leaf" && this.#pinned && typeof ca === "string") void this.#moveToRoot(ca)
      // A CNW from before the handshake sends no number: it is older, and says nothing itself, so this side says it.
      const gap = protocolGap(CNW_PROTOCOL, m.protocol)
      if (gap !== this.needsUpdate && gap)
        this.#o.log(
          gap === "cnw"
            ? "neighbourhood watch: it is older than this Codehouse, so long histories may not reach it: CNW needs updating"
            : "neighbourhood watch: it is newer than this Codehouse: Codehouse needs updating",
        )
      this.needsUpdate = gap
      this.#set("connected")
      clearInterval(this.#ping)
      this.#ping = setInterval(() => this.#ws?.ping(), 25_000)
      this.#ping.unref?.()
      return
    }
    const h = m as { type?: string; id?: string; method?: string; path?: string; body?: string; user?: string; signedIn?: boolean }
    if (h.type === "http" && typeof h.id === "string" && typeof h.path === "string" && h.path.startsWith("/api/")) {
      const id = h.id
      const call = this.#o.localHttp
      if (!call) return this.#raw({ type: "http_reply", id, status: 501, contentType: "application/json", body: Buffer.from('{"error":"Not available."}').toString("base64") })
      void call({ method: String(h.method ?? "GET"), path: h.path, ...(h.body !== undefined ? { body: h.body } : {}), user: String(h.user ?? "?"), signedIn: h.signedIn !== false })
        .then((r) => this.#raw({ type: "http_reply", id, status: r.status, contentType: r.contentType, body: r.body.toString("base64") }))
        .catch((e: Error) => this.#raw({ type: "http_reply", id, status: 502, contentType: "application/json", body: Buffer.from(JSON.stringify({ error: e.message })).toString("base64") }))
      return
    }
    if ((m.type === "snapshot" || m.type === "command") && typeof m.from === "string") {
      if (m.type === "snapshot") {
        // A tab opened, or CNW is back after a drop: the user's connection to the Host starts again, and the Host's
        // greeting on it (its whole state, "hello") goes to their tabs, so none shows what it missed.
        const key = `${m.from}\n${m.signedIn !== false}`
        this.#tabs.get(key)?.close()
        this.#tabs.delete(key)
      }
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
    // Never to a server whose certificate has not been checked against the pin.
    const ws = this.#ws
    if (!this.#pinned || ws?.readyState !== WebSocket.OPEN) return
    let text = JSON.stringify(msg)
    if (text.length > MAX_MESSAGE) {
      // Too big even in parts: a reply says so, so the page is not left waiting; anything else is left out.
      const m = msg as { type?: string; to?: string; data?: { cmdId?: string } }
      this.#o.log(`neighbourhood watch: a ${m.type ?? "message"} of ${Math.round(text.length / 1048576)} MB is over the ${MAX_MESSAGE / 1048576} MB limit, so it was not sent`)
      if (m.type !== "reply" || !m.data?.cmdId) return
      text = JSON.stringify({ type: "reply", to: m.to, data: { type: "reply", cmdId: m.data.cmdId, ok: false, error: { code: "too-large", message: "That is too large to send through Neighbourhood Watch." } } })
    }
    if (text.length <= PART) return void ws.send(text)
    // A message over one part goes as parts, in order, which CNW puts back together: no frame nears its 4 MB cap.
    const id = crypto.randomUUID()
    const of = Math.ceil(text.length / PART)
    for (let n = 0; n < of; n++) ws.send(JSON.stringify({ type: "part", id, n, of, data: text.slice(n * PART, (n + 1) * PART) }))
  }

  #closed(code: number, reason?: Buffer): void {
    // Why it closed, so a refusal (1009, too large) or a drop shows in the Host's log.
    if (!this.#stopped) this.#o.log(`neighbourhood watch: closed (${code}${reason?.length ? `, ${reason.toString("utf8").slice(0, 80)}` : ""})`)
    clearInterval(this.#ping)
    for (const t of this.#tabs.values()) t.close()
    this.#tabs.clear()
    if (this.#stopped) return
    if (this.#pinFailed) {
      // A changed certificate: refused, saying why, and CNW is told (signed, nothing else sent). It looks again now and
      // then, so a certificate that comes back (the same root restored) connects again by itself; trusting it again
      // from the desktop, or pairing again, is the way past a real change.
      this.#pinFailed = false
      this.refusal = "certificate"
      this.#set("refused")
      void this.#tellRefused()
      this.#timer = setTimeout(() => this.#connect(), REFUSED_RETRY_MS)
      this.#timer.unref?.()
      return
    }
    if (code === 4401 || code === 4403) {
      this.#o.log(`neighbourhood watch refused this computer (${code}); pair it again`)
      this.refusal = "removed"
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

/** Whether a connection failed for its certificate: not trusted, expired, or for another address. */
export function isCertificateError(e: NodeJS.ErrnoException): boolean {
  return /CERT|SELF_SIGNED|UNABLE_TO|ALTNAME|ERR_TLS_CERT|HOSTNAME|SIGNATURE/i.test(`${e.code ?? ""} ${e.message}`)
}

/** Makes this computer's key pair for pairing: the public half as SPKI DER, the private half as PKCS#8 DER. */
export function newComputerKey(): { publicKey: string; privateKey: Buffer } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
  return {
    publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
    privateKey: privateKey.export({ format: "der", type: "pkcs8" }) as Buffer,
  }
}
