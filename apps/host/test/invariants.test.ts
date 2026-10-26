import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { HookCallback, Options } from "@anthropic-ai/claude-agent-sdk"
import { checkOrg } from "../src/account.js"
import { createFloorHook, denyOutput } from "../src/hooks.js"
import {
  assertSafeOptions,
  isAllowedMode,
  isBareToolName,
  isShadowWarning,
  SafetyError,
} from "../src/safety.js"
import { KillSwitchEngagedError, OrgGuardError } from "../src/sessions.js"
import type { ToolCallResult } from "./fake-sdk.js"
import { buildStack, type Stack } from "./stack.js"

const here = path.dirname(fileURLToPath(import.meta.url))

/** A set of options that is safe, which each test then spoils in one way. */
function safe(over: Partial<Options> = {}): Options {
  return {
    cwd: "C:/dev/x",
    permissionMode: "default",
    env: { PATH: "x" },
    canUseTool: async () => ({ behavior: "deny", message: "x" }),
    hooks: { PreToolUse: [{ hooks: [async () => ({})] }] },
    ...over,
  } as Options
}

describe("invariant 3: only default and plan, set explicitly", () => {
  it("accepts default and plan", () => {
    expect(() => assertSafeOptions(safe({ permissionMode: "default" }))).not.toThrow()
    expect(() => assertSafeOptions(safe({ permissionMode: "plan" }))).not.toThrow()
  })

  it("refuses every other mode, a missing mode and the dangerous flag", () => {
    for (const mode of ["bypassPermissions", "acceptEdits", "dontAsk", "auto", "yolo", ""]) {
      expect(() => assertSafeOptions(safe({ permissionMode: mode as never })), mode).toThrow(
        SafetyError,
      )
    }
    expect(() => assertSafeOptions(safe({ permissionMode: undefined }))).toThrow(/set explicitly/)
    expect(() => assertSafeOptions(safe({ allowDangerouslySkipPermissions: true }))).toThrow(
      /allowDangerouslySkipPermissions/,
    )
    expect(() =>
      assertSafeOptions(
        safe({
          agents: { a: { description: "x", prompt: "y", permissionMode: "bypassPermissions" } },
        }),
      ),
    ).toThrow(SafetyError)
    expect(() =>
      assertSafeOptions(
        safe({ agents: { a: { description: "x", prompt: "y", permissionMode: "plan" } } }),
      ),
    ).not.toThrow()
  })

  it("knows which modes are allowed", () => {
    expect(isAllowedMode("default")).toBe(true)
    expect(isAllowedMode("plan")).toBe(true)
    for (const m of ["auto", "acceptEdits", undefined, 5, null])
      expect(isAllowedMode(m)).toBe(false)
  })
})

describe("invariant 4: no bare tool names in allowedTools", () => {
  it("refuses bare names, including MCP tool names, and accepts argument patterns", () => {
    expect(() => assertSafeOptions(safe({ allowedTools: ["Bash"] }))).toThrow(/bare tool names/)
    expect(() => assertSafeOptions(safe({ allowedTools: ["Read", "Bash(git status:*)"] }))).toThrow(
      /Read/,
    )
    expect(() =>
      assertSafeOptions(safe({ allowedTools: ["mcp__companion__get_policy_summary"] })),
    ).toThrow(SafetyError)
    expect(() =>
      assertSafeOptions(safe({ allowedTools: ["Bash(git status:*)", "Read(src/**)"] })),
    ).not.toThrow()
    expect(() => assertSafeOptions(safe({ allowedTools: [] }))).not.toThrow()
    expect(isBareToolName("Bash")).toBe(true)
    expect(isBareToolName("Bash(ls)")).toBe(false)
  })

  it("recognises a shadow warning, which is fatal", () => {
    expect(isShadowWarning("warning CLAUDE_SDK_CAN_USE_TOOL_SHADOWED: Bash")).toBe(true)
    expect(
      isShadowWarning("canUseTool will never be called for Read because of an allow rule"),
    ).toBe(true)
    expect(isShadowWarning("canUseTool is shadowed by allowedTools")).toBe(true)
    expect(isShadowWarning("session started")).toBe(false)
  })
})

