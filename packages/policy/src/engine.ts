import path from "node:path"
import type { Outcome, Verdict } from "@gatehouse/shared"
import { analyse, BUILTIN_KNOWN_TOOLS, type Features } from "./analyse.js"
import { checkFloor } from "./floor.js"
import { compileGlobs, matchAnyWildcard } from "./match.js"
import { findProjectRoot, isInside, realKey, relativeTo, type ResolvedPath } from "./paths.js"
import type { PwshWorker } from "./pwsh.js"
import { unwrapVariants, type Segment } from "./segments.js"
import type { EvalContext, Policy, Rule, ToolCall } from "./types.js"

interface Candidate {
  ruleId: string
  reason: string
  risk: number
}

const BUILTIN = {
  parseError: { ruleId: "parse-error", reason: "The command could not be parsed safely.", risk: 50 },
  unavailable: {
    ruleId: "pwsh-unavailable",
    reason: "The PowerShell parser is not available, so the command cannot be checked.",
    risk: 50,
  },
  malformed: { ruleId: "malformed-input", reason: "The tool input is missing a field the policy needs.", risk: 50 },
  heredoc: { ruleId: "bash-heredoc", reason: "A heredoc hides text from the rules.", risk: 60 },
  evalStatic: { ruleId: "bash-eval", reason: "eval runs text the rules cannot see.", risk: 80 },
  dynamic: {
    ruleId: "dynamic-segment",
    reason: "The command uses a variable or substitution, so what runs is not known in advance.",
    risk: 55,
  },
  redirect: { ruleId: "shell-redirect-write", reason: "The command writes to a file by redirection.", risk: 60 },
  startProcess: { ruleId: "pwsh-start-process", reason: "Start-Process launches another program.", risk: 85 },
  scriptBlock: { ruleId: "pwsh-scriptblock-create", reason: "A script block is built from text at run time.", risk: 85 },
  addType: { ruleId: "pwsh-add-type", reason: "Add-Type compiles and loads code.", risk: 85 },
  download: { ruleId: "pwsh-download-string", reason: "The script downloads content directly.", risk: 85 },
  registry: { ruleId: "pwsh-registry-write", reason: "The command changes the registry.", risk: 85 },
  execPolicy: { ruleId: "pwsh-execution-policy", reason: "Set-ExecutionPolicy weakens script controls.", risk: 85 },
  noRule: { ruleId: "no-rule", reason: "No rule allows this call, so it needs your approval.", risk: 50 },
  unknownTool: { ruleId: "unknown-tool", reason: "This tool is not covered by the policy.", risk: 50 },
  engineError: { ruleId: "engine-error", reason: "The policy engine failed, so the call needs your approval.", risk: 50 },
  noPolicy: { ruleId: "policy-unavailable", reason: "No valid policy is loaded.", risk: 50 },
} as const

interface Effective {
  deny: Rule[]
  escalate: Rule[]
  allow: Rule[]
  all: Rule[]
}

type Mode = "any" | "every"

interface RuleMatch {
  call: boolean
  segs: Set<number>
}

export interface EngineOptions {
  getPolicy: () => Policy | undefined
  pwsh?: PwshWorker
}

function sameText(a: string, b: string, ci: boolean): boolean {
  return ci ? a.toLowerCase() === b.toLowerCase() : a === b
}

export class PolicyEngine {
  readonly #getPolicy: () => Policy | undefined
  readonly #pwsh: PwshWorker | undefined
  readonly #effectiveCache = new Map<string, Effective>()

  constructor(opts: EngineOptions) {
    this.#getPolicy = opts.getPolicy
    this.#pwsh = opts.pwsh
  }

  async evaluate(call: ToolCall, ctx: EvalContext): Promise<Verdict> {
    let policyHash = "none"
    try {
      const policy = this.#getPolicy()
      if (!policy) return this.#verdict("escalate", BUILTIN.noPolicy, policyHash, "rules")
      policyHash = policy.hash
      return await this.#evaluate(call, ctx, policy)
    } catch {
      // Invariant 1: any failure escalates. It never allows and never throws.
      return this.#verdict("escalate", BUILTIN.engineError, policyHash, "rules")
    }
  }

