// D-037, the assumption register: declare_assumption is allowed only from the Host's own in-process Companion (a tool
// of the same name from any other server still asks); an assumption is kept and an unverified one is in the pack.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { CompanionHandlers } from "@gatehouse/companion"
import { PolicyEngine, PolicyStore } from "@gatehouse/policy"
import { REPO_ROOT } from "../src/bootstrap.js"
import { buildPack, CommandResults } from "../src/evidence.js"

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-assume-"))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe("the assumption register (D-037)", () => {
  it("is allowed from the in-process Companion only; the same name from another server asks", async () => {
    const rulesPath = path.join(root, "rules.yaml")
    fs.copyFileSync(path.join(REPO_ROOT, "policy", "rules.yaml"), rulesPath)
    const store = new PolicyStore({ rulesPath, localPath: path.join(root, "rules.local.yaml"), workspaceRootsOverride: [root] })
    store.load()
    const engine = new PolicyEngine({ getPolicy: () => store.current })
    const call = { toolName: "mcp__companion__declare_assumption", input: { text: "dates are UTC" } }
    expect(await engine.evaluate(call, { cwd: root, mcpSource: "sdk", sessionKind: "code" })).toMatchObject({ outcome: "allow", ruleId: "assumption-tools" })
    for (const mcpSource of ["stdio", "http", undefined])
      expect((await engine.evaluate(call, { cwd: root, ...(mcpSource ? { mcpSource } : {}), sessionKind: "code" } as never)).outcome).not.toBe("allow")
  })

  it("keeps what Claude declares, and an unverified one goes into the change's evidence", async () => {
    const kept: Array<[string, string | undefined]> = []
    const h = new CompanionHandlers({
      sessionId: "s1",
      cwd: root,
      host: { notify: async () => true } as never,
      policy: () => undefined,
      redact: (v) => v,
      assumptions: { declare: async (text, check) => (kept.push([text, check]), { text: "Recorded as assumption a1." }) },
    })
    expect((await h.declareAssumption("  The orders API returns dates in UTC  ", "compare with a known order")).text).toMatch(/a1/)
    expect(kept).toEqual([["The orders API returns dates in UTC", "compare with a known order"]])
    expect((await h.declareAssumption("   ")).isError).toBe(true)
    const pack = buildPack({
      session: "s1",
      project: "shop",
      since: { ref: "r", label: "start", createdAt: "2026-11-12T00:00:00.000Z" },
      records: [],
      head: { seq: 1, hash: "h" },
      results: new CommandResults(),
      files: [],
      dependencies: [],
      findings: [],
      assumptions: [{ id: "a1", text: "The orders API returns dates in UTC", at: "2026-11-12T01:00:00.000Z" }],
    })
    expect(pack.assumptions).toEqual([{ id: "a1", text: "The orders API returns dates in UTC", at: "2026-11-12T01:00:00.000Z" }])
  })
})
