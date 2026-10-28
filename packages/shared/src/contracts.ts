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
    "extreme-mode",
    "timeout",
    "evaluator-unavailable",
  ]),
  policyHash: z.string(),
})
export type Verdict = z.infer<typeof Verdict>

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