describe("invariant 5, 6 and the required hooks", () => {
  it("refuses settings, a prompt tool and extra arguments that could supply permissions", () => {
    expect(() =>
      assertSafeOptions(
        safe({ settings: { permissions: { defaultMode: "bypassPermissions" } } as never }),
      ),
    ).toThrow(/settings/)
    expect(() => assertSafeOptions(safe({ settings: "C:/x.json" }))).toThrow(/settings/)
    expect(() => assertSafeOptions(safe({ permissionPromptToolName: "mcp__x__y" }))).toThrow(
      /permissionPromptToolName/,
    )
    expect(() =>
      assertSafeOptions(safe({ extraArgs: { "dangerously-skip-permissions": null } })),
    ).toThrow(/extra command line/)
  })

  it("needs an explicit environment with no credentials, in any letter case, and the bundled binary", () => {
    expect(() => assertSafeOptions(safe({ env: undefined }))).toThrow(/passed explicitly/)
    for (const key of [
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "CLAUDE_CODE_OAUTH_TOKEN",
      "anthropic_api_key",
    ]) {
      expect(() => assertSafeOptions(safe({ env: { [key]: "secret" } })), key).toThrow(SafetyError)
    }
    expect(() =>
      assertSafeOptions(safe({ pathToClaudeCodeExecutable: "C:/other/claude.exe" })),
    ).toThrow(/bundled/)
  })

  it("needs canUseTool and the PreToolUse floor hook", () => {
    expect(() => assertSafeOptions(safe({ canUseTool: undefined }))).toThrow(/canUseTool/)
    expect(() => assertSafeOptions(safe({ hooks: {} }))).toThrow(/floor hook/)
    expect(() => assertSafeOptions(safe({ hooks: { PreToolUse: [] } }))).toThrow(/floor hook/)
  })

  it("carries the invariant number so a failure says what it broke", () => {
    try {
      assertSafeOptions(safe({ permissionMode: "auto" as never }))
      expect.unreachable()
    } catch (e) {
      expect((e as SafetyError).invariant).toBe(3)
      expect((e as Error).message).toMatch(/^Invariant 3:/)
    }
  })
})

let s: Stack
let originalKey: string | undefined
beforeAll(async () => {
  originalKey = process.env.ANTHROPIC_API_KEY
  process.env.ANTHROPIC_API_KEY = "sk-ant-should-never-reach-a-session"
  process.env.CLAUDE_CODE_OAUTH_TOKEN = "oauth-should-never-reach-a-session"
  s = await buildStack({ hardTimeoutMs: 1500, phoneExpiryMs: 800 })
}, 60000)
afterAll(async () => {
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = originalKey
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN
  await s.stop()
})

async function runTurn(
  turn: Parameters<typeof s.sdk.turn extends infer T ? (t: T) => void : never>[0],
) {
  s.sdk.turn = turn as never
  const session = await s.manager.start({ cwd: s.repo })
  const done = new Promise<void>((resolve) => {
    session.on("message", (m) => {
      if (m.type === "result") resolve()
    })
  })
  session.prompt("go")
  return { session, done }
}

