import { randomInt } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import type { PendingView } from "@gatehouse/shared"
import type { Broker } from "../broker.js"
import type { Protector } from "../relay/protector.js"
import { PushCodes, riskBand, SEVERE, summarise } from "./codes.js"

export { summarise } from "./codes.js"

/**
 * Push notifications through ntfy, with answers coming back over a connection this computer opens. Nothing has to
 * reach in: Codehouse publishes to a topic, your phone's ntfy app shows Approve and Deny buttons, a tap posts a one-time
 * code to a reply topic, and Codehouse is already listening to that topic over its own outbound stream.
 *
 * What protects an answer, since ntfy cannot sign one the way the phone app's passkey does:
 *  - each request gets its own random allow and deny codes, kept here only as hashes;
 *  - a code works once, for that request only, and expires with the phone window;
 *  - allow is refused above the risk limit you set, and never offered for Severe (85 and over);
 *  - the notification carries a short redacted summary, never secrets (the owner chose this on 28 Oct);
 *  - answers are recorded in the audit log with the channel "push".
 */
export interface NtfySettings {
  enabled: boolean
  server: string
  topic: string
  replyTopic: string
  /** Highest risk that can be approved from a notification. Capped at 84. */
  maxRisk: number
  /**
   * A server that needs a sign-in (owner, 4 Nov: a user's own ntfy server asks for one): an access token, or a user
   * name and password. Only which kind and the user name are kept here; the token or password is sealed apart.
   */
  auth?: "token" | "basic"
  user?: string
}

export interface NtfyStatus {
  enabled: boolean
  listening: boolean
  server?: string
  topic?: string
  maxRisk?: number
  /** How Codehouse signs in to the server, and as whom; never the token or password. */
  auth?: "token" | "basic"
  user?: string
  /** The sign-in is set but its token or password is not there (or cannot be opened). */
  missingSecret?: boolean
  lastError?: string
  sent: number
  /**
   * The topic was made before 29 Oct, with capitals and letters that are easy to mix up. It still works; the panel
   * offers a new one, and only you replace it, because the phone has to subscribe again.
   */
  oldStyle?: boolean
}

export interface NtfyDeps {
  broker: Broker
  settings: () => NtfySettings | undefined
  /** Redaction for anything that leaves the computer (invariant 12). */
  redact: (text: string) => string
  /** How long a code stays valid, the same as the phone window. */
  expiryMs: () => number
  /** Records refused answers. */
  onRefused: (reason: string, requestId?: string) => void
  log: (line: string) => void
  fetchImpl?: typeof fetch
  now?: () => number
  /** Called when it is switched on or off, or starts or stops listening: for the line in the sidebar. */
  onChange?: () => void
  /** The token or password for a server that needs a sign-in, from its sealed store. */
  secret?: () => Promise<string | undefined>
}

/**
 * The token or password for an ntfy server that needs a sign-in, kept as Slack's tokens are: sealed for this Windows
 * user (DPAPI), in its own file, never in the settings, the log or the audit.
 */
export class NtfySecretStore {
  readonly #file: string
  readonly #protector: Protector

  constructor(file: string, protector: Protector) {
    this.#file = file
    this.#protector = protector
  }

