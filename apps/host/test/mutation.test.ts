// D-004 and D-005, mutation testing of a change's new lines: a weak test leaves a survivor; the memory cap stops a run
// cleanly with a reason; mutants are made in a sandbox whose linked dependencies are never touched; a task writing a
// test for a survivor may change only test files; and the killed count rises once that test exists.
import { execFile, execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { createCanUseTool, type CanUseDeps } from "../src/canuse.js"
import { detectStryker, mutantsOf, runMutation, TEST_SCOPE_RULE, type MutationExec } from "../src/mutation.js"

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-mutate-"))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))
const SOURCE = "export function isAdult(age) {\n  return age >= 18 && age < 150\n}\n"
const WEAK = 'import { test } from "node:test"\nimport assert from "node:assert"\nimport { isAdult } from "../src/age.js"\ntest("adult", () => assert.equal(isAdult(30), true))\n'
const BETTER = WEAK + 'test("too old", () => assert.equal(isAdult(200), false))\n'
const COMMAND = "node --test test/"

/** A plain child process, as a test stands in for a Codehouse action. */
const exec: MutationExec = (command, cwd, timeoutMs) =>
  new Promise((resolve) => {
    const [bin, ...args] = command.split(" ")
    execFile(bin!, args, { cwd, timeout: timeoutMs, windowsHide: true }, (e, stdout, stderr) =>
      resolve({ exitCode: e ? ((e as { code?: number }).code ?? 1) : 0, output: `${stdout}${stderr}`, timedOut: false }),
    )
  })

let repo: string
beforeAll(() => {
  repo = path.join(root, "repo")
  fs.mkdirSync(path.join(repo, "src"), { recursive: true })
  fs.mkdirSync(path.join(repo, "test"))
  fs.mkdirSync(path.join(repo, "node_modules", "dep"), { recursive: true })
  fs.writeFileSync(path.join(repo, "node_modules", "dep", "index.js"), "module.exports = 1\n")
  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ type: "module", scripts: { test: COMMAND } }))
  fs.writeFileSync(path.join(repo, ".gitignore"), "node_modules/\n")
  fs.writeFileSync(path.join(repo, "src", "age.js"), SOURCE)
  fs.writeFileSync(path.join(repo, "test", "age.test.js"), WEAK)
  execFileSync("git", ["init", "-q"], { cwd: repo, windowsHide: true })
})

describe("mutation testing of the changed lines (D-004)", () => {
  it("finds that a weak test misses a change to the new line, in a sandbox, leaving the project alone", async () => {
    expect(detectStryker(repo)).toBeUndefined()
    const muts = await mutantsOf("src/age.js", SOURCE, new Set([2]))
    expect(muts.map((m) => m.mutated)).toContain("return age >= 18 || age < 150")
    // A test file is never mutated.
    expect(await mutantsOf("test/age.test.js", WEAK, new Set([4]))).toEqual([])
    const sandbox = path.join(root, "box1")
    const r = await runMutation({ root: repo, changes: [{ path: "src/age.js", text: SOURCE, lines: new Set([2]) }], command: COMMAND, exec, sandbox, threshold: 90 })
    expect(r.mutants).toBeGreaterThan(1)
    expect(r.survived.map((s) => s.mutated)).toContain("return age >= 18 || age < 150")
    expect(r.passed).toBe(false)
    // The sandbox is gone; the project and its linked dependencies are as they were.
    expect(fs.existsSync(sandbox)).toBe(false)
    expect(fs.readFileSync(path.join(repo, "src", "age.js"), "utf8")).toBe(SOURCE)
    expect(fs.readFileSync(path.join(repo, "node_modules", "dep", "index.js"), "utf8")).toBe("module.exports = 1\n")
  })

  it("stops cleanly with a reason when a run reaches the memory cap", async () => {
    const capped: MutationExec = async () => ({ exitCode: 1, output: "", timedOut: false, killed: true })
    const sandbox = path.join(root, "box2")
    const r = await runMutation({ root: repo, changes: [{ path: "src/age.js", text: SOURCE, lines: new Set([2]) }], command: COMMAND, exec: capped, sandbox })
    expect(r.aborted).toBe("the run reached the session's memory cap, so it stopped")
    expect(fs.existsSync(sandbox)).toBe(false)
  })
})

describe("a task for a surviving mutant (D-005)", () => {
  it("sends an edit outside the test files to a person, even in Extreme approval", async () => {
    const survivor = { file: "src/age.js", line: 2, original: "return age >= 18 && age < 150", mutated: "return age >= 18 || age < 150" }
    const request = vi.fn(async () => ({ outcome: "deny", channel: "desktop", waitedMs: 1 }))
    const deps = {
      sessionId: "s1",
      cwd: repo,
      project: "repo",
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
      mutantTask: () => survivor,
    } as unknown as CanUseDeps
    const canUse = createCanUseTool(deps)
    const opts = (id: string) => ({ toolUseID: id, signal: new AbortController().signal }) as never
    await canUse("Edit", { file_path: path.join(repo, "src", "age.js"), old_string: "&&", new_string: "&&" }, opts("t1"))
    expect(request).toHaveBeenCalledTimes(1)
    expect((request.mock.calls[0] as unknown as [{ verdict: { ruleId: string } }])[0].verdict.ruleId).toBe(TEST_SCOPE_RULE)
    // A test file is the task's to change.
    const r = await canUse("Edit", { file_path: path.join(repo, "test", "age.test.js"), old_string: "x", new_string: "y" }, opts("t2"))
    expect(request).toHaveBeenCalledTimes(1)
    expect(r?.behavior).toBe("allow")
  })

  it("counts the mutant as killed once a test catches it", async () => {
    const only = (m: { mutated: string }) => m.mutated === "return age >= 18 || age < 150"
    const before = await runMutation({ root: repo, changes: [{ path: "src/age.js", text: SOURCE, lines: new Set([2]) }], command: COMMAND, exec, sandbox: path.join(root, "box3"), only })
    expect(before.killed).toBe(0)
    fs.writeFileSync(path.join(repo, "test", "age.test.js"), BETTER)
    const after = await runMutation({ root: repo, changes: [{ path: "src/age.js", text: SOURCE, lines: new Set([2]) }], command: COMMAND, exec, sandbox: path.join(root, "box4"), only })
    expect(after.killed).toBe(1)
  })
})
