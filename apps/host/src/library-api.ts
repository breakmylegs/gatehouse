import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { FastifyInstance, FastifyReply } from "fastify"
import { stringify as stringifyYaml } from "yaml"
import {
  checkUserRules,
  loadLibrary,
  loadPolicy,
  PolicyEngine,
  PolicyLoadError,
  readUserRules,
  replay,
  type Policy,
  type Rule,
  type UserRules,
} from "@gatehouse/policy"
import { writeFileAtomic } from "@gatehouse/shared/node"
import type { AdminContext } from "./api.js"
import { regressionGate, replayRecords } from "./api.js"

/**
 * The rule library: shipped packs you can switch on, the built-in rules you can switch off (allow and escalate only),
 * and rules of your own. Every save is checked by loading the whole policy first; a file that does not load is never
 * written, and the floor and deny rules can never be switched off.
 */

type Section = "floor" | "deny" | "escalate" | "allow"

/** The most asks one dry run checks. */
const MAX_TRY = 20

const bad = (reply: FastifyReply, status: number, error: string, extra: object = {}) =>
  reply
    .code(status)
    .header("cache-control", "no-store")
    .send({ error, ...extra })

function userRulesPath(ctx: AdminContext): string | undefined {
  return ctx.loadOptions.userRulesPath
}

