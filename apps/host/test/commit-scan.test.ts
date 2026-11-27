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
  isPlaceholder,
  makesCommit,
  makesPush,
  pushes,
  pushTargets,
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

  it("refuses a staged number that could be a real card, naming file and line only, and passes a test card (E-093)", () => {
    // A Luhn-valid Visa-shaped number, made here so this file holds none.
    const body = ["4532", "0151", "1283", "036"].join("")
    const card = [...Array(10).keys()].map((c) => `${body}${c}`).find((d) => [...d].reverse().reduce((s, ch, i) => s + (i % 2 ? (Number(ch) * 2 > 9 ? Number(ch) * 2 - 9 : Number(ch) * 2) : Number(ch)), 0) % 10 === 0) ?? ""
    const diff = ["+++ b/test/fixtures/order.json", "@@ -0,0 +1,2 @@", "+{", `+  "pan": "${card}"`, "+++ b/test/pay.test.ts", "@@ -0,0 +1 @@", '+charge("4242424242424242")'].join("\n")
    expect(secretsInDiff(diff)).toEqual([{ file: "test/fixtures/order.json", kind: "a card number", line: 2 }])
    expect(secretReason(secretsInDiff(diff))).not.toContain(card)
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
    expect(await scanCommit(dir, "git push origin main")).toEqual([{ file: "keys.ts", kind: "an AWS access key", line: 3, commit: git("rev-parse", "--short", "HEAD"), branch: "main" }])
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

// 24 Nov: a push from C:\dev\peter was refused every time for "a password in a web address in scripts/update.sh, line
// 496": an unpushed commit on another local branch added a placeholder there, and every push read every branch. The
// addresses are put together at run time, so this file holds none of them.
const url = (user: string, pw: string) => ["postgres://", user, ":", pw, "@db:5432/peter"].join("")
const REAL = url("peter", "Xk82jfL0q9")
const HINT = (pw: string) => `echo "DATABASE_URL=${url("peter", pw)}"`

describe("a push is judged on what it sends (24 Nov)", () => {
  let bare: string
  beforeEach(() => {
    bare = fs.mkdtempSync(path.join(os.tmpdir(), "gh-commit-bare-"))
    execFileSync("git", ["init", "--quiet", "--bare", bare], { windowsHide: true })
    git("remote", "add", "origin", bare)
    git("push", "--quiet", "-u", "origin", "main")
  })
  afterEach(() => fs.rmSync(bare, { recursive: true, force: true }))

  const commitFile = (file: string, text: string, msg: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), text)
    git("add", file)
    git("commit", "--quiet", "-m", msg)
    return git("rev-parse", "--short", "HEAD")
  }

  it("is not refused for a commit on another local branch that the push does not send", async () => {
    git("checkout", "--quiet", "-b", "deploy-alignment")
    const side = commitFile("scripts/update.sh", `#!/bin/sh\n\n\n${HINT("Xk82jfL0q9")}\n`, "side work, not for main")
    git("checkout", "--quiet", "main")
    commitFile("docs/notes.md", "nothing secret\n", "notes")
    expect(await scanCommit(dir, "git push origin main")).toEqual([])
    expect(await scanCommit(dir, "git push")).toEqual([])
    expect(await scanCommit(dir, "Set-Location C:\\x; git push origin main 2>&1 | Select-Object -Last 3")).toEqual([])
    // Sending that branch, or every branch, is still refused, naming the commit and its line there.
    const sent = [{ file: "scripts/update.sh", kind: "a password in a web address", line: 4, commit: side, branch: "deploy-alignment" }]
    expect(await scanCommit(dir, "git push origin deploy-alignment")).toEqual(sent)
    expect(await scanCommit(dir, "git push origin deploy-alignment:main")).toEqual(sent)
    // --all sends every branch: the finding is named without one branch.
    expect(await scanCommit(dir, "git push --all origin")).toEqual([{ file: "scripts/update.sh", kind: "a password in a web address", line: 4, commit: side }])
    // O59: the refusal names the file, the line in it, the commit that adds it and the branch it is on.
    expect(secretReason(sent)).toContain(`scripts/update.sh, line 4 of commit ${side} on branch deploy-alignment`)
  })

  it("is not refused, nor a commit, for removing a secret or rewording it away", async () => {
    commitFile("scripts/update.sh", `one\n${HINT("Xk82jfL0q9")}\n`, "with a password")
    git("push", "--quiet", "origin", "main")
    fs.writeFileSync(path.join(dir, "scripts/update.sh"), "one\necho the password inside DATABASE_URL must match\n")
    expect(await scanCommit(dir, "git commit -am reword")).toEqual([])
    git("commit", "--quiet", "-am", "reword")
    fs.writeFileSync(path.join(dir, "scripts/update.sh"), "one\n")
    expect(await scanCommit(dir, "git commit -am remove && git push origin main")).toEqual([])
  })

  it("reads the file as it is now: a rewording clears what was found, with nothing kept from before", async () => {
    fs.mkdirSync(path.join(dir, "scripts"))
    fs.writeFileSync(path.join(dir, "scripts/update.sh"), `a\n${HINT("Xk82jfL0q9")}\n`)
    git("add", ".")
    expect(await scanCommit(dir, "git commit -m x")).toEqual([{ file: "scripts/update.sh", kind: "a password in a web address", line: 2 }])
    fs.writeFileSync(path.join(dir, "scripts/update.sh"), `a\nb\n${HINT("<POSTGRES_PASSWORD>")}\n`)
    git("add", ".")
    expect(await scanCommit(dir, "git commit -m x")).toEqual([])
  })

  it("is not a push when a commit message only says push", async () => {
    git("checkout", "--quiet", "-b", "side")
    commitFile("s.sh", `${HINT("Xk82jfL0q9")}\n`, "side")
    git("checkout", "--quiet", "main")
    const command = 'git add -A; git commit -q -m "docs: so every session commits to main and pushes; then git push it"'
    expect(makesPush("PowerShell", { command: 'git commit -q -m "commits and pushes, then push"' })).toBe(false)
    expect(makesPush("PowerShell", { command: "git -C /c/dev/x push origin main" })).toBe(true)
    expect(makesPush("Bash", { command: 'git -c "user.name=A B" push' })).toBe(true)
    fs.writeFileSync(path.join(dir, "CLAUDE.md"), "rules\n")
    expect(await scanCommit(dir, command)).toEqual([])
  })
})

