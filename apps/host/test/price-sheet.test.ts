// E-019: a price sheet signed with the managed key gives an apply's monthly change as an interval; an unsigned sheet,
// or one signed with another key, is refused; a SKU the sheet does not know is "not known".
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { parsePlan } from "@gatehouse/policy"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createCanUseTool, type CanUseDeps } from "../src/canuse.js"
import { IacPlans } from "../src/iac-plans.js"
import { costDelta, PriceSheets, priceSheetCheck, skuOf, verifySheet, type PriceSheet } from "../src/price-sheet.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-prices-test-"))
  dirs.push(d)
  return d
}

const keys = () => crypto.generateKeyPairSync("ec", { namedCurve: "P-256" })
const sign = (text: string, key: crypto.KeyObject) => crypto.sign("sha256", Buffer.from(text), { key, dsaEncoding: "ieee-p1363" }).toString("base64")
const jwk = (k: crypto.KeyObject) => JSON.stringify(k.export({ format: "jwk" }))

const sheet: PriceSheet = {
  v: 1,
  currency: "GBP",
  generated: "2026-11-01",
  items: [
    { type: "aws_db_instance", sku: "db.t3.medium", region: "eu-west-2", low: 50, high: 70 },
    { type: "aws_db_instance", sku: "db.r6g.large", low: 150, high: 200 },
    { type: "aws_instance", sku: "t3.micro", low: 6, high: 8 },
  ],
}
const text = JSON.stringify(sheet)

const plan = (changes: unknown[]) => parsePlan({ format_version: "1.2", resource_changes: changes })!

describe("infrastructure cost delta", () => {
  it("gives a known SKU's monthly change as an interval, and an unknown SKU as not known", () => {
    const d = costDelta([plan([
      { address: "aws_db_instance.main", type: "aws_db_instance", change: { actions: ["create"], before: null, after: { instance_class: "db.t3.medium", availability_zone: "eu-west-2a" } } },
      { address: "aws_instance.old", type: "aws_instance", change: { actions: ["delete"], before: { instance_type: "t3.micro" }, after: null } },
      { address: "aws_instance.gpu", type: "aws_instance", change: { actions: ["create"], before: null, after: { instance_type: "p5.48xlarge" } } },
      { address: "aws_s3_bucket.logs", type: "aws_s3_bucket", change: { actions: ["create"], before: null, after: { bucket: "logs" } } },
    ])], sheet)
    expect(d).toEqual({ currency: "GBP", low: 42, high: 64, unknown: ["aws_instance.gpu (p5.48xlarge)"] })
  })

  it("prices a resized resource by the difference, and says nothing for a plan with no SKU", () => {
    const resize = plan([{ address: "aws_db_instance.main", type: "aws_db_instance", change: { actions: ["update"], before: { instance_class: "db.t3.medium", region: "eu-west-2" }, after: { instance_class: "db.r6g.large", region: "eu-west-2" } } }])
    expect(costDelta([resize], sheet)).toEqual({ currency: "GBP", low: 80, high: 150, unknown: [] })
    expect(costDelta([plan([{ address: "aws_s3_bucket.b", type: "aws_s3_bucket", change: { actions: ["create"], before: null, after: {} } }])], sheet)).toBeUndefined()
    expect(skuOf({ sku: { name: "Standard_B2s" }, location: "UKSouth" })).toEqual({ sku: "Standard_B2s", region: "uksouth" })
    expect(skuOf({ properties: { hardwareProfile: { vmSize: "Standard_D2s_v5" } } })).toEqual({ sku: "Standard_D2s_v5" })
  })

  it("refuses a sheet that is unsigned, signed with another key, or changed after signing", () => {
    const k = keys()
    expect(verifySheet(Buffer.from(text), undefined, jwk(k.publicKey))).toEqual({ why: expect.stringMatching(/no signature/) })
    expect(verifySheet(Buffer.from(text), sign(text, keys().privateKey), jwk(k.publicKey))).toEqual({ why: expect.stringMatching(/does not verify/) })
    expect(verifySheet(Buffer.from(text.replace("50", "5")), sign(text, k.privateKey), jwk(k.publicKey))).toEqual({ why: expect.stringMatching(/does not verify/) })
    expect(verifySheet(Buffer.from(text), sign(text, k.privateKey), undefined)).toEqual({ why: expect.stringMatching(/key .* is missing/) })
    expect(verifySheet(Buffer.from(text), sign(text, k.privateKey), jwk(k.publicKey))).toMatchObject({ sheet: { currency: "GBP", items: sheet.items } })
  })

  it("imports a sheet only when it verifies against the managed key, and Doctor says which", () => {
    const managed = tmp()
    const data = tmp()
    const k = keys()
    fs.writeFileSync(path.join(managed, "prices-key.json"), jwk(k.publicKey))
    const sheets = new PriceSheets(managed, data)
    expect(sheets.status()).toEqual({ state: "none" })
    expect(priceSheetCheck(sheets.status())).toBeUndefined()
    expect(sheets.import(text, sign(text, keys().privateKey))).toMatchObject({ state: "refused" })
    expect(fs.existsSync(path.join(data, "prices.json"))).toBe(false)
    expect(sheets.import(text, sign(text, k.privateKey))).toMatchObject({ state: "ok", items: 3, from: "imported" })
    expect(sheets.sheet()?.items).toHaveLength(3)
    // Changed on disk after import: no longer used.
    fs.writeFileSync(path.join(data, "prices.json"), text.replace("70", "7"))
    expect(sheets.status()).toMatchObject({ state: "refused" })
    expect(sheets.sheet()).toBeUndefined()
    expect(priceSheetCheck(sheets.status())).toMatchObject({ state: "fail" })
  })

  it("puts the change on an apply only with a sheet", () => {
    const plans = new IacPlans()
    plans.seen("s1", JSON.stringify({ format_version: "1.2", resource_changes: [{ address: "aws_instance.web", type: "aws_instance", change: { actions: ["create"], before: null, after: { instance_type: "t3.micro" } } }] }))
    const cwd = tmp()
    expect(plans.costFor("s1", "terraform apply tfplan", cwd, sheet)).toEqual({ currency: "GBP", low: 6, high: 8, unknown: [] })
    expect(plans.costFor("s1", "terraform apply tfplan", cwd, undefined)).toBeUndefined()
    expect(plans.costFor("s1", "terraform plan", cwd, sheet)).toBeUndefined()
  })

  it("is on the apply's card request", async () => {
    const request = vi.fn(async () => ({ outcome: "deny", channel: "desktop", waitedMs: 1 }))
    const canUse = createCanUseTool({
      sessionId: "s1", cwd: tmp(), project: "infra",
      approver: { evaluate: async () => ({ outcome: "escalate", ruleId: "cloud-read-change", reason: "Changes cloud resources.", risk: 90, decidedBy: "rules", policyHash: "h" }) },
      broker: { request }, audit: { record: async () => true }, kill: () => false, policy: () => undefined, engine: {}, pwsh: undefined,
      decided: new Set<string>(), extreme: () => false, effects: async () => undefined, log: () => undefined,
      iacCost: () => ({ currency: "GBP", low: 6, high: 8, unknown: [] }),
    } as unknown as CanUseDeps)
    await canUse("Bash", { command: "terraform apply tfplan" }, { toolUseID: "t", signal: new AbortController().signal } as never)
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ cost: { currency: "GBP", low: 6, high: 8, unknown: [] } }))
  })
})
