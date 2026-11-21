/**
 * D-020, explain why and what would change (Frontier build, Wave 4). Every decision expands to the stages it went
 * through and the rules each matched (the trace, built by PolicyEngine.explain), and the smallest change that would
 * alter it. Deterministic: the same call and rules give the same words. A floor decision says it cannot be changed and
 * offers nothing; a rule only IT can change says so.
 */
import type { Verdict } from "@gatehouse/shared"
import type { Policy } from "./types.js"

export interface TraceStep {
  stage: string
  result: string
  /** The rules this stage matched, by id. */
  rules?: string[]
}

export interface Explanation {
  verdict: Verdict
  trace: TraceStep[]
  /** True for a floor decision: nothing changes it, and no change is offered. */
  fixed: boolean
  /** The smallest change that would alter the outcome, in words; absent when fixed. */
  change?: string
}

/** The rule ids no rule of yours can switch off: Codehouse's own checks (not in any rules file). */
const NO_RULE = new Set(["no-rule", "unknown-tool"])

function rulesOf(trace: TraceStep[], stage: string): string[] {
  return trace.filter((t) => t.stage === stage).flatMap((t) => t.rules ?? [])
}

const list = (ids: string[]) => ids.join(", ")

/** Where a rule came from, for the words: yours, a pack, a shared pack, IT's or Codehouse's own. */
function sourceOf(policy: Policy, id: string): "it" | "rules" | "builtin" {
  if (policy.sources?.[id] === "managed") return "it"
  const all = [...policy.rules.deny, ...policy.rules.escalate, ...policy.rules.allow, ...policy.remember, ...Object.values(policy.overlays).flatMap((o) => [...(o.deny ?? []), ...(o.escalate ?? [])])]
  return all.some((r) => r.id === id) ? "rules" : "builtin"
}

/** The smallest change that would alter a decision, or that it cannot be changed. */
export function counterfactual(v: Verdict, trace: TraceStep[], policy: Policy): { fixed: boolean; change?: string } {
  if (v.decidedBy === "floor") return { fixed: true }
  const itOnly = (ids: string[]) => ids.filter((id) => sourceOf(policy, id) === "it")
  if (v.outcome === "deny") {
    const denied = rulesOf(trace, "Deny rules")
    const ids = denied.length ? denied : [v.ruleId]
    const it = itOnly(ids)
    if (it.length) return { fixed: false, change: `Only IT can change this: their policy's rule ${list(it)} denies it.` }
    if (ids.every((id) => sourceOf(policy, id) === "builtin"))
      return { fixed: false, change: `Change the call so ${list(ids)} no longer applies; it is Codehouse's own check, which no rule switches off.` }
    return { fixed: false, change: `Remove or narrow the deny rule${ids.length > 1 ? "s" : ""} ${list(ids)} and it would be judged by the rest.` }
  }
  if (v.outcome === "escalate") {
    // Every reason it asks must go for it to be allowed: the checks, the ask rules, and segments no rule allows.
    const causes = [
      ...new Set([
        ...rulesOf(trace, "Built-in checks"),
        ...rulesOf(trace, "Ask rules"),
        ...(v.segments ?? []).filter((s) => s.outcome === "escalate").map((s) => s.ruleId),
        v.ruleId,
      ]),
    ]
    const builtin = causes.filter((id) => !NO_RULE.has(id) && sourceOf(policy, id) === "builtin")
    const ask = causes.filter((id) => sourceOf(policy, id) === "rules")
    const it = itOnly(causes)
    const parts: string[] = []
    if (it.length) parts.push(`IT's rule ${list(it)} asks, which only IT can change`)
    if (builtin.length) parts.push(`the call no longer triggers ${list(builtin)} (Codehouse's own check${builtin.length > 1 ? "s" : ""})`)
    if (ask.length) parts.push(`the ask rule${ask.length > 1 ? "s" : ""} ${list(ask)} ${ask.length > 1 ? "were" : "was"} removed or narrowed`)
    if (causes.some((id) => NO_RULE.has(id))) parts.push("an allow rule covered it (or you remembered it when you allowed it)")
    if (it.length && parts.length === 1) return { fixed: false, change: `Only IT can change this: their policy's rule ${list(it)} asks.` }
    return { fixed: false, change: `It would be allowed without asking only if ${parts.join(", and ")}.` }
  }
  const allowed = rulesOf(trace, "Allow rules")
  const remembered = rulesOf(trace, "Remembered rules")
  if (remembered.includes(v.ruleId)) return { fixed: false, change: `Forget the remembered rule ${v.ruleId} and it would ask.` }
  const ids = allowed.length ? allowed : [v.ruleId]
  return { fixed: false, change: `Remove the allow rule${ids.length > 1 ? "s" : ""} ${list(ids)}, or add a deny or ask rule that matches it, and it would not be allowed without asking.` }
}
