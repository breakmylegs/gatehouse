// E-078: a grant remembered from a request records who made it, how and why, which the exceptions register shows.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { readGrantLimits, readRememberEntries } from "@gatehouse/policy"
import { register, GRANT_EVENT } from "../src/exceptions-register.js"
import { buildStack, type Stack } from "./stack.js"

describe("a grant made from a request (E-078)", () => {
  let s: Stack
  beforeAll(async () => {
    s = await buildStack({ hardTimeoutMs: 20_000, phoneExpiryMs: 10_000 })
  }, 60000)
  afterAll(async () => {
    for (const x of s.manager.liveSessions()) await x.close()
    await s.stop()
  })

  it("records grant_made with the request's reason, and the register says who and why", async () => {
    let reason = ""
    s.sdk.turn = async (api, text) => {
      if (text !== "go") return api.say("done")
      const call = api.callTool("Bash", { command: "npm publish --dry-run" })
      await s.waitForPending()
      reason = s.broker.list()[0]!.request.verdict.reason
      s.broker.resolve(s.pendingId(), { kind: "decision", decision: "allow", remember: true }, "desktop")
      await call
    }
    const session = await s.manager.start({ cwd: s.repo })
    const done = new Promise<void>((res) => session.on("message", (m) => m.type === "result" && res()))
    session.prompt("go")
    await done
    const made = s.records().find((x) => x.event === GRANT_EVENT)
    expect(made).toMatchObject({ channel: "desktop", tool: "Bash" })
    expect(JSON.parse(made!.inputJson)).toMatchObject({ why: reason })
    const r = register({ entries: readRememberEntries(s.localRules), limits: readGrantLimits(s.localRules), records: s.records() })
    expect(r.grants.find((g) => g.covers.includes("npm publish"))).toMatchObject({ grantedBy: "you, on the desktop", why: reason })
  }, 60000)
})
