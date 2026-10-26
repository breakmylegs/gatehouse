import { z } from "zod"
import { canonicalize, sha256Hex } from "../canonical.js"
import { Verdict } from "../contracts.js"

export const GENESIS_HASH = "0".repeat(64)

export const AuditChannel = z.enum(["approver", "host", "desktop", "phone", "timeout"])
export type AuditChannel = z.infer<typeof AuditChannel>

/**
 * One line of the audit log. Only strings, integers, booleans and the verdict appear, so a second
 * implementation (scripts/verify-audit.ps1) can recompute the hash without float formatting rules.
 * The tool input is stored as a canonical JSON string (already redacted) for the same reason.
 */
export const AuditRecord = z.object({
  v: z.literal(1),
  seq: z.number().int().min(1),
  ts: z.string(),
  session: z.string(),
  event: z.string().max(64),
  channel: AuditChannel,
  tool: z.string(),
  toolUseId: z.string().optional(),
  cwd: z.string().optional(),
  project: z.string().optional(),
  inputJson: z.string(),
  verdict: Verdict,
  latencyMs: z.number().int().min(0),
  judgeRationale: z.string().optional(),
  prevHash: z.string().regex(/^[0-9a-f]{64}$/),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
})
export type AuditRecord = z.infer<typeof AuditRecord>

/** What a caller supplies. Chain fields and the timestamp are added by the writer. */
export interface AuditEntry {
  session: string
  event: string
  channel: AuditChannel
  tool: string
  toolUseId?: string
  cwd?: string
  project?: string
  /** The tool input. It is redacted by the writer before it is stored. */
  input: unknown
  verdict: Verdict
  latencyMs: number
  judgeRationale?: string
}

export function hashRecord(record: Omit<AuditRecord, "hash">): string {
  return sha256Hex(canonicalize(record))
}

export const MONTH_FILE = /^audit-(\d{4})-(\d{2})\.jsonl$/

export function monthFileName(ts: string): string {
  return `audit-${ts.slice(0, 7)}.jsonl`
}

export interface AuditHead {
  seq: number
  hash: string
  file: string
}
