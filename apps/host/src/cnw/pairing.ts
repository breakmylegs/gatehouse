import crypto from "node:crypto"
import https from "node:https"
import tls from "node:tls"
import { newComputerKey } from "./connector.js"

/**
 * O41: pairing this computer with Codehouse Neighbourhood Watch. You give CNW's address and the one-time code it
 * shows. Codehouse reads CNW's certificate and pins its SHA-256 (trust on first use, so a home server with caddy's
 * own certificate authority works without installing it here; a later different certificate stops the connection),
 * makes this computer's key pair, sends the public half with the code over that pinned connection, and keeps the
 * private half sealed for this Windows user. Nothing of yours is sent: no credential, no token.
 */
export interface Pairing {
  url: string
  computerId: string
  certSha256: string
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

/** SHA-256 of the certificate the server presents, read without trusting it. */
export function certFingerprint(url: URL, connect: typeof tls.connect = tls.connect): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = connect({ host: url.hostname, port: Number(url.port || 443), servername: url.hostname, rejectUnauthorized: false, timeout: 15_000 })
    sock.once("secureConnect", () => {
      const raw = sock.getPeerCertificate(false)?.raw
      sock.end()
      raw ? resolve(crypto.createHash("sha256").update(raw).digest("hex")) : reject(new Error("No certificate came back."))
    })
    sock.once("timeout", () => (sock.destroy(), reject(new Error("Neighbourhood Watch did not answer."))))
    sock.once("error", (e) => reject(new Error(`Neighbourhood Watch could not be reached: ${e.message}`)))
  })
}

/** POSTs JSON over a connection that accepts only the pinned certificate. */
function pinnedPost(url: URL, body: unknown, certSha256: string): Promise<{ status: number; json: Record<string, unknown> }> {
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
      },
      (res) => {
        const sock = res.socket as tls.TLSSocket
        const raw = sock.getPeerCertificate?.(false)?.raw
        if (!raw || crypto.createHash("sha256").update(raw).digest("hex") !== certSha256) {
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
  },
): Promise<Pairing> {
  const url = checkUrl(rawUrl)
  const certSha256 = await (d.fingerprint ?? certFingerprint)(url)
  const key = newComputerKey()
  const r = await (d.post ?? pinnedPost)(new URL("/agent/pair", url), { code: code.trim(), publicKey: key.publicKey, label: label.slice(0, 60) }, certSha256)
  if (r.status !== 200 || typeof r.json.computer !== "string")
    throw new Error(typeof r.json.error === "string" ? r.json.error : "Neighbourhood Watch did not accept the code.")
  await d.seal(key.privateKey)
  return { url: url.origin, computerId: r.json.computer, certSha256 }
}
