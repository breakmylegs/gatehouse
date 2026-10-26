import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk"
import {
  checkRemember,
  appendRemember,
  evaluateFloor,
  type Policy,
  type PolicyEngine,
  type PwshWorker,
} from "@gatehouse/policy"
import { canonicalize, type Verdict } from "@gatehouse/shared"
import type { Broker, Resolution } from "./broker.js"
import type { CheckpointManager } from "./checkpoints.js"
import type { ApproverClient } from "./approver-client.js"
import type { HostAudit } from "./hostaudit.js"

export interface CanUseDeps {
  sessionId: string
  cwd: string
  projectRoot?: string
  project: string
  approver: Pick<ApproverClient, "evaluate">
  broker: Broker
  audit: HostAudit
  kill: () => boolean
  policy: () => Policy | undefined
  /** Needed to re-check edited input (invariant 10) and to validate remember rules. */
  engine: PolicyEngine
  pwsh: PwshWorker | undefined
  checkpoints?: CheckpointManager
  /** rules.local.yaml, written only when the desktop asks to remember. */
  localRulesPath?: string
  /** toolUseIDs that went through here, for the PostToolUse audit. */
  decided: Set<string>
  log: (line: string) => void
}

const allow = (input: Record<string, unknown>, toolUseID: string): PermissionResult => ({
  behavior: "allow",
  updatedInput: input,
  toolUseID,
})
const deny = (message: string, toolUseID: string): PermissionResult => ({
  behavior: "deny",
  message,
  toolUseID,
})

function label(toolName: string, input: Record<string, unknown>): string {
  const main =
    input.command ??
    input.file_path ??
    input.notebook_path ??
    input.path ??
    input.url ??
    input.query
  const text = typeof main === "string" ? main : toolName
  return `${toolName} ${text}`.slice(0, 80)
}

function sameInput(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  try {
    return canonicalize(a) === canonicalize(b)
  } catch {
    return false
  }
}

function humanVerdict(base: Verdict, r: Resolution): Verdict {
  const decidedBy: Verdict["decidedBy"] =
    r.channel === "desktop"
      ? "human-desktop"
      : r.channel === "phone"
        ? "human-phone"
        : r.channel === "timeout"
          ? "timeout"
          : "rules"
  const outcome: Verdict["outcome"] = r.outcome === "allow" ? "allow" : "deny"
  const reason =
    r.outcome === "allow"
      ? `Approved on ${r.channel}.`
      : r.outcome === "deny"
        ? `Denied on ${r.channel}${r.message ? `: ${r.message}` : "."}`
        : r.outcome === "timeout"
          ? "Timed out waiting for approval."
          : `Cancelled: ${r.message ?? "the session was interrupted"}.`
  return {
    ...base,
    outcome,
    decidedBy,
    reason,
    ruleId: r.outcome === "cancelled" ? "cancelled" : base.ruleId,
  }
}

/**
 * The canUseTool handler: every call that Claude Code could not approve by itself arrives here.
 *
 *  - Kill switch engaged: deny.
 *  - AskUserQuestion goes to the broker as a question, ExitPlanMode as a plan.
 *  - Everything else is judged by the Approver. Allow echoes the input back, deny tells Claude the rule and
 *    reason so it can adapt, and an escalation goes to a person through the broker.
 *  - A person's allow with edited input is checked again, floor first and then the full policy, and a deny
 *    blocks it (invariant 10).
 *  - It never returns updatedPermissions (invariant 5): "remember" writes a Gatehouse rule instead.
 *  - Every decision is audited, and an allow that cannot be recorded is not given (invariants 1 and 13).
 */
