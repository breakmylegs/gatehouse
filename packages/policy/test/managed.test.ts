// B37: a policy file signed by IT, in a folder you cannot change. It only tightens, and any tampering is refused.
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { PolicyEngine } from "../src/engine.js"
import { loadPolicy, MANAGED_ERROR, PolicyLoadError, PolicyStore } from "../src/loader.js"
import { describeManaged, extremeAllowed, lockedChanges, managedRefusal, modeAllowed, phoneAllowed, providerAllowed } from "../src/managed.js"
import { fwd, makeFixture, SEED_RULES, type Fixture } from "./helpers.js"

let fx: Fixture
let dir: string
const keys = crypto.generateKeyPairSync("ed25519")
const other = crypto.generateKeyPairSync("ed25519")
const sign = (data: string, key = keys.privateKey) =>
  crypto.sign(null, Buffer.from(data), key).toString("base64")

function place(yaml: string, o: { sig?: string | null; key?: string | null } = {}) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "policy.yaml"), yaml)
  if (o.sig !== null) fs.writeFileSync(path.join(dir, "policy.yaml.sig"), o.sig ?? sign(yaml))
  if (o.key !== null)
    fs.writeFileSync(
      path.join(dir, "key.pem"),
      o.key ?? keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
    )
}
const load = () =>
  loadPolicy({ rulesPath: SEED_RULES, workspaceRootsOverride: [fwd(fx.ws)], managedDir: dir })
const errorsOf = () => {
  try {
    load()
    return []
  } catch (e) {
    return (e as PolicyLoadError).errors
  }
}

const IT = [
  "version: 1",
  "deny:",
  "  - { id: it-no-docker, commands: ['docker *'], message: IT does not allow Docker on these laptops. }",
  "escalate:",
  "  - { id: it-ask-npm-publish, commands: ['npm publish*'], risk: 80 }",
  "",
].join("\n")

beforeAll(() => {
  fx = makeFixture()
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-managed-"))
})
afterAll(() => {
  fx.dispose()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe("IT's signed policy", () => {
  it("is applied over every other rule when the signature checks out", async () => {
    place(IT)
    const policy = load()
    expect(policy.managed).toBe(true)
    const e = new PolicyEngine({ getPolicy: () => policy })
    const ctx = { cwd: fwd(fx.ws) }
    expect(await e.evaluate({ toolName: "Bash", input: { command: "docker run x" } }, ctx)).toMatchObject({
      outcome: "deny",
      ruleId: "it-no-docker",
    })
    expect((await e.evaluate({ toolName: "Bash", input: { command: "npm publish" } }, ctx)).outcome).toBe(
      "escalate",
    )
  })

  it("is refused when it was changed after signing, signed by another key, unsigned, or has no key", () => {
    place(IT, { sig: sign(IT.replace("docker", "podman")) })
    expect(errorsOf()[0]).toMatch(new RegExp(`^${MANAGED_ERROR}: the signature does not match`))
    place(IT, { sig: sign(IT, other.privateKey) })
    expect(errorsOf()[0]).toMatch(/signature does not match/)
    place(IT, { sig: null })
    expect(errorsOf()[0]).toMatch(/no signature/)
    place(IT, { key: null })
    expect(errorsOf()[0]).toMatch(/no key/)
    place(IT, { key: crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "pem" }).toString() })
    expect(errorsOf()[0]).toMatch(/not an Ed25519/)
  })

  it("can only tighten: an allow rule in it is refused, and removing an allow rule takes it away", () => {
    place("version: 1\nallow:\n  - { id: it-allow-all, tools: ['*'] }\n")
    expect(errorsOf().join(" ")).toMatch(/not allowed in an overlay/)
    const seed = loadPolicy({ rulesPath: SEED_RULES, workspaceRootsOverride: [fwd(fx.ws)] })
    const someAllow = seed.rules.allow[0]!.id
    place(`version: 1\nremoveAllow: [${someAllow}]\n`)
    expect(load().rules.allow.some((r) => r.id === someAllow)).toBe(false)
    place("version: 1\nremoveAllow: [no-such-rule]\n")
    expect(errorsOf()[0]).toMatch(/unknown allow rule no-such-rule/)
  })

  it("is not needed: with no policy.yaml in the folder, nothing changes", () => {
    fs.rmSync(dir, { recursive: true, force: true })
    expect(load().managed).toBeUndefined()
  })

  it("leaves a good policy in place when a bad one appears, and says why", () => {
    place(IT)
    const store = new PolicyStore({ rulesPath: SEED_RULES, workspaceRootsOverride: [fwd(fx.ws)], managedDir: dir })
    expect(store.load()).toBe(true)
    place(IT, { sig: sign("something else") })
    expect(store.load()).toBe(false)
    expect(store.current?.managed).toBe(true)
    expect(store.status().errors[0]).toMatch(new RegExp(`^${MANAGED_ERROR}`))
  })
})

