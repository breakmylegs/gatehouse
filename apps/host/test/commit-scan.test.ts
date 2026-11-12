// G22: a session's commit that would add a secret is refused by the floor; one that cannot be checked is asked.
// The secrets here are put together at run time, so this file holds none of them and can itself be committed.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { HookCallback } from "@anthropic-ai/claude-agent-sdk"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { parse as parseYaml } from "yaml"
import {
  makesCommit,
  makesPush,
  scanCommit,
  secretReason,
  secretsInDiff,
  SECRET_IN_COMMIT_RULE,
  type Found,
} from "../src/commit-scan.js"
import { createFloorHook } from "../src/hooks.js"

const AWS = ["AK", "IA", "Q3EGRIZBPLGW5", "XYZ"].join("")
const PEM = ["-----BEGIN ", "RSA PRIVATE", " KEY-----"].join("")

let dir: string
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: dir, encoding: "utf8", windowsHide: true }).trim()
beforeEach(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-commit-scan-")))
  git("init", "--quiet", "-b", "main")
  git("config", "user.email", "test@example.com")
  git("config", "user.name", "Test")
  fs.writeFileSync(path.join(dir, "README.md"), "shop\n")
  git("add", ".")
  git("commit", "--quiet", "-m", "first")
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe("secrets in a commit", () => {
  it("knows a commit when it sees one, chained or not, and only in a shell command", () => {
    for (const command of [
      'git commit -m "x"',
      "git add -A && git commit -m x",
      "git -c user.name=x commit -am wip",
    ])
      expect(makesCommit("Bash", { command }), command).toBe(true)
    expect(makesCommit("PowerShell", { command: "git commit -m x" })).toBe(true)
    for (const command of ["git status", "git log --grep commit", "echo commit"])
      expect(makesCommit("Bash", { command }), command).toBe(command === "git log --grep commit")
    expect(makesCommit("Write", { command: "git commit" })).toBe(false)
  })

  it("finds keys and private keys only in the lines a diff adds, and names the file", () => {
    const diff = [
      "+++ b/config/aws.ts",
      `+export const key = "${AWS}"`,
      `-export const old = "${AWS}"`,
      "+++ b/notes.md",
      "+ordinary words, password = hunter2 in a sentence",
    ].join("\n")
    expect(secretsInDiff(diff)).toEqual([{ file: "config/aws.ts", kind: "an AWS access key" }])
    const reason = secretReason(secretsInDiff(diff))
    expect(reason).toContain("an AWS access key in config/aws.ts")
    expect(reason).not.toContain(AWS)
  })

  it("reads what is staged, what -a would take, and new files a chained git add would take", async () => {
    fs.writeFileSync(path.join(dir, "staged.ts"), `const k = "${AWS}"\n`)
    git("add", "staged.ts")
    expect(await scanCommit(dir, 'git commit -m "x"')).toEqual([
      { file: "staged.ts", kind: "an AWS access key", line: 1 },
    ])
    git("commit", "--quiet", "-m", "two")
    // A change to a tracked file, not staged: only -a takes it.
    fs.writeFileSync(path.join(dir, "README.md"), `${PEM}\n`)
    expect(await scanCommit(dir, "git commit -m x")).toEqual([])
    expect(await scanCommit(dir, "git commit -am x")).toEqual([
      { file: "README.md", kind: "a private key", line: 1 },
    ])
    // A new file the same command adds first.
    fs.writeFileSync(path.join(dir, "new.env.ts"), `export const k = "${AWS}"\n`)
    const found = await scanCommit(dir, "git add -A && git commit -m x")
    expect(found).toContainEqual({ file: "new.env.ts", kind: "an AWS access key", line: 1 })
    // Outside a repository it cannot read the commit, and says so by throwing.
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "gh-commit-plain-"))
    try {
      await expect(scanCommit(plain, "git commit -m x")).rejects.toBeTruthy()
    } finally {
      fs.rmSync(plain, { recursive: true, force: true })
    }
  })
})

describe("the floor and a commit", () => {
  const hookWith = (scanner: (cwd: string, command: string) => Promise<Found[]>) => {
    const records: Array<Record<string, unknown>> = []
    const hook: HookCallback = createFloorHook({
      sessionId: "s",
      cwd: dir,
      policy: () => undefined,
      pwsh: undefined,
      audit: { record: async (r: Record<string, unknown>) => (records.push(r), true) } as never,
      kill: () => false,
      decided: new Set<string>(),
      onEvent: () => undefined,
      log: () => undefined,
      mode: () => "acceptEdits",
      commitScanner: scanner,
    })
    const call = async (command: string) =>
      (
        (await hook(
          {
            hook_event_name: "PreToolUse",
            tool_name: "Bash",
            tool_input: { command },
            tool_use_id: "t",
            cwd: dir,
            session_id: "x",
          } as never,
          "t",
          { signal: new AbortController().signal },
        )) as {
          hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string }
        }
      ).hookSpecificOutput
    return { call, records }
  }

  it("refuses a commit that would add a secret, records it without the value, and asks when it cannot check", async () => {
    const leak = hookWith(async () => [{ file: "a.ts", kind: "an AWS access key" }])
    const out = await leak.call("git commit -m x")
    expect(out).toMatchObject({ permissionDecision: "deny" })
    expect(out?.permissionDecisionReason).toContain(SECRET_IN_COMMIT_RULE)
    expect(leak.records[0]).toMatchObject({
      event: "floor_deny",
      verdict: { outcome: "deny", ruleId: SECRET_IN_COMMIT_RULE, decidedBy: "floor" },
    })
    const broken = hookWith(async () => {
      throw new Error("not a repository")
    })
    expect(await broken.call("git commit -m x")).toMatchObject({ permissionDecision: "ask" })
    // A clean commit, and anything that is not a commit, pass the floor as before (never an allow).
    const clean = hookWith(async () => [])
    expect((await clean.call("git commit -m x"))?.permissionDecision).not.toBe("deny")
    let asked = 0
    const notCommit = hookWith(async () => (asked++, []))
    await notCommit.call("git status")
    expect(asked).toBe(0)
  })
})

