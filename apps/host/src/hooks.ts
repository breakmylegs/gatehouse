import {
  fromOutside,
  TAINT_RULE,
  UNTRUSTED_FILES,
  withProvenance,
  type Provenance,
} from "./provenance.js"
import { vulnReason, type VulnCommitGuard } from "./vuln-snapshot.js"
import { compileGlobs } from "@gatehouse/policy"

const untrusted = (globs: readonly string[]) => compileGlobs(globs.map((g) => g.toLowerCase()))
import {
  makesCommit,
  scanCommit,
  makesPush,
  secretReason,
  SECRET_IN_COMMIT_RULE,
  type Found,
} from "./commit-scan.js"
import type { HookCallback, HookJSONOutput } from "@anthropic-ai/claude-agent-sdk"
import { evaluateFloor, type Policy, type PwshWorker } from "@gatehouse/policy"
import type { Verdict } from "@gatehouse/shared"
import type { ApproverClient } from "./approver-client.js"
import type { CheckpointManager } from "./checkpoints.js"
import type { GrantUses } from "./grant-uses.js"
import { LOCKED_TEST_RULE, lockedReason, type TestLocks } from "./test-locks.js"
import { sastReason, type SastCommitGuard } from "./sast.js"
import { INSTRUCTIONS_RULE, instructionsReason, type InstructionPins } from "./instruction-pins.js"
import { quarantined, scanForInjection, type InjectionFinding } from "./injection-scan.js"
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

/**
 * Manual mode (owner decision 1 Nov, O14, CLAUDE.md invariant 2): the hook answers ask once the floor passes, so every
 * call reaches canUseTool and the Approver. Claude Code ranks deny above ask above allow, so a plugin's or settings'
 * PreToolUse hook answering allow can no longer skip the Approver.
 *
 * Plan mode too (2 Nov, owner delegated; Agent SDK permissions page, checked 2 Nov): plan mode does not refuse
 * edits, it sends them to canUseTool, and where auto mode is available its classifier can approve read-only calls such
 * as WebFetch before canUseTool sees them, which would skip the Approver's check of what leaves the computer. Asking
 * sends every call to canUseTool, which denies file edits in Plan mode (canuse.ts).
 */
export const ASK_ALWAYS_MODES: ReadonlySet<string> = new Set(["default", "plan"])