describe("what a real session is started with", () => {
  it("sets the mode, the prompt, the settings sources, hooks, partial messages and a clean environment", async () => {
    const { done } = await runTurn(async () => undefined)
    await done
    const o = s.sdk.queries.at(-1)?.options as Options
    expect(o.permissionMode).toBe("default")
    expect(o.cwd).toBe(s.repo)
    expect(o.systemPrompt).toMatchObject({ type: "preset", preset: "claude_code" })
    expect(o.settingSources).toEqual(["user", "project", "local"])
    expect(o.includePartialMessages).toBe(true)
    expect(typeof o.canUseTool).toBe("function")
    expect(Object.keys(o.hooks ?? {}).sort()).toEqual([
      "Notification",
      "PostToolUse",
      "PostToolUseFailure",
      "PreToolUse",
      "Stop",
      "SubagentStart",
      "SubagentStop",
    ])
    expect(Object.keys(o.mcpServers ?? {})).toEqual(["companion"])
    expect((o.mcpServers as Record<string, { type: string }>).companion?.type).toBe("sdk")
    // Nothing that could approve a call before canUseTool sees it.
    expect(o.allowedTools).toBeUndefined()
    expect(o.settings).toBeUndefined()
    expect(o.permissionPromptToolName).toBeUndefined()
    expect(o.allowDangerouslySkipPermissions).toBeUndefined()
    expect(o.extraArgs).toBeUndefined()
    expect(o.pathToClaudeCodeExecutable).toBeUndefined()
  })

  it("passes no credential variables from the parent (invariant 6)", async () => {
    const { done } = await runTurn(async () => undefined)
    await done
    const env = (s.sdk.queries.at(-1)?.options as Options).env ?? {}
    expect(process.env.ANTHROPIC_API_KEY).toBeDefined() // the test did put them in the parent
    const keys = Object.keys(env).map((k) => k.toUpperCase())
    expect(keys).not.toContain("ANTHROPIC_API_KEY")
    expect(keys).not.toContain("ANTHROPIC_AUTH_TOKEN")
    expect(keys).not.toContain("CLAUDE_CODE_OAUTH_TOKEN")
    expect(JSON.stringify(env)).not.toContain("should-never-reach")
    expect(Object.keys(env).length).toBeGreaterThan(3) // PATH and friends are kept
  })

  it("never reads the credentials file or any token: no Host source mentions it (invariant 6)", () => {
    const srcDirs = [
      path.resolve(here, "../src"),
      path.resolve(here, "../../approver/src"),
      path.resolve(here, "../../companion/src"),
    ]
    const offenders: string[] = []
    for (const dir of srcDirs) {
      for (const f of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
        if (!f.isFile() || !f.name.endsWith(".ts")) continue
        const full = path.join(f.parentPath ?? (f as unknown as { path: string }).path, f.name)
        const text = fs.readFileSync(full, "utf8")
        // Reading means a file API near the name. The safety code only names the variables to remove.
        if (/\.credentials\.json/i.test(text)) offenders.push(`${full}: credentials file`)
        if (/readFile(Sync)?\([^)]*(credential|token)/i.test(text))
          offenders.push(`${full}: reads a token file`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("never returns updatedPermissions from canUseTool, whatever happens (invariant 5)", async () => {
    const results: ToolCallResult[] = []
    const { done } = await runTurn(async (api) => {
      results.push(await api.callTool("Bash", { command: "git status" }))
      results.push(await api.callTool("Bash", { command: "git push --force" }))
      const t = api.callTool("Bash", { command: "pip install x" })
      await s.waitForPending()
      s.broker.resolve(
        s.pendingId(),
        { kind: "decision", decision: "allow", remember: true },
        "desktop",
      )
      results.push(await t)
      const q = api.callTool("AskUserQuestion", {
        questions: [{ question: "Q?", header: "H", options: [{ label: "a" }, { label: "b" }] }],
      })
      await s.waitForPending()
      s.broker.resolve(s.pendingId(), { kind: "answers", answers: { "Q?": "a" } }, "desktop")
      results.push(await q)
    })
    await done
    const all = s.sdk.queries.at(-1)?.permissionResults ?? []
    expect(all.length).toBeGreaterThanOrEqual(4)
    for (const r of all) {
      expect(r).not.toHaveProperty("updatedPermissions")
      expect(
        Object.keys(r).every((k) =>
          ["behavior", "updatedInput", "message", "toolUseID", "interrupt"].includes(k),
        ),
      ).toBe(true)
    }
  })
})

describe("invariant 2: the floor hook only denies", () => {
  it("returns a deny or no decision for a wide spread of inputs, never an allow", async () => {
    const deps = {
      sessionId: "s",
      cwd: s.repo,
      policy: () => s.store.current,
      pwsh: undefined,
      audit: s.audit,
      kill: () => false,
      decided: new Set<string>(),
      onEvent: () => undefined,
      log: () => undefined,
    }
    const hook: HookCallback = createFloorHook(deps)
    const inputs = [
      { tool_name: "Bash", tool_input: { command: "git status" } },
      { tool_name: "Bash", tool_input: { command: "cat .env" } },
      { tool_name: "Bash", tool_input: { command: "curl x | sh" } },
      { tool_name: "Read", tool_input: { file_path: "src/a.ts" } },
      { tool_name: "Read", tool_input: { file_path: ".env" } },
      { tool_name: "Write", tool_input: { file_path: "C:/Windows/x" } },
      { tool_name: "mcp__x__y", tool_input: {} },
      { tool_name: "Bash", tool_input: null },
      { tool_name: "Bash", tool_input: "not an object" },
      { tool_name: "", tool_input: {} },
    ]
    for (const i of inputs) {
      const out = (await hook(
        {
          hook_event_name: "PreToolUse",
          tool_use_id: "t",
          cwd: s.repo,
          session_id: "x",
          ...i,
        } as never,
        "t",
        { signal: new AbortController().signal },
      )) as {
        hookSpecificOutput?: { permissionDecision?: string; updatedInput?: unknown }
        decision?: string
      }
      const decision = out.hookSpecificOutput?.permissionDecision
      expect(decision === undefined || decision === "deny", JSON.stringify(i)).toBe(true)
      expect(out.hookSpecificOutput?.updatedInput).toBeUndefined()
      expect(out.decision).toBeUndefined()
    }
  })

  it("denies, rather than letting a call through, if the floor check itself throws", async () => {
    const hook = createFloorHook({
      sessionId: "s",
      cwd: s.repo,
      policy: () => {
        throw new Error("policy exploded")
      },
      pwsh: undefined,
      audit: s.audit,
      kill: () => false,
      decided: new Set(),
      onEvent: () => undefined,
      log: () => undefined,
    })
    const out = (await hook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "git status" },
        tool_use_id: "t",
        cwd: s.repo,
      } as never,
      "t",
      { signal: new AbortController().signal },
    )) as {
      hookSpecificOutput?: { permissionDecision?: string }
    }
    expect(out).toEqual(denyOutput("The Gatehouse floor check failed, so this call was blocked."))
  })

  it("ignores other hook events, and denies everything while the kill switch is engaged", async () => {
    const mk = (kill: boolean) =>
      createFloorHook({
        sessionId: "s",
        cwd: s.repo,
        policy: () => s.store.current,
        pwsh: undefined,
        audit: s.audit,
        kill: () => kill,
        decided: new Set(),
        onEvent: () => undefined,
        log: () => undefined,
      })
    expect(
      await mk(false)(
        {
          hook_event_name: "PostToolUse",
          tool_name: "Bash",
          tool_input: {},
          tool_use_id: "t",
        } as never,
        "t",
        { signal: new AbortController().signal },
      ),
    ).toEqual({})
    const out = (await mk(true)(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Read",
        tool_input: { file_path: "src/a.ts" },
        tool_use_id: "t",
        cwd: s.repo,
      } as never,
      "t",
      { signal: new AbortController().signal },
    )) as {
      hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string }
    }
    expect(out.hookSpecificOutput?.permissionDecision).toBe("deny")
    expect(out.hookSpecificOutput?.permissionDecisionReason).toContain("kill switch")
  })
})

