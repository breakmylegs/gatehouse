import type { AuditRecord } from "@gatehouse/shared/audit"

/**
 * D-072 (frontier, Insight and evidence): what went wrong in agent work, sorted into kinds, per model and per project,
 * from the audit log alone. Pure functions over records, like analytics.ts, so they cannot change anything.
 *   loop                 the loop guard saw the same failure repeat (thrash_warned, thrash_paused)
 *   tool-error           a tool call failed (tool_failed, not a test)
 *   failing-test         a test command failed (tool_failed, a test)
 *   undo                 edits were put back (edit_files_reverted, files_undone, change_undone)
 *   contradicted-claim   what Claude said it did did not hold (claim_verified, denied)
 *   denial               the floor, the rules or a person said no
 */
export const FAILURE_KINDS = ["loop", "tool-error", "failing-test", "undo", "contradicted-claim", "denial"] as const
export type FailureKind = (typeof FAILURE_KINDS)[number]

type Rec = Pick<AuditRecord, "event" | "session"> & { project?: string; cwd?: string; inputJson?: string; verdict?: { outcome?: string; decidedBy?: string } }

/** A record's input, as the audit keeps it: a JSON string. */
const inputOf = (r: Rec): Record<string, unknown> => {
  try {
    const v = JSON.parse(r.inputJson ?? "{}") as unknown
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** The kind of failure one record shows, or undefined for one that is not a failure. */
export function classify(r: Rec): FailureKind | undefined {
  switch (r.event) {
    case "thrash_warned":
    case "thrash_paused":
      return "loop"
    case "tool_failed":
      return inputOf(r).test === true ? "failing-test" : "tool-error"
    case "edit_files_reverted":
    case "files_undone":
    case "change_undone":
      return "undo"
    case "claim_verified":
      return r.verdict?.outcome === "deny" ? "contradicted-claim" : undefined
    case "floor_deny":
      return "denial"
    case "evaluate_permission":
    case "human_decision":
      return r.verdict?.outcome === "deny" ? "denial" : undefined
    default:
      return undefined
  }
}

export interface Taxonomy {
  total: number
  byKind: Record<FailureKind, number>
  byProject: Array<{ project: string; total: number; byKind: Record<FailureKind, number> }>
  byModel: Array<{ model: string; total: number; byKind: Record<FailureKind, number> }>
}

const empty = (): Record<FailureKind, number> => Object.fromEntries(FAILURE_KINDS.map((k) => [k, 0])) as Record<FailureKind, number>

/** A project's name: the record's own, else its folder's last part. */
const projectOf = (r: Rec): string => r.project || (r.cwd ? r.cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop()! : "") || "no project"

/**
 * The taxonomy over records. A session's model is learnt from any of its records that names one (the session's own
 * records do), so a denial in a session counts for the model that session ran on.
 */
export function failureTaxonomy(records: Rec[]): Taxonomy {
  const modelOf = new Map<string, string>()
  for (const r of records) {
    const m = inputOf(r).model
    if (typeof m === "string" && m && r.session) modelOf.set(r.session, m.slice(0, 80))
  }
  const byKind = empty()
  const projects = new Map<string, Record<FailureKind, number>>()
  const models = new Map<string, Record<FailureKind, number>>()
  let total = 0
  for (const r of records) {
    const k = classify(r)
    if (!k) continue
    total++
    byKind[k]++
    const p = projectOf(r)
    const m = modelOf.get(r.session) ?? "unknown"
    ;(projects.get(p) ?? projects.set(p, empty()).get(p)!)[k]++
    ;(models.get(m) ?? models.set(m, empty()).get(m)!)[k]++
  }
  const rows = (map: Map<string, Record<FailureKind, number>>) =>
    [...map].map(([name, kinds]) => ({ name, total: Object.values(kinds).reduce((a, b) => a + b, 0), byKind: kinds })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
  return {
    total,
    byKind,
    byProject: rows(projects).map(({ name, ...x }) => ({ project: name, ...x })),
    byModel: rows(models).map(({ name, ...x }) => ({ model: name, ...x })),
  }
}

/** The file a tool call was about, from the session's folder, when it names one inside it (D-069). */
export function fileOf(input: unknown, cwd: string): { file?: string } {
  const o = input && typeof input === "object" ? (input as Record<string, unknown>) : {}
  const p = [o.file_path, o.notebook_path, o.path].find((v): v is string => typeof v === "string" && v.length > 0 && v.length < 1000)
  if (!p) return {}
  const norm = (x: string) => x.replace(/\\/g, "/").replace(/\/+$/, "")
  const root = norm(cwd)
  const abs = norm(/^([a-zA-Z]:)?\//.test(norm(p)) ? p : `${root}/${p}`)
  if (!abs.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return {}
  return { file: abs.slice(root.length + 1) }
}

/** A test run, from its command: what tool_failed records as test, never the command itself. */
export const TEST_COMMAND = /\b(vitest|jest|mocha|pytest|go test|cargo test|dotnet test|npm (run )?test|pnpm (run )?test|yarn test|npx playwright test|phpunit|rspec|ctest)\b/i
