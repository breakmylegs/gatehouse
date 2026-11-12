// D-033, D-034, D-035: the requirement ledger read tolerantly from docs/requirements, traced to commits, tests and
// evidence with its gaps; a change's hunks that neither the plan nor a requirement accounts for flagged; and the files
// changed outside the plan counted.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import type { AuditRecord } from "@gatehouse/shared/audit"
import { approvedPlan, impactOf, readRequirements, scopeOf, traceMatrix, unrequested } from "../src/requirements.js"

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-reqs-"))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))
const put = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  fs.writeFileSync(path.join(root, rel), text)
}

describe("the requirement ledger (D-033)", () => {
  it("reads requirements tolerantly, links them, and flags the one with no test", () => {
    put("docs/requirements/REQ-001.md", "---\nid: REQ-001\ntitle: Users can sign in\ntests: [test/login.test.ts]\nfiles: [src/login.ts]\n---\nWhen a user enters a valid password, the system shall sign them in.\n")
    put("docs/requirements/REQ-002.md", "---\nid: REQ-002\ntitle: Users can export their data\n---\nThe system shall export a user's orders.\n")
    put("docs/requirements/third.md", "# REQ-003 Sessions expire\n\nAfter 30 minutes idle, the session ends.\n")
    put("docs/requirements/broken.md", "---\nid: [unclosed\n---\n# REQ-004 Broken front matter\n")
    put("docs/requirements/dup.md", "---\nid: REQ-001\n---\nSame id again.\n")
    put("test/login.test.ts", 'it("signs in (REQ-001)", () => {})\n')
    put("test/session.test.ts", 'it("expires (REQ-003)", () => {})\n')
    put("src/login.ts", "export function login() {}\n")
    const { requirements, problems } = readRequirements(root)
    expect(requirements.map((r) => r.id)).toEqual(["REQ-001", "REQ-002", "REQ-004", "REQ-003"])
    expect(requirements.find((r) => r.id === "REQ-003")?.title).toBe("Sessions expire")
    expect(problems.map((p) => p.file)).toEqual(
      expect.arrayContaining(["docs/requirements/third.md", "docs/requirements/broken.md", "docs/requirements/dup.md"]),
    )
    const rows = traceMatrix({
      root,
      requirements,
      commitsFor: (id) => (id === "REQ-001" ? ["c1"] : []),
      testFiles: ["test/login.test.ts", "test/session.test.ts"],
      evidenceFor: (c) => (c === "c1" ? ["e1"] : []),
    })
    const by = Object.fromEntries(rows.map((r) => [r.id, r]))
    expect(by["REQ-001"]).toMatchObject({ commits: ["c1"], tests: ["test/login.test.ts"], evidence: ["e1"], gaps: [] })
    expect(by["REQ-003"]).toMatchObject({ tests: ["test/session.test.ts"], gaps: [] })
    expect(by["REQ-002"]!.gaps).toEqual(["no test names it, and it names none"])
    // A link that does not resolve is a gap too.
    put("docs/requirements/REQ-005.md", "---\nid: REQ-005\ntests: [test/missing.test.ts]\n---\nx\n")
    const again = traceMatrix({ root, requirements: readRequirements(root).requirements, commitsFor: () => [], testFiles: [], evidenceFor: () => [] })
    expect(again.find((r) => r.id === "REQ-005")!.gaps).toContain("it names the test file test/missing.test.ts, which is not there")
  })
})

describe("the change against the plan (D-034, D-035)", () => {
  const plan = "## Plan\n1. Add a remember-me box to `src/login.ts` (function rememberMe).\n2. Test it in test/login.test.ts.\n"
  const records = [
    { seq: 1, tool: "ExitPlanMode", inputJson: JSON.stringify({ plan }), verdict: { outcome: "allow" } },
  ] as unknown as AuditRecord[]

  it("flags an extra feature the plan and the requirements do not account for", () => {
    expect(approvedPlan(records)).toBe(plan)
    const flagged = unrequested({
      plan,
      requirements: [],
      files: [
        { path: "src/login.ts", diff: "@@ -1 +1,2 @@\n export function login() {}\n+export function rememberMe() {}\n" },
        { path: "src/export.ts", diff: "@@ -0,0 +1,3 @@\n+export function exportCsv(rows) {\n+  return rows.join(',')\n+}\n" },
      ],
    })
    expect(flagged).toEqual([
      { file: "src/export.ts", hunk: 0, reason: "Neither the plan nor a requirement names src/export.ts or what it adds (exportCsv)." },
    ])
  })

  it("counts the files changed outside the plan", () => {
    expect(scopeOf(plan, ["src/login.ts", "test/login.test.ts"]).outside).toEqual([])
    expect(scopeOf(plan, ["src/login.ts", "src/export.ts"]).outside).toEqual(["src/export.ts"])
    expect(scopeOf(undefined, ["src/export.ts"]).outside).toEqual([])
  })
})

describe("requirement change impact (D-039)", () => {
  it("lists the code, tests and ADRs linked to a requirement that is edited", () => {
    put("docs/adr/0001-sessions.md", "# 0001. Sign-in sessions

This decides REQ-001.
")
    const { requirements } = readRequirements(root)
    const r = requirements.find((x) => x.id === "REQ-001")!
    const [row] = traceMatrix({ root, requirements: [r], commitsFor: () => ["c1"], testFiles: ["test/login.test.ts"], evidenceFor: () => [] })
    const impact = impactOf({ root, requirement: r, row: row!, filesOf: () => ["src/session.ts", "test/login.test.ts", "docs/requirements/REQ-001.md"] })
    expect(impact).toEqual({
      id: "REQ-001",
      title: "Users can sign in",
      file: "docs/requirements/REQ-001.md",
      code: ["src/login.ts", "src/session.ts"],
      tests: ["test/login.test.ts"],
      adrs: ["docs/adr/0001-sessions.md"],
    })
  })
})
