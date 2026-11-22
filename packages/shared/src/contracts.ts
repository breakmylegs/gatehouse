import { z } from "zod"

export const Outcome = z.enum(["allow", "deny", "escalate"])
export type Outcome = z.infer<typeof Outcome>

export const Verdict = z.object({
  outcome: Outcome,
  ruleId: z.string(),
  reason: z.string(),
  risk: z.number().int().min(0).max(100),
  segments: z
    .array(z.object({ text: z.string(), ruleId: z.string(), outcome: Outcome }))
    .optional(),
  decidedBy: z.enum([
    "floor",
    "rules",
    "judge",
    "human-desktop",
    "human-phone",
    "human-push",
    "extreme-mode",
    "timeout",
    "evaluator-unavailable",
  ]),
  policyHash: z.string(),
  /** D-013: what the shell call would also run (npm scripts, hooks, recipes, wrappers), for the card. */
  expanded: z.array(z.object({ from: z.string(), line: z.string() })).max(20).optional(),
  /** D-013: what it would run that cannot be read. */
  unknownEffects: z.array(z.string()).max(10).optional(),
  /** D-064: the same command with --ignore-scripts, which the card offers as "Run without scripts" (an edited input). */
  withoutScripts: z.string().max(20_000).optional(),
})
export type Verdict = z.infer<typeof Verdict>

/**
 * G20: what a call would delete or throw away, and whether git can bring it back (apps/host/src/effects.ts). On a
 * request only where there is something to say.
 */
export const Effects = z.object({
  kind: z.enum(["delete", "discard"]),
  count: z.number().int().min(0),
  paths: z.array(z.string()).max(20),
  more: z.boolean(),
  reversible: z.boolean(),
  undo: z.string(),
})
export type Effects = z.infer<typeof Effects>

/**
 * D-014: a path a call would move or overwrite, read from its words before you decide (apps/host/src/effects.ts);
 * nothing is run to find it. `what` is what is there now: "file", "folder", "not there", "pattern".
 */
export const Touch = z.object({
  effect: z.enum(["move", "overwrite"]),
  path: z.string(),
  what: z.string(),
})
export type Touch = z.infer<typeof Touch>

/**
 * E-024: what depends on a resource an infrastructure apply deletes or replaces, from the plan's dependency graph
 * (apps/host/src/iac-plans.ts). On a request only where there is something to say.
 */
export const Blast = z.object({
  resource: z.string(),
  action: z.enum(["delete", "replace"]),
  dependents: z.array(z.string()).max(30),
  more: z.number().int().min(0),
})
export type Blast = z.infer<typeof Blast>

export const EscalationRequest = z.object({
  id: z.string(), // UUIDv7
  nonce: z.string(), // 32 random bytes, base64url
  kind: z.enum(["permission", "question", "plan"]),
  sessionId: z.string(),
  toolUseId: z.string(),
  toolName: z.string(),
  input: z.unknown(), // redacted copy
  cwd: z.string(),
  project: z.string(),
  verdict: Verdict,
  /** G20: absent when the call deletes and discards nothing. */
  effects: Effects.optional(),
  /** D-014: absent when the call moves and overwrites nothing it names. */
  touches: z.array(Touch).max(20).optional(),
  /** E-024: absent unless the call applies a plan that deletes or replaces something others depend on. */
  blast: z.array(Blast).max(10).optional(),
  createdAt: z.string(),
  expiresAt: z.string(),
  payloadHash: z.string(), // SHA-256 of the canonical plaintext payload sent to the phone
})
export type EscalationRequest = z.infer<typeof EscalationRequest>

export const DecisionEnvelope = z.object({
  v: z.literal(1),
  type: z.enum(["decision", "answer", "kill"]),
  requestId: z.string().optional(),
  nonce: z.string().optional(),
  decision: z.enum(["allow", "deny"]).optional(),
  message: z.string().max(500).optional(),
  answers: z.record(z.string(), z.string()).optional(),
  payloadHash: z.string().optional(),
  deviceId: z.string(),
  issuedAt: z.string(),
  expiresAt: z.string(),
})
export type DecisionEnvelope = z.infer<typeof DecisionEnvelope>
// D-089: the review load estimate, for the Host and the desktop alike.
export * from "./review-load.js"
