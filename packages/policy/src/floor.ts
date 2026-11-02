import type { Features } from "./analyse.js"
import { compileGlobs, matchAnyWildcard } from "./match.js"
import { lexicalResolve } from "./paths.js"
import type { EvalContext, Rule } from "./types.js"

/**
 * A floor hit can only be a denial. There is deliberately no "allow" member, so the floor
 * cannot grant anything (invariant 2).
 */
export interface FloorHit {
  readonly outcome: "deny"
  readonly ruleId: string
  readonly reason: string
}

function toolApplies(rule: Rule, tool: string): boolean {
  if (!rule.tools) return true
  return matchAnyWildcard(rule.tools, tool, false)
}

/** Keys of every word and target of the call, resolved without touching the file system. */
function candidateKeys(f: Features, ctx: EvalContext): string[] {
  const keys = new Set<string>()
  for (const t of f.targets) keys.add(t.key)
  for (const token of f.scanTokens) {
    const value = token.value
    if (value === "") continue
    const variants = [value]
    const opt = /^-{1,2}[A-Za-z][\w-]*[=:](.+)$/s.exec(value)
    if (opt?.[1]) variants.push(opt[1])
    for (const v of variants) keys.add(lexicalResolve(v, ctx.cwd).key)
  }
  return [...keys]
}

export function checkFloor(f: Features, ctx: EvalContext, rules: readonly Rule[]): FloorHit | null {
  let keys: string[] | undefined
  for (const rule of rules) {
    if (!toolApplies(rule, f.tool)) continue
    if (rule.pathGlobs) {
      keys ??= candidateKeys(f, ctx)
      const matches = compileGlobs(rule.pathGlobs)
      if (keys.some((k) => matches(k))) {
        return {
          outcome: "deny",
          ruleId: rule.id,
          reason: rule.message ?? `Blocked by floor rule ${rule.id}.`,
        }
      }
    }
    if (rule.powershell) {
      const p = rule.powershell
      if (
        (p.encodedCommand && f.flags.encodedCommand) ||
        (p.invokeExpression && f.flags.invokeExpression) ||
        (p.dynamicInvocation && f.flags.dynamicInvocation)
      ) {
        return {
          outcome: "deny",
          ruleId: rule.id,
          reason: rule.message ?? "Obfuscated or dynamic PowerShell is blocked by policy.",
        }
      }
    }
    if (rule.bash) {
      const b = rule.bash
      if ((b.evalDynamic && f.flags.evalDynamic) || (b.pipeToShell && f.flags.pipeToShell)) {
        return {
          outcome: "deny",
          ruleId: rule.id,
          reason: rule.message ?? "Dynamic eval or piping into a shell is blocked by policy.",
        }
      }
    }
  }
  return null
}
