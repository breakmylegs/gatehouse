// E-058: an open Severe escalation marks the release not ready and gives the reason; each other area blocks or not.
import { describe, expect, it } from "vitest"
import { readiness, readinessMarkdown, type ReadinessInput } from "../src/release-readiness.js"

const clean: ReadinessInput = { pending: [], sealed: true, evidence: { commits: 3, withPack: 3 }, vulnerabilities: [], licences: [], a11y: { pass: true, reason: "No new Serious accessibility violations." }, dod: { met: 3, total: 3, unmet: [] } }

describe("the release readiness report", () => {
  it("is ready when nothing blocks", () => {
    const r = readiness(clean)
    expect(r).toMatchObject({ ready: true, reasons: [] })
    expect(r.sections.every((s) => s.state === "ok")).toBe(true)
  })

  it("is not ready while a Severe escalation waits, and gives the reason", () => {
    const r = readiness({ ...clean, pending: [{ risk: 90, ruleId: "iac-destroys-stateful", toolName: "Bash", reason: "This applies a plan that deletes aws_db_instance.orders." }, { risk: 40, ruleId: "no-rule", toolName: "Bash", reason: "r" }] })
    expect(r.ready).toBe(false)
    expect(r.reasons).toEqual(["Open escalations: 1 Severe escalation(s) still wait: Bash (iac-destroys-stateful, risk 90): This applies a plan that deletes aws_db_instance.orders."])
    expect(readiness({ ...clean, pending: [{ risk: 84, ruleId: "x", toolName: "Edit", reason: "r" }] })).toMatchObject({ ready: true, sections: expect.arrayContaining([expect.objectContaining({ name: "Open escalations", state: "warn" })]) })
  })

  it("blocks on failing sealed checks, a known vulnerability, a licence, accessibility and an unmet definition of done", () => {
    const r = readiness({ ...clean, sealed: false, vulnerabilities: ["npm:lodash@4.17.20 (GHSA-1)"], licences: ["left-pad is GPL-3.0"], a11y: { pass: false, reason: "New Serious accessibility violations: label." }, dod: { met: 1, total: 2, unmet: ["Docs updated"] } })
    expect(r.ready).toBe(false)
    expect(r.reasons.map((x) => x.split(":")[0])).toEqual(["Sealed checks", "Vulnerabilities", "Licences", "Accessibility", "Definition of done"])
  })

  it("says what a project has not set up without blocking, and warns about commits with no evidence pack", () => {
    const r = readiness({ pending: [], evidence: { commits: 4, withPack: 1 } })
    expect(r.ready).toBe(true)
    expect(r.sections.filter((s) => s.state === "not set up").map((s) => s.name)).toEqual(["Sealed checks", "Vulnerabilities", "Licences", "Accessibility", "Definition of done"])
    expect(r.sections.find((s) => s.name === "Evidence packs")).toMatchObject({ state: "warn", detail: "3 of 4 commit(s) have none." })
    expect(readinessMarkdown(readiness({ ...clean, sealed: false }), "v2.4.0")).toMatch(/^# Release readiness: v2\.4\.0\n\n\*\*Not ready\.\*\*\n\n- Sealed checks: They fail\.[\s\S]*\| Sealed checks \| BLOCKS \| They fail\. \|/)
  })
})
