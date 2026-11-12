/**
 * D-031, evidence queries (Frontier build, Wave 3). Saved questions about the audit log: who approved what, every deny
 * for a project, every network call, every Extreme approval. They are answered from an index kept beside the log as
 * plain JSONL files, one per month, with only what the questions need; no database, nothing native. The index is
 * brought up to date before each query by reading only what the log gained since (it remembers each month file's
 * length), so a query over 100,000 records takes well under 2 seconds. Results are redacted again before they are given.
 */
import fs from "node:fs"
import path from "node:path"
import { AuditRecord, listAuditFiles } from "@gatehouse/shared/audit"
import { writeFileAtomic } from "@gatehouse/shared/node"

export interface IndexEntry {
  seq: number
  ts: string
  session: string
  project?: string
  tool: string
  event: string
  channel: string
  outcome: string
  ruleId: string
  decidedBy: string
  risk: number
  /** Whether the call reaches the network (a fetch, a search, or a shell command that downloads or sends). */
  net?: true
  summary: string
}

export type QueryTemplate = "who-approved" | "denies" | "network" | "extreme"

export const TEMPLATES: Record<QueryTemplate, { title: string; needsProject?: boolean; match: (e: IndexEntry, project?: string) => boolean }> = {
  "who-approved": {
    title: "Who approved what",
    match: (e) => e.outcome === "allow" && /^human-/.test(e.decidedBy),
  },
  denies: {
    title: "Every deny for a project",
    needsProject: true,
    match: (e, project) => e.outcome === "deny" && (!project || e.project === project),
  },
  network: {
    title: "Every network call",
    match: (e) => e.net === true,
  },
  extreme: {
    title: "Every Extreme approval",
    match: (e) => e.decidedBy === "extreme-mode",
  },
}

const NET_TOOLS = new Set(["WebFetch", "WebSearch"])
const NET_COMMAND = /\b(curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr|irm|ssh|scp|sftp|ftp|nc|ncat|git\s+(push|pull|fetch|clone)|npm\s+(install|i|publish|ci)|pnpm\s+(add|install|publish)|yarn\s+(add|install|publish)|pip\s+install|dotnet\s+(add|restore|nuget)|Start-BitsTransfer)\b|https?:\/\//i

function entryOf(r: AuditRecord): IndexEntry {
  let input: Record<string, unknown> = {}
  try {
    const v = JSON.parse(r.inputJson) as unknown
    if (v && typeof v === "object" && !Array.isArray(v)) input = v as Record<string, unknown>
  } catch {
    // keep the empty input
  }
  const main = input.command ?? input.url ?? input.query ?? input.file_path ?? input.path ?? input.pattern ?? ""
  const summary = (typeof main === "string" ? main : JSON.stringify(main)).slice(0, 200)
  const net = NET_TOOLS.has(r.tool) || ((r.tool === "Bash" || r.tool === "PowerShell") && NET_COMMAND.test(String(input.command ?? "")))
  return {
    seq: r.seq,
    ts: r.ts,
    session: r.session,
    ...(r.project ? { project: r.project } : {}),
    tool: r.tool,
    event: r.event,
    channel: r.channel,
    outcome: r.verdict.outcome,
    ruleId: r.verdict.ruleId,
    decidedBy: r.verdict.decidedBy,
    risk: r.verdict.risk,
    ...(net ? { net: true as const } : {}),
    summary,
  }
}

interface IndexState {
  v: 1
  /** For each month file: how many bytes of it are in the index. */
  read: Record<string, number>
}

export class AuditIndex {
  readonly #auditDir: string
  readonly #dir: string
  #busy: Promise<void> | undefined

  constructor(o: { auditDir: string; dir: string }) {
    this.#auditDir = o.auditDir
    this.#dir = o.dir
  }

  #stateFile() {
    return path.join(this.#dir, "state.json")
  }

  #state(): IndexState {
    try {
      const s = JSON.parse(fs.readFileSync(this.#stateFile(), "utf8")) as IndexState
      return s.v === 1 && s.read && typeof s.read === "object" ? s : { v: 1, read: {} }
    } catch {
      return { v: 1, read: {} }
    }
  }

  /** Brings the index up to date with the log, reading only what each month file gained. */
  update(): Promise<void> {
    this.#busy ??= this.#update().finally(() => (this.#busy = undefined))
    return this.#busy
  }

  async #update(): Promise<void> {
    fs.mkdirSync(this.#dir, { recursive: true })
    const state = this.#state()
    let changed = false
    for (const file of listAuditFiles(this.#auditDir)) {
      const p = path.join(this.#auditDir, file)
      const size = fs.statSync(p).size
      let from = state.read[file] ?? 0
      // A file shorter than what was read was replaced: index it again from the start.
      const out = path.join(this.#dir, file)
      if (size < from) {
        from = 0
        fs.rmSync(out, { force: true })
      }
      if (size === from) continue
      const fd = fs.openSync(p, "r")
      let text: string
      try {
        const buf = Buffer.alloc(size - from)
        fs.readSync(fd, buf, 0, buf.length, from)
        text = buf.toString("utf8")
      } finally {
        fs.closeSync(fd)
      }
      // Only whole lines: a record being written is read next time.
      const end = text.lastIndexOf("\n")
      if (end < 0) continue
      const lines: string[] = []
      for (const raw of text.slice(0, end).split("\n")) {
        if (!raw) continue
        try {
          const r = AuditRecord.safeParse(JSON.parse(raw))
          if (r.success) lines.push(JSON.stringify(entryOf(r.data)))
        } catch {
          // a damaged line: the verifier reports it
        }
      }
      if (lines.length) fs.appendFileSync(out, `${lines.join("\n")}\n`)
      state.read[file] = from + Buffer.byteLength(text.slice(0, end + 1), "utf8")
      changed = true
    }
    if (changed) await writeFileAtomic(this.#stateFile(), JSON.stringify(state))
  }

  /** A saved query's results, newest first, at most `limit`, redacted. */
  async query(template: QueryTemplate, o: { project?: string; limit?: number; redact: (text: string) => string }): Promise<{ results: IndexEntry[]; total: number }> {
    await this.update()
    const t = TEMPLATES[template]
    const limit = o.limit ?? 200
    const results: IndexEntry[] = []
    let total = 0
    const files = fs.existsSync(this.#dir) ? fs.readdirSync(this.#dir).filter((f) => /^audit-\d{4}-\d{2}\.jsonl$/.test(f)).sort().reverse() : []
    for (const f of files) {
      const lines = fs.readFileSync(path.join(this.#dir, f), "utf8").split("\n")
      for (let i = lines.length - 1; i >= 0; i--) {
        const raw = lines[i]
        if (!raw) continue
        // A quick look before parsing: most lines are not answers.
        if (template === "network" && !raw.includes('"net":true')) continue
        if (template === "extreme" && !raw.includes('"extreme-mode"')) continue
        if (template === "denies" && !raw.includes('"outcome":"deny"')) continue
        if (template === "who-approved" && !raw.includes('"human-')) continue
        let e: IndexEntry
        try {
          e = JSON.parse(raw) as IndexEntry
        } catch {
          continue
        }
        if (!t.match(e, o.project)) continue
        total++
        if (results.length < limit) results.push({ ...e, summary: o.redact(e.summary) })
      }
    }
    return { results, total }
  }
}