/** Modes in which Claude Code approves calls by itself, so the hook has to bring the Approver in. */
export const SELF_APPROVING_MODES: ReadonlySet<string> = new Set(["acceptEdits", "auto"])
/** From High risk up, a request is asked even in Auto and Accept edits (the same bands as everywhere in Codehouse). */
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
  /** C-013: counts the uses of remembered rules that have a limit. */
  grants?: GrantUses
  /** D-007: the locked tests, and the calls a person approved that touched them. */
  locks?: Pick<TestLocks, "touched" | "repin">
  /** D-062: the Severe findings in what a commit would add; in Auto and Accept edits such a commit is asked about. */
  sast?: Pick<SastCommitGuard, "severe">
  /** D-057: the same for dependency versions the vulnerability snapshot lists. */
  vulns?: Pick<VulnCommitGuard, "matches">
  lockedCalls?: Map<string, string[]>
  /** D-059: what the project tells Claude, and the calls a person approved that changed it. */
  instructions?: Pick<InstructionPins, "touched" | "repin">
  instructionCalls?: Map<string, string[]>
  /** toolUseIDs that went through canUseTool, so PostToolUse can tell which calls Claude Code approved itself. */
  decided: Set<string>
  /** The session's permission mode now. In acceptEdits and auto the hook asks the Approver too. */
  mode?: () => string
  /** The Approver, for the modes in which Claude Code would otherwise decide alone. */
  approver?: Pick<ApproverClient, "evaluate">
  projectRoot?: string
  /** A chat or a coding session, for rules scoped to one (CH-03, ADR 0012). */
  sessionKind?: "code" | "chat"
  /** The Approver's verdict by toolUseID, so canUseTool uses it instead of asking again (one decision, one record). */
  verdicts?: Map<string, Verdict>
  /** Session events for the UI: notification, stop, subagent start and stop. */
  onEvent: (
    type: "notification" | "stop" | "subagent_start" | "subagent_stop",
    data: Record<string, unknown>,
  ) => void
  /** Each tool call's verdict, for the line under it in the transcript. */
  onDecision?: (toolUseId: string, verdict: Verdict) => void
  /** B32: what the session read from outside, to catch a command copied from it. */
  provenance?: Provenance
  /** D-018: a call Claude Code approved by itself, with the verdict the Approver gave it. */
  onSelfApproved?: (verdict: Verdict) => void
  /** D-015: the files whose words are not the project's own (globs). Absent: UNTRUSTED_FILES. */
  untrustedFiles?: () => readonly string[]
  /** A file the session wrote or edited, by its path, so its pane can open it even outside the folder (owner, 4 Nov). */
  onWritten?: (filePath: string) => void
  /** D-030: the session made a commit, in this folder. */
  onCommitted?: (cwd: string) => void
  /** D-008: what a shell command printed, read for counterexamples. */
  onToolOutput?: (tool: string, output: string) => void
  /** G19: how each call ended: with the error when it failed, undefined when it worked. */
  /** D-061: a result that looked like prompt injection, for the screen and the record. */
  onInjection?: (tool: string, findings: InjectionFinding[], toolUseId?: string) => void
  /** D-003: how a shell command ended (the error when it failed), for the change's evidence. */
  onCommandEnded?: (toolUseId: string, error: string | undefined) => void
  /** G19, D-075: how each call ended; words returned go to Claude with the call's result (a warning it is repeating). */
  onToolOutcome?: (tool: string, input: unknown, error: string | undefined) => string | undefined
  /** G22: commits are checked for secrets unless this is false (tests only). */
  scanCommits?: boolean
  /** Tests only: stands in for reading the commit. */
  commitScanner?: (cwd: string, command: string) => Promise<Found[]>
  log: (line: string) => void
}

/**
 * The PreToolUse floor. Claude Code approves some calls on its own (reads inside the working folder,
 * read-only commands) and those never reach canUseTool, so this hook is the one place that sees every call.
 * It denies what the floor covers. In Auto and Accept edits, where Claude Code approves much more by itself, it
 * also asks the Approver: what your rules deny is denied, and a High or Severe escalation, or one the Approver
 * could not decide, is asked, which sends it through canUseTool to a person. In Manual mode every call that passes the
 * floor is asked, so it reaches the Approver whatever another hook says. Anything else is left to the mode.
 * It never allows. If anything goes wrong it denies, which keeps it fail closed.
 */
