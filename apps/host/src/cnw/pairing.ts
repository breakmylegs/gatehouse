import crypto from "node:crypto"
import https from "node:https"
import net from "node:net"
import os from "node:os"
import tls from "node:tls"
import { newComputerKey } from "./connector.js"
import { trustFor, verifyOptions, type Trust } from "./trust.js"

/**
 * O41: pairing this computer with Codehouse Neighbourhood Watch. You give CNW's address and the one-time code it
 * shows. Codehouse works out how to trust CNW (trust.ts, ADR 0020): the system's store for a public certificate, else
 * caddy's root certificate, read from CNW on first use and believed only once a connection verifies against it, chain
 * and address. It makes this computer's key pair, sends the public half with the code over a connection verified that
 * way, and keeps the private half sealed for this Windows user. Nothing of yours is sent: no credential, no token.
 * An older CNW that gives no root is pinned on its leaf certificate as before, and moves to its root once it can.
 */
export interface Pairing {
  url: string
  computerId: string
  /** The leaf certificate seen at pairing: an older Codehouse (after an undone update) still pins it. */
  certSha256: string
  /** ADR 0020: how this Codehouse trusts CNW. Absent in a pairing made before it: the leaf pin. */
  trust?: Trust
}

export function checkUrl(raw: string): URL {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    throw new Error("That is not an address. Give the one you browse to, such as https://cnw.home.arpa.")
  }
  if (u.protocol !== "https:") throw new Error("Neighbourhood Watch must be reached over https.")
  if (u.username || u.password) throw new Error("Leave the name and password out of the address.")
  return new URL(u.origin)
}

/**
 * Where to connect for a CNW address: the host without IPv6 brackets, the port (443 unless given), and the server
 * name only for a name. An IP address is never sent as the server name: TLS does not allow it, and Node warns
 * (DEP0123). CNW at an address answers with its default_sni certificate instead.
 */
export function tlsTarget(url: URL): { host: string; port: number; servername?: string } {
  const host = url.hostname.replace(/^\[|\]$/g, "")
  return { host, port: Number(url.port || 443), ...(net.isIP(host) ? {} : { servername: host }) }
}

/** SHA-256 of the certificate the server presents, read without trusting it. */
export function certFingerprint(url: URL, connect: typeof tls.connect = tls.connect): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = connect({ ...tlsTarget(url), rejectUnauthorized: false, timeout: 15_000 })
    sock.once("secureConnect", () => {
      const raw = sock.getPeerCertificate(false)?.raw
      sock.end()
      if (raw) resolve(crypto.createHash("sha256").update(raw).digest("hex"))
      else reject(new Error("No certificate came back."))
    })
    sock.once("timeout", () => (sock.destroy(), reject(new Error("Neighbourhood Watch did not answer."))))
    sock.once("error", (e) => reject(new Error(`Neighbourhood Watch could not be reached: ${e.message}`)))
  })
}

const sha256 = (raw: Buffer | undefined) => (raw ? crypto.createHash("sha256").update(raw).digest("hex") : "")

/**
 * POSTs JSON over a connection that accepts only the pinned certificate. The pin is checked as soon as TLS is up,
 * before the body (the pairing code and the public key) is written; a different certificate gets nothing.
 */
export function pinnedPost(url: URL, body: unknown, certSha256: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const data = JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) },
        rejectUnauthorized: false,
        timeout: 20_000,
        checkServerIdentity: () => undefined,
        // A fresh connection, so its handshake is seen here.
        agent: false,
      },
      (res) => {
        if (sha256((res.socket as tls.TLSSocket).getPeerCertificate?.(false)?.raw) !== certSha256) {
          res.destroy()
          return reject(new Error("The certificate changed during pairing."))
        }
        let text = ""
        res.on("data", (c) => (text += c))
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, json: JSON.parse(text || "{}") })
          } catch {
            reject(new Error("Neighbourhood Watch's answer could not be read."))
          }
        })
      },
    )
    req.on("timeout", () => req.destroy(new Error("Neighbourhood Watch did not answer.")))
    req.on("error", reject)
    req.once("socket", (socket) => {
      const sock = socket as tls.TLSSocket
      sock.once("secureConnect", () => {
        if (sha256(sock.getPeerCertificate?.(false)?.raw) === certSha256) return void req.end(data)
        req.destroy(new Error("The certificate changed during pairing, so nothing was sent."))
      })
    })
  })
}

/** POSTs JSON to CNW over a connection verified under a trust (the chain to the pinned root, or the system's store, and the address). */
export function verifiedPost(url: URL, body: unknown, trust: Trust): Promise<{ status: number; json: Record<string, unknown> }> {
  const data = JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) },
        ...verifyOptions(trust),
        ...(tlsTarget(url).servername ? { servername: tlsTarget(url).servername } : {}),
        timeout: 20_000,
        agent: false,
      },
      (res) => {
        let text = ""
        res.on("data", (c) => (text += c))
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, json: JSON.parse(text || "{}") })
          } catch {
            reject(new Error("Neighbourhood Watch's answer could not be read."))
          }
        })
      },
    )
    req.on("timeout", () => req.destroy(new Error("Neighbourhood Watch did not answer.")))
    req.on("error", (e: NodeJS.ErrnoException) => reject(new Error(`Neighbourhood Watch's certificate was not trusted, so nothing was sent (${e.code ?? e.message}).`)))
    req.end(data)
  })
}

export async function pair(
  rawUrl: string,
  code: string,
  label: string,
  d: {
    seal: (key: Buffer) => Promise<void>
    fingerprint?: (u: URL) => Promise<string>
    post?: typeof pinnedPost
    trust?: (u: URL) => Promise<Trust | undefined>
    verifiedPost?: typeof verifiedPost
  },
): Promise<Pairing> {
  const url = checkUrl(rawUrl)
  const trust = await (d.trust ?? trustFor)(url)
  const certSha256 = await (d.fingerprint ?? certFingerprint)(url)
  const key = newComputerKey()
  // With no label given, CNW lists the computer by its own name rather than as "A computer".
  const name = (label.trim() || os.hostname()).slice(0, 60)
  const body = { code: code.trim(), publicKey: key.publicKey, label: name }
  const target = new URL("/agent/pair", url)
  const r = trust ? await (d.verifiedPost ?? verifiedPost)(target, body, trust) : await (d.post ?? pinnedPost)(target, body, certSha256)
  if (r.status !== 200 || typeof r.json.computer !== "string")
    throw new Error(typeof r.json.error === "string" ? r.json.error : "Neighbourhood Watch did not accept the code.")
  await d.seal(key.privateKey)
  return { url: url.origin, computerId: r.json.computer, certSha256, ...(trust ? { trust } : {}) }
}
