import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import { loadPolicy } from "../src/loader.js"
import { PolicyEngine } from "../src/engine.js"
import { parseReplayLine, readReplayFile, replay } from "../src/replay.js"
import { fwd, makeFixture, SEED_RULES, type Fixture } from "./helpers.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const POLICY_PKG = path.resolve(here, "..")

let fx: Fixture
let dir: string
let engine: PolicyEngine

const rec = (tool: string, input: Record<string, unknown>, outcome: string, ruleId: string, cwd = fwd(fx.ws)) =>
  JSON.stringify({ ts: "2026-01-01T00:00:00Z", session: "s", tool, input, cwd, verdict: { outcome, ruleId }, hash: "h" })

beforeAll(() => {
  fx = makeFixture()
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-replay-"))
  const policy = loadPolicy({ rulesPath: SEED_RULES, workspaceRootsOverride: [fwd(fx.ws)] })
  engine = new PolicyEngine({ getPolicy: () => policy })
})
afterAll(() => {
  fx.dispose()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe("parseReplayLine", () => {
  it("reads nested and flat verdicts and both tool field names", () => {
    const nested = parseReplayLine(rec("Bash", { command: "git status" }, "allow", "safe-shell"), 1)
    expect(nested).toMatchObject({ toolName: "Bash", before: { outcome: "allow", ruleId: "safe-shell" } })
    const flat = parseReplayLine(
      JSON.stringify({ toolName: "Read", input: { file_path: "x" }, cwd: "C:/p", outcome: "deny", ruleId: "r" }),
      2,
    )
    expect(flat).toMatchObject({ toolName: "Read", before: { outcome: "deny", ruleId: "r" } })
  })

  it("reads the redacted input an audit record keeps as a JSON string", () => {
    const audit = JSON.stringify({
      tool: "Bash",
      inputJson: JSON.stringify({ command: "git status" }),
      cwd: "C:/p",
      verdict: { outcome: "allow", ruleId: "safe-shell" },
    })
    expect(parseReplayLine(audit, 1)).toMatchObject({ toolName: "Bash", input: { command: "git status" } })
    const broken = JSON.stringify({ tool: "Bash", inputJson: "{nope", cwd: "C:/p", verdict: { outcome: "allow", ruleId: "r" } })
    expect(parseReplayLine(broken, 1)).toBeUndefined()
    const notObject = JSON.stringify({ tool: "Bash", inputJson: "[1]", cwd: "C:/p", verdict: { outcome: "allow", ruleId: "r" } })
    expect(parseReplayLine(notObject, 1)).toBeUndefined()
  })

  it("rejects lines that cannot be replayed", () => {
    for (const line of [
      "not json",
      "[]",
      "5",
      JSON.stringify({ tool: "Bash", input: {}, cwd: "C:/p" }),
      JSON.stringify({ tool: "Bash", input: {}, cwd: "C:/p", verdict: { outcome: "maybe", ruleId: "r" } }),
      JSON.stringify({ tool: "Bash", cwd: "C:/p", verdict: { outcome: "allow", ruleId: "r" } }),
      JSON.stringify({ input: {}, cwd: "C:/p", verdict: { outcome: "allow", ruleId: "r" } }),
      JSON.stringify({ tool: "Bash", input: {}, verdict: { outcome: "allow", ruleId: "r" } }),
    ]) {
      expect(parseReplayLine(line, 1)).toBeUndefined()
    }
  })
})

describe("readReplayFile and replay", () => {
  it("reads records, skips bad lines and blank lines, and lists changes", async () => {
    const file = path.join(dir, "audit.jsonl")
    fs.writeFileSync(
      file,
      [
        rec("Bash", { command: "git status" }, "allow", "safe-shell"),
        "",
        "garbage",
        rec("Bash", { command: "git push" }, "allow", "old-rule"),
        rec("Bash", { command: "npm test" }, "escalate", "no-rule"),
        rec("Read", { file_path: ".env" }, "allow", "read-workspace"),
        rec("Bash", { command: "git log" }, "allow", "other-id"),
      ].join("\r\n"),
    )
    const { records, skipped } = readReplayFile(file)
    expect(records).toHaveLength(5)
    expect(skipped).toEqual([3])

    const result = await replay(engine, records, skipped)
    expect(result.total).toBe(5)
    expect(result.changes.map((c) => [c.line, c.before.outcome, c.after.outcome, c.after.ruleId])).toEqual([
      [4, "allow", "escalate", "git-remote"],
      [5, "escalate", "allow", "safe-shell"],
      [6, "allow", "deny", "secrets-files"],
    ])
    expect(result.changes.every((c) => c.outcomeChanged)).toBe(true)
    expect(result.changes[0]?.summary).toBe("Bash: git push")

    const withRules = await replay(engine, records, skipped, { includeRuleChanges: true })
    expect(withRules.changes.map((c) => c.line)).toEqual([4, 5, 6, 7])
    expect(withRules.changes[3]?.outcomeChanged).toBe(false)
  })

  it("summarises long inputs and inputs with no obvious field", async () => {
    const long = "x".repeat(300)
    const { records } = (() => {
      const file = path.join(dir, "long.jsonl")
      fs.writeFileSync(
        file,
        [rec("Bash", { command: long }, "allow", "r"), rec("Task", { prompt: "p" }, "allow", "r")].join("\n"),
      )
      return readReplayFile(file)
    })()
    const result = await replay(engine, records)
    expect(result.changes[0]?.summary.length).toBeLessThan(140)
    expect(result.changes[0]?.summary.endsWith("...")).toBe(true)
    expect(result.changes[1]?.summary).toBe('Task: {"prompt":"p"}')
  })
})

describe("npm run policy:replay (the CLI)", () => {
  function run(args: string[]) {
    return spawnSync(process.execPath, ["--import", "tsx", "src/replay-cli.ts", ...args], {
      cwd: POLICY_PKG,
      encoding: "utf8",
      timeout: 100000,
    })
  }

  it("lists the decisions a candidate rules file would change", () => {
    const doc = parseYaml(fs.readFileSync(SEED_RULES, "utf8")) as { deny: unknown[] }
    doc.deny.push({ id: "no-status", commands: ["git status*"] })
    const candidate = path.join(dir, "candidate.yaml")
    fs.writeFileSync(candidate, stringifyYaml(doc))
    const audit = path.join(dir, "cli-audit.jsonl")
    fs.writeFileSync(
      audit,
      [rec("Bash", { command: "git status" }, "allow", "safe-shell"), rec("Bash", { command: "git diff" }, "allow", "safe-shell")].join("\n"),
    )
    const out = run(["--rules", candidate, "--audit", audit, "--workspace-root", fwd(fx.ws)])
    expect(out.status).toBe(0)
    expect(out.stdout).toContain("replayed 2 decisions, 1 would change")
    expect(out.stdout).toContain("[OUTCOME] allow/safe-shell -> deny/no-status")
    expect(out.stdout).toContain("Bash: git status")

    const json = run(["--rules", candidate, "--audit", audit, "--workspace-root", fwd(fx.ws), "--json"])
    expect(JSON.parse(json.stdout).changes).toHaveLength(1)
  }, 120000)

  it("explains a candidate that does not load and exits non-zero", () => {
    const bad = path.join(dir, "bad.yaml")
    fs.writeFileSync(bad, "version: 1\n")
    const audit = path.join(dir, "empty.jsonl")
    fs.writeFileSync(audit, "")
    const out = run(["--rules", bad, "--audit", audit])
    expect(out.status).toBe(1)
    expect(out.stderr).toContain("Candidate rules did not load")
  })

  it("prints usage when arguments are missing", () => {
    const out = run([])
    expect(out.status).toBe(2)
    expect(out.stderr).toContain("Usage:")
  })
})
