import { EventEmitter } from "node:events"
import {
  computePayloadHash,
  newNonce,
  uuidv7,
  type EscalationRequest,
  type Verdict,
} from "@gatehouse/shared"
import { msUntilPhoneAllowed, phoneHeld, type QuietHours } from "./quiet-hours.js"

/** `push` is an outbound notification channel such as ntfy: it answers with a one-time code. */
export type Channel = "desktop" | "phone" | "push"
export type RequestKind = EscalationRequest["kind"]

export type Answer =
  | {
      kind: "decision"
      decision: "allow" | "deny"
      /** Said to the agent. At most 500 characters. */
      message?: string
      /** Desktop only: the user edited the input before allowing (invariant 10 re-checks it). */
      updatedInput?: Record<string, unknown>
      /** Desktop only: also write a narrow remember rule. */
      remember?: boolean
    }
  | { kind: "answers"; answers: Record<string, string> }

export interface Resolution {
  outcome: "allow" | "deny" | "timeout" | "cancelled"
  /** Who decided. `timeout` and `host` are not people. */
  channel: Channel | "timeout" | "host"
  message?: string
  updatedInput?: Record<string, unknown>
  answers?: Record<string, string>
  remember?: boolean
  at: string
  waitedMs: number
}

export type ResolveResult =
  | { ok: true; resolution: Resolution }
  | {
      ok: false
      reason: "not-pending" | "invalid-answer" | "not-allowed-on-channel"
      detail?: string
    }

export interface BrokerRequestSpec {
  kind: RequestKind
  sessionId: string
  toolUseId: string
  toolName: string
  /** The real input. The desktop shows it. The copy in the request is redacted. */
  input: Record<string, unknown>
  cwd: string
  project: string
  verdict: Verdict
  /** The SDK's abort signal for this call. */
  signal?: AbortSignal
  /** The ask must not be approvable by a stray keystroke. */
  defaultToNo?: boolean
}

export interface PendingView {
  request: EscalationRequest
  rawInput: Record<string, unknown>
  defaultToNo: boolean
  phone: "none" | "held" | "delivered" | "expired"
  hardDeadline: string
}

/** What the relay side provides. Added with the relay in a later phase. */
export interface PhoneChannel {
  deliver(request: EscalationRequest): Promise<void>
  /** Told when a request is answered elsewhere, so the phone can show the outcome. */
  cancel(id: string, summary: string): Promise<void>
}

export interface BrokerOptions {
  phoneExpiryMs: number
  hardTimeoutMs: number
  quietHours?: () => QuietHours | undefined
  phone?: PhoneChannel
  /** Makes the redacted copy of the input that the phone and the audit see (invariant 12). */
  redact: <T>(value: T) => T
  now?: () => Date
}

export interface BrokerEvents {
  created: [PendingView]
  resolved: [{ id: string; sessionId: string; request: EscalationRequest; resolution: Resolution }]
  phone: [{ id: string; status: PendingView["phone"] }]
}

interface Entry {
  view: PendingView
  spec: BrokerRequestSpec
  createdMs: number
  resolve: (r: Resolution) => void
  timers: NodeJS.Timeout[]
  abort?: { signal: AbortSignal; listener: () => void }
}

const MAX_MESSAGE = 500
const MAX_ANSWER = 4000

export function describeResolution(r: Resolution): string {
  const when = r.at.slice(11, 16)
  switch (r.outcome) {
    case "allow":
      return `Approved on ${r.channel} at ${when}`
    case "deny":
      return `Denied on ${r.channel} at ${when}`
    case "timeout":
      return "Timed out waiting for approval"
    case "cancelled":
      return "Cancelled"
  }
}

/**
 * Holds every request that needs a person and takes the first valid answer from the desktop or the phone.
 * Each request has one deadline for the phone (10 minutes by default) and one hard deadline (30 minutes),
 * after which it is denied. A request leaves the table the instant it is answered, so a second answer
 * from the other channel finds nothing to answer. The broker decides nothing itself.
 */
export class Broker extends EventEmitter<BrokerEvents> {
  readonly #opts: BrokerOptions
  readonly #pending = new Map<string, Entry>()

  constructor(opts: BrokerOptions) {
    super()
    this.#opts = opts
  }

  #now(): Date {
    return (this.#opts.now ?? (() => new Date()))()
  }

