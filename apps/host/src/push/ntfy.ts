import { randomInt } from "node:crypto"
import type { PendingView } from "@gatehouse/shared"
import type { Broker } from "../broker.js"
import { PushCodes, riskBand, SEVERE, summarise } from "./codes.js"

export { summarise } from "./codes.js"

/**
 * Push notifications through ntfy, with answers coming back over a connection this computer opens. Nothing has to
 * reach in: JCVC publishes to a topic, your phone's ntfy app shows Approve and Deny buttons, a tap posts a one-time
 * code to a reply topic, and JCVC is already listening to that topic over its own outbound stream.
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
}

export interface NtfyStatus {
  enabled: boolean
  listening: boolean
  server?: string
  topic?: string
  maxRisk?: number
  lastError?: string
  sent: number
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
}

const REPLY = /^(allow|deny) ([0-9a-f-]{36}) ([A-Za-z0-9_-]{22,64})$/

/** Letters and digits that cannot be mistaken for each other when typed into a phone: no 0 o, 1 l i. */
export const TOPIC_LETTERS = "abcdefghjkmnpqrstuvwxyz23456789"

/** A private topic: "jcvc-" and five groups of four, about 99 bits, easy to read and to type. */
export function randomTopic(): string {
  const group = () =>
    Array.from({ length: 4 }, () => TOPIC_LETTERS[randomInt(TOPIC_LETTERS.length)]).join("")
  return `jcvc-${Array.from({ length: 5 }, group).join("-")}`
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
  }

  stop(): void {
    this.#running = false
    this.#d.broker.off("created", this.#onCreated)
    this.#d.broker.off("resolved", this.#onResolved)
    this.#abort?.abort()
    this.#abort = undefined
    this.#codes.clear()
    this.#status = { ...this.#status, listening: false }
  }

  async notify(view: PendingView): Promise<void> {
    const s = this.#d.settings()
    if (!s?.enabled) return
    const r = view.request
    const { allow, deny } = this.#codes.issue(view, s.maxRisk)
    const reply = `${s.server.replace(/\/$/, "")}/${s.replyTopic}`
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
          ? "Answer it in JCVC."
          : "Too risky to approve from here: decide in JCVC, or deny.",
    ]
      .filter(Boolean)
      .join("\n")
    try {
      const res = await (this.#d.fetchImpl ?? fetch)(s.server.replace(/\/$/, ""), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          topic: s.topic,
          title: this.#d.redact(`JCVC: ${r.project} needs you`),
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
      const res = await (this.#d.fetchImpl ?? fetch)(s.server.replace(/\/$/, ""), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          topic: s.topic,
          title: "JCVC test",
          message:
            "Notifications from JCVC reach this phone. Approve and Deny buttons appear when a request needs you.",
        }),
      })
      if (!res.ok) return { ok: false, error: `ntfy answered ${res.status}` }
      // ntfy answers with the message it stored, so JCVC can say it arrived there.
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
        const res = await (this.#d.fetchImpl ?? fetch)(
          `${s.server.replace(/\/$/, "")}/${s.replyTopic}/json?since=${since}`,
          { signal: this.#abort.signal },
        )
        if (!res.ok || !res.body) throw new Error(`ntfy answered ${res.status}`)
        this.#status = { ...this.#status, listening: true, lastError: undefined }
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
        this.#status = {
          ...this.#status,
          listening: false,
          lastError: `Listening failed: ${(e as Error).message}`,
        }
      }
      this.#status = { ...this.#status, listening: false }
      if (!this.#running) break
      await new Promise((r) => setTimeout(r, pause))
      pause = Math.min(pause * 2, 30_000)
    }
  }
}
