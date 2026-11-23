// E-059: every field of the change record links to evidence or is marked as needing input.
import { describe, expect, it } from "vitest"
import { cabPack, changeRecord, type RecordInput } from "../src/change-record.js"
import { readiness } from "../src/release-readiness.js"

const base: RecordInput = {
  candidate: "shop v2.4.0",
  commits: [{ sha: "a1b2c3d4e5f6a7b8", subject: "Round totals to pence" }],
  requirements: [{ id: "OSS-1A2B", title: "Totals in pence" }],
  readiness: readiness({ pending: [], sealed: true, evidence: { commits: 1, withPack: 1 } }),
  claims: [{ quote: "All tests pass", outcome: "verified", command: "npm test" }],
  files: ["src/cart.ts", "src/cart.test.ts"],
  backout: { reversible: true, detail: "the revert applies cleanly and the tests pass after it." },
  schedule: "Thursday 18:00, 30 minutes",
}

describe("the change record", () => {
  it("links every field to evidence or marks it as needing input", () => {
    for (const input of [base, { ...base, commits: [], claims: [], files: [], backout: undefined, schedule: undefined, readiness: readiness({ pending: [], evidence: { commits: 0, withPack: 0 } }) }]) {
      const fields = changeRecord(input)
      expect(fields.map((f) => f.name)).toEqual(["Description", "Risk", "Impact", "Tests", "Implementation", "Backout", "Schedule"])
      for (const f of fields) expect(f.evidence.length > 0 || !!f.needsInput, f.name).toBe(true)
    }
  })

  it("drafts from the evidence, and asks for what it cannot know", () => {
    const f = Object.fromEntries(changeRecord(base).map((x) => [x.name, x]))
    expect(f.Description).toMatchObject({ text: "Delivers OSS-1A2B (Totals in pence). Changes: Round totals to pence.", evidence: ["requirement OSS-1A2B", "commit a1b2c3d4e5"] })
    expect(f.Risk!.text).toMatch(/^Low\. The readiness report finds nothing blocking\./)
    expect(f.Tests!.text).toMatch(/1 claim\(s\) .* Verified by running npm test again\. The sealed checks pass\./)
    expect(f.Impact!.needsInput).toMatch(/users, services and teams/)
    expect(f.Backout).toMatchObject({ text: expect.stringMatching(/^Revert the change; checked/), evidence: ["the backout check (E-060)"] })
    expect(f.Schedule).toMatchObject({ text: "Thursday 18:00, 30 minutes", evidence: ["you"] })
  })

  it("rates the risk High with an open Severe escalation, and an irreversible change needs a backout plan", () => {
    const f = Object.fromEntries(changeRecord({ ...base, readiness: readiness({ pending: [{ risk: 90, ruleId: "x", toolName: "Bash", reason: "r" }], evidence: { commits: 1, withPack: 1 } }), backout: { reversible: false, detail: "the revert conflicts in src/cart.ts." } }).map((x) => [x.name, x]))
    expect(f.Risk!.text).toMatch(/^High\./)
    expect(f.Backout).toMatchObject({ text: "Not shown to be reversible: the revert conflicts in src/cart.ts.", needsInput: "Give a backout plan that works." })
  })

  it("makes a CAB pack with the record and the readiness report", () => {
    const md = cabPack("shop v2.4.0", changeRecord({ ...base, schedule: undefined }), "# Release readiness: shop v2.4.0\n")
    expect(md).toMatch(/^# Change record: shop v2\.4\.0/)
    expect(md).toContain("## Schedule\n\n**NEEDS INPUT:** When it goes in, and the change window.")
    expect(md).toContain("# Release readiness: shop v2.4.0")
  })
})
