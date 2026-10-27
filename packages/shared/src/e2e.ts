/**
 * End-to-end encryption between the Host and the phone, on WebCrypto only so the same file runs in Node 24
 * and in the iPhone's browser. Invariants 8, 9 and 12: the Relay only ever holds what this produces.
 *
 * Scheme: ephemeral ECDH P-256 to the recipient's public key, HKDF-SHA-256 with a random salt, AES-256-GCM
 * with a random 96-bit nonce, and the request id as additional authenticated data so a ciphertext cannot
 * be replayed against a different request.
 */

const subtle = (): SubtleCrypto => globalThis.crypto.subtle
const INFO = new TextEncoder().encode("gatehouse e2e v1")

export function b64u(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ""
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function unb64u(text: string): Uint8Array<ArrayBuffer> {
  const s = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4)
  const bin = atob(s)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export interface Sealed {
  v: 1
  /** Ephemeral public key, raw uncompressed P-256 point, base64url. */
  epk: string
  salt: string
  iv: string
  ct: string
}

export interface KeyPair {
  publicKey: CryptoKey
  privateKey: CryptoKey
}

export async function generateKeyPair(extractable = false): Promise<KeyPair> {
  const kp = await subtle().generateKey({ name: "ECDH", namedCurve: "P-256" }, extractable, [
    "deriveBits",
  ])
  return kp
}

export async function exportPublicKey(key: CryptoKey): Promise<string> {
  return b64u(await subtle().exportKey("raw", key))
}

export async function importPublicKey(raw: string): Promise<CryptoKey> {
  const bytes = unb64u(raw)
  if (bytes.length !== 65 || bytes[0] !== 4) throw new Error("not an uncompressed P-256 public key")
  return subtle().importKey("raw", bytes, { name: "ECDH", namedCurve: "P-256" }, true, [])
}

async function deriveAesKey(
  priv: CryptoKey,
  pub: CryptoKey,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const shared = await subtle().deriveBits({ name: "ECDH", public: pub }, priv, 256)
  const base = await subtle().importKey("raw", shared, "HKDF", false, ["deriveKey"])
  return subtle().deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: INFO },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  )
}

export async function seal(
  plaintext: Uint8Array<ArrayBuffer>,
  recipient: CryptoKey,
  aad: string,
): Promise<Sealed> {
  const eph = await generateKeyPair(false)
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)))
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)))
  const key = await deriveAesKey(eph.privateKey, recipient, salt)
  const ct = await subtle().encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) },
    key,
    plaintext,
  )
  return {
    v: 1,
    epk: await exportPublicKey(eph.publicKey),
    salt: b64u(salt),
    iv: b64u(iv),
    ct: b64u(ct),
  }
}

export async function open(
  sealed: Sealed,
  recipientPrivate: CryptoKey,
  aad: string,
): Promise<Uint8Array> {
  if (sealed.v !== 1) throw new Error("unknown sealed version")
  const key = await deriveAesKey(
    recipientPrivate,
    await importPublicKey(sealed.epk),
    unb64u(sealed.salt),
  )
  const pt = await subtle().decrypt(
    { name: "AES-GCM", iv: unb64u(sealed.iv), additionalData: new TextEncoder().encode(aad) },
    key,
    unb64u(sealed.ct),
  )
  return new Uint8Array(pt)
}

export async function sealJson(value: unknown, recipient: CryptoKey, aad: string): Promise<Sealed> {
  return seal(
    new TextEncoder().encode(JSON.stringify(value)) as Uint8Array<ArrayBuffer>,
    recipient,
    aad,
  )
}

export async function openJson<T = unknown>(
  sealed: Sealed,
  recipientPrivate: CryptoKey,
  aad: string,
): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await open(sealed, recipientPrivate, aad))) as T
}

export async function sha256(
  bytes: Uint8Array<ArrayBuffer> | string,
): Promise<Uint8Array<ArrayBuffer>> {
  const data =
    typeof bytes === "string" ? (new TextEncoder().encode(bytes) as Uint8Array<ArrayBuffer>) : bytes
  return new Uint8Array(await subtle().digest("SHA-256", data))
}

/**
 * Six digits both screens show, derived from both public keys and the passkey id, so the user can see that
 * the phone and the desktop agree about who they are talking to (step 3 and 4 of pairing).
 */
export async function fingerprint(parts: {
  hostPublicKey: string
  phonePublicKey: string
  credentialId: string
}): Promise<string> {
  const h = await sha256(
    `gatehouse pair v1\n${parts.hostPublicKey}\n${parts.phonePublicKey}\n${parts.credentialId}`,
  )
  const n = ((h[0]! << 24) | (h[1]! << 16) | (h[2]! << 8) | h[3]!) >>> 0
  return String(n % 1_000_000).padStart(6, "0")
}
