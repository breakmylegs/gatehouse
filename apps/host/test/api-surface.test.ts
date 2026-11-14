// D-046, the public API break guard: in a library, removing an exported function escalates with what was removed
// shown, even in Extreme approval; adding one, editing a body, a test file or an application's module does not.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it, vi } from "vitest"
import { API_RULE, apiBreak, exportsOf } from "../src/api-surface.js"
import { createCanUseTool, type CanUseDeps } from "../src/canuse.js"

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-api-"))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))
const LIB = `export function parse(s: string) { return s }
export function format(v: unknown) { return String(v) }
export const VERSION = "1"
export interface Options { strict: boolean }
function internal() {}
export { internal as helper }
`

describe("the public API break guard (D-046)", () => {
  it("reads a module's exports", async () => {
    expect([...(await exportsOf("src/index.ts", LIB)).keys()].sort()).toEqual(["Options", "VERSION", "format", "helper", "parse"])
  })

  it("escalates removing an exported function from a library, with the removed declaration shown", async () => {
    fs.mkdirSync(path.join(root, "src"), { recursive: true })
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "lib", main: "dist/index.js", types: "dist/index.d.ts" }))
    fs.writeFileSync(path.join(root, "src", "index.ts"), LIB)
    const file = path.join(root, "src", "index.ts")
    const removing = { file_path: file, old_string: "export function format(v: unknown) { return String(v) }\n", new_string: "" }
    expect(await apiBreak(root, "Edit", removing)).toEqual({
      file: "src/index.ts",
      removed: [{ name: "format", declaration: "export function format(v: unknown) { return String(v) }" }],
    })
    // Adding an export or changing a body breaks nothing.
    expect(await apiBreak(root, "Edit", { file_path: file, old_string: "return s }", new_string: "return s.trim() }" })).toBeUndefined()
    expect(await apiBreak(root, "Edit", { file_path: file, old_string: 'export const VERSION = "1"', new_string: 'export const VERSION = "1"\nexport const NEW = 2' })).toBeUndefined()
    const request = vi.fn(async () => ({ outcome: "deny", channel: "desktop", waitedMs: 1 }))
    const deps = {
      sessionId: "s1",
      cwd: root,
      project: "lib",
      approver: { evaluate: async () => ({ outcome: "allow", ruleId: "edit-workspace-source", reason: "ok", risk: 10, decidedBy: "rules", policyHash: "h" }) },
      broker: { request },
      audit: { record: async () => true },
      kill: () => false,
      policy: () => undefined,
      engine: {},
      pwsh: undefined,
      decided: new Set<string>(),
      extreme: () => false,
      notifyAutoApproved: () => undefined,
      log: () => undefined,
    } as unknown as CanUseDeps
    await createCanUseTool(deps)("Edit", removing, { toolUseID: "t1", signal: new AbortController().signal } as never)
    const v = (request.mock.calls[0] as unknown as [{ verdict: { ruleId: string; reason: string } }])[0].verdict
    expect(v.ruleId).toBe(API_RULE)
    expect(v.reason).toContain("- export function format(v: unknown) { return String(v) }")
  })

  it("leaves an application's modules alone", async () => {
    const app = fs.mkdtempSync(path.join(os.tmpdir(), "gh-api-app-"))
    try {
      fs.mkdirSync(path.join(app, "src"))
      fs.writeFileSync(path.join(app, "package.json"), JSON.stringify({ name: "app", private: true, main: "src/index.ts" }))
      fs.writeFileSync(path.join(app, "src", "index.ts"), LIB)
      expect(await apiBreak(app, "Write", { file_path: path.join(app, "src", "index.ts"), content: "export const x = 1\n" })).toBeUndefined()
    } finally {
      fs.rmSync(app, { recursive: true, force: true })
    }
  })
})
