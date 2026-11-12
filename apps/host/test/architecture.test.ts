// D-041, architecture rules as policy: the golden cases of edits against a project's layers and forbidden imports;
// a violation escalates with the rule named, even in Extreme approval; malformed rules check nothing and say why; and
// the import graph is kept and read again only for files that changed.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { parse as parseYaml } from "yaml"
import { ARCH_RULE, archCheck, readArchRules, updateGraph } from "../src/architecture.js"
import { createCanUseTool, type CanUseDeps } from "../src/canuse.js"

const RULES = `layers:
  domain: ["src/domain/**"]
  application: ["src/app/**"]
  infrastructure: ["src/infra/**"]
allow:
  domain: []
  application: [domain]
  infrastructure: [domain, application]
forbid:
  - { from: "src/domain/**", import: axios, reason: "the domain does no network calls" }
  - { import: child_process }
`
const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-arch-"))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))
const put = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  fs.writeFileSync(path.join(root, rel), text)
}
beforeEach(() => {
  put(".codehouse/architecture.yml", RULES)
  put("src/domain/order.ts", "export class Order {}")
  put("src/domain/legacy.ts", "import { Db } from '../infra/db'\nexport const x = 1")
  put("src/app/checkout.ts", "export function checkout() {}\n")
  put("src/infra/db.ts", "export class Db {}\n")
})

interface Case {
  note: string
  edit: { tool: string; file: string; old?: string; new?: string; content?: string }
  expect: "architecture" | "none"
  rule?: string
}
const cases = parseYaml(fs.readFileSync(path.join(import.meta.dirname, "golden", "architecture.yaml"), "utf8")) as Case[]
const inputOf = (e: Case["edit"]) =>
  e.tool === "Write"
    ? { file_path: path.join(root, e.file), content: e.content }
    : { file_path: path.join(root, e.file), old_string: e.old, new_string: e.new }

describe("architecture rules as policy (D-041)", () => {
  it.each(cases.map((c) => [c.note, c] as const))("%s", async (_n, c) => {
    const v = await archCheck(root, c.edit.tool, inputOf(c.edit))
    if (c.expect === "none") expect(v).toEqual([])
    else expect(v.map((x) => x.rule)).toContain(c.rule)
  })

  it("has enough cases, and sends a violation to a person with the rule named, even in Extreme approval", async () => {
    expect(cases.length).toBeGreaterThanOrEqual(10)
    const request = vi.fn(async () => ({ outcome: "deny", channel: "desktop", waitedMs: 1 }))
    const deps = {
      sessionId: "s1",
      cwd: root,
      project: "p",
      approver: { evaluate: async () => ({ outcome: "allow", ruleId: "edit-workspace-source", reason: "ok", risk: 10, decidedBy: "rules", policyHash: "h" }) },
      broker: { request },
      audit: { record: async () => true },
      kill: () => false,
      policy: () => undefined,
      engine: {},
      pwsh: undefined,
      decided: new Set<string>(),
      extreme: () => true,
      notifyAutoApproved: () => undefined,
      log: () => undefined,
    } as unknown as CanUseDeps
    await createCanUseTool(deps)("Write", { file_path: path.join(root, "src/domain/x.ts"), content: "import { Db } from '../infra/db'\n" }, { toolUseID: "t1", signal: new AbortController().signal } as never)
    const v = (request.mock.calls[0] as unknown as [{ verdict: { ruleId: string; reason: string } }])[0].verdict
    expect(v.ruleId).toBe(ARCH_RULE)
    expect(v.reason).toMatch(/domain layer, which may depend on no other layer, but \.\.\/infra\/db is in infrastructure \(rule layer domain\)/)
  })

  it("checks nothing, and says why, when the rules do not parse; keeps the graph, reading only what changed", async () => {
    put(".codehouse/architecture.yml", "layers: [unclosed")
    expect(readArchRules(root).problem).toMatch(/not valid YAML/)
    expect(await archCheck(root, "Write", { file_path: path.join(root, "src/domain/x.ts"), content: "import axios from 'axios'\n" })).toEqual([])
    put(".codehouse/architecture.yml", RULES)
    const files = ["src/domain/order.ts", "src/domain/legacy.ts", "src/app/checkout.ts", "src/infra/db.ts"]
    const g = await updateGraph(root, files)
    expect(g.files["src/domain/legacy.ts"]).toMatchObject({ layer: "domain", internal: ["src/infra/db.ts"] })
    const saved = fs.statSync(path.join(root, ".codehouse/arch/graph.json")).mtimeMs
    await new Promise((r) => setTimeout(r, 20))
    await updateGraph(root, files)
    // Nothing changed, so nothing was written again.
    expect(fs.statSync(path.join(root, ".codehouse/arch/graph.json")).mtimeMs).toBe(saved)
  })
})
