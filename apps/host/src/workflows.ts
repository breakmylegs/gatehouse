/**
 * E-047, workflows as code (Expansion E4). `.codehouse/workflows/*.yml` defines a workflow's steps, each with a role
 * (E-046), a prompt, inputs (outputs of earlier steps, by `{{step.output}}`), outputs (an E-052 result schema the step's
 * session must end with), a gate (E-048) and an optional approval point. A workflow is validated and dry-run before it
 * starts: an invalid one is refused, with every problem named. Every step's start, result, gate and approval is
 * recorded. Progress is saved after each step, so after a restart a running workflow resumes from the last completed
 * step.
 *
 *   name: Feature
 *   steps:
 *     - { id: plan, role: planner, prompt: "Plan {{task}}", outputs: { type: object, required: [files], properties: { files: { type: array } } } }
 *     - { id: build, role: implementer, prompt: "Build the plan: {{plan.files}}", gate: { tests: verified } }
 *     - { id: review, role: reviewer, prompt: "Review the change", approval: true }
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { parseYaml } from "@gatehouse/policy"
import { parseGate, type GateSpec } from "./gates.js"
import type { Role } from "./roles.js"

export interface WorkflowStep {
  id: string
  role: string
  prompt: string
  outputs?: Record<string, unknown>
  gate?: GateSpec
  approval?: boolean
}

export interface Workflow {
  id: string
  name: string
  steps: WorkflowStep[]
}

/** A workflow read and checked against the project's roles; every problem named when it is not valid. */
export function validateWorkflow(id: string, text: string, roles: Role[]): { workflow: Workflow } | { problems: string[] } {
  let v: Record<string, unknown>
  try {
    v = parseYaml(text) as Record<string, unknown>
  } catch {
    return { problems: ["it is not valid YAML"] }
  }
  const problems: string[] = []
  const name = typeof v?.name === "string" && v.name.trim() ? v.name.trim() : ""
  if (!name) problems.push("it has no name")
  const raw = Array.isArray(v?.steps) ? (v.steps as Array<Record<string, unknown>>) : []
  if (!raw.length) problems.push("it has no steps")
  const seen = new Set<string>()
  const steps: WorkflowStep[] = []
  raw.forEach((s, i) => {
    const where = `step ${i + 1}`
    const sid = typeof s?.id === "string" && /^[\w-]{1,40}$/.test(s.id) ? s.id : ""
    if (!sid) problems.push(`${where} has no plain id`)
    else if (seen.has(sid)) problems.push(`${where} repeats the id ${sid}`)
    const role = typeof s?.role === "string" ? s.role : ""
    if (!roles.some((r) => r.name === role)) problems.push(`${where} names the role ${JSON.stringify(role)}, which roles.yml does not define`)
    const prompt = typeof s?.prompt === "string" ? s.prompt.trim() : ""
    if (!prompt) problems.push(`${where} has no prompt`)
    for (const m of prompt.matchAll(/\{\{\s*([\w-]+)(?:\.[\w-]+)*\s*\}\}/g)) if (m[1] !== "task" && !seen.has(m[1]!)) problems.push(`${where} uses {{${m[1]}...}}, which is not an earlier step`)
    let gate: GateSpec | undefined
    if (s?.gate !== undefined) {
      const g = parseGate(s.gate)
      if ("error" in g) problems.push(`${where}'s gate is ${g.error}`)
      else gate = g
    }
    if (s?.outputs !== undefined && (typeof s.outputs !== "object" || Array.isArray(s.outputs))) problems.push(`${where}'s outputs must be a JSON Schema object`)
    if (sid) seen.add(sid)
    steps.push({ id: sid, role, prompt, ...(s?.outputs && typeof s.outputs === "object" ? { outputs: s.outputs as Record<string, unknown> } : {}), ...(gate ? { gate } : {}), ...(s?.approval === true ? { approval: true } : {}) })
  })
  return problems.length ? { problems } : { workflow: { id, name, steps } }
}

/** What the workflow would do, step by step, without doing it. */
export function dryRun(w: Workflow): string[] {
  return w.steps.map((s, i) => `${i + 1}. ${s.id}: the ${s.role} role ${s.outputs ? "returns a result" : "works"}${s.gate ? `, then the gate ${JSON.stringify(s.gate)}` : ""}${s.approval ? ", then waits for your approval" : ""}`)
}

