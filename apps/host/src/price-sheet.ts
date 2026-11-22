/**
 * E-019, infrastructure cost delta (Expansion E3, the safe variant). A price sheet, signed like D-057's vulnerability
 * snapshot (ECDSA P-256 over the file's bytes, SHA-256, base64), gives each SKU's monthly cost as a low and a high
 * figure. The key that checks it is in the managed folder, which only an administrator can change (`prices-key.json`,
 * or the snapshot's `osv-key.json` when there is no key of its own), so whoever looks after this computer signs it (the
 * owner decided on 9 Nov that IT is never asked). The sheet itself is read from the managed folder, or from the data
 * folder when imported in Settings; unsigned, or with a signature that does not verify, it is not used at all. Nothing
 * is fetched.
 *
 * An apply's card then shows the monthly change its plan makes, as an interval, and lists the resources whose SKU the
 * sheet does not know as "not known".
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import type { IacChange, IacPlan } from "@gatehouse/policy"

export interface PriceItem {
  /** The resource type, as the plan names it (aws_db_instance, Microsoft.Compute/virtualMachines). */
  type: string
  sku: string
  /** A region, when the price differs by one; absent matches any. */
  region?: string
  low: number
  high: number
}

export interface PriceSheet {
  v: 1
  currency: string
  generated?: string
  items: PriceItem[]
}

export type SheetState = { state: "none" } | { state: "ok"; items: number; currency: string; generated?: string; from: "managed" | "imported" } | { state: "refused"; why: string }

/** Checks a sheet's bytes against its signature and key; the sheet when it verifies and reads, else why not. */
export function verifySheet(bytes: Buffer, sig: string | undefined, jwk: string | undefined): { sheet: PriceSheet } | { why: string } {
  if (sig === undefined) return { why: "it has no signature (prices.sig)" }
  if (jwk === undefined) return { why: "the key to check it with (prices-key.json or osv-key.json in the managed folder) is missing" }
  try {
    const key = crypto.createPublicKey({ key: JSON.parse(jwk) as crypto.JsonWebKey, format: "jwk" })
    const s = Buffer.from(sig.trim(), "base64")
    const ok = crypto.verify("sha256", bytes, { key, dsaEncoding: "ieee-p1363" }, s) || crypto.verify("sha256", bytes, { key, dsaEncoding: "der" }, s)
    if (!ok) return { why: "its signature does not verify, so it was changed or signed with another key" }
  } catch {
    return { why: "its signature or key could not be read" }
  }
  try {
    const v = JSON.parse(bytes.toString("utf8")) as Partial<PriceSheet>
    if (v.v !== 1 || typeof v.currency !== "string" || !Array.isArray(v.items)) return { why: "it is not a price sheet Codehouse reads (v 1, currency, items)" }
    const items = v.items.filter((i): i is PriceItem => !!i && typeof i.type === "string" && typeof i.sku === "string" && Number.isFinite(i.low) && Number.isFinite(i.high) && i.low >= 0 && i.high >= i.low)
    return { sheet: { v: 1, currency: v.currency.slice(0, 8), ...(typeof v.generated === "string" ? { generated: v.generated } : {}), items } }
  } catch {
    return { why: "it is not valid JSON" }
  }
}

const read = (p: string): string | undefined => {
  try {
    return fs.readFileSync(p, "utf8")
  } catch {
    return undefined
  }
}

export class PriceSheets {
  readonly #managed: string
  readonly #data: string
  #seen = ""
  #state: SheetState = { state: "none" }
  #sheet: PriceSheet | undefined

  constructor(managedDir: string, dataDir: string) {
    this.#managed = managedDir
    this.#data = dataDir
  }

  #key = () => read(path.join(this.#managed, "prices-key.json")) ?? read(path.join(this.#managed, "osv-key.json"))

