import type { AuditRecord } from "@gatehouse/shared/audit"
import { localDay } from "./usage.js"

/**
 * Figures worked out from the audit log, nothing else: how often each rule asks you, how often you say yes,
 * and how long you take. Pure functions over records, so they are easy to test and cannot change anything.
 */
const EVALUATION_EVENTS = new Set(["evaluate_permission", "approval_prompt"])

export interface RuleStats {
  ruleId: string
  evaluated: number
  escalated: number
  approved: number
  denied: number
  timedOut: number
  /** Approved out of the ones a person actually answered. Undefined when nobody answered. */
  approvalRate: number | undefined
  medianWaitMs: number | undefined
}

export interface DayStats {
  day: string
  allow: number
  deny: number
  escalate: number
  humanAllow: number
  humanDeny: number
}

export interface Analytics {
  from: string
  to: string
  evaluations: number
  byOutcome: { allow: number; deny: number; escalate: number }
  /** Share of evaluations a person was asked about. */
  escalationRate: number
  judgeAllowed: number
  byRule: RuleStats[]
  human: { answered: number; approved: number; denied: number; timedOut: number }
  byChannel: { desktop: number; phone: number }
  timeToDecideMs: {
    count: number
    p50: number | undefined
    p90: number | undefined
    max: number | undefined
  }
  perDay: DayStats[]
}

export function percentile(sorted: number[], p: number): number | undefined {
  if (sorted.length === 0) return undefined
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[i]
}

const isHuman = (r: AuditRecord) => r.event === "human_decision"

export function computeAnalytics(
  records: readonly AuditRecord[],
  fromMs: number,
  toMs: number,
): Analytics {
  const inWindow = records.filter((r) => {
    const t = Date.parse(r.ts)
    return t >= fromMs && t <= toMs
  })
  const byOutcome = { allow: 0, deny: 0, escalate: 0 }
  const rules = new Map<string, RuleStats & { waits: number[] }>()
  const rule = (id: string) => {
    let s = rules.get(id)
    if (!s) {
      s = {
        ruleId: id,
        evaluated: 0,
        escalated: 0,
        approved: 0,
        denied: 0,
        timedOut: 0,
        approvalRate: undefined,
        medianWaitMs: undefined,
        waits: [],
      }
      rules.set(id, s)
    }
    return s
  }
  const days = new Map<string, DayStats>()
  const day = (iso: string) => {
    const k = localDay(new Date(iso))
    let d = days.get(k)
    if (!d) {
      d = { day: k, allow: 0, deny: 0, escalate: 0, humanAllow: 0, humanDeny: 0 }
      days.set(k, d)
    }
    return d
  }
  const human = { answered: 0, approved: 0, denied: 0, timedOut: 0 }
  const byChannel = { desktop: 0, phone: 0 }
  const waits: number[] = []
  let evaluations = 0
  let judgeAllowed = 0

  for (const r of inWindow) {
    if (EVALUATION_EVENTS.has(r.event)) {
      evaluations++
      byOutcome[r.verdict.outcome]++
      day(r.ts)[r.verdict.outcome]++
      const s = rule(baseRule(r.verdict.ruleId))
      s.evaluated++
      if (r.verdict.outcome === "escalate") s.escalated++
      if (r.verdict.decidedBy === "judge") judgeAllowed++
    } else if (isHuman(r)) {
      const s = rule(baseRule(r.verdict.ruleId))
      const by = r.verdict.decidedBy
      if (by === "timeout") {
        human.timedOut++
        s.timedOut++
      } else if (by === "human-desktop" || by === "human-phone") {
        human.answered++
        if (by === "human-desktop") byChannel.desktop++
        else byChannel.phone++
        waits.push(r.latencyMs)
        s.waits.push(r.latencyMs)
        if (r.verdict.outcome === "allow") {
          human.approved++
          s.approved++
          day(r.ts).humanAllow++
        } else {
          human.denied++
          s.denied++
          day(r.ts).humanDeny++
        }
      }
    }
  }

  waits.sort((a, b) => a - b)
  const byRule: RuleStats[] = [...rules.values()]
    .map(({ waits: w, ...s }) => {
      const sorted = [...w].sort((a, b) => a - b)
      const answered = s.approved + s.denied
      return {
        ...s,
        approvalRate: answered > 0 ? s.approved / answered : undefined,
        medianWaitMs: percentile(sorted, 50),
      }
    })
    .filter((s) => s.evaluated > 0 || s.approved + s.denied + s.timedOut > 0)
    .sort(
      (a, b) =>
        b.escalated - a.escalated || b.evaluated - a.evaluated || a.ruleId.localeCompare(b.ruleId),
    )

  return {
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    evaluations,
    byOutcome,
    escalationRate: evaluations > 0 ? byOutcome.escalate / evaluations : 0,
    judgeAllowed,
    byRule,
    human,
    byChannel,
    timeToDecideMs: {
      count: waits.length,
      p50: percentile(waits, 50),
      p90: percentile(waits, 90),
      max: waits.at(-1),
    },
    perDay: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
  }
}

