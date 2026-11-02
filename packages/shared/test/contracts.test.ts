import { describe, expect, it } from "vitest"
import { canonicalize, DecisionEnvelope, sha256Hex, Verdict } from "../src/index.js"

describe("canonicalize", () => {
  it("sorts keys, drops undefined members and is stable across key order", () => {
    expect(canonicalize({ b: 1, a: [2, { d: 1, c: undefined }], e: null })).toBe(
      '{"a":[2,{"d":1}],"b":1,"e":null}',
    )
    expect(canonicalize({ x: 1, y: 2 })).toBe(canonicalize({ y: 2, x: 1 }))
  })
  it("rejects non-finite numbers and functions", () => {
    expect(() => canonicalize(Number.NaN)).toThrow()
    expect(() => canonicalize(() => 1)).toThrow()
  })
  it("hashes the RFC 8785 style output", () => {
    expect(sha256Hex(canonicalize({ a: 1 }))).toBe(sha256Hex('{"a":1}'))
  })
})

describe("contracts", () => {
  it("accepts a valid verdict and rejects an unknown outcome", () => {
    const ok = {
      outcome: "allow",
      ruleId: "r",
      reason: "x",
      risk: 0,
      decidedBy: "rules",
      policyHash: "h",
    }
    expect(Verdict.safeParse(ok).success).toBe(true)
    expect(Verdict.safeParse({ ...ok, outcome: "maybe" }).success).toBe(false)
    expect(Verdict.safeParse({ ...ok, risk: 101 }).success).toBe(false)
  })
  it("limits the decision message to 500 characters", () => {
    const base = { v: 1, type: "decision", deviceId: "d", issuedAt: "t", expiresAt: "t" }
    expect(DecisionEnvelope.safeParse({ ...base, message: "a".repeat(500) }).success).toBe(true)
    expect(DecisionEnvelope.safeParse({ ...base, message: "a".repeat(501) }).success).toBe(false)
  })
})
