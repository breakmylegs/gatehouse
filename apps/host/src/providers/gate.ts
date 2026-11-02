import crypto from "node:crypto"
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk"
import { evaluateFloor, type Policy, type PwshWorker } from "@gatehouse/policy"
import { canonicalize } from "@gatehouse/shared"
import type { CanonicalTool, Gate, GateVerdict, ToolCall } from "./types.js"

/**
 * The gate for a loop provider (S-03, ADR 0008): the same floor, Approver, person and audit that judge Claude's calls,
 * reached through the same canUseTool. A canonical tool is judged as the Claude Code tool of its kind, with the same
 * input, so no rule needs to know which provider asked.
 */
export const VENDOR_TOOL: Record<CanonicalTool, string | undefined> = {
  read: "Read",
  write: "Write",
  edit: "Edit",
  shell: "PowerShell",
  glob: "Glob",
  grep: "Grep",
  webFetch: "WebFetch",
  webSearch: "WebSearch",
  // Not run by Codehouse yet: an MCP bridge and subagents come with the first loop provider.
  mcp: undefined,
  subagent: undefined,
}

/** The hash an allow is bound to: the executor runs only the input with this hash (T-10). */
export function inputHash(input: Record<string, unknown>): string {
  return crypto.createHash("sha256").update(canonicalize(input)).digest("hex")
}

const deny = (call: ToolCall, ruleId: string, reason: string): GateVerdict => ({
  kind: "deny",
  callId: call.callId,
  ruleId,
  reason,
})

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/** A well-formed verdict for this call, or undefined. */
function wellFormed(call: ToolCall, v: unknown): GateVerdict | undefined {
  if (!isRecord(v) || v.callId !== call.callId) return undefined
  if (v.kind === "deny" && typeof v.ruleId === "string" && typeof v.reason === "string")
    return v as GateVerdict
  if (v.kind === "allow" && isRecord(v.input) && typeof v.inputHash === "string")
    return inputHash(v.input) === v.inputHash ? (v as GateVerdict) : undefined
  return undefined
}

/**
 * Makes any gate fail closed (invariant 1): an error, a timeout, an abort or a malformed answer is a deny. The
 * timeout should be longer than the wait for a person, so it only ends a gate that is stuck.
 */
export function failClosed(gate: Gate, timeoutMs: number): Gate {
  return {
    async decide(call, signal) {
      let timer: NodeJS.Timeout | undefined
      const stop = new AbortController()
      const onAbort = () => stop.abort()
      signal.addEventListener("abort", onAbort, { once: true })
      try {
        const answer = await Promise.race([
          gate.decide(call, stop.signal),
          new Promise<"timeout">((resolve) => {
            timer = setTimeout(() => resolve("timeout"), timeoutMs)
          }),
          new Promise<"aborted">((resolve) => {
            if (signal.aborted) resolve("aborted")
            stop.signal.addEventListener("abort", () => resolve("aborted"), { once: true })
          }),
        ])
        if (answer === "timeout") {
          stop.abort()
          return deny(
            call,
            "gate-timeout",
            "Codehouse did not decide this call in time, so it was denied.",
          )
        }
        if (answer === "aborted") return deny(call, "cancelled", "The call was cancelled.")
        return (
          wellFormed(call, answer) ??
          deny(
            call,
            "gate-malformed",
            "Codehouse could not read the decision, so the call was denied.",
          )
        )
      } catch {
        return deny(
          call,
          "gate-error",
          "Codehouse could not decide this call safely, so it was denied.",
        )
      } finally {
        clearTimeout(timer)
        signal.removeEventListener("abort", onAbort)
      }
    },
  }
}

/**
 * The floor first, in this process (it works when the Approver is down), then the session's canUseTool: the
 * Approver, a person when it escalates, re-checking edited input (invariant 10), and the audit. With no policy
 * loaded the call is denied, which is stricter than the Claude path, where the Approver escalates it.
 */
export function canUseToolGate(deps: {
  canUseTool: CanUseTool
  policy: () => Policy | undefined
  cwd: string
  pwsh?: PwshWorker
}): Gate {
  return {
    async decide(call, signal) {
      const toolName = VENDOR_TOOL[call.tool]
      if (!toolName)
        return deny(call, "tool-not-supported", `Codehouse does not run ${call.tool} calls yet.`)
      const policy = deps.policy()
      if (!policy)
        return deny(call, "policy-unavailable", "The rules are not loaded, so the call was denied.")
      const hit = await evaluateFloor(
        policy,
        { toolName, input: call.input },
        { cwd: deps.cwd },
        deps.pwsh,
      )
      if (hit) return deny(call, hit.ruleId, hit.reason)
      const r = await deps.canUseTool(toolName, call.input, {
        signal,
        toolUseID: call.callId,
        suggestions: [],
      } as unknown as Parameters<CanUseTool>[2])
      // No answer at all is a deny too (invariant 1).
      if (!r)
        return deny(call, "gate-malformed", "Codehouse got no decision, so the call was denied.")
      if (r.behavior !== "allow") return deny(call, "approver-deny", r.message)
      const input = isRecord(r.updatedInput) ? r.updatedInput : call.input
      return { kind: "allow", callId: call.callId, input, inputHash: inputHash(input) }
    },
  }
}
