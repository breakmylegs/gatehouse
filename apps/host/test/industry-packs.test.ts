// E-092: an unsigned pack cannot be installed; a pack that removes a rule is refused; a pack can only add; the draft
// packs are valid, and once signed and installed their rules decide calls as their cases say.
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { parse as parseYaml } from "yaml"
import { loadPolicy, PolicyEngine } from "@gatehouse/policy"
import { checkIndustryPack, draftPacks, installIndustryPack, signIndustryPack, type IndustryPack } from "../src/industry-packs.js"

const DRAFTS = path.resolve(import.meta.dirname, "../../../policy/industry")
const RULES = path.resolve(import.meta.dirname, "../../../policy/rules.yaml")
const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-ind-"))
  dirs.push(d)
  return d
}
const mine = crypto.generateKeyPairSync("ed25519")
const stranger = crypto.generateKeyPairSync("ed25519")
const pem = (k: crypto.KeyObject) => k.export({ type: "spki", format: "pem" }).toString()
const signer = (key = mine) => async (b: Buffer) => ({ signature: crypto.sign(null, b, key.privateKey).toString("base64"), publicKey: pem(key.publicKey) })
const review = { by: "Peter", note: "Read every rule and item against the PCI DSS guidance." }
const draft = (file: string) => draftPacks(DRAFTS).find((d) => d.file === file)!.pack!

