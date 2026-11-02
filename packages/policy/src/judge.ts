import { z } from "zod"
import type { Verdict } from "@gatehouse/shared"
import type { Policy } from "./types.js"

/**
 * The optional LLM judge (invariant 15). It is off unless the policy turns it on, and it can only ever move a
 * call from "ask the user" to "allow", never past a deny, and only for rules listed in `judgeEligible`.
 * It sees the tool name, the parsed segments and the matched rule id, nothing else: no transcript, no file
 * contents, no web content. Anything unusual (a schema error, low confidence, text that reads like an
 * instruction, too much input, an error, a timeout) leaves the verdict as it was: escalate.
 */
export const JudgeAnswer = z
  .object({
    decision: z.enum(["allow", "escalate"]),
    confidence: z.number().min(0).max(1),
    reason: z.string().min(1).max(300),
  })
  .strict()
export type JudgeAnswer = z.infer<typeof JudgeAnswer>

export interface JudgeInput {
  toolName: string
  segments: string[]
  ruleId: string
  /** The rule's reason, so the judge knows why it was escalated. */
  ruleReason: string
}

/** Returns whatever the model produced, untrusted. The caller validates it. */
export type JudgeFn = (input: JudgeInput) => Promise<unknown>

export const MIN_CONFIDENCE = 0.85
const DEFAULT_MAX_INPUT = 4000

/** Words that have no business in a command being judged. Seeing one means someone may be addressing the judge. */
const INSTRUCTION_LIKE =
  /\b(ignore|disregard|forget|override)\b.{0,30}\b(previous|prior|above|earlier|instructions?|rules?|polic(y|ies)|system)\b|\b(you are now|act as|pretend to be|new instructions?|system prompt|as an ai|jailbreak)\b|\b(respond|reply|answer|output|return)\b.{0,20}\b(allow|json|decision|yes)\b|"decision"\s*:/i

export interface JudgeOutcome {
  verdict: Verdict
  /** Present only when the judge was asked. Recorded in the audit log. */
  rationale?: string
}

/** The text the judge is shown for a call: the parsed segments, or the one string that is the call. */
export function judgeSegments(verdict: Verdict, input: Record<string, unknown>): string[] {
  if (verdict.segments && verdict.segments.length > 0) return verdict.segments.map((s) => s.text)
  for (const k of ["command", "url", "query", "pattern", "file_path"]) {
    const v = input[k]
    if (typeof v === "string" && v) return [v]
  }
  return []
}

export async function applyJudge(opts: {
  verdict: Verdict
  call: { toolName: string; input: Record<string, unknown> }
  policy: Policy | undefined
  judge: JudgeFn | undefined
  timeoutMs?: number
  log?: (line: string) => void
}): Promise<JudgeOutcome> {
  const { verdict, policy } = opts
  const same: JudgeOutcome = { verdict }
  const cfg = policy?.rules.defaults?.judge
  if (!policy || !opts.judge || cfg?.enabled !== true) return same
  // Only an escalation can be reconsidered. A deny, a floor and an allow are never touched.
  if (verdict.outcome !== "escalate") return same
  if (!(policy.rules.judgeEligible ?? []).includes(verdict.ruleId)) return same

  const segments = judgeSegments(verdict, opts.call.input)
  if (segments.length === 0) return same
  const max = cfg.maxInputChars ?? DEFAULT_MAX_INPUT
  const total = segments.reduce((n, s) => n + s.length, 0)
  if (total > max) return withNote(verdict, `The judge was not asked: the input is longer than ${max} characters.`)
  if (segments.some((s) => INSTRUCTION_LIKE.test(s)) || INSTRUCTION_LIKE.test(opts.call.toolName))
    return withNote(verdict, "The judge was not asked: the input contains text that reads like an instruction.")

  let raw: unknown
  try {
    raw = await withTimeout(
      opts.judge({ toolName: opts.call.toolName, segments, ruleId: verdict.ruleId, ruleReason: verdict.reason }),
      opts.timeoutMs ?? 25_000,
    )
  } catch (e) {
    opts.log?.(`judge failed (${(e as Error).message.slice(0, 80)}), the call stays escalated`)
    return withNote(verdict, "The judge could not be reached, so a person decides.")
  }
  const parsed = JudgeAnswer.safeParse(raw)
  if (!parsed.success) return withNote(verdict, "The judge's answer was not in the expected form, so a person decides.")
  const a = parsed.data
  // The reason is shown to the user and written to the audit log, so it gets the same suspicion as the input.
  if (INSTRUCTION_LIKE.test(a.reason)) return withNote(verdict, "The judge's reason looked wrong, so a person decides.")
  if (a.decision !== "allow" || a.confidence < MIN_CONFIDENCE)
    return { verdict: { ...verdict, reason: `${verdict.reason} The judge was not sure enough to allow it: ${a.reason}` }, rationale: `escalate (${a.confidence.toFixed(2)}): ${a.reason}` }
  return {
    verdict: {
      ...verdict,
      outcome: "allow",
      ruleId: `judge:${verdict.ruleId}`,
      reason: `Allowed by the judge (${verdict.ruleId}): ${a.reason}`,
      decidedBy: "judge",
    },
    rationale: `allow (${a.confidence.toFixed(2)}): ${a.reason}`,
  }
}

function withNote(verdict: Verdict, note: string): JudgeOutcome {
  return { verdict: { ...verdict, reason: `${verdict.reason} ${note}` }, rationale: note }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timed out")), ms)
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    )
  })
}
