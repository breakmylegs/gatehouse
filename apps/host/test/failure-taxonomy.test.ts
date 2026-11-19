// D-072: what went wrong in agent work, sorted into kinds, per model and per project, from the audit alone. Fixture
// events are classified correctly, and records that are not failures (a claim that held, an allow) count for nothing.
import { describe, expect, it } from "vitest"
import { claimCalibration, classify, failureTaxonomy, TEST_COMMAND } from "../src/failure-taxonomy.js"

const rec = (session: string, event: string, project: string, input: Record<string, unknown> = {}, outcome?: string) => ({
  session,
  event,
  project,
  // As the audit keeps it.
  inputJson: JSON.stringify(input),
  ...(outcome ? { verdict: { outcome } } : {}),
})

const FIXTURE = [
  // Session a, on Opus, in billing.
  rec("a", "tool_failed", "billing", { tool: "Bash", test: true, model: "claude-opus-5-5" }),
  rec("a", "tool_failed", "billing", { tool: "Bash", test: true, model: "claude-opus-5-5" }),
  rec("a", "tool_failed", "billing", { tool: "Read", test: false, model: "claude-opus-5-5" }),
  rec("a", "thrash_warned", "billing", { tool: "Bash", what: "npm test", model: "claude-opus-5-5" }),
  rec("a", "floor_deny", "billing"),
  rec("a", "claim_verified", "billing", {}, "deny"),
  rec("a", "claim_verified", "billing", {}, "allow"),
  // Session b, on Sonnet, in site.
  rec("b", "thrash_paused", "site", { tool: "Edit", model: "claude-sonnet-5-5" }),
  rec("b", "edit_files_reverted", "site"),
  rec("b", "human_decision", "site", {}, "deny"),
  rec("b", "human_decision", "site", {}, "allow"),
  rec("b", "evaluate_permission", "site", {}, "deny"),
  rec("b", "evaluate_permission", "site", {}, "escalate"),
  // Not a failure at all.
  rec("c", "session_restored", "site"),
]

describe("the failure taxonomy (D-072)", () => {
  it("classifies each fixture event, and leaves what is not a failure out", () => {
    expect(FIXTURE.map(classify)).toEqual([
      "failing-test",
      "failing-test",
      "tool-error",
      "loop",
      "denial",
      "contradicted-claim",
      undefined,
      "loop",
      "undo",
      "denial",
      undefined,
      "denial",
      undefined,
      undefined,
    ])
  })

  it("counts them by kind, by project and by the model each session ran on", () => {
    const t = failureTaxonomy(FIXTURE)
    expect(t.total).toBe(10)
    expect(t.byKind).toEqual({ loop: 2, "tool-error": 1, "failing-test": 2, undo: 1, "contradicted-claim": 1, denial: 3 })
    expect(t.byProject.map((p) => [p.project, p.total])).toEqual([
      ["billing", 6],
      ["site", 4],
    ])
    // Session b's denials count for Sonnet, learnt from its loop record.
    expect(t.byModel.find((m) => m.model === "claude-sonnet-5-5")!.byKind).toMatchObject({ loop: 1, undo: 1, denial: 2 })
    expect(t.byModel.find((m) => m.model === "claude-opus-5-5")!.total).toBe(6)
  })

  it("knows a test run from its command, and records only that it was one", () => {
    for (const c of ["npx vitest run", "npm test", "npm run test -- --watch", "pytest -q", "dotnet test", "go test ./..."]) expect(TEST_COMMAND.test(c), c).toBe(true)
    for (const c of ["npm run build", "git status", "node scripts/latest.mjs"]) expect(TEST_COMMAND.test(c), c).toBe(false)
  })
})

describe("claim calibration (D-078)", () => {
  it("scores each model by Verified over Verified and Contradicted, leaving out unchecked and flaky claims", () => {
    const claim = (session: string, outcome: string, more: Record<string, unknown> = {}) => rec(session, "claim_verified", "p", { outcome, ...more }, outcome === "contradicted" ? "deny" : "allow")
    const records = [
      // Session a names its model on another record; session b on the claims themselves.
      rec("a", "tool_failed", "p", { tool: "Bash", model: "claude-opus-5-5" }),
      ...[1, 2, 3].map(() => claim("a", "verified")),
      claim("a", "contradicted"),
      claim("a", "unverified"),
      claim("a", "contradicted", { flaky: true }),
      ...[1, 2, 3, 4, 5].map(() => claim("b", "verified", { model: "claude-sonnet-5-5" })),
      claim("b", "contradicted", { model: "claude-sonnet-5-5" }),
      claim("c", "unverified"),
    ]
    expect(claimCalibration(records)).toEqual([
      { model: "claude-sonnet-5-5", verified: 5, contradicted: 1, unverified: 0, flaky: 0, score: 0.833, few: false },
      { model: "claude-opus-5-5", verified: 3, contradicted: 1, unverified: 1, flaky: 1, score: 0.75, few: true },
      { model: "unknown", verified: 0, contradicted: 0, unverified: 1, flaky: 0, few: true },
    ])
  })
})
