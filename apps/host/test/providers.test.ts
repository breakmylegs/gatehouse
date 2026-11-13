// Multi-provider groundwork (S-01 to S-03): the registry lists only Claude until the setting is on and refuses an
// adapter that approves by itself; the loop gate runs the floor and then canUseTool, failing closed; the executor
// runs only the input the gate allowed.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk"
import { loadPolicy } from "@gatehouse/policy"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SEED_RULES } from "../../../packages/policy/test/helpers.js"
import { claudeAdapter } from "../src/providers/claude.js"
import { ExecutorRefused, ToolExecutor } from "../src/providers/executor.js"
import { canUseToolGate, failClosed, inputHash } from "../src/providers/gate.js"
import { CLAUDE_PROVIDER, ProviderRegistry } from "../src/providers/registry.js"
import type { ProviderAdapter, ToolCall } from "../src/providers/types.js"

let root: string
beforeEach(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-providers-")))
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

const claude = claudeAdapter({
  account: () => ({ email: "a@example.com", organization: "Example Org" }),
})
const other = (settings: Record<string, string | boolean> = {}): ProviderAdapter => ({
  id: "fake-loop",
  label: "Fake",
  capabilities: () => ({ ...claude.capabilities(), pattern: "loop", vendorSettings: settings }),
  assertOrganisation: () => Promise.reject(new Error("no")),
})
let n = 0
const call = (tool: ToolCall["tool"], input: Record<string, unknown>): ToolCall => ({
  callId: `c${++n}`,
  sessionId: "s1",
  provider: "fake-loop",
  tool,
  vendorToolName: tool,
  input,
})
const allowed = (c: ToolCall, input = c.input) =>
  ({ kind: "allow", callId: c.callId, input, inputHash: inputHash(input) }) as const

describe("the provider registry", () => {
  it("lists only Claude until multi-provider is on, and refuses an adapter that approves by itself", () => {
    let on = false
    const reg = new ProviderRegistry(() => on)
    reg.register(claude)
    reg.register(other())
    expect(reg.list().map((a) => a.id)).toEqual([CLAUDE_PROVIDER])
    expect(reg.get("fake-loop")).toBeUndefined()
    on = true
    expect(reg.list().map((a) => a.id)).toEqual([CLAUDE_PROVIDER, "fake-loop"])
    const wrap = (s: Record<string, string | boolean>): ProviderAdapter => ({
      ...other(),
      id: `w${++n}`,
      capabilities: () => ({ ...claude.capabilities(), vendorSettings: s }),
    })
    expect(() => reg.register(wrap({ permissionMode: "bypassPermissions" }))).toThrow(
      /approve calls by itself/,
    )
    expect(() => reg.register(wrap({ approvalPolicy: "never" }))).toThrow(/approve calls by itself/)
    expect(() => reg.register(wrap({ yolo: true }))).toThrow(/approve calls by itself/)
    expect(() => reg.register(wrap({ dangerouslySkipPermissions: true }))).toThrow(/by itself/)
    expect(() => reg.register({ ...other({ sandbox: "workspace" }), id: "loop-2" })).toThrow(
      /no vendor settings/,
    )
    expect(() => reg.register(claude)).toThrow(/already/)
  })
})

describe("the gate for a loop provider", () => {
  const policy = () => loadPolicy({ rulesPath: SEED_RULES, workspaceRootsOverride: [root] })

  // Mac fork: Windows' system folders; which Mac folders the floor protects is still open (O-MAC-1, docs/mac.md).
  it.skipIf(process.platform !== "win32")("denies on the floor before asking canUseTool", async () => {
    const canUseTool = vi.fn<CanUseTool>()
    const gate = canUseToolGate({ canUseTool, policy, cwd: root })
    const v = await gate.decide(
      call("write", { file_path: "C:/Windows/System32/x.txt", content: "x" }),
      new AbortController().signal,
    )
    expect(v).toMatchObject({ kind: "deny", ruleId: "critical-paths" })
    expect(canUseTool).not.toHaveBeenCalled()
  })

  it("denies with no rules loaded", async () => {
    const canUseTool = vi.fn<CanUseTool>()
    const none = canUseToolGate({ canUseTool, policy: () => undefined, cwd: root })
    expect(
      await none.decide(call("read", { file_path: "a.txt" }), new AbortController().signal),
    ).toMatchObject({
      kind: "deny",
      ruleId: "policy-unavailable",
    })
  })

  it("asks canUseTool as the Claude Code tool of the same kind, and binds an allow to the input it returns", async () => {
    const edited = { file_path: path.join(root, "b.txt"), content: "x" }
    const canUseTool = vi.fn<CanUseTool>(async () => ({
      behavior: "allow" as const,
      updatedInput: edited,
    }))
    const gate = canUseToolGate({ canUseTool, policy, cwd: root })
    const c = call("write", { file_path: path.join(root, "a.txt"), content: "x" })
    const v = await gate.decide(c, new AbortController().signal)
    expect(canUseTool.mock.calls[0]![0]).toBe("Write")
    expect(v).toEqual({
      kind: "allow",
      callId: c.callId,
      input: edited,
      inputHash: inputHash(edited),
    })
    const no = canUseToolGate({
      canUseTool: async () => ({ behavior: "deny" as const, message: "No (rule x)" }),
      policy,
      cwd: root,
    })
    expect(
      await no.decide(call("read", { file_path: "a.txt" }), new AbortController().signal),
    ).toMatchObject({ kind: "deny" })
    expect(await no.decide(call("mcp", {}), new AbortController().signal)).toMatchObject({
      ruleId: "tool-not-supported",
    })
  })

  it("fails closed: an error, a stuck gate or a malformed answer is a deny", async () => {
    const c = call("read", { file_path: "a.txt" })
    const s = new AbortController().signal
    expect(
      await failClosed({ decide: () => Promise.reject(new Error("x")) }, 200).decide(c, s),
    ).toMatchObject({ ruleId: "gate-error" })
    expect(
      await failClosed({ decide: () => new Promise(() => undefined) }, 50).decide(c, s),
    ).toMatchObject({ ruleId: "gate-timeout" })
    const bad = { kind: "allow", callId: c.callId, input: c.input, inputHash: "0" }
    expect(await failClosed({ decide: async () => bad as never }, 200).decide(c, s)).toMatchObject({
      ruleId: "gate-malformed",
    })
    expect(await failClosed({ decide: async () => allowed(c) }, 200).decide(c, s)).toMatchObject({
      kind: "allow",
    })
  })
})

describe("the executor", () => {
  const ex = () =>
    new ToolExecutor({
      workspaceRoot: root,
      redact: (t) => t.replaceAll("Falcon", "[REDACTED:term]"),
    })

  it("runs only the input the gate allowed, for that call", async () => {
    const c = call("write", { file_path: path.join(root, "a.txt"), content: "x" })
    await expect(
      ex().run(c, { kind: "deny", callId: c.callId, ruleId: "r", reason: "no" }),
    ).rejects.toThrow(ExecutorRefused)
    await expect(ex().run(c, { ...allowed(c), callId: "other" })).rejects.toThrow(/another call/)
    await expect(ex().run(c, { ...allowed(c), inputHash: "0" })).rejects.toThrow(
      /not the one that was allowed/,
    )
    const edited = { file_path: path.join(root, "b.txt"), content: "y" }
    expect((await ex().run(c, allowed(c, edited))).ok).toBe(true)
    expect(fs.existsSync(path.join(root, "a.txt"))).toBe(false)
    expect(fs.readFileSync(path.join(root, "b.txt"), "utf8")).toBe("y")
  })

  it("reads, edits, globs and greps in the workspace, and redacts what goes back", async () => {
    const file = path.join(root, "src", "plan.txt")
    fs.mkdirSync(path.dirname(file))
    fs.writeFileSync(file, "one Falcon\ntwo\ntwo\n")
    const run = (c: ToolCall) => ex().run(c, allowed(c))
    expect((await run(call("read", { file_path: file }))).output).toBe(
      "1\tone [REDACTED:term]\n2\ttwo\n3\ttwo\n4\t",
    )
    expect(
      (await run(call("edit", { file_path: file, old_string: "two", new_string: "2" }))).output,
    ).toMatch(/2 times/)
    expect(
      (await run(call("edit", { file_path: file, old_string: "one", new_string: "1" }))).ok,
    ).toBe(true)
    expect((await run(call("glob", { pattern: "**/*.txt" }))).output).toContain(file)
    expect((await run(call("grep", { pattern: "^1 " }))).output).toContain(`${file}:1:`)
    expect(await run(call("webSearch", { query: "x" })).catch((e: Error) => e.message)).toMatch(
      /does not run/,
    )
  })

  it("runs a command in the workspace folder with no credential in its environment", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-should-not-pass")
    try {
      const c = call("shell", {
        command: 'Write-Output (Get-Location).Path; Write-Output "key=[$env:ANTHROPIC_API_KEY]"',
      })
      const r = await new ToolExecutor({
        workspaceRoot: root,
        redact: (t) => t,
        shell: {
          exe: process.platform === "win32" ? "powershell.exe" : "pwsh", // Mac fork: PowerShell 7 on a Mac
          args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"],
        },
      }).run(c, allowed(c))
      // Mac fork: a Mac's temporary folder is also /private/var/..., which is what the shell says it is in.
      expect([root, fs.realpathSync(root)].some((p) => r.output.includes(p))).toBe(true)
      expect(r.output).toContain("key=[]")
    } finally {
      vi.unstubAllEnvs()
    }
  }, 60_000)
})