export function createCanUseTool(deps: CanUseDeps): CanUseTool {
  return async (toolName, input, options) => {
    const toolUseID = options.toolUseID
    deps.decided.add(toolUseID)
    try {
      if (deps.kill()) {
        return deny(
          "The Gatehouse kill switch is engaged. Everything is denied until the user re-arms it.",
          toolUseID,
        )
      }
      if (toolName === "AskUserQuestion") return await ask(deps, input, options, "question")
      if (toolName === "ExitPlanMode") return await ask(deps, input, options, "plan")

      const verdict = await deps.approver.evaluate(
        { toolName, input },
        {
          cwd: deps.cwd,
          sessionId: deps.sessionId,
          toolUseId: toolUseID,
          ...(deps.projectRoot !== undefined ? { projectRoot: deps.projectRoot } : {}),
          ...(options.mcpServer?.source !== undefined
            ? { mcpSource: options.mcpServer.source }
            : {}),
        },
      )
      if (verdict.outcome === "allow") return allow(input, toolUseID)
      if (verdict.outcome === "deny") {
        return deny(`${verdict.reason} (rule ${verdict.ruleId})`, toolUseID)
      }
      return await escalate(deps, toolName, input, options, verdict)
    } catch (e) {
      // Invariant 1: a failure in here is a denial, never an allow.
      deps.log(`canUseTool failed (${(e as Error).name}), the call was denied`)
      return deny("Gatehouse could not decide this call safely, so it was denied.", toolUseID)
    }
  }
}

type Options = Parameters<CanUseTool>[2]

async function escalate(
  deps: CanUseDeps,
  toolName: string,
  input: Record<string, unknown>,
  options: Options,
  verdict: Verdict,
): Promise<PermissionResult> {
  const toolUseID = options.toolUseID
  await deps.checkpoints?.beforeEscalation(deps.sessionId, deps.cwd, label(toolName, input))
  const resolution = await deps.broker.request({
    kind: "permission",
    sessionId: deps.sessionId,
    toolUseId: toolUseID,
    toolName,
    input,
    cwd: deps.cwd,
    project: deps.project,
    verdict,
    signal: options.signal,
    defaultToNo: options.defaultToNo === true || verdict.risk >= 70,
  })

  let finalInput = input
  let result: PermissionResult
  let recorded: Verdict = humanVerdict(verdict, resolution)

  if (resolution.outcome === "allow") {
    finalInput = resolution.updatedInput ?? input
    if (!sameInput(input, finalInput)) {
      // Invariant 10: edited input goes through the floor and the full policy again. A deny blocks the allow.
      const blocked = await recheckEdited(deps, toolName, finalInput, options)
      if (blocked) {
        recorded = { ...blocked, decidedBy: blocked.decidedBy }
        result = deny(
          `Your edit was blocked: ${blocked.reason} (rule ${blocked.ruleId})`,
          toolUseID,
        )
        await deps.audit.record({
          session: deps.sessionId,
          event: "edited_input_blocked",
          channel: resolution.channel === "phone" ? "phone" : "desktop",
          tool: toolName,
          toolUseId: toolUseID,
          cwd: deps.cwd,
          project: deps.project,
          input: finalInput,
          verdict: blocked,
          latencyMs: resolution.waitedMs,
        })
        return result
      }
    }
    result = allow(finalInput, toolUseID)
  } else if (resolution.outcome === "deny") {
    result = deny(
      resolution.message ? `Denied by the user: ${resolution.message}` : "Denied by the user.",
      toolUseID,
    )
  } else if (resolution.outcome === "timeout") {
    result = deny("Timed out waiting for approval", toolUseID)
  } else {
    result = deny(`Cancelled: ${resolution.message ?? "the session was interrupted"}`, toolUseID)
  }

  const written = await deps.audit.record({
    session: deps.sessionId,
    event: "human_decision",
    channel: resolution.channel === "host" ? "host" : resolution.channel,
    tool: toolName,
    toolUseId: toolUseID,
    cwd: deps.cwd,
    project: deps.project,
    input: finalInput,
    verdict: recorded,
    latencyMs: resolution.waitedMs,
  })
  // An allow that cannot be recorded is not given (invariants 1 and 13).
  if (!written && result.behavior === "allow") {
    return deny(
      "The decision could not be recorded in the audit log, so it was not applied.",
      toolUseID,
    )
  }

  if (resolution.outcome === "allow" && resolution.remember && resolution.channel === "desktop") {
    await rememberRule(deps, toolName, finalInput)
  }
  return result
}

