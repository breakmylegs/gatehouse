// Section 6: a command Codehouse runs itself is judged as the same command from the session would be, runs with no
// credential, at the session's level, stops on the kill switch, and is recorded with its outcome.
import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"
import { runCodehouseAction, withoutCredentials, type ActionDeps } from "../src/codehouse-action.js"

const verdict = (outcome: "allow" | "deny" | "escalate", ruleId = "safe-shell", risk = 20) => ({
  outcome,
  ruleId,
  reason: "The rules say so.",
  risk,
  decidedBy: "rules" as const,
  policyHash: "h",
})

/** A child that ends with the given code after a moment, and can be killed. */
function child(code: number, ms = 30) {
  const c = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void }
  c.stdout = new EventEmitter()
  c.stderr = new EventEmitter()
  const t = setTimeout(() => c.emit("close", code), ms)
  c.kill = () => {
    clearTimeout(t)
    c.emit("close", null)
  }
  setTimeout(() => c.stdout.emit("data", Buffer.from("out\n")), 5)
  return c
}

function setup(v: ReturnType<typeof verdict>, o: { extreme?: boolean; kill?: () => boolean; answer?: "allow" | "deny" } = {}) {
  const records: Array<Record<string, unknown>> = []
  const started: Array<{ command: string; env: NodeJS.ProcessEnv; level: string }> = []
  const request = vi.fn(async () => ({ outcome: o.answer ?? "deny", channel: "desktop", waitedMs: 1, at: "" }))
  const deps: ActionDeps = {
    approver: { evaluate: async () => v },
    broker: { request } as never,
    audit: { record: async (r) => (records.push(r as unknown as Record<string, unknown>), true) },
    kill: { isEngaged: o.kill ?? (() => false) },
    extreme: () => o.extreme === true,
    env: { PATH: "C:/bin", ANTHROPIC_API_KEY: "sk", GH_TOKEN: "t", AWS_SECRET_ACCESS_KEY: "s", MY_PASSWORD: "p" },
    start: (command, _cwd, env, level) => {
      started.push({ command, env, level })
      return child(command.includes("fail") ? 1 : 0, command.includes("slow") ? 5000 : 30) as never
    },
  }
  const run = (command = "npm test") =>
    runCodehouseAction({ sessionId: "s1", cwd: "C:/p", project: "p", command, why: "a check", level: "low" }, deps)
  return { run, records, started, request }
}

describe("Codehouse's own actions (section 6)", () => {
  it("runs an allowed command with no credential in its environment, at the session's level, and records it", async () => {
    const t = setup(verdict("allow"))
    const r = await t.run()
    expect(r).toMatchObject({ ran: true, exitCode: 0, killed: false, timedOut: false })
    expect(r.output).toContain("out")
    expect(t.started[0]!.level).toBe("low")
    expect(t.started[0]!.env).toEqual({ PATH: "C:/bin" })
    expect(t.records[0]).toMatchObject({ event: "codehouse_action", input: { command: "npm test", ran: true, exitCode: 0 } })
    expect(withoutCredentials({ CLAUDE_CODE_OAUTH_TOKEN: "x", NPM_CONFIG__AUTH: "y", HOME: "h" })).toEqual({ HOME: "h" })
  })

  it("refuses what the rules deny, and asks a person about an escalation outside Extreme approval", async () => {
    const denied = setup(verdict("deny", "destructive-shell", 100))
    expect(await denied.run()).toMatchObject({ ran: false, refused: expect.stringContaining("destructive-shell") })
    expect(denied.started).toHaveLength(0)
    const asked = setup(verdict("escalate", "no-rule", 50))
    expect(await asked.run()).toMatchObject({ ran: false, refused: "a person did not allow it" })
    expect(asked.request).toHaveBeenCalledOnce()
    const allowed = setup(verdict("escalate", "no-rule", 50), { answer: "allow" })
    expect(await allowed.run()).toMatchObject({ ran: true })
  })

  it("lets Extreme approval approve an escalation by the same rules as the session's own calls", async () => {
    const t = setup(verdict("escalate", "no-rule", 50), { extreme: true })
    expect(await t.run()).toMatchObject({ ran: true })
    expect(t.request).not.toHaveBeenCalled()
    // A failure to decide is never approved by Extreme approval.
    const f = setup(verdict("escalate", "engine-error", 50), { extreme: true })
    expect(await f.run()).toMatchObject({ ran: false })
    expect(f.request).toHaveBeenCalledOnce()
  })

  it("does not start while the kill switch is engaged, and stops when it is engaged mid-run", async () => {
    const off = setup(verdict("allow"), { kill: () => true })
    expect(await off.run()).toMatchObject({ ran: false, refused: "the kill switch is engaged" })
    expect(off.started).toHaveLength(0)
    let engaged = false
    const mid = setup(verdict("allow"), { kill: () => engaged })
    const p = mid.run("slow")
    setTimeout(() => (engaged = true), 5)
    const r = await p
    // Stopped long before the five seconds it would have run.
    expect(r).toMatchObject({ ran: true, killed: true, exitCode: null })
    expect(r.ms).toBeLessThan(2000)
  })
})