describe("invariant 14: the organisation guard", () => {
  it("accepts only the expected organisation, ignoring case and spacing", () => {
    const acct = {
      email: "a@b.c",
      organization: "ACN - Premium",
      apiProvider: "firstParty" as const,
    }
    expect(checkOrg(acct, "ACN - Premium")).toEqual({ ok: true })
    expect(checkOrg(acct, "  acn - premium ")).toEqual({ ok: true })
    expect(checkOrg({ ...acct, apiProvider: undefined }, "ACN - Premium")).toEqual({ ok: true })
  })

  it("refuses everything that is not a clear yes, with a message a person can act on", () => {
    const acct = {
      email: "a@b.c",
      organization: "ACN - Premium",
      apiProvider: "firstParty" as const,
    }
    expect(checkOrg(acct, undefined)).toMatchObject({ ok: false, code: "no-expected-org" })
    expect(checkOrg(acct, "  ")).toMatchObject({ ok: false, code: "no-expected-org" })
    expect(checkOrg(undefined, "ACN - Premium")).toMatchObject({ ok: false, code: "not-signed-in" })
    expect(checkOrg({}, "ACN - Premium")).toMatchObject({ ok: false, code: "not-signed-in" })
    expect(checkOrg({ ...acct, organization: "Someone Else" }, "ACN - Premium")).toMatchObject({
      ok: false,
      code: "wrong-org",
    })
    expect(checkOrg({ email: "a@b.c" }, "ACN - Premium")).toMatchObject({
      ok: false,
      code: "wrong-org",
    })
    expect(
      checkOrg({ ...acct, organization: "ACN - Premium Extra" }, "ACN - Premium"),
    ).toMatchObject({ ok: false })
    expect(checkOrg({ ...acct, apiProvider: "bedrock" }, "ACN - Premium")).toMatchObject({
      ok: false,
      code: "wrong-provider",
    })
    const wrong = checkOrg({ ...acct, organization: "Other" }, "ACN - Premium")
    expect(wrong.ok === false && wrong.message).toContain('"Other"')
  })

  it("starts no session, and sends no prompt, on the wrong account", async () => {
    const before = s.sdk.queries.length
    s.sdk.account = { email: "x@y.z", organization: "Other Org", apiProvider: "firstParty" }
    s.sdk.turn = async () => {
      throw new Error("must not run")
    }
    await expect(s.manager.start({ cwd: s.repo })).rejects.toBeInstanceOf(OrgGuardError)
    const q = s.sdk.queries[before]
    expect(q?.closed).toBe(true)
    expect(q?.prompts).toEqual([])
    expect(s.manager.list().every((i) => i.state !== "starting")).toBe(true)
    s.sdk.account = undefined
    await expect(s.manager.start({ cwd: s.repo })).rejects.toThrow(/not signed in/)
    s.sdk.account = { email: "a@b.c", organization: "ACN - Premium", apiProvider: "firstParty" }
  })

  it("refuses to start when no expected organisation is set", async () => {
    const bare = await buildStack({ expectedOrg: null })
    try {
      await expect(bare.manager.start({ cwd: bare.repo })).rejects.toThrow(
        /No expected organisation/,
      )
      expect(bare.sdk.queries).toHaveLength(0)
    } finally {
      await bare.stop()
    }
  })

  it("keeps the account and managed-policy state for the UI header", async () => {
    const { done } = await runTurn(async () => undefined)
    await done
    expect(s.account.last()).toMatchObject({
      signedIn: true,
      organization: "ACN - Premium",
      managedPolicy: "not-detected",
      org: { ok: true },
    })
  })

  it("can refresh the account with a probe that sends nothing", async () => {
    const before = s.sdk.queries.length
    const snap = await s.account.refresh()
    expect(snap).toMatchObject({ signedIn: true, email: "a@b.c" })
    expect(s.sdk.queries.length).toBe(before + 1)
    expect(s.sdk.queries.at(-1)?.prompts).toEqual([])
    expect(s.sdk.queries.at(-1)?.closed).toBe(true)
  })
})

