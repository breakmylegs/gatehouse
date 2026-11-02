import {
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server"
import { unb64u } from "@gatehouse/shared/e2e"
import { envelopeChallenge } from "@gatehouse/shared/phone-protocol"
import type { SignedDecision } from "@gatehouse/shared/relay-protocol"

/** A phone the user paired and confirmed on the desktop. The passkey and the key are pinned (invariant 8). */
export interface PinnedPhone {
  id: string
  name: string
  credentialId: string
  /** COSE public key, base64url. */
  credentialPublicKey: string
  counter: number
  ecdhPublicKey: string
  pairedAt: string
}

/** What the Host remembers about a request it sent to the phone. */
export interface PendingInfo {
  nonce: string
  payloadHash: string
  /** The phone deadline, in milliseconds since the epoch. */
  expiresAtMs: number
  kind: "permission" | "question" | "plan"
  /** The phone was shown a reduced view because the real input was too big for it. */
  oversize: boolean
}

export type PhoneAction =
  | { type: "decision"; requestId: string; decision: "allow" | "deny"; message?: string }
  | { type: "answers"; requestId: string; answers: Record<string, string> }
  | { type: "kill" }

export type Accepted = {
  ok: true
  action: PhoneAction
  nonce: string
  nonceExpiresAtMs: number
  newCounter: number
}
export type Rejected = { ok: false; reason: string }

const MAX_SKEW_MS = 60_000
const MAX_DECISION_LIFE_MS = 10 * 60_000
const MAX_KILL_LIFE_MS = 2 * 60_000

export interface VerifyInput {
  signed: SignedDecision
  phone: PinnedPhone
  pending: (requestId: string) => PendingInfo | undefined
  nonceUsed: (nonce: string) => boolean
  now: number
  rpId: string
  origin: string
}

const no = (reason: string): Rejected => ({ ok: false, reason })

/**
 * The only way a phone decision becomes an action. Invariant 8: it is accepted only when the passkey
 * assertion verifies against the pinned credential, the nonce is unused, the envelope has not expired, and
 * the payload hash matches the request the Host sent. The Relay is not trusted to have checked any of it.
 */
export async function verifyPhoneDecision(i: VerifyInput): Promise<Accepted | Rejected> {
  const e = i.signed.envelope
  if (e.deviceId !== i.phone.id) return no("The envelope names a different device")
  const issued = Date.parse(e.issuedAt)
  const expires = Date.parse(e.expiresAt)
  if (Number.isNaN(issued) || Number.isNaN(expires)) return no("The envelope has no valid times")
  if (issued > i.now + MAX_SKEW_MS) return no("The envelope is dated in the future")
  if (expires <= i.now) return no("The envelope has expired")
  if (expires < issued) return no("The envelope expires before it was issued")
  const life = expires - issued
  if (i.nonceUsed(e.nonce)) return no("That nonce was already used")

  let action: PhoneAction
  if (e.type === "kill") {
    if (e.requestId !== undefined) return no("A kill envelope must not name a request")
    if (life > MAX_KILL_LIFE_MS) return no("A kill envelope lives too long")
    action = { type: "kill" }
  } else {
    if (life > MAX_DECISION_LIFE_MS) return no("The envelope lives too long")
    if (!e.requestId) return no("The envelope names no request")
    const p = i.pending(e.requestId)
    if (!p) return no("That request is not waiting any more")
    if (p.expiresAtMs <= i.now) return no("That request has expired on the phone")
    if (e.nonce !== p.nonce) return no("The nonce is not the one the Host sent")
    if (!e.payloadHash || e.payloadHash !== p.payloadHash)
      return no("The payload hash does not match the request")
    if (e.type === "decision") {
      if (p.kind === "question") return no("A question needs answers, not a decision")
      if (e.decision !== "allow" && e.decision !== "deny")
        return no("The decision must be allow or deny")
      if (e.decision === "allow" && p.oversize)
        return no("The phone saw only part of this request, so it can only deny it")
      action = {
        type: "decision",
        requestId: e.requestId,
        decision: e.decision,
        ...(e.message !== undefined ? { message: e.message } : {}),
      }
    } else {
      if (p.kind !== "question") return no("Only a question takes answers")
      if (!e.answers || Object.keys(e.answers).length === 0)
        return no("The envelope has no answers")
      action = { type: "answers", requestId: e.requestId, answers: e.answers }
    }
  }

  const response = i.signed.assertion as unknown as AuthenticationResponseJSON
  if (response.id !== i.phone.credentialId) return no("The assertion is from a different passkey")
  try {
    const v = await verifyAuthenticationResponse({
      response,
      expectedChallenge: await envelopeChallenge(e),
      expectedOrigin: i.origin,
      expectedRPID: i.rpId,
      requireUserVerification: true,
      credential: {
        id: i.phone.credentialId,
        publicKey: unb64u(i.phone.credentialPublicKey),
        counter: i.phone.counter,
      },
    })
    if (!v.verified) return no("The passkey signature did not verify")
    return {
      ok: true,
      action,
      nonce: e.nonce,
      nonceExpiresAtMs: expires,
      newCounter: v.authenticationInfo.newCounter,
    }
  } catch (err) {
    return no(`The passkey signature did not verify (${(err as Error).message.slice(0, 80)})`)
  }
}

export { envelopeChallenge }
