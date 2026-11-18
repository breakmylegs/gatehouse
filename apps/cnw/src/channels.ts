import crypto from "node:crypto"
import dns from "node:dns"
import net from "node:net"
import tls from "node:tls"

/**
 * Notification channels and rules (owner, 17 Nov; deferred from uplift phase 3): beside Web Push, CNW can tell you by
 * email (SMTP), ntfy, Pushover, Telegram or a webhook that something newly waits. Each channel has its own rule: the
 * lowest risk it tells, the computers it tells about (all, unless chosen) and quiet hours when it waits. A message says
 * the computer, the tool, the project and the risk, never the command (the ntfy rule). Passwords and tokens are kept
 * sealed and never shown again. Set by an owner or admin on the Server page.
 *
 * A channel posts only where its owner points it, and never into CNW's own network: the updater, the Docker socket
 * proxy, caddy, CNW itself, their addresses, and this machine are refused, so no channel can be turned on them.
 */
export const CHANNEL_KINDS = ["email", "ntfy", "pushover", "telegram", "webhook"] as const
export type ChannelKind = (typeof CHANNEL_KINDS)[number]

export interface Rule {
  /** The lowest risk told: 0 for everything, 70 for High and Severe. */
  minRisk: number
  /** The computers told about; absent for all. */
  computers?: string[]
  /** Quiet hours, local time "22:00" to "07:00"; absent for none. */
  quiet?: { from: string; to: string }
}

export interface Channel {
  id: string
  kind: ChannelKind
  on: boolean
  rule: Rule
  /** What is not secret (an address, a host, a chat id). */
  config: Record<string, string>
  /** The sealed secret (a password, a token), when it has one. */
  sealedSecret?: string
}

/** CNW's own services and this machine: no channel may point at them. */
const INTERNAL_NAMES = new Set(["updater", "docker-proxy", "caddy", "cnw", "cnw-config", "localhost"])

export function internalHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "")
  if (INTERNAL_NAMES.has(h) || h.endsWith(".localhost")) return true
  if (net.isIPv4(h)) {
    const [a, b, c] = h.split(".").map(Number) as [number, number, number]
    // This machine, link-local, and the stack's own network (172.30.0.0/24, docker/cnw/compose.yml).
    return a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b === 30 && c === 0)
  }
  if (net.isIPv6(h)) return h === "::1" || h === "::" || h.startsWith("fe80:") || h.startsWith("::ffff:127.")
  return false
}

/** An https address a channel may post to: a plain https address, not into CNW's own network. */
export function checkUrl(raw: string, what: string): string | URL {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return `${what} is not an address.`
  }
  if (u.protocol !== "https:" || u.username || u.password) return `${what} must be a plain https address.`
  if (internalHost(u.hostname)) return `${what} points into Neighbourhood Watch's own network, which no channel may reach.`
  return u
}

/**
 * A name is looked up before CNW connects: a public name that points into CNW's own network (or this machine) is refused
 * too, not only the address typed.
 */
export async function assertOutside(host: string, lookup: (h: string) => Promise<Array<{ address: string }>> = (h) => dns.promises.lookup(h, { all: true })): Promise<void> {
  if (internalHost(host)) throw new Error("That address is inside Neighbourhood Watch's own network.")
  if (net.isIP(host.replace(/^[|]$/g, ""))) return
  const all = await lookup(host)
  if (all.some((a) => internalHost(a.address))) throw new Error(`${host} points into Neighbourhood Watch's own network, so nothing was sent.`)
}

