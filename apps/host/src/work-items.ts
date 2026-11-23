/**
 * E-056, work item linkage (Expansion E5, the safe variant). Azure DevOps ids (AB#1234) and Jira keys (PROJ-123) are
 * found in a session's branch name, in its commits' messages and in the requirement ledger (D-033), and linked to the
 * session, the commits and their evidence packs (from D-030's session notes). The links are kept locally, per project,
 * and export as CSV or JSON. Nothing is sent to Azure DevOps or Jira: live sync through a claude.ai connector or the
 * gateway is on the list for IT.
 */
import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { readRequirements } from "./requirements.js"
import { sessionNotes } from "./slsa.js"

export interface WorkItemLink {
  item: string
  kind: "azure-devops" | "jira"
  /** What it is linked to. */
  to: "session" | "commit" | "evidence" | "requirement"
  ref: string
  /** Where the id was found. */
  from: "branch" | "commit message" | "session note" | "ledger"
}

/** Words that look like Jira keys but are not (character sets, protocols, common abbreviations). */
const NOT_JIRA = new Set(["UTF", "ISO", "SHA", "TLS", "SSL", "HTTP", "RFC", "CVE", "WCAG", "GDPR", "COVID", "ES", "TS", "GPT", "AES", "RSA"])

/** The work item ids in a text: AB#1234 and PROJ-123. */
export function itemsIn(text: string): Array<{ item: string; kind: WorkItemLink["kind"] }> {
  const out = new Map<string, WorkItemLink["kind"]>()
  for (const m of text.matchAll(/\bAB#(\d{1,8})\b/g)) out.set(`AB#${m[1]}`, "azure-devops")
  for (const m of text.matchAll(/(?<![\w-])([A-Z][A-Z0-9]{1,9})-(\d{1,7})(?![\w-])/g)) if (!NOT_JIRA.has(m[1]!)) out.set(`${m[1]}-${m[2]}`, "jira")
  return [...out].map(([item, kind]) => ({ item, kind }))
}

const git = (cwd: string, args: string[]) =>
  new Promise<string | undefined>((resolve) => execFile("git", args, { cwd, windowsHide: true, timeout: 20_000, maxBuffer: 32 * 1024 * 1024 }, (e, out) => resolve(e ? undefined : String(out))))

/** Every link the project's branch, commits, session notes and ledger give, for a session. */
export async function scanLinks(root: string, sessionId: string, cwd = root): Promise<WorkItemLink[]> {
  const links: WorkItemLink[] = []
  const add = (text: string, to: WorkItemLink["to"], ref: string, from: WorkItemLink["from"]) => {
    for (const { item, kind } of itemsIn(text)) links.push({ item, kind, to, ref, from })
  }
  const branch = ((await git(cwd, ["branch", "--show-current"])) ?? "").trim()
  if (branch) {
    add(branch, "session", sessionId, "branch")
    // The branch's own commits: since it left the default branch, or its last 200.
    const base = ((await git(cwd, ["merge-base", "HEAD", "origin/HEAD"])) ?? (await git(cwd, ["merge-base", "HEAD", "main"])) ?? "").trim()
    const log = (await git(cwd, ["log", "--format=%H%x00%s%x00%b%x01", base ? `${base}..HEAD` : "-200"])) ?? ""
    for (const entry of log.split("\x01")) {
      const [sha, subject, body] = entry.trim().split("\x00")
      if (!sha) continue
      for (const { item, kind } of itemsIn(branch)) links.push({ item, kind, to: "commit", ref: sha, from: "branch" })
      add(`${subject ?? ""}\n${body ?? ""}`, "commit", sha, "commit message")
    }
    // A commit's evidence pack, from its session note, carries the commit's items.
    const notes = sessionNotes(root, base ? `${base}..HEAD` : "-200")
    for (const n of notes) {
      const items = links.filter((l) => l.to === "commit" && l.ref === n.commit)
      for (const l of items) {
        if (n.evidence) links.push({ ...l, to: "evidence", ref: n.evidence, from: "session note" })
        links.push({ ...l, to: "session", ref: n.session, from: "session note" })
      }
    }
  }
  for (const r of readRequirements(root).requirements) add(`${r.title}\n${r.body}`, "requirement", r.id, "ledger")
  const seen = new Set<string>()
  return links.filter((l) => {
    const k = `${l.item}|${l.to}|${l.ref}`
    return seen.has(k) ? false : (seen.add(k), true)
  })
}

/** The links kept for each project, merged as new ones are found. */
export class WorkItemStore {
  constructor(readonly file: string) {}
  read(project: string): WorkItemLink[] {
    try {
      return (JSON.parse(fs.readFileSync(this.file, "utf8")) as { projects?: Record<string, WorkItemLink[]> }).projects?.[project.toLowerCase()] ?? []
    } catch {
      return []
    }
  }
  merge(project: string, links: WorkItemLink[]): WorkItemLink[] {
    let all: Record<string, WorkItemLink[]> = {}
    try {
      all = (JSON.parse(fs.readFileSync(this.file, "utf8")) as { projects?: Record<string, WorkItemLink[]> }).projects ?? {}
    } catch {
      // A first write.
    }
    const key = (l: WorkItemLink) => `${l.item}|${l.to}|${l.ref}`
    const have = new Map((all[project.toLowerCase()] ?? []).map((l) => [key(l), l]))
    for (const l of links) have.set(key(l), l)
    all[project.toLowerCase()] = [...have.values()].slice(-5000)
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify({ v: 1, projects: all }, null, 1))
    fs.renameSync(`${this.file}.tmp`, this.file)
    return all[project.toLowerCase()]!
  }
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) || /^[=+\-@]/.test(v) ? `"${v.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : v)

/** The links as CSV (a cell that a spreadsheet would read as a formula is quoted and escaped) or JSON. */
export function exportLinks(links: WorkItemLink[], format: "csv" | "json"): string {
  if (format === "json") return `${JSON.stringify(links, null, 2)}\n`
  return ["item,kind,linked to,ref,found in", ...links.map((l) => [l.item, l.kind, l.to, l.ref, l.from].map(csvCell).join(","))].join("\n") + "\n"
}
