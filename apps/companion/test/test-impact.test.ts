// D-065: test impact analysis. The tests a change affects, found by imports (through other files too) and by shared
// history, never more than the project's own tests; a coding session gets the tool and a chat does not.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { CompanionHandlers, TEST_IMPACT_TOOLS } from "../src/index.js"
import { affectedTests, byHistory, byImports } from "../src/test-impact.js"

let root: string
const write = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  fs.writeFileSync(path.join(root, rel), text)
}
const git = (...a: string[]) =>
  execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...a], { stdio: "ignore", windowsHide: true })

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-impact-"))
  write("src/price.ts", "export const price = (n: number) => n * 2\n")
  write("src/cart.ts", 'import { price } from "./price.js"\nexport const total = (a: number[]) => a.map(price)\n')
  write("src/other.ts", "export const other = 1\n")
  write("src/config.json.ts", "export const cfg = {}\n")
  write("test/cart.test.ts", 'import { total } from "../src/cart.js"\n')
  write("test/other.test.ts", 'import { other } from "../src/other"\n')
  write("test/mocked.test.ts", 'vi.mock("../src/price.ts")\n')
  write("test/config.test.ts", "// reads the config through the loader, not by import\n")
  write("pkg/util.py", "X = 1\n")
  write("pkg/test_util.py", "from .util import X\n")
  write("node_modules/dep/index.test.js", 'require("../../src/price.js")\n')
  git("init", "-q")
  git("add", ".")
  git("commit", "-q", "-m", "start")
  // A test that changed together with the config before, though nothing imports it.
  write("src/config.json.ts", "export const cfg = { a: 1 }\n")
  write("test/config.test.ts", "// reads the config through the loader, not by import (2)\n")
  git("add", ".")
  git("commit", "-q", "-m", "config")
})
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe("test impact analysis (D-065)", () => {
  it("finds the tests that reach a changed file through imports, at any depth, and through vi.mock", () => {
    expect([...byImports(root, ["src/price.ts"])].sort()).toEqual(["test/cart.test.ts", "test/mocked.test.ts"])
    expect([...byImports(root, ["src/other.ts"])]).toEqual(["test/other.test.ts"])
    expect([...byImports(root, ["pkg/util.py"])]).toEqual(["pkg/test_util.py"])
  })

  it("finds the tests that changed in the same commits, and the union is a subset of the project's tests", () => {
    expect([...byHistory(root, ["src/config.json.ts"])]).toContain("test/config.test.ts")
    const r = affectedTests(root, ["src/price.ts", "src/config.json.ts"])
    expect(r.tests).toEqual(expect.arrayContaining(["test/cart.test.ts", "test/mocked.test.ts", "test/config.test.ts"]))
    expect(r.tests).not.toContain("test/other.test.ts")
    expect(r.tests.some((t) => t.startsWith("node_modules/"))).toBe(false)
    expect(r.tests.length).toBeLessThan(r.all)
  })

  it("lists them for Claude from the working tree's changes, and says the whole suite still runs at the end", async () => {
    write("src/other.ts", "export const other = 2\n")
    const h = new CompanionHandlers({ sessionId: "s", cwd: root, host: { notify: async () => true }, policy: () => undefined, redact: (v) => v, testImpact: true })
    const out = (await h.affectedTests(undefined)).text
    expect(out).toContain("- test/other.test.ts")
    expect(out).not.toContain("test/cart.test.ts")
    expect(out).toMatch(/whole suite once before/)
    expect(TEST_IMPACT_TOOLS.map((t) => t.name)).toEqual(["affected_tests"])
    expect(TEST_IMPACT_TOOLS[0]!.annotations.readOnlyHint).toBe(true)
  })

  it("never narrows a release: npm run release still runs the security invariant tests by itself", () => {
    // The spec's "releases still run everything" as the owner set it on 13 Nov: a release runs the invariant tests
    // (each change is tested when it is made), chosen by the release script, never by this analysis.
    const release = fs.readFileSync(path.resolve(import.meta.dirname, "../../../scripts/release.ts"), "utf8")
    for (const t of ["invariants.test.ts", "threat-model.test.ts", "conformance.test.ts"]) expect(release).toContain(`apps/host/test/${t}`)
    expect(release).not.toMatch(/test-impact|affected_?tests/i)
  })
})