describe("placeholders in a web address (24 Nov)", () => {
  it("does not take a placeholder for a password, and still refuses a real-looking one", () => {
    const diffOf = (line: string) => `+++ b/scripts/update.sh\n@@ -0,0 +568 @@\n+${line}\n`
    for (const pw of ["<POSTGRES_PASSWORD>", "$PGPW_VALUE", "${PGPW}", "%PGPW%", "{{ pg_password }}".replace(/ /g, ""), "********", "REPLACE_WITH_POSTGRES_PASSWORD", "changeme", "CHANGE_ME", "your_password", "example", "xxxxxx", "password"])
      expect(secretsInDiff(diffOf(HINT(pw))), pw).toEqual([])
    expect(secretsInDiff(diffOf(HINT("Xk82jfL0q9")))).toEqual([{ file: "scripts/update.sh", kind: "a password in a web address", line: 568 }])
    expect(secretsInDiff(diffOf(REAL))).toHaveLength(1)
    // A placeholder beside a real one on the same line does not hide the real one.
    expect(secretsInDiff(diffOf(`${HINT("<PW>")} ${REAL}`))).toHaveLength(1)
    expect(isPlaceholder("s3cretpass")).toBe(false)
    expect(isPlaceholder("Xk82jfL0q9")).toBe(false)
  })

  it("never reads removed lines", () => {
    expect(secretsInDiff(`--- a/x.sh\n+++ b/x.sh\n@@ -496 +495,0 @@\n-${REAL}\n`)).toEqual([])
  })
})

describe("what a push sends (24 Nov)", () => {
  it("reads the remote and refspecs, the current branch to its upstream when none is named", () => {
    const up = { remote: "origin", branch: "main" }
    expect(pushTargets(["origin", "main"], "main", up)).toEqual({ remote: "origin", targets: [{ local: "main", remote: "origin", branch: "main" }] })
    expect(pushTargets([], "feature", { remote: "origin", branch: "feature-x" })).toEqual({ remote: "origin", targets: [{ local: "feature", remote: "origin", branch: "feature-x" }] })
    expect(pushTargets(["-u", "origin", "fix/a:main"], "fix/a", undefined)).toEqual({ remote: "origin", targets: [{ local: "fix/a", remote: "origin", branch: "main" }] })
    expect(pushTargets(["origin", "+HEAD:refs/heads/main"], "dev", undefined)).toEqual({ remote: "origin", targets: [{ local: "HEAD", remote: "origin", branch: "main" }] })
    expect(pushTargets(["origin", ":old"], "main", up)).toEqual({ remote: "origin", targets: [] })
    expect(pushTargets(["--all", "origin"], "main", up)).toEqual({ remote: "origin", all: true })
    expect(pushTargets(["origin", "refs/heads/*"], "main", up)).toEqual({ remote: "origin", all: true })
    expect(pushes("git -C /c/dev/gh-crash push origin fix/crash-evidence:main 2>&1 | tail -3")).toEqual([{ words: ["origin", "fix/crash-evidence:main"], dir: "/c/dev/gh-crash" }])
  })
})