  #verdict(
    outcome: Outcome,
    c: Candidate,
    policyHash: string,
    decidedBy: "floor" | "rules",
    segments?: Verdict["segments"],
  ): Verdict {
    const risk = outcome === "deny" ? 100 : outcome === "allow" ? Math.min(c.risk, 20) : c.risk
    const verdict: Verdict = { outcome, ruleId: c.ruleId, reason: c.reason, risk, decidedBy, policyHash }
    if (segments && segments.length > 0) verdict.segments = segments
    return verdict
  }

  #effective(policy: Policy, project: string): Effective {
    const key = `${policy.hash}:${project}`
    const hit = this.#effectiveCache.get(key)
    if (hit) return hit
    const overlay = policy.overlays[project]
    const removed = new Set(overlay?.removeAllow ?? [])
    const eff: Effective = {
      deny: [...policy.rules.deny, ...(overlay?.deny ?? [])],
      escalate: [...policy.rules.escalate, ...(overlay?.escalate ?? [])],
      allow: policy.rules.allow.filter((r) => !removed.has(r.id)),
      all: [],
    }
    eff.all = [...policy.rules.floor, ...eff.deny, ...eff.escalate, ...eff.allow]
    if (this.#effectiveCache.size > 64) this.#effectiveCache.clear()
    this.#effectiveCache.set(key, eff)
    return eff
  }

  async #evaluate(call: ToolCall, ctx: EvalContext, policy: Policy): Promise<Verdict> {
    const rootKeyPath = ctx.projectRoot ?? findProjectRoot(ctx.cwd)
    const projectName = path.basename(rootKeyPath).toLowerCase()
    const rootKey = realKey(rootKeyPath)
    const eff = this.#effective(policy, projectName)
    const f = await analyse(call, ctx, { pwsh: this.#pwsh })
    const hash = policy.hash

    const floor = checkFloor(f, ctx, policy.rules.floor)
    if (floor) return this.#verdict("deny", { ...floor, risk: 100 }, hash, "floor")
    if (f.malformed) return this.#verdict("escalate", BUILTIN.malformed, hash, "rules")

    const env: MatchEnv = { f, policy, rootKey, mcpSource: ctx.mcpSource }

    // Deny rules, per call and per segment. Deny wins.
    const segDeny = new Map<number, Candidate>()
    let callDeny: Candidate | undefined
    for (const rule of eff.deny) {
      const m = matchRule(rule, env, "any", true)
      if (!m) continue
      const cand = denyCandidate(rule)
      if (m.call) callDeny ??= cand
      for (const i of m.segs) if (!segDeny.has(i)) segDeny.set(i, cand)
    }
    if (callDeny) return this.#verdict("deny", callDeny, hash, "rules", segmentVerdicts(f, segDeny, new Map()))
    const firstSegDeny = [...segDeny.values()][0]
    if (firstSegDeny) return this.#verdict("deny", firstSegDeny, hash, "rules", segmentVerdicts(f, segDeny, new Map()))

    if (f.parseError) return this.#verdict("escalate", BUILTIN.parseError, hash, "rules")
    if (f.unavailable) return this.#verdict("escalate", BUILTIN.unavailable, hash, "rules")

    // Remember rules sit after floor and deny, before escalate.
    const segRemembered = new Map<number, string>()
    let callRemembered: string | undefined
    for (const rule of policy.remember) {
      const m = matchRemember(rule, env)
      if (!m) continue
      if (m.call) callRemembered ??= rule.id
      for (const i of m.segs) if (!segRemembered.has(i)) segRemembered.set(i, rule.id)
    }

    const escalations: Candidate[] = []
    const segEscalate = new Map<number, Candidate>()
    const fl = f.flags
    if (fl.heredoc) escalations.push(BUILTIN.heredoc)
    if (fl.evalStatic) escalations.push(BUILTIN.evalStatic)
    if (fl.startProcess) escalations.push(BUILTIN.startProcess)
    if (fl.scriptBlockCreate) escalations.push(BUILTIN.scriptBlock)
    if (fl.addType) escalations.push(BUILTIN.addType)
    if (fl.downloadString) escalations.push(BUILTIN.download)
    if (fl.registryWrite) escalations.push(BUILTIN.registry)
    if (fl.executionPolicy) escalations.push(BUILTIN.execPolicy)
    // Flags the floor did not choose to deny still escalate.
    if (fl.encodedCommand || fl.invokeExpression || fl.dynamicInvocation || fl.evalDynamic || fl.pipeToShell) {
      escalations.push({
        ruleId: "shell-obfuscation",
        reason: "The command uses an encoded, dynamic or piped-to-shell form.",
        risk: 90,
      })
    }

    for (const rule of eff.escalate) {
      const m = matchRule(rule, env, "any", false)
      if (!m) continue
      const cand: Candidate = {
        ruleId: rule.id,
        reason: rule.message ?? `Needs your approval (rule ${rule.id}).`,
        risk: rule.risk ?? 50,
      }
      if (m.call && callRemembered === undefined) escalations.push(cand)
      for (const i of m.segs) {
        if (segRemembered.has(i)) continue
        const prev = segEscalate.get(i)
        if (!prev || cand.risk > prev.risk) segEscalate.set(i, cand)
      }
    }
    f.segments.forEach((seg, i) => {
      if (segRemembered.has(i)) return
      if (seg.dynamic) bump(segEscalate, i, BUILTIN.dynamic)
      if (seg.writes) bump(segEscalate, i, BUILTIN.redirect)
    })

    // Allow rules.
    let callAllow: Rule | undefined
    const segAllow = new Map<number, Rule>()
    for (const rule of eff.allow) {
      const m = matchRule(rule, env, "every", false)
      if (!m) continue
      if (m.call) callAllow ??= rule
      for (const i of m.segs) if (!segAllow.has(i)) segAllow.set(i, rule)
    }

    const segOutcomes = new Map<number, { ruleId: string; outcome: Outcome }>()
    f.segments.forEach((_seg, i) => {
      const esc = segEscalate.get(i)
      if (esc) segOutcomes.set(i, { ruleId: esc.ruleId, outcome: "escalate" })
      else if (segRemembered.has(i)) {
        segOutcomes.set(i, { ruleId: segRemembered.get(i) ?? "remembered", outcome: "allow" })
      }
      else if (segAllow.has(i)) segOutcomes.set(i, { ruleId: segAllow.get(i)?.id ?? "allow", outcome: "allow" })
      else if (callAllow) segOutcomes.set(i, { ruleId: callAllow.id, outcome: "allow" })
      else segOutcomes.set(i, { ruleId: BUILTIN.noRule.ruleId, outcome: "escalate" })
    })
    const segments = segmentVerdicts(f, new Map(), segOutcomes)

    const all = [...escalations, ...segEscalate.values()]
    if (all.length > 0) {
      const top = all.reduce((a, b) => (b.risk > a.risk ? b : a))
      return this.#verdict("escalate", top, hash, "rules", segments)
    }

    if (f.isShell && f.segments.length > 0) {
      const uncovered = f.segments.findIndex((_s, i) => segOutcomes.get(i)?.outcome !== "allow")
      if (uncovered < 0) {
        const first = segOutcomes.get(0)
        const c: Candidate = {
          ruleId: first?.ruleId ?? "allow",
          reason: `Allowed by rule ${first?.ruleId ?? "allow"}.`,
          risk: 0,
        }
        return this.#verdict("allow", c, hash, "rules", segments)
      }
      return this.#verdict("escalate", BUILTIN.noRule, hash, "rules", segments)
    }

    if (callAllow) {
      return this.#verdict(
        "allow",
        { ruleId: callAllow.id, reason: `Allowed by rule ${callAllow.id}.`, risk: callAllow.risk ?? 0 },
        hash,
        "rules",
      )
    }
    if (callRemembered !== undefined) {
      return this.#verdict(
        "allow",
        { ruleId: callRemembered, reason: "Allowed by a remembered rule.", risk: 0 },
        hash,
        "rules",
      )
    }
    const known = BUILTIN_KNOWN_TOOLS.has(f.tool) || eff.all.some((r) => r.tools && matchAnyWildcard(r.tools, f.tool, false))
    return this.#verdict("escalate", known ? BUILTIN.noRule : BUILTIN.unknownTool, hash, "rules", segments)
  }
}

