// D-007, locked acceptance tests: a locked test is changed, renamed or deleted by a session only with a person, even in
// Extreme approval; a lock file edited outside Codehouse makes every test count as locked; a locked test changed
// outside Codehouse stops the next session from starting until the owner accepts it.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { LockedTestsChangedError } from "../src/sessions.js"
import { LOCKED_TEST_RULE, TestLocks } from "../src/test-locks.js"
import type { ToolCallResult } from "./fake-sdk.js"
import { buildStack, type Stack } from "./stack.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-locks-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const sealer = () => ({
  protect: async (b: Uint8Array) => Buffer.from(Buffer.from(b).map((x) => x ^ 0x33)),
  unprotect: async (b: Uint8Array) => Buffer.from(Buffer.from(b).map((x) => x ^ 0x33)),
})

/** A project folder with a package.json (its root) and two tests. */
function project(name: string): string {
  const root = path.join(dir, name)
  fs.mkdirSync(path.join(root, "tests"), { recursive: true })
  fs.writeFileSync(path.join(root, "package.json"), "{}")
  fs.writeFileSync(path.join(root, "tests", "acceptance.test.ts"), "expect(1).toBe(1)\n")
  fs.writeFileSync(path.join(root, "tests", "other.test.ts"), "expect(2).toBe(2)\n")
  return root
}

describe("locked tests (D-007)", () => {
  it("names what a call would change in a locked test, and leaves reading and running it alone", async () => {
    const root = project("p1")
    const locks = new TestLocks({ dir: path.join(dir, "locks1"), sealer })
    await locks.lock(root, "tests/acceptance.test.ts")
    const t = (tool: string, input: Record<string, unknown>) => locks.touched(root, tool, input)
    const target = ["tests/acceptance.test.ts"]
    expect(await t("Edit", { file_path: path.join(root, "tests/acceptance.test.ts") })).toEqual(target)
    expect(await t("Write", { file_path: "tests/acceptance.test.ts" })).toEqual(target)
    expect(await t("Bash", { command: "rm tests/acceptance.test.ts" })).toEqual(target)
    expect(await t("Bash", { command: "git mv tests/acceptance.test.ts tests/a.ts" })).toEqual(target)
    expect(await t("Bash", { command: "sed -i s/1/2/ tests/acceptance.test.ts" })).toEqual(target)
    expect(await t("Bash", { command: "echo x >tests/acceptance.test.ts" })).toEqual(target)
    expect(await t("PowerShell", { command: "Set-Content tests/acceptance.test.ts 'x'" })).toEqual(target)
    // Reading or running it, and changing an unlocked test, touch nothing.
    for (const command of [
      "cat tests/acceptance.test.ts",
      "npx vitest run tests/acceptance.test.ts",
      "git diff tests/acceptance.test.ts",
      "grep expect tests/acceptance.test.ts",
    ])
      expect(await t("Bash", { command }), command).toEqual([])
    expect(await t("Edit", { file_path: "tests/other.test.ts" })).toEqual([])
  })

  it("treats every test as locked when the lock file was edited outside Codehouse (fail closed)", async () => {
    const root = project("p2")
    const locksDir = path.join(dir, "locks2")
    const locks = new TestLocks({ dir: locksDir, sealer })
    await locks.lock(root, "tests/acceptance.test.ts")
    const file = fs.readdirSync(locksDir).find((f) => f.endsWith(".json"))!
    // Someone takes the lock off by hand.
    const raw = JSON.parse(fs.readFileSync(path.join(locksDir, file), "utf8"))
    raw.files = {}
    fs.writeFileSync(path.join(locksDir, file), JSON.stringify(raw))
    expect((await locks.state(root)).tampered).toBe(true)
    expect(await locks.touched(root, "Edit", { file_path: "tests/other.test.ts" })).toEqual(["tests/other.test.ts"])
    expect(await locks.touched(root, "Edit", { file_path: "src/a.ts" })).toEqual([])
    expect(await locks.changedOutside(root)).toEqual(["the lock file"])
    await expect(locks.lock(root, "tests/other.test.ts")).rejects.toThrow(/changed outside Codehouse/)
  })

  it("finds a locked test changed outside Codehouse, and takes it as it is once accepted", async () => {
    const root = project("p3")
    const locks = new TestLocks({ dir: path.join(dir, "locks3"), sealer })
    await locks.lock(root, "tests/acceptance.test.ts")
    expect(await locks.changedOutside(root)).toEqual([])
    fs.writeFileSync(path.join(root, "tests", "acceptance.test.ts"), "expect(1).toBe(2)\n")
    expect(await locks.changedOutside(root)).toEqual(["tests/acceptance.test.ts"])
    await locks.accept(root)
    expect(await locks.changedOutside(root)).toEqual([])
  })
})

