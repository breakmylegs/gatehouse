import { describe, expect, it } from "vitest"
import type { AuditRecord } from "@gatehouse/shared/audit"
import {
  computeAnalytics,
  computeDigest,
  groupApprovals,
  MIN_APPROVALS,
  percentile,
} from "../src/analytics.js"

const T0 = Date.parse("2026-10-27T10:00:00Z")
let seq = 0
const rec = (over: {
  event?: string
  outcome?: "allow" | "deny" | "escalate"
  ruleId?: string
  decidedBy?: AuditRecord["verdict"]["decidedBy"]
  latencyMs?: number
  atMs?: number
  tool?: string
  input?: unknown
  cwd?: string
}): AuditRecord =>
  ({
    v: 1,
    seq: ++seq,
    ts: new Date(over.atMs ?? T0).toISOString(),
    session: "s",
    event: over.event ?? "evaluate_permission",
    channel: "approver",
    tool: over.tool ?? "Bash",
    cwd: over.cwd ?? "C:/proj",
    inputJson: JSON.stringify(over.input ?? { command: "npm test" }),
    verdict: {
      outcome: over.outcome ?? "allow",
      ruleId: over.ruleId ?? "safe-shell",
      reason: "r",
      risk: 0,
      decidedBy: over.decidedBy ?? "rules",
      policyHash: "h",
    },
    latencyMs: over.latencyMs ?? 5,
    prevHash: "0".repeat(64),
    hash: "0".repeat(64),
  }) as AuditRecord

const ask = (ruleId: string, ms = T0) => rec({ outcome: "escalate", ruleId, atMs: ms })
const answer = (
  ruleId: string,
  outcome: "allow" | "deny",
  wait: number,
  by: "human-desktop" | "human-phone" | "timeout" = "human-desktop",
  extra: Parameters<typeof rec>[0] = {},
) => rec({ event: "human_decision", outcome, ruleId, decidedBy: by, latencyMs: wait, ...extra })

describe("percentile", () => {
  it("picks the value at the rank, and nothing for no data", () => {
    expect(percentile([], 50)).toBeUndefined()
    expect(percentile([5], 90)).toBe(5)
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5)
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9)
  })
})

describe("computeAnalytics", () => {
  const records = [
    rec({}),
    rec({}),
    rec({ outcome: "deny", ruleId: "destructive-shell" }),
    ask("package-install"),
    ask("package-install"),
    ask("package-install"),
    ask("git-remote"),
    answer("package-install", "allow", 4000),
    answer("package-install", "allow", 8000, "human-phone"),
    answer("package-install", "deny", 12000),
    answer("git-remote", "deny", 2000),
    answer("git-remote", "deny", 0, "timeout"),
    rec({ outcome: "allow", ruleId: "judge:network", decidedBy: "judge" }),
    rec({ atMs: T0 - 5 * 86_400_000 }),
  ]

  it("counts evaluations, the escalation rate and the judge's allows inside the window only", () => {
    const a = computeAnalytics(records, T0 - 86_400_000, T0 + 1000)
    expect(a.evaluations).toBe(8)
    expect(a.byOutcome).toEqual({ allow: 3, deny: 1, escalate: 4 })
    expect(a.escalationRate).toBeCloseTo(4 / 8)
    expect(a.judgeAllowed).toBe(1)
  })

  it("works out each rule's approval rate, time to decide and timeouts", () => {
    const a = computeAnalytics(records, T0 - 86_400_000, T0 + 1000)
    const pkg = a.byRule.find((r) => r.ruleId === "package-install")!
    expect(pkg).toMatchObject({
      escalated: 3,
      approved: 2,
      denied: 1,
      timedOut: 0,
      medianWaitMs: 8000,
    })
    expect(pkg.approvalRate).toBeCloseTo(2 / 3)
    const git = a.byRule.find((r) => r.ruleId === "git-remote")!
    expect(git).toMatchObject({
      escalated: 1,
      approved: 0,
      denied: 1,
      timedOut: 1,
      approvalRate: 0,
    })
    expect(a.byRule[0]!.ruleId).toBe("package-install")
    expect(a.byRule.find((r) => r.ruleId === "network")?.evaluated).toBe(1)
  })

  it("separates people from timeouts, and desktop from phone, and summarises how long people take", () => {
    const a = computeAnalytics(records, T0 - 86_400_000, T0 + 1000)
    expect(a.human).toEqual({ answered: 4, approved: 2, denied: 2, timedOut: 1 })
    expect(a.byChannel).toEqual({ desktop: 3, phone: 1 })
    expect(a.timeToDecideMs).toMatchObject({ count: 4, p50: 4000, max: 12000 })
    expect(a.timeToDecideMs.p90).toBe(12000)
  })

  it("groups by local day", () => {
    const a = computeAnalytics(records, T0 - 10 * 86_400_000, T0 + 1000)
    expect(a.perDay.length).toBe(2)
    expect(a.perDay.at(-1)).toMatchObject({
      allow: 3,
      deny: 1,
      escalate: 4,
      humanAllow: 2,
      humanDeny: 2,
    })
  })

  it("is all zeros and no division by zero for an empty log", () => {
    const a = computeAnalytics([], 0, T0)
    expect(a).toMatchObject({
      evaluations: 0,
      escalationRate: 0,
      byRule: [],
      perDay: [],
      timeToDecideMs: { count: 0, p50: undefined },
    })
  })
})

