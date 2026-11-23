// E-048: a failing gate stops the next step and gives the reason; a gate that cannot be read fails closed.
import { describe, expect, it, vi } from "vitest"
import { evaluateGate, parseGate, runGatedSteps, type GateSources } from "../src/gates.js"

const sources = (o: Partial<GateSources> = {}): GateSources => ({
  testsVerified: async () => true,
  sealedPass: async () => true,
  mutationScore: async () => 80,
  readFile: () => undefined,
  dodItems: async () => [],
  ...o,
})
const axe = (...v: Array<[string, string, string]>) => JSON.stringify({ violations: v.map(([id, impact, target]) => ({ id, impact, nodes: [{ target: [target] }] })) })

describe("evidence gates between steps", () => {
  it("stops the next step when a gate fails, and gives the reason", async () => {
    const third = vi.fn(async () => undefined)
    const r = await runGatedSteps(
      [
        { name: "implement", run: async () => undefined, gate: { tests: "verified" } },
        { name: "harden", run: async () => undefined, gate: { mutation: 90 } },
        { name: "document", run: third },
      ],
      sources(),
    )
    expect(r).toEqual({ done: ["implement", "harden"], stoppedAfter: "harden", reason: "The mutation score is 80, under 90." })
    expect(third).not.toHaveBeenCalled()
  })

  it("fails closed when a gate cannot be read", async () => {
    expect(await evaluateGate({ tests: "verified" }, sources({ testsVerified: async () => undefined }))).toEqual({ pass: false, reason: expect.stringMatching(/^The gate could not be read \(no claim/) })
    expect(await evaluateGate({ sealed: true }, sources({ sealedPass: async () => { throw new Error("helper missing") } }))).toEqual({ pass: false, reason: "The gate could not be read (helper missing), so it does not pass." })
    expect((await evaluateGate({ mutation: 50 }, sources({ mutationScore: async () => undefined }))).pass).toBe(false)
    expect((await evaluateGate({ a11y: { report: ".codehouse/a11y.json" } }, sources())).reason).toMatch(/a11y\.json is not there/)
    expect((await evaluateGate({ a11y: { report: "r.json" } }, sources({ readFile: () => "{not json" }))).pass).toBe(false)
    expect((await evaluateGate({ a11y: { report: "r.json" } }, sources({ readFile: () => '{"passes": []}' }))).reason).toMatch(/no violations list/)
    expect((await evaluateGate({ dod: "release" }, sources({ dodItems: async () => undefined }))).reason).toMatch(/no playbook release/)
  })

  it("passes each kind of gate on good evidence, and fails it on bad", async () => {
    expect((await evaluateGate({ tests: "verified" }, sources({ testsVerified: async () => false }))).reason).toBe("The latest claim that the tests pass was not Verified.")
    expect((await evaluateGate({ sealed: true }, sources())).pass).toBe(true)
    // A score exactly at the minimum passes.
    expect(await evaluateGate({ mutation: 80 }, sources())).toEqual({ pass: true, reason: "The mutation score is 80, at least 80." })
    expect((await evaluateGate({ sealed: true }, sources({ sealedPass: async () => false }))).pass).toBe(false)
    const files: Record<string, string> = { "a.json": axe(["color-contrast", "serious", "#total"], ["region", "moderate", "main"]), "base.json": axe(["color-contrast", "serious", "#total"]) }
    expect(await evaluateGate({ a11y: { report: "a.json", baseline: "base.json" } }, sources({ readFile: (r) => files[r] }))).toEqual({ pass: true, reason: "No new Serious accessibility violations." })
    files["a.json"] = axe(["color-contrast", "serious", "#total"], ["label", "critical", "#email"])
    expect((await evaluateGate({ a11y: { report: "a.json", baseline: "base.json" } }, sources({ readFile: (r) => files[r] }))).reason).toBe('New Serious accessibility violations: label at ["#email"].')
    expect((await evaluateGate({ dod: "release" }, sources({ dodItems: async () => [{ text: "Docs", status: "met", why: "checked" }, { text: "Sign-off", status: "person", why: "" }] }))).reason).toMatch(/Sign-off \(for a person to confirm\)/)
    expect((await evaluateGate({ dod: "release" }, sources({ dodItems: async () => [{ text: "Docs", status: "met", why: "checked" }] }))).pass).toBe(true)
  })

  it("reads gates from a workflow file, and refuses one it does not know", () => {
    expect(parseGate({ tests: "verified" })).toEqual({ tests: "verified" })
    expect(parseGate({ mutation: 70 })).toEqual({ mutation: 70 })
    expect(parseGate({ a11y: { report: "r.json" } })).toEqual({ a11y: { report: "r.json" } })
    expect(parseGate({ dod: " release " })).toEqual({ dod: "release" })
    expect(parseGate({ mutation: 170 })).toMatchObject({ error: expect.stringMatching(/not a gate/) })
    expect(parseGate({ vibes: "good" })).toMatchObject({ error: expect.any(String) })
  })
})
