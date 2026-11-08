import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { listAuditFiles } from "@gatehouse/shared/audit"
import { writeZip } from "./update/zip.js"

/**
 * The audit log as a bundle anyone can check (backlog G30 and D9: the export was one joined file that neither verifier
 * could read). The bundle holds the month files as they are, a head.json for the last record copied (made from the
 * copy itself, so a record written meanwhile cannot make it disagree), a note on how to check it, and the PowerShell
 * verifier, so it can be checked without Node. The log is redacted as it is written, so the bundle is too. Changing
 * one byte of a record makes the check fail. It is not signed: as docs/audit-format.md says, the hashes are not keyed.
 */
export const BUNDLE_NOTE = `This is the Codehouse audit log: every decision, as a hash-chained record per line, one file per month.

To check that nothing in it was changed, removed or reordered, unzip it into a folder of its own and run:

  pwsh -NoProfile -File verify-audit.ps1 -Dir <that folder>

That needs PowerShell 7 (pwsh), not the Windows PowerShell 5.1 built into Windows.
From a Codehouse source checkout, npm run audit:verify -- <that folder> does the same with Node.

head.json names the last record in this bundle. Records written after the bundle was made are not in it.
`

/** Puts the bundle's files in `into`: the month files (a line cut off part way is left out), head.json, the note. */
export function stageAuditBundle(
  auditDir: string,
  into: string,
  verifier?: string,
): { records: number; files: string[] } {
  const files: string[] = []
  let last: { seq: number; hash: string; file: string } | undefined
  let records = 0
  for (const f of listAuditFiles(auditDir)) {
    let text = fs.readFileSync(path.join(auditDir, f), "utf8")
    // A record still being written has no line end yet: it belongs to the next bundle.
    if (text && !text.endsWith("\n")) text = text.slice(0, text.lastIndexOf("\n") + 1)
    if (!text) continue
    fs.writeFileSync(path.join(into, f), text)
    files.push(f)
    const lines = text.trimEnd().split("\n")
    records += lines.length
    const end = JSON.parse(lines.at(-1)!) as { seq: number; hash: string }
    last = { seq: end.seq, hash: end.hash, file: f }
  }
  if (last) {
    fs.writeFileSync(path.join(into, "head.json"), JSON.stringify(last) + "\n")
    files.push("head.json")
  }
  fs.writeFileSync(path.join(into, "VERIFY.txt"), BUNDLE_NOTE.replace(/\n/g, "\r\n"))
  files.push("VERIFY.txt")
  if (verifier && fs.existsSync(verifier)) {
    fs.copyFileSync(verifier, path.join(into, "verify-audit.ps1"))
    files.push("verify-audit.ps1")
  }
  return { records, files }
}

/** The bundle as a zip, made in a folder of its own under the temp folder and removed straight after. */
export async function makeAuditBundle(
  auditDir: string,
  verifier?: string,
): Promise<{ zip: Buffer; records: number }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-audit-"))
  try {
    const stage = path.join(dir, "bundle")
    fs.mkdirSync(stage)
    const { records, files } = stageAuditBundle(auditDir, stage, verifier)
    const out = path.join(dir, "audit.zip")
    await writeZip(out, stage, files, { date: new Date() })
    return { zip: fs.readFileSync(out), records }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