describe("groupApprovals (the suggestions)", () => {
  const cmd = { command: "npm run build" }
  const ok = (n: number, input: unknown = cmd) =>
    Array.from({ length: n }, () =>
      answer("package-install", "allow", 1000, "human-desktop", { input }),
    )

  it("needs three approvals of the exact same call", () => {
    expect(groupApprovals(ok(MIN_APPROVALS - 1), 0)).toEqual([])
    const g = groupApprovals(ok(MIN_APPROVALS), 0)
    expect(g).toHaveLength(1)
    expect(g[0]).toMatchObject({
      tool: "Bash",
      approvals: 3,
      input: cmd,
      ruleIds: ["package-install"],
    })
  })

  it("drops a call that was ever denied, timed out, or cancelled", () => {
    expect(
      groupApprovals(
        [...ok(5), answer("package-install", "deny", 10, "human-desktop", { input: cmd })],
        0,
      ),
    ).toEqual([])
    expect(
      groupApprovals(
        [...ok(5), answer("package-install", "deny", 10, "timeout", { input: cmd })],
        0,
      ),
    ).toEqual([])
  })

  it("keeps different commands apart, and ignores redacted, oversize, unreadable and old records", () => {
    const other = ok(3, { command: "npm run lint" })
    expect(groupApprovals([...ok(3), ...other], 0).map((g) => g.input)).toHaveLength(2)
    expect(groupApprovals(ok(3, { command: "curl -H 'Authorization: [REDACTED]'" }), 0)).toEqual([])
    expect(groupApprovals(ok(3, { command: "x".repeat(5000) }), 0)).toEqual([])
    const bad = Array.from({ length: 3 }, () => ({
      ...answer("r", "allow", 1),
      inputJson: "{nope",
    }))
    expect(groupApprovals(bad as AuditRecord[], 0)).toEqual([])
    expect(groupApprovals(ok(3), T0 + 1000)).toEqual([])
  })

  it("counts only people: a judge's or a rule's allow is not an approval", () => {
    const auto = Array.from({ length: 5 }, () =>
      rec({ event: "evaluate_permission", outcome: "allow", input: cmd }),
    )
    expect(groupApprovals(auto, 0)).toEqual([])
  })
})

describe("computeDigest", () => {
  it("says what went through, what asked you, and what it cost, in one paragraph", () => {
    const recs = [
      rec({}),
      rec({}),
      ask("git-remote"),
      answer("git-remote", "allow", 3000),
      rec({ outcome: "deny", ruleId: "d" }),
    ]
    const d = computeDigest(recs, T0 - 1000, T0 + 1000, 1.234)
    expect(d).toMatchObject({
      automaticAllowed: 2,
      automaticDenied: 1,
      askedYou: 1,
      approved: 1,
      denied: 0,
    })
    expect(d.text).toBe(
      "In the last 24 hours: 2 calls went through automatically and 1 call was blocked by policy. 1 request asked you: 1 approved, 0 denied. Most asked: git-remote (1). Spend: $1.23.",
    )
  })

  it("says plainly when nothing needed you, and handles singular and zero", () => {
    const d = computeDigest([rec({})], T0 - 1000, T0 + 1000, 0)
    expect(d.text).toBe(
      "In the last 24 hours: 1 call went through automatically and 0 calls were blocked by policy. Nothing needed you.",
    )
    expect(computeDigest([], 0, T0, 0).text).toContain("0 calls went through")
  })
})