/** Whether a rule tells about this request now. */
export function ruleAllows(rule: Rule, w: { computer: string; risk: number }, now: Date): boolean {
  if (w.risk < rule.minRisk) return false
  if (rule.computers && !rule.computers.includes(w.computer)) return false
  if (rule.quiet) {
    const min = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
    const m = now.getHours() * 60 + now.getMinutes()
    const from = min(rule.quiet.from)
    const to = min(rule.quiet.to)
    const inside = from <= to ? m >= from && m < to : m >= from || m < to
    if (inside) return false
  }
  return true
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/** A rule as typed, checked. */
export function checkRule(r: unknown): Rule | string {
  const o = (r && typeof r === "object" ? r : {}) as { minRisk?: unknown; computers?: unknown; quiet?: { from?: unknown; to?: unknown } | null }
  const minRisk = o.minRisk === 70 ? 70 : o.minRisk === 85 ? 85 : 0
  const computers = Array.isArray(o.computers) ? o.computers.filter((c): c is string => typeof c === "string").slice(0, 100) : undefined
  let quiet: Rule["quiet"]
  if (o.quiet) {
    const from = String(o.quiet.from ?? "")
    const to = String(o.quiet.to ?? "")
    if (!TIME.test(from) || !TIME.test(to)) return "Quiet hours are two times such as 22:00 and 07:00."
    quiet = { from, to }
  }
  return { minRisk, ...(computers && computers.length ? { computers } : {}), ...(quiet ? { quiet } : {}) }
}

/** What each kind needs, checked; the secret is returned apart, to be sealed. */
export function checkChannel(kind: ChannelKind, c: Record<string, unknown>): { config: Record<string, string>; secret?: string } | string {
  const t = (k: string, max = 300) => (typeof c[k] === "string" ? (c[k] as string).trim().slice(0, max) : "")
  const secret = t("secret", 500) || undefined
  if (kind === "email") {
    const host = t("host", 253)
    const port = t("port", 5) || "587"
    if (!host || internalHost(host)) return "An SMTP server outside Neighbourhood Watch's own network."
    if (!/^\d{1,5}$/.test(port)) return "The SMTP port is a number, such as 587 or 465."
    const from = t("from", 254)
    const to = t("to", 254)
    const email = /^[^\s@<>]{1,64}@[^\s@<>.]+(\.[^\s@<>.]+)+$/
    if (!email.test(from) || !email.test(to)) return "The email it comes from and goes to."
    return { config: { host, port, user: t("user", 254), from, to, tls: port === "465" ? "implicit" : "starttls" }, ...(secret ? { secret } : {}) }
  }
  if (kind === "ntfy" || kind === "webhook") {
    const u = checkUrl(t("url", 1000), kind === "ntfy" ? "The ntfy topic's address" : "The webhook's address")
    if (typeof u === "string") return u
    return { config: { url: u.toString() }, ...(secret ? { secret } : {}) }
  }
  if (kind === "pushover") {
    const user = t("user", 60)
    if (!/^[A-Za-z0-9]{20,40}$/.test(user)) return "Your Pushover user key."
    if (!secret) return "The Pushover application token."
    return { config: { user }, secret }
  }
  const chat = t("chat", 40)
  if (!/^-?\d{1,20}$|^@[A-Za-z0-9_]{5,32}$/.test(chat)) return "The Telegram chat id (a number) or @channel."
  if (!secret) return "The Telegram bot token."
  return { config: { chat }, secret }
}

export interface Message {
  title: string
  body: string
  /** Where the message opens, on CNW's own page. */
  url: string
}

type Post = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ status: number }>
const defaultPost: Post = async (url, init) => {
  await assertOutside(new URL(url).hostname)
  return fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15_000) })
}

