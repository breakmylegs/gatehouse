import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { AuditRecord } from "./record.js"
import { listAuditFiles } from "./writer.js"
import type { AuditProblem } from "./verify.js"

/**
 * C-011: the check of a signed timeline export, beside the chain's own (verifyAudit). The export holds timeline.json
 * (one session's calls, made from the records in the same folder), head.json (the chain's last record), timeline.sig
 * (an ECDSA P-256 signature, SHA-256, IEEE P1363, over timeline.json's bytes followed by head.json's) and
 * timeline-key.json (the public key, a JWK). The signature must hold, and every entry must say what its records say.
 * scripts/verify-audit.ps1 makes the same check, written separately, so one verifier's bug does not hide a problem.
 */

export interface TimelineFile {
  version: 1
  session: string
  entries: Array<{
    seq: number
    tool: string
    outcome: string
    ruleId: string
    risk: number
    decidedBy: string
    records: number[]
  }>
}

/** The bytes the signature covers. */
export const signedBytes = (timeline: Buffer, head: Buffer) => Buffer.concat([timeline, head])

/** Problems with the timeline in `dir`, or none when there is no timeline.json there. */
export function verifyTimelineExport(dir: string): AuditProblem[] {
  const file = path.join(dir, "timeline.json")
  if (!fs.existsSync(file)) return []
  const problems: AuditProblem[] = []
  const add = (f: string, reason: string, seq?: number) => problems.push({ file: f, line: 0, ...(seq !== undefined ? { seq } : {}), reason })
  let timelineBytes: Buffer
  let head: Buffer
  try {
    timelineBytes = fs.readFileSync(file)
    head = fs.readFileSync(path.join(dir, "head.json"))
  } catch {
    add("head.json", "a timeline needs the head.json it was signed with")
    return problems
  }
  try {
    const jwk = JSON.parse(fs.readFileSync(path.join(dir, "timeline-key.json"), "utf8")) as crypto.JsonWebKey
    const key = crypto.createPublicKey({ key: jwk, format: "jwk" })
    const sig = Buffer.from(fs.readFileSync(path.join(dir, "timeline.sig"), "utf8").trim(), "base64")
    const ok = crypto.verify("sha256", signedBytes(timelineBytes, head), { key, dsaEncoding: "ieee-p1363" }, sig)
    if (!ok) add("timeline.sig", "the signature does not match timeline.json and head.json, so one of them was changed")
  } catch {
    add("timeline.sig", "the signature or its key could not be read")
  }
  let t: TimelineFile
  try {
    t = JSON.parse(timelineBytes.toString("utf8")) as TimelineFile
    if (t.version !== 1 || typeof t.session !== "string" || !Array.isArray(t.entries)) throw new Error("shape")
  } catch {
    add("timeline.json", "timeline.json is not a timeline")
    return problems
  }
  const bySeq = new Map<number, AuditRecord>()
  for (const f of listAuditFiles(dir))
    for (const raw of fs.readFileSync(path.join(dir, f), "utf8").split("\n")) {
      if (!raw) continue
      try {
        const r = AuditRecord.safeParse(JSON.parse(raw))
        if (r.success) bySeq.set(r.data.seq, r.data)
      } catch {
        // verifyAudit reports it.
      }
    }
  let prev = 0
  for (const e of t.entries) {
    if (!Array.isArray(e.records) || !e.records.length || e.records[0] !== e.seq) {
      add("timeline.json", "an entry's place is not its first record", e.seq)
      continue
    }
    if (e.seq <= prev) add("timeline.json", "the entries are not in audit order", e.seq)
    prev = e.seq
    let last: AuditRecord | undefined
    let before = 0
    for (const s of e.records) {
      const r = bySeq.get(s)
      if (!r) add("timeline.json", `record ${s} is not in this export`, e.seq)
      else if (r.session !== t.session) add("timeline.json", `record ${s} belongs to another session`, e.seq)
      if (s <= before) add("timeline.json", "an entry's records are not in order", e.seq)
      before = s
      last = r ?? last
    }
    if (
      last &&
      (last.tool !== e.tool ||
        last.verdict.outcome !== e.outcome ||
        last.verdict.ruleId !== e.ruleId ||
        last.verdict.risk !== e.risk ||
        last.verdict.decidedBy !== e.decidedBy)
    )
      add("timeline.json", "the entry does not say what its last record says", e.seq)
  }
  return problems
}