describe("on real sessions (D-007)", () => {
  let s: Stack
  let locks: TestLocks
  beforeAll(async () => {
    locks = new TestLocks({ dir: path.join(dir, "locks-stack"), sealer })
    s = await buildStack({ hardTimeoutMs: 20_000, phoneExpiryMs: 10_000, locks })
    fs.mkdirSync(path.join(s.repo, "tests"), { recursive: true })
    fs.writeFileSync(path.join(s.repo, "tests", "locked.test.ts"), "expect(1).toBe(1)\n")
    await locks.lock(s.repo, "tests/locked.test.ts")
  }, 60000)
  afterAll(async () => {
    // Closed first, so Windows lets the stack remove its folder.
    for (const x of s.manager.liveSessions()) await x.close()
    await s.stop()
  })

  it("extreme_locked_tests: an Extreme session cannot change a locked test without a person", async () => {
    let r: ToolCallResult | undefined
    s.sdk.turn = async (api, text) => {
      // Extreme approval carries on by itself after the turn; the queue is empty then.
      if (text !== "change it") return api.say("QUEUE EMPTY")
      const call = api.callTool("Edit", {
        file_path: path.join(s.repo, "tests", "locked.test.ts"),
        old_string: "toBe(1)",
        new_string: "toBe(2)",
      })
      // It waits for a person, though Extreme approval approves other escalations by itself.
      await s.waitForPending()
      expect(s.broker.list()[0]?.request.verdict).toMatchObject({ ruleId: LOCKED_TEST_RULE })
      s.broker.resolve(s.pendingId(), { kind: "decision", decision: "deny" }, "desktop")
      r = await call
    }
    const session = await s.manager.start({ cwd: s.repo, extreme: true })
    const done = new Promise<void>((res) => session.on("message", (m) => m.type === "result" && res()))
    session.prompt("change it")
    await done
    expect(r).toMatchObject({ executed: false })
    expect(fs.readFileSync(path.join(s.repo, "tests", "locked.test.ts"), "utf8")).toContain("toBe(1)")
    const events = s.records().map((x) => x.event)
    expect(events).toContain("locked_test_escalated")
    expect(events).not.toContain("test_lock_repinned")
    await session.close()
  })

  it("is asked in Auto, where Claude Code would otherwise approve it by itself", async () => {
    let r: ToolCallResult | undefined
    s.sdk.turn = async (api) => {
      const call = api.callTool(
        "Bash",
        { command: "rm tests/locked.test.ts" },
        { selfApproved: true, toolUseId: "rm-locked" },
      )
      await s.waitForPending()
      s.broker.resolve(s.pendingId(), { kind: "decision", decision: "deny" }, "desktop")
      r = await call
    }
    const session = await s.manager.start({ cwd: s.repo, mode: "auto" })
    const done = new Promise<void>((res) => session.on("message", (m) => m.type === "result" && res()))
    session.prompt("delete it")
    await done
    expect(r).toMatchObject({ executed: false, canUseToolCalled: true })
    expect(fs.existsSync(path.join(s.repo, "tests", "locked.test.ts"))).toBe(true)
  })

  it("starts no session while a locked test has changed outside Codehouse, until it is accepted", async () => {
    fs.writeFileSync(path.join(s.repo, "tests", "locked.test.ts"), "expect(1).toBe(3)\n")
    await expect(s.manager.start({ cwd: s.repo })).rejects.toBeInstanceOf(LockedTestsChangedError)
    await locks.accept(s.repo)
    const session = await s.manager.start({ cwd: s.repo })
    expect(session.info().state).not.toBe("error")
  })
})
