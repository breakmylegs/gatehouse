import type { HookCallback, HookJSONOutput } from "@anthropic-ai/claude-agent-sdk"
import { evaluateFloor, type Policy, type PwshWorker } from "@gatehouse/policy"
import type { Verdict } from "@gatehouse/shared"
import type { CheckpointManager } from "./checkpoints.js"
import type { HostAudit } from "./hostaudit.js"

/**
 * The only output the floor hook can produce besides "no decision". There is no function here that returns
 * an allow, so the floor cannot grant anything (invariant 2).
 */
export function denyOutput(reason: string): HookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  }
}

const NO_DECISION: HookJSONOutput = {}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
}

export interface SessionHookDeps {
  sessionId: string
  cwd: string
  policy: () => Policy | undefined
  pwsh: PwshWorker | undefined
  audit: HostAudit
  kill: () => boolean
  checkpoints?: CheckpointManager
  /** toolUseIDs that went through canUseTool, so PostToolUse can tell which calls Claude Code approved itself. */
  decided: Set<string>
  /** Session events for the UI: notification, stop, subagent start and stop. */
  onEvent: (
    type: "notification" | "stop" | "subagent_start" | "subagent_stop",
    data: Record<string, unknown>,
  ) => void
  log: (line: string) => void
}

/**
 * The PreToolUse floor. Claude Code approves some calls on its own (reads inside the working folder,
 * read-only commands) and those never reach canUseTool, so this hook is the one place that sees every call.
 * It denies what the floor covers and otherwise has no opinion. It never allows. If anything goes wrong it
 * denies, which keeps it deny-only and fail closed.
 */
export function createFloorHook(deps: SessionHookDeps): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return NO_DECISION
    try {
      const toolInput = asRecord(input.tool_input)
      const cwd = typeof input.cwd === "string" && input.cwd !== "" ? input.cwd : deps.cwd
      if (deps.kill())
        return denyOutput(
          "The JCVC kill switch is engaged. Everything is denied until the user re-arms it.",
        )
      const policy = deps.policy()
      const hit = await evaluateFloor(
        policy,
        { toolName: input.tool_name, input: toolInput },
        { cwd },
        deps.pwsh,
      )
      if (hit) {
        const verdict: Verdict = {
          outcome: "deny",
          ruleId: hit.ruleId,
          reason: hit.reason,
          risk: 100,
          decidedBy: "floor",
          policyHash: policy?.hash ?? "none",
        }
        await deps.audit.record({
          session: deps.sessionId,
          event: "floor_deny",
          channel: "host",
          tool: input.tool_name,
          toolUseId: input.tool_use_id,
          cwd,
          input: toolInput,
          verdict,
          latencyMs: 0,
        })
        return denyOutput(`${hit.reason} (rule ${hit.ruleId})`)
      }
      // The call passed the floor. If it is an edit, take a checkpoint at the start of a burst of edits.
      await deps.checkpoints?.noteEdit(deps.sessionId, cwd, input.tool_name)
      return NO_DECISION
    } catch (e) {
      deps.log(`floor hook failed (${(e as Error).name}), the call was blocked`)
      return denyOutput("The JCVC floor check failed, so this call was blocked.")
    }
  }
}

const SELF_APPROVED: Omit<Verdict, "policyHash"> = {
  outcome: "allow",
  ruleId: "claude-code-auto",
  reason:
    "Claude Code approved this itself (a read inside the working folder, a read-only command or a managed rule). The JCVC floor had already checked it.",
  risk: 0,
  decidedBy: "rules",
}

/** Audits calls that ran without ever reaching canUseTool (invariant 13), from PostToolUse. */
export function createPostToolHook(deps: SessionHookDeps): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PostToolUse" && input.hook_event_name !== "PostToolUseFailure")
      return NO_DECISION
    try {
      if (deps.decided.has(input.tool_use_id)) return NO_DECISION
      await deps.audit.record({
        session: deps.sessionId,
        event: input.hook_event_name === "PostToolUse" ? "self_approved" : "self_approved_failed",
        channel: "host",
        tool: input.tool_name,
        toolUseId: input.tool_use_id,
        cwd: typeof input.cwd === "string" ? input.cwd : deps.cwd,
        input: asRecord(input.tool_input),
        verdict: { ...SELF_APPROVED, policyHash: deps.policy()?.hash ?? "none" },
        latencyMs: 0,
      })
    } catch (e) {
      deps.log(`post-tool audit failed (${(e as Error).name})`)
    }
    return NO_DECISION
  }
}

/** Notification, Stop and subagent events, passed on to the UI. They never decide anything. */
export function createEventHook(deps: SessionHookDeps): HookCallback {
  return async (input) => {
    try {
      switch (input.hook_event_name) {
        case "Notification":
          deps.onEvent("notification", {
            message: input.message,
            title: input.title,
            kind: input.notification_type,
          })
          break
        case "Stop":
          deps.onEvent("stop", {})
          break
        case "SubagentStart":
          deps.onEvent("subagent_start", asRecord(input))
          break
        case "SubagentStop":
          deps.onEvent("subagent_stop", asRecord(input))
          break
        default:
          break
      }
    } catch (e) {
      deps.log(`event hook failed (${(e as Error).name})`)
    }
    return NO_DECISION
  }
}