export function createFloorHook(deps: SessionHookDeps): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return NO_DECISION
    try {
      const toolInput = asRecord(input.tool_input)
      const cwd = typeof input.cwd === "string" && input.cwd !== "" ? input.cwd : deps.cwd
      // D-017: a subagent is starting; what it reads while it runs taints what it reports.
      if (input.tool_name === "Task" || input.tool_name === "Agent") deps.provenance?.subagentStarted(String(input.tool_use_id))
      if (deps.kill())
        return denyOutput(
          "The Codehouse kill switch is engaged. Everything is denied until the user re-arms it.",
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
      // G22: a commit that would add a secret is refused; one that cannot be checked goes to a person. D-058: a push too.
      if (deps.scanCommits !== false && (makesCommit(input.tool_name, toolInput) || makesPush(input.tool_name, toolInput))) {
        let found: Found[]
        try {
          found = await (deps.commitScanner ?? scanCommit)(cwd, String(toolInput.command))
        } catch {
          return askOutput(
            "Codehouse could not check this commit or push for secrets, so it asks you before it runs.",
          )
        }
        if (found.length) {
          const reason = secretReason(found)
          await deps.audit.record({
            session: deps.sessionId,
            event: "floor_deny",
            channel: "host",
            tool: input.tool_name,
            toolUseId: input.tool_use_id,
            cwd,
            input: toolInput,
            verdict: {
              outcome: "deny",
              ruleId: SECRET_IN_COMMIT_RULE,
              reason,
              risk: 100,
              decidedBy: "floor",
              policyHash: policy?.hash ?? "none",
            },
            latencyMs: 0,
          })
          return denyOutput(`${reason} (rule ${SECRET_IN_COMMIT_RULE})`)
        }
      }
      // The call passed the floor. If it is an edit, take a checkpoint at the start of a burst of edits.
      await deps.checkpoints?.noteEdit(deps.sessionId, cwd, input.tool_name)
      // G27: and if it is a command that would delete files or throw work away, an undo point before it runs.
      await deps.checkpoints?.beforeEffects(deps.sessionId, cwd, input.tool_name, toolInput)
      const mode = deps.mode?.() ?? "default"
      // D-007: a call that would change a locked test is asked in these modes too; canUseTool records and decides it.
      if (SELF_APPROVING_MODES.has(mode) && deps.locks) {
        const files = await deps.locks
          .touched(cwd, input.tool_name, toolInput)
          .catch(() => ["(the locks could not be read)"])
        if (files.length) return askOutput(lockedReason(files))
      }
      // D-059: and so is a change to what the project tells Claude.
      if (SELF_APPROVING_MODES.has(mode) && deps.instructions) {
        let files: string[]
        try {
          files = deps.instructions.touched(cwd, input.tool_name, toolInput)
        } catch {
          files = ["(the instruction files could not be read)"]
        }
        if (files.length) return askOutput(instructionsReason(files))
      }
      if (deps.approver && SELF_APPROVING_MODES.has(mode) && !NOT_JUDGED.has(input.tool_name)) {
        const judged = await deps.approver.evaluate(
          { toolName: input.tool_name, input: toolInput },
          {
            cwd,
            sessionId: deps.sessionId,
            toolUseId: input.tool_use_id,
            ...(deps.projectRoot !== undefined ? { projectRoot: deps.projectRoot } : {}),
            ...(deps.sessionKind ? { sessionKind: deps.sessionKind } : {}),
            ...(input.mcp_server?.source !== undefined
              ? { mcpSource: input.mcp_server.source }
              : {}),
          },
        )
        // B32: a command copied from what Claude read goes to a person, even in these modes.
        const verdict = withProvenance(judged, input.tool_name, toolInput, deps.provenance, cwd)
        deps.verdicts?.set(input.tool_use_id, verdict)
        deps.onDecision?.(input.tool_use_id, verdict)
        if (verdict.outcome === "deny")
          return denyOutput(`${verdict.reason} (rule ${verdict.ruleId})`)
        // D-062: a commit of code rated Severe reaches canUseTool, which sends it to a person.
        if (deps.sast && makesCommit(input.tool_name, toolInput)) {
          const severe = await deps.sast
            .severe(cwd, String(toolInput.command))
            .catch(() => [{ file: "(the commit could not be read)", line: 0, kind: "eval" as const, severity: "Severe" as const, title: "Not checked" }])
          if (severe.length) return askOutput(sastReason(severe))
        }
        if (deps.vulns && makesCommit(input.tool_name, toolInput)) {
          const found = await deps.vulns
            .matches(cwd, String(toolInput.command))
            .catch(() => [{ name: "(a lockfile could not be read)", version: "", ecosystem: "", ids: ["not checked"], lockfile: "" }])
          if (found.length) return askOutput(vulnReason(found))
        }
        // C-013: a remembered rule that has used its allowed number of calls asks instead.
        if (deps.grants?.spent(verdict, input.tool_use_id))
          return askOutput(deps.grants.reason(verdict.ruleId))
        if (
          verdict.outcome === "escalate" &&
          (verdict.risk >= ASK_FROM_RISK ||
            COULD_NOT_DECIDE.has(verdict.ruleId) ||
            verdict.ruleId === TAINT_RULE)
        )
          return askOutput(
            `Codehouse asks about this even in ${mode === "auto" ? "Auto" : "Accept edits"} mode: ${verdict.reason}`,
          )
      }
      if (ASK_ALWAYS_MODES.has(mode))
        return askOutput(
          `Codehouse's Approver decides every call in ${mode === "plan" ? "Plan" : "Manual"} mode.`,
        )
      return NO_DECISION
    } catch (e) {
      deps.log(`floor hook failed (${(e as Error).name}), the call was blocked`)
      return denyOutput("The Codehouse floor check failed, so this call was blocked.")
    }
  }
}

