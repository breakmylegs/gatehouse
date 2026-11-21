// D-052: an edit that removes a library's export names the other repositories here that import it.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { createCanUseTool, type CanUseDeps } from "../src/canuse.js"
import { consumersOf, consumersWords, importsFrom } from "../src/contract-check.js"

let parent: string
const at = (...p: string[]) => path.join(parent, ...p)
const write = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(at(rel)), { recursive: true })
  fs.writeFileSync(at(rel), text)
}
const pkg = (name: string, deps: Record<string, string> = {}, extra: Record<string, unknown> = {}) => JSON.stringify({ name, dependencies: deps, ...extra })

beforeAll(() => {
  parent = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-contract-")))
  write("core/package.json", pkg("@acme/core", {}, { main: "src/index.js" }))
  write("core/src/index.ts", "export function parseDate(s: string) { return s }\nexport const VERSION = 1\n")
  write("shop/package.json", pkg("shop", { "@acme/core": "^1.0.0" }))
  write("shop/src/a.ts", 'import { parseDate as pd, VERSION } from "@acme/core"\nexport const x = pd("1")\n')
  write("shop/node_modules/@acme/core/x.js", 'import { parseDate } from "@acme/core"\n')
  write("cafe/package.json", pkg("cafe", { "@acme/core": "^1.0.0" }))
  write("cafe/src/b.ts", 'import type { VERSION } from "@acme/core/sub"\n')
  write("bar/package.json", pkg("bar", { "@acme/core": "^1.0.0" }))
  write("bar/lib/c.cjs", 'const { parseDate: p } = require("@acme/core")\n')
  write("loose/package.json", pkg("loose"))
  write("loose/src/d.ts", 'import { parseDate } from "@acme/core"\n')
})
afterAll(() => fs.rmSync(parent, { recursive: true, force: true }))

describe("the multi-repo contract check", () => {
  it("reads named, default, type and require imports from a package and its subpaths", () => {
    expect(importsFrom('import def, { a, type B, c as d } from "@acme/core/x"\nimport other from "left-pad"', "@acme/core").map((u) => u.name)).toEqual(["default", "a", "B", "c"])
    expect(importsFrom('const { a, b: c } = require("@acme/core")', "@acme/core").map((u) => u.name)).toEqual(["a", "b"])
  })

  it("names the repositories beside the library that depend on it and import a removed name, with file and line", () => {
    const cs = consumersOf(at("core"), ["parseDate"])
    expect(cs.sort((a, b) => a.repo.localeCompare(b.repo))).toEqual([
      { repo: "bar", uses: [{ file: "lib/c.cjs", line: 1, name: "parseDate" }] },
      { repo: "shop", uses: [{ file: "src/a.ts", line: 1, name: "parseDate" }] },
    ])
    expect(consumersOf(at("core"), ["VERSION"]).map((c) => c.repo).sort()).toEqual(["cafe", "shop"])
    expect(consumersOf(at("core"), ["nothingLikeThis"])).toEqual([])
    expect(consumersWords(cs)).toMatch(/Used by 2 other repositories on this computer:\n- (bar|shop): parseDate in/)
  })

  it("puts them in the reason a removed export is asked about", async () => {
    const request = vi.fn(async () => ({ outcome: "deny", channel: "desktop", waitedMs: 1 }))
    const canUse = createCanUseTool({
      sessionId: "s1",
      cwd: at("core"),
      project: "core",
      approver: { evaluate: async () => ({ outcome: "allow", ruleId: "edit-workspace-source", reason: "ok", risk: 10, decidedBy: "rules", policyHash: "h" }) },
      broker: { request },
      audit: { record: async () => true },
      kill: () => false,
      policy: () => undefined,
      engine: {},
      pwsh: undefined,
      decided: new Set<string>(),
      extreme: () => false,
      effects: async () => undefined,
      log: () => undefined,
    } as unknown as CanUseDeps)
    await canUse("Write", { file_path: at("core", "src", "index.ts"), content: "export const VERSION = 1\n" }, { toolUseID: "t1", signal: new AbortController().signal } as never)
    const reason = (request.mock.calls[0]![0] as { verdict: { ruleId: string; reason: string } }).verdict
    expect(reason.ruleId).toBe("api-break")
    expect(reason.reason).toMatch(/removes an export from src\/index\.ts/)
    expect(reason.reason).toMatch(/Used by 2 other repositories on this computer/)
    expect(reason.reason).toMatch(/shop: parseDate in src\/a\.ts:1/)
  })
})
