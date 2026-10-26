import fs from "node:fs"
import path from "node:path"
import { AuditRecord, GENESIS_HASH, hashRecord, type AuditHead } from "./record.js"
import { headPath, listAuditFiles } from "./writer.js"

export interface AuditProblem {
  file: string
  /** 1-based line number, or 0 for a problem with the file or the log as a whole. */
  line: number
  seq?: number
  reason: string
}

export interface AuditVerifyResult {
  ok: boolean
  files: number
  records: number
  head?: { seq: number; hash: string }
  problems: AuditProblem[]
}

/**
 * Checks the whole chain: every record parses, seq counts up by one, prevHash links to the record
 * before (across month files), the hash matches the content, each record sits in the file for its
 * month, and head.json agrees with the end of the log. Reports every problem, then keeps going from
 * the record's own values so one bad record does not hide the rest.
 */
export function verifyAudit(dir: string): AuditVerifyResult {
  const problems: AuditProblem[] = []
  const files = listAuditFiles(dir)
  let prev: { seq: number; hash: string } = { seq: 0, hash: GENESIS_HASH }
  let records = 0

  for (const file of files) {
    const text = fs.readFileSync(path.join(dir, file), "utf8")
    const lines = text.split("\n")
    const endsWithNewline = text.endsWith("\n")
    if (!endsWithNewline && text.length > 0) {
      problems.push({
        file,
        line: lines.length,
        reason: "the file does not end with a newline (a torn final line)",
      })
    }
    lines.forEach((raw, idx) => {
      const lineNo = idx + 1
      const isFinalFragment = idx === lines.length - 1
      if (raw === "") {
        if (!isFinalFragment) problems.push({ file, line: lineNo, reason: "blank line" })
        return
      }
      let json: unknown
      try {
        json = JSON.parse(raw)
      } catch {
        problems.push({ file, line: lineNo, reason: "not valid JSON" })
        return
      }
      const parsed = AuditRecord.safeParse(json)
      if (!parsed.success) {
        problems.push({
          file,
          line: lineNo,
          reason: `not a valid audit record (${parsed.error.issues[0]?.path.join(".") ?? "shape"})`,
        })
        return
      }
      const rec = parsed.data
      records++
      if (rec.seq !== prev.seq + 1) {
        problems.push({
          file,
          line: lineNo,
          seq: rec.seq,
          reason: `seq ${rec.seq} does not follow ${prev.seq}`,
        })
      }
      if (rec.prevHash !== prev.hash) {
        problems.push({
          file,
          line: lineNo,
          seq: rec.seq,
          reason: "prevHash does not match the record before it",
        })
      }
      const { hash: _hash, ...body } = rec
      if (hashRecord(body) !== rec.hash) {
        problems.push({
          file,
          line: lineNo,
          seq: rec.seq,
          reason: "hash does not match the record content",
        })
      }
      if (`audit-${rec.ts.slice(0, 7)}.jsonl` !== file) {
        problems.push({
          file,
          line: lineNo,
          seq: rec.seq,
          reason: `timestamp ${rec.ts} belongs in a different month file`,
        })
      }
      prev = { seq: rec.seq, hash: rec.hash }
    })
  }

  const headFile = headPath(dir)
  let head: AuditHead | undefined
  if (fs.existsSync(headFile)) {
    try {
      head = JSON.parse(fs.readFileSync(headFile, "utf8")) as AuditHead
    } catch {
      problems.push({ file: "head.json", line: 0, reason: "head.json is not valid JSON" })
    }
  } else if (records > 0) {
    problems.push({ file: "head.json", line: 0, reason: "head.json is missing" })
  }
  if (head) {
    if (head.seq > prev.seq) {
      problems.push({
        file: "head.json",
        line: 0,
        reason: `the log ends at seq ${prev.seq} but head.json says ${head.seq}: records were removed from the end`,
      })
    } else if (head.seq < prev.seq) {
      problems.push({
        file: "head.json",
        line: 0,
        reason: `head.json is behind the log (${head.seq} against ${prev.seq})`,
      })
    } else if (head.hash !== prev.hash) {
      problems.push({
        file: "head.json",
        line: 0,
        reason: "head.json hash does not match the last record",
      })
    }
  }

  return {
    ok: problems.length === 0,
    files: files.length,
    records,
    head: records > 0 ? { seq: prev.seq, hash: prev.hash } : undefined,
    problems,
  }
}