const SELF_APPROVED: Omit<Verdict, "policyHash"> = {
  outcome: "allow",
  ruleId: "claude-code-auto",
  reason:
    "Claude Code approved this itself (a read inside the working folder, a read-only command or a managed rule). The Codehouse floor had already checked it.",
  risk: 0,
  decidedBy: "rules",
}

/** Audits calls that ran without ever reaching canUseTool (invariant 13), from PostToolUse. */
/** The tools that write a file Claude made or changed. */
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"])

export function createPostToolHook(deps: SessionHookDeps): HookCallback {
  // D-075: words for Claude about the call just ended (it is repeating itself), by tool use id, for the hook's answer.
  const notes = new Map<string, string>()
  // D-061: a result with prompt injection in it, as Claude is to read it instead, by tool use id.
  const replacements = new Map<string, string>()
  /** D-061: a result from an untrusted source, scanned; a finding raises the taint, is told, and replaces what Claude reads. */
  const scan = (id: string, tool: string, response: unknown, where: string) => {
    let text: string
    try {
      text = typeof response === "string" ? response : JSON.stringify(response)
    } catch {
      return
    }
    const findings = scanForInjection(text.slice(0, 400_000))
    if (!findings.length) return
    deps.provenance?.raise(`${where} that held what looks like prompt injection`)
    deps.onInjection?.(tool, findings, id)
    replacements.set(id, quarantined(text.slice(0, 400_000), findings))
  }
  const inner: HookCallback = async (input) => {
    if (input.hook_event_name !== "PostToolUse" && input.hook_event_name !== "PostToolUseFailure")
      return NO_DECISION
    try {
      // G19: the loop guard hears how each call ended.
      const note = deps.onToolOutcome?.(
        input.tool_name,
        input.tool_input,
        input.hook_event_name === "PostToolUseFailure" && input.is_interrupt !== true
          ? String(input.error ?? "")
          : undefined,
      )
      if (note) notes.set(String(input.tool_use_id), note)
      const interrupted = input.hook_event_name === "PostToolUseFailure" && input.is_interrupt === true
      if ((input.tool_name === "Bash" || input.tool_name === "PowerShell") && !interrupted)
        deps.onCommandEnded?.(
          String(input.tool_use_id),
          input.hook_event_name === "PostToolUseFailure" ? String(input.error ?? "failed") : undefined,
        )
      // D-017: a subagent's report carries the taint of what it read.
      if (input.hook_event_name === "PostToolUse" && (input.tool_name === "Task" || input.tool_name === "Agent"))
        deps.provenance?.subagentFinished(String(input.tool_use_id), input.tool_response)
      // B32: what came from outside is remembered, so a command copied from it can be caught.
      if (input.hook_event_name === "PostToolUse" && fromOutside(input.tool_name))
        scan(String(input.tool_use_id), input.tool_name, input.tool_response, input.tool_name === "WebFetch" ? "a fetched page" : `a result from ${input.tool_name}`)
      if (input.hook_event_name === "PostToolUse" && fromOutside(input.tool_name))
        deps.provenance?.add(
          input.tool_response,
          input.tool_name === "WebFetch" && typeof asRecord(input.tool_input).url === "string"
            ? `the page ${String(asRecord(input.tool_input).url).slice(0, 120)}`
            : `what ${input.tool_name} returned`,
        )
      // D-015: a file that is not the project's own words (a README, a dependency's code), read in the session.
      if (input.hook_event_name === "PostToolUse" && input.tool_name === "Read" && deps.provenance) {
        const file = asRecord(input.tool_input).file_path
        if (typeof file === "string" && untrusted(deps.untrustedFiles?.() ?? UNTRUSTED_FILES)(file.replace(/\\/g, "/").toLowerCase()))
          deps.provenance.addUntrustedFile(input.tool_response, file)
          scan(String(input.tool_use_id), input.tool_name, input.tool_response, `the file ${file}`)
      }
      // D-030: a commit the session made gets a note of its approvals' lineage.
      if (input.hook_event_name === "PostToolUse" && makesCommit(input.tool_name, asRecord(input.tool_input)))
        deps.onCommitted?.(typeof input.cwd === "string" && input.cwd !== "" ? input.cwd : deps.cwd)
      // D-008: a shell command's output, read for a property test's or a fuzz run's counterexample.
      if (deps.onToolOutput && (input.tool_name === "Bash" || input.tool_name === "PowerShell")) {
        const r = input.hook_event_name === "PostToolUse" ? input.tool_response : (input as { error?: unknown }).error
        const text = typeof r === "string" ? r : JSON.stringify(r ?? "")
        if (text) deps.onToolOutput(input.tool_name, text.slice(0, 200_000))
      }
      if (input.hook_event_name === "PostToolUse" && WRITE_TOOLS.has(input.tool_name)) {
        const p = asRecord(input.tool_input)
        const file = p.file_path ?? p.notebook_path
        if (typeof file === "string" && file) deps.onWritten?.(file)
      }
      // D-018: a call Claude Code approved by itself (it never reached canUseTool) spends the risk budget.
      const early = deps.verdicts?.get(input.tool_use_id)
      if (early && !deps.decided.has(input.tool_use_id) && input.hook_event_name === "PostToolUse")
        deps.onSelfApproved?.(early)
      deps.verdicts?.delete(input.tool_use_id)
      // D-007: a locked test changed with a person's approval is pinned again as it now is, and that is recorded.
      const cwd = typeof input.cwd === "string" && input.cwd !== "" ? input.cwd : deps.cwd
      const locked = deps.lockedCalls?.get(input.tool_use_id)
      if (input.hook_event_name === "PostToolUse" && locked && deps.locks) {
        deps.lockedCalls?.delete(input.tool_use_id)
        await deps.locks.repin(cwd, locked).catch(() => undefined)
        await deps.audit.record({
          session: deps.sessionId,
          event: "test_lock_repinned",
          channel: "host",
          tool: input.tool_name,
          toolUseId: input.tool_use_id,
          cwd,
          input: { files: locked },
          verdict: {
            outcome: "allow",
            ruleId: LOCKED_TEST_RULE,
            reason: "A locked test was changed with your approval, so it is locked as it now is.",
            risk: 0,
            decidedBy: "rules",
            policyHash: deps.policy()?.hash ?? "none",
          },
          latencyMs: 0,
        })
      }
      // D-059: so is an instruction file a person approved changing, and that is recorded.
      const instructed = deps.instructionCalls?.get(input.tool_use_id)
      if (input.hook_event_name === "PostToolUse" && instructed && deps.instructions) {
        deps.instructionCalls?.delete(input.tool_use_id)
        await deps.instructions.repin(cwd, instructed).catch(() => undefined)
        await deps.audit.record({
          session: deps.sessionId,
          event: "instructions_repinned",
          channel: "host",
          tool: input.tool_name,
          toolUseId: input.tool_use_id,
          cwd,
          input: { files: instructed },
          verdict: {
            outcome: "allow",
            ruleId: INSTRUCTIONS_RULE,
            reason: "What the project tells Claude was changed with your approval, so it is pinned as it now is.",
            risk: 0,
            decidedBy: "rules",
            policyHash: deps.policy()?.hash ?? "none",
          },
          latencyMs: 0,
        })
      }
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
  return async (input, toolUseId, options) => {
    const out = await inner(input, toolUseId, options)
    const id = String((input as { tool_use_id?: unknown }).tool_use_id ?? "")
    const note = notes.get(id)
    const replaced = replacements.get(id)
    if (!note && !replaced) return out
    notes.delete(id)
    replacements.delete(id)
    // It decides nothing: it only adds to, or (D-061) cleans, what Claude reads with the call's result.
    return {
      hookSpecificOutput: {
        hookEventName: input.hook_event_name as "PostToolUse" | "PostToolUseFailure",
        ...(note ? { additionalContext: note } : {}),
        ...(replaced && input.hook_event_name === "PostToolUse" ? { updatedToolOutput: replaced } : {}),
      },
    }
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
