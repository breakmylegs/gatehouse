import { INTEGRITY_PREFIX } from "@gatehouse/policy"
import { TAINT_RULE, withProvenance, type Provenance } from "./provenance.js"
import { recommendedAnswers } from "./carry-on.js"
import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk"
import {
  checkRemember,
  appendRemember,
  DEFAULT_GRANT_DAYS,
  type GrantLimits,
  evaluateFloor,
  type Policy,
  type PolicyEngine,
  type PwshWorker,
} from "@gatehouse/policy"
import { canonicalize, type Effects, type Verdict } from "@gatehouse/shared"
import type { Broker, Resolution } from "./broker.js"
import { effectsOf, UNKNOWN_EFFECTS } from "./effects.js"
import type { GrantUses } from "./grant-uses.js"
import type { RememberFor } from "@gatehouse/shared/ws-protocol"
import type { CheckpointManager } from "./checkpoints.js"
import type { ApproverClient } from "./approver-client.js"
import type { HostAudit } from "./hostaudit.js"

export interface CanUseDeps {
  /** B32: what the session read from outside, to catch a command copied from it. */
  provenance?: Provenance
  /** Verdicts the PreToolUse hook already got from the Approver (Auto and Accept edits), used instead of asking again. */
  verdicts?: Map<string, Verdict>
  sessionId: string
  cwd: string
  projectRoot?: string
  /** A chat or a coding session, for rules scoped to one (CH-03, ADR 0012). */
  sessionKind?: "code" | "chat"
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
  /** Extreme approval mode, read at each call so it applies at once. */
  extreme?: () => boolean
  /** D-001: this project is strict about its tests, so Extreme approval does not approve a weakening. */
  strictTests?: () => boolean
  /** D-001: Extreme approval approved a weakening of the tests, which the session then says (pattern, reason). */
  onTestsWeakened?: (pattern: string, reason: string) => void
  /** The session's permission mode now: in Plan mode no file is changed until the plan is approved. */
  mode?: () => string
  /** Tells the phone that a request was approved by Extreme approval mode. Never given the input. */
  notifyAutoApproved?: (toolName: string, project: string) => void
  /** Each tool call's verdict, for the line under it in the transcript. A person's answer comes as its audit record. */
  onDecision?: (toolUseId: string, verdict: Verdict) => void
  /** C-013: counts the uses of remembered rules with a limit. Absent: no limits are counted (tests). */
  grants?: GrantUses
  /** G20: works out what a call would delete or throw away. Absent: effects.ts, in the session's folder. */
  effects?: (toolName: string, input: Record<string, unknown>) => Promise<Effects | undefined>
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
        : r.channel === "push"
          ? "human-push"
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
          "The Codehouse kill switch is engaged. Everything is denied until the user re-arms it.",
          toolUseID,
        )
      }
      if (toolName === "AskUserQuestion") return await ask(deps, input, options, "question")
      if (toolName === "ExitPlanMode") return await ask(deps, input, options, "plan")
      // Plan mode sends edits here rather than refusing them; nothing is changed until the plan is approved.
      if (deps.mode?.() === "plan" && PLAN_EDIT_TOOLS.has(toolName)) {
        await deps.audit
          .record({
            session: deps.sessionId,
            event: "decision",
            channel: "host",
            tool: toolName,
            toolUseId: toolUseID,
            cwd: deps.cwd,
            project: deps.project,
            input,
            verdict: {
              outcome: "deny",
              ruleId: "plan-mode-no-edits",
              reason: "In Plan mode nothing is changed until the plan is approved.",
              risk: 0,
              decidedBy: "rules",
              policyHash: deps.policy()?.hash ?? "",
            },
            latencyMs: 0,
          })
          .catch(() => false)
        return deny(
          "This session is in Plan mode, so no file is changed. Finish the plan and ask for it to be approved first.",
          toolUseID,
        )
      }

      const early = deps.verdicts?.get(toolUseID)
      deps.verdicts?.delete(toolUseID)
      const judged =
        early ??
        (await deps.approver.evaluate(
          { toolName, input },
          {
            cwd: deps.cwd,
            sessionId: deps.sessionId,
            toolUseId: toolUseID,
            ...(deps.projectRoot !== undefined ? { projectRoot: deps.projectRoot } : {}),
            ...(deps.sessionKind ? { sessionKind: deps.sessionKind } : {}),
            ...(options.mcpServer?.source !== undefined
              ? { mcpSource: options.mcpServer.source }
              : {}),
          },
        ))
      // B32: the hook already applied it to an early verdict; applying it again changes nothing.
      const verdict = withProvenance(judged, toolName, input, deps.provenance)
      if (!early) deps.onDecision?.(toolUseID, verdict)
      if (verdict.outcome === "allow") {
        // C-013: a remembered rule that has used its allowed number of calls asks instead.
        if (deps.grants?.spent(verdict, toolUseID))
          return await escalate(deps, toolName, input, options, {
            ...verdict,
            outcome: "escalate",
            reason: deps.grants.reason(verdict.ruleId),
          })
        // G20: the judge never allows by itself what cannot be undone; your own rules still do.
        if (verdict.decidedBy === "judge") {
          const effects = await effectsFor(deps, toolName, input)
          if (effects && !effects.reversible)
            return await escalate(
              deps,
              toolName,
              input,
              options,
              { ...verdict, outcome: "escalate", reason: `${verdict.reason} ${CANNOT_UNDO_ASKS}` },
              effects,
            )
        }
        return allow(input, toolUseID)
      }
      if (verdict.outcome === "deny") {
        return deny(`${verdict.reason} (rule ${verdict.ruleId})`, toolUseID)
      }
      const effects = await effectsFor(deps, toolName, input)
      // D-001: a change that weakens the tests is recorded, with its pattern, before anything is decided.
      const weakens = verdict.ruleId.startsWith(INTEGRITY_PREFIX)
      if (weakens) {
        const written = await deps.audit.record({
          session: deps.sessionId,
          event: "test_integrity_escalated",
          channel: "host",
          tool: toolName,
          toolUseId: toolUseID,
          cwd: deps.cwd,
          project: deps.project,
          input: { pattern: verdict.ruleId.slice(INTEGRITY_PREFIX.length), reason: verdict.reason },
          verdict,
          latencyMs: 0,
        })
        if (!written)
          return deny("The decision could not be recorded in the audit log, so it was not applied.", toolUseID)
      }
      if (deps.extreme?.() === true && weakens && deps.strictTests?.()) {
        // D-001, strict for this project: a weakening waits for a person even in Extreme approval.
        return await escalate(
          deps,
          toolName,
          input,
          options,
          { ...verdict, reason: `${verdict.reason} ${STRICT_TESTS_ASKS}` },
          effects,
        )
      }
      if (deps.extreme?.() === true) {
        const cannotUndo = effects !== undefined && !effects.reversible
        if (!NEVER_AUTO_APPROVED.has(verdict.ruleId) && !cannotUndo) {
          const approved = await extremeApprove(deps, toolName, input, toolUseID, verdict)
          // D-001, the default: approved and flagged, so the session says its tests were weakened.
          if (weakens && approved.behavior === "allow")
            deps.onTestsWeakened?.(verdict.ruleId.slice(INTEGRITY_PREFIX.length), verdict.reason)
          return approved
        }
        // Say why on the card: you chose Extreme approval and would otherwise expect no question.
        return await escalate(
          deps,
          toolName,
          input,
          options,
          {
            ...verdict,
            reason: `${verdict.reason} ${cannotUndo && !NEVER_AUTO_APPROVED.has(verdict.ruleId) ? CANNOT_UNDO_ASKS : EXTREME_CANNOT_APPROVE}`,
          },
          effects,
        )
      }
      return await escalate(deps, toolName, input, options, verdict, effects)
    } catch (e) {
      // Invariant 1: a failure in here is a denial, never an allow.
      deps.log(`canUseTool failed (${(e as Error).name}), the call was denied`)
      return deny("Codehouse could not decide this call safely, so it was denied.", toolUseID)
    }
  }
}

