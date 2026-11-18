import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import type { Sealer } from "./totp.js"

/**
 * Web Push (owner, 17 Nov; deferred from uplift phase 3): CNW tells a closed tab or a locked phone that something waits.
 * Built on Node's own crypto, no new dependency:
 *   - VAPID (RFC 8292): CNW signs each push with its own P-256 key, made once and kept sealed in the data volume.
 *   - Message encryption (RFC 8291, aes128gcm): only the browser that subscribed can read a push; the push service
 *     (Apple's, Google's, Mozilla's, Microsoft's) carries ciphertext.
 * A subscription names where to post. CNW posts only to the known push services over https, never to an address a
 * page makes up, so a subscription cannot point CNW at its own private network.
 */
export interface Subscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/** The push services browsers use: CNW posts to these hosts only. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/]

/** A subscription CNW will use: an https endpoint at a known push service, and keys of the right sizes. */
export function checkSubscription(s: unknown): Subscription | string {
  const o = (s && typeof s === "object" ? s : {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }
  let url: URL
  try {
    url = new URL(String(o.endpoint ?? ""))
  } catch {
    return "That is not a push subscription."
  }
  if (url.protocol !== "https:" || url.port || url.username || url.password || String(o.endpoint).length > 1000) return "A push address must be a plain https address."
  if (!PUSH_HOSTS.some((h) => h.test(url.hostname))) return "That push service is not one CNW knows, so it is not used."
  const p256dh = typeof o.keys?.p256dh === "string" ? Buffer.from(o.keys.p256dh, "base64url") : Buffer.alloc(0)
  const auth = typeof o.keys?.auth === "string" ? Buffer.from(o.keys.auth, "base64url") : Buffer.alloc(0)
  if (p256dh.length !== 65 || p256dh[0] !== 4 || auth.length !== 16) return "The subscription's keys are not right."
  return { endpoint: url.toString(), keys: { p256dh: o.keys!.p256dh as string, auth: o.keys!.auth as string } }
}

const hmac = (key: Buffer, data: Buffer) => crypto.createHmac("sha256", key).update(data).digest()

/** RFC 8291: the body of one push, readable only by the subscription's browser. One record, padded with nothing. */
export function encrypt(sub: Subscription, plaintext: Buffer, salt = crypto.randomBytes(16)): Buffer {
  // A new key pair for every push, as the RFC asks.
  const ecdh = crypto.createECDH("prime256v1")
  ecdh.generateKeys()
  const asPublic = ecdh.getPublicKey()
  const uaPublic = Buffer.from(sub.keys.p256dh, "base64url")
  const authSecret = Buffer.from(sub.keys.auth, "base64url")
  const shared = ecdh.computeSecret(uaPublic)
  const prkKey = hmac(authSecret, shared)
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic, Buffer.from([1])])).subarray(0, 32)
  const prk = hmac(salt, ikm)
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01", "binary")).subarray(0, 16)
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01", "binary")).subarray(0, 12)
  const c = crypto.createCipheriv("aes-128-gcm", cek, nonce)
  // The last (and only) record ends with the delimiter 0x02.
  const body = Buffer.concat([c.update(Buffer.concat([plaintext, Buffer.from([2])])), c.final(), c.getAuthTag()])
  const header = Buffer.alloc(21)
  salt.copy(header, 0)
  header.writeUInt32BE(4096, 16)
  header.writeUInt8(asPublic.length, 20)
  return Buffer.concat([header, asPublic, body])
}

/** CNW's own key for signing pushes (VAPID), made once and kept sealed in the data volume. */
export class Vapid {
  readonly publicKey: string
  readonly #private: crypto.KeyObject
  constructor(dataDir: string, sealer: Sealer) {
    const file = path.join(dataDir, "vapid.json")
    let saved: { publicKey?: string; sealed?: string } = {}
    try {
      saved = JSON.parse(fs.readFileSync(file, "utf8"))
    } catch {
      saved = {}
    }
    let pkcs8: Buffer | undefined
    try {
      pkcs8 = saved.sealed ? sealer.open(saved.sealed) : undefined
    } catch {
      pkcs8 = undefined
    }
    if (!pkcs8 || !saved.publicKey) {
      const k = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" })
      pkcs8 = k.privateKey.export({ format: "der", type: "pkcs8" })
      const jwk = k.publicKey.export({ format: "jwk" })
      saved = { publicKey: Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]).toString("base64url"), sealed: sealer.seal(pkcs8) }
      const tmp = `${file}.${process.pid}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(saved), { mode: 0o600 })
      fs.renameSync(tmp, file)
    }
    this.publicKey = saved.publicKey!
    this.#private = crypto.createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" })
  }

  /** The Authorization header for a push to this endpoint: a JWT for its origin, signed with CNW's key, for 12 hours. */
  authorization(endpoint: string, subject: string, now = Date.now()): string {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url")
    const unsigned = `${b64({ typ: "JWT", alg: "ES256" })}.${b64({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })}`
    const sig = crypto.sign("sha256", Buffer.from(unsigned), { key: this.#private, dsaEncoding: "ieee-p1363" }).toString("base64url")
    return `vapid t=${unsigned}.${sig}, k=${this.publicKey}`
  }
}

/** Sends one push. "gone" when the browser has unsubscribed (the service answers 404 or 410), so it is forgotten. */
export async function sendPush(
  sub: Subscription,
  payload: unknown,
  vapid: Vapid,
  subject: string,
  post: (url: string, init: { method: string; headers: Record<string, string>; body: Buffer }) => Promise<{ status: number }> = (url, init) => fetch(url, { ...init, body: new Uint8Array(init.body), signal: AbortSignal.timeout(15_000) }),
): Promise<"sent" | "gone" | "failed"> {
  // Only to a known push service, checked again at the moment of sending.
  if (typeof checkSubscription(sub) === "string") return "failed"
  try {
    const r = await post(sub.endpoint, {
      method: "POST",
      headers: { TTL: "3600", Urgency: "high", "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", Authorization: vapid.authorization(sub.endpoint, subject) },
      body: encrypt(sub, Buffer.from(JSON.stringify(payload))),
    })
    return r.status === 404 || r.status === 410 ? "gone" : r.status >= 200 && r.status < 300 ? "sent" : "failed"
  } catch {
    return "failed"
  }
}
