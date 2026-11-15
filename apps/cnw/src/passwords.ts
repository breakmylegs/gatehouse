import crypto from "node:crypto"

/**
 * Passwords hashed with Node's own scrypt (no native addon): N=2^15, r=8, p=1, a 16-byte salt, a 32-byte key, kept as
 * "scrypt$N$r$p$salt$key". Compared in constant time. A password is at least 12 characters.
 */
const N = 1 << 15
const R = 8
const P = 1
const KEY = 32
export const MIN_PASSWORD = 12

const scrypt = (password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    crypto.scrypt(password.normalize("NFKC"), salt, KEY, { N: n, r, p, maxmem: 256 * n * r }, (e, key) =>
      e ? reject(e) : resolve(key),
    ),
  )

export async function hashPassword(password: string): Promise<string> {
  if (password.length < MIN_PASSWORD) throw new Error(`A password needs at least ${MIN_PASSWORD} characters.`)
  const salt = crypto.randomBytes(16)
  const key = await scrypt(password, salt, N, R, P)
  return ["scrypt", N, R, P, salt.toString("base64url"), key.toString("base64url")].join("$")
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, key] = stored.split("$")
  if (kind !== "scrypt" || !salt || !key) return false
  const want = Buffer.from(key, "base64url")
  const got = await scrypt(password, Buffer.from(salt, "base64url"), Number(n), Number(r), Number(p)).catch(() => undefined)
  return got !== undefined && got.length === want.length && crypto.timingSafeEqual(got, want)
}
