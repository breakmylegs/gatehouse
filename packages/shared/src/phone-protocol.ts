import { canonicalize } from "./canonical-json.js"
import { b64u, importPublicKey, openJson, sealJson, sha256, type Sealed } from "./e2e.js"
import type { SignedDecision } from "./relay-protocol.js"

/**
 * The phone's side of the protocol, with no browser or Node specifics so the installed app and the tests run the
 * same code. The passkey itself is passed in as a function, because only the browser can ask for Face ID.
 */
export type Envelope = SignedDecision["envelope"]

/** The challenge the passkey signs: the hash of the envelope's canonical form. It binds every field of the envelope. */
export async function envelopeChallenge(envelope: Envelope): Promise<string> {
  return b64u(await sha256(canonicalize(envelope)))
}

export interface OpenedRequest {
  payload: {
    id: string
    nonce: string
    kind: "permission" | "question" | "plan"
    toolName: string
    input: unknown
    cwd: string
    project: string
    verdict: {
      outcome: string
      ruleId: string
      reason: string
      risk: number
      segments?: Array<{ text: string; ruleId: string; outcome: string }>
    }
    createdAt: string
    expiresAt: string
  }
  /** The hash the Host will require in the signed envelope. */
  payloadHash: string
  /** The Host could not fit the whole input on the phone. The phone may only deny. */
  oversize?: { characters: number }
}

/** Decrypts a request the Relay delivered. `relayId` is the additional data it was sealed with. */
export async function openRequest(
  sealed: Sealed,
  phonePrivateKey: CryptoKey,
  relayId: string,
): Promise<OpenedRequest> {
  const o = await openJson<OpenedRequest>(sealed, phonePrivateKey, relayId)
  if (!o || typeof o !== "object" || !o.payload || typeof o.payloadHash !== "string")
    throw new Error("not a request")
  if (!o.oversize) {
    // When the whole input is here, the phone checks the hash itself rather than trusting the one it was sent.
    const again = await hashHex(o.payload)
    if (again !== o.payloadHash) throw new Error("The request does not match its hash")
  }
  return o
}

async function hashHex(value: unknown): Promise<string> {
  const h = await sha256(canonicalize(value))
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("")
}

export function newEnvelope(o: {
  type: Envelope["type"]
  deviceId: string
  now: number
  ttlMs: number
  nonce?: string
  requestId?: string
  payloadHash?: string
  decision?: "allow" | "deny"
  message?: string
  answers?: Record<string, string>
}): Envelope {
  return {
    v: 1,
    type: o.type,
    ...(o.requestId !== undefined ? { requestId: o.requestId } : {}),
    nonce: o.nonce ?? b64u(globalThis.crypto.getRandomValues(new Uint8Array(24))),
    ...(o.decision !== undefined ? { decision: o.decision } : {}),
    ...(o.message?.trim() ? { message: o.message.trim().slice(0, 500) } : {}),
    ...(o.answers !== undefined ? { answers: o.answers } : {}),
    ...(o.payloadHash !== undefined ? { payloadHash: o.payloadHash } : {}),
    deviceId: o.deviceId,
    issuedAt: new Date(o.now).toISOString(),
    expiresAt: new Date(o.now + o.ttlMs).toISOString(),
  }
}

/**
 * Signs an envelope with the passkey (Face ID) and seals the result to the Host's key. The Relay then sees
 * neither the answer nor any text, and cannot change either without the signature failing.
 */
export async function signAndSeal(
  envelope: Envelope,
  sign: (challenge: string) => Promise<Record<string, unknown>>,
  hostPublicKey: string,
  aad: string,
): Promise<Sealed> {
  const assertion = await sign(await envelopeChallenge(envelope))
  return sealJson({ envelope, assertion }, await importPublicKey(hostPublicKey), aad)
}