type Options = Parameters<CanUseTool>[2]

/** The tools that change files, which Plan mode sends to canUseTool instead of refusing. */
export const PLAN_EDIT_TOOLS: ReadonlySet<string> = new Set([
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
])

/**
 * Escalations that come from something going wrong, not from a rule. Extreme approval mode never turns these into
 * an allow, because a failure must always end in a person or a denial (invariant 1).
 */
export const NEVER_AUTO_APPROVED: ReadonlySet<string> = new Set([
  // B32: a command copied from a web page is always a person's decision.
  TAINT_RULE,
  "evaluator-unavailable",
  "audit-failure",
  "policy-unavailable",
  "engine-error",
  "malformed-input",
  "pwsh-unavailable",
  "parse-error",
  "kill-switch",
])

/** D-001: added to the reason when a project is strict about its tests and Extreme approval meets a weakening. */
export const STRICT_TESTS_ASKS =
  "This project is strict about its tests (Settings, Sessions, Test integrity), so this waits for you even in Extreme approval."

/** Added to the reason when Extreme approval meets one of NEVER_AUTO_APPROVED. */
export const EXTREME_CANNOT_APPROVE =
  "Extreme approval only approves requests Codehouse could check, so this one waits for you."

/** G20: added to the reason when Extreme approval or the judge meets a call that cannot be undone. */
export const CANNOT_UNDO_ASKS =
  "It cannot be undone, so it is never approved without you, even in Extreme approval."

