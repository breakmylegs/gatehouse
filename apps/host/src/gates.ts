/**
 * E-048, evidence gates between steps (Expansion E4). A gate stands between one step of work and the next, and the next
 * step waits until it passes. Gate types:
 *
 *   tests: verified      the session's latest claim that the tests pass was Verified (D-009)
 *   sealed: true         the project's held-out (sealed) checks pass, run now (D-003)
 *   mutation: 70         the session's latest mutation score is at least 70 (D-004)
 *   a11y: { report: .codehouse/a11y.json, baseline: .codehouse/a11y-baseline.json }
 *                        no Serious or Critical accessibility violation in the report (axe's JSON) that the baseline
 *                        does not have
 *   dod: <playbook id>   the playbook's checklist (E-053) is all met, with nothing left for a person
 *
 * A gate that cannot be read (no evidence yet, a missing or broken report, an error) fails closed: the next step does
 * not start, and the reason says what is missing.
 */
import type { ItemResult } from "./playbooks.js"

export type GateSpec =
  | { tests: "verified" }
  | { sealed: true }
  | { mutation: number }
  | { a11y: { report: string; baseline?: string } }
  | { dod: string }

export interface GateSources {
  /** The session's latest tests claim: true Verified, false otherwise; undefined when it made none. */
  testsVerified: () => Promise<boolean | undefined>
  sealedPass: () => Promise<boolean | undefined>
  mutationScore: () => Promise<number | undefined>
  /** A project file's text; undefined when it is not there or not inside the project. */
  readFile: (rel: string) => string | undefined
  dodItems: (playbook: string) => Promise<ItemResult[] | undefined>
}

export interface GateResult {
  pass: boolean
  reason: string
}

/** A gate from a workflow file; a reason when it is not one. */
export function parseGate(v: unknown): GateSpec | { error: string } {
  const o = (v ?? {}) as Record<string, unknown>
  if (o.tests === "verified") return { tests: "verified" }
  if (o.sealed === true) return { sealed: true }
  if (typeof o.mutation === "number" && o.mutation >= 0 && o.mutation <= 100) return { mutation: o.mutation }
  if (o.a11y && typeof (o.a11y as Record<string, unknown>).report === "string") {
    const a = o.a11y as { report: string; baseline?: unknown }
    return { a11y: { report: a.report, ...(typeof a.baseline === "string" ? { baseline: a.baseline } : {}) } }
  }
  if (typeof o.dod === "string" && o.dod.trim()) return { dod: o.dod.trim() }
  return { error: `not a gate Codehouse knows (tests: verified, sealed: true, mutation: N, a11y: { report }, dod: <playbook>): ${JSON.stringify(v).slice(0, 120)}` }
}

interface AxeViolation {
  id: string
  impact?: string
  nodes?: Array<{ target?: unknown }>
}

/** The Serious and Critical violations in an axe report, each as "rule at target". */
function seriousOf(text: string): Set<string> {
  const j = JSON.parse(text) as { violations?: AxeViolation[] } | Array<{ violations?: AxeViolation[] }>
  const reports = Array.isArray(j) ? j : [j]
  if (!reports.every((r) => Array.isArray(r?.violations))) throw new Error("it has no violations list")
  const out = new Set<string>()
  for (const r of reports)
    for (const v of r.violations!)
      if (v.impact === "serious" || v.impact === "critical")
        for (const n of v.nodes?.length ? v.nodes : [{ target: "" }]) out.add(`${v.id} at ${JSON.stringify(n.target ?? "")}`)
  return out
}

const unread = (what: string): GateResult => ({ pass: false, reason: `The gate could not be read (${what}), so it does not pass.` })

/** A gate checked now; anything it cannot read fails closed. */
export async function evaluateGate(g: GateSpec, s: GateSources): Promise<GateResult> {
  try {
    if ("tests" in g) {
      const v = await s.testsVerified()
      if (v === undefined) return unread("no claim that the tests pass has been checked yet")
      return v ? { pass: true, reason: "The tests were Verified." } : { pass: false, reason: "The latest claim that the tests pass was not Verified." }
    }
    if ("sealed" in g) {
      const v = await s.sealedPass()
      if (v === undefined) return unread("the sealed checks could not be run")
      return v ? { pass: true, reason: "The sealed checks pass." } : { pass: false, reason: "The sealed checks fail." }
    }
    if ("mutation" in g) {
      const v = await s.mutationScore()
      if (v === undefined) return unread("no mutation run has a score yet")
      return v >= g.mutation ? { pass: true, reason: `The mutation score is ${v}, at least ${g.mutation}.` } : { pass: false, reason: `The mutation score is ${v}, under ${g.mutation}.` }
    }
    if ("a11y" in g) {
      const report = s.readFile(g.a11y.report)
      if (report === undefined) return unread(`${g.a11y.report} is not there`)
      const now = seriousOf(report)
      const base = g.a11y.baseline ? s.readFile(g.a11y.baseline) : undefined
      if (g.a11y.baseline && base === undefined) return unread(`${g.a11y.baseline} is not there`)
      const before = base ? seriousOf(base) : new Set<string>()
      const added = [...now].filter((v) => !before.has(v))
      return added.length ? { pass: false, reason: `New Serious accessibility violations: ${added.slice(0, 5).join("; ")}${added.length > 5 ? `, and ${added.length - 5} more` : ""}.` } : { pass: true, reason: "No new Serious accessibility violations." }
    }
    const items = await s.dodItems(g.dod)
    if (!items) return unread(`there is no playbook ${g.dod}`)
    const open = items.filter((i) => i.status !== "met")
    return open.length ? { pass: false, reason: `The definition of done is not complete: ${open.map((i) => `${i.text} (${i.status === "person" ? "for a person to confirm" : i.why})`).join("; ")}.` } : { pass: true, reason: "The definition of done is complete." }
  } catch (e) {
    return unread((e as Error).message.slice(0, 200))
  }
}

export interface GatedStep {
  name: string
  run: () => Promise<void>
  /** Checked after the step; the next step waits until it passes. */
  gate?: GateSpec
}

/** Runs steps in order; a gate that does not pass stops the next step, with its reason. */
export async function runGatedSteps(steps: GatedStep[], s: GateSources): Promise<{ done: string[]; stoppedAfter?: string; reason?: string }> {
  const done: string[] = []
  for (const step of steps) {
    await step.run()
    done.push(step.name)
    if (!step.gate) continue
    const g = await evaluateGate(step.gate, s)
    if (!g.pass) return { done, stoppedAfter: step.name, reason: g.reason }
  }
  return { done }
}
