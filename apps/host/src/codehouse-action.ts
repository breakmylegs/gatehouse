/**
 * Frontier build, section 6: a command Codehouse runs itself (a claim's rerun, the held-out checks, and later mutation
 * runs, fuzzing and the like). Each one:
 *   - is judged by the policy engine exactly as the same shell command from the session would be: a deny is refused,
 *     an escalation asks a person (or Extreme approval approves it, by the same rules as for the session's own calls),
 *   - runs with no credential in its environment,
 *   - runs inside a job at the session's resource level (Codehouse-Limits.exe, where it can be had),
 *   - stops on the kill switch, and is not started while it is on,
 *   - is recorded in the audit log with its outcome.
 */
import { spawn, type ChildProcess } from "node:child_process"
import crypto from "node:crypto"
import type { ResourceLevel } from "@gatehouse/shared/ws-protocol"
import type { ApproverClient } from "./approver-client.js"
import type { Broker } from "./broker.js"
import { NEVER_AUTO_APPROVED } from "./canuse.js"
import type { HostAudit } from "./hostaudit.js"
import { levelArgs } from "./limits.js"
import { macActionShell } from "./limits-mac.js" // Mac fork

/** Names in the environment that hold, or may hold, a credential. None reaches a Codehouse action. */
const CREDENTIAL = /TOKEN|SECRET|PASSW(OR)?D|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIAL|^ANTHROPIC_|^CLAUDE_CODE_OAUTH|^AWS_SESSION|^AZURE_CLIENT|^NPM_CONFIG__AUTH|_AUTH$/i

/** The environment with every credential taken out. */
export function withoutCredentials(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !CREDENTIAL.test(k)))
}

export interface ActionRequest {
  sessionId: string
  cwd: string
  project: string
  command: string
  /** What it is for, in a few words: "checking Claude's claim that the tests pass". */
  why: string
  level: ResourceLevel
  timeoutMs?: number
  /** D-010: more for its environment (a check's seed); credentials are taken out of these too. */
  env?: Record<string, string>
}

export interface ActionResult {
  ran: boolean
  /** Why it did not run: refused by the rules, by a person, or the kill switch. */
  refused?: string
  exitCode: number | null
  output: string
  timedOut: boolean
  killed: boolean
  ms: number
}

export interface ActionDeps {
  approver: Pick<ApproverClient, "evaluate">
  broker: Pick<Broker, "request">
  audit: Pick<HostAudit, "record">
  kill: { isEngaged(): boolean }
  /** Extreme approval for the session, read now. */
  extreme: () => boolean
  /** Codehouse-Limits.exe, for the job object; absent: a plain child process (tests, or no helper). */
  limitsExe?: string
  env?: NodeJS.ProcessEnv
  /** Tests only: stands in for starting the command. */
  start?: (command: string, cwd: string, env: NodeJS.ProcessEnv, level: ResourceLevel) => ChildProcess
}

function startCommand(
  d: ActionDeps,
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  level: ResourceLevel,
): ChildProcess {
  if (d.start) return d.start(command, cwd, env, level)
  if (d.limitsExe)
    return spawn(
      d.limitsExe,
      // Mac fork: through sh on a Mac (macActionShell).
      ["--name", `codeh-action-${crypto.randomBytes(4).toString("hex")}`, ...levelArgs(level), "--", ...(macActionShell(command) ?? ["cmd.exe", "/d", "/s", "/c", command])],
      { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    )
  return spawn(command, { cwd, env, shell: true, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
}

export async function runCodehouseAction(r: ActionRequest, d: ActionDeps): Promise<ActionResult> {
  const began = Date.now()
  const done = async (res: Omit<ActionResult, "ms">, decidedBy: string): Promise<ActionResult> => {
    const out = { ...res, ms: Date.now() - began }
    await d.audit
      .record({
        session: r.sessionId,
        event: "codehouse_action",
        channel: "host",
        tool: "Bash",
        cwd: r.cwd,
        project: r.project,
        input: {
          command: r.command,
          why: r.why,
          ran: out.ran,
          ...(out.refused ? { refused: out.refused } : {}),
          exitCode: out.exitCode,
          timedOut: out.timedOut,
          killed: out.killed,
          ms: out.ms,
          level: r.level,
        },
        verdict: {
          outcome: out.ran ? "allow" : "deny",
          ruleId: "codehouse-action",
          reason: out.ran ? `Codehouse ran this for ${r.why}.` : `Codehouse did not run this: ${out.refused}`,
          risk: 0,
          decidedBy: decidedBy as never,
          policyHash: "",
        },
        latencyMs: out.ms,
      })
      .catch(() => undefined)
    return out
  }
  const notRun = (refused: string, by = "rules") =>
    done({ ran: false, refused, exitCode: null, output: "", timedOut: false, killed: false }, by)

  if (d.kill.isEngaged()) return await notRun("the kill switch is engaged")
  // Judged as the same shell command from the session would be.
  const verdict = await d.approver.evaluate({ toolName: "Bash", input: { command: r.command } }, { cwd: r.cwd, sessionId: r.sessionId })
  if (verdict.outcome === "deny") return await notRun(`${verdict.reason} (rule ${verdict.ruleId})`)
  let decidedBy: string = verdict.decidedBy
  if (verdict.outcome === "escalate") {
    if (d.extreme() && !NEVER_AUTO_APPROVED.has(verdict.ruleId)) decidedBy = "extreme-mode"
    else {
      const resolution = await d.broker.request({
        kind: "permission",
        sessionId: r.sessionId,
        toolUseId: `codehouse-action-${crypto.randomBytes(6).toString("hex")}`,
        toolName: "Bash",
        input: { command: r.command, description: `Codehouse would run this itself, for ${r.why}.` },
        cwd: r.cwd,
        project: r.project,
        verdict: { ...verdict, reason: `Codehouse would run this itself, for ${r.why}. ${verdict.reason}` },
        defaultToNo: verdict.risk >= 70,
      })
      if (resolution.outcome !== "allow") return await notRun("a person did not allow it", "human-desktop")
      // Codehouse runs exactly what it showed: an edited command is not run.
      if (resolution.updatedInput && resolution.updatedInput.command !== r.command)
        return await notRun("the command was edited; Codehouse runs only what it showed", "human-desktop")
      decidedBy = resolution.channel === "phone" ? "human-phone" : "human-desktop"
    }
  }
  if (d.kill.isEngaged()) return await notRun("the kill switch is engaged")

  const child = startCommand(d, r.command, r.cwd, withoutCredentials({ ...(d.env ?? process.env), ...(r.env ?? {}) }), r.level)
  let output = ""
  const keep = (b: Buffer) => {
    if (output.length < 400_000) output += b.toString("utf8")
  }
  child.stdout?.on("data", keep)
  child.stderr?.on("data", keep)
  let timedOut = false
  let killed = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill()
  }, r.timeoutMs ?? 10 * 60_000)
  // The kill switch stops it at once.
  const watch = setInterval(() => {
    if (d.kill.isEngaged() && !killed) {
      killed = true
      child.kill()
    }
  }, 250)
  const exitCode = await new Promise<number | null>((resolve) => {
    child.on("close", (code) => resolve(code))
    child.on("error", () => resolve(null))
  })
  clearTimeout(timer)
  clearInterval(watch)
  return await done({ ran: true, exitCode, output, timedOut, killed }, decidedBy)
}
