import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { parse as parseYaml } from "yaml"
import { checkPack, checkUserRules } from "./schema.js"
import type { Rule, RulePack, RulesFile, UserRules } from "./types.js"

/**
 * The rule library. Packs are shipped files of extra rules, each doing nothing until it is switched on. Your own
 * rules file says which packs are on, which built-in allow or escalate rules are switched off, and holds rules you
 * wrote or copied. The floor and the deny rules can never be switched off: switching them off is a load error, so a
 * bad file can never loosen what is always blocked.
 */

/** Where a rule in the merged policy came from, for the Library page. */
export type RuleSource = "base" | `pack:${string}` | "yours" | `shared:${string}`

export function loadLibrary(dir: string | undefined, errors: string[]): RulePack[] {
  if (!dir || !fs.existsSync(dir)) return []
  const packs: RulePack[] = []
  for (const file of fs.readdirSync(dir).sort()) {
    if (!/\.ya?ml$/i.test(file)) continue
    try {
      const checked = checkPack(parseYaml(fs.readFileSync(path.join(dir, file), "utf8")))
      if (!checked.ok) {
        errors.push(...checked.errors.map((e) => `library ${file}: ${e}`))
        continue
      }
      const pack = checked.value
      for (const rule of [...(pack.allow ?? []), ...(pack.escalate ?? []), ...(pack.deny ?? [])]) {
        if (!rule.id.startsWith(`${pack.id}-`))
          errors.push(`library ${file}: rule ${rule.id} must start with "${pack.id}-"`)
      }
      if (packs.some((p) => p.id === pack.id)) errors.push(`library ${file}: pack ${pack.id} is listed twice`)
      packs.push(pack)
    } catch (e) {
      errors.push(`library ${file}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return packs
}

/**
 * C-055: signed shared rule packs, such as a team's, in a folder of their own. Each <pack>.yaml needs <pack>.yaml.sig,
 * an Ed25519 signature by one of the keys you trust (Settings); one without, or signed by another key, is a load
 * error, so the policy stays as it was. A pack's rules are on once it is there: its deny and escalate rules always
 * apply, and its allow rules only where IT's managed policy does not forbid them (the loader decides that).
 */
export function loadSharedPacks(dir: string | undefined, trustedKeys: readonly string[], errors: string[]): RulePack[] {
  if (!dir || !fs.existsSync(dir)) return []
  const files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/i.test(f)).sort()
  if (!files.length) return []
  const keys: crypto.KeyObject[] = []
  for (const pem of trustedKeys) {
    try {
      const k = crypto.createPublicKey(pem)
      if (k.asymmetricKeyType === "ed25519") keys.push(k)
      else errors.push("shared packs: a trusted key is not an Ed25519 public key")
    } catch {
      errors.push("shared packs: a trusted key could not be read")
    }
  }
  const packs: RulePack[] = []
  for (const file of files) {
    try {
      const data = fs.readFileSync(path.join(dir, file))
      const sigFile = path.join(dir, `${file}.sig`)
      if (!fs.existsSync(sigFile)) {
        errors.push(`shared pack ${file}: it is not signed (${file}.sig)`)
        continue
      }
      const sig = Buffer.from(fs.readFileSync(sigFile, "utf8").trim(), "base64")
      if (!keys.some((k) => crypto.verify(null, data, k, sig))) {
        errors.push(`shared pack ${file}: it is not signed by a key you trust, or it was changed after it was signed`)
        continue
      }
      const checked = checkPack(parseYaml(data.toString("utf8")))
      if (!checked.ok) {
        errors.push(...checked.errors.map((e) => `shared pack ${file}: ${e}`))
        continue
      }
      const pack = checked.value
      for (const rule of [...(pack.allow ?? []), ...(pack.escalate ?? []), ...(pack.deny ?? [])])
        if (!rule.id.startsWith(`${pack.id}-`)) errors.push(`shared pack ${file}: rule ${rule.id} must start with "${pack.id}-"`)
      if (packs.some((p) => p.id === pack.id)) errors.push(`shared pack ${file}: pack ${pack.id} is there twice`)
      packs.push(pack)
    } catch (e) {
      errors.push(`shared pack ${file}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return packs
}

export function readUserRules(file: string | undefined, errors: string[]): UserRules | undefined {
  if (!file || !fs.existsSync(file)) return undefined
  try {
    const checked = checkUserRules(parseYaml(fs.readFileSync(file, "utf8")))
    if (checked.ok) return checked.value
    errors.push(...checked.errors.map((e) => `${path.basename(file)}: ${e}`))
  } catch (e) {
    errors.push(`${path.basename(file)}: ${e instanceof Error ? e.message : String(e)}`)
  }
  return undefined
}

/**
 * Base rules, then switched-on packs, then your rules. Switched-off rules are dropped from allow and escalate only.
 * Your own rules must have ids starting "my-" so they never collide with shipped ones.
 */
export function mergeRules(
  base: RulesFile,
  packs: RulePack[],
  user: UserRules | undefined,
  errors: string[],
): { rules: RulesFile; sources: Record<string, RuleSource> } {
  const sources: Record<string, RuleSource> = {}
  for (const section of ["floor", "deny", "escalate", "allow"] as const)
    for (const r of base[section]) sources[r.id] = "base"
  if (!user) return { rules: base, sources }

  const byId = new Map(packs.map((p) => [p.id, p]))
  const on: RulePack[] = []
  for (const id of user.packs ?? []) {
    const pack = byId.get(id)
    if (pack) on.push(pack)
    else errors.push(`rules.user.yaml: there is no pack called ${id}`)
  }

  const fixed = new Set([...base.floor, ...base.deny, ...on.flatMap((p) => p.deny ?? [])].map((r) => r.id))
  const switchable = new Set(
    [...base.allow, ...base.escalate, ...on.flatMap((p) => [...(p.allow ?? []), ...(p.escalate ?? [])])].map(
      (r) => r.id,
    ),
  )
  const off = new Set<string>()
  for (const pack of on)
    for (const id of pack.turnsOff ?? []) {
      if (fixed.has(id))
        errors.push(`library pack ${pack.id}: ${id} is a floor or deny rule and cannot be switched off`)
      else if (switchable.has(id)) off.add(id)
    }
  for (const id of user.disabled ?? []) {
    if (fixed.has(id)) errors.push(`rules.user.yaml: ${id} is a floor or deny rule and cannot be switched off`)
    else if (!switchable.has(id)) errors.push(`rules.user.yaml: there is no allow or escalate rule called ${id}`)
    else off.add(id)
  }

  const mine = (rules: Rule[] | undefined): Rule[] => {
    for (const r of rules ?? []) {
      if (!r.id.startsWith("my-")) errors.push(`rules.user.yaml: your rule ${r.id} must have an id starting "my-"`)
      sources[r.id] = "yours"
    }
    return rules ?? []
  }
  const fromPacks = (section: "allow" | "escalate" | "deny"): Rule[] =>
    on.flatMap((p) =>
      (p[section] ?? []).map((r) => {
        sources[r.id] = `pack:${p.id}`
        return r
      }),
    )

  const rules: RulesFile = {
    ...base,
    deny: [...base.deny, ...fromPacks("deny"), ...mine(user.deny)],
    escalate: [...base.escalate, ...fromPacks("escalate")].filter((r) => !off.has(r.id)).concat(mine(user.escalate)),
    allow: [...base.allow, ...fromPacks("allow")].filter((r) => !off.has(r.id)).concat(mine(user.allow)),
  }
  return { rules, sources }
}
