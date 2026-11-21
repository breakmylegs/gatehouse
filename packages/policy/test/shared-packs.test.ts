// C-055: signed shared rule packs. A pack applies only when signed by a key you trust; its deny and escalate rules
// always apply, its allows only where IT's managed policy does not forbid them, and anything else refuses the policy.
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { PolicyEngine } from "../src/engine.js"
import { loadPolicy, PolicyLoadError } from "../src/loader.js"
import { fwd, makeFixture, SEED_RULES, type Fixture } from "./helpers.js"

let fx: Fixture
let root: string
const team = crypto.generateKeyPairSync("ed25519")
const stranger = crypto.generateKeyPairSync("ed25519")
const pem = (k: crypto.KeyObject) => k.export({ type: "spki", format: "pem" }).toString()
const sign = (data: string, key = team.privateKey) => crypto.sign(null, Buffer.from(data), key).toString("base64")

const PACK = `version: 1
id: team
title: The team's rules
description: What the team agreed.
deny:
  - id: team-no-prod-db
    commands: ["psql *prod*"]
escalate:
  - id: team-ask-deploy
    commands: ["kubectl apply*"]
allow:
  - id: team-make-lint
    commands: ["make lint"]
`

let packs: string
let managed: string
const place = (name: string, yaml: string, sig: string | null = sign(yaml)) => {
  fs.writeFileSync(path.join(packs, name), yaml)
  if (sig !== null) fs.writeFileSync(path.join(packs, `${name}.sig`), sig)
}
const placeManaged = (yaml: string) => {
  fs.mkdirSync(managed, { recursive: true })
  fs.writeFileSync(path.join(managed, "policy.yaml"), yaml)
  fs.writeFileSync(path.join(managed, "policy.yaml.sig"), sign(yaml, it_.privateKey))
  fs.writeFileSync(path.join(managed, "key.pem"), pem(it_.publicKey))
}
const it_ = crypto.generateKeyPairSync("ed25519")
const load = (o: { keys?: string[]; managed?: boolean } = {}) =>
  loadPolicy({
    rulesPath: SEED_RULES,
    workspaceRootsOverride: [fwd(fx.ws)],
    sharedPacksDir: packs,
    trustedPackKeys: o.keys ?? [pem(team.publicKey)],
    ...(o.managed ? { managedDir: managed } : {}),
  })
const errorsOf = (f: () => unknown): string[] => {
  try {
    f()
  } catch (e) {
    if (e instanceof PolicyLoadError) return e.errors
    throw e
  }
  return []
}

beforeAll(() => {
  fx = makeFixture()
  root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-packs-"))
})
afterAll(() => {
  fx.dispose()
  fs.rmSync(root, { recursive: true, force: true })
})
beforeEach(() => {
  packs = path.join(root, `packs-${crypto.randomUUID()}`)
  managed = path.join(root, `managed-${crypto.randomUUID()}`)
  fs.mkdirSync(packs, { recursive: true })
})

describe("signed shared rule packs (C-055)", () => {
  it("adds a trusted pack's rules, marked as shared, and they decide calls", async () => {
    place("team.yaml", PACK)
    const policy = load()
    expect(policy.rules.deny.map((r) => r.id)).toContain("team-no-prod-db")
    expect(policy.rules.escalate.map((r) => r.id)).toContain("team-ask-deploy")
    expect(policy.rules.allow.map((r) => r.id)).toContain("team-make-lint")
    expect(policy.sources?.["team-no-prod-db"]).toBe("shared:team")
    const engine = new PolicyEngine({ getPolicy: () => policy })
    const v = await engine.evaluate({ toolName: "Bash", input: { command: "psql -h prod-db" } }, { cwd: fwd(fx.ws) })
    expect(v).toMatchObject({ outcome: "deny", ruleId: "team-no-prod-db" })
  })

  it("refuses a pack that is not signed, signed by another key, or changed after signing", () => {
    place("team.yaml", PACK, null)
    expect(errorsOf(load).join(" ")).toMatch(/team\.yaml: it is not signed/)
    place("team.yaml", PACK, sign(PACK, stranger.privateKey))
    expect(errorsOf(load).join(" ")).toMatch(/not signed by a key you trust/)
    place("team.yaml", PACK)
    fs.writeFileSync(path.join(packs, "team.yaml"), PACK.replace("make lint", "rm -rf /"))
    expect(errorsOf(load).join(" ")).toMatch(/changed after it was signed/)
    expect(errorsOf(() => load({ keys: ["not a key"] })).join(" ")).toMatch(/could not be read/)
  })

  it("keeps a pack's allows out where IT's policy forbids them, and its deny rules in", () => {
    place("team.yaml", PACK)
    placeManaged("version: 1\npackAllows: false\n")
    const off = load({ managed: true })
    expect(off.rules.allow.map((r) => r.id)).not.toContain("team-make-lint")
    expect(off.rules.deny.map((r) => r.id)).toContain("team-no-prod-db")
    placeManaged("version: 1\nremoveAllow: [team-make-lint]\n")
    const removed = load({ managed: true })
    expect(removed.rules.allow.map((r) => r.id)).not.toContain("team-make-lint")
    expect(removed.rules.escalate.map((r) => r.id)).toContain("team-ask-deploy")
  })

  it("lets only IT's policy say packAllows, and refuses a pack whose rule ids are not its own", () => {
    const overlays = path.join(root, `overlays-${crypto.randomUUID()}`)
    fs.mkdirSync(overlays, { recursive: true })
    fs.writeFileSync(path.join(overlays, "shop.yaml"), "version: 1\nproject: shop\npackAllows: true\n")
    expect(errorsOf(() => loadPolicy({ rulesPath: SEED_RULES, workspaceRootsOverride: [fwd(fx.ws)], overlayDir: overlays })).join(" ")).toMatch(/packAllows is set only by IT/)
    place("team.yaml", PACK.replace("id: team-make-lint", "id: base-sneaky"))
    expect(errorsOf(load).join(" ")).toMatch(/must start with "team-"/)
  })

  it("changes nothing with no packs", () => {
    fs.rmSync(packs, { recursive: true, force: true })
    expect(load().rules.allow.some((r) => r.id.startsWith("team-"))).toBe(false)
  })
})
