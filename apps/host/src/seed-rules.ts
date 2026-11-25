/**
 * The shipped rules arrive with each update (owner, 25 Nov: Ask about code asked to read its session, though a rule
 * allows that). policy/rules.yaml is Codehouse's own seed rules; nothing in Codehouse writes it (your remembered
 * decisions are rules.local.yaml and your own rules rules.user.yaml). But each update carried the old policy folder
 * over the new one (Updater.cs, CarryYourFiles), seed rules and all, so an install kept the rules it first had: one
 * installed on 2 Nov had none of the rules added since, read_session's among them.
 *
 * So the package keeps a copy of its seed rules where an update never carries the old folder's (app/policy-seed), and
 * at start the Host puts that copy in place when policy/rules.yaml differs from it. The file it replaces is kept beside
 * it (rules.yaml.kept-<date>), in case it was edited by hand, and the change is logged and audited. A rules file
 * named elsewhere (GATEHOUSE_RULES_PATH, or rulesPath in the settings) is yours and is never touched, nor is anything
 * when there is no seed copy (running from the source folder).
 */
import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "@gatehouse/shared/node"

export interface SeedResult {
  refreshed: boolean
  /** Where the replaced file was kept, when it was replaced. */
  kept?: string
}

export async function refreshSeedRules(o: { appRoot: string; rulesPath: string; now?: () => Date }): Promise<SeedResult> {
  const seed = path.join(o.appRoot, "policy-seed", "rules.yaml")
  const own = path.join(o.appRoot, "policy", "rules.yaml")
  if (path.resolve(o.rulesPath) !== path.resolve(own) || !fs.existsSync(seed)) return { refreshed: false }
  const shipped = fs.readFileSync(seed, "utf8")
  const current = fs.existsSync(own) ? fs.readFileSync(own, "utf8") : undefined
  if (current === shipped) return { refreshed: false }
  let kept: string | undefined
  if (current !== undefined) {
    const stamp = (o.now?.() ?? new Date()).toISOString().slice(0, 16).replace(/[-:T]/g, "")
    kept = `${own}.kept-${stamp}`
    await writeFileAtomic(kept, current)
  }
  await writeFileAtomic(own, shipped)
  return { refreshed: true, ...(kept ? { kept } : {}) }
}
