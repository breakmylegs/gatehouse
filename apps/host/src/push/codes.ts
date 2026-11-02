import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import type { PendingView } from "@gatehouse/shared"
import type { Broker } from "../broker.js"

/**
 * Single-use answer codes for outbound push channels (ntfy, Slack), which cannot carry a passkey. Each request gets
 * its own random allow and deny codes, kept only as hashes; a code works once, for that request only, and expires
 * with the phone window. Allow is never issued above the risk limit, and never for Severe.
 */
export const SEVERE = 85

const sha = (s: string) => createHash("sha256").update(s).digest()
const newCode = () => randomBytes(24).toString("base64url")

export interface IssuedCodes {
  allow?: string
  deny: string
}

export type ReplyResult = "allowed" | "denied" | "refused"

export class PushCodes {
  readonly #broker: Broker
  readonly #expiryMs: () => number
  readonly #onRefused: (reason: string, requestId?: string) => void
  readonly #now: () => number
  readonly #codes = new Map<string, { allow?: Buffer; deny: Buffer; expires: number }>()

  constructor(opts: {
    broker: Broker
    expiryMs: () => number
    onRefused: (reason: string, requestId?: string) => void
    now?: () => number
  }) {
    this.#broker = opts.broker
    this.#expiryMs = opts.expiryMs
    this.#onRefused = opts.onRefused
    this.#now = opts.now ?? Date.now
  }

  /** Codes for one request. Allow only when it is a permission or plan at or under the limit. */
  issue(view: PendingView, maxRisk: number): IssuedCodes {
    const r = view.request
    const ceiling = Math.min(maxRisk, SEVERE - 1)
    const allow = r.kind !== "question" && r.verdict.risk <= ceiling ? newCode() : undefined
    const deny = newCode()
    this.#codes.set(r.id, {
      ...(allow ? { allow: sha(allow) } : {}),
      deny: sha(deny),
      expires: this.#now() + this.#expiryMs(),
    })
    return { ...(allow ? { allow } : {}), deny }
  }

  forget(id: string): void {
    this.#codes.delete(id)
  }

  clear(): void {
    this.#codes.clear()
  }

  /** Checks a code and, if it holds, answers the request on the channel `push`. */
  answer(decision: "allow" | "deny", id: string, given: string): ReplyResult {
    const entry = this.#codes.get(id)
    if (!entry) {
      this.#onRefused("a code for a request that is not waiting, or a code used already", id)
      return "refused"
    }
    if (this.#now() > entry.expires) {
      this.#codes.delete(id)
      this.#onRefused("an expired code", id)
      return "refused"
    }
    const want = decision === "allow" ? entry.allow : entry.deny
    const got = sha(given)
    if (!want || want.length !== got.length || !timingSafeEqual(want, got)) {
      this.#onRefused(`a wrong ${decision} code`, id)
      return "refused"
    }
    // Single use: once either code works, both are gone.
    this.#codes.delete(id)
    const r = this.#broker.resolve(id, { kind: "decision", decision }, "push")
    if (!r.ok) {
      this.#onRefused(`an answer the request would not take (${r.reason})`, id)
      return "refused"
    }
    return decision === "allow" ? "allowed" : "denied"
  }
}

/** One line about the request, redacted and short. */
export function summarise(view: PendingView, redact: (t: string) => string): string {
  const r = view.request
  if (r.kind === "question") return "Claude has a question for you."
  if (r.kind === "plan") return "Claude has a plan for you to approve."
  const input = r.input as Record<string, unknown>
  const pick = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : undefined)
  const raw = pick("command") ?? pick("file_path") ?? pick("url") ?? pick("path") ?? ""
  const one = redact(raw).replace(/\s+/g, " ").trim()
  return one.length > 160 ? one.slice(0, 157) + "..." : one
}

export function riskBand(risk: number): string {
  return risk >= 85 ? "Severe" : risk >= 70 ? "High" : risk >= 40 ? "Moderate" : "Low"
}