describe("signed industry packs", () => {
  it("ships four valid draft packs, each only adding caution", () => {
    const d = draftPacks(DRAFTS)
    expect(d.map((x) => x.file)).toEqual(["banking.yaml", "contact-centre.yaml", "energy.yaml", "telecoms.yaml"])
    for (const x of d) {
      expect(x.errors, x.file).toBeUndefined()
      expect(x.pack!.status).toMatch(/^DRAFT for legal and subject expert sign-off/)
      expect(x.pack!.rules.allow ?? []).toEqual([])
      expect(x.pack!.checklist.length).toBeGreaterThan(2)
    }
  })

  it("will not install a pack that is not signed, signed by a key you do not trust, or changed after signing", async () => {
    const o = { trustedKeys: [pem(mine.publicKey)], packsDir: path.join(tmp(), "rule-packs"), checklistDir: path.join(tmp(), "checklists") }
    const signed = await signIndustryPack(draft("contact-centre.yaml"), review, signer())
    await expect(installIndustryPack({ ...signed, rulesSig: "" }, o)).rejects.toThrow(/not signed: review it and sign it/)
    await expect(installIndustryPack(undefined, o)).rejects.toThrow(/not signed/)
    await expect(installIndustryPack(await signIndustryPack(draft("contact-centre.yaml"), review, signer(stranger)), o)).rejects.toThrow(/not signed by a key you trust/)
    await expect(installIndustryPack({ ...signed, rulesYaml: signed.rulesYaml.replace("risk: 85", "risk: 5") }, o)).rejects.toThrow(/changed after it was signed/)
    await expect(installIndustryPack({ ...signed, checklistJson: "[]" }, o)).rejects.toThrow(/changed after it was signed/)
    expect(fs.existsSync(o.packsDir)).toBe(false)
    // Signing needs a review recorded.
    await expect(signIndustryPack(draft("contact-centre.yaml"), { by: "", note: "" }, signer())).rejects.toThrow(/who reviewed/)
  })

  it("installs a signed pack whose rules then load as a shared pack and decide calls as its cases say", async () => {
    const root = tmp()
    const o = { trustedKeys: [pem(mine.publicKey)], packsDir: path.join(root, "rule-packs"), checklistDir: path.join(root, "checklists") }
    for (const file of ["banking.yaml", "contact-centre.yaml", "energy.yaml", "telecoms.yaml"]) {
      const r = await installIndustryPack(await signIndustryPack(draft(file), review, signer()), o)
      expect(r.rules).toBeGreaterThan(0)
    }
    const policy = loadPolicy({ rulesPath: RULES, sharedPacksDir: o.packsDir, trustedPackKeys: o.trustedKeys, workspaceRootsOverride: [root.replace(/\\/g, "/")] })
    const engine = new PolicyEngine({ getPolicy: () => policy })
    for (const file of ["banking.yaml", "contact-centre.yaml", "energy.yaml", "telecoms.yaml"])
      for (const c of draft(file).rules.cases ?? []) {
        const input = { ...c.input } as Record<string, unknown>
        if (typeof input.file_path === "string") input.file_path = path.join(root, input.file_path).replace(/\\/g, "/")
        const v = await engine.evaluate({ toolName: c.tool, input }, { cwd: root.replace(/\\/g, "/") })
        expect(v, `${file} ${c.rule}`).toMatchObject({ outcome: c.expect, ruleId: c.rule })
      }
  })

  it("refuses a pack that removes a rule, allows anything, or drops a checklist item", async () => {
    const o = { trustedKeys: [pem(mine.publicKey)], packsDir: path.join(tmp(), "rule-packs"), checklistDir: path.join(tmp(), "checklists") }
    const pack = draft("energy.yaml")
    await installIndustryPack(await signIndustryPack(pack, review, signer()), o)
    // A new version without one of its rules.
    const fewer: IndustryPack = { ...pack, rules: { ...pack.rules, escalate: pack.rules.escalate!.slice(1) } }
    await expect(installIndustryPack(await signIndustryPack(fewer, review, signer()), o)).rejects.toThrow(/would remove or soften rules the installed pack has \(ind-energy-psr\)/)
    // One that drops a checklist item.
    const shorter: IndustryPack = { ...pack, checklist: pack.checklist.slice(1) }
    await expect(installIndustryPack(await signIndustryPack(shorter, review, signer()), o)).rejects.toThrow(/would remove checklist items .*psr-sharing/)
    // One that says it removes, or allows, is not a pack at all.
    expect(checkIndustryPack({ ...pack, rules: { ...pack.rules, removeAllow: ["safe-shell"] } })).toMatchObject({ ok: false })
    expect(checkIndustryPack({ ...pack, removes: ["ind-energy-psr"] } as unknown)).toMatchObject({ ok: false, errors: [expect.stringMatching(/would take something away \(removes\)/)] })
    expect(checkIndustryPack({ ...pack, rules: { ...pack.rules, allow: [{ id: "ind-energy-ok", commands: ["*"] }] } })).toMatchObject({ ok: false, errors: [expect.stringMatching(/allow rules/)] })
    await expect(signIndustryPack({ ...pack, rules: { ...pack.rules, allow: [{ id: "ind-energy-ok", commands: ["*"] }] } }, review, signer())).rejects.toThrow(/cannot be signed/)
    // A deny rule turned into one that only asks is a loosening too.
    const o2 = { trustedKeys: [pem(mine.publicKey)], packsDir: path.join(tmp(), "rule-packs"), checklistDir: path.join(tmp(), "checklists") }
    const [first, ...rest] = pack.rules.escalate!
    const strict: IndustryPack = { ...pack, rules: { ...pack.rules, escalate: rest, deny: [first!] } }
    await installIndustryPack(await signIndustryPack(strict, review, signer()), o2)
    await expect(installIndustryPack(await signIndustryPack(pack, review, signer()), o2)).rejects.toThrow(/would remove or soften rules .*ind-energy-psr/)
    // A version that only adds is installed.
    const more: IndustryPack = { ...pack, checklist: [...pack.checklist, { id: "extra", text: "One more check." }] }
    expect(await installIndustryPack(await signIndustryPack(more, review, signer()), o)).toMatchObject({ checklist: pack.checklist.length + 1 })
    expect(parseYaml(fs.readFileSync(path.join(o.packsDir, "ind-energy.yaml"), "utf8")).id).toBe("ind-energy")
  })
})
