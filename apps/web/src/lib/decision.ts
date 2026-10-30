import type { Verdict } from "@gatehouse/shared"

/** What decided one tool call, as the screen keeps it: from a decision event, an audit record or the audit log. */
export interface Decision {
  outcome: Verdict["outcome"]
  decidedBy: Verdict["decidedBy"]
  ruleId: string
  reason: string
  risk: number
  /** When it was decided, in milliseconds. */
  at: number
}

/** Of two decisions about one call, the one to show: an answer beats the question that led to it, then the later. */
export function laterDecision(a: Decision | undefined, b: Decision): Decision {
  if (!a) return b
  const final = (d: Decision) => d.outcome !== "escalate"
  if (final(a) !== final(b)) return final(b) ? b : a
  return b.at >= a.at ? b : a
}

/** A decision from an audit record, or undefined for a record that is not about one tool call. */
export function fromRecord(
  r: unknown,
): { sessionId: string; toolUseId: string; d: Decision } | undefined {
  if (!r || typeof r !== "object") return undefined
  const o = r as Record<string, unknown>
  const v = o.verdict as Partial<Verdict> | undefined
  if (typeof o.toolUseId !== "string" || typeof o.session !== "string" || !v?.outcome)
    return undefined
  return {
    sessionId: o.session,
    toolUseId: o.toolUseId,
    d: {
      outcome: v.outcome,
      decidedBy: v.decidedBy ?? "rules",
      ruleId: v.ruleId ?? "",
      reason: v.reason ?? "",
      risk: v.risk ?? 0,
      at: typeof o.ts === "string" ? Date.parse(o.ts) || 0 : 0,
    },
  }
}

export interface DecisionLine {
  /** Shown on the card's top row, only when you were asked or the call was stopped. */
  mark?: string
  /** The full line inside the card. */
  line: string
  stopped: boolean
}

/** Who decided and why, in words. Allows by your rules stay quiet: they are most calls. */
export function describeDecision(d: Decision): DecisionLine {
  const why = d.reason.trim()
  const allowed = d.outcome === "allow"
  if (d.ruleId === "cancelled") return { mark: "Cancelled", line: why, stopped: true }
  if (d.ruleId === "claude-code-auto")
    return {
      line: "Claude Code allowed this itself, after JCVC's always-blocked list checked it.",
      stopped: false,
    }
  if (d.ruleId === "kill-switch")
    return { mark: "Kill switch", line: "Denied: the kill switch was on.", stopped: true }
  // Questions and plans are always yours to answer, so they need no mark unless nobody answered.
  if (d.ruleId === "ask-user-question")
    return d.outcome === "escalate"
      ? { line: "Claude asked you this.", stopped: false }
      : allowed
        ? { line: "You answered.", stopped: false }
        : { mark: "Not answered", line: "The question was not answered.", stopped: true }
  if (d.ruleId === "exit-plan-mode")
    return d.outcome === "escalate"
      ? { line: "Claude asked to start work on its plan.", stopped: false }
      : allowed
        ? { line: "You approved the plan.", stopped: false }
        : { mark: "Plan not approved", line: "You did not approve the plan.", stopped: true }
  switch (d.decidedBy) {
    case "human-desktop":
      return allowed
        ? { mark: "You allowed", line: "You allowed this on this computer.", stopped: false }
        : { mark: "You denied", line: "You denied this on this computer.", stopped: true }
    case "human-phone":
      return allowed
        ? { mark: "Allowed on phone", line: "You allowed this on your phone.", stopped: false }
        : { mark: "Denied on phone", line: "You denied this on your phone.", stopped: true }
    case "human-push":
      return allowed
        ? {
            mark: "Allowed from a notification",
            line: "You allowed this from a notification.",
            stopped: false,
          }
        : {
            mark: "Denied from a notification",
            line: "You denied this from a notification.",
            stopped: true,
          }
    case "timeout":
      return {
        mark: "Not answered",
        line: "Nobody answered in time, so it was denied.",
        stopped: true,
      }
    case "extreme-mode":
      return {
        mark: "Extreme approval",
        line: `Allowed by Extreme approval. It would have asked: ${why}`,
        stopped: false,
      }
    case "evaluator-unavailable":
      return allowed
        ? { line: why, stopped: false }
        : {
            mark: "Not checked",
            line: `JCVC could not check this, so it ${d.outcome === "deny" ? "was denied" : "asked you"}.`,
            stopped: d.outcome === "deny",
          }
    case "floor":
      return { mark: "Blocked", line: `Always blocked: ${why}`, stopped: true }
    case "judge":
      return allowed
        ? { line: `Allowed by the judge: ${why}`, stopped: false }
        : { mark: "Asked", line: `The judge left it to you: ${why}`, stopped: false }
    case "rules":
      return allowed
        ? { line: `Allowed by your rules: ${why}`, stopped: false }
        : d.outcome === "deny"
          ? { mark: "Blocked", line: `Blocked by your rules: ${why}`, stopped: true }
          : { mark: "Asked", line: `Asked you: ${why}`, stopped: false }
  }
}
