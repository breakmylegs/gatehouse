import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

/**
 * Uplift phase 4 (owner, 17 Nov): a second factor that works at an IP address, where passkeys cannot: a six-digit
 * code from an authenticator app (TOTP, RFC 6238: HMAC-SHA1, 30-second steps), with ten single-use recovery codes.
 * Built on Node's own crypto, no new dependency. The secret is kept sealed (AES-256-GCM) with a key made once in the
 * data volume and readable only by CNW; a code once used cannot be used again.
 */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

export function base32(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ""
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

export function unbase32(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "")
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const i = B32.indexOf(ch)
    if (i < 0) throw new Error("not base32")
    value = (value << 5) | i
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** The code for one 30-second step. */
export function codeAt(secret: Buffer, step: number): string {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(step))
  const h = crypto.createHmac("sha1", secret).update(msg).digest()
  const o = h[h.length - 1]! & 15
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!
  return String(n % 1_000_000).padStart(6, "0")
}

/**
 * Checks a code against the step now and one either side (a phone's clock a little off). Returns the step it matched,
 * which must be later than the last one used, so a code seen over a shoulder cannot be used again.
 */
export function verifyCode(secret: Buffer, code: string, now: number, lastStep = -1): number | undefined {
  const c = code.replace(/\s/g, "")
  if (!/^\d{6}$/.test(c)) return undefined
  const step = Math.floor(now / 30_000)
  for (const s of [step - 1, step, step + 1]) {
    if (s <= lastStep) continue
    const want = codeAt(secret, s)
    if (crypto.timingSafeEqual(Buffer.from(want), Buffer.from(c))) return s
  }
  return undefined
}

export const newSecret = (): Buffer => crypto.randomBytes(20)

/** What an authenticator app takes, as a link (and later a QR code). */
export const otpauthUri = (account: string, secret: Buffer): string =>
  `otpauth://totp/${encodeURIComponent(`Neighbourhood Watch:${account}`)}?secret=${base32(secret)}&issuer=${encodeURIComponent("Neighbourhood Watch")}&algorithm=SHA1&digits=6&period=30`

/** Ten recovery codes, each used once, kept only as hashes. */
export function recoveryCodes(): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: 10 }, () => {
    const raw = base32(crypto.randomBytes(7)).slice(0, 10).toLowerCase()
    return `${raw.slice(0, 5)}-${raw.slice(5)}`
  })
  return { codes, hashes: codes.map(hashRecovery) }
}
export const hashRecovery = (code: string): string => crypto.createHash("sha256").update(code.trim().toLowerCase().replace(/\s/g, "")).digest("hex")

/** Seals secrets with a key made once in the data folder (0600), for the TOTP secret and, later, SMTP and push keys. */
export class Sealer {
  readonly #key: Buffer
  constructor(dataDir: string) {
    const file = path.join(dataDir, "seal.key")
    try {
      this.#key = Buffer.from(fs.readFileSync(file, "utf8").trim(), "base64")
      if (this.#key.length !== 32) throw new Error("bad key")
    } catch {
      fs.mkdirSync(dataDir, { recursive: true })
      this.#key = crypto.randomBytes(32)
      const tmp = `${file}.${process.pid}.tmp`
      fs.writeFileSync(tmp, this.#key.toString("base64"), { mode: 0o600 })
      fs.renameSync(tmp, file)
    }
  }
  seal(plain: Buffer): string {
    const iv = crypto.randomBytes(12)
    const c = crypto.createCipheriv("aes-256-gcm", this.#key, iv)
    const body = Buffer.concat([c.update(plain), c.final()])
    return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${body.toString("base64url")}`
  }
  open(sealed: string): Buffer {
    const [v, iv, tag, body] = sealed.split(".")
    if (v !== "v1" || !iv || !tag || body === undefined) throw new Error("not sealed")
    const d = crypto.createDecipheriv("aes-256-gcm", this.#key, Buffer.from(iv, "base64url"))
    d.setAuthTag(Buffer.from(tag, "base64url"))
    return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()])
  }
}