describe("invariant 1: when something fails, the answer is not an allow", () => {
  it("escalates, and a person decides, when the Approver cannot be reached", async () => {
    const down = await buildStack({ approverDown: true, hardTimeoutMs: 1500 })
    try {
      down.sdk.turn = async (api) => {
        r = await api.callTool("Bash", { command: "git status" }) // would normally be allowed automatically
      }
      let r: ToolCallResult | undefined
      const session = await down.manager.start({ cwd: down.repo })
      const done = new Promise<void>((resolve) =>
        session.on("message", (m) => m.type === "result" && resolve()),
      )
      session.prompt("go")
      await down.waitForPending()
      expect(down.broker.list()[0]?.request.verdict).toMatchObject({
        outcome: "escalate",
        ruleId: "evaluator-unavailable",
        decidedBy: "evaluator-unavailable",
      })
      await done // nobody answers: it times out and is denied
      expect(r).toMatchObject({ executed: false })
      expect(r?.message).toBe("Timed out waiting for approval")
    } finally {
      await down.stop()
    }
  })

  it("denies at once, without asking anyone, when the kill switch is engaged and the Approver is down", async () => {
    const down = await buildStack({ approverDown: true, hardTimeoutMs: 1500 })
    try {
      down.sdk.turn = async () => undefined
      await down.manager.start({ cwd: down.repo })
      await down.kill.engage("desktop", "test")
      const canUseTool = (down.sdk.queries.at(-1)?.options as Options).canUseTool
      const result = await canUseTool!("Bash", { command: "git status" }, {
        signal: new AbortController().signal,
        toolUseID: "t1",
      } as never)
      expect(result).toMatchObject({ behavior: "deny", toolUseID: "t1" })
      expect((result as { message: string }).message).toContain("kill switch")
      expect(down.broker.list()).toEqual([]) // it did not escalate to a person
    } finally {
      await down.stop()
    }
  })

  it("denies when canUseTool itself fails, never allows", async () => {
    const results: ToolCallResult[] = []
    const original = s.approver.evaluate.bind(s.approver)
    s.approver.evaluate = (async () => {
      throw new Error("approver client exploded")
    }) as never
    try {
      const { done } = await runTurn(async (api) => {
        results.push(await api.callTool("Bash", { command: "git status" }))
      })
      await done
    } finally {
      s.approver.evaluate = original
    }
    expect(results[0]).toMatchObject({ executed: false, blockedBy: "permission" })
    expect(results[0]?.message).toBe(
      "Gatehouse could not decide this call safely, so it was denied.",
    )
  })

  it("does not apply an allow it cannot record in the audit log (invariant 13)", async () => {
    const results: ToolCallResult[] = []
    const original = s.audit.record.bind(s.audit)
    let calls = 0
    s.audit.record = async (e) => {
      calls++
      return e.event === "human_decision" ? false : original(e)
    }
    try {
      const { done } = await runTurn(async (api) => {
        const t = api.callTool("Bash", { command: "pip install cannot-record" })
        await s.waitForPending()
        s.broker.resolve(s.pendingId(), { kind: "decision", decision: "allow" }, "desktop")
        results.push(await t)
      })
      await done
    } finally {
      s.audit.record = original
    }
    expect(calls).toBeGreaterThan(0)
    expect(results[0]).toMatchObject({ executed: false })
    expect(results[0]?.message).toContain("could not be recorded")
  })

  it("stops a session when the SDK warns that canUseTool is shadowed", async () => {
    const { session } = await runTurn(async (api) => {
      api.system({
        subtype: "warning",
        text: "CLAUDE_SDK_CAN_USE_TOOL_SHADOWED: Bash is allowed by a rule",
      })
    })
    for (let i = 0; i < 100 && session.info().state !== "error"; i++)
      await new Promise((r) => setTimeout(r, 20))
    expect(session.info().state).toBe("error")
    expect(session.info().error).toContain("Invariant 4")
  })
})

