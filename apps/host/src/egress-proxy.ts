/**
 * G26 (owner's connector items, 9 Nov), the safe variant: an outgoing-connection proxy on 127.0.0.1 that a session's
 * commands are pointed at (HTTP_PROXY and HTTPS_PROXY), letting through only the hosts on your allow list, by way of
 * an upstream proxy if you name one. Off until you switch it on in Settings. It can only refuse: a host it does not
 * let through is never reached by a tool that honours the proxy settings, and each refusal is audited.
 *
 * What it is not: a wall. A program that ignores the proxy settings, or opens its own sockets, is not stopped by it; a
 * restricted token or an AppContainer would be, and both need more than this laptop allows without an administrator
 * (G26 in docs/plan/backlog.md). Claude Code's own traffic to Anthropic goes round it (NO_PROXY), so a session cannot be
 * cut off from its model by a list.
 *
 * Invariant 7, as a proxy keeps it: it listens on 127.0.0.1 only; each session has its own token, sent as the proxy
 * password (Proxy-Authorization), and a closed session's token stops working; a request with an Origin header (a web
 * page) is refused, and so is any request that is not a CONNECT or a full URL, which is all a page that rebinds a name
 * to 127.0.0.1 can send. Only CONNECT tunnels carry HTTPS: what goes through them is never read.
 */
import crypto from "node:crypto"
import http from "node:http"
import net from "node:net"

/** Claude Code's own hosts, never sent through the proxy (NO_PROXY), with this computer. */
export const DIRECT_HOSTS = ["localhost", "127.0.0.1", "::1", "anthropic.com", ".anthropic.com", "claude.ai", ".claude.ai", "claude.com", ".claude.com"]

export interface EgressSettings {
  egressProxy?: boolean
  /** Hosts let through: "example.com" (that host), "*.example.com" (its subdomains), with ":port" for a port but 80 and 443. */
  allow?: string[]
  /** An upstream proxy, "http://host:port", that every connection let through goes by. No user name or password. */
  upstream?: string
}

export interface Blocked {
  sessionId: string
  host: string
  port: number
  reason: "not-allowed" | "upstream-failed"
}

const norm = (h: string) => h.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "")

/** Whether a host and port are on the allow list. Without a port in the entry, only 80 and 443. */
export function allowed(list: readonly string[], host: string, port: number): boolean {
  const h = norm(host)
  if (!h) return false
  for (const raw of list) {
    const e = raw.trim().toLowerCase()
    if (!e) continue
    // "host", "host:port", or an IPv6 address in brackets, "[::1]" or "[::1]:8080".
    const m = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(e) ?? /^([^:]+)(?::(\d{1,5}))?$/.exec(e)
    const pat = norm(m?.[1] ?? "")
    const p = m?.[2] ? Number(m[2]) : undefined
    if (p !== undefined ? p !== port : port !== 80 && port !== 443) continue
    if (pat.startsWith("*.")) {
      const base = pat.slice(2)
      if (base && h.endsWith(`.${base}`)) return true
    } else if (pat && h === pat) return true
  }
  return false
}

/** An upstream proxy as host and port, or why it cannot be used. Credentials are refused (none is stored or sent). */
export function parseUpstream(u: string | undefined): { host: string; port: number } | { error: string } | undefined {
  if (!u?.trim()) return undefined
  let url: URL
  try {
    url = new URL(u.trim())
  } catch {
    return { error: "The upstream proxy is not a URL such as http://proxy.example:8080." }
  }
  if (url.protocol !== "http:") return { error: "The upstream proxy must be an http:// address." }
  if (url.username || url.password) return { error: "The upstream proxy may not carry a user name or password." }
  return { host: norm(url.hostname), port: Number(url.port || 80) }
}

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex")

export class EgressProxy {
  readonly #settings: () => EgressSettings | undefined
  readonly #onBlocked: (b: Blocked) => void
  readonly #log: (m: string) => void
  /** Each session's token, by its hash, so a token is never kept as it is. */
  readonly #tokens = new Map<string, string>()
  readonly #bySession = new Map<string, string>()
  #server: http.Server | undefined
  #port: number | undefined
  #starting: Promise<number> | undefined

