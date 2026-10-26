import fs from "node:fs"
import type { Outcome } from "@gatehouse/shared"
import type { PolicyEngine } from "./engine.js"

/** The parts of an audit record the replay needs. Phase 2 writes richer records. */
export interface ReplayRecord {
  line: number
  toolName: string
  input: Record<string, unknown>
  cwd: string
  before: { outcome: Outcome; ruleId: string }
}

export interface ReplayChange {
  line: number
  toolName: string
  summary: string
  before: { outcome: Outcome; ruleId: string }
  after: { outcome: Outcome; ruleId: string; reason: string }
  outcomeChanged: boolean
}

export interface ReplayResult {
  total: number
  /** Lines that could not be read as a replayable record. */
  skipped: number[]
  changes: ReplayChange[]
}

const OUTCOMES = new Set(["allow", "deny", "escalate"])

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
}

export function parseReplayLine(text: string, line: number): ReplayRecord | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return undefined
  }
  const rec = asRecord(raw)
  if (!rec) return undefined
  const toolName = typeof rec.tool === "string" ? rec.tool : typeof rec.toolName === "string" ? rec.toolName : undefined
  const input = asRecord(rec.input)
  const cwd = typeof rec.cwd === "string" ? rec.cwd : undefined
  const verdict = asRecord(rec.verdict) ?? rec
  const outcome = verdict.outcome
  const ruleId = verdict.ruleId
  if (!toolName || !input || !cwd) return undefined
  if (typeof outcome !== "string" || !OUTCOMES.has(outcome) || typeof ruleId !== "string") return undefined
  return { line, toolName, input, cwd, before: { outcome: outcome as Outcome, ruleId } }
}

export function readReplayFile(file: string): { records: ReplayRecord[]; skipped: number[] } {
  const records: ReplayRecord[] = []
  const skipped: number[] = []
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/)
  lines.forEach((text, idx) => {
    if (text.trim() === "") return
    const rec = parseReplayLine(text, idx + 1)
    if (rec) records.push(rec)
    else skipped.push(idx + 1)
  })
  return { records, skipped }
}

function summarise(toolName: string, input: Record<string, unknown>): string {
  const main = input.command ?? input.file_path ?? input.notebook_path ?? input.path ?? input.url ?? input.query ?? input.pattern
  const text = typeof main === "string" ? main : JSON.stringify(input)
  return `${toolName}: ${text.length > 120 ? text.slice(0, 117) + "..." : text}`
}

/** Re-evaluates recorded calls and lists every one whose outcome would change under the engine. */
export async function replay(
  engine: PolicyEngine,
  records: readonly ReplayRecord[],
  skipped: number[] = [],
  opts: { includeRuleChanges?: boolean } = {},
): Promise<ReplayResult> {
  const changes: ReplayChange[] = []
  for (const rec of records) {
    const verdict = await engine.evaluate({ toolName: rec.toolName, input: rec.input }, { cwd: rec.cwd })
    const outcomeChanged = verdict.outcome !== rec.before.outcome
    const ruleChanged = verdict.ruleId !== rec.before.ruleId
    if (outcomeChanged || (opts.includeRuleChanges && ruleChanged)) {
      changes.push({
        line: rec.line,
        toolName: rec.toolName,
        summary: summarise(rec.toolName, rec.input),
        before: rec.before,
        after: { outcome: verdict.outcome, ruleId: verdict.ruleId, reason: verdict.reason },
        outcomeChanged,
      })
    }
  }
  return { total: records.length, skipped, changes }
}
