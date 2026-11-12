/**
 * D-029, audit anchoring (Frontier build, Wave 2). The hash chain shows that records follow each other, but someone who
 * can write the log could rewrite an old record and every hash after it. An anchor is the chain's head (a record's seq
 * and hash) signed at a moment, kept apart from the log, so a record rewritten after it no longer has the hash the
 * anchor holds. Anchors signed on this computer, with a key Windows DPAPI keeps for this account, are marked weaker:
 * anyone who can act as this account could make new ones. This is the check both verifiers run (PowerShell's in
 * scripts/verify-audit.ps1).
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { canonicalize } from "../canonical-json.js"
import type { AuditProblem } from "./verify.js"

export interface LocalAnchor {
  v: 1
  seq: number
  hash: string
  ts: string
  /** Who signed: this computer's own key. */
  signer: "local"
  /** A local key's anchor is weaker than one signed with a passkey on a phone. */
  strength: "weaker"
  fingerprint: string
  /** ECDSA P-256 over SHA-256 of anchorMessage(), IEEE P1363, base64. */
  sig: string
}

/**
 * D-029b: an anchor you signed on your phone with its passkey (Face ID). The phone signed an envelope of type anchor
 * naming the record and its hash; the passkey's WebAuthn assertion over that envelope is kept, so it can be checked
 * with the phone's public key (in phones.json) without the Host or the Relay.
 */
export interface PhoneAnchor {
  v: 1
  seq: number
  hash: string
  ts: string
  signer: "phone"
  strength: "passkey"
  phone: string
  envelope: Record<string, unknown> & { type: "anchor"; anchor: { seq: number; hash: string } }
  /** base64url, as the passkey gave them. */
  assertion: { authenticatorData: string; clientDataJSON: string; signature: string }
}

export type Anchor = LocalAnchor | PhoneAnchor

/** What is signed: plain text, so the PowerShell verifier needs no canonical JSON for it. */
export const anchorMessage = (a: Pick<Anchor, "seq" | "hash" | "ts">) => `codehouse-anchor-v1\n${a.seq}\n${a.hash}\n${a.ts}`

export const anchorFile = (seq: number, phone = false) => `anchor-${String(seq).padStart(10, "0")}${phone ? "-p" : ""}.json`

/** Where anchors are kept: beside the audit folder. */
export const anchorsDirFor = (auditDir: string) => path.join(path.dirname(path.resolve(auditDir)), "anchors")

/** The anchors in a folder, oldest first. */
export function readAnchors(dir: string): Array<{ file: string; anchor?: Anchor }> {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => /^anchor-\d+(-p)?\.json$/.test(f))
    .sort()
    .map((file) => {
      try {
        return { file, anchor: JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as Anchor }
      } catch {
        return { file }
      }
    })
}

/**
 * Each anchor's signature, with the key in key.json, and that the record it names still has the hash it anchored.
 * `hashes` is each record's hash by seq, from the chain just read.
 */
export function verifyAnchors(dir: string, hashes: ReadonlyMap<number, string>): { anchors: number; problems: AuditProblem[] } {
  const problems: AuditProblem[] = []
  const all = readAnchors(dir)
  if (!all.length) return { anchors: 0, problems }
  // This computer's key, needed only for its own anchors.
  let key: crypto.KeyObject | undefined
  let keyMissing = false
  try {
    key = crypto.createPublicKey({ key: JSON.parse(fs.readFileSync(path.join(dir, "key.json"), "utf8")) as crypto.JsonWebKey, format: "jwk" })
  } catch {
    key = undefined
  }
  let phones: Record<string, crypto.JsonWebKey> = {}
  try {
    if (fs.existsSync(path.join(dir, "phones.json"))) phones = JSON.parse(fs.readFileSync(path.join(dir, "phones.json"), "utf8")) as typeof phones
  } catch {
    problems.push({ file: "anchors/phones.json", line: 0, reason: "the phones' keys could not be read" })
  }
  for (const { file, anchor: a } of all) {
    const where = `anchors/${file}`
    if (a?.v === 1 && a.signer === "phone" && Number.isInteger(a.seq) && typeof a.hash === "string") {
      if (!phoneAnchorVerifies(a, phones[a.phone]))
        problems.push({ file: where, line: 0, seq: a.seq, reason: "the passkey's signature does not verify, so the anchor was changed" })
    } else if (!a || a.v !== 1 || !Number.isInteger(a.seq) || typeof a.hash !== "string" || typeof (a as LocalAnchor).sig !== "string") {
      problems.push({ file: where, line: 0, reason: "not an anchor" })
      continue
    } else if (!key) keyMissing = true
    else {
      let ok = false
      try {
        ok = crypto.verify("sha256", Buffer.from(anchorMessage(a), "utf8"), { key, dsaEncoding: "ieee-p1363" }, Buffer.from((a as LocalAnchor).sig, "base64"))
      } catch {
        ok = false
      }
      if (!ok) problems.push({ file: where, line: 0, seq: a.seq, reason: "the anchor's signature does not verify, so the anchor was changed" })
    }
    const now = hashes.get(a.seq)
    if (now === undefined)
      problems.push({ file: where, line: 0, seq: a.seq, reason: `record ${a.seq}, which was anchored, is not in the log` })
    else if (now !== a.hash)
      problems.push({ file: where, line: 0, seq: a.seq, reason: `record ${a.seq} was changed after it was anchored on ${a.ts}` })
  }
  if (keyMissing) problems.push({ file: "anchors/key.json", line: 0, reason: "the anchors' key could not be read, so no anchor could be checked" })
  return { anchors: all.length, problems }
}

/**
 * D-029b: a phone anchor's passkey signature: the client data is a WebAuthn get over the envelope's challenge (sha256
 * of its canonical JSON, base64url), the envelope names this record and hash, and the ECDSA P-256 signature (DER) over
 * the authenticator data and the client data's sha256 verifies with the phone's key.
 */
export function phoneAnchorVerifies(a: PhoneAnchor, jwk: crypto.JsonWebKey | undefined): boolean {
  try {
    if (!jwk) return false
    const e = a.envelope
    if (e?.type !== "anchor" || e.anchor?.seq !== a.seq || e.anchor?.hash !== a.hash) return false
    const clientBytes = Buffer.from(a.assertion.clientDataJSON, "base64url")
    const client = JSON.parse(clientBytes.toString("utf8")) as { type?: string; challenge?: string }
    const challenge = crypto.createHash("sha256").update(canonicalize(e), "utf8").digest().toString("base64url")
    if (client.type !== "webauthn.get" || client.challenge !== challenge) return false
    const auth = Buffer.from(a.assertion.authenticatorData, "base64url")
    // User verified (Face ID), not only present.
    if (auth.length < 37 || (auth[32]! & 0x04) === 0) return false
    const signed = Buffer.concat([auth, crypto.createHash("sha256").update(clientBytes).digest()])
    const key = crypto.createPublicKey({ key: jwk, format: "jwk" })
    return crypto.verify("sha256", signed, { key, dsaEncoding: "der" }, Buffer.from(a.assertion.signature, "base64url"))
  } catch {
    return false
  }
}