function bump(map: Map<number, Candidate>, i: number, cand: Candidate): void {
  const prev = map.get(i)
  if (!prev || cand.risk > prev.risk) map.set(i, cand)
}

function denyCandidate(rule: Rule): Candidate {
  return { ruleId: rule.id, reason: rule.message ?? `Denied by rule ${rule.id}.`, risk: 100 }
}

function segmentVerdicts(
  f: Features,
  deny: Map<number, Candidate>,
  others: Map<number, { ruleId: string; outcome: Outcome }>,
): Verdict["segments"] {
  if (!f.isShell) return undefined
  return f.segments.map((seg, i) => {
    const d = deny.get(i)
    if (d) return { text: seg.text, ruleId: d.ruleId, outcome: "deny" as const }
    const o = others.get(i)
    return { text: seg.text, ruleId: o?.ruleId ?? "unevaluated", outcome: o?.outcome ?? ("escalate" as const) }
  })
}

interface MatchEnv {
  f: Features
  policy: Policy
  rootKey: string
  mcpSource: string | undefined
}

function segmentMatches(rule: Rule, seg: Segment, withWrappers: boolean): boolean {
  const patterns = rule.commands ?? []
  const ci = seg.kind === "pwsh"
  const texts = withWrappers ? [seg.text, ...unwrapVariants(seg)] : [seg.text]
  return texts.some((t) => matchAnyWildcard(patterns, t, ci))
}

