/**
 * E-061, the environment promotion gate (Expansion E5). A project names its environments and the commands that promote
 * a change to them, in .codehouse/environments.yaml:
 *
 *   environments:
 *     - name: staging
 *       promote: npm run deploy:staging
 *       gates: [{ tests: verified }]
 *     - name: production
 *       production: true
 *       promote: npm run deploy:prod
 *       gates: [{ sealed: true }, { tests: verified }]
 *
 * The gates are E-048's. A command that promotes goes to a person unless every gate of its environment passes: a
 * failing gate (or none set, or one that cannot be read) escalates, Severe for production. A promotion to production
 * goes to a person even when its gates pass, at the Rules-based Extreme limit, so only Extreme max approval answers it
 * (owner, 14 and 15 Nov; the spec's "Extreme never approves" is kept for Rules-based Extreme). A file that cannot be
 * read fails closed: a command naming any promote line in it is treated as a production promotion with a failing gate.
 */
import fs from "node:fs"
import path from "node:path"
import { parseYaml } from "@gatehouse/policy"
import { evaluateGate, parseGate, type GateResult, type GateSources, type GateSpec } from "./gates.js"

export const PROMOTION_GATE_RULE = "promotion-gate"
export const PRODUCTION_PROMOTION_RULE = "production-promotion"

export interface Environment {
  name: string
  production: boolean
  promote: string
  gates: GateSpec[]
  /** Gates in the file that are not gates: the environment's gate cannot pass. */
  errors: string[]
}

export interface Environments {
  environments: Environment[]
  /** Why the file could not be read, when it could not. */
  error?: string
}

const squash = (s: string) => s.trim().replace(/\s+/g, " ")

export function readEnvironments(root: string): Environments {
  let text: string
  try {
    text = fs.readFileSync(path.join(root, ".codehouse", "environments.yaml"), "utf8")
  } catch {
    return { environments: [] }
  }
  try {
    const v = parseYaml(text) as { environments?: unknown }
    if (!Array.isArray(v?.environments)) throw new Error("it has no list of environments")
    return {
      environments: v.environments.map((e: Record<string, unknown>, n: number) => {
        if (typeof e?.promote !== "string" || !e.promote.trim()) throw new Error(`environment ${n + 1} has no promote command`)
        const parsed = (Array.isArray(e.gates) ? e.gates : e.gate === undefined ? [] : [e.gate]).map((g) => parseGate(g))
        return {
          name: typeof e.name === "string" && e.name.trim() ? e.name.trim() : `environment ${n + 1}`,
          production: e.production === true || /^(prod|production|prd|live)$/i.test(String(e.name ?? "")),
          promote: squash(e.promote),
          gates: parsed.filter((g): g is GateSpec => !("error" in g)),
          errors: parsed.flatMap((g) => ("error" in g ? [g.error] : [])),
        }
      }),
    }
  } catch (e) {
    // Fail closed: what looks like a promote line still counts, as a production promotion that cannot pass.
    const lines = [...text.matchAll(/^\s*-?\s*promote:\s*["']?(.+?)["']?\s*$/gm)].map((m) => squash(m[1]!))
    return {
      error: `.codehouse/environments.yaml could not be read: ${(e as Error).message}`,
      environments: lines.map((promote, n) => ({ name: `environment ${n + 1}`, production: true, promote, gates: [], errors: ["the environments file could not be read"] })),
    }
  }
}

/** The environment a command promotes to, when one of its parts runs a promote command. */
export function promotionFor(envs: Environment[], command: string): Environment | undefined {
  const parts = command.split(/&&|\|\||[;|\n]/).map(squash)
  return envs.find((e) => parts.some((p) => p === e.promote || p.startsWith(`${e.promote} `)))
}

export interface PromotionVerdict {
  ruleId: string
  risk: number
  reason: string
}

/** What a promotion's gates make of it; undefined when they let the rules decide. Every gate runs, and none is skipped. */
export async function judgePromotion(env: Environment, sources: GateSources): Promise<PromotionVerdict | undefined> {
  const results: GateResult[] = []
  for (const g of env.gates) results.push(await evaluateGate(g, sources).catch((e: Error) => ({ pass: false, reason: `the gate could not be read: ${e.message}` })))
  const failing = [...env.errors.map((reason) => ({ pass: false, reason })), ...results.filter((r) => !r.pass)]
  if (!env.gates.length && !env.errors.length) failing.push({ pass: false, reason: "no gate is set for it in .codehouse/environments.yaml" })
  if (failing.length)
    return {
      ruleId: PROMOTION_GATE_RULE,
      risk: env.production ? 90 : 70,
      reason: `A promotion to ${env.name}${env.production ? " (production)" : ""} whose gate does not pass: ${failing.map((f) => f.reason).join("; ")}.`,
    }
  if (env.production) return { ruleId: PRODUCTION_PROMOTION_RULE, risk: 80, reason: `A promotion to ${env.name} (production). Its gates pass, and a person still decides.` }
  return undefined
}
