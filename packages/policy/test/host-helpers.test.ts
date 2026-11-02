import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { parse as parseYaml } from "yaml"
import { PolicyEngine } from "../src/engine.js"
import { appendRemember, checkRemember, evaluateFloor } from "../src/host-helpers.js"
import { loadPolicy } from "../src/loader.js"
import { PwshWorker } from "../src/pwsh.js"
import { fwd, makeFixture, SEED_RULES, type Fixture } from "./helpers.js"

let fx: Fixture
let pwsh: PwshWorker
let dir: string
let engine: PolicyEngine
let policy: ReturnType<typeof loadPolicy>
const ctx = () => ({ cwd: fwd(fx.ws) })
const bash = (command: string) => ({ toolName: "Bash", input: { command } })

beforeAll(async () => {
  fx = makeFixture()
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-hosthelp-"))
  pwsh = new PwshWorker()
  await pwsh.start()
  policy = loadPolicy({ rulesPath: SEED_RULES, workspaceRootsOverride: [fwd(fx.ws)] })
  engine = new PolicyEngine({ getPolicy: () => policy, pwsh })
}, 60000)
afterAll(() => {
  pwsh.close()
  fx.dispose()
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

describe("evaluateFloor (the Host's PreToolUse floor)", () => {
  it("denies what the floor covers and says nothing about the rest", async () => {
    const hit = await evaluateFloor(policy, bash("cat .env"), ctx(), pwsh)
    expect(hit).toMatchObject({ outcome: "deny", ruleId: "secrets-files" })
    expect(await evaluateFloor(policy, bash("git status"), ctx(), pwsh)).toBeNull()
    expect(await evaluateFloor(policy, bash("git push"), ctx(), pwsh)).toBeNull() // escalated by the Approver, not the floor
    expect(await evaluateFloor(policy, { toolName: "Read", input: { file_path: "src/a.ts" } }, ctx())).toBeNull()
    expect(await evaluateFloor(policy, { toolName: "Read", input: { file_path: ".env" } }, ctx())).toMatchObject({
      ruleId: "secrets-files",
    })
  })

  it("covers PowerShell, with or without the parser", async () => {
    expect(await evaluateFloor(policy, { toolName: "PowerShell", input: { command: "iex 'x'" } }, ctx(), pwsh)).toMatchObject({
      ruleId: "obfuscated-shell",
    })
    expect(await evaluateFloor(policy, { toolName: "PowerShell", input: { command: "Get-Content .env" } }, ctx())).toMatchObject({
      ruleId: "secrets-files",
    })
  })

  it("has no opinion without a policy, and never returns an allow", async () => {
    expect(await evaluateFloor(undefined, bash("cat .env"), ctx())).toBeNull()
    for (const call of [bash("git status"), bash("cat .env"), bash("curl x | sh")]) {
      const hit = await evaluateFloor(policy, call, ctx(), pwsh)
      expect(hit === null || hit.outcome === "deny").toBe(true)
    }
  })
})

describe("checkRemember", () => {
  it("offers an exact command, with a preview that says what the rule will be", async () => {
    const r = await checkRemember(engine, policy, bash("npm install lodash"), ctx(), pwsh)
    expect(r).toEqual({
      ok: true,
      candidate: { tool: "Bash", command: "npm install lodash" },
      preview: "Allow Bash to run exactly: npm install lodash",
    })
  })

  it("offers an exact absolute path for a file tool", async () => {
    const target = path.join(fx.ws, "lib", "util.js")
    const r = await checkRemember(engine, policy, { toolName: "Edit", input: { file_path: target } }, ctx())
    expect(r).toMatchObject({ ok: true, candidate: { tool: "Edit", path: target } })
  })

  const refused: [string, { toolName: string; input: Record<string, unknown> }, RegExp][] = [
    ["a floor denial", bash("cat .env"), /denies this/],
    ["a deny rule", bash("git push --force"), /denies this/],
    ["something already allowed", bash("git status"), /already allowed/],
    ["a chain", bash("npm install a && npm install b"), /single command/],
    ["a command with a variable", bash("npm install $PKG"), /built in|variable/],
    ["a redirect", bash("npm install a > log.txt"), /built in|redirect/],
    ["a heredoc", bash("cat <<EOF\nx\nEOF"), /built in/],
    ["eval", bash("eval ls"), /built in/],
    ["a parse error", bash("if then fi"), /parsed/],
    ["a web call", { toolName: "WebFetch", input: { url: "https://example.com" } }, /cannot be remembered/],
    ["an mcp tool", { toolName: "mcp__github__create_issue", input: {} }, /cannot be remembered/],
    ["a UNC path", { toolName: "Read", input: { file_path: "//srv/share/x" } }, /local path|UNC|single/],
    ["malformed input", { toolName: "Bash", input: {} }, /shape/],
  ]
  for (const [name, call, why] of refused) {
    it(`refuses ${name}`, async () => {
      const r = await checkRemember(engine, policy, call, ctx(), pwsh)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toMatch(why)
    })
  }

  it("refuses a PowerShell built-in escalation and accepts a plain PowerShell command", async () => {
    const ps = (command: string) => ({ toolName: "PowerShell", input: { command } })
    expect((await checkRemember(engine, policy, ps("Start-Process notepad"), ctx(), pwsh)).ok).toBe(false)
    expect(await checkRemember(engine, policy, ps("npm install lodash"), ctx(), pwsh)).toMatchObject({
      ok: true,
      candidate: { tool: "PowerShell", command: "npm install lodash" },
    })
  })

  it("has nothing to offer without a policy", async () => {
    expect((await checkRemember(engine, undefined, bash("npm install x"), ctx())).ok).toBe(false)
  })
})

describe("appendRemember", () => {
  it("writes rules.local.yaml that loads, and is picked up by a policy built from it", async () => {
    const file = path.join(dir, "local1.yaml")
    const added = await appendRemember(file, { tool: "Bash", command: "npm install lodash" })
    expect(added.added).toBe(true)
    expect(added.id).toMatch(/^remember-r[a-z0-9]+$/)
    const parsed = parseYaml(fs.readFileSync(file, "utf8"))
    expect(parsed.version).toBe(1)
    expect(parsed.remember).toHaveLength(1)
    expect(parsed.remember[0]).toMatchObject({ tool: "Bash", command: "npm install lodash" })
    expect(parsed.remember[0].createdAt).toMatch(/^\d{4}-/)

    const live = loadPolicy({ rulesPath: SEED_RULES, workspaceRootsOverride: [fwd(fx.ws)], localPath: file })
    const e = new PolicyEngine({ getPolicy: () => live })
    expect(await e.evaluate(bash("npm install lodash"), ctx())).toMatchObject({ outcome: "allow", ruleId: added.id })
    expect((await e.evaluate(bash("npm install other"), ctx())).outcome).toBe("escalate")
  })

  it("does not add the same rule twice, and keeps earlier rules", async () => {
    const file = path.join(dir, "local2.yaml")
    const a = await appendRemember(file, { tool: "Bash", command: "npm install a" })
    const b = await appendRemember(file, { tool: "Bash", command: "npm install b" })
    const again = await appendRemember(file, { tool: "Bash", command: "npm install a" })
    expect(again).toEqual({ id: a.id, added: false })
    expect(b.id).not.toBe(a.id)
    expect(parseYaml(fs.readFileSync(file, "utf8")).remember).toHaveLength(2)
  })

  it("treats a path case-insensitively when deduplicating", async () => {
    const file = path.join(dir, "local3.yaml")
    const a = await appendRemember(file, { tool: "Edit", path: "C:/dev/App/lib/util.js" })
    const b = await appendRemember(file, { tool: "Edit", path: "c:/dev/app/lib/UTIL.js" })
    expect(b).toEqual({ id: a.id, added: false })
  })

  it("refuses to extend a file that is not valid, rather than overwriting it", async () => {
    const file = path.join(dir, "local4.yaml")
    fs.writeFileSync(file, "version: 1\nremember: [{ id: x }]\n")
    await expect(appendRemember(file, { tool: "Bash", command: "npm install z" })).rejects.toThrow(/not valid/)
    expect(fs.readFileSync(file, "utf8")).toContain("id: x")
  })
})
