import crypto from "node:crypto"

/**
 * Pairing a computer (O41): CNW shows a one-time code, good for ten minutes and one use. The computer sends it with
 * the public half of a key pair it made; CNW keeps that key, and from then on the computer proves itself by signing a
 * fresh challenge at each connection. Codes are kept only as hashes.
 */
export const CODE_MS = 10 * 60_000

export interface PendingCode {
  hash: string
  expires: number
  label: string
}

export interface Computer {
  id: string
  label: string
  /** Ed25519 public key, SPKI DER, base64url. */
  publicKey: string
  pairedAt: string
}

const hashOf = (code: string) => crypto.createHash("sha256").update(code.replace(/[\s-]/g, "").toUpperCase()).digest("hex")

/** A code like "K7M2-9QXP": easy to type, no 0/O or 1/I. */
export function newCode(label: string, now = Date.now()): { code: string; pending: PendingCode } {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  const bytes = crypto.randomBytes(8)
  const raw = [...bytes].map((b) => alphabet[b % alphabet.length]).join("")
  const code = `${raw.slice(0, 4)}-${raw.slice(4)}`
  return { code, pending: { hash: hashOf(code), expires: now + CODE_MS, label: label.slice(0, 60) || "A computer" } }
}

/** Takes the code out of the list if it is good; one use. */
export function redeem(code: string, pending: PendingCode[], now = Date.now()): { pending: PendingCode[]; match?: PendingCode } {
  const h = hashOf(code)
  const live = pending.filter((p) => p.expires > now)
  const match = live.find((p) => crypto.timingSafeEqual(Buffer.from(p.hash), Buffer.from(h)))
  return { pending: live.filter((p) => p !== match), ...(match ? { match } : {}) }
}

/** Checks a public key is an Ed25519 key, and returns it as stored. */
export function checkPublicKey(b64: string): string | undefined {
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(b64, "base64url"), format: "der", type: "spki" })
    return key.asymmetricKeyType === "ed25519" ? b64 : undefined
  } catch {
    return undefined
  }
}

/** Whether `signature` is the computer's signature over `challenge`. */
export function verifyChallenge(computer: Computer, challenge: string, signature: string): boolean {
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(computer.publicKey, "base64url"), format: "der", type: "spki" })
    return crypto.verify(null, Buffer.from(challenge), key, Buffer.from(signature, "base64url"))
  } catch {
    return false
  }
}