describe("the organisation's settings in IT's policy (T-067)", () => {
  const SETTINGS = [
    IT.trimEnd(),
    "settings:",
    "  managedBy: Accenture IT",
    "  maxMode: default",
    "  extremeApproval: false",
    "  providers: [claude]",
    "  phone: false",
    "  locked: [theme, extremeRiskLimit]",
    "",
  ].join("\n")

  it("are read from the signed policy, hashed with it, and said in words", () => {
    place(SETTINGS)
    const p = load()
    expect(p.managedSettings).toEqual({ managedBy: "Accenture IT", maxMode: "default", extremeApproval: false, providers: ["claude"], phone: false, locked: ["theme", "extremeRiskLimit"] })
    place(IT)
    expect(load().hash).not.toBe(p.hash)
    expect(describeManaged(p.managedSettings)).toEqual([
      "Managed by Accenture IT",
      "The broadest permission mode allowed is default.",
      "Max approval is turned off.",
      "AI providers allowed: claude.",
      "The phone, the Relay and push channels are turned off.",
      "Settings you cannot change here: theme, extremeRiskLimit.",
    ])
  })

  it("refuse a setting this version does not know, so a policy it cannot enforce stops sessions", () => {
    place(`${SETTINGS}  updates: { mirror: "https://mirror.example/codehouse" }\n`)
    expect(errorsOf().some((e) => e.startsWith(MANAGED_ERROR))).toBe(true)
    place(`${IT.trimEnd()}\nsettings:\n  maxMode: bypassPermissions\n`)
    expect(errorsOf().some((e) => e.startsWith(MANAGED_ERROR))).toBe(true)
  })

  it("narrow only, and only as far as they say", () => {
    const m = { maxMode: "acceptEdits" as const, extremeApproval: false, providers: ["claude" as const, "local" as const], phone: false, locked: ["theme"] }
    expect(["plan", "default", "acceptEdits"].map((x) => modeAllowed(m, x))).toEqual([true, true, true])
    expect(modeAllowed(m, "auto")).toBe(false)
    expect(modeAllowed(m, "bypassPermissions")).toBe(false)
    expect(modeAllowed(undefined, "auto")).toBe(true)
    expect([extremeAllowed(m), extremeAllowed(undefined), extremeAllowed({})]).toEqual([false, true, true])
    expect([providerAllowed(m, "local"), providerAllowed(m, "gateway"), providerAllowed(undefined, "gateway")]).toEqual([true, false, true])
    expect([phoneAllowed(m), phoneAllowed(undefined)]).toEqual([false, true])
    expect(lockedChanges(m, { theme: "dark", x: 1 }, { theme: "light", x: 2 })).toEqual(["theme"])
    expect(lockedChanges(m, { theme: "dark" }, { theme: "dark", x: 2 })).toEqual([])
    expect(lockedChanges(m, {}, { theme: "dark" })).toEqual(["theme"])
    expect(managedRefusal(undefined, "Extreme approval is turned off")).toBe("Managed by your organisation: Extreme approval is turned off.")
    expect(describeManaged(undefined)).toEqual(["No settings are managed by your organisation."])
  })
})

describe("a project's overlay (T-067)", () => {
  it("cannot set the organisation's settings", () => {
    const overlays = fs.mkdtempSync(path.join(os.tmpdir(), "gh-overlay-"))
    try {
      fs.writeFileSync(path.join(overlays, "shop.yaml"), "version: 1\nsettings:\n  maxMode: auto\n")
      let errors: string[] = []
      try {
        loadPolicy({ rulesPath: SEED_RULES, workspaceRootsOverride: [fwd(fx.ws)], overlayDir: overlays })
      } catch (e) {
        errors = (e as PolicyLoadError).errors
      }
      expect(errors).toContain("overlay shop.yaml: settings are set only by IT's managed policy")
    } finally {
      fs.rmSync(overlays, { recursive: true, force: true })
    }
  })
})