/** Floor first, then the full policy. Returns a denying verdict if the edited input must not run. */
async function recheckEdited(
  deps: CanUseDeps,
  toolName: string,
  edited: Record<string, unknown>,
  options: Options,
): Promise<Verdict | undefined> {
  const policy = deps.policy()
  const ctx = {
    cwd: deps.cwd,
    ...(deps.projectRoot !== undefined ? { projectRoot: deps.projectRoot } : {}),
  }
  const floor = await evaluateFloor(policy, { toolName, input: edited }, ctx, deps.pwsh)
  if (floor) {
    return {
      outcome: "deny",
      ruleId: floor.ruleId,
      reason: floor.reason,
      risk: 100,
      decidedBy: "floor",
      policyHash: policy?.hash ?? "none",
    }
  }
  const verdict = await deps.approver.evaluate(
    { toolName, input: edited },
    {
      cwd: deps.cwd,
      sessionId: deps.sessionId,
      toolUseId: options.toolUseID,
      ...(deps.projectRoot !== undefined ? { projectRoot: deps.projectRoot } : {}),
      ...(options.mcpServer?.source !== undefined ? { mcpSource: options.mcpServer.source } : {}),
    },
  )
  return verdict.outcome === "deny" ? verdict : undefined
}

async function rememberRule(
  deps: CanUseDeps,
  toolName: string,
  input: Record<string, unknown>,
): Promise<void> {
  if (!deps.localRulesPath) return
  try {
    const ctx = {
      cwd: deps.cwd,
      ...(deps.projectRoot !== undefined ? { projectRoot: deps.projectRoot } : {}),
    }
    const check = await checkRemember(
      deps.engine,
      deps.policy(),
      { toolName, input },
      ctx,
      deps.pwsh,
    )
    if (!check.ok) {
      deps.log(`remember refused: ${check.reason}`)
      return
    }
    const { id, added } = await appendRemember(deps.localRulesPath, check.candidate)
    deps.log(`remember rule ${added ? "added" : "already present"}: ${id}`)
  } catch (e) {
    deps.log(`remember failed (${(e as Error).message})`)
  }
}

async function ask(
  deps: CanUseDeps,
  input: Record<string, unknown>,
  options: Options,
  kind: "question" | "plan",
): Promise<PermissionResult> {
  const toolUseID = options.toolUseID
  const toolName = kind === "question" ? "AskUserQuestion" : "ExitPlanMode"
  const verdict: Verdict = {
    outcome: "escalate",
    ruleId: kind === "question" ? "ask-user-question" : "exit-plan-mode",
    reason:
      kind === "question"
        ? "Claude is asking you a question."
        : "Claude wants to leave plan mode and start work.",
    risk: 0,
    decidedBy: "rules",
    policyHash: deps.policy()?.hash ?? "none",
  }
  const resolution = await deps.broker.request({
    kind,
    sessionId: deps.sessionId,
    toolUseId: toolUseID,
    toolName,
    input,
    cwd: deps.cwd,
    project: deps.project,
    verdict,
    signal: options.signal,
  })
  const recorded = humanVerdict(verdict, resolution)
  const written = await deps.audit.record({
    session: deps.sessionId,
    event: kind === "question" ? "question_answered" : "plan_decision",
    channel: resolution.channel === "host" ? "host" : resolution.channel,
    tool: toolName,
    toolUseId: toolUseID,
    cwd: deps.cwd,
    project: deps.project,
    input,
    verdict: recorded,
    latencyMs: resolution.waitedMs,
  })
  if (resolution.outcome === "allow") {
    if (!written)
      return deny(
        "The decision could not be recorded in the audit log, so it was not applied.",
        toolUseID,
      )
    if (kind === "question") {
      return allow({ ...input, answers: resolution.answers ?? {} }, toolUseID)
    }
    return allow(input, toolUseID)
  }
  if (resolution.outcome === "deny") {
    return deny(
      resolution.message ??
        (kind === "question" ? "The user did not answer." : "The plan was not approved."),
      toolUseID,
    )
  }
  return deny(
    resolution.outcome === "timeout"
      ? "Timed out waiting for approval"
      : `Cancelled: ${resolution.message ?? "interrupted"}`,
    toolUseID,
  )
}
