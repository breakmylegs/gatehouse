import { ExecutorRefused, type ToolOutcome } from "./executor.js"
import type { Gate, SessionEvent, ToolCall } from "./types.js"

export interface Executor {
  run(call: ToolCall, verdict: Awaited<ReturnType<Gate["decide"]>>): Promise<ToolOutcome>
}

/**
 * One tool request in a loop provider's turn (S-03): the gate decides, and only an allow reaches the executor. A
 * deny, or an executor that refuses, goes back to the model as a failed result with the reason, so it can adapt.
 */
export async function handleToolRequest(
  call: ToolCall,
  gate: Gate,
  executor: Executor,
  signal: AbortSignal,
): Promise<Extract<SessionEvent, { type: "toolResult" }>> {
  const verdict = await gate.decide(call, signal)
  if (verdict.kind !== "allow")
    return {
      type: "toolResult",
      callId: call.callId,
      ok: false,
      output: `Denied: ${verdict.reason} (rule ${verdict.ruleId})`,
      untrusted: true,
    }
  try {
    const r = await executor.run(call, verdict)
    return { type: "toolResult", callId: call.callId, ok: r.ok, output: r.output, untrusted: true }
  } catch (e) {
    const why = e instanceof ExecutorRefused ? e.message : "The tool could not run."
    return {
      type: "toolResult",
      callId: call.callId,
      ok: false,
      output: `Not run: ${why}`,
      untrusted: true,
    }
  }
}