  constructor(o: { settings: () => EgressSettings | undefined; onBlocked?: (b: Blocked) => void; log?: (m: string) => void }) {
    this.#settings = o.settings
    this.#onBlocked = o.onBlocked ?? (() => undefined)
    this.#log = o.log ?? (() => undefined)
  }

  get port(): number | undefined {
    return this.#port
  }

  /** Where it listens, once it does (127.0.0.1, invariant 7). */
  get address(): string | undefined {
    const a = this.#server?.address()
    return a && typeof a === "object" ? a.address : undefined
  }

  /**
   * The variables a session starts with when the proxy is on: the proxy, with this session's own token as its
   * password, and NO_PROXY for Claude Code's own hosts. Undefined when it is off.
   */
  async envFor(sessionId: string): Promise<Record<string, string> | undefined> {
    if (this.#settings()?.egressProxy !== true) return undefined
    const port = await this.#listen()
    this.release(sessionId)
    const token = crypto.randomBytes(24).toString("base64url")
    this.#tokens.set(sha(token), sessionId)
    this.#bySession.set(sessionId, sha(token))
    const url = `http://codehouse:${token}@127.0.0.1:${port}`
    const direct = DIRECT_HOSTS.join(",")
    return { HTTP_PROXY: url, HTTPS_PROXY: url, http_proxy: url, https_proxy: url, NO_PROXY: direct, no_proxy: direct }
  }

  /** A closed session's token stops working. */
  release(sessionId: string): void {
    const h = this.#bySession.get(sessionId)
    if (h) this.#tokens.delete(h)
    this.#bySession.delete(sessionId)
  }

  async stop(): Promise<void> {
    const s = this.#server
    this.#server = undefined
    this.#port = undefined
    this.#starting = undefined
    if (s) await new Promise<void>((res) => s.close(() => res()))
  }

  #listen(): Promise<number> {
    this.#starting ??= new Promise<number>((resolve, reject) => {
      const server = http.createServer((req, res) => this.#request(req, res))
      server.on("connect", (req, socket, head) => this.#connect(req, socket as net.Socket, head))
      server.on("clientError", (_e, socket) => socket.destroy())
      server.once("error", (e) => {
        this.#starting = undefined
        reject(e)
      })
      server.listen(0, "127.0.0.1", () => {
        this.#server = server
        this.#port = (server.address() as net.AddressInfo).port
        this.#log(`egress proxy on 127.0.0.1:${this.#port}`)
        resolve(this.#port)
      })
    })
    return this.#starting
  }

  /** The session a request's token belongs to, or why it is refused (and the status to answer with). */
  #check(req: http.IncomingMessage): { sessionId: string } | { status: number; text: string } {
    if (req.headers.origin !== undefined) return { status: 403, text: "A web page may not use this proxy." }
    const auth = req.headers["proxy-authorization"]
    const m = typeof auth === "string" ? /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(auth.trim()) : null
    const pass = m ? Buffer.from(m[1]!, "base64").toString("utf8").split(":").slice(1).join(":") : ""
    const sessionId = pass ? this.#tokens.get(sha(pass)) : undefined
    if (!sessionId) return { status: 407, text: "This proxy needs a Codehouse session's token." }
    return { sessionId }
  }

