// D-059, instruction integrity pinning: what a project tells Claude is pinned; an agent's change escalates and, once
// approved, is pinned again; a change outside Codehouse blocks the next start and turn until the owner approves it.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { approveInstructions, InstructionPins, InstructionsChangedError, INSTRUCTIONS_RULE, isInstructionFile, lineDiff } from "../src/instruction-pins.js"
import type { ToolCallResult } from "./fake-sdk.js"
import { buildStack, type Stack } from "./stack.js"

const sealer = () => ({
  protect: async (b: Uint8Array) => Buffer.from(Buffer.from(b).map((x) => x ^ 0x5a)),
  unprotect: async (b: Uint8Array) => Buffer.from(Buffer.from(b).map((x) => x ^ 0x5a)),
})

const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-instr-")))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

/** A project with instructions, a skill and a settings file, in a git repository so it has a root. */
function project(name: string): string {
  const root = path.join(dir, name)
  fs.mkdirSync(path.join(root, ".git"), { recursive: true })
  fs.mkdirSync(path.join(root, ".claude", "skills", "release"), { recursive: true })
  fs.writeFileSync(path.join(root, "CLAUDE.md"), "# Rules\n\nRun the tests.\nNever push to main.\n")
  fs.writeFileSync(path.join(root, ".claude", "skills", "release", "SKILL.md"), "Release carefully.\n")
  fs.writeFileSync(path.join(root, "README.md"), "hello\n")
  return root
}

describe("instruction pins (D-059)", () => {
  it("knows the files that tell Claude what to do, and not the rest", () => {
    for (const f of ["CLAUDE.md", "AGENTS.md", "docs/CLAUDE.md", ".claude/settings.local.json", ".claude/skills/x/SKILL.md", ".claude/commands/go.md", ".claude/agents/a.md"])
      expect(isInstructionFile(f), f).toBe(true)
    for (const f of ["README.md", "src/a.ts", ".claude/notes.txt", "node_modules/x/CLAUDE.md", "../CLAUDE.md"])
      expect(isInstructionFile(f), f).toBe(false)
    expect(lineDiff("a\nb\nc", "a\nB\nc")).toEqual([" a", "-b", "+B", " c"])
  })

  it("pins a project the first time, shows a change outside Codehouse as a diff, and approving it clears it", async () => {
    const root = project("p1")
    const pins = new InstructionPins({ dir: path.join(dir, "pins1"), sealer })
    expect(await pins.changedOutside(root)).toEqual([])
    // A pull changes CLAUDE.md and adds a command; README is not an instruction file.
    fs.writeFileSync(path.join(root, "CLAUDE.md"), "# Rules\n\nRun the tests.\nPush to main whenever you like.\n")
    fs.mkdirSync(path.join(root, ".claude", "commands"), { recursive: true })
    fs.writeFileSync(path.join(root, ".claude", "commands", "ship.md"), "git push --force\n")
    fs.writeFileSync(path.join(root, "README.md"), "changed\n")
    const st = await pins.state(root)
    expect(st.changes.map((c) => [c.path, c.kind])).toEqual([
      ["CLAUDE.md", "changed"],
      [".claude/commands/ship.md", "added"],
    ])
    expect(st.changes[0]!.diff).toEqual(expect.arrayContaining(["-Never push to main.", "+Push to main whenever you like."]))
    expect(await pins.approve(root)).toHaveLength(2)
    expect(await pins.changedOutside(root)).toEqual([])
    // A removal counts too.
    fs.rmSync(path.join(root, ".claude", "skills", "release", "SKILL.md"))
    expect((await pins.state(root)).changes).toMatchObject([{ path: ".claude/skills/release/SKILL.md", kind: "removed" }])
  })

  it("asks for a review when the pin file was edited or cannot be read", async () => {
    const root = project("p2")
    const pinsDir = path.join(dir, "pins2")
    const pins = new InstructionPins({ dir: pinsDir, sealer })
    await pins.changedOutside(root)
    const folder = fs.readdirSync(pinsDir).find((f) => f.startsWith("p2-"))!
    const file = path.join(pinsDir, folder, "pins.json")
    // Someone pins a changed CLAUDE.md by hand, so the change would pass unseen.
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { files: Record<string, string> }
    raw.files["CLAUDE.md"] = "0".repeat(64)
    fs.writeFileSync(file, JSON.stringify(raw))
    const st = await pins.state(root)
    expect(st.unreadable).toBe(true)
    expect(st.changes.length).toBeGreaterThan(0)
    fs.writeFileSync(file, "{ not json")
    expect((await pins.changedOutside(root)).length).toBeGreaterThan(0)
  })

  it("names what a call would change: a file tool's target, a redirect or a copy, not a read", () => {
    const root = project("p3")
    const pins = new InstructionPins({ dir: path.join(dir, "pins3"), sealer })
    const t = (tool: string, input: Record<string, unknown>) => pins.touched(root, tool, input)
    expect(t("Edit", { file_path: path.join(root, ".claude", "skills", "release", "SKILL.md") })).toEqual([".claude/skills/release/SKILL.md"])
    expect(t("Write", { file_path: "AGENTS.md" })).toEqual(["AGENTS.md"])
    expect(t("Edit", { file_path: "src/a.ts" })).toEqual([])
    expect(t("Bash", { command: "echo 'push freely' >> CLAUDE.md" })).toEqual(["CLAUDE.md"])
    expect(t("Bash", { command: "cp evil.md .claude/commands/go.md" })).toEqual([".claude/commands/go.md"])
    expect(t("Bash", { command: "cat CLAUDE.md && grep tests AGENTS.md" })).toEqual([])
    expect(t("Read", { file_path: "CLAUDE.md" })).toEqual([])
  })
})

