// D-066 and D-006: what an untested file did before a change is captured with generated inputs, redacted, and kept only
// when it replays the same; after one intentional change, replaying shows exactly one behaviour delta, in words.
import { execFile, execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { behaviourDiff, capture, exportedFunctions, looksUntested } from "../src/characterise.js"
import type { MutationExec } from "../src/mutation.js"

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-charact-"))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))
const BEFORE = `export function price(qty, unit) {
  return qty * unit
}
export const label = (n) => "n=" + n
export function token() {
  return "sk-ant-api03-" + "x".repeat(30)
}
`
const AFTER = BEFORE.replace("  return qty * unit", "  if (qty === 42) return 0\n  return qty * unit")
const redact = (t: string) => t.replace(/sk-ant-[A-Za-z0-9_-]+/g, "[REDACTED:anthropic-key]")
const exec: MutationExec = (command, cwd, timeoutMs) =>
  new Promise((resolve) => {
    const [bin, ...args] = command.split(" ")
    execFile(bin!, args, { cwd, timeout: timeoutMs, windowsHide: true }, (e, stdout, stderr) =>
      resolve({ exitCode: e ? 1 : 0, output: `${stdout}${stderr}`, timedOut: false }),
    )
  })

let repo: string
beforeAll(() => {
  repo = path.join(root, "repo")
  fs.mkdirSync(path.join(repo, "src"), { recursive: true })
  fs.mkdirSync(path.join(repo, "test"))
  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ type: "module" }))
  fs.writeFileSync(path.join(repo, "src", "price.js"), AFTER)
  fs.writeFileSync(path.join(repo, "test", "other.test.js"), 'import { x } from "../src/other.js"\n')
  execFileSync("git", ["init", "-q"], { cwd: repo, windowsHide: true })
})

describe("characterisation capture and the behaviour diff (D-066, D-006)", () => {
  it("finds the exported functions, and that nothing tests the file", async () => {
    expect(await exportedFunctions("src/price.js", BEFORE)).toEqual([
      { name: "price", arity: 2 },
      { name: "label", arity: 1 },
      { name: "token", arity: 0 },
    ])
    expect(looksUntested(repo, "src/price.js", ["test/other.test.js"])).toBe(true)
    expect(looksUntested(repo, "src/other.js", ["test/other.test.js"])).toBe(false)
  })

  it("captures what the file did before, redacted and replayed green, and shows exactly the one behaviour that changed", async () => {
    let n = 0
    const cap = await capture({ root: repo, file: "src/price.js", before: BEFORE, from: "refs/x", exec, sandbox: () => path.join(root, `box${n++}`), redact })
    expect(cap.cases.length).toBeGreaterThan(10)
    // The recorded data passes redaction.
    expect(JSON.stringify(cap)).not.toContain("sk-ant-api03")
    expect(JSON.stringify(cap)).toContain("[REDACTED:anthropic-key]")
    // Replayed against the file as it was, nothing differs (green).
    expect(await behaviourDiff({ root: repo, capture: cap, now: BEFORE, exec, sandbox: path.join(root, "box-same"), redact })).toEqual([])
    // Against the file as it is now, one input behaves differently, said in words.
    const deltas = await behaviourDiff({ root: repo, capture: cap, now: AFTER, exec, sandbox: path.join(root, "box-now"), redact })
    expect(deltas).toHaveLength(1)
    expect(deltas[0]!.fn).toBe("price")
    expect(deltas[0]!.args[0]).toBe(42)
    expect(deltas[0]!.words).toMatch(/^price\(42, .+\) returned .+ before the change, and now returned 0\.$/)
    // The sandboxes are gone and the project is as it was.
    expect(fs.readdirSync(root).filter((d) => d.startsWith("box"))).toEqual([])
    expect(fs.readFileSync(path.join(repo, "src", "price.js"), "utf8")).toBe(AFTER)
  })
})