describe("session lifecycle", () => {
  it("moves through idle, running, waiting and back, and counts approvals", async () => {
    const states: string[] = []
    const { session, done } = await runTurn(async (api) => {
      await api.callTool("Bash", { command: "pip install lifecycle" })
    })
    session.on("state", (i) => states.push(`${i.state}:${i.pendingApprovals}`))
    await s.waitForPending()
    expect(session.info()).toMatchObject({ state: "waiting", pendingApprovals: 1 })
    s.broker.resolve(s.pendingId(), { kind: "decision", decision: "deny" }, "desktop")
    await done
    expect(session.info()).toMatchObject({ state: "idle", pendingApprovals: 0 })
    expect(states).toContain("running:0")
    expect(states.at(-1)).toBe("idle:0")
  })

  it("accepts only default and plan when the mode is changed, and changes the model", async () => {
    const { session, done } = await runTurn(async () => undefined)
    await done
    await session.setMode("plan")
    expect(session.info().mode).toBe("plan")
    await session.setMode("default")
    for (const bad of ["bypassPermissions", "auto", "acceptEdits", "dontAsk"]) {
      await expect(session.setMode(bad as never), bad).rejects.toBeInstanceOf(SafetyError)
    }
    const q = s.sdk.queries.at(-1)
    expect(q?.modes).toEqual(["plan", "default"])
    await session.setModel("claude-test-model")
    expect(session.info().model).toBe("claude-test-model")
    expect(q?.models).toEqual(["claude-test-model"])
  })

  it("starts in plan mode when asked, resumes and forks a session, and closes cleanly", async () => {
    s.sdk.turn = async () => undefined
    const planned = await s.manager.start({ cwd: s.repo, mode: "plan" })
    expect((s.sdk.queries.at(-1)?.options as Options).permissionMode).toBe("plan")
    const resumed = await s.manager.start({ cwd: s.repo, resume: "sdk-abc", fork: true })
    const o = s.sdk.queries.at(-1)?.options as Options
    expect(o.resume).toBe("sdk-abc")
    expect(o.forkSession).toBe(true)
    await resumed.close()
    expect(resumed.info().state).toBe("ended")
    await planned.close()
    expect(s.sdk.queries.at(-2)?.closed).toBe(true)
    expect(s.manager.get(planned.id)).toBe(planned)
    expect(s.manager.list().length).toBeGreaterThan(2)
    expect(() => resumed.prompt("late")).toThrow(/ended/)
  })

  it("records usage per session and per project from each result", async () => {
    const before = s.usage.snapshot()
    const { session, done } = await runTurn(async () => undefined)
    await done
    const after = s.usage.snapshot()
    expect(after.total.results).toBe(before.total.results + 1)
    expect(after.total.costUsd).toBeCloseTo(before.total.costUsd + 0.01, 5)
    expect(after.bySession[session.id]).toMatchObject({
      project: "proj",
      inputTokens: 100,
      outputTokens: 20,
      results: 1,
    })
    expect(after.byProject.proj?.results).toBeGreaterThanOrEqual(1)
    expect(after.byModel["fake-model"]?.outputTokens).toBeGreaterThanOrEqual(20)
    await s.usage.flush()
    expect(JSON.parse(fs.readFileSync(path.join(s.dir, "usage.json"), "utf8")).total.results).toBe(
      after.total.results,
    )
  })

  it("adds only what each turn cost, because the SDK reports cost and per-model figures cumulatively", async () => {
    const before = s.usage.snapshot()
    s.sdk.turn = async () => undefined
    const session = await s.manager.start({ cwd: s.repo })
    const turn = () =>
      new Promise<void>((resolve) => {
        const h = (m: { type: string }) => {
          if (m.type === "result") {
            session.off("message", h as never)
            resolve()
          }
        }
        session.on("message", h as never)
        session.prompt("again")
      })
    await turn()
    await turn()
    await turn()
    const after = s.usage.snapshot()
    // The fake reports cumulative cost 0.01, 0.02, 0.03. Summing those would give 0.06.
    expect(after.total.costUsd - before.total.costUsd).toBeCloseTo(0.03, 6)
    expect(after.bySession[session.id]?.costUsd).toBeCloseTo(0.03, 6)
    expect(after.bySession[session.id]).toMatchObject({
      inputTokens: 300,
      outputTokens: 60,
      results: 3,
    })
    expect(
      (after.byModel["fake-model"]?.inputTokens ?? 0) -
        (before.byModel["fake-model"]?.inputTokens ?? 0),
    ).toBe(300)
    expect(
      (after.byModel["fake-model"]?.costUsd ?? 0) - (before.byModel["fake-model"]?.costUsd ?? 0),
    ).toBeCloseTo(0.03, 6)
  })

  it("refuses to start a session or send a prompt while the kill switch is engaged", async () => {
    await s.kill.engage("desktop", "lifecycle test")
    await expect(s.manager.start({ cwd: s.repo })).rejects.toBeInstanceOf(KillSwitchEngagedError)
    await s.kill.rearm("desktop")
  })
})