  has(): boolean {
    return fs.existsSync(this.#file)
  }

  async load(): Promise<string | undefined> {
    if (!fs.existsSync(this.#file)) return undefined
    try {
      const plain = await this.#protector.unprotect(new Uint8Array(fs.readFileSync(this.#file)))
      const v = JSON.parse(Buffer.from(plain).toString("utf8")) as { secret?: unknown }
      return typeof v.secret === "string" && v.secret ? v.secret : undefined
    } catch {
      return undefined
    }
  }

  async save(secret: string): Promise<void> {
    const sealed = await this.#protector.protect(Buffer.from(JSON.stringify({ secret }), "utf8"))
    fs.mkdirSync(path.dirname(this.#file), { recursive: true })
    const tmp = this.#file + ".tmp"
    fs.writeFileSync(tmp, sealed)
    fs.renameSync(tmp, this.#file)
  }

  forget(): void {
    fs.rmSync(this.#file, { force: true })
  }
}

/**
 * The Authorization header for a server that needs a sign-in: Bearer for an access token, Basic for a user name and
 * password. Nothing for a server that needs none. Throws when a sign-in is set but its secret is missing, so nothing
 * is sent without it.
 */
export async function ntfyAuthHeader(
  s: Pick<NtfySettings, "auth" | "user">,
  secret: (() => Promise<string | undefined>) | undefined,
): Promise<Record<string, string>> {
  if (!s.auth) return {}
  const value = await secret?.()
  if (!value)
    throw new Error(
      "the sign-in for this ntfy server is missing: give it again in Phone and notifications",
    )
  if (s.auth === "token") return { Authorization: `Bearer ${value}` }
  return {
    Authorization: `Basic ${Buffer.from(`${s.user ?? ""}:${value}`, "utf8").toString("base64")}`,
  }
}

const REPLY = /^(allow|deny) ([0-9a-f-]{36}) ([A-Za-z0-9_-]{22,64})$/

/** Letters and digits that cannot be mistaken for each other when typed into a phone: no 0 o, 1 l i. */
export const TOPIC_LETTERS = "abcdefghjkmnpqrstuvwxyz23456789"

/** A private topic: "codeh-" and five groups of four, about 99 bits, easy to read and to type. */
export function randomTopic(): string {
  const group = () =>
    Array.from({ length: 4 }, () => TOPIC_LETTERS[randomInt(TOPIC_LETTERS.length)]).join("")
  return `codeh-${Array.from({ length: 5 }, group).join("-")}`
}

/**
 * A topic Codehouse makes: all lower case, none of 0 o 1 l i (owner, 30 Oct). ntfy treats O, o and 0 as different
 * topics, so the mixed-case topics made before 29 Oct often reached a different topic from the one on the phone.
 */
// Any short lower-case prefix: the twenty random letters are what make a topic private, so a phone already
// subscribed to a topic made under an earlier prefix keeps working.
const OWN_TOPIC = new RegExp(`^[a-z]{3,9}-[${TOPIC_LETTERS}]{4}(?:-[${TOPIC_LETTERS}]{4}){4}$`)

/** Whether Codehouse would make this topic today. */
export const isOwnTopic = (topic: string): boolean => OWN_TOPIC.test(topic)

/**
 * A topic typed back in, so a phone already subscribed keeps working: the name, or its address. Only a topic Codehouse
 * made is taken, because whoever reads the topic sees the Approve buttons; anything else gives undefined.
 */
export function ownTopic(typed: string): string | undefined {
  const name = typed.trim().split("/").filter(Boolean).at(-1) ?? ""
  return isOwnTopic(name) ? name : undefined
}

export class NtfyChannel {
  readonly #d: NtfyDeps
  readonly #codes: PushCodes
  #abort: AbortController | undefined
  #status: NtfyStatus = { enabled: false, listening: false, sent: 0 }
  #onCreated = (v: PendingView) => void this.notify(v)
  #onResolved = ({ id }: { id: string }) => this.#codes.forget(id)
  #running = false

  constructor(deps: NtfyDeps) {
    this.#d = deps
    this.#codes = new PushCodes({
      broker: deps.broker,
      expiryMs: deps.expiryMs,
      onRefused: deps.onRefused,
      ...(deps.now ? { now: deps.now } : {}),
    })
  }

  status(): NtfyStatus {
    const s = this.#d.settings()
    return {
      ...this.#status,
      enabled: s?.enabled === true,
      ...(s ? { server: s.server, topic: s.topic, maxRisk: Math.min(s.maxRisk, SEVERE - 1) } : {}),
      ...(s && !isOwnTopic(s.topic) ? { oldStyle: true } : {}),
      ...(s?.auth ? { auth: s.auth, ...(s.user ? { user: s.user } : {}) } : {}),
    }
  }

  start(): void {
    if (this.#running) return
    const s = this.#d.settings()
    if (!s?.enabled) return
    this.#running = true
    this.#d.broker.on("created", this.#onCreated)
    this.#d.broker.on("resolved", this.#onResolved)
    void this.#listen()
    this.#d.onChange?.()
  }

  stop(): void {
    this.#running = false
    this.#d.broker.off("created", this.#onCreated)
    this.#d.broker.off("resolved", this.#onResolved)
    this.#abort?.abort()
    this.#abort = undefined
    this.#codes.clear()
    this.#status = { ...this.#status, listening: false }
    this.#d.onChange?.()
  }

  /** Listening started or stopped. */
  #listening(listening: boolean, lastError?: string): void {
    const was = this.#status.listening
    this.#status = {
      ...this.#status,
      listening,
      ...(lastError !== undefined || listening ? { lastError } : {}),
    }
    if (listening !== was) this.#d.onChange?.()
  }

  async notify(view: PendingView): Promise<void> {
    const s = this.#d.settings()
    if (!s?.enabled) return
    const r = view.request
    let auth: Record<string, string>
    try {
      auth = await ntfyAuthHeader(s, this.#d.secret)
    } catch (e) {
      this.#status = { ...this.#status, lastError: `Sending failed: ${(e as Error).message}` }
      this.#d.log(`ntfy: ${this.#status.lastError}`)
      return
    }
    const { allow, deny } = this.#codes.issue(view, s.maxRisk)
    const reply = `${s.server.replace(/\/$/, "")}/${s.replyTopic}`
    // The phone's ntfy app sends a button's answer itself, so on a server that needs a sign-in the button carries it.
    const buttonAuth = Object.keys(auth).length ? { headers: auth } : {}
    const actions =
      r.kind === "question"
        ? []
        : [
            ...(allow
              ? [
                  {
                    action: "http",
                    label: "Approve",
                    url: reply,
                    method: "POST",
                    body: `allow ${r.id} ${allow}`,
                    ...buttonAuth,
                    clear: true,
                  },
                ]
              : []),
            {
              action: "http",
              label: "Deny",
              url: reply,
              method: "POST",
              body: `deny ${r.id} ${deny}`,
              ...buttonAuth,
              clear: true,
            },
          ]
    const risk = r.verdict.risk
    const band = riskBand(risk)
    const message = [
      `${r.toolName}: ${summarise(view, this.#d.redact)}`,
      `Risk ${risk} ${band}, rule ${r.verdict.ruleId}.`,
      allow
        ? ""
        : r.kind === "question"
          ? "Answer it in Codehouse."
          : "Too risky to approve from here: decide in Codehouse, or deny.",
    ]
      .filter(Boolean)
      .join("\n")
    try {
      const res = await (this.#d.fetchImpl ?? fetch)(s.server.replace(/\/$/, ""), {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({
          topic: s.topic,
          title: this.#d.redact(`Codehouse: ${r.project} needs you`),
          message,
          priority: risk >= 70 ? 5 : 4,
          tags: ["warning"],
          actions,
        }),
      })
      if (!res.ok) throw new Error(`ntfy answered ${res.status}`)
      this.#status = { ...this.#status, sent: this.#status.sent + 1, lastError: undefined }
    } catch (e) {
      this.#status = { ...this.#status, lastError: `Sending failed: ${(e as Error).message}` }
      this.#d.log(`ntfy: ${this.#status.lastError}`)
    }
  }

  /** Sends a plain test message, with no buttons. */
  async test(): Promise<{ ok: boolean; error?: string; id?: string; at?: string }> {
    const s = this.#d.settings()
    if (!s?.enabled) return { ok: false, error: "ntfy is not switched on" }
    try {
      const auth = await ntfyAuthHeader(s, this.#d.secret)
      const res = await (this.#d.fetchImpl ?? fetch)(s.server.replace(/\/$/, ""), {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({
          topic: s.topic,
          title: "Codehouse test",
          message:
            "Notifications from Codehouse reach this phone. Approve and Deny buttons appear when a request needs you.",
        }),
      })
      if (!res.ok)
        return {
          ok: false,
          error:
            res.status === 401 || res.status === 403
              ? `ntfy refused the sign-in (${res.status}): check the token, or the user name and password, and that this user may write to the topic`
              : `ntfy answered ${res.status}`,
        }
      // ntfy answers with the message it stored, so Codehouse can say it arrived there.
      const got = (await res.json().catch(() => ({}))) as { id?: unknown; time?: unknown }
      return {
        ok: true,
        ...(typeof got.id === "string" ? { id: got.id } : {}),
        ...(typeof got.time === "number" ? { at: new Date(got.time * 1000).toISOString() } : {}),
      }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  /** Checks one reply and, if it holds, answers the request. Returns what happened, for tests and the log. */
  handleReply(text: string): "allowed" | "denied" | "refused" {
    const m = REPLY.exec(text.trim())
    if (!m) {
      this.#d.onRefused("a reply that is not in the expected form")
      return "refused"
    }
    const [, decision, id, given] = m as unknown as [string, "allow" | "deny", string, string]
    return this.#codes.answer(decision, id, given)
  }

  /** Listens to the reply topic over an outbound stream, reconnecting with a growing pause. */
  async #listen(): Promise<void> {
    let pause = 1000
    let since = String(Math.floor((this.#d.now ?? Date.now)() / 1000))
    while (this.#running) {
      const s = this.#d.settings()
      if (!s?.enabled) break
      this.#abort = new AbortController()
      try {
        const auth = await ntfyAuthHeader(s, this.#d.secret)
        const res = await (this.#d.fetchImpl ?? fetch)(
          `${s.server.replace(/\/$/, "")}/${s.replyTopic}/json?since=${since}`,
          { signal: this.#abort.signal, headers: auth },
        )
        if (!res.ok || !res.body) throw new Error(`ntfy answered ${res.status}`)
        this.#listening(true)
        pause = 1000
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ""
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          let nl: number
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim()
            buf = buf.slice(nl + 1)
            if (!line) continue
            try {
              const msg = JSON.parse(line) as { id?: string; event?: string; message?: string }
              if (msg.id) since = msg.id
              if (msg.event === "message" && typeof msg.message === "string")
                this.handleReply(msg.message)
            } catch {
              // A line that is not JSON is ignored.
            }
          }
        }
      } catch (e) {
        if (!this.#running) break
        this.#listening(false, `Listening failed: ${(e as Error).message}`)
      }
      this.#listening(false)
      if (!this.#running) break
      await new Promise((r) => setTimeout(r, pause))
      pause = Math.min(pause * 2, 30_000)
    }
  }
}
