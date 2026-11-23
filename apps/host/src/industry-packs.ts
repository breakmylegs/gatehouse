/**
 * E-092, signed industry packs (Expansion E5, the safe variant). Draft packs of rules and checklist items for contact
 * centres (payment descoping, call recording redaction), telecoms, energy (vulnerable customers) and banking (consumer
 * protection) ship in policy/industry, marked as drafts for legal and subject experts to sign off.
 *
 * A pack can only add: its rules are escalate and deny rules (an allow rule, or anything that removes or disables a
 * rule or a checklist item, refuses the pack), and an installed pack can only be replaced by one that keeps every rule
 * and checklist item it had. A pack is installable only once signed after your review: "Sign after review" signs its
 * rules and checklist with this computer's key (C-055's and D-080's), recording who reviewed it and when, and installing
 * checks both signatures against the keys you trust (Settings, the same list as for shared rule packs). Its rules then
 * load as a signed shared rule pack, checked again by the policy loader each time it loads.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { parse as parseYaml, stringify as toYaml } from "yaml"
import { checkPack, type RulePack } from "@gatehouse/policy"
import { writeFileAtomic } from "@gatehouse/shared/node"

export interface ChecklistItem {
  id: string
  text: string
}

export interface IndustryPack {
  v: 1
  kind: "codehouse-industry-pack"
  id: string
  industry: string
  title: string
  status?: string
  rules: RulePack
  checklist: ChecklistItem[]
}

/** Keys that would take something away, anywhere in a pack. */
const REMOVING = /^(remove|removes|removeAllow|removeRule|removeRules|disable|disables|disabled|delete|override|overrides|replace|replaces|removeChecklist)$/i

function removingKeys(v: unknown, at = ""): string[] {
  if (!v || typeof v !== "object") return []
  return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => [...(REMOVING.test(k) ? [`${at}${k}`] : []), ...removingKeys(x, `${at}${k}.`)])
}

/** A pack, checked: only adding, its rules a valid rule pack named after it. */
export function checkIndustryPack(data: unknown): { ok: true; pack: IndustryPack } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const p = data as Partial<IndustryPack> | undefined
  if (!p || typeof p !== "object" || p.kind !== "codehouse-industry-pack" || p.v !== 1) return { ok: false, errors: ["it is not a Codehouse industry pack (kind codehouse-industry-pack, v 1)"] }
  if (typeof p.id !== "string" || !/^ind-[a-z0-9-]+$/.test(p.id)) errors.push("its id must start with ind- and use lower case letters, numbers and dashes")
  for (const k of removingKeys(p)) errors.push(`it would take something away (${k}): a pack can only add rules and checklist items`)
  const rules = checkPack(p.rules)
  if (!rules.ok) errors.push(...rules.errors.map((e) => `rules: ${e}`))
  else {
    if (rules.value.id !== p.id) errors.push(`its rules' id must be ${p.id}`)
    if (rules.value.allow?.length) errors.push("it has allow rules: an industry pack can only add caution (escalate and deny rules)")
    for (const r of [...(rules.value.escalate ?? []), ...(rules.value.deny ?? [])]) if (!r.id.startsWith(`${p.id}-`)) errors.push(`rule ${r.id} must start with "${p.id}-"`)
    if (!(rules.value.escalate?.length || rules.value.deny?.length)) errors.push("it has no rules")
  }
  if (!Array.isArray(p.checklist) || p.checklist.some((c) => !c || typeof c.id !== "string" || typeof c.text !== "string" || !c.text.trim())) errors.push("its checklist must be a list of items, each with an id and text")
  else if (new Set(p.checklist.map((c) => c.id)).size !== p.checklist.length) errors.push("two checklist items share an id")
  return errors.length ? { ok: false, errors } : { ok: true, pack: { ...(p as IndustryPack), rules: (rules as { value: RulePack }).value } }
}

/** The draft packs that ship with Codehouse. */
export function draftPacks(dir: string): Array<{ file: string; pack?: IndustryPack; errors?: string[] }> {
  let files: string[] = []
  try {
    files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/i.test(f)).sort()
  } catch {
    return []
  }
  return files.map((file) => {
    try {
      const c = checkIndustryPack(parseYaml(fs.readFileSync(path.join(dir, file), "utf8")))
      return c.ok ? { file, pack: c.pack } : { file, errors: c.errors }
    } catch (e) {
      return { file, errors: [(e as Error).message] }
    }
  })
}

/** What signing writes and installing reads: the rules as a rule pack, the checklist, and their signatures. */
export interface SignedIndustryPack {
  id: string
  rulesYaml: string
  rulesSig: string
  checklistJson: string
  checklistSig: string
  review: { by: string; note: string; at: string; publicKey: string }
}

