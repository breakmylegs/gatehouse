import { randomBytes, randomInt } from "node:crypto"
import { EventEmitter } from "node:events"
import { verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server"
import { phonePayload } from "@gatehouse/shared"
import type { EscalationRequest } from "@gatehouse/shared"
import { b64u, fingerprint, importPublicKey, openJson, sealJson } from "@gatehouse/shared/e2e"
import { PAIRING_ALPHABET, PairingStatus, SignedDecision } from "@gatehouse/shared/relay-protocol"
import type { Broker, PhoneChannel } from "../broker.js"
import type { HostAudit } from "../hostaudit.js"
import type { HostKillSwitch } from "../kill.js"
import { RelayClient, RelayError, type RemoteDecision } from "./client.js"
import type { PhoneStore } from "./store.js"
import { verifyPhoneDecision, type PendingInfo, type PinnedPhone } from "./verify.js"

/** What fits in a single push-safe request body. Bigger input is shown to the phone in outline only. */
export const MAX_PLAINTEXT_BYTES = 4800
const POLL_WAIT_S = 25

export interface PairingView {
  id: string
  code: string
  status: "waiting" | "awaiting-confirmation" | "confirmed" | "expired" | "failed"
  expiresAt: string
  phoneName?: string
  fingerprint?: string
  reason?: string
}

interface LocalPairing {
  relayId: string
  code: string
  challenge: string
  hostPublicKey: string
  expiresAt: string
  verified?: {
    phoneName: string
    credentialId: string
    credentialPublicKey: string
    counter: number
    ecdhPublicKey: string
    fingerprint: string
  }
  failed?: string
  confirmedPhoneId?: string
}

interface PendingEntry extends PendingInfo {
  /** The Relay's id for this request, per phone. */
  relayIds: Map<string, string>
}

export interface PhoneServiceDeps {
  store: PhoneStore
  broker: Broker
  kill: HostKillSwitch
  audit: HostAudit
  log: (line: string) => void
  now?: () => number
  fetchImpl?: typeof fetch
}

/** What a lock-screen notification may say if the user allowed details. Short, from the redacted copy. */
function pushSummary(r: EscalationRequest): { title: string; body: string } {
  const input = (r.input ?? {}) as Record<string, unknown>
  const main =
    typeof input.command === "string"
      ? input.command
      : typeof input.file_path === "string"
        ? input.file_path
        : r.toolName
  const flat = main.replace(/s+/g, " ").trim()
  return {
    title:
      r.kind === "question"
        ? "Question from " + r.project
        : r.kind === "plan"
          ? "Plan to approve in " + r.project
          : "Approval needed in " + r.project,
    body: flat.length > 90 ? flat.slice(0, 89) + "…" : flat,
  }
}

export type RelayState = "not-configured" | "connected" | "unreachable"

/**
 * The Host's end of the phone channel: pairing, sending requests (sealed to the phone), and taking decisions
 * back. Invariant 8: nothing the Relay says is believed. A decision becomes an action only through
 * `verifyPhoneDecision`, and everything else that arrives is audited and dropped.
 */
export class PhoneService extends EventEmitter implements PhoneChannel {
  readonly #d: PhoneServiceDeps
  readonly #pending = new Map<string, PendingEntry>()
  readonly #pairings = new Map<string, LocalPairing>()
  #state: RelayState = "not-configured"
  #running = false
  #wake: (() => void) | undefined

  constructor(deps: PhoneServiceDeps) {
    super()
    this.#d = deps
  }

  get #now(): number {
    return (this.#d.now ?? Date.now)()
  }

  #client(token: string | undefined): RelayClient {
    const link = this.#d.store.relay()
    if (!link) throw new Error("No Relay is set up")
    return new RelayClient(link.url, token, this.#d.fetchImpl)
  }

  async #authed(): Promise<RelayClient> {
    return this.#client(await this.#d.store.token())
  }

  health(): { state: RelayState; devices: number } {
    return {
      state: this.#d.store.relay() ? this.#state : "not-configured",
      devices: this.#d.store.phones().length,
    }
  }

  #setState(s: RelayState): void {
    if (s !== this.#state) {
      this.#state = s
      this.emit("health")
    }
  }

  // ---- lifecycle ----

  start(): void {
    if (this.#running || !this.#d.store.relay()) return
    this.#running = true
    this.#setState("connected")
    void this.#loop()
  }

  stop(): void {
    this.#running = false
    this.#wake?.()
  }

  async #loop(): Promise<void> {
    let backoff = 1000
    while (this.#running) {
      try {
        const list = await (
          await this.#authed()
        ).decisions(this.#d.store.phones().length ? POLL_WAIT_S : 5)
        this.#setState("connected")
        backoff = 1000
        for (const d of list) {
          await this.#handle(d)
          await (await this.#authed()).ack(d.id).catch(() => undefined)
        }
      } catch (e) {
        this.#setState("unreachable")
        this.#d.log(`relay poll failed: ${(e as Error).message}`)
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, backoff)
          this.#wake = () => {
            clearTimeout(t)
            resolve()
          }
        })
        backoff = Math.min(30_000, backoff * 2)
      }
    }
  }

  // ---- setup and pairing ----

  async setup(url: string, enrolToken: string, name: string): Promise<void> {
    let u: URL
    try {
      u = new URL(url)
    } catch {
      throw new Error("That is not a web address")
    }
    if (
      u.protocol !== "https:" &&
      !(u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"))
    )
      throw new Error("The Relay address must start with https://")
    const base = u.origin
    const anon = new RelayClient(base, undefined, this.#d.fetchImpl)
    const cfg = await anon.config()
    const enrolled = await anon.enrol(enrolToken, name)
    await this.#d.store.setRelay({
      url: base,
      deviceId: enrolled.deviceId,
      token: enrolled.token,
      rpId: cfg.rpId,
      origin: cfg.origin,
    })
    this.#setState("connected")
    this.start()
  }

  async startPairing(): Promise<PairingView> {
    const link = this.#d.store.relay()
    if (!link) throw new Error("Set up the Relay first")
    const host = await this.#d.store.hostKey()
    let code = ""
    for (let i = 0; i < 8; i++) code += PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)]
    const challenge = b64u(randomBytes(32))
    const created = await (await this.#authed()).createPairing(code, challenge, host.publicKey)
    this.#pairings.set(created.id, {
      relayId: created.id,
      code,
      challenge,
      hostPublicKey: host.publicKey,
      expiresAt: created.expiresAt,
    })
    this.start()
    return { id: created.id, code, status: "waiting", expiresAt: created.expiresAt }
  }

  async pairingStatus(id: string): Promise<PairingView> {
    const p = this.#pairings.get(id)
    if (!p) throw new Error("No such pairing")
    const base = { id, code: p.code, expiresAt: p.expiresAt }
    if (p.confirmedPhoneId)
      return { ...base, status: "confirmed", phoneName: p.verified?.phoneName ?? "" }
    if (p.failed) return { ...base, status: "failed", reason: p.failed }
    if (p.verified)
      return {
        ...base,
        status: "awaiting-confirmation",
        phoneName: p.verified.phoneName,
        fingerprint: p.verified.fingerprint,
      }
    const remote = PairingStatus.safeParse(await (await this.#authed()).pairing(id))
    if (!remote.success)
      return { ...base, status: "failed", reason: "The Relay sent something unexpected" }
    if (remote.data.status === "expired") return { ...base, status: "expired" }
    if (remote.data.status !== "registered" || !remote.data.registration)
      return { ...base, status: "waiting" }
    const link = this.#d.store.relay()!
    const reg = remote.data.registration
    try {
      const v = await verifyRegistrationResponse({
        response: reg.registration as unknown as RegistrationResponseJSON,
        expectedChallenge: p.challenge,
        expectedOrigin: link.origin,
        expectedRPID: link.rpId,
        requireUserVerification: true,
      })
      if (!v.verified || !v.registrationInfo) throw new Error("not verified")
      await importPublicKey(reg.ecdhPublicKey)
      const credential = v.registrationInfo.credential
      p.verified = {
        phoneName: reg.phoneName,
        credentialId: credential.id,
        credentialPublicKey: b64u(credential.publicKey),
        counter: credential.counter,
        ecdhPublicKey: reg.ecdhPublicKey,
        fingerprint: await fingerprint({
          hostPublicKey: p.hostPublicKey,
          phonePublicKey: reg.ecdhPublicKey,
          credentialId: credential.id,
        }),
      }
    } catch (e) {
      p.failed = `The phone's passkey did not verify (${(e as Error).message.slice(0, 80)}). Start again.`
      return { ...base, status: "failed", reason: p.failed }
    }
    return {
      ...base,
      status: "awaiting-confirmation",
      phoneName: p.verified.phoneName,
      fingerprint: p.verified.fingerprint,
    }
  }

  /** The user has seen the same six digits on both screens. Pin the passkey and the key, then tell the Relay. */
  async confirmPairing(id: string): Promise<PinnedPhone> {
    const p = this.#pairings.get(id)
    if (!p?.verified) throw new Error("The phone has not finished registering")
    const v = p.verified
    const confirmed = await (
      await this.#authed()
    ).confirmPairing(id, {
      credentialId: v.credentialId,
      credentialPublicKey: v.credentialPublicKey,
      counter: v.counter,
    })
    const pinned: PinnedPhone = {
      id: confirmed.phoneId,
      name: v.phoneName,
      credentialId: v.credentialId,
      credentialPublicKey: v.credentialPublicKey,
      counter: v.counter,
      ecdhPublicKey: v.ecdhPublicKey,
      pairedAt: new Date(this.#now).toISOString(),
    }
    await this.#d.store.addPhone(pinned)
    p.confirmedPhoneId = pinned.id
    this.emit("health")
    return pinned
  }

  cancelPairing(id: string): void {
    this.#pairings.delete(id)
  }

  listPhones(): PinnedPhone[] {
    return this.#d.store.phones()
  }

  async renamePhone(id: string, name: string): Promise<boolean> {
    const ok = await this.#d.store.renamePhone(id, name)
    if (ok) await (await this.#authed()).renamePhone(id, name).catch(() => undefined)
    return ok
  }

  /** The pinned key is removed first, so a decision from this phone is refused from this moment even if the Relay is down. */
  async revokePhone(id: string): Promise<{ removed: boolean; relayNotified: boolean }> {
    const removed = await this.#d.store.removePhone(id)
    let relayNotified = false
    if (removed) {
      try {
        await (await this.#authed()).revokePhone(id)
        relayNotified = true
      } catch (e) {
        this.#d.log(`relay was not told about the revoked phone: ${(e as Error).message}`)
      }
      this.emit("health")
    }
    return { removed, relayNotified }
  }

  // ---- requests out ----

  async deliver(request: EscalationRequest): Promise<void> {
    const phones = this.#d.store.phones()
    if (!this.#d.store.relay() || phones.length === 0) throw new Error("No phone is paired")
    const client = await this.#authed()
    const full = phonePayload(request)
    let content: { payload: unknown; payloadHash: string; oversize?: { characters: number } } = {
      payload: full,
      payloadHash: request.payloadHash,
    }
    let oversize = false
    if (Buffer.byteLength(JSON.stringify(content)) > MAX_PLAINTEXT_BYTES) {
      oversize = true
      const characters = JSON.stringify(request.input).length
      content = {
        payload: { ...full, input: { shown: "nothing", reason: "too long for the phone" } },
        payloadHash: request.payloadHash,
        oversize: { characters },
      }
    }
    const relayIds = new Map<string, string>()
    let sent = 0
    for (const phone of phones) {
      const relayId = phones.length === 1 ? request.id : `${request.id}.${phone.id.slice(0, 8)}`
      try {
        const sealed = await sealJson(content, await importPublicKey(phone.ecdhPublicKey), relayId)
        await client.putRequest({
          id: relayId,
          phoneId: phone.id,
          sealed,
          expiresAt: request.expiresAt,
          priority: request.verdict.risk >= 70 ? "high" : "normal",
          pushSealed: await sealJson(
            pushSummary(request),
            await importPublicKey(phone.ecdhPublicKey),
            "push",
          ),
        })
        relayIds.set(phone.id, relayId)
        sent++
      } catch (e) {
        this.#d.log(`could not send a request to ${phone.name}: ${(e as Error).message}`)
        if (e instanceof RelayError && e.status === 0) this.#setState("unreachable")
      }
    }
    if (sent === 0) throw new Error("The request could not be sent to any phone")
    const entry: PendingEntry = {
      nonce: request.nonce,
      payloadHash: request.payloadHash,
      expiresAtMs: Date.parse(request.expiresAt),
      kind: request.kind,
      oversize,
      relayIds,
    }
    this.#pending.set(request.id, entry)
    const t = setTimeout(
      () => this.#pending.delete(request.id),
      Math.max(0, entry.expiresAtMs - this.#now) + 1000,
    )
    t.unref()
  }

  async cancel(id: string, summary: string): Promise<void> {
    const e = this.#pending.get(id)
    this.#pending.delete(id)
    if (!e) return
    const client = await this.#authed()
    for (const relayId of e.relayIds.values())
      await client.markResolved(relayId, summary).catch(() => undefined)
  }

  /** A short, sealed message (session finished, a note from Claude). Generic push text is chosen by the phone. */
  async notify(
    kind: "stop" | "idle" | "notify" | "info",
    message: { title: string; body: string; project: string },
  ): Promise<void> {
    const phones = this.#d.store.phones()
    if (!this.#d.store.relay() || phones.length === 0) return
    const client = await this.#authed()
    for (const phone of phones) {
      try {
        await client.notify(
          phone.id,
          kind,
          await sealJson(message, await importPublicKey(phone.ecdhPublicKey), "push"),
        )
      } catch (e) {
        this.#d.log(`notification not sent: ${(e as Error).message}`)
      }
    }
  }

  // ---- decisions in ----

  async #reject(reason: string, detail: { phoneId?: string; requestId?: string }): Promise<void> {
    this.#d.log(`phone decision refused: ${reason}`)
    await this.#d.audit.record({
      session: "phone",
      event: "phone_decision_rejected",
      channel: "phone",
      tool: "phone",
      input: { reason, ...detail },
      verdict: {
        outcome: "deny",
        ruleId: "phone-verification",
        reason,
        risk: 0,
        decidedBy: "human-phone",
        policyHash: "n/a",
      },
      latencyMs: 0,
    })
  }

  async #handle(d: RemoteDecision): Promise<void> {
    let signed: SignedDecision
    try {
      const host = await this.#d.store.hostKey()
      const opened = await openJson(d.sealed, host.privateKey, d.requestId ?? "kill")
      const parsed = SignedDecision.safeParse(opened)
      if (!parsed.success)
        return await this.#reject("The decision was not in the expected shape", {
          phoneId: d.phoneId,
        })
      signed = parsed.data
    } catch {
      return await this.#reject("The decision could not be opened with the Host's key", {
        phoneId: d.phoneId,
      })
    }
    const phone = this.#d.store.phone(signed.envelope.deviceId)
    const link = this.#d.store.relay()
    if (!phone || !link)
      return await this.#reject("The decision is from a phone that is not paired", {
        phoneId: signed.envelope.deviceId,
      })
    const result = await verifyPhoneDecision({
      signed,
      phone,
      pending: (id) => this.#pending.get(id),
      nonceUsed: (n) => this.#d.store.nonceUsed(n),
      now: this.#now,
      rpId: link.rpId,
      origin: link.origin,
    })
    const requestId = signed.envelope.requestId
    if (!result.ok)
      return await this.#reject(result.reason, {
        phoneId: phone.id,
        ...(requestId ? { requestId } : {}),
      })
    // The nonce is spent before anything happens, so a replay can never act twice, whatever follows.
    await this.#d.store.useNonce(result.nonce, result.nonceExpiresAtMs, this.#now)
    await this.#d.store.setCounter(phone.id, result.newCounter)
    const a = result.action
    if (a.type === "kill") {
      await this.#d.kill.engage("phone", `Kill switch from ${phone.name}`)
      return
    }
    const r =
      a.type === "decision"
        ? this.#d.broker.resolve(
            a.requestId,
            {
              kind: "decision",
              decision: a.decision,
              ...(a.message !== undefined ? { message: a.message } : {}),
            },
            "phone",
          )
        : this.#d.broker.resolve(a.requestId, { kind: "answers", answers: a.answers }, "phone")
    if (!r.ok)
      await this.#reject(`The Host did not apply it: ${r.detail ?? r.reason}`, {
        phoneId: phone.id,
        requestId: a.requestId,
      })
    else this.#pending.delete(a.requestId)
  }

  /** For tests: handle one decision as if it had arrived from the Relay. */
  handleForTest(d: RemoteDecision): Promise<void> {
    return this.#handle(d)
  }
}