/** Loads the policy as it would be with these rules of yours, without saving anything. */
function dryLoad(ctx: AdminContext, user: UserRules): { policy?: Policy; errors: string[] } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-user-rules-"))
  try {
    const file = path.join(dir, "rules.user.yaml")
    fs.writeFileSync(file, stringifyYaml(user))
    return { policy: loadPolicy({ ...ctx.loadOptions, userRulesPath: file }), errors: [] }
  } catch (e) {
    return { errors: e instanceof PolicyLoadError ? e.errors : [(e as Error).message] }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function parseBody(body: unknown): { user?: UserRules; errors: string[] } {
  const checked = checkUserRules(body)
  return checked.ok ? { user: checked.value, errors: [] } : { errors: checked.errors }
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex")

/** What changed between two versions of your rules, by name only, for the audit log. */
function changes(before: UserRules, after: UserRules): string[] {
  const out: string[] = []
  const diff = (added: string, removed: string, a: string[] = [], b: string[] = []) => {
    for (const x of b) if (!a.includes(x)) out.push(`${added}: ${x}`)
    for (const x of a) if (!b.includes(x)) out.push(`${removed}: ${x}`)
  }
  diff("pack on", "pack off", before.packs, after.packs)
  diff("switched off", "switched back on", before.disabled, after.disabled)
  const ids = (u: UserRules) =>
    [...(u.allow ?? []), ...(u.escalate ?? []), ...(u.deny ?? [])].map((r) => r.id)
  diff("your rule added or changed", "your rule removed", ids(before), ids(after))
  return out
}

export function registerLibraryRoutes(app: FastifyInstance, ctx: AdminContext): void {
  app.get("/api/library", async () => {
    const errors: string[] = []
    const packs = loadLibrary(ctx.loadOptions.libraryDir, errors)
    const user = readUserRules(userRulesPath(ctx), errors) ?? { version: 1 as const }
    const on = new Set(user.packs ?? [])
    const off = new Set(user.disabled ?? [])
    // The shipped rules on their own, so a built-in rule you switched off is still listed and can be switched back on.
    let base: Policy | undefined
    try {
      const { userRulesPath: _ignored, ...withoutYours } = ctx.loadOptions
      base = loadPolicy(withoutYours)
    } catch (e) {
      errors.push(...(e instanceof PolicyLoadError ? e.errors : [(e as Error).message]))
    }
    const baseRules: Array<{
      id: string
      section: Section
      rule: Rule
      off: boolean
      fixed: boolean
    }> = []
    for (const section of ["floor", "deny", "escalate", "allow"] as const)
      for (const rule of base?.rules[section] ?? [])
        baseRules.push({
          id: rule.id,
          section,
          rule,
          off: off.has(rule.id),
          fixed: section === "floor" || section === "deny",
        })
    return {
      path: userRulesPath(ctx) ?? null,
      errors,
      packs: packs.map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        on: on.has(p.id),
        rules: (["allow", "escalate", "deny"] as const).flatMap((section) =>
          (p[section] ?? []).map((rule) => ({ id: rule.id, section, rule, off: off.has(rule.id) })),
        ),
        cases: p.cases ?? [],
      })),
      base: baseRules,
      disabled: [...off],
      yours: { allow: user.allow ?? [], escalate: user.escalate ?? [], deny: user.deny ?? [] },
      user,
    }
  })

  /** Which past decisions these rules would change. Nothing is saved. */
  app.post("/api/library/preview", async (req, reply) => {
    const parsed = parseBody(req.body)
    if (!parsed.user)
      return bad(reply, 422, "Those rules are not valid.", { errors: parsed.errors })
    const cand = dryLoad(ctx, parsed.user)
    if (!cand.policy) return bad(reply, 422, "Those rules do not load.", { errors: cand.errors })
    const policy = cand.policy
    const engine = new PolicyEngine({
      getPolicy: () => policy,
      ...(ctx.pwsh ? { pwsh: ctx.pwsh } : {}),
    })
    const result = await replay(engine, replayRecords(ctx.auditDir))
    return { ...result, candidateHash: policy.hash }
  })

  /**
   * What these rules would do with a few asks (W1-17: the examples on each level card, and Try it against a level).
   * A dry run: nothing is saved and nothing is written to the audit log.
   */
  app.post("/api/library/try", async (req, reply) => {
    const b = req.body as { rules?: unknown; asks?: unknown } | null
    const asks = Array.isArray(b?.asks) ? (b.asks as unknown[]) : []
    const ok = (
      a: unknown,
    ): a is { toolName: string; input: Record<string, unknown>; cwd: string } => {
      const x = a as Record<string, unknown> | null
      return (
        typeof x === "object" &&
        x !== null &&
        typeof x.toolName === "string" &&
        x.toolName !== "" &&
        x.toolName.length <= 200 &&
        typeof x.input === "object" &&
        x.input !== null &&
        !Array.isArray(x.input) &&
        typeof x.cwd === "string" &&
        x.cwd !== ""
      )
    }
    if (asks.length === 0 || asks.length > MAX_TRY || !asks.every(ok))
      return bad(
        reply,
        400,
        `Send rules and one to ${MAX_TRY} asks, each with toolName, input and cwd.`,
      )
    const parsed = parseBody(b?.rules)
    if (!parsed.user)
      return bad(reply, 422, "Those rules are not valid.", { errors: parsed.errors })
    const cand = dryLoad(ctx, parsed.user)
    if (!cand.policy) return bad(reply, 422, "Those rules do not load.", { errors: cand.errors })
    const policy = cand.policy
    const engine = new PolicyEngine({
      getPolicy: () => policy,
      ...(ctx.pwsh ? { pwsh: ctx.pwsh } : {}),
    })
    const verdicts = []
    for (const a of asks)
      verdicts.push(await engine.evaluate({ toolName: a.toolName, input: a.input }, { cwd: a.cwd }))
    return { verdicts, candidateHash: policy.hash }
  })

  app.put("/api/library", async (req, reply) => {
    const file = userRulesPath(ctx)
    if (!file) return bad(reply, 409, "Your rules file is not set up on this Host.")
    const parsed = parseBody(req.body)
    if (!parsed.user)
      return bad(reply, 422, "Those rules are not valid, so nothing was saved.", {
        errors: parsed.errors,
      })
    const cand = dryLoad(ctx, parsed.user)
    if (!cand.policy)
      return bad(reply, 422, "Those rules do not load, so nothing was saved.", {
        errors: cand.errors,
      })
    const before = readUserRules(file, []) ?? { version: 1 as const }
    // D-026: the body is your rules alone, so the typed phrase comes as ?confirm=.
    const confirm = (req.query as Record<string, unknown> | undefined)?.confirm
    const text = stringifyYaml(parsed.user)
    const refused = await regressionGate(ctx, cand.policy, confirm, {
      from: sha256(stringifyYaml(before)),
      to: sha256(text),
    })
    if (refused) return bad(reply, 409, refused.error, { regression: refused.regression })
    fs.mkdirSync(path.dirname(file), { recursive: true })
    await writeFileAtomic(file, text)
    ctx.store.load()
    const changed = changes(before, parsed.user)
    const recorded = await ctx.audit.record({
      session: "desktop",
      event: "policy_library_changed",
      channel: "desktop",
      tool: "policy",
      input: { changed },
      verdict: {
        outcome: "allow",
        ruleId: "policy-library-changed",
        reason: "Your rules or packs were changed from the desktop.",
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: ctx.store.current?.hash ?? "",
      },
      latencyMs: 0,
    })
    return { ok: true, hash: ctx.store.current?.hash, changed, audited: recorded }
  })
}
