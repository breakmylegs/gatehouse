// B07: the Doctor checks what Codehouse needs to work safely on this computer, says what to do about each problem,
// and gives a report to copy that names no email address or token.
import Fastify from "fastify"
import { describe, expect, it } from "vitest"
import type { Health } from "@gatehouse/shared"
import { doctorChecks, forSharing, registerDoctorRoutes, type DoctorFacts } from "../src/doctor.js"

const health = (o: Partial<Health> = {}): Health => ({
  approver: { state: "up", errors: [] },
  relay: { state: "not-configured", devices: 0 },
  signin: {
    signedIn: true,
    email: "someone@example.com",
    organization: "ACN - Premium",
    managedPolicy: "detected",
    orgOk: true,
    checked: true,
  },
  killSwitch: { engaged: false, approverConfirmed: true },
  pwsh: { running: true },
  ...o,
})
const facts = (o: Partial<DoctorFacts> = {}): DoctorFacts => ({
  health: health(),
  claude: { found: true, version: "2.1.310" },
  listener: { address: "127.0.0.1" },
  diskFree: 50 * 1024 ** 3,
  updates: { kind: "release" },
  ...o,
})
const by = (f: DoctorFacts) => Object.fromEntries(doctorChecks(f).map((c) => [c.id, c]))

describe("the Doctor's checks", () => {
  it("are all fine on a computer set up as it should be", () => {
    const checks = doctorChecks(facts())
    expect(checks.every((c) => c.state === "ok")).toBe(true)
    expect(checks.map((c) => c.id)).toEqual([
      "claude-code",
      "sign-in",
      "organisation",
      "approver",
      "kill-switch",
      "listener",
      "powershell",
      "phone",
      "disk",
      "updates",
    ])
  })

  it("call what stops sessions a problem, and say what to do", () => {
    const c = by(
      facts({
        claude: { found: false },
        health: health({
          approver: { state: "down", errors: [] },
          signin: { ...health().signin, orgOk: false, orgMessage: "Signed in to Other Org." },
        }),
        listener: { address: "0.0.0.0" },
        diskFree: 0.5 * 1024 ** 3,
      }),
    )
    for (const id of ["claude-code", "organisation", "approver", "listener", "disk"]) {
      expect(c[id]!.state, id).toBe("fail")
      expect(c[id]!.fix, id).toBeTruthy()
    }
    expect(c.organisation!.detail).toBe("Signed in to Other Org.")
  })

  it("call what makes Codehouse ask you more, or reach you less, something to look at", () => {
    const c = by(
      facts({
        health: health({
          approver: { state: "up", errors: ["rules.user.yaml: line 3"] },
          killSwitch: { engaged: true, approverConfirmed: true },
          pwsh: { running: false },
          relay: { state: "unreachable", devices: 1 },
          push: [{ channel: "ntfy", ok: false }],
        }),
        diskFree: 3 * 1024 ** 3,
        updates: { kind: "release", checkError: "Could not reach GitHub" },
        localRuntime: { ok: false, reason: "Nothing answered." },
      }),
    )
    for (const id of [
      "approver",
      "kill-switch",
      "powershell",
      "phone",
      "push-ntfy",
      "disk",
      "updates",
      "local-models",
    ])
      expect(c[id]!.state, id).toBe("warn")
  })

  it("waits for the first sign-in check instead of calling it a problem", () => {
    const c = by(facts({ health: health({ signin: { ...health().signin, checked: false } }) }))
    expect(c["sign-in"]!.state).toBe("warn")
    expect(c.organisation).toBeUndefined()
  })
})

describe("the report to copy", () => {
  it("takes out email addresses and secrets, wherever a check put them", () => {
    const text = forSharing(
      "FAIL Organisation: Signed in as someone@example.com. Token sk-ant-api03-" + "x".repeat(40),
    )
    expect(text).not.toContain("someone@example.com")
    expect(text).toContain("[email address]")
    expect(text).not.toContain("x".repeat(40))
  })
})

describe("GET /api/doctor", () => {
  it("runs the checks and gives a report that names no email address", async () => {
    const app = Fastify()
    registerDoctorRoutes(app, {
      health: () => health(),
      claude: async () => ({ found: true, version: "2.1.310" }),
      updates: { status: () => ({ current: "2.1.20", kind: "release" }) },
      config: () => ({}) as never,
      env: process.env,
    })
    await app.listen({ port: 0, host: "127.0.0.1" })
    try {
      const r = await app.inject({ method: "GET", url: "/api/doctor" })
      const body = r.json() as {
        version: string
        checks: Array<{ id: string; state: string }>
        report: string
      }
      expect(body.version).toBe("2.1.20")
      expect(body.checks.find((c) => c.id === "listener")).toMatchObject({ state: "ok" })
      expect(body.report).toMatch(/^Codehouse 2\.1\.20, checked /)
      expect(body.report).toContain("OK   Claude Code: Claude Code 2.1.310.")
      expect(body.report).not.toContain("someone@example.com")
    } finally {
      await app.close()
    }
  })
})
