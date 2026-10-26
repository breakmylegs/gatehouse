import { randomBytes } from "node:crypto"
import { canonicalize, sha256Hex } from "./canonical.js"
import type { EscalationRequest } from "./contracts.js"

/** 32 random bytes, base64url, used once per escalation request (invariant 8). */
export function newNonce(): string {
  return randomBytes(32).toString("base64url")
}

/**
 * The plaintext that is encrypted for the phone. Its SHA-256 over canonical JSON is the request's payloadHash,
 * and a phone decision is only accepted when its envelope carries that hash.
 */
export function phonePayload(req: Omit<EscalationRequest, "payloadHash">) {
  return {
    id: req.id,
    nonce: req.nonce,
    kind: req.kind,
    toolName: req.toolName,
    input: req.input,
    cwd: req.cwd,
    project: req.project,
    verdict: {
      outcome: req.verdict.outcome,
      ruleId: req.verdict.ruleId,
      reason: req.verdict.reason,
      risk: req.verdict.risk,
      segments: req.verdict.segments,
    },
    createdAt: req.createdAt,
    expiresAt: req.expiresAt,
  }
}

export function computePayloadHash(req: Omit<EscalationRequest, "payloadHash">): string {
  return sha256Hex(canonicalize(phonePayload(req)))
}
