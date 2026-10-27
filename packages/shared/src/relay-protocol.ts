import { z } from "zod"

/**
 * The messages between the Host, the Relay and the phone. Browser safe (zod only). The Relay is untrusted
 * (invariant 8): everything it stores is either ciphertext or something it cannot forge a valid
 * signature for, and the Host re-checks every decision itself.
 */

const B64U = z.string().regex(/^[A-Za-z0-9_-]+$/)

export const SealedSchema = z.object({
  v: z.literal(1),
  epk: B64U.max(200),
  salt: B64U.max(100),
  iv: B64U.max(50),
  ct: B64U.max(400_000),
})

/** Eight characters from an alphabet without look-alikes (no 0, O, 1, I, L). */
export const PAIRING_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
export const PAIRING_CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/
export const PAIRING_TTL_MS = 5 * 60_000

export const EnrolRequest = z.object({
  enrolToken: z.string().min(16).max(200),
  name: z.string().min(1).max(80),
})
export const EnrolReply = z.object({ deviceId: z.string(), token: z.string() })

export const CreatePairing = z.object({
  code: z.string().regex(PAIRING_CODE),
  /** WebAuthn registration challenge, base64url, chosen by the Host. */
  challenge: B64U.min(16).max(200),
  hostPublicKey: B64U.max(200),
})
export const PairingCreated = z.object({
  id: z.string(),
  expiresAt: z.string(),
  rpId: z.string(),
  origin: z.string(),
})

/** What the installed phone app fetches with the code the user typed. */
export const PairingInfo = z.object({
  pairingId: z.string(),
  challenge: B64U,
  hostPublicKey: B64U,
  rpId: z.string(),
  origin: z.string(),
  expiresAt: z.string(),
})

export const PhoneRegistration = z.object({
  phoneName: z.string().min(1).max(80),
  ecdhPublicKey: B64U.max(200),
  /** The WebAuthn attestation (RegistrationResponseJSON). The Host verifies it, not the Relay. */
  registration: z.record(z.string(), z.unknown()),
  pushSubscription: z
    .object({
      endpoint: z.string().url().max(2000),
      keys: z.object({ p256dh: B64U.max(200), auth: B64U.max(100) }),
    })
    .optional(),
})

export const PairingStatus = z.object({
  status: z.enum(["waiting", "registered", "confirmed", "expired"]),
  registration: PhoneRegistration.optional(),
  phoneId: z.string().optional(),
})

export const ConfirmPairing = z.object({
  credentialId: B64U.max(2000),
  /** COSE public key of the passkey, base64url, verified and pinned by the Host. */
  credentialPublicKey: B64U.max(2000),
  counter: z.number().int().min(0),
})

export const DeviceRequest = z.object({
  id: z.string().min(1).max(100),
  phoneId: z.string().min(1).max(100),
  sealed: SealedSchema,
  expiresAt: z.string(),
  priority: z.enum(["normal", "high"]).default("normal"),
})

export const DeviceNotify = z.object({
  phoneId: z.string().min(1).max(100),
  sealed: SealedSchema,
  kind: z.enum(["stop", "idle", "notify", "info"]),
})

export const PhoneEnvelopePost = z.object({
  requestId: z.string().min(1).max(100).optional(),
  /** Sealed to the Host's key. Holds the signed envelope, so the Relay sees neither the answer nor the text. */
  sealed: SealedSchema,
})

export const SessionChallengeRequest = z.object({ phoneId: z.string().min(1).max(100) })
export const SessionLogin = z.object({
  phoneId: z.string().min(1).max(100),
  assertion: z.record(z.string(), z.unknown()),
})

/** What a phone decision looks like once the Host has opened the sealed payload. */
export const SignedDecision = z.object({
  envelope: z.object({
    v: z.literal(1),
    type: z.enum(["decision", "answer", "kill"]),
    requestId: z.string().optional(),
    nonce: z.string().min(8).max(200),
    decision: z.enum(["allow", "deny"]).optional(),
    message: z.string().max(500).optional(),
    answers: z.record(z.string(), z.string().max(4000)).optional(),
    payloadHash: z.string().optional(),
    deviceId: z.string().min(1).max(100),
    issuedAt: z.string(),
    expiresAt: z.string(),
  }),
  /** AuthenticationResponseJSON from the passkey, over the challenge derived from the envelope. */
  assertion: z.record(z.string(), z.unknown()),
})
export type SignedDecision = z.infer<typeof SignedDecision>

/** The generic text a push shows when the user has not allowed details on the lock screen (invariant 9). */
export const GENERIC_PUSH = {
  request: "Approval needed",
  stop: "Session finished",
  idle: "Session waiting",
  notify: "Message from a session",
  info: "Gatehouse",
} as const

/** What the phone is shown, after decryption. The request id is the additional data of the seal. */
export const PhonePayload = z.object({
  id: z.string(),
  nonce: z.string(),
  kind: z.enum(["permission", "question", "plan"]),
  toolName: z.string(),
  input: z.unknown(),
  cwd: z.string(),
  project: z.string(),
  verdict: z.object({
    outcome: z.string(),
    ruleId: z.string(),
    reason: z.string(),
    risk: z.number(),
    segments: z
      .array(z.object({ text: z.string(), ruleId: z.string(), outcome: z.string() }))
      .optional(),
  }),
  createdAt: z.string(),
  expiresAt: z.string(),
})
export type PhonePayload = z.infer<typeof PhonePayload>