/** Signs a pack after your review: the bytes of its rules and of its checklist, each with this computer's key. */
export async function signIndustryPack(pack: IndustryPack, review: { by: string; note: string }, sign: (b: Buffer) => Promise<{ signature: string; publicKey: string }>, now = new Date()): Promise<SignedIndustryPack> {
  const c = checkIndustryPack(pack)
  if (!c.ok) throw new Error(`The pack cannot be signed: ${c.errors.join("; ")}`)
  if (!review.by.trim() || !review.note.trim()) throw new Error("Say who reviewed the pack and what was checked before signing it.")
  const rulesYaml = toYaml(c.pack.rules)
  const checklistJson = JSON.stringify(c.pack.checklist, null, 2) + "\n"
  const r = await sign(Buffer.from(rulesYaml, "utf8"))
  const k = await sign(Buffer.from(checklistJson, "utf8"))
  return { id: c.pack.id, rulesYaml, rulesSig: r.signature, checklistJson, checklistSig: k.signature, review: { by: review.by.trim(), note: review.note.trim(), at: now.toISOString(), publicKey: r.publicKey } }
}

const verifies = (data: string, sig: string, keys: readonly string[]) =>
  keys.some((pem) => {
    try {
      const k = crypto.createPublicKey(pem)
      return k.asymmetricKeyType === "ed25519" && crypto.verify(null, Buffer.from(data, "utf8"), k, Buffer.from(sig, "base64"))
    } catch {
      return false
    }
  })

/**
 * Installs a signed pack: its rules into the shared rule packs folder (C-055), its checklist beside them. Refused when
 * either part is unsigned or not signed by a key you trust, when it is not a pack that only adds, and when it would
 * drop a rule or checklist item the installed pack has.
 */
export async function installIndustryPack(s: Partial<SignedIndustryPack> | undefined, o: { trustedKeys: readonly string[]; packsDir: string; checklistDir: string }): Promise<{ id: string; rules: number; checklist: number }> {
  if (!s || typeof s.rulesYaml !== "string" || typeof s.checklistJson !== "string" || !s.rulesSig || !s.checklistSig) throw new Error("The pack is not signed: review it and sign it before it can be installed.")
  if (!verifies(s.rulesYaml, s.rulesSig, o.trustedKeys) || !verifies(s.checklistJson, s.checklistSig, o.trustedKeys))
    throw new Error("The pack is not signed by a key you trust, or it was changed after it was signed. Trust the signing key in Settings first.")
  const rules = checkPack(parseYaml(s.rulesYaml))
  if (!rules.ok) throw new Error(`The pack's rules are not valid: ${rules.errors.join("; ")}`)
  const checklist = JSON.parse(s.checklistJson) as ChecklistItem[]
  const c = checkIndustryPack({ v: 1, kind: "codehouse-industry-pack", id: rules.value.id, industry: "", title: "", rules: rules.value, checklist })
  if (!c.ok) throw new Error(`The pack cannot be installed: ${c.errors.join("; ")}`)
  const id = rules.value.id
  // An update keeps everything the installed pack has: a pack can only add.
  const ruleFile = path.join(o.packsDir, `${id}.yaml`)
  const listFile = path.join(o.checklistDir, `${id}.json`)
  if (fs.existsSync(ruleFile)) {
    const before = checkPack(parseYaml(fs.readFileSync(ruleFile, "utf8")))
    const now = new Set([...(rules.value.escalate ?? []), ...(rules.value.deny ?? [])].map((r) => r.id))
    const lost = before.ok ? [...(before.value.escalate ?? []), ...(before.value.deny ?? [])].map((r) => r.id).filter((x) => !now.has(x)) : []
    // A deny rule turned into an escalate rule is a loosening too.
    const denyNow = new Set((rules.value.deny ?? []).map((r) => r.id))
    const softened = before.ok ? (before.value.deny ?? []).map((r) => r.id).filter((x) => now.has(x) && !denyNow.has(x)) : []
    if (lost.length || softened.length) throw new Error(`The new version would remove or soften rules the installed pack has (${[...lost, ...softened].join(", ")}): a pack can only add.`)
  }
  if (fs.existsSync(listFile)) {
    let had: ChecklistItem[] = []
    try {
      had = JSON.parse(fs.readFileSync(listFile, "utf8")) as ChecklistItem[]
    } catch {
      had = []
    }
    const now = new Set(checklist.map((x) => x.id))
    const lost = had.map((x) => x.id).filter((x) => !now.has(x))
    if (lost.length) throw new Error(`The new version would remove checklist items the installed pack has (${lost.join(", ")}): a pack can only add.`)
  }
  fs.mkdirSync(o.packsDir, { recursive: true })
  fs.mkdirSync(o.checklistDir, { recursive: true })
  await writeFileAtomic(ruleFile, s.rulesYaml)
  await writeFileAtomic(`${ruleFile}.sig`, s.rulesSig)
  await writeFileAtomic(listFile, s.checklistJson)
  await writeFileAtomic(`${listFile}.sig`, s.checklistSig)
  return { id, rules: ruleCount(rules.value), checklist: checklist.length }
}

const ruleCount = (r: RulePack) => (r.escalate?.length ?? 0) + (r.deny?.length ?? 0)
