import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import type { AuditRecord } from "@gatehouse/shared/audit"

/**
 * D-069 (frontier, Insight and evidence): the hotspot map. The files in a project most worth attention, ranked by how
 * often they change (churn, from git), how tangled they are (complexity: decision points), and how often agent work on
 * them goes wrong (failures from the audit: failed calls, edits put back). Each measure is scaled against the
 * project's largest, so no single one swamps the others. Read only: git log and the files, never a change.
 */
export interface Hotspot {
  file: string
  churn: number
  complexity: number
  failures: number
  score: number
}

/** The weights: churn and failure count most, complexity a little less. */
export const WEIGHTS = { churn: 0.4, complexity: 0.25, failures: 0.35 }

/** The ranking, from the three measures per file. A file with no churn and no failures is not a hotspot. */
export function rankHotspots(measures: Array<Omit<Hotspot, "score">>, top = 20): Hotspot[] {
  const max = (k: "churn" | "complexity" | "failures") => Math.max(1, ...measures.map((m) => m[k]))
  const mc = max("churn")
  const mx = max("complexity")
  const mf = max("failures")
  return measures
    .filter((m) => m.churn > 0 || m.failures > 0)
    .map((m) => ({ ...m, score: Math.round((WEIGHTS.churn * (m.churn / mc) + WEIGHTS.complexity * (m.complexity / mx) + WEIGHTS.failures * (m.failures / mf)) * 1000) / 1000 }))
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .slice(0, top)
}

/** Decision points in source code: branches, loops, catches and short-circuits, a plain count across languages. */
export function complexityOf(text: string): number {
  const code = text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, " ")
  return (code.match(/\b(if|for|while|case|catch|elif|except|foreach|when)\b|&&|\|\||\?\?|\?(?!\.)/g) ?? []).length
}

/** How many commits changed each file in the last `days`, from git; empty outside a repository. */
export function churnOf(root: string, days = 90): Promise<Map<string, number>> {
  return new Promise((resolve) =>
    execFile("git", ["-C", root, "log", `--since=${days}.days`, "--name-only", "--format=", "--no-renames"], { maxBuffer: 32 * 1024 * 1024, timeout: 30_000, windowsHide: true }, (e, out) => {
      const m = new Map<string, number>()
      if (!e) for (const line of String(out).split(/\r?\n/)) if (line.trim()) m.set(line.trim(), (m.get(line.trim()) ?? 0) + 1)
      resolve(m)
    }),
  )
}

/** Agent failures per file in this project, from the audit: failed calls on a file, and files put back. */
export function failuresOf(records: Array<Pick<AuditRecord, "event" | "cwd" | "inputJson">>, root: string): Map<string, number> {
  const m = new Map<string, number>()
  const here = path.resolve(root).toLowerCase()
  for (const r of records) {
    if (!r.cwd || path.resolve(r.cwd).toLowerCase() !== here) continue
    let input: Record<string, unknown> = {}
    try {
      input = JSON.parse(r.inputJson) as Record<string, unknown>
    } catch {
      continue
    }
    const files = r.event === "tool_failed" && typeof input.file === "string" ? [input.file] : r.event === "edit_files_reverted" && Array.isArray(input.files) ? input.files.filter((f): f is string => typeof f === "string") : []
    for (const f of files) m.set(f.replace(/\\/g, "/"), (m.get(f.replace(/\\/g, "/")) ?? 0) + 1)
  }
  return m
}

const SOURCE = /\.(m|c)?(t|j)sx?$|\.(py|cs|go|rs|java|kt|rb|php|ps1|swift|c|cc|cpp|h|hpp)$/i

/** The map for a project: its churn and failures, with each source file's complexity, ranked. */
export async function hotspots(root: string, records: Parameters<typeof failuresOf>[0], days = 90): Promise<Hotspot[]> {
  const churn = await churnOf(root, days)
  const failures = failuresOf(records, root)
  const files = new Set([...churn.keys(), ...failures.keys()].filter((f) => SOURCE.test(f)))
  const measures: Array<Omit<Hotspot, "score">> = []
  for (const file of [...files].slice(0, 2000)) {
    let complexity = 0
    try {
      const abs = path.join(root, file)
      if (fs.statSync(abs).size <= 1_000_000) complexity = complexityOf(fs.readFileSync(abs, "utf8"))
    } catch {
      continue // deleted since: not a hotspot now
    }
    measures.push({ file, churn: churn.get(file) ?? 0, complexity, failures: failures.get(file) ?? 0 })
  }
  return rankHotspots(measures)
}