  list(): PendingView[] {
    return [...this.#pending.values()].map((e) => e.view)
  }

  get(id: string): PendingView | undefined {
    return this.#pending.get(id)?.view
  }

  countFor(sessionId: string): number {
    return [...this.#pending.values()].filter((e) => e.spec.sessionId === sessionId).length
  }

  /** Waits for an answer. Always resolves, never rejects: a timeout and a cancellation are resolutions. */
  request(spec: BrokerRequestSpec): Promise<Resolution> {
    const created = this.#now()
    const expiresAt = new Date(created.getTime() + this.#opts.phoneExpiryMs)
    const base: Omit<EscalationRequest, "payloadHash"> = {
      id: uuidv7(created.getTime()),
      nonce: newNonce(),
      kind: spec.kind,
      sessionId: spec.sessionId,
      toolUseId: spec.toolUseId,
      toolName: spec.toolName,
      input: this.#opts.redact(spec.input),
      cwd: this.#opts.redact(spec.cwd),
      project: this.#opts.redact(spec.project),
      verdict: this.#opts.redact(spec.verdict),
      createdAt: created.toISOString(),
      expiresAt: expiresAt.toISOString(),
    }
    const request: EscalationRequest = { ...base, payloadHash: computePayloadHash(base) }
    const hardDeadline = new Date(created.getTime() + this.#opts.hardTimeoutMs)
    const view: PendingView = {
      request,
      rawInput: spec.input,
      defaultToNo: spec.defaultToNo === true,
      phone: "none",
      hardDeadline: hardDeadline.toISOString(),
    }

    return new Promise<Resolution>((resolve) => {
      const entry: Entry = { view, spec, createdMs: created.getTime(), resolve, timers: [] }
      this.#pending.set(request.id, entry)

      const signal = spec.signal
      if (signal) {
        if (signal.aborted) {
          this.#finish(
            request.id,
            this.#resolution("cancelled", "host", { message: "The session was interrupted" }),
          )
          return
        }
        const listener = () =>
          this.#finish(
            request.id,
            this.#resolution("cancelled", "host", { message: "The session was interrupted" }),
          )
        signal.addEventListener("abort", listener, { once: true })
        entry.abort = { signal, listener }
      }

      entry.timers.push(
        setTimeout(
          () =>
            this.#finish(
              request.id,
              this.#resolution("timeout", "timeout", { message: "Timed out waiting for approval" }),
            ),
          this.#opts.hardTimeoutMs,
        ),
      )
      entry.timers.push(setTimeout(() => this.#phoneExpired(request.id), this.#opts.phoneExpiryMs))

      this.emit("created", view)
      this.#deliverToPhone(request.id)
    })
  }

  #resolution(
    outcome: Resolution["outcome"],
    channel: Resolution["channel"],
    extra: Partial<Resolution> = {},
  ): Resolution {
    return { outcome, channel, at: this.#now().toISOString(), waitedMs: 0, ...extra }
  }

  #deliverToPhone(id: string): void {
    const entry = this.#pending.get(id)
    const phone = this.#opts.phone
    if (!entry || !phone) return
    const now = this.#now()
    const quiet = this.#opts.quietHours?.()
    if (phoneHeld(now, quiet)) {
      this.#setPhone(entry, "held")
      const wait = msUntilPhoneAllowed(now, quiet)
      if (wait !== undefined) {
        const t = setTimeout(() => this.#deliverToPhone(id), wait)
        t.unref?.()
        entry.timers.push(t)
      }
      return
    }
    if (now.getTime() >= new Date(entry.view.request.expiresAt).getTime()) return
    this.#setPhone(entry, "delivered")
    phone.deliver(entry.view.request).catch(() => this.#setPhone(entry, "none"))
  }

  #setPhone(entry: Entry, status: PendingView["phone"]): void {
    if (entry.view.phone === status) return
    entry.view.phone = status
    this.emit("phone", { id: entry.view.request.id, status })
  }

  #phoneExpired(id: string): void {
    const entry = this.#pending.get(id)
    if (!entry) return
    if (entry.view.phone === "delivered" || entry.view.phone === "held") {
      this.#setPhone(entry, "expired")
      void this.#opts.phone
        ?.cancel(id, "Expired on the phone. Still waiting on the desktop.")
        ?.catch(() => undefined)
    }
  }

  /** Takes an answer. The first valid one for a request wins, whichever channel it came from. */
  resolve(id: string, answer: Answer, channel: Channel): ResolveResult {
    const entry = this.#pending.get(id)
    if (!entry) return { ok: false, reason: "not-pending" }
    const problem = this.#validate(entry, answer, channel)
    if (problem) return problem

    const waitedMs = this.#now().getTime() - entry.createdMs
    let resolution: Resolution
    if (answer.kind === "answers") {
      resolution = this.#resolution("allow", channel, { answers: answer.answers, waitedMs })
    } else {
      resolution = this.#resolution(answer.decision, channel, {
        waitedMs,
        ...(answer.message !== undefined ? { message: answer.message } : {}),
        ...(answer.updatedInput !== undefined ? { updatedInput: answer.updatedInput } : {}),
        ...(answer.remember ? { remember: true } : {}),
      })
    }
    this.#finish(id, resolution)
    return { ok: true, resolution }
  }