/** Sends one message through one channel. Throws with a plain reason when it could not. */
export async function sendTo(ch: Channel, secret: string | undefined, m: Message, deps: { post?: Post; smtp?: typeof sendMail } = {}): Promise<void> {
  const post = deps.post ?? defaultPost
  const ok = (r: { status: number }, what: string) => {
    if (r.status < 200 || r.status >= 300) throw new Error(`${what} answered ${r.status}.`)
  }
  if (ch.kind === "ntfy") {
    const u = checkUrl(ch.config.url!, "The ntfy address")
    if (typeof u === "string") throw new Error(u)
    return ok(await post(u.toString(), { method: "POST", headers: { Title: m.title, Click: m.url, Priority: "high", ...(secret ? { Authorization: `Bearer ${secret}` } : {}) }, body: m.body }), "ntfy")
  }
  if (ch.kind === "pushover")
    return ok(await post("https://api.pushover.net/1/messages.json", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: secret, user: ch.config.user, title: m.title, message: m.body, url: m.url }) }), "Pushover")
  if (ch.kind === "telegram")
    return ok(
      await post(`https://api.telegram.org/bot${encodeURIComponent(secret ?? "")}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: ch.config.chat, text: `${m.title}\n${m.body}\n${m.url}`, disable_web_page_preview: true }) }),
      "Telegram",
    )
  if (ch.kind === "webhook") {
    const u = checkUrl(ch.config.url!, "The webhook's address")
    if (typeof u === "string") throw new Error(u)
    const body = JSON.stringify({ title: m.title, body: m.body, url: m.url, at: new Date().toISOString() })
    // Signed with its secret, so the receiver knows it is from this CNW.
    const sig = secret ? crypto.createHmac("sha256", secret).update(body).digest("hex") : undefined
    return ok(await post(u.toString(), { method: "POST", headers: { "content-type": "application/json", ...(sig ? { "X-CNW-Signature": `sha256=${sig}` } : {}) }, body }), "The webhook")
  }
  return (deps.smtp ?? sendMail)({ host: ch.config.host!, port: Number(ch.config.port), tls: ch.config.tls === "implicit" ? "implicit" : "starttls", user: ch.config.user || undefined, pass: secret, from: ch.config.from!, to: ch.config.to! }, m.title, `${m.body}\n\n${m.url}\n`)
}

/**
 * A small SMTP client on Node's own net and tls (no new dependency): EHLO, STARTTLS (or TLS from the start on 465),
 * AUTH PLAIN when a user is set, then one plain-text message. It never sends a password before TLS is up, and checks
 * the server's certificate.
 */
export async function sendMail(
  o: { host: string; port: number; tls: "starttls" | "implicit"; user?: string; pass?: string; from: string; to: string; connect?: (opts: { host: string; port: number; tls: boolean; socket?: net.Socket }) => net.Socket; lookup?: (h: string) => Promise<Array<{ address: string }>> },
  subject: string,
  text: string,
): Promise<void> {
  await assertOutside(o.host, o.lookup)
  const open = o.connect ?? ((x) => (x.tls ? tls.connect({ host: x.host, port: x.port, servername: x.host, ...(x.socket ? { socket: x.socket } : {}) }) : net.connect({ host: x.host, port: x.port })))
  let sock = open({ host: o.host, port: o.port, tls: o.tls === "implicit" })
  sock.setTimeout?.(20_000)
  let buf = ""
  let waiting: ((line: string) => void) | undefined
  const attach = (s: net.Socket) =>
    s.on("data", (d: Buffer) => {
      buf += d.toString("utf8")
      // A reply ends with a line whose fourth character is a space ("250 ok"), after any "250-" lines.
      const m = /(^|\r\n)(\d{3}) [^\r\n]*\r\n$/.exec(buf)
      if (m && waiting) {
        const w = waiting
        waiting = undefined
        const all = buf
        buf = ""
        w(all)
      }
    })
  attach(sock)
  const reply = () => new Promise<string>((resolve, reject) => {
    waiting = resolve
    sock.once("error", reject)
    sock.once("timeout", () => reject(new Error("The SMTP server did not answer in time.")))
  })
  const expect = async (code: string, what: string) => {
    const r = await reply()
    const last = r.trimEnd().split("\r\n").at(-1) ?? ""
    if (!last.startsWith(code)) throw new Error(`The SMTP server refused ${what}: ${last.slice(0, 200)}`)
    return r
  }
  const say = (line: string) => sock.write(`${line}\r\n`)
  try {
    await expect("220", "the connection")
    say("EHLO neighbourhood-watch")
    const ehlo = await expect("250", "EHLO")
    if (o.tls === "starttls") {
      if (!/STARTTLS/i.test(ehlo)) throw new Error("The SMTP server does not offer STARTTLS, so nothing was sent.")
      say("STARTTLS")
      await expect("220", "STARTTLS")
      sock.removeAllListeners("data")
      sock = open({ host: o.host, port: o.port, tls: true, socket: sock })
      attach(sock)
      await new Promise<void>((resolve, reject) => {
        sock.once("secureConnect", () => resolve())
        sock.once("error", reject)
      })
      say("EHLO neighbourhood-watch")
      await expect("250", "EHLO after STARTTLS")
    }
    if (o.user) {
      say(`AUTH PLAIN ${Buffer.from(`\0${o.user}\0${o.pass ?? ""}`).toString("base64")}`)
      await expect("235", "the sign-in")
    }
    say(`MAIL FROM:<${o.from}>`)
    await expect("250", "the sender")
    say(`RCPT TO:<${o.to}>`)
    await expect("25", "the recipient")
    say("DATA")
    await expect("354", "the message")
    const safe = (s: string) => s.replace(/[\r\n]+/g, " ").slice(0, 200)
    const body = text.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..")
    say(`From: Neighbourhood Watch <${o.from}>\r\nTo: <${o.to}>\r\nSubject: ${safe(subject)}\r\nDate: ${new Date().toUTCString()}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n.`)
    await expect("250", "the message")
    say("QUIT")
  } finally {
    sock.end()
  }
}
