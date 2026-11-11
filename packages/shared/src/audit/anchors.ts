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
import type { AuditProblem } from "./verify.js"

export interface Anchor {
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

/** What is signed: plain text, so the PowerShell verifier needs no canonical JSON for it. */
export const anchorMessage = (a: Pick<Anchor, "seq" | "hash" | "ts">) => `codehouse-anchor-v1\n${a.seq}\n${a.hash}\n${a.ts}`

export const anchorFile = (seq: number) => `anchor-${String(seq).padStart(10, "0")}.json`

/** Where anchors are kept: beside the audit folder. */
export const anchorsDirFor = (auditDir: string) => path.join(path.dirname(path.resolve(auditDir)), "anchors")

/** The anchors in a folder, oldest first. */
export function readAnchors(dir: string): Array<{ file: string; anchor?: Anchor }> {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => /^anchor-\d+\.json$/.test(f))
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
  let key: crypto.KeyObject | undefined
  try {
    key = crypto.createPublicKey({ key: JSON.parse(fs.readFileSync(path.join(dir, "key.json"), "utf8")) as crypto.JsonWebKey, format: "jwk" })
  } catch {
    problems.push({ file: "anchors/key.json", line: 0, reason: "the anchors' key could not be read, so no anchor could be checked" })
  }
  for (const { file, anchor: a } of all) {
    const where = `anchors/${file}`
    if (!a || a.v !== 1 || !Number.isInteger(a.seq) || typeof a.hash !== "string" || typeof a.sig !== "string") {
      problems.push({ file: where, line: 0, reason: "not an anchor" })
      continue
    }
    if (key) {
      let ok = false
      try {
        ok = crypto.verify("sha256", Buffer.from(anchorMessage(a), "utf8"), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(a.sig, "base64"))
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
  return { anchors: all.length, problems }
}
