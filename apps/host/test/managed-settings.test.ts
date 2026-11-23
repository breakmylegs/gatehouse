// T-067: the organisation's managed settings are enforced where they apply: no session starts, or changes, broader
// than the mode cap or with Extreme approval turned off; providers outside the list are refused; and
// `npm run policy -- check|show` says whether IT's policy is in force and what it allows.
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { ManagedSettings } from "@gatehouse/policy"
import { REPO_ROOT } from "../src/bootstrap.js"
import { policyReport, reportText } from "../src/policy-cli.js"
import { buildStack, type Stack } from "./stack.js"

let s: Stack
let managed: ManagedSettings | undefined
beforeAll(async () => {
  s = await buildStack({ hardTimeoutMs: 1500, phoneExpiryMs: 800, managed: () => managed })
}, 60000)
afterAll(async () => {
  for (const x of s.manager.liveSessions()) await x.close()
  await s.stop()
})

describe("the organisation's settings, enforced (T-067)", () => {
  it("starts no session broader than the mode cap, and changes none to a broader mode", async () => {
    managed = { managedBy: "Accenture IT", maxMode: "default" }
    await expect(s.manager.start({ cwd: s.repo, mode: "acceptEdits" })).rejects.toThrow("Managed by Accenture IT: the broadest mode allowed is default.")
    const session = await s.manager.start({ cwd: s.repo, mode: "plan" })
    await session.setMode("default")
    await expect(session.setMode("auto")).rejects.toThrow(/broadest mode allowed is default/)
    expect(session.info().mode).toBe("default")
    await session.close()
  })

  it("offers no Extreme approval when it is turned off, at start or later", async () => {
    managed = { extremeApproval: false }
    await expect(s.manager.start({ cwd: s.repo, extreme: true })).rejects.toThrow("Managed by your organisation: Max approval is turned off.")
    const session = await s.manager.start({ cwd: s.repo })
    await expect(session.setExtreme(true)).rejects.toThrow(/Max approval is turned off/)
    expect(session.info().extreme).toBe(false)
    await session.setExtreme(false)
    await session.close()
  })

  it("refuses a provider that is not on the list", async () => {
    managed = { providers: ["local"] }
    await expect(s.manager.start({ cwd: s.repo })).rejects.toThrow(/Claude is not one of the providers allowed/)
    managed = { providers: ["claude"] }
    await expect(s.manager.start({ cwd: "chat", kind: "chat", mode: "plan", localModel: "qwen3:8b" })).rejects.toThrow(/models other than Claude are not allowed/)
    managed = undefined
  })
})

describe("policy check and policy show (T-067)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-policy-cli-"))
  const keys = crypto.generateKeyPairSync("ed25519")
  const rules = path.join(REPO_ROOT, "policy", "rules.yaml")
  const place = (yaml: string, sign = true) => {
    fs.writeFileSync(path.join(dir, "policy.yaml"), yaml)
    fs.writeFileSync(path.join(dir, "policy.yaml.sig"), sign ? crypto.sign(null, Buffer.from(yaml), keys.privateKey).toString("base64") : "bm90IGEgc2lnbmF0dXJl")
    fs.writeFileSync(path.join(dir, "key.pem"), keys.publicKey.export({ type: "spki", format: "pem" }).toString())
  }
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  it("says when there is no policy from IT, when it is in force and what it allows, and when it cannot be used", () => {
    const none = policyReport(rules, path.join(dir, "nothing-here"))
    expect(none).toMatchObject({ ok: true, managed: false })
    expect(reportText(none, "check")).toMatch(/There is no policy from IT in/)
    place("version: 1\nsettings:\n  managedBy: Accenture IT\n  maxMode: default\n  phone: false\n")
    const good = policyReport(rules, dir)
    expect(good).toMatchObject({ ok: true, managed: true })
    expect(reportText(good, "check")).toMatch(/is signed, checked and in force/)
    expect(reportText(good, "show")).toBe("Managed by Accenture IT\nThe broadest permission mode allowed is default.\nThe phone, the Relay and push channels are turned off.")
    place("version: 1\nsettings:\n  maxMode: default\n", false)
    const bad = policyReport(rules, dir)
    expect(bad.ok).toBe(false)
    expect(reportText(bad, "check")).toMatch(/cannot be used, so no session will start:\n  managed policy: the signature does not match/)
  })
})
