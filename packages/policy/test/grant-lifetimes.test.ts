// C-013: a remembered rule carries an expiry, a folder scope and a use limit; an expired grant, or one made for another
// folder, no longer applies, so the call asks again. The limits live beside rules.local.yaml, so an older version
// still reads that file.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { PolicyEngine } from "../src/engine.js"
import { appendRemember, removeRemember } from "../src/host-helpers.js"
import { grantLimitsPath, loadPolicy, readGrantLimits } from "../src/loader.js"
import { checkRememberFile } from "../src/schema.js"
import { fwd, makeFixture, SEED_RULES, type Fixture } from "./helpers.js"

let fx: Fixture
let dir: string
const NOW = Date.parse("2026-11-09T12:00:00Z")
const install = { toolName: "Bash", input: { command: "npm install lodash" } }

beforeAll(() => {
  fx = makeFixture()
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-grants-"))
})
afterAll(() => {
  fx.dispose()
  fs.rmSync(dir, { recursive: true, force: true })
})

function decide(localPath: string, cwd: string, now: number) {
  const policy = loadPolicy({ rulesPath: SEED_RULES, workspaceRootsOverride: [fwd(fx.ws)], localPath })
  return new PolicyEngine({ getPolicy: () => policy }).evaluate(install, { cwd, now })
}

describe("grant lifetimes (C-013)", () => {
  it("allows within its time and folder, and escalates once expired or in another folder", async () => {
    const local = path.join(dir, "a", "rules.local.yaml")
    fs.mkdirSync(path.dirname(local), { recursive: true })
    const sub = path.join(fx.ws, "src")
    const { id } = await appendRemember(
      local,
      { tool: "Bash", command: "npm install lodash" },
      () => new Date(NOW),
      { expiresAt: new Date(NOW + 60_000).toISOString(), scope: sub },
    )
    expect(await decide(local, fwd(sub), NOW)).toMatchObject({ outcome: "allow", ruleId: id })
    expect(await decide(local, fwd(sub), NOW + 120_000)).toMatchObject({ outcome: "escalate" })
    expect(await decide(local, fwd(fx.ws), NOW)).toMatchObject({ outcome: "escalate" })
    // The use limit travels with the rule, for the Host to count against.
    const policy = loadPolicy({ rulesPath: SEED_RULES, workspaceRootsOverride: [fwd(fx.ws)], localPath: local })
    expect(policy.remember.find((r) => r.id === id)?.withinKey).toBeTruthy()
  })

  it("treats an expiry it cannot read as expired, and a bad use limit as none left", async () => {
    const local = path.join(dir, "b", "rules.local.yaml")
    fs.mkdirSync(path.dirname(local), { recursive: true })
    const { id } = await appendRemember(local, { tool: "Bash", command: "npm install lodash" }, () => new Date(NOW), {
      expiresAt: "not a date",
      maxUses: -3,
    })
    expect(await decide(local, fwd(fx.ws), NOW)).toMatchObject({ outcome: "escalate" })
    const policy = loadPolicy({ rulesPath: SEED_RULES, workspaceRootsOverride: [fwd(fx.ws)], localPath: local })
    expect(policy.remember.find((r) => r.id === id)?.maxUses).toBe(0)
  })

  it("keeps an older grant with no limits working, and forgets the limits when the rule goes", async () => {
    const local = path.join(dir, "c", "rules.local.yaml")
    fs.mkdirSync(path.dirname(local), { recursive: true })
    const { id } = await appendRemember(local, { tool: "Bash", command: "npm install lodash" }, () => new Date(NOW))
    expect(await decide(local, fwd(fx.ws), NOW)).toMatchObject({ outcome: "allow", ruleId: id })
    expect(fs.existsSync(grantLimitsPath(local))).toBe(false)
    const limited = await appendRemember(local, { tool: "Bash", command: "npm install chalk" }, () => new Date(NOW), {
      maxUses: 3,
    })
    expect(Object.keys(readGrantLimits(local))).toEqual([limited.id.replace(/^remember-/, "")])
    await removeRemember(local, limited.id)
    expect(readGrantLimits(local)).toEqual({})
  })

  it("keeps the limits beside rules.local.yaml, which still refuses a field it does not know", () => {
    // A field that might widen a rule (golden 13-remember) is refused, so the limits never go in the rule itself:
    // an older version reads the rules file as it always did.
    const file = {
      version: 1,
      remember: [{ id: "r1", tool: "Bash", command: "npm install lodash", expiresAt: "2026-12-01" }],
    }
    expect(checkRememberFile(file).ok).toBe(false)
  })
})