// D-058: the keys the golden cases name, put together here so no file holds one.
const TOKENS: Record<string, string> = {
  AWS,
  PEM,
  ANT: ["sk-", "ant-", "api03-", "Zq8wT4mN2vB6xC1rL9pK0j"].join(""),
  OPENAI: ["sk-", "proj-", "Hq3Lm8Rt2Wv6Xz9Bc4Nd7Fg1Jk5Pa0Se"].join(""),
  GH: ["gh", "p_", "R4nD0mT0k3nV4lu3F0rT3st1ngOnLy1234"].join(""),
  SLACK: ["xo", "xb-", "1234567890-0987654321-AbCdEf"].join(""),
  // A Google key is AIza and 35 more.
  GOOGLE: ["AI", "za", "SyD3mOk3yF0rT3st1ngPurp0s3s0nly1234"].join(""),
  URLPW: ["postgres://admin", ":", "s3cretpass", "@db.local/app"].join(""),
}

describe("the secret commit block (D-058)", () => {
  it("finds each golden line's secrets, and passes the lines that hold none", () => {
    const cases = parseYaml(fs.readFileSync(path.join(import.meta.dirname, "golden", "commit-secrets.yaml"), "utf8")) as Array<{
      line: string
      found: string[]
      note: string
    }>
    expect(cases.length).toBeGreaterThanOrEqual(15)
    for (const c of cases) {
      const line = c.line.replace(/\{([A-Z]+)\}/g, (_, k: string) => TOKENS[k] ?? `{${k}}`)
      const diff = `+++ b/f.txt\n@@ -0,0 +4,2 @@\n+first\n+${line}\n`
      const found = secretsInDiff(diff)
      expect(found.map((f) => f.kind), c.note).toEqual(c.found)
      for (const f of found) expect(f, c.note).toMatchObject({ file: "f.txt", line: 5 })
    }
  })

  it("knows a push, and reads what it would send: commits no remote has yet", async () => {
    expect(makesPush("Bash", { command: "git push origin main" })).toBe(true)
    expect(makesPush("PowerShell", { command: "git commit -m x; git push" })).toBe(true)
    expect(makesPush("Bash", { command: "git status" })).toBe(false)
    // A secret you committed yourself is not sent on by a session's push, and the finding names its line.
    fs.writeFileSync(path.join(dir, "keys.ts"), `// keys\n\nexport const k = "${AWS}"\n`)
    git("add", "keys.ts")
    git("commit", "--quiet", "-m", "keys")
    expect(await scanCommit(dir, "git push origin main")).toEqual([{ file: "keys.ts", kind: "an AWS access key", line: 3 }])
    // Once a remote has it, a push sends nothing new.
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "gh-commit-bare-"))
    try {
      execFileSync("git", ["init", "--quiet", "--bare", bare], { windowsHide: true })
      git("remote", "add", "origin", bare)
      git("push", "--quiet", "origin", "main")
      expect(await scanCommit(dir, "git push origin main")).toEqual([])
    } finally {
      fs.rmSync(bare, { recursive: true, force: true })
    }
  })

  it("denies a commit that stages a test AWS key in every mode, naming the file and line, never the value", async () => {
    fs.writeFileSync(path.join(dir, "cfg.ts"), `export const region = "eu-west-2"\nexport const key = "${AWS}"\n`)
    git("add", "cfg.ts")
    for (const mode of ["default", "plan", "acceptEdits", "auto"] as const) {
      const records: Array<Record<string, unknown>> = []
      const hook: HookCallback = createFloorHook({
        sessionId: "s",
        cwd: dir,
        policy: () => undefined,
        pwsh: undefined,
        audit: { record: async (r: Record<string, unknown>) => (records.push(r), true) } as never,
        kill: () => false,
        decided: new Set<string>(),
        onEvent: () => undefined,
        log: () => undefined,
        mode: () => mode,
      })
      const out = (
        (await hook(
          {
            hook_event_name: "PreToolUse",
            tool_name: "Bash",
            tool_input: { command: 'git commit -m "config"' },
            tool_use_id: "t",
            cwd: dir,
            session_id: "x",
          } as never,
          "t",
          { signal: new AbortController().signal },
        )) as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } }
      ).hookSpecificOutput
      expect(out?.permissionDecision, mode).toBe("deny")
      expect(out?.permissionDecisionReason, mode).toContain("an AWS access key in cfg.ts, line 2")
      expect(records[0], mode).toMatchObject({ event: "floor_deny", verdict: { ruleId: SECRET_IN_COMMIT_RULE } })
      expect(JSON.stringify({ out, records }), mode).not.toContain(AWS.slice(4))
    }
  })
})