// O59 (owner, 27 Nov): the push refused from C:\dev\peter, made sure of in a throwaway repository: a push is judged on
// what each branch sends, from what the remote has now; placeholders are not passwords; a real-looking one still is.
describe("a push judged only on what it sends, from the remote as it is now (O59)", () => {
  let bare: string
  const PH = HINT("<POSTGRES_PASSWORD>")
  beforeEach(() => {
    bare = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-o59-bare-")))
    execFileSync("git", ["init", "--quiet", "--bare", bare], { windowsHide: true })
    git("remote", "add", "origin", bare)
    git("push", "--quiet", "-u", "origin", "main")
  })
  afterEach(() => fs.rmSync(bare, { recursive: true, force: true }))
  const put = (file: string, text: string, msg: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), text)
    git("add", file)
    git("commit", "--quiet", "-m", msg)
    return git("rev-parse", "--short", "HEAD")
  }
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `echo line ${i + 1}`).join("\n")

  it("(a) commits and pushes a placeholder, then rewords it away and pushes again, never refused", async () => {
    fs.mkdirSync(path.join(dir, "scripts"))
    fs.writeFileSync(path.join(dir, "scripts/update.sh"), `${lines(495)}\n${PH}\n`)
    git("add", ".")
    expect(await scanCommit(dir, "git commit -m hint")).toEqual([])
    git("commit", "--quiet", "-m", "hint")
    expect(await scanCommit(dir, "git push")).toEqual([])
    git("push", "--quiet")
    fs.writeFileSync(path.join(dir, "scripts/update.sh"), `${lines(495)}\necho "DATABASE_URL: no address shape here"\n`)
    expect(await scanCommit(dir, "git commit -am reword && git push origin main")).toEqual([])
    git("commit", "--quiet", "-am", "reword")
    expect(await scanCommit(dir, "git push origin main")).toEqual([])
  }, 180_000)

  it("(b) allows commits that do not touch the file while another unpushed branch holds a real-looking secret", async () => {
    git("checkout", "--quiet", "-b", "deploy-alignment")
    put("scripts/update.sh", `${lines(495)}\n${HINT("Xk82jQp4vN")}\n`, "side")
    git("checkout", "--quiet", "main")
    put("docs/notes.md", "notes\n", "notes")
    for (const command of ["git push", "git push origin main", "git push origin HEAD", "git push -u origin main"])
      expect(await scanCommit(dir, command), command).toEqual([])
  }, 180_000)

  it("(c) reads the remote as it is now: a missing branch, a stale tracking ref, a remote that cannot be asked", async () => {
    // Missing: a new branch sends what that remote has nowhere, here only its own commit.
    git("checkout", "--quiet", "-b", "feature")
    expect(await scanCommit(dir, "git push -u origin feature")).toEqual([])
    const real = put("cfg.sh", `${REAL}\n`, "real")
    expect(await scanCommit(dir, "git push -u origin feature")).toEqual([{ file: "cfg.sh", kind: "a password in a web address", line: 1, commit: real, branch: "feature" }])
    git("checkout", "--quiet", "main")
    // Stale: the remote already has a commit (pushed by address, so origin/main did not move); only what is new is read.
    put("old.sh", `${REAL}\n`, "already there")
    execFileSync("git", ["push", "--quiet", bare, "main"], { cwd: dir, windowsHide: true })
    expect(git("rev-parse", "origin/main")).not.toBe(git("rev-parse", "main"))
    put("docs/new.md", "new\n", "new")
    expect(await scanCommit(dir, "git push origin main")).toEqual([])
    // Unknown: a remote that cannot be asked falls back to what that remote has nowhere, so more is read, never less.
    git("remote", "add", "gone", path.join(os.tmpdir(), "gh-o59-no-such-remote"))
    git("checkout", "--quiet", "-b", "offline")
    const off = put("off.sh", `${REAL}\n`, "offline")
    const unknown = await scanCommit(dir, "git push gone offline")
    expect(unknown).toContainEqual({ file: "off.sh", kind: "a password in a web address", line: 1, commit: off, branch: "offline" })
    // Everything that remote is not known to have, so main's commit is read too: more, never less.
    expect(unknown.map((x) => x.file).sort()).toEqual(["off.sh", "old.sh"])
    // An empty range sends nothing and is never refused.
    git("push", "--quiet", "origin", "offline")
    expect(await scanCommit(dir, "git push origin offline")).toEqual([])
  }, 180_000)

  it("(d) is never refused for a commit that only removes lines", async () => {
    put("cfg.sh", `${REAL}\nkeep\n`, "add")
    execFileSync("git", ["push", "--quiet", bare, "main"], { cwd: dir, windowsHide: true })
    fs.writeFileSync(path.join(dir, "cfg.sh"), "keep\n")
    expect(await scanCommit(dir, "git commit -am remove")).toEqual([])
    git("commit", "--quiet", "-am", "remove")
    expect(await scanCommit(dir, "git push origin main")).toEqual([])
  }, 180_000)

  it("(e) still refuses a real-looking password at commit and at push", async () => {
    fs.writeFileSync(path.join(dir, "db.sh"), `${HINT("Xk82jQp4vN")}\n`)
    git("add", ".")
    expect(await scanCommit(dir, "git commit -m db")).toEqual([{ file: "db.sh", kind: "a password in a web address", line: 1 }])
    git("commit", "--quiet", "-m", "db")
    const sha = git("rev-parse", "--short", "HEAD")
    expect(await scanCommit(dir, "git push")).toEqual([{ file: "db.sh", kind: "a password in a web address", line: 1, commit: sha, branch: "main" }])
  }, 180_000)

  it("(f) reports the line as it is in the file at the commit that adds it", async () => {
    put("scripts/update.sh", `${lines(10)}\n`, "start")
    git("push", "--quiet")
    fs.writeFileSync(path.join(dir, "scripts/update.sh"), `${lines(5)}\n${HINT("Xk82jQp4vN")}\n${lines(10).split("\n").slice(5).join("\n")}\n`)
    git("commit", "--quiet", "-am", "adds it at 6")
    const sha = git("rev-parse", "--short", "HEAD")
    put("other.md", "x\n", "later")
    const [f] = await scanCommit(dir, "git push")
    expect(f).toMatchObject({ file: "scripts/update.sh", commit: sha, branch: "main" })
    const atCommit = git("show", `${sha}:scripts/update.sh`).split("\n")
    expect(atCommit[f!.line! - 1]).toContain("@db:5432/peter")
  }, 180_000)

  it("lets one held finding through once when you allow it, recorded, and refuses anything else", async () => {
    const { SecretHolds } = await import("../src/secret-holds.js")
    const holds = new SecretHolds()
    const records: Array<{ event: string; verdict: { outcome: string; decidedBy: string } }> = []
    const hook = createFloorHook({
      sessionId: "s",
      cwd: dir,
      policy: () => undefined,
      pwsh: undefined,
      audit: { record: async (r: never) => (records.push(r), true) } as never,
      kill: () => false,
      decided: new Set<string>(),
      onEvent: () => undefined,
      log: () => undefined,
      secretHolds: holds,
    } as never)
    const run = async (command: string) =>
      (await hook(
        { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, tool_use_id: `t${Math.random()}`, cwd: dir, session_id: "x" } as never,
        "t",
        { signal: new AbortController().signal },
      )) as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } }
    put("db.sh", `${HINT("Xk82jQp4vN")}\n`, "db")
    expect((await run("git push")).hookSpecificOutput?.permissionDecision).toBe("deny")
    const [held] = holds.list()
    expect(held!.findings).toMatchObject([{ file: "db.sh", line: 1, branch: "main", allowedOnce: false }])
    // A finding not held there is not allowed; the held one is, once.
    expect(holds.allowOnce(held!.repo, { kind: "a password in a web address", file: "db.sh", line: 2 })).toBe(false)
    expect(holds.allowOnce(held!.repo, { kind: "a password in a web address", file: "db.sh", line: 1 })).toBe(true)
    expect((await run("git push")).hookSpecificOutput?.permissionDecision).not.toBe("deny")
    expect(records.at(-1)).toMatchObject({ event: "secret_allowed_once_used", verdict: { outcome: "allow", decidedBy: "human-desktop" } })
    // Used up: the same push is refused again.
    expect((await run("git push")).hookSpecificOutput?.permissionDecision).toBe("deny")
    // An allowance covers only that finding: with another one in the same push, both are still refused.
    holds.allowOnce(holds.list()[0]!.repo, { kind: "a password in a web address", file: "db.sh", line: 1 })
    put("more.sh", `${REAL}\n`, "more")
    const out = await run("git push")
    expect(out.hookSpecificOutput?.permissionDecision).toBe("deny")
    expect(out.hookSpecificOutput?.permissionDecisionReason).toContain("more.sh")
    // Clear forgets the repository's holds and any allowance.
    expect(holds.clear(held!.repo)).toBe(true)
    expect(holds.list()).toEqual([])
  }, 180_000)
})