  #refuse(socketOrRes: net.Socket | http.ServerResponse, status: number, text: string, extra: Record<string, string> = {}): void {
    if (socketOrRes instanceof http.ServerResponse) {
      socketOrRes.writeHead(status, { "content-type": "text/plain; charset=utf-8", connection: "close", ...extra })
      socketOrRes.end(`${text}\n`)
      return
    }
    const head = Object.entries(extra).map(([k, v]) => `${k}: ${v}\r\n`).join("")
    socketOrRes.end(`HTTP/1.1 ${status} ${http.STATUS_CODES[status] ?? ""}\r\n${head}content-type: text/plain\r\nconnection: close\r\n\r\n${text}\n`)
  }

  #decide(sessionId: string, host: string, port: number): { ok: true; upstream?: { host: string; port: number } } | { ok: false; text: string } {
    const s = this.#settings()
    if (s?.egressProxy !== true) return { ok: false, text: "Codehouse's outgoing-connection proxy is off." }
    if (!allowed(s.allow ?? [], host, port)) {
      this.#onBlocked({ sessionId, host: norm(host), port, reason: "not-allowed" })
      return { ok: false, text: `${norm(host)}:${port} is not on the allow list in Settings, Sandbox.` }
    }
    const up = parseUpstream(s.upstream)
    if (up && "error" in up) {
      this.#onBlocked({ sessionId, host: norm(host), port, reason: "upstream-failed" })
      return { ok: false, text: up.error }
    }
    return up ? { ok: true, upstream: up } : { ok: true }
  }

  /** HTTPS and anything else tunnelled: CONNECT host:port, let through only to an allowed host. */
  #connect(req: http.IncomingMessage, client: net.Socket, head: Buffer): void {
    client.on("error", () => undefined)
    const c = this.#check(req)
    if ("status" in c) return this.#refuse(client, c.status, c.text, c.status === 407 ? { "proxy-authenticate": 'Basic realm="Codehouse"' } : {})
    const m = /^\[?([^\]]+?)\]?:(\d{1,5})$/.exec(req.url ?? "")
    if (!m) return this.#refuse(client, 400, "CONNECT needs host:port.")
    const host = m[1]!
    const port = Number(m[2])
    const d = this.#decide(c.sessionId, host, port)
    if (!d.ok) return this.#refuse(client, 403, d.text)
    const target = net.connect(d.upstream ? { host: d.upstream.host, port: d.upstream.port } : { host, port })
    target.on("error", () => {
      if (d.upstream) this.#onBlocked({ sessionId: c.sessionId, host: norm(host), port, reason: "upstream-failed" })
      this.#refuse(client, 502, "The connection could not be made.")
    })
    const joined = () => {
      if (head.length) target.write(head)
      target.pipe(client)
      client.pipe(target)
    }
    if (!d.upstream) {
      target.once("connect", () => {
        client.write("HTTP/1.1 200 Connection established\r\n\r\n")
        joined()
      })
      return
    }
    // By the upstream proxy: ask it for the same tunnel, and pass its answer on once it says yes.
    target.once("connect", () => target.write(`CONNECT ${host.includes(":") ? `[${host}]` : host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`))
    let buf = Buffer.alloc(0)
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk])
      const end = buf.indexOf("\r\n\r\n")
      if (end < 0) {
        if (buf.length > 16_384) target.destroy()
        return
      }
      target.off("data", onData)
      if (!/^HTTP\/1\.[01] 2\d\d/.test(buf.subarray(0, end).toString("latin1"))) {
        this.#onBlocked({ sessionId: c.sessionId, host: norm(host), port, reason: "upstream-failed" })
        target.destroy()
        return this.#refuse(client, 502, "The upstream proxy refused the connection.")
      }
      client.write("HTTP/1.1 200 Connection established\r\n\r\n")
      const rest = buf.subarray(end + 4)
      if (rest.length) client.write(rest)
      joined()
    }
    target.on("data", onData)
  }

  /** Plain http:// requests in full-URL form, forwarded to an allowed host (or the upstream proxy). */
  #request(req: http.IncomingMessage, res: http.ServerResponse): void {
    const c = this.#check(req)
    if ("status" in c) return this.#refuse(res, c.status, c.text, c.status === 407 ? { "proxy-authenticate": 'Basic realm="Codehouse"' } : {})
    let url: URL
    try {
      url = new URL(req.url ?? "")
    } catch {
      // Not a full URL: a page that rebound a name to 127.0.0.1, or a client that is not using it as a proxy.
      return this.#refuse(res, 400, "This is a proxy: send a full http:// URL, or CONNECT.")
    }
    if (url.protocol !== "http:") return this.#refuse(res, 400, "Only http:// is forwarded; HTTPS goes by CONNECT.")
    const port = Number(url.port || 80)
    const d = this.#decide(c.sessionId, url.hostname, port)
    if (!d.ok) return this.#refuse(res, 403, d.text)
    const headers = { ...req.headers }
    delete headers["proxy-authorization"]
    delete headers["proxy-connection"]
    const out = http.request(
      d.upstream
        ? { host: d.upstream.host, port: d.upstream.port, path: url.href, method: req.method, headers }
        : { host: url.hostname, port, path: `${url.pathname}${url.search}`, method: req.method, headers },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers)
        up.pipe(res)
      },
    )
    out.on("error", () => {
      if (!res.headersSent) this.#refuse(res, 502, "The connection could not be made.")
      else res.destroy()
    })
    req.pipe(out)
  }
}
