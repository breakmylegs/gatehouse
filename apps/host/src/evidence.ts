/**
 * D-003, the change evidence pack (Frontier build, Wave 2). For a change (what a session did since a checkpoint, up to
 * a commit), one pack of what shows it was done properly: the decisions and approvals involved, the commands run with
 * how each ended, the done-claims Codehouse checked and the sealed checks it ran, the dependencies it changed (D-056's
 * SBOM), what the local analysis found (D-062) and the checkpoint it starts from. Every item taken from the audit log
 * carries that record's seq and hash, so it is tied to the chain. Coverage and mutation deltas are included only where
 * a run recorded them (none does yet), and the pack says so.
 *
 * Packs are kept under %LOCALAPPDATA%\Gatehouse\evidence, each file named by its sha256, redacted before it is written,
 * for 90 days by default; removing old ones never follows a link or a junction out of the folder. An export is the
 * session's signed timeline export (C-011) with the pack in it, signed the same way, so changing one byte fails both
 * verifiers.
 */
import { fitnessCheck, hasFitness, type FitnessResult } from "./fitness.js"
import { listFiles } from "./mutation.js"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import type { AuditRecord } from "@gatehouse/shared/audit"
import { writeFileAtomic } from "@gatehouse/shared/node"
import { isLockfile } from "@gatehouse/policy"
import type { HostAudit } from "./hostaudit.js"
import { languageOf } from "./outline.js"
import { addedLines, scanSource, type SastFinding } from "./sast.js"
import { lockfileChanges, sbomDiff, type DependencyChange } from "./sbom.js"
import { sessionRecords } from "./timeline.js"

export interface AuditLink {
  seq: number
  hash: string
}

export interface EvidencePack {
  v: 1
  session: string
  project: string
  createdAt: string
  range: { from: { ref: string; label: string; createdAt: string }; commit?: string }
  /** The audit chain's head when the pack was made. */
  head: AuditLink
  decisions: Array<AuditLink & { at: string; event: string; tool: string; summary: string; outcome: string; ruleId: string; decidedBy: string; channel: string; risk: number }>
  commands: Array<AuditLink & { command: string; result: "succeeded" | "failed" | "not seen"; exitCode?: number }>
  claims: Array<AuditLink & { claim: unknown }>
  sealedChecks: { runs: number; records: AuditLink[] }
  dependencies: { sbom?: string; added: number; changed: number; removed: number }
  findings: SastFinding[]
  files: Array<{ path: string; change: string; added: number; removed: number }>
  /** D-045: the project's fitness checks as the change leaves it. */
  fitness?: FitnessResult
  /** D-037: the assumptions Claude declared that you have not verified yet. */
  assumptions?: Array<{ id: string; text: string; check?: string; at: string }>
  /** What this pack does not hold, said plainly. */
  notes: string[]
}

/** The events that record how a call was decided: the Approver's, yours, the floor's, Extreme approval's. */
const DECIDED = /decision|permission|deny|allow|approv|escalat|timeout|judge/
const SHELL = new Set(["Bash", "PowerShell"])
const short = (s: string) => (s.length > 300 ? `${s.slice(0, 299)}…` : s)