function targetOk(rule: Rule, t: ResolvedPath, env: MatchEnv, mode: Mode): boolean {
  const roots = env.policy.workspaceRootKeys
  const inside = !t.unc && !t.device && roots.some((r) => isInside(t.key, r))
  if (rule.pathInside && !inside) return false
  if (rule.pathOutside && inside) return false
  if (rule.pathUnc && !(t.unc || t.device)) return false
  if (rule.pathGlobs) {
    const matches = compileGlobs(rule.pathGlobs)
    const rel = relativeTo(t.key, env.rootKey)
    const relHit = rel !== null && rel !== "" && matches(rel)
    if (mode === "every") {
      if (!relHit) return false
    } else if (!(relHit || matches(t.key))) {
      return false
    }
  }
  return true
}

function hasPathConstraint(rule: Rule): boolean {
  return Boolean(rule.pathGlobs || rule.pathInside || rule.pathOutside || rule.pathUnc)
}

function matchRule(rule: Rule, env: MatchEnv, mode: Mode, withWrappers: boolean): RuleMatch | null {
  const { f } = env
  if (rule.exceptTools && matchAnyWildcard(rule.exceptTools, f.tool, false)) return null
  if (rule.mcpSource) {
    const known = env.mcpSource !== undefined
    const inList = known && rule.mcpSource.includes(env.mcpSource as string)
    // Allow rules need a listed source. Other rules apply unless the source is known and different.
    if (mode === "every" ? !inList : known && !inList) return null
  }
  let call = false
  const segs = new Set<number>()
  if (!rule.tools && !rule.commands) {
    call = true
  } else {
    if (rule.tools && matchAnyWildcard(rule.tools, f.tool, false)) call = true
    if (rule.commands && f.isShell) {
      f.segments.forEach((seg, i) => {
        if (segmentMatches(rule, seg, withWrappers)) segs.add(i)
      })
    }
  }
  if (!call && segs.size === 0) return null
  if (hasPathConstraint(rule)) {
    const ok =
      mode === "every"
        ? f.targets.length > 0 && f.targets.every((t) => targetOk(rule, t, env, mode))
        : f.targets.some((t) => targetOk(rule, t, env, mode))
    if (!ok) return null
  }
  return { call, segs }
}

function matchRemember(rule: Rule, env: MatchEnv): RuleMatch | null {
  const { f } = env
  if (!rule.tools?.includes(f.tool)) return null
  const segs = new Set<number>()
  let call = false
  if (rule.commands && f.isShell) {
    const wanted = rule.commands[0] ?? ""
    f.segments.forEach((seg, i) => {
      if (!seg.dynamic && !seg.writes && sameText(seg.text, wanted, seg.kind === "pwsh")) segs.add(i)
    })
  }
  if (rule.paths && f.targets.length > 0) {
    call = f.targets.every((t) => !t.unc && !t.device && rule.paths?.includes(t.key))
  }
  if (!call && segs.size === 0) return null
  return { call, segs }
}
