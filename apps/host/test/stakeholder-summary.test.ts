// D-099: a summary of a change from its evidence pack only: every sentence names its evidence, claims Codehouse could
// not confirm are withheld and listed with why, and everything is redacted.
import { describe, expect, it } from "vitest"
import type { EvidencePack } from "../src/evidence.js"
import { stakeholderSummary } from "../src/stakeholder-summary.js"

const link = (seq: number) => ({ seq, hash: "a".repeat(64) })
const PACK: EvidencePack = {
  v: 1,
  session: "s1",
  project: "AcmeCorp shop",
  createdAt: "2026-11-19T09:00:00Z",
  range: { from: { ref: "r", label: "Start", createdAt: "2026-11-19T08:00:00Z" }, commit: "0123456789abcdef" },
  head: link(99),
  decisions: [
    { ...link(10), at: "", event: "human_decision", tool: "Bash", summary: "git push", outcome: "allow", ruleId: "x", decidedBy: "human-desktop", channel: "desktop", risk: 40 },
    { ...link(11), at: "", event: "evaluate_permission", tool: "Read", summary: "", outcome: "allow", ruleId: "read-workspace", decidedBy: "rules", channel: "approver", risk: 0 },
    { ...link(12), at: "", event: "floor_deny", tool: "Bash", summary: "", outcome: "deny", ruleId: "floor", decidedBy: "floor", channel: "host", risk: 100 },
  ],
  commands: [
    { ...link(20), command: "npm test", result: "succeeded", exitCode: 0 },
    { ...link(21), command: "npm run lint", result: "failed", exitCode: 1 },
  ],
  claims: [
    { ...link(30), claim: { kind: "tests", quote: "All tests pass for AcmeCorp", outcome: "verified", command: "npm test" } },
    { ...link(31), claim: { kind: "build", quote: "The build succeeds", outcome: "unverified", why: "there is no command to check it with" } },
    { ...link(32), claim: { kind: "lint", quote: "Lint is clean", outcome: "contradicted", why: "npm run lint failed when Codehouse ran it (exit 1)" } },
  ],
  sealedChecks: { runs: 1, records: [link(40)] },
  dependencies: { added: 1, changed: 0, removed: 0, sbom: "b".repeat(64) },
  findings: [],
  files: [
    { path: "src/cart.ts", change: "modified", added: 12, removed: 3 },
    { path: "src/pay.ts", change: "added", added: 40, removed: 0 },
  ],
  capabilities: [{ name: "Checkout", owner: "Payments team", files: ["src/cart.ts", "src/pay.ts"] }],
  assumptions: [{ id: "a1", text: "Prices are in pence", at: "" }],
  notes: [],
}
const redact = (s: string) => s.replace(/AcmeCorp/g, "[REDACTED:term]")

describe("the stakeholder summary (D-099)", () => {
  it("states only what the pack shows, every sentence with its evidence", () => {
    const s = stakeholderSummary(PACK, "c".repeat(64), redact)
    expect(s.sentences.length).toBeGreaterThan(5)
    for (const x of s.sentences) {
      expect(x.evidence, x.text).toMatch(/^evidence pack cccccccccccc/)
      expect(x.evidence.length, x.text).toBeGreaterThan("evidence pack cccccccccccc".length)
    }
    const text = s.sentences.map((x) => x.text).join("\n")
    expect(text).toContain("touches 2 files, adding 52 lines and removing 3")
    expect(text).toContain("the Checkout capability, owned by Payments team")
    expect(text).toContain("3 actions needed a decision: 1 by a person, 2 by the rules, and 1 was refused")
    expect(s.sentences.find((x) => x.text.startsWith("2 commands ran"))?.evidence).toContain("audit records 20, 21")
    expect(s.sentences.find((x) => x.text.includes("confirmed it"))).toMatchObject({ evidence: expect.stringContaining("audit record 30") })
  })

  it("withholds and lists the claims without evidence, and the unverified assumptions", () => {
    const s = stakeholderSummary(PACK, "c".repeat(64), redact)
    const text = s.sentences.map((x) => x.text).join("\n")
    expect(text).not.toContain("The build succeeds")
    expect(text).not.toContain("Lint is clean")
    expect(text).not.toContain("pence")
    expect(s.withheld).toEqual([
      { text: 'Claude said "The build succeeds"', why: "Codehouse could not confirm it: there is no command to check it with" },
      { text: 'Claude said "Lint is clean"', why: "Codehouse found it untrue: npm run lint failed when Codehouse ran it (exit 1)" },
      { text: "Claude assumed: Prices are in pence", why: "nobody has verified it yet" },
    ])
    expect(s.markdown).toContain("## Not stated: no evidence")
  })

  it("is redacted throughout", () => {
    const s = stakeholderSummary(PACK, "c".repeat(64), redact)
    expect(s.markdown).not.toContain("AcmeCorp")
    expect(s.markdown).toContain('Claude said "All tests pass for [REDACTED:term]"')
  })
})