/** A judge-made allow carries `judge:<rule>`. Analytics counts it under the rule it reconsidered. */
function baseRule(id: string): string {
  return id.startsWith("judge:") ? id.slice(6) : id
}

// ---- suggestions ----

export interface SuggestionCandidate {
  tool: string
  command?: string
  path?: string
}

export interface Suggestion {
  candidate: SuggestionCandidate
  /** The exact rule it would add, in words. */
  preview: string
  approvals: number
  lastSeen: string
  ruleIds: string[]
}

export const MIN_APPROVALS = 3
const REDACTED = /\[redacted|\*\*\*|<redacted/i

/**
 * Calls a person approved at least three times and never denied or let time out, as input for the narrow
 * "remember" check. Nothing here widens anything: each suggestion is one exact command or one exact file,
 * and the Host checks it again when it is accepted.
 */
export function groupApprovals(
  records: readonly AuditRecord[],
  fromMs: number,
): Array<{
  tool: string
  input: Record<string, unknown>
  cwd: string
  approvals: number
  lastSeen: string
  ruleIds: string[]
  key: string
}> {
  const groups = new Map<
    string,
    {
      tool: string
      input: Record<string, unknown>
      cwd: string
      approvals: number
      lastSeen: string
      ruleIds: Set<string>
      spoiled: boolean
    }
  >()
  for (const r of records) {
    if (!isHuman(r) || Date.parse(r.ts) < fromMs || !r.cwd) continue
    if (r.inputJson.length > 4000 || REDACTED.test(r.inputJson)) continue
    let input: unknown
    try {
      input = JSON.parse(r.inputJson)
    } catch {
      continue
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) continue
    const key = `${r.tool}\u0000${r.inputJson}`
    let g = groups.get(key)
    if (!g) {
      g = {
        tool: r.tool,
        input: input as Record<string, unknown>,
        cwd: r.cwd,
        approvals: 0,
        lastSeen: r.ts,
        ruleIds: new Set(),
        spoiled: false,
      }
      groups.set(key, g)
    }
    const by = r.verdict.decidedBy
    if ((by === "human-desktop" || by === "human-phone") && r.verdict.outcome === "allow") {
      g.approvals++
      g.ruleIds.add(baseRule(r.verdict.ruleId))
      if (r.ts > g.lastSeen) g.lastSeen = r.ts
    } else g.spoiled = true
  }
  return [...groups.entries()]
    .filter(([, g]) => !g.spoiled && g.approvals >= MIN_APPROVALS)
    .map(([key, g]) => ({
      key,
      tool: g.tool,
      input: g.input,
      cwd: g.cwd,
      approvals: g.approvals,
      lastSeen: g.lastSeen,
      ruleIds: [...g.ruleIds],
    }))
    .sort((a, b) => b.approvals - a.approvals || b.lastSeen.localeCompare(a.lastSeen))
}

// ---- digest ----

export interface Digest {
  from: string
  to: string
  automaticAllowed: number
  automaticDenied: number
  askedYou: number
  approved: number
  denied: number
  timedOut: number
  judgeAllowed: number
  topRules: Array<{ ruleId: string; escalated: number }>
  costUsd: number
  /** One plain paragraph, for the top of the screen and for the phone. */
  text: string
}

export function computeDigest(
  records: readonly AuditRecord[],
  fromMs: number,
  toMs: number,
  costUsd: number,
): Digest {
  const a = computeAnalytics(records, fromMs, toMs)
  const askedYou = a.byOutcome.escalate
  const automaticAllowed = a.byOutcome.allow
  const automaticDenied = a.byOutcome.deny
  const topRules = a.byRule
    .filter((r) => r.escalated > 0)
    .slice(0, 3)
    .map((r) => ({ ruleId: r.ruleId, escalated: r.escalated }))
  const n = (x: number, one: string, many = one + "s") => `${x} ${x === 1 ? one : many}`
  const parts: string[] = []
  parts.push(
    `${n(automaticAllowed, "call")} went through automatically${a.judgeAllowed ? ` (${a.judgeAllowed} by the judge)` : ""} and ${n(automaticDenied, "call")} ${automaticDenied === 1 ? "was" : "were"} blocked by policy.`,
  )
  if (askedYou === 0) parts.push("Nothing needed you.")
  else {
    const tail = [`${a.human.approved} approved`, `${a.human.denied} denied`]
    if (a.human.timedOut) tail.push(`${a.human.timedOut} timed out`)
    parts.push(`${n(askedYou, "request")} asked you: ${tail.join(", ")}.`)
  }
  if (topRules.length)
    parts.push(`Most asked: ${topRules.map((r) => `${r.ruleId} (${r.escalated})`).join(", ")}.`)
  if (costUsd > 0) parts.push(`Spend: $${costUsd.toFixed(2)}.`)
  return {
    from: a.from,
    to: a.to,
    automaticAllowed,
    automaticDenied,
    askedYou,
    approved: a.human.approved,
    denied: a.human.denied,
    timedOut: a.human.timedOut,
    judgeAllowed: a.judgeAllowed,
    topRules,
    costUsd,
    text: `In the last 24 hours: ${parts.join(" ")}`,
  }
}