  #load(): void {
    const where = fs.existsSync(path.join(this.#managed, "prices.json")) ? this.#managed : this.#data
    const files = [path.join(where, "prices.json"), path.join(where, "prices.sig"), path.join(this.#managed, "prices-key.json"), path.join(this.#managed, "osv-key.json")]
    const stamp = files.map((p) => {
      try {
        const s = fs.statSync(p)
        return `${s.size}:${s.mtimeMs}`
      } catch {
        return "-"
      }
    }).join("|")
    if (stamp === this.#seen) return
    this.#seen = stamp
    this.#sheet = undefined
    let bytes: Buffer
    try {
      bytes = fs.readFileSync(files[0]!)
    } catch {
      return void (this.#state = { state: "none" })
    }
    const r = verifySheet(bytes, read(files[1]!), this.#key())
    if ("why" in r) return void (this.#state = { state: "refused", why: r.why })
    this.#sheet = r.sheet
    this.#state = { state: "ok", items: r.sheet.items.length, currency: r.sheet.currency, ...(r.sheet.generated ? { generated: r.sheet.generated } : {}), from: where === this.#managed ? "managed" : "imported" }
  }

  status(): SheetState {
    this.#load()
    return this.#state
  }

  sheet(): PriceSheet | undefined {
    this.#load()
    return this.#sheet
  }

  /** Imports a sheet and its signature into the data folder, only when they verify against the managed key. */
  import(text: string, sig: string): SheetState {
    const r = verifySheet(Buffer.from(text, "utf8"), sig, this.#key())
    if ("why" in r) return { state: "refused", why: r.why }
    fs.mkdirSync(this.#data, { recursive: true })
    for (const [name, body] of [["prices.json", text], ["prices.sig", sig.trim()]] as const) {
      const p = path.join(this.#data, name)
      fs.writeFileSync(`${p}.tmp`, body)
      fs.renameSync(`${p}.tmp`, p)
    }
    return this.status()
  }
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

const SKU_KEYS = ["instance_class", "instanceClass", "instance_type", "instanceType", "node_type", "nodeType", "machine_type", "machineType", "vm_size", "vmSize", "size", "sku_name", "skuName", "tier"]

/** A resource's SKU and region from its settings, in any of the plans' namings. */
export function skuOf(settings: unknown): { sku?: string; region?: string } {
  const s = rec(settings)
  const props = rec(s.properties)
  const hw = rec(props.hardwareProfile)
  let sku: string | undefined
  for (const k of SKU_KEYS) if (typeof s[k] === "string" && s[k]) { sku = s[k] as string; break }
  sku ??= typeof rec(s.sku).name === "string" ? (rec(s.sku).name as string) : typeof s.sku === "string" ? s.sku : typeof hw.vmSize === "string" ? hw.vmSize : undefined
  const region = [s.region, s.location, s.availability_zone, s.availabilityZone].find((x): x is string => typeof x === "string" && !!x)
  // An availability zone (eu-west-2a) is priced as its region.
  return { ...(sku ? { sku } : {}), ...(region ? { region: region.toLowerCase().replace(/(\d)[a-z]$/, "$1") } : {}) }
}

export interface CostDelta {
  currency: string
  /** The monthly change, lowest and highest. */
  low: number
  high: number
  /** Resources with a SKU the sheet does not know, as "address (sku)". */
  unknown: string[]
}

function price(sheet: PriceSheet, type: string, s: { sku?: string; region?: string }): PriceItem | undefined | null {
  if (!s.sku) return null
  const same = sheet.items.filter((i) => i.type.toLowerCase() === type.toLowerCase() && i.sku.toLowerCase() === s.sku!.toLowerCase())
  return same.find((i) => i.region && s.region && i.region.toLowerCase() === s.region) ?? same.find((i) => !i.region)
}

/** The monthly change a plan makes, as an interval; undefined when nothing in it has a SKU. */
export function costDelta(plans: IacPlan[], sheet: PriceSheet): CostDelta | undefined {
  let low = 0
  let high = 0
  let counted = false
  const unknown: string[] = []
  const add = (c: IacChange, settings: unknown, sign: 1 | -1) => {
    const s = skuOf(settings)
    const p = price(sheet, c.type, s)
    if (p === null) return
    counted = true
    if (!p) return void unknown.push(`${c.address} (${s.sku})`)
    if (sign === 1) {
      low += p.low
      high += p.high
    } else {
      low -= p.high
      high -= p.low
    }
  }
  for (const plan of plans)
    for (const c of plan.changes) {
      if (c.action === "create") add(c, c.after, 1)
      else if (c.action === "delete") add(c, c.before, -1)
      else if (skuOf(c.before).sku !== skuOf(c.after).sku) {
        add(c, c.after, 1)
        add(c, c.before, -1)
      }
    }
  if (!counted) return undefined
  const round = (n: number) => Math.round(n * 100) / 100
  return { currency: sheet.currency, low: round(low), high: round(high), unknown: [...new Set(unknown)].slice(0, 20) }
}

/** Doctor's line: only when a sheet is there, as D-057's snapshot. */
export function priceSheetCheck(s: SheetState): import("./doctor.js").DoctorCheck | undefined {
  const base = { id: "price-sheet", label: "Price sheet" }
  if (s.state === "none") return undefined
  if (s.state === "refused")
    return { ...base, state: "fail", detail: `The price sheet is not used, because ${s.why}. Applies show no cost.`, fix: "Sign the sheet again with the key in the managed folder and put prices.sig beside it, or remove it." }
  return { ...base, state: "ok", detail: `${s.items} price(s) in ${s.currency}${s.generated ? `, made ${s.generated.slice(0, 10)}` : ""}, ${s.from === "managed" ? "from the managed folder" : "imported"}.` }
}