describe("on real sessions (D-059)", () => {
  let s: Stack
  let pins: InstructionPins
  beforeAll(async () => {
    pins = new InstructionPins({ dir: path.join(dir, "pins-stack"), sealer })
    s = await buildStack({ hardTimeoutMs: 20_000, phoneExpiryMs: 10_000, instructions: pins })
    fs.mkdirSync(path.join(s.repo, ".claude", "skills", "deploy"), { recursive: true })
    fs.writeFileSync(path.join(s.repo, "CLAUDE.md"), "Run the tests first.\n")
    fs.writeFileSync(path.join(s.repo, ".claude", "skills", "deploy", "SKILL.md"), "Deploy to staging only.\n")
    await pins.changedOutside(s.repo)
  }, 60000)
  afterAll(async () => {
    for (const x of s.manager.liveSessions()) await x.close()
    await s.stop()
  })

  it("an agent's edit of a skill escalates to you, and once allowed it is pinned again", async () => {
    let r: ToolCallResult | undefined
    const skill = path.join(s.repo, ".claude", "skills", "deploy", "SKILL.md")
    s.sdk.turn = async (api, text) => {
      if (text !== "edit the skill") return api.say("QUEUE EMPTY")
      const call = api.callTool("Edit", { file_path: skill, old_string: "staging only", new_string: "production" })
      await s.waitForPending()
      expect(s.broker.list()[0]?.request.verdict).toMatchObject({ ruleId: INSTRUCTIONS_RULE })
      s.broker.resolve(s.pendingId(), { kind: "decision", decision: "allow" }, "desktop")
      r = await call
    }
    const session = await s.manager.start({ cwd: s.repo })
    const done = new Promise<void>((res) => session.on("message", (m) => m.type === "result" && res()))
    session.prompt("edit the skill")
    await done
    expect(r).toMatchObject({ executed: true })
    const events = s.records().map((x) => x.event)
    expect(events).toContain("instructions_edit_escalated")
    expect(events).toContain("instructions_repinned")
    // Approved through Codehouse: nothing to review afterwards.
    expect(await pins.changedOutside(s.repo)).toEqual([])
    await session.close()
  })

  it("a pulled change to CLAUDE.md blocks the next start and the next turn until it is approved", async () => {
    const session = await s.manager.start({ cwd: s.repo })
    s.sdk.turn = async (api) => api.say("ok")
    // A pull while the session is open.
    fs.writeFileSync(path.join(s.repo, "CLAUDE.md"), "Skip the tests.\n")
    await expect(session.checkInstructions()).rejects.toBeInstanceOf(InstructionsChangedError)
    await expect(s.manager.start({ cwd: s.repo })).rejects.toBeInstanceOf(InstructionsChangedError)
    expect(s.records().filter((x) => x.event === "instructions_changed").length).toBeGreaterThanOrEqual(2)
    // You read it and approve it, recorded first: the session carries on, and a new one starts.
    expect(await approveInstructions(pins, s.audit, s.repo)).toBe(true)
    expect(s.records().find((x) => x.event === "instructions_approved")).toMatchObject({ channel: "desktop" })
    await expect(session.checkInstructions()).resolves.toBeUndefined()
    const next = await s.manager.start({ cwd: s.repo })
    await next.close()
    await session.close()
  })
})