/** A prompt with {{task}} and {{step.path}} filled from the task and earlier steps' results. */
export function fill(prompt: string, task: string, outputs: Record<string, unknown>): string {
  return prompt.replace(/\{\{\s*([\w-]+)((?:\.[\w-]+)*)\s*\}\}/g, (_m, head: string, rest: string) => {
    if (head === "task") return task
    let v: unknown = outputs[head]
    for (const k of rest.split(".").filter(Boolean)) v = v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined
    return v === undefined ? "(not given)" : typeof v === "string" ? v : JSON.stringify(v)
  })
}

export interface RunState {
  runId: string
  workflow: string
  folder: string
  task: string
  /** Steps completed, in order. */
  done: string[]
  outputs: Record<string, unknown>
  status: "running" | "waiting-approval" | "stopped" | "done"
  reason?: string
}

/** Workflow runs, saved after each step, in the data folder. */
export class RunStore {
  constructor(readonly file: string) {}
  all(): RunState[] {
    try {
      return (JSON.parse(fs.readFileSync(this.file, "utf8")) as { runs?: RunState[] }).runs ?? []
    } catch {
      return []
    }
  }
  put(r: RunState): void {
    const runs = [...this.all().filter((x) => x.runId !== r.runId), r].slice(-50)
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify({ v: 1, runs }, null, 1))
    fs.renameSync(`${this.file}.tmp`, this.file)
  }
  get(runId: string): RunState | undefined {
    return this.all().find((r) => r.runId === runId)
  }
}

export interface StepDeps {
  /** Runs a step's session to the end of its turn; its structured result when it has outputs. */
  runStep: (step: WorkflowStep, prompt: string) => Promise<{ sessionId: string; result?: unknown; error?: string }>
  gate: (sessionId: string, g: GateSpec) => Promise<{ pass: boolean; reason: string }>
  record: (event: string, detail: Record<string, unknown>) => Promise<unknown>
}

export const newRun = (w: Workflow, folder: string, task: string): RunState => ({ runId: crypto.randomBytes(6).toString("hex"), workflow: w.id, folder, task, done: [], outputs: {}, status: "running" })

/**
 * Runs a workflow from where its run stands: each step not yet done, in order, saved after each. It stops at a gate
 * that does not pass and waits at an approval point (status says which); `approve` lets a waiting run go on.
 */
export async function advance(w: Workflow, run: RunState, store: RunStore, d: StepDeps): Promise<RunState> {
  let r = { ...run, status: "running" as RunState["status"] }
  delete r.reason
  store.put(r)
  for (const step of w.steps) {
    if (r.done.includes(step.id)) continue
    await d.record("workflow_step_started", { run: r.runId, step: step.id, role: step.role })
    const out = await d.runStep(step, fill(step.prompt, r.task, r.outputs))
    if (out.error) {
      r = { ...r, status: "stopped", reason: `${step.id}: ${out.error}` }
      store.put(r)
      await d.record("workflow_stopped", { run: r.runId, step: step.id, reason: r.reason })
      return r
    }
    if (step.gate) {
      const g = await d.gate(out.sessionId, step.gate)
      await d.record("workflow_gate", { run: r.runId, step: step.id, pass: g.pass, reason: g.reason })
      if (!g.pass) {
        r = { ...r, status: "stopped", reason: `${step.id}: ${g.reason}` }
        store.put(r)
        return r
      }
    }
    r = { ...r, done: [...r.done, step.id], outputs: { ...r.outputs, ...(out.result !== undefined ? { [step.id]: out.result } : {}) } }
    store.put(r)
    await d.record("workflow_step_done", { run: r.runId, step: step.id })
    if (step.approval) {
      r = { ...r, status: "waiting-approval", reason: `${step.id} is done; it waits for your approval to go on` }
      store.put(r)
      return r
    }
  }
  r = { ...r, status: "done" }
  store.put(r)
  await d.record("workflow_done", { run: r.runId })
  return r
}

/** The project's workflows, each validated. */
export function readWorkflows(root: string, roles: Role[]): Array<{ id: string; workflow?: Workflow; problems?: string[] }> {
  const dir = path.join(root, ".codehouse", "workflows")
  let files: string[]
  try {
    files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/i.test(f)).slice(0, 50)
  } catch {
    return []
  }
  return files.map((f) => {
    const id = f.replace(/\.ya?ml$/i, "")
    const v = validateWorkflow(id, fs.readFileSync(path.join(dir, f), "utf8"), roles)
    return "workflow" in v ? { id, workflow: v.workflow } : { id, problems: v.problems }
  })
}
