/**
 * D-074, behaviour regression for Claude Code upgrades. Before the pinned Claude Code range (claude-range.ts) is widened,
 * the owner replays tasks of their own choosing in scratch folders, on the new version and within a spend cap
 * (`npm run behaviour:check`), and the report is compared with the one recorded for the current version: the decisions
 * its calls met, the tools it used, and whether each task's check passed. A task that no longer passes, one not run, or
 * a call the rules now deny or hold that they did not before blocks the range change (apps/host/test/claude-range.test.ts).
 * Tools used differently are noted, not blocking: two runs of the same model seldom take the same path.
 */
import fs from "node:fs"
import path from "node:path"

export interface BehaviourTask {
  id: string
  prompt: string
  /** The scratch folder's files, by relative path. */
  files?: Record<string, string>
  /** A command run in the folder afterwards; exit 0 is a pass. */
  check?: string
}

export interface TaskRecord {
  /** Each call's tool, in order. */
  tools: string[]
  /** Each call's decision: tool, outcome and rule. */
  decisions: Array<{ tool: string; outcome: "allow" | "deny" | "escalate"; ruleId: string }>
  /** Whether its check passed; absent when it has none. */
  passed?: boolean
  costUsd: number
  /** Why it was not run (the spend cap reached) or did not finish. */
  notRun?: string
}

export interface BehaviourReport {
  v: 1
  claudeCode: string
  at: string
  capUsd: number
  tasks: Record<string, TaskRecord>
}

export interface Comparison {
  /** What blocks the range change. */
  blocking: string[]
  /** What changed without blocking. */
  notes: string[]
}

const key = (d: TaskRecord["decisions"][number]) => `${d.tool} ${d.outcome} (${d.ruleId})`

/** The candidate's behaviour against the baseline's, task by task. */
export function compareBehaviour(baseline: BehaviourReport, candidate: BehaviourReport): Comparison {
  const blocking: string[] = []
  const notes: string[] = []
  for (const [id, before] of Object.entries(baseline.tasks)) {
    if (before.notRun) continue
    const after = candidate.tasks[id]
    if (!after || after.notRun) {
      blocking.push(`${id}: not run on Claude Code ${candidate.claudeCode}${after?.notRun ? ` (${after.notRun})` : ""}.`)
      continue
    }
    if (before.passed === true && after.passed !== true) blocking.push(`${id}: its check passed on ${baseline.claudeCode} and fails on ${candidate.claudeCode}.`)
    const held = new Set(before.decisions.filter((d) => d.outcome !== "allow").map(key))
    for (const k of new Set(after.decisions.filter((d) => d.outcome !== "allow").map(key)))
      if (!held.has(k)) blocking.push(`${id}: a call met ${k}, which it did not on ${baseline.claudeCode}.`)
    const was = new Set(before.tools)
    const now = new Set(after.tools)
    const added = [...now].filter((t) => !was.has(t))
    const dropped = [...was].filter((t) => !now.has(t))
    if (added.length) notes.push(`${id}: now also uses ${added.join(", ")}.`)
    if (dropped.length) notes.push(`${id}: no longer uses ${dropped.join(", ")}.`)
  }
  return { blocking, notes }
}

/** The committed reports: the baseline for the current version, and one for each version the range is widened to. */
export const BEHAVIOUR_DIR = "docs/behaviour"

/**
 * Whether widening the range to `to` is allowed: unchanged, or with a report for `to` that shows no regression against a
 * baseline that has tasks. Undefined when allowed; otherwise why not.
 */
export function rangeChangeBlocked(to: string, baseline: BehaviourReport | undefined, report: (version: string) => BehaviourReport | undefined): string | undefined {
  if (baseline?.claudeCode === to) return undefined
  if (!baseline || !Object.values(baseline.tasks).some((t) => !t.notRun))
    return `No behaviour baseline with tasks is recorded, so the range cannot be widened to ${to}. Run npm run behaviour:check on the current version first and commit it as ${BEHAVIOUR_DIR}/baseline.json.`
  const r = report(to)
  if (!r) return `Widening the range to ${to} needs a behaviour report for it: run npm run behaviour:check with Claude Code ${to} and commit ${BEHAVIOUR_DIR}/${to}.json.`
  if (r.claudeCode !== to) return `${BEHAVIOUR_DIR}/${to}.json was recorded on Claude Code ${r.claudeCode}, not ${to}.`
  const c = compareBehaviour(baseline, r)
  return c.blocking.length ? `Claude Code ${to} behaves differently:\n${c.blocking.join("\n")}` : undefined
}

/** A committed report, read tolerantly; undefined when it is missing or not one. */
export function readReport(file: string): BehaviourReport | undefined {
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<BehaviourReport>
    return v.v === 1 && typeof v.claudeCode === "string" && v.tasks && typeof v.tasks === "object" ? (v as BehaviourReport) : undefined
  } catch {
    return undefined
  }
}

/** The owner's tasks, from a file of theirs; a task without an id or prompt, or with a path outside its folder, is left out. */
export function readTasks(file: string): BehaviourTask[] {
  const v = JSON.parse(fs.readFileSync(file, "utf8")) as { tasks?: unknown }
  const list = Array.isArray(v.tasks) ? (v.tasks as Array<Partial<BehaviourTask>>) : []
  return list.filter(
    (t): t is BehaviourTask =>
      typeof t.id === "string" && /^[\w-]{1,60}$/.test(t.id) && typeof t.prompt === "string" && !!t.prompt.trim() &&
      Object.keys(t.files ?? {}).every((p) => !path.isAbsolute(p) && !p.split(/[\\/]/).includes("..")),
  )
}
