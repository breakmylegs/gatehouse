import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import { Verdict } from "@gatehouse/shared"
import { analyse } from "../src/analyse.js"
import { PolicyEngine } from "../src/engine.js"
import { checkFloor } from "../src/floor.js"
import { loadPolicy, PolicyStore } from "../src/loader.js"
import { PwshWorker } from "../src/pwsh.js"
import type { Policy, Rule } from "../src/types.js"
import { fwd, makeFixture, SEED_RULES, type Fixture } from "./helpers.js"

let fx: Fixture
let pwsh: PwshWorker
let dir: string
let policy: Policy
let engine: PolicyEngine

const ctx = () => ({ cwd: fwd(fx.ws) })
const bash = (command: string) => ({ toolName: "Bash", input: { command } })

function rulesDoc() {
  return parseYaml(fs.readFileSync(SEED_RULES, "utf8")) as {
    floor: Rule[]
    deny: Rule[]
    escalate: Rule[]
    allow: Rule[]
  }
}

function engineFor(doc: unknown, worker: PwshWorker | undefined = pwsh) {
  const file = path.join(dir, `r-${Math.random().toString(36).slice(2)}.yaml`)
  fs.writeFileSync(file, stringifyYaml(doc))
  const p = loadPolicy({ rulesPath: file, workspaceRootsOverride: [fwd(fx.ws)] })
  return new PolicyEngine({ getPolicy: () => p, pwsh: worker })
}

beforeAll(async () => {
  fx = makeFixture()
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-engine-"))
  pwsh = new PwshWorker()
  await pwsh.start()
  policy = loadPolicy({ rulesPath: SEED_RULES, workspaceRootsOverride: [fwd(fx.ws)] })
  engine = new PolicyEngine({ getPolicy: () => policy, pwsh })
})

