import crypto from "node:crypto"
import https from "node:https"
import tls from "node:tls"
import { tlsTarget } from "./pairing.js"

/**
 * How Codehouse trusts Neighbourhood Watch's certificate (ADR 0020, owner 20 Nov). caddy's own certificate authority
 * (an IP address or a home name) issues leaf certificates that last about 12 hours and get a new key each time, so a
 * pin on the leaf went stale within hours and the computer had to be paired again. Now:
 * - "root": caddy's root certificate, read from CNW (/agent/ca) at pairing and pinned. Every connection is verified
 *   properly against it alone, the chain and the address both (Node's own checks, rejectUnauthorized on), so a renewed
 *   leaf or intermediate under the same root is accepted and anything else is refused.
 * - "public": CNW has a certificate the system trusts (Let's Encrypt): checked against the system's store, as a browser
 *   would.
 * - "leaf": a pairing made before this, pinned on the leaf. It works while that leaf lasts, and moves to "root" by
 *   itself the first time it connects with the leaf still matching and CNW gives its root (connector.ts).
 */
export type Trust = { kind: "root"; pem: string; sha256: string } | { kind: "public" } | { kind: "leaf"; sha256: string }

const MAX_PEM = 16 * 1024

/** SHA-256 of a certificate's DER, from PEM. */
export const pemSha256 = (pem: string): string => crypto.createHash("sha256").update(new crypto.X509Certificate(pem).raw).digest("hex")

/** A self-signed CA certificate, as PEM, or a reason in words. */
export function checkRootPem(pem: unknown): string | { error: string } {
  if (typeof pem !== "string" || pem.length > MAX_PEM || !pem.includes("-----BEGIN CERTIFICATE-----") || /PRIVATE KEY/.test(pem))
    return { error: "Neighbourhood Watch did not give a root certificate." }
  try {
    const c = new crypto.X509Certificate(pem)
    if (!c.ca) return { error: "The certificate Neighbourhood Watch gave is not a certificate authority." }
    if (!c.verify(c.publicKey)) return { error: "The certificate Neighbourhood Watch gave is not a root (it is not self-signed)." }
    return c.toString()
  } catch {
    return { error: "The certificate Neighbourhood Watch gave could not be read." }
  }
}

/** TLS options that verify CNW properly under a trust: its chain to the pinned root (or the system's store) and its address. */
export function verifyOptions(t: Trust): { ca?: string[]; rejectUnauthorized: true } {
  return t.kind === "root" ? { ca: [t.pem], rejectUnauthorized: true } : { rejectUnauthorized: true }
}

/** Whether a verified connection to CNW succeeds under these options: undefined when it does, else the reason. */
export function verifies(url: URL, options: tls.ConnectionOptions, connect: typeof tls.connect = tls.connect): Promise<string | undefined> {
  return new Promise((resolve) => {
    const sock = connect({ ...tlsTarget(url), ...options, timeout: 15_000 })
    sock.once("secureConnect", () => {
      sock.end()
      resolve(sock.authorized ? undefined : String(sock.authorizationError ?? "not trusted"))
    })
    sock.once("timeout", () => (sock.destroy(), resolve("Neighbourhood Watch did not answer.")))
    sock.once("error", (e: NodeJS.ErrnoException) => resolve(e.code ?? e.message))
  })
}

/**
 * CNW's root certificate, read from /agent/ca over a connection that does not yet trust it: trust on first use, as
 * pairing always was. What comes back is only believed once a connection verifies against it (trustFor).
 */
export function readRoot(url: URL): Promise<string | undefined> {
  return new Promise((resolve) => {
    const req = https.request(new URL("/agent/ca", url), { method: "GET", rejectUnauthorized: false, timeout: 15_000, agent: false }, (res) => {
      let text = ""
      res.on("data", (c) => {
        text += c
        if (text.length > MAX_PEM) res.destroy()
      })
      res.on("end", () => resolve(res.statusCode === 200 ? text : undefined))
      res.on("error", () => resolve(undefined))
    })
    req.on("timeout", () => req.destroy())
    req.on("error", () => resolve(undefined))
    req.end()
  })
}

export interface TrustDeps {
  verifies?: typeof verifies
  readRoot?: typeof readRoot
}

/**
 * The trust to keep for CNW at this address, checked: the system's store if it verifies there, else CNW's root if a
 * connection verifies against it (chain and address). Undefined when CNW gives no root (an older CNW): the caller
 * keeps the leaf pin as before. Throws with a reason when CNW gives a root that its own certificate does not verify
 * against.
 */
export async function trustFor(url: URL, d: TrustDeps = {}): Promise<Trust | undefined> {
  const check = d.verifies ?? verifies
  if ((await check(url, { rejectUnauthorized: true })) === undefined) return { kind: "public" }
  const raw = await (d.readRoot ?? readRoot)(url)
  if (raw === undefined) return undefined
  const pem = checkRootPem(raw)
  if (typeof pem !== "string") throw new Error(pem.error)
  const why = await check(url, { ca: [pem], rejectUnauthorized: true })
  if (why) throw new Error(`Neighbourhood Watch's certificate does not check against the root it gave (${why}), so it is not trusted.`)
  return { kind: "root", pem, sha256: pemSha256(pem) }
}

/** The root's fingerprint as CNW's Server page shows it: SHA-256 in groups of four. */
export const grouped = (sha: string): string => sha.toUpperCase().match(/.{1,4}/g)?.join(" ") ?? ""
