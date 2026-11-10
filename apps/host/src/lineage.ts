/**
 * D-030, approval lineage on commits (Frontier build, Wave 1). After a session commits, the commit gets a git note
 * under refs/notes/codehouse naming the session and the audit record written for it: its sequence number and hash, the
 * head of the chain at that moment. The record names the commit, so the note resolves to it and verifies against the
 * chain. From Wave 2 the note also carries the evidence pack's hash (D-003).
 *
 * Codehouse's own bookkeeping, like its checkpoints: it changes nothing the session made and is not the session's
 * command, so it is not judged as one. It runs with no credential in its environment, names Codehouse as the author of
 * the notes commit only, and never pushes: notes are not pushed unless asked for by name, and Codehouse never asks.
 */
import { execFile } from "node:child_process"
import { withoutCredentials } from "./codehouse-action.js"
import type { HostAudit } from "./hostaudit.js"

export const NOTES_REF = "codehouse"

export interface LineageNote {
  codehouse: 1
  session: string
  /** The audit record written for this commit: the head of the chain when the note was made. */
  auditSeq: number
  auditHash: string
  at: string
  /** Wave 2 (D-003): the evidence pack's hash. */
  evidence?: string
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(
      "git",
      ["-c", "user.name=Codehouse", "-c", "user.email=codehouse@localhost", ...args],
      { cwd, windowsHide: true, timeout: 15_000, env: withoutCredentials(process.env) },
      (e, out) => (e ? reject(e) : resolve(String(out).trim())),
    ),
  )
}

/**
 * Notes the commit at HEAD: the audit record first (refused if it cannot be written, as every action here is), then
 * the note pointing at it. Returns the note, or undefined when there was no commit or nothing could be written.
 */
export async function noteCommit(o: {
  sessionId: string
  cwd: string
  project: string
  audit: Pick<HostAudit, "recordWithHash">
  log: (line: string) => void
}): Promise<LineageNote | undefined> {
  let commit: string
  try {
    commit = await git(o.cwd, ["rev-parse", "HEAD"])
  } catch {
    return undefined
  }
  if (!/^[0-9a-f]{40,64}$/.test(commit)) return undefined
  const rec = await o.audit.recordWithHash({
    session: o.sessionId,
    event: "commit_lineage_noted",
    channel: "host",
    tool: "git",
    cwd: o.cwd,
    project: o.project,
    input: { commit, ref: `refs/notes/${NOTES_REF}` },
    verdict: {
      outcome: "allow",
      ruleId: "commit-lineage",
      reason: "The session's commit was noted with its audit record, so its approvals can be traced.",
      risk: 0,
      decidedBy: "rules",
      policyHash: "",
    },
    latencyMs: 0,
  })
  if (!rec) {
    o.log("commit lineage: the audit record could not be written, so no note was made")
    return undefined
  }
  const note: LineageNote = { codehouse: 1, session: o.sessionId, auditSeq: rec.seq, auditHash: rec.hash, at: rec.ts }
  try {
    await git(o.cwd, ["notes", `--ref=${NOTES_REF}`, "add", "-f", "-m", JSON.stringify(note), commit])
    return note
  } catch (e) {
    o.log(`commit lineage: the note could not be added (${(e as Error).message.split("\n")[0]})`)
    return undefined
  }
}

/** The note on a commit, or undefined. */
export async function readNote(cwd: string, commit = "HEAD"): Promise<LineageNote | undefined> {
  try {
    const text = await git(cwd, ["notes", `--ref=${NOTES_REF}`, "show", commit])
    const n = JSON.parse(text) as LineageNote
    return n.codehouse === 1 ? n : undefined
  } catch {
    return undefined
  }
}