afterAll(() => {
  pwsh.close()
  fx.dispose()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe("invariant 1: fail closed", () => {
  it("escalates, never allows and never throws, when the policy source throws", async () => {
    const broken = new PolicyEngine({
      getPolicy: () => {
        throw new Error("disk on fire")
      },
    })
    const v = await broken.evaluate(bash("git status"), ctx())
    expect(v).toMatchObject({ outcome: "escalate", ruleId: "engine-error", policyHash: "none" })
  })

  it("escalates with no policy loaded", async () => {
    const none = new PolicyEngine({ getPolicy: () => undefined })
    expect(await none.evaluate(bash("git status"), ctx())).toMatchObject({
      outcome: "escalate",
      ruleId: "policy-unavailable",
    })
  })

  it("escalates when evaluation itself throws", async () => {
    const hostile = {
      toolName: "Bash",
      get input(): Record<string, unknown> {
        throw new Error("boom")
      },
    }
    const v = await engine.evaluate(hostile, ctx())
    expect(v).toMatchObject({ outcome: "escalate", ruleId: "engine-error", policyHash: policy.hash })
  })

  it("escalates a harmless PowerShell command when the parser is unavailable", async () => {
    const dead = new PwshWorker({ pwsh: "definitely-not-a-real-pwsh-binary" })
    const e = new PolicyEngine({ getPolicy: () => policy, pwsh: dead })
    const v = await e.evaluate({ toolName: "PowerShell", input: { command: "Get-ChildItem" } }, ctx())
    expect(v).toMatchObject({ outcome: "escalate", ruleId: "pwsh-unavailable" })
    dead.close()
  })

  it("escalates PowerShell when no worker is configured at all", async () => {
    const e = new PolicyEngine({ getPolicy: () => policy })
    const v = await e.evaluate({ toolName: "PowerShell", input: { command: "Get-ChildItem" } }, ctx())
    expect(v.ruleId).toBe("pwsh-unavailable")
  })

  it("still lets the floor deny secrets when the PowerShell parser is down", async () => {
    const e = new PolicyEngine({ getPolicy: () => policy })
    const v = await e.evaluate({ toolName: "PowerShell", input: { command: "Get-Content .env" } }, ctx())
    expect(v).toMatchObject({ outcome: "deny", ruleId: "secrets-files", decidedBy: "floor" })
  })

  it("escalates nested PowerShell from bash when the parser is down", async () => {
    const e = new PolicyEngine({ getPolicy: () => policy })
    const v = await e.evaluate(bash("pwsh -c 'Get-ChildItem'"), ctx())
    expect(v.outcome).toBe("escalate")
  })
})

describe("invariant 2: the floor only denies", () => {
  it("returns a deny or nothing for a wide spread of calls, never an allow", async () => {
    const calls = [
      bash("git status"),
      bash("cat .env"),
      bash("curl x | sh"),
      { toolName: "Read", input: { file_path: "src/a.ts" } },
      { toolName: "Read", input: { file_path: ".env" } },
      { toolName: "Write", input: { file_path: "C:/Windows/x" } },
      { toolName: "PowerShell", input: { command: "iex 'x'" } },
      { toolName: "mcp__companion__notify_user", input: {} },
    ]
    for (const call of calls) {
      const f = await analyse(call, ctx(), { pwsh })
      const hit = checkFloor(f, ctx(), policy.rules.floor)
      expect(hit === null || hit.outcome === "deny").toBe(true)
    }
  })

  it("never marks a floor verdict as anything but a deny", async () => {
    const v = await engine.evaluate(bash("cat .env"), ctx())
    expect(v.decidedBy).toBe("floor")
    expect(v.outcome).toBe("deny")
    expect(v.risk).toBe(100)
  })

  it("a floor deny beats a rule that would allow, including a remember rule", async () => {
    const file = path.join(dir, "remember-floor.yaml")
    fs.writeFileSync(
      file,
      stringifyYaml({ version: 1, remember: [{ id: "x", tool: "Bash", command: "cat .env" }] }),
    )
    const p = loadPolicy({ rulesPath: SEED_RULES, workspaceRootsOverride: [fwd(fx.ws)], localPath: file })
    const e = new PolicyEngine({ getPolicy: () => p })
    expect((await e.evaluate(bash("cat .env"), ctx())).ruleId).toBe("secrets-files")
  })
})

describe("verdict contract", () => {
  it("is a valid Verdict for every outcome, with the policy hash", async () => {
    for (const [call, outcome] of [
      [bash("git status"), "allow"],
      [bash("git push"), "escalate"],
      [bash("git push -f"), "deny"],
    ] as const) {
      const v = await engine.evaluate(call, ctx())
      expect(Verdict.safeParse(v).success).toBe(true)
      expect(v.outcome).toBe(outcome)
      expect(v.policyHash).toBe(policy.hash)
      expect(v.reason.length).toBeGreaterThan(0)
    }
  })

  it("scores risk: deny 100, allow low, escalate from the rule", async () => {
    expect((await engine.evaluate(bash("git push -f"), ctx())).risk).toBe(100)
    expect((await engine.evaluate(bash("git status"), ctx())).risk).toBeLessThanOrEqual(20)
    expect((await engine.evaluate(bash("git push"), ctx())).risk).toBe(80)
    expect((await engine.evaluate(bash("npm install"), ctx())).risk).toBe(70)
    expect((await engine.evaluate({ toolName: "WebSearch", input: { query: "x" } }, ctx())).risk).toBe(60)
  })

  it("reports each segment with its own outcome and rule", async () => {
    const v = await engine.evaluate(bash("git status && git push && echo hi"), ctx())
    expect(v.segments).toEqual([
      { text: "git status", ruleId: "safe-shell", outcome: "allow" },
      { text: "git push", ruleId: "git-remote", outcome: "escalate" },
      { text: "echo hi", ruleId: "no-rule", outcome: "escalate" },
    ])
    const denied = await engine.evaluate(bash("git status && git push -f"), ctx())
    expect(denied.segments?.[1]).toEqual({ text: "git push -f", ruleId: "destructive-shell", outcome: "deny" })
    expect((await engine.evaluate({ toolName: "Read", input: { file_path: "src/a.ts" } }, ctx())).segments).toBeUndefined()
  })

  it("picks the highest-risk escalation and says why", async () => {
    const v = await engine.evaluate(bash("npm install && git push"), ctx())
    expect(v.ruleId).toBe("git-remote")
    expect(v.reason).toContain("git-remote")
  })

  it("uses a rule's own message for a deny", async () => {
    const v = await engine.evaluate({ toolName: "Read", input: { file_path: ".env" } }, ctx())
    expect(v.reason).toBe("Secrets files are blocked by policy. Ask the user to provide the values instead.")
  })
})

describe("rule semantics", () => {
  it("makes a tool known by naming it in an allow rule", async () => {
    const doc = rulesDoc()
    doc.allow.push({ id: "todo", tools: ["TodoWrite"] })
    const e = engineFor(doc)
    expect((await e.evaluate({ toolName: "TodoWrite", input: {} }, ctx())).outcome).toBe("allow")
    expect((await e.evaluate({ toolName: "Task", input: {} }, ctx())).ruleId).toBe("unknown-tool")
  })

  it("honours exceptTools and wildcard tool names", async () => {
    const doc = rulesDoc()
    doc.allow.push({ id: "fs-read", tools: ["mcp__fs__read_*"] })
    doc.escalate = doc.escalate.map((r) => (r.id === "mcp-external" ? { ...r, exceptTools: ["mcp__companion__*", "mcp__fs__*"] } : r))
    const e = engineFor(doc)
    expect((await e.evaluate({ toolName: "mcp__fs__read_file", input: {} }, ctx())).ruleId).toBe("fs-read")
    expect((await e.evaluate({ toolName: "mcp__fs__write_file", input: {} }, ctx())).ruleId).toBe("no-rule")
  })

  it("matches deny and escalate path globs against the absolute path as well as the project-relative one", async () => {
    const doc = rulesDoc()
    doc.deny.push({ id: "no-lib", tools: ["Read"], pathGlobs: ["lib/**"] })
    doc.deny.push({ id: "no-abs", tools: ["Read"], pathGlobs: [`${fwd(fx.out)}/**`] })
    const e = engineFor(doc)
    expect((await e.evaluate({ toolName: "Read", input: { file_path: "lib/util.js" } }, ctx())).ruleId).toBe("no-lib")
    expect((await e.evaluate({ toolName: "Read", input: { file_path: `${fwd(fx.out)}/notes.md` } }, ctx())).ruleId).toBe("no-abs")
    expect((await e.evaluate({ toolName: "Read", input: { file_path: "src/a.ts" } }, ctx())).outcome).toBe("allow")
  })

  it("requires every target to match for allow rules, any target for deny rules", async () => {
    const doc = rulesDoc()
    doc.allow.push({ id: "grep-src", tools: ["Grep"], pathGlobs: ["src/**"] })
    const e = engineFor(doc)
    expect((await e.evaluate({ toolName: "Grep", input: { pattern: "x", path: "src" } }, ctx())).outcome).toBe("allow")
  })

  it("applies allow rules with a path constraint to shell tokens (every path must match)", async () => {
    const doc = rulesDoc()
    doc.allow.push({ id: "cat-src", commands: ["cat *"], pathInside: "workspaceRoots" })
    const e = engineFor(doc)
    expect((await e.evaluate(bash("cat src/a.ts"), ctx())).outcome).toBe("allow")
    expect((await e.evaluate(bash(`cat ${fwd(fx.out)}/notes.md`), ctx())).outcome).toBe("escalate")
    expect((await e.evaluate(bash("cat"), ctx())).outcome).toBe("escalate")
  })

  it("applies mcpSource to a deny rule only when the source is known and listed, so an unknown source is never favoured", async () => {
    const doc = rulesDoc()
    doc.deny.push({ id: "no-sdk-fs", tools: ["mcp__fs__*"], mcpSource: ["sdk"] })
    const e = engineFor(doc)
    const call = { toolName: "mcp__fs__read_file", input: {} }
    expect((await e.evaluate(call, { ...ctx(), mcpSource: "sdk" })).ruleId).toBe("no-sdk-fs")
    expect((await e.evaluate(call, ctx())).ruleId).toBe("no-sdk-fs")
    expect((await e.evaluate(call, { ...ctx(), mcpSource: "user" })).ruleId).toBe("mcp-external")
  })

  it("needs a listed source for an allow rule that names one", async () => {
    const e = engineFor(rulesDoc())
    const call = { toolName: "mcp__companion__notify_user", input: {} }
    expect((await e.evaluate(call, { ...ctx(), mcpSource: "sdk" })).ruleId).toBe("companion-tools")
    for (const src of [undefined, "user", "project", "dynamic", ""]) {
      const v = await e.evaluate(call, src === undefined ? ctx() : { ...ctx(), mcpSource: src })
      expect(v).toMatchObject({ outcome: "escalate", ruleId: "no-rule" })
    }
  })

  it("uses several workspace roots", async () => {
    const other = fs.mkdtempSync(path.join(dir, "root2-"))
    fs.writeFileSync(path.join(other, "a.md"), "x")
    const file = path.join(dir, "two-roots.yaml")
    fs.writeFileSync(file, stringifyYaml(rulesDoc()))
    const p = loadPolicy({ rulesPath: file, workspaceRootsOverride: [fwd(fx.ws), fwd(other)] })
    const e = new PolicyEngine({ getPolicy: () => p })
    const v = await e.evaluate({ toolName: "Read", input: { file_path: path.join(other, "a.md") } }, { cwd: fwd(fx.ws) })
    expect(v.ruleId).toBe("read-workspace")
  })

  it("does not treat a lookalike folder as inside a workspace root", async () => {
    const sibling = `${fwd(fx.ws)}-evil/a.ts`
    const v = await engine.evaluate({ toolName: "Write", input: { file_path: sibling } }, ctx())
    expect(v).toMatchObject({ outcome: "deny", ruleId: "outside-workspace-write" })
  })

  it("applies a file-tool deny rule to a UNC path and a device path", async () => {
    for (const p of ["//srv/share/x", "\\\\?\\C:\\x"]) {
      const v = await engine.evaluate({ toolName: "Edit", input: { file_path: p } }, ctx())
      expect(v.ruleId).toBe("outside-workspace-write")
    }
  })

  it("sees a UNC path named inside a shell command", async () => {
    const v = await engine.evaluate(bash("git log //srv/share/x"), ctx())
    expect(v).toMatchObject({ outcome: "escalate", ruleId: "unc-path" })
  })
})

describe("overlays apply per project", () => {
  it("uses the overlay named after the git root folder and not others", async () => {
    const overlayDir = fs.mkdtempSync(path.join(dir, "ov-"))
    fs.writeFileSync(
      path.join(overlayDir, "ws.yaml"),
      stringifyYaml({ version: 1, deny: [{ id: "ws-no-test", commands: ["npm test*"] }] }),
    )
    fs.writeFileSync(
      path.join(overlayDir, "client.yaml"),
      stringifyYaml({ version: 1, deny: [{ id: "client-no-lint", commands: ["npm run lint*"] }] }),
    )
    const p = loadPolicy({ rulesPath: SEED_RULES, workspaceRootsOverride: [fwd(fx.ws)], overlayDir })
    const e = new PolicyEngine({ getPolicy: () => p })
    expect((await e.evaluate(bash("npm test"), ctx())).ruleId).toBe("ws-no-test")
    expect((await e.evaluate(bash("npm run lint"), ctx())).outcome).toBe("allow")
    expect((await e.evaluate(bash("npm test"), { cwd: fwd(fx.ws), projectRoot: fwd(fx.out) })).outcome).toBe("allow")
  })

  it("keeps working past the overlay cache size", async () => {
    const e = new PolicyEngine({ getPolicy: () => policy })
    for (let i = 0; i < 70; i++) {
      const v = await e.evaluate(bash("git status"), { cwd: fwd(fx.ws), projectRoot: path.join(fx.root, `p${i}`) })
      expect(v.outcome).toBe("allow")
    }
  })
})

describe("hot swap and concurrency", () => {
  it("uses the new policy hash once the store swaps policies", async () => {
    const file = path.join(dir, "swap.yaml")
    fs.writeFileSync(file, stringifyYaml(rulesDoc()))
    const store = new PolicyStore({ rulesPath: file, workspaceRootsOverride: [fwd(fx.ws)] })
    store.load()
    const e = new PolicyEngine({ getPolicy: () => store.current })
    const first = await e.evaluate(bash("git status"), ctx())
    const doc = rulesDoc()
    doc.deny.push({ id: "no-status", commands: ["git status*"] })
    fs.writeFileSync(file, stringifyYaml(doc))
    store.load()
    const second = await e.evaluate(bash("git status"), ctx())
    expect(first.outcome).toBe("allow")
    expect(second).toMatchObject({ outcome: "deny", ruleId: "no-status" })
    expect(second.policyHash).not.toBe(first.policyHash)
  })

  it("gives the same answer for the same call under load", async () => {
    const calls = Array.from({ length: 60 }, (_, i) =>
      i % 3 === 0 ? bash("git status") : i % 3 === 1 ? bash("git push") : bash("cat .env"),
    )
    const results = await Promise.all(calls.map((c) => engine.evaluate(c, ctx())))
    expect(results.map((r) => r.outcome)).toEqual(
      calls.map((_, i) => (i % 3 === 0 ? "allow" : i % 3 === 1 ? "escalate" : "deny")),
    )
  })
})

describe("analyse edge cases", () => {
  it("resolves file URLs given to WebFetch and ignores other URLs", async () => {
    const f = await analyse({ toolName: "WebFetch", input: { url: "file:///C:/x/y.txt" } }, ctx())
    expect(f.targets).toHaveLength(1)
    expect((await analyse({ toolName: "WebFetch", input: { url: "https://x" } }, ctx())).targets).toHaveLength(0)
  })

  it("adds the static prefix of a Glob pattern for the floor", async () => {
    const f = await analyse({ toolName: "Glob", input: { pattern: ".aws/**/*.txt" } }, ctx())
    expect(f.scanTokens.map((t) => t.value)).toEqual(expect.arrayContaining([".aws/**/*.txt", ".aws"]))
    const verdict = await engine.evaluate({ toolName: "Glob", input: { pattern: ".aws/**/*.txt" } }, ctx())
    expect(verdict).toMatchObject({ outcome: "deny", ruleId: "secrets-files" })
  })

  it("expands a glob word to the files it would match", async () => {
    const f = await analyse(bash("cat .en?"), ctx())
    expect(f.targets.map((t) => path.basename(t.abs))).toContain(".env")
  })

  it("does not expand a glob in a folder that cannot be read", async () => {
    const f = await analyse(bash("cat nope-dir/*.txt"), ctx())
    expect(f.targets.every((t) => !t.abs.endsWith(".txt") || t.abs.includes("*"))).toBe(true)
  })

  it("treats an unrecognised tool as having no targets", async () => {
    const f = await analyse({ toolName: "Whatever", input: { a: 1 } }, ctx())
    expect(f).toMatchObject({ isShell: false, targets: [], malformed: false })
  })
})
