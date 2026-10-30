import type { HookCallback, HookJSONOutput } from "@anthropic-ai/claude-agent-sdk"
import { evaluateFloor, type Policy, type PwshWorker } from "@gatehouse/policy"
import type { Verdict } from "@gatehouse/shared"
import type { ApproverClient } from "./approver-client.js"
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

/**
 * "Ask": the call goes to canUseTool, and so to the Approver and, for an escalation, to a person, whatever the mode
 * would have done. It is stricter than no decision and is never an allow.
 */
export function askOutput(reason: string): HookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: reason,
    },
  }
}

const NO_DECISION: HookJSONOutput = {}

/** Modes in which Claude Code approves calls by itself, so the hook has to bring the Approver in. */
export const SELF_APPROVING_MODES: ReadonlySet<string> = new Set(["acceptEdits", "auto"])
/** From High risk up, a request is asked even in Auto and Accept edits (the same bands as everywhere in JCVC). */
export const ASK_FROM_RISK = 70
/** Escalations that mean the decision could not be made. They are always asked. */
const COULD_NOT_DECIDE: ReadonlySet<string> = new Set([
  "evaluator-unavailable",
  "audit-failure",
  "policy-unavailable",
  "engine-error",
  "malformed-input",
  "pwsh-unavailable",
  "parse-error",
])
/** Handled by canUseTool in its own way (a question, a plan), never judged as a tool call. */
const NOT_JUDGED: ReadonlySet<string> = new Set(["AskUserQuestion", "ExitPlanMode"])

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
  /** The session's permission mode now. In acceptEdits and auto the hook asks the Approver too. */
  mode?: () => string
  /** The Approver, for the modes in which Claude Code would otherwise decide alone. */
  approver?: Pick<ApproverClient, "evaluate">
  projectRoot?: string
  /** The Approver's verdict by toolUseID, so canUseTool uses it instead of asking again (one decision, one record). */
  verdicts?: Map<string, Verdict>
  /** Session events for the UI: notification, stop, subagent start and stop. */
  onEvent: (
    type: "notification" | "stop" | "subagent_start" | "subagent_stop",
    data: Record<string, unknown>,
  ) => void
  /** Each tool call's verdict, for the line under it in the transcript. */
  onDecision?: (toolUseId: string, verdict: Verdict) => void
  log: (line: string) => void
}

/**
 * The PreToolUse floor. Claude Code approves some calls on its own (reads inside the working folder,
 * read-only commands) and those never reach canUseTool, so this hook is the one place that sees every call.
 * It denies what the floor covers. In Auto and Accept edits, where Claude Code approves much more by itself, it
 * also asks the Approver: what your rules deny is denied, and a High or Severe escalation, or one the Approver
 * could not decide, is asked, which sends it through canUseTool to a person. Anything else is left to the mode.
 * It never allows. If anything goes wrong it denies, which keeps it fail closed.
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
      const mode = deps.mode?.() ?? "default"
      if (deps.approver && SELF_APPROVING_MODES.has(mode) && !NOT_JUDGED.has(input.tool_name)) {
        const verdict = await deps.approver.evaluate(
          { toolName: input.tool_name, input: toolInput },
          {
            cwd,
            sessionId: deps.sessionId,
            toolUseId: input.tool_use_id,
            ...(deps.projectRoot !== undefined ? { projectRoot: deps.projectRoot } : {}),
            ...(input.mcp_server?.source !== undefined
              ? { mcpSource: input.mcp_server.source }
              : {}),
          },
        )
        deps.verdicts?.set(input.tool_use_id, verdict)
        deps.onDecision?.(input.tool_use_id, verdict)
        if (verdict.outcome === "deny")
          return denyOutput(`${verdict.reason} (rule ${verdict.ruleId})`)
        if (
          verdict.outcome === "escalate" &&
          (verdict.risk >= ASK_FROM_RISK || COULD_NOT_DECIDE.has(verdict.ruleId))
        )
          return askOutput(
            `JCVC asks about this even in ${mode === "auto" ? "Auto" : "Accept edits"} mode: ${verdict.reason}`,
          )
      }
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
      deps.verdicts?.delete(input.tool_use_id)
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