function inputOf(r: AuditRecord): Record<string, unknown> {
  try {
    const v = JSON.parse(r.inputJson) as unknown
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** How each command Claude ran ended, from the post hooks, by tool use id. */
export class CommandResults {
  readonly #by = new Map<string, { result: "succeeded" | "failed"; exitCode?: number }>()

  succeeded(toolUseId: string): void {
    this.#by.set(toolUseId, { result: "succeeded", exitCode: 0 })
    this.#trim()
  }

  failed(toolUseId: string, error: string): void {
    const code = /exit code (\d+)/i.exec(error)?.[1]
    this.#by.set(toolUseId, { result: "failed", ...(code ? { exitCode: Number(code) } : {}) })
    this.#trim()
  }

  get(toolUseId: string | undefined) {
    return toolUseId ? this.#by.get(toolUseId) : undefined
  }

  #trim() {
    if (this.#by.size > 5000) this.#by.delete(this.#by.keys().next().value!)
  }
}

export interface PackInput {
  session: string
  project: string
  since: { ref: string; label: string; createdAt: string }
  commit?: string
  /** The session's audit records, oldest first. */
  records: AuditRecord[]
  head: AuditLink
  results: Pick<CommandResults, "get">
  files: Array<{ path: string; change: string; added: number; removed: number }>
  dependencies: DependencyChange[]
  sbomSha?: string
  findings: SastFinding[]
  assumptions?: Array<{ id: string; text: string; check?: string; at: string }>
  now?: () => Date
}

/** The pack for a change. Pure: everything it reads is given. */
export function buildPack(o: PackInput): EvidencePack {
  const from = Date.parse(o.since.createdAt)
  const inRange = o.records.filter((r) => Date.parse(r.ts) >= from)
  const link = (r: AuditRecord): AuditLink => ({ seq: r.seq, hash: r.hash })
  const decisions = inRange
    .filter((r) => DECIDED.test(r.event) && r.tool !== "claims")
    .map((r) => {
      const input = inputOf(r)
      const main = input.command ?? input.file_path ?? input.url ?? input.path ?? input.pattern ?? ""
      return {
        ...link(r),
        at: r.ts,
        event: r.event,
        tool: r.tool,
        summary: short(typeof main === "string" ? main : JSON.stringify(main)),
        outcome: r.verdict.outcome,
        ruleId: r.verdict.ruleId,
        decidedBy: r.verdict.decidedBy,
        channel: r.channel,
        risk: r.verdict.risk,
      }
    })
  // One entry per command: the last record of its call says how it was decided; the post hooks say how it ended.
  const calls = new Map<string, AuditRecord>()
  for (const r of inRange) if (SHELL.has(r.tool) && typeof inputOf(r).command === "string") calls.set(r.toolUseId ?? `seq-${r.seq}`, r)
  const commands = [...calls.values()]
    .filter((r) => r.verdict.outcome === "allow")
    .map((r) => {
      const got = o.results.get(r.toolUseId)
      return {
        ...link(r),
        command: short(String(inputOf(r).command)),
        result: got?.result ?? ("not seen" as const),
        ...(got?.exitCode !== undefined ? { exitCode: got.exitCode } : {}),
      }
    })
  const claims = inRange.filter((r) => r.event === "claim_verified").map((r) => ({ ...link(r), claim: inputOf(r) }))
  const sealed = inRange.filter((r) => /held_?out/i.test(r.event))
  const count = (k: DependencyChange["kind"]) => o.dependencies.filter((d) => d.kind === k).length
  return {
    v: 1,
    session: o.session,
    project: o.project,
    createdAt: (o.now ?? (() => new Date()))().toISOString(),
    range: { from: o.since, ...(o.commit ? { commit: o.commit } : {}) },
    head: o.head,
    decisions,
    commands,
    claims,
    sealedChecks: { runs: sealed.length, records: sealed.map(link) },
    dependencies: { ...(o.sbomSha ? { sbom: o.sbomSha } : {}), added: count("added"), changed: count("changed"), removed: count("removed") },
    findings: o.findings,
    ...(o.assumptions?.length ? { assumptions: o.assumptions } : {}),
    files: o.files,
    notes: [
      "Coverage and mutation deltas: none recorded for this change.",
      ...(commands.some((c) => c.result === "not seen")
        ? ["Some commands ran before Codehouse last started, so how they ended was not seen."]
        : []),
    ],
  }
}

export const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex")

/** Packs and the documents they point to, each a file named by its sha256, redacted first. */
export class EvidenceStore {
  readonly #dir: string
  readonly #redact: (text: string) => string

  constructor(o: { dir: string; redact: (text: string) => string }) {
    this.#dir = o.dir
    this.#redact = o.redact
  }

  /** Stores a JSON document, redacted, and gives its sha256. */
  async put(doc: unknown): Promise<string> {
    const text = this.#redact(`${JSON.stringify(doc, null, 1)}\n`)
    const sha = sha256(text)
    const file = path.join(this.#dir, `${sha}.json`)
    if (!fs.existsSync(file)) {
      fs.mkdirSync(this.#dir, { recursive: true })
      await writeFileAtomic(file, text)
    }
    return sha
  }

  /** A stored document, checked against its name. Undefined when it is missing or changed. */
  get<T = unknown>(sha: string): T | undefined {
    if (!/^[0-9a-f]{64}$/.test(sha)) return undefined
    try {
      const text = fs.readFileSync(path.join(this.#dir, `${sha}.json`), "utf8")
      return sha256(text) === sha ? (JSON.parse(text) as T) : undefined
    } catch {
      return undefined
    }
  }

  /** A stored document's exact text, checked against its name. */
  text(sha: string): string | undefined {
    if (!/^[0-9a-f]{64}$/.test(sha)) return undefined
    try {
      const text = fs.readFileSync(path.join(this.#dir, `${sha}.json`), "utf8")
      return sha256(text) === sha ? text : undefined
    } catch {
      return undefined
    }
  }

  /** A session's packs, newest first. */
  packs(session: string): Array<{ sha: string; pack: EvidencePack }> {
    if (!fs.existsSync(this.#dir)) return []
    const out: Array<{ sha: string; pack: EvidencePack }> = []
    for (const f of fs.readdirSync(this.#dir)) {
      const sha = /^([0-9a-f]{64})\.json$/.exec(f)?.[1]
      const pack = sha ? this.get<EvidencePack>(sha) : undefined
      if (sha && pack?.v === 1 && pack.session === session && Array.isArray(pack.decisions)) out.push({ sha, pack })
    }
    return out.sort((a, b) => b.pack.createdAt.localeCompare(a.pack.createdAt))
  }

  /**
   * Removes what is older than the retention. Only regular files directly in the folder are touched: a link or a
   * junction is never followed, so nothing outside the folder can be removed through one.
   */
  prune(days: number, now = Date.now()): number {
    if (!fs.existsSync(this.#dir) || fs.lstatSync(this.#dir).isSymbolicLink()) return 0
    let removed = 0
    for (const f of fs.readdirSync(this.#dir)) {
      if (!/^[0-9a-f]{64}\.json$/.test(f)) continue
      const p = path.join(this.#dir, f)
      const st = fs.lstatSync(p)
      if (!st.isFile() || st.isSymbolicLink()) continue
      if (now - st.mtimeMs > days * 86_400_000) {
        fs.rmSync(p, { force: true })
        removed++
      }
    }
    return removed
  }
}

/** Files read at once while a pack is made: git calls in parallel, a few at a time. */
const AT_ONCE = 8

interface ChangeSource {
  changes(cwd: string, sessionId: string, ref?: string): Promise<{
    since?: { ref: string; label: string; createdAt: string }
    files?: Array<{ path: string; change: string; added: number; removed: number; binary: boolean; diff: string }>
  }>
  versions(cwd: string, ref: string, file: string): Promise<{ before?: string; after?: string }>
}

export interface EvidenceDeps {
  store: EvidenceStore
  auditDir: string
  checkpoints: ChangeSource
  audit: Pick<HostAudit, "record">
  version: () => string
  retentionDays: () => number
  log: (line: string) => void
}

/** The chain's head, from head.json. */
function headOf(auditDir: string): AuditLink | undefined {
  try {
    const h = JSON.parse(fs.readFileSync(path.join(auditDir, "head.json"), "utf8")) as AuditLink
    return Number.isInteger(h.seq) && typeof h.hash === "string" ? { seq: h.seq, hash: h.hash } : undefined
  } catch {
    return undefined
  }
}

/** Makes, keeps and records a session's evidence packs. */
export class EvidenceService {
  readonly store: EvidenceStore
  readonly results = new CommandResults()
  readonly #o: EvidenceDeps

  constructor(o: EvidenceDeps) {
    this.store = o.store
    this.#o = o
  }

  /** The pack for what the session changed since a checkpoint (its first, by default), kept and recorded. */
  async build(s: { id: string; cwd: string; project: string; assumptions?: EvidencePack["assumptions"] }, o: { ref?: string; commit?: string } = {}): Promise<{ sha: string; pack: EvidencePack } | undefined> {
    const c = await this.#o.checkpoints.changes(s.cwd, s.id, o.ref)
    const head = headOf(this.#o.auditDir)
    if (!c.since || !head) return undefined
    const since = c.since
    const files = (c.files ?? []).map((f) => ({ path: f.path, change: f.change, added: f.added, removed: f.removed }))
    const readable = (p: string) => {
      const l = languageOf(p)
      return l !== undefined && l !== "json"
    }
    const wanted = (c.files ?? []).filter((f) => f.change !== "deleted" && !f.binary && (isLockfile(f.path) || readable(f.path)))
    const dependencies: DependencyChange[] = []
    const findings: SastFinding[] = []
    for (let i = 0; i < wanted.length; i += AT_ONCE)
      await Promise.all(
        wanted.slice(i, i + AT_ONCE).map(async (f) => {
          const v = await this.#o.checkpoints.versions(s.cwd, since.ref, f.path).catch(() => undefined)
          if (!v) return
          if (isLockfile(f.path)) dependencies.push(...lockfileChanges(f.path, v.before, v.after))
          else if (v.after !== undefined) {
            const lines = [...addedLines(f.diff).values()][0]
            if (lines?.size) findings.push(...(await scanSource(f.path, v.after, lines)))
          }
        }),
      )
    findings.sort((x, y) => x.file.localeCompare(y.file) || x.line - y.line)
    const sbomSha = dependencies.length
      ? await this.store.put(sbomDiff(dependencies, { project: s.project, version: this.#o.version(), describe: `changes since ${since.label} (${since.ref})` }))
      : undefined
    const pack = buildPack({
      session: s.id,
      project: s.project,
      since,
      ...(o.commit ? { commit: o.commit } : {}),
      records: sessionRecords(this.#o.auditDir, s.id),
      head,
      results: this.results,
      files,
      dependencies,
      ...(sbomSha ? { sbomSha } : {}),
      findings,
      ...(s.assumptions?.length ? { assumptions: s.assumptions } : {}),
    })
    const fit = hasFitness(s.cwd) ? await fitnessCheck(s.cwd, await listFiles(s.cwd).catch(() => [] as string[])).catch(() => undefined) : undefined
    if (fit) {
      pack.fitness = fit
      if (fit.failed) pack.notes.push(`${fit.failed} fitness check${fit.failed === 1 ? "" : "s"} fail, so this change does not pass the project's gate.`)
    }
    const sha = await this.store.put(pack)
    await this.#o.audit.record({
      session: s.id,
      event: "evidence_pack_built",
      channel: "host",
      tool: "evidence",
      cwd: s.cwd,
      project: s.project,
      input: { sha, decisions: pack.decisions.length, commands: pack.commands.length, findings: findings.length, ...(o.commit ? { commit: o.commit } : {}) },
      verdict: {
        outcome: "allow",
        ruleId: "evidence-pack",
        reason: "The change's evidence was gathered into one pack, tied to the audit log.",
        risk: 0,
        decidedBy: "rules",
        policyHash: "n/a",
      },
      latencyMs: 0,
    })
    return { sha, pack }
  }

  /** Removes packs older than the retention (90 days by default). */
  prune(): void {
    try {
      const n = this.store.prune(this.#o.retentionDays())
      if (n) this.#o.log(`evidence: ${n} file(s) older than ${this.#o.retentionDays()} days removed`)
    } catch (e) {
      this.#o.log(`evidence: old packs could not be removed (${(e as Error).message.slice(0, 120)})`)
    }
  }
}
