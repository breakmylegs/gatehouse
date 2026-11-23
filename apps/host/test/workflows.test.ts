// E-047: a three-step workflow completes with its gates; a restart mid-way resumes from the last completed step; an
// invalid workflow is refused before it starts.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Role } from "../src/roles.js"
import { advance, dryRun, fill, newRun, RunStore, validateWorkflow, type StepDeps, type Workflow } from "../src/workflows.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})
const store = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-wf-"))
  dirs.push(d)
  return new RunStore(path.join(d, "runs.json"))
}

const roles: Role[] = [{ name: "planner" }, { name: "implementer" }, { name: "reviewer", readOnly: true }]
const FEATURE = `name: Feature
steps:
  - { id: plan, role: planner, prompt: "Plan {{task}}", outputs: { type: object, required: [files], properties: { files: { type: array } } } }
  - { id: build, role: implementer, prompt: "Build these: {{plan.files}}", gate: { tests: verified } }
  - { id: review, role: reviewer, prompt: "Review the change to {{plan.files}}", gate: { sealed: true } }
`
const wf = () => (validateWorkflow("feature", FEATURE, roles) as { workflow: Workflow }).workflow

function deps(o: { failGate?: string } = {}) {
  const prompts: Array<[string, string]> = []
  const events: string[] = []
  const d: StepDeps = {
    runStep: vi.fn(async (step, prompt) => {
      prompts.push([step.id, prompt])
      return { sessionId: `s-${step.id}`, ...(step.id === "plan" ? { result: { files: ["src/cart.ts"] } } : {}) }
    }),
    gate: vi.fn(async (sid) => (sid === `s-${o.failGate}` ? { pass: false, reason: "The tests were not Verified." } : { pass: true, reason: "ok" })),
    record: vi.fn(async (event: string) => void events.push(event)),
  }
  return { d, prompts, events }
}

describe("workflows as code", () => {
  it("completes a three-step workflow with its gates, each step fed by the last and recorded", async () => {
    const s = store()
    const { d, prompts, events } = deps()
    const r = await advance(wf(), newRun(wf(), "C:/p", "cart totals"), s, d)
    expect(r).toMatchObject({ status: "done", done: ["plan", "build", "review"], outputs: { plan: { files: ["src/cart.ts"] } } })
    expect(prompts).toEqual([
      ["plan", "Plan cart totals"],
      ["build", 'Build these: ["src/cart.ts"]'],
      ["review", 'Review the change to ["src/cart.ts"]'],
    ])
    expect(d.gate).toHaveBeenCalledTimes(2)
    expect(events.filter((e) => e === "workflow_step_done")).toHaveLength(3)
    expect(events.at(-1)).toBe("workflow_done")
    expect(s.get(r.runId)?.status).toBe("done")
  })

  it("stops at a gate that does not pass, with its reason", async () => {
    const { d } = deps({ failGate: "build" })
    const r = await advance(wf(), newRun(wf(), "C:/p", "x"), store(), d)
    expect(r).toMatchObject({ status: "stopped", done: ["plan"], reason: "build: The tests were not Verified." })
    expect(d.runStep).toHaveBeenCalledTimes(2)
  })

  it("resumes after a restart from the last completed step", async () => {
    const s = store()
    // Saved mid-way, as a run is when the Host stops: plan done, with its output.
    const saved = { ...newRun(wf(), "C:/p", "cart totals"), done: ["plan"], outputs: { plan: { files: ["src/a.ts"] } } }
    s.put(saved)
    const { d, prompts } = deps()
    const r = await advance(wf(), s.get(saved.runId)!, s, d)
    expect(prompts.map(([id]) => id)).toEqual(["build", "review"])
    expect(prompts[0]![1]).toBe('Build these: ["src/a.ts"]')
    expect(r).toMatchObject({ status: "done", done: ["plan", "build", "review"] })
  })

  it("has every completed step saved when the Host dies mid-step", async () => {
    const s = store()
    const { d } = deps()
    const run = newRun(wf(), "C:/p", "t")
    const dying: StepDeps = { ...d, runStep: async (step, prompt) => (step.id === "review" ? Promise.reject(new Error("the Host stopped")) : d.runStep(step, prompt)) }
    await expect(advance(wf(), run, s, dying)).rejects.toThrow("the Host stopped")
    expect(s.get(run.runId)).toMatchObject({ status: "running", done: ["plan", "build"] })
  })

  it("waits at an approval point, and goes on from there when approved", async () => {
    const w = (validateWorkflow("x", FEATURE.replace('prompt: "Plan {{task}}",', 'prompt: "Plan {{task}}", approval: true,'), roles) as { workflow: Workflow }).workflow
    const s = store()
    const { d, prompts } = deps()
    const first = await advance(w, newRun(w, "C:/p", "t"), s, d)
    expect(first).toMatchObject({ status: "waiting-approval", done: ["plan"] })
    const second = await advance(w, first, s, d)
    expect(second.status).toBe("done")
    expect(prompts.map(([id]) => id)).toEqual(["plan", "build", "review"])
  })

  it("refuses an invalid workflow before it starts, naming every problem, and dry-runs a valid one", () => {
    const bad = validateWorkflow("bad", `name: Bad\nsteps:\n  - { id: a, role: wizard, prompt: "Use {{later.x}}" }\n  - { id: a, role: planner, prompt: "" , gate: { vibes: good } }\n`, roles)
    expect(bad).toEqual({
      problems: [
        'step 1 names the role "wizard", which roles.yml does not define',
        "step 1 uses {{later...}}, which is not an earlier step",
        "step 2 repeats the id a",
        "step 2 has no prompt",
        expect.stringMatching(/^step 2's gate is not a gate Codehouse knows/),
      ],
    })
    expect(validateWorkflow("x", "steps: []\n", roles)).toEqual({ problems: ["it has no name", "it has no steps"] })
    expect(dryRun(wf())).toEqual([
      "1. plan: the planner role returns a result",
      '2. build: the implementer role works, then the gate {"tests":"verified"}',
      '3. review: the reviewer role works, then the gate {"sealed":true}',
    ])
    expect(fill("{{a.b.c}} and {{missing}}", "t", { a: { b: { c: 3 } } })).toBe("3 and (not given)")
  })
})
