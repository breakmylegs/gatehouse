import { execFile } from "node:child_process"
import { readAdrs } from "./adr.js"
import { readNote, type LineageNote } from "./lineage.js"
import { withoutCredentials } from "./codehouse-action.js"

/**
 * D-081 (frontier, Insight and evidence): why is this code like this. For a line of a file: the commit that last
 * changed it (git blame), that commit's Codehouse note (D-030: the session, its audit record, its evidence pack), and
 * the ADRs that bear on it (D-038): one decided in the same session, one that names the commit, or one whose paths
 * cover the file. Every sentence of the answer cites one of them. It reads git and the project's files only.
 */
export interface Why {
  file: string
  line: number
  commit?: { sha: string; short: string; subject: string; author: string; date: string }
  /** The line is not committed yet. */
  uncommitted?: boolean
  note?: LineageNote
  adrs: Array<{ file: string; title: string; status: string; because: "same session" | "names the commit" | "covers the file" }>
  /** Each with what it cites. */
  answer: Array<{ text: string; cites: string }>
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile("git", args, { cwd, windowsHide: true, timeout: 15_000, maxBuffer: 4 * 1024 * 1024, env: withoutCredentials(process.env) }, (e, out) => (e ? reject(e) : resolve(String(out)))),
  )
}

/** The answer for one line (1-based) of a file inside the project (forward slashes, from its root). */
export async function whyLine(root: string, rel: string, line: number): Promise<Why> {
  const out: Why = { file: rel, line, adrs: [], answer: [] }
  let porcelain: string
  try {
    porcelain = await git(root, ["blame", "--porcelain", "-L", `${line},${line}`, "--", rel])
  } catch {
    out.answer.push({ text: "Git cannot say who changed this line: the file is not in the repository, or the line is past its end.", cites: rel })
    return out
  }
  const sha = /^([0-9a-f]{40,64}) /.exec(porcelain)?.[1]
  if (!sha || /^0+$/.test(sha)) {
    out.uncommitted = true
    out.answer.push({ text: "This line is not committed yet, so there is no commit, session note or decision behind it.", cites: rel })
    return out
  }
  const field = (k: string) => new RegExp(`^${k} (.*)$`, "m").exec(porcelain)?.[1]?.trim() ?? ""
  const when = Number(field("author-time"))
  out.commit = { sha, short: sha.slice(0, 7), subject: field("summary"), author: field("author"), date: when ? new Date(when * 1000).toISOString().slice(0, 10) : "" }
  out.answer.push({ text: `Commit ${out.commit.short} changed it last, on ${out.commit.date || "an unknown date"}: "${out.commit.subject}".`, cites: `commit ${sha}` })

  const note = await readNote(root, sha)
  if (note) {
    out.note = note
    out.answer.push({ text: `It was made in Codehouse session ${note.session}; the decisions behind it are in that session's audit, from record ${note.auditSeq}.`, cites: `refs/notes/codehouse on ${out.commit.short}` })
    if (note.evidence) out.answer.push({ text: `Its evidence pack is ${note.evidence.slice(0, 12)}.`, cites: `evidence ${note.evidence}` })
  } else out.answer.push({ text: "It carries no Codehouse note, so it was made outside Codehouse or before commits were noted.", cites: `commit ${sha}` })

  // An ADR that names the commit, by its short hash (the full one contains it).
  const grep = await git(root, ["grep", "-l", "-i", "-e", sha.slice(0, 7), "--", "docs/adr"]).catch(() => "")
  const naming = new Set(grep.split(/\r?\n/).filter(Boolean).map((f) => f.replace(/\\/g, "/")))
  for (const a of readAdrs(root)) {
    const because = note && a.session === note.session ? "same session" : naming.has(a.file) ? "names the commit" : a.paths?.(rel.toLowerCase()) ? "covers the file" : undefined
    if (!because) continue
    out.adrs.push({ file: a.file, title: a.title, status: a.status, because })
    out.answer.push({
      text: `Decision "${a.title}" (${a.status}) ${because === "same session" ? "was taken in the same session" : because === "names the commit" ? "names this commit" : "covers this file"}.`,
      cites: a.file,
    })
  }
  if (!out.adrs.length) out.answer.push({ text: "No recorded decision (ADR) bears on it.", cites: "docs/adr" })
  return out
}