/**
 * G20: what the call would delete or throw away. A failure working it out counts as cannot be undone for a shell
 * command (fail closed), and as nothing for any other tool, which deletes nothing this way.
 */
async function effectsFor(
  deps: CanUseDeps,
  toolName: string,
  input: Record<string, unknown>,
): Promise<Effects | undefined> {
  try {
    return await (deps.effects ?? ((t, i) => effectsOf(t, i, deps.cwd)))(toolName, input)
  } catch {
    return toolName === "Bash" || toolName === "PowerShell" ? UNKNOWN_EFFECTS : undefined
  }
}

/**
 * Extreme approval mode: an escalation is approved without asking. It is audited first (an allow that cannot be
 * recorded is not given), then the phone is told. The floor already ran before this and every deny verdict
 * returned earlier, so this only ever turns "ask" into "allow".
 */
async function extremeApprove(
  deps: CanUseDeps,
  toolName: string,
  input: Record<string, unknown>,
  toolUseID: string,
  verdict: Verdict,
): Promise<PermissionResult> {
  const recorded: Verdict = {
    ...verdict,
    outcome: "allow",
    decidedBy: "extreme-mode",
    reason: "Approved without asking because Extreme approval mode is on.",
  }
  const written = await deps.audit.record({
    session: deps.sessionId,
    event: "human_decision",
    channel: "host",
    tool: toolName,
    toolUseId: toolUseID,
    cwd: deps.cwd,
    project: deps.project,
    input,
    verdict: recorded,
    latencyMs: 0,
  })
  if (!written) {
    return deny(
      "The decision could not be recorded in the audit log, so it was not applied.",
      toolUseID,
    )
  }
  try {
    deps.notifyAutoApproved?.(toolName, deps.project)
  } catch {
    // A notification problem never changes the decision.
  }
  return allow(input, toolUseID)
}

async function escalate(
  deps: CanUseDeps,
  toolName: string,
  input: Record<string, unknown>,
  options: Options,
  verdict: Verdict,
  effects?: Effects,
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
    ...(effects ? { effects } : {}),
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
    await rememberRule(deps, toolName, finalInput, resolution.rememberFor)
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
    ...(deps.sessionKind ? { sessionKind: deps.sessionKind } : {}),
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
      ...(deps.sessionKind ? { sessionKind: deps.sessionKind } : {}),
      ...(options.mcpServer?.source !== undefined ? { mcpSource: options.mcpServer.source } : {}),
    },
  )
  return verdict.outcome === "deny" ? verdict : undefined
}

/**
 * C-013: a new grant's limits. Unless you chose otherwise: 30 days, in this session's folder, any number of uses.
 */
export function grantLimitsFor(
  rememberFor: RememberFor | undefined,
  cwd: string,
  now = Date.now(),
): GrantLimits {
  const days = rememberFor?.days === undefined ? DEFAULT_GRANT_DAYS : rememberFor.days
  return {
    ...(days !== null ? { expiresAt: new Date(now + days * 86_400_000).toISOString() } : {}),
    ...(rememberFor?.anywhere ? {} : { scope: cwd }),
    ...(rememberFor?.maxUses !== undefined ? { maxUses: rememberFor.maxUses } : {}),
  }
}

async function rememberRule(
  deps: CanUseDeps,
  toolName: string,
  input: Record<string, unknown>,
  rememberFor?: RememberFor,
): Promise<void> {
  if (!deps.localRulesPath) return
  try {
    const ctx = {
      cwd: deps.cwd,
      ...(deps.projectRoot !== undefined ? { projectRoot: deps.projectRoot } : {}),
      ...(deps.sessionKind ? { sessionKind: deps.sessionKind } : {}),
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
    const { id, added } = await appendRemember(
      deps.localRulesPath,
      check.candidate,
      undefined,
      grantLimitsFor(rememberFor, deps.cwd),
    )
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
  // Extreme approval never waits on you (owner, 30 Oct): the recommended answer, or the plan approved, recorded first.
  const answers = kind === "question" ? recommendedAnswers(input) : {}
  if (deps.extreme?.() === true && answers) {
    const written = await deps.audit.record({
      session: deps.sessionId,
      event: kind === "question" ? "question_answered" : "plan_decision",
      channel: "host",
      tool: toolName,
      toolUseId: toolUseID,
      cwd: deps.cwd,
      project: deps.project,
      input: kind === "question" ? { ...input, answers } : input,
      verdict: {
        ...verdict,
        outcome: "allow",
        decidedBy: "extreme-mode",
        reason:
          kind === "question"
            ? "Answered with the recommended option, because Extreme approval is on."
            : "Plan approved, because Extreme approval is on.",
      },
      latencyMs: 0,
    })
    if (!written)
      return deny(
        "The decision could not be recorded in the audit log, so it was not applied.",
        toolUseID,
      )
    return allow(kind === "question" ? { ...input, answers } : input, toolUseID)
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