  #validate(entry: Entry, answer: Answer, channel: Channel): ResolveResult | undefined {
    const kind = entry.view.request.kind
    if (answer.kind === "answers") {
      if (kind !== "question")
        return { ok: false, reason: "invalid-answer", detail: "This request is not a question" }
      const questions = (entry.spec.input.questions as { question?: unknown }[] | undefined) ?? []
      const wanted = questions.map((q) => String(q.question ?? ""))
      const keys = Object.keys(answer.answers)
      if (keys.length === 0 || keys.some((k) => !wanted.includes(k))) {
        return {
          ok: false,
          reason: "invalid-answer",
          detail: "Answers must be keyed by the question text",
        }
      }
      if (wanted.some((q) => !keys.includes(q))) {
        return { ok: false, reason: "invalid-answer", detail: "Every question needs an answer" }
      }
      for (const v of Object.values(answer.answers)) {
        if (typeof v !== "string" || v.length === 0 || v.length > MAX_ANSWER) {
          return { ok: false, reason: "invalid-answer", detail: "An answer is empty or too long" }
        }
      }
      return undefined
    }
    if (kind === "question") {
      // A question can also be declined.
      if (answer.decision !== "deny")
        return { ok: false, reason: "invalid-answer", detail: "A question needs answers" }
    }
    if (answer.decision !== "allow" && answer.decision !== "deny") {
      return { ok: false, reason: "invalid-answer", detail: "Decision must be allow or deny" }
    }
    if (
      answer.message !== undefined &&
      (typeof answer.message !== "string" || answer.message.length > MAX_MESSAGE)
    ) {
      return {
        ok: false,
        reason: "invalid-answer",
        detail: `The message is limited to ${MAX_MESSAGE} characters`,
      }
    }
    // Invariant 11: the phone and push channels can allow, deny, answer and kill. They cannot edit input or create rules.
    if (channel !== "desktop" && (answer.updatedInput !== undefined || answer.remember)) {
      return {
        ok: false,
        reason: "not-allowed-on-channel",
        detail: "The phone cannot edit input or remember rules",
      }
    }
    if (
      answer.updatedInput !== undefined &&
      (typeof answer.updatedInput !== "object" || answer.updatedInput === null)
    ) {
      return { ok: false, reason: "invalid-answer", detail: "updatedInput must be an object" }
    }
    if (answer.decision === "deny" && (answer.updatedInput !== undefined || answer.remember)) {
      return {
        ok: false,
        reason: "invalid-answer",
        detail: "A denial cannot carry edits or remember",
      }
    }
    return undefined
  }

  #finish(id: string, resolution: Resolution): void {
    const entry = this.#pending.get(id)
    if (!entry) return
    this.#pending.delete(id)
    for (const t of entry.timers) clearTimeout(t)
    if (entry.abort) entry.abort.signal.removeEventListener("abort", entry.abort.listener)
    if (resolution.waitedMs === 0) resolution.waitedMs = this.#now().getTime() - entry.createdMs
    entry.resolve(resolution)
    this.emit("resolved", {
      id,
      sessionId: entry.spec.sessionId,
      request: entry.view.request,
      resolution,
    })
    // Tell the other channel the outcome. Best effort: the answer is already final.
    if (entry.view.phone === "delivered" || entry.view.phone === "held") {
      void this.#opts.phone?.cancel(id, describeResolution(resolution))?.catch(() => undefined)
    }
  }

  /** Cancels every request of one session (an interrupt). */
  cancelSession(sessionId: string, message = "The session was interrupted"): number {
    let n = 0
    for (const [id, e] of [...this.#pending]) {
      if (e.spec.sessionId === sessionId) {
        this.#finish(id, this.#resolution("cancelled", "host", { message }))
        n++
      }
    }
    return n
  }

  /** Cancels everything (the kill switch). */
  cancelAll(message = "The kill switch was engaged"): number {
    let n = 0
    for (const id of [...this.#pending.keys()]) {
      this.#finish(id, this.#resolution("cancelled", "host", { message }))
      n++
    }
    return n
  }
}
