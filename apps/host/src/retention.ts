/**
 * E-066, retention and legal hold (Expansion E5, the safe variant). How long Codehouse keeps what it keeps, by the
 * project's data classification (D-085): evidence packs (D-003) and the log viewer's lines (E-038). A legal hold on a
 * project, or on every project, suspends deletion: what it covers survives past its retention until the hold is
 * released. Deletion never follows a link or a junction out of its folder (each store's own prune), and audit files
 * are never deleted: they are not a kind retention knows. Traces (E-040) are kept in memory only and go when
 * Codehouse closes; the transcripts Claude Code keeps are its own and are not touched. Audit retention depends on
 * audit anchoring (D-029) and is listed for security and legal to decide.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "@gatehouse/shared/node"
import { classificationOf, type Classification } from "./boundary.js"

export type RetentionKind = "evidence" | "logs"
export const RETENTION_KINDS: RetentionKind[] = ["evidence", "logs"]

/** Days kept, by classification; more sensitive data is kept no longer than less sensitive data. */
export const DEFAULT_RETENTION: Record<Classification, Record<RetentionKind, number>> = {
  public: { evidence: 90, logs: 7 },
  internal: { evidence: 90, logs: 7 },
  confidential: { evidence: 90, logs: 3 },
  restricted: { evidence: 60, logs: 1 },
}

export interface RetentionConfig {
  dataClassification?: Parameters<typeof classificationOf>[0]
  /** Your days by classification and kind; what is not set comes from the defaults. */
  retention?: Partial<Record<Classification, Partial<Record<RetentionKind, number>>>>
  /** The settings that came before this, used for internal and public when set. */
  evidence?: { retentionDays?: number }
  logRetentionDays?: number
}

/** How many days a kind is kept for a project. */
export function retentionDays(c: RetentionConfig, kind: RetentionKind, project: string | undefined): number {
  const cls = classificationOf(c.dataClassification, project)
  const own = c.retention?.[cls]?.[kind]
  if (typeof own === "number" && own > 0) return own
  const earlier = kind === "evidence" ? c.evidence?.retentionDays : c.logRetentionDays
  const base = DEFAULT_RETENTION[cls][kind]
  // An earlier setting still holds, but never keeps sensitive data longer than its classification's default.
  return typeof earlier === "number" && earlier > 0 ? (cls === "public" || cls === "internal" ? earlier : Math.min(earlier, base)) : base
}

export interface Hold {
  id: string
  /** The project it covers; undefined for every project. */
  project?: string
  /** The kind it covers; undefined for every kind. */
  kind?: RetentionKind
  reason: string
  placedAt: string
}

type HoldsFile = { holds: Hold[] } & Record<string, unknown>

export class LegalHolds {
  readonly #file: string | undefined
  #data: HoldsFile = { holds: [] }

  constructor(file?: string) {
    this.#file = file
    if (file && fs.existsSync(file)) {
      try {
        const v = JSON.parse(fs.readFileSync(file, "utf8")) as HoldsFile
        if (v && Array.isArray(v.holds)) this.#data = v
      } catch {
        // A hold file that cannot be read holds everything (fail closed): nothing is deleted until it is fixed.
        this.#data = { holds: [{ id: "unreadable", reason: "the legal hold file could not be read, so every deletion waits", placedAt: new Date(0).toISOString() }] }
      }
    }
  }

  list(): Hold[] {
    return this.#data.holds.map((h) => ({ ...h }))
  }

  /** Whether deletion of this project's kind is suspended. */
  held(project: string | undefined, kind: RetentionKind): boolean {
    return this.#data.holds.some((h) => (h.project === undefined || (project !== undefined && h.project.toLowerCase() === project.toLowerCase())) && (h.kind === undefined || h.kind === kind))
  }

  async place(h: { project?: string; kind?: RetentionKind; reason: string }, now = new Date()): Promise<Hold> {
    const hold: Hold = { id: crypto.randomBytes(6).toString("hex"), ...(h.project ? { project: h.project } : {}), ...(h.kind ? { kind: h.kind } : {}), reason: h.reason, placedAt: now.toISOString() }
    this.#data.holds.push(hold)
    await this.#save()
    return hold
  }

  async release(id: string): Promise<Hold | undefined> {
    const at = this.#data.holds.findIndex((h) => h.id === id)
    if (at < 0) return undefined
    const [gone] = this.#data.holds.splice(at, 1)
    await this.#save()
    return gone
  }

  async #save(): Promise<void> {
    if (!this.#file) return
    fs.mkdirSync(path.dirname(this.#file), { recursive: true })
    await writeFileAtomic(this.#file, JSON.stringify(this.#data, null, 2) + "\n")
  }
}
