import { noteCommit } from "./lineage.js"
import { UNTRUSTED_FILES, type RuleTerms } from "./provenance.js"
import type { ActionRequest, ActionResult } from "./codehouse-action.js"
import { CLAIM_WORDS, commandFor, findClaims, type ClaimKind, type ClaimOutcome } from "./claims.js"
import { CounterexamplePins } from "./counterexample-pins.js"
import type { TestLocks } from "./test-locks.js"
import { InstructionsChangedError, type InstructionPins } from "./instruction-pins.js"
import type { HeavyJob } from "./memory-governor.js"
import { BYPASS_MAX_MINUTES, BYPASS_MAX_USD, type LimitBypass } from "./limit-pause.js"
import { EventEmitter } from "node:events"
import crypto from "node:crypto"
import os from "node:os"
import { aboveCap, capEffort, Effort, type Verdict } from "@gatehouse/shared"
import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import type { Options, Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import {
  findProjectRoot,
  redactString,
  type Policy,
  type PwshWorker,
  type PolicyEngine,
} from "@gatehouse/policy"
import { projectName, sanitiseEnv, uuidv7 } from "@gatehouse/shared"
import type { GatehouseConfig } from "@gatehouse/shared/node"
import { checkOrg, type AccountMonitor, type QueryFn } from "./account.js"
import type { ApproverClient } from "./approver-client.js"
import type { Broker } from "./broker.js"
import { createCanUseTool } from "./canuse.js"
import type { CheckpointManager } from "./checkpoints.js"
import type { GrantUses } from "./grant-uses.js"
import {
  createEventHook,
  createFloorHook,
  createPostToolHook,
  type SessionHookDeps,
} from "./hooks.js"
import type { HostAudit } from "./hostaudit.js"
import type { HostKillSwitch } from "./kill.js"
import { pluginsWithMods } from "./marketplace.js"
import { inClaudeRange, rangeText } from "./claude-range.js"
import type { Worktrees } from "./worktrees.js"
import type { SessionLink } from "./about-session.js"
import { LoopGuard, LOOP_REPEATS } from "./loop-guard.js"
import { STUCK_MS, StuckWatch } from "./stuck-watch.js"
import {
  assertSafeOptions,
  isAllowedMode,
  isShadowSystemMessage,
  isShadowWarning,
  watchShadowWarning,
  outOfProcessServers,
  SafetyError,
  type SessionMode,
} from "./safety.js"
import type { UsageStore } from "./usage.js"
import { LEVELS, type Limiter, type ResourceLevel } from "./limits.js"
import { decideElicitation } from "./elicitation.js"
import { readAgentsMd } from "./agents-md.js"
import { Provenance } from "./provenance.js"
import { MAIN_ACCOUNT, type Accounts } from "./accounts.js"
import {
  CARRY_ON_PROMPT,
  CarryOn,
  carryOnLimits,
  LIMIT_RESUME_PROMPT,
  RESUME_PROMPT,
  saysQueueEmpty,
  goalOk,
  goalPrompt,
  type CarryOnStatus,
} from "./carry-on.js"
import { planLimits, type PlanUsage } from "./plan-usage.js"
import { composeInstructions, type ProjectStore } from "./projects.js"
import type { ArtifactStore } from "./artifacts.js"
import type { MemoryStore } from "./memory.js"
import { CRASH_RESUME_PROMPT, CrashRestarts, describeStop, isProcessCrash } from "./crash.js"

export class OrgGuardError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}
/** The folder for a new session cannot be used or made. */
export class SessionFolderError extends Error {}

/** B37: IT's signed policy could not be checked, so no session may start. */
export class ManagedPolicyError extends Error {
  constructor(why: string) {
    super(
      `Your IT team's policy for Codehouse is on this computer but could not be checked (${why.replace(/^managed policy: /, "")}), so no session can start. Ask IT to put it right; nothing else needs doing here.`,
    )
  }
}

/** B09: as many sessions are open as Settings allows; another waits until one is closed. */
export class SessionLimitError extends Error {
  constructor(readonly limit: number) {
    super(
      `${limit} session${limit === 1 ? " is" : "s are"} open, the most Settings allows at once. Close one, or raise the limit in Settings, Sessions.`,
    )
  }
}

/** A chat stays in Plan mode: it can read and search, never change files or run commands. */
export class ChatModeError extends Error {
  constructor() {
    super(
      "A chat stays in Plan mode, so it never changes files or runs commands. Start a coding session for that.",
    )
  }
}

/**
 * Makes sure the project folder exists. A folder that is missing is created, with any parent folders it needs, so
 * a whole new path can be typed in. A relative path, a path that is a file, or a drive that is not there is
 * refused with a plain message (a missing folder otherwise shows up as a misleading "program failed to launch").
 */
export function ensureFolder(cwd: string, log: (line: string) => void = () => undefined): void {
  if (!path.isAbsolute(cwd))
    throw new SessionFolderError(
      `"${cwd}" is not a full folder path. Type the whole path, for example C:\\dev\\my-project.`,
    )
  let stat: fs.Stats | undefined
  try {
    stat = fs.statSync(cwd)
  } catch {
    stat = undefined
  }
  if (stat) {
    if (!stat.isDirectory()) throw new SessionFolderError(`"${cwd}" is a file, not a folder.`)
    return
  }
  const root = path.parse(path.resolve(cwd)).root
  if (!fs.existsSync(root))
    throw new SessionFolderError(
      `The drive ${root} does not exist, so the folder cannot be created.`,
    )
  try {
    fs.mkdirSync(cwd, { recursive: true })
  } catch (e) {
    throw new SessionFolderError(
      `The folder "${cwd}" could not be created: ${(e as Error).message}`,
    )
  }
  log(`created the project folder ${cwd}`)
}

/** cwd, or cwd-2, cwd-3 and so on: the first that does not exist, or (unless emptyIsFree is false) is empty. */
export function freeFolder(cwd: string, emptyIsFree = true): string {
  const free = (p: string) => {
    if (!fs.existsSync(p)) return true
    if (!emptyIsFree) return false
    try {
      return fs.statSync(p).isDirectory() && fs.readdirSync(p).length === 0
    } catch {
      return false
    }
  }
  if (free(cwd)) return cwd
  for (let n = 2; n < 100; n++) if (free(`${cwd}-${n}`)) return `${cwd}-${n}`
  throw new SessionFolderError(
    `There are already 99 projects called ${path.basename(cwd)}. Choose another name.`,
  )
}

const sameFolder = (a: string, b: string) =>
  path
    .resolve(a)
    .replace(/[\\/]+$/, "")
    .toLowerCase() ===
  path
    .resolve(b)
    .replace(/[\\/]+$/, "")
    .toLowerCase()

/** git init, so checkpoints work from the first edit. A failure is logged; the project still starts. */
function gitInit(cwd: string, log: (line: string) => void): Promise<void> {
  return new Promise((resolve) =>
    execFile("git", ["init", "--quiet"], { cwd, windowsHide: true, timeout: 30_000 }, (e) => {
      if (e)
        log(`git init failed in ${cwd} (${e.message.split("\n")[0]}); checkpoints are off there`)
      resolve()
    }),
  )
}

export class KillSwitchEngagedError extends Error {
  constructor() {
    super("The kill switch is engaged. Re-arm it on the desktop before starting a session.")
  }
}

/** Owner, 9 Nov: a message to a session a limit paused; going on needs a bypass for this session. */
/**
 * D-001: whether a project is strict about its tests, so Extreme approval waits for a person on a weakening. By name,
 * the folder's, as policy overlays are; or every project.
 */
export function strictAboutTests(
  s: { strictAll?: boolean; strictProjects?: string[] } | undefined,
  project: string,
): boolean {
  if (s?.strictAll === true) return true
  const p = project.trim().toLowerCase()
  return (s?.strictProjects ?? []).some((n) => typeof n === "string" && n.trim().toLowerCase() === p)
}

/** D-007: locked tests changed outside Codehouse; no session starts in the project until the owner accepts them. */
export class LockedTestsChangedError extends Error {
  constructor(readonly files: string[]) {
    super(
      `Locked tests were changed outside Codehouse since they were locked: ${files.slice(0, 5).join(", ")}${files.length > 5 ? ` and ${files.length - 5} more` : ""}. Look at the changes, then accept the new versions to start a session here.`,
    )
  }
}

/** D-059: a change outside Codehouse to what a project tells Claude, recorded (the files, never their words). */
async function recordInstructionsChanged(
  audit: HostAudit,
  session: string,
  cwd: string,
  project: string | undefined,
  files: string[],
): Promise<void> {
  await audit
    .record({
      session,
      event: "instructions_changed",
      channel: "host",
      tool: "instructions",
      cwd,
      ...(project ? { project } : {}),
      input: { files, by: "outside" },
      verdict: {
        outcome: "escalate",
        ruleId: "instructions-edit",
        reason: "What this project tells Claude changed outside Codehouse, so nothing starts until you approve the change.",
        risk: 80,
        decidedBy: "rules",
        policyHash: "",
      },
      latencyMs: 0,
    })
    .catch(() => false)
}

export class LimitPausedError extends Error {
  constructor(reason?: "spend" | "risk" | "heartbeat") {
    super(
      reason === "risk"
        ? "This session is paused: its risk budget is spent. Start it again from its pane when you have looked at what it did."
        : reason === "heartbeat"
          ? "This session is paused: nothing was heard from you within its dead-man time. Start it again from its pane when you have looked at what it did."
          : reason === "spend"
          ? "This session is paused: today's spending reached the most Settings allows a day. Bypass the limits for this session, with a time or a most it may spend, to keep going."
          : "This session is paused at the plan limit set in Settings. Bypass the limits for this session, with a time or a most it may spend, to keep going.",
    )
  }
}

export type SessionState = "starting" | "idle" | "running" | "waiting" | "error" | "ended"

export interface SessionInfo {
  id: string
  cwd: string
  project: string
  /** Absent for a coding session. */
  kind?: "code" | "chat"
  model?: string
  mode: SessionMode
  effort?: Effort
  extreme?: boolean
  state: SessionState
  sdkSessionId?: string
  pendingApprovals: number
  createdAt: string
  error?: string
  /** Yours: a title, a pin, archived. */
  title?: string
  pinned?: boolean
  archived?: boolean
  /** The project it is grouped under in the sidebar. */
  group?: string
  /** The most effort Settings allows (B18). Absent: no cap. */
  effortCap?: Effort
  /** B25: the check Extreme approval carries on until. */
  goal?: string
  /** The Claude Code conversation this one carries on from: the screen shows what was said there. */
  historyFrom?: string
  /**
   * Brought back after Codehouse restarted or updated, after you force-stopped it, or after its Claude Code crashed, and
   * whether a turn was cut off.
   */
  restarted?: { wasRunning: boolean; forced?: boolean; crashed?: boolean }
  /** What is still working in the background after the turn ended, by description. */
  background?: string[]
  /** O21: the same work with when each began. */
  backgroundTasks?: Array<{ id: string; description: string; startedAt: string }>
  /** C-004: suspended to free memory; Start again brings it back on the same conversation. */
  suspended?: boolean
  /** D-001: how many weakenings of the tests Extreme approval approved in this session. */
  testsWeakened?: number
  /** D-018: what is left of the session's risk budget; absent when it has none. */
  riskBudget?: number
  /** D-025: the dead-man timer, when on. */
  deadman?: { minutes: number; lastHeardFrom: string }
  /** D-009: claims that the work is done, as checked, newest last. */
  claims?: Array<{ kind: string; quote: string; outcome: "verified" | "contradicted" | "unverified"; why: string; command?: string }>
  /** D-008: counterexamples found by the session's test runs, offered to pin as locked regression tests. */
  counterexamples?: Array<{ id: string; framework: string; example: string; writesItself: boolean; test?: string }>
  /** Extreme approval carrying on by itself: turns and spend since your last message, and why it stopped. */
  carryOn?: CarryOnStatus
  /** How much of this computer the session may use. Absent where Codehouse cannot limit it. */
  resources?: ResourceLevel
  /** Which signed-in account it runs on. Absent for the main one. */
  account?: string
  /** You asked to compact while a turn ran: it compacts when the turn ends. */
  compactPending?: boolean
  /** The chat project this chat belongs to. */
  chatProject?: string
  /** The instructions given for this session alone. */
  instructions?: string
  /** A research chat (W1-10). */
  research?: boolean
  /** B39: one run of a plugin's evaluation. */
  evaluation?: { plugin: string; with: boolean }
  /** Runs on a model on this computer, not Claude (ADR 0011). */
  local?: boolean
  /** Where its words go: "On this computer", or a provider through your gateway (ADR 0010). */
  localLabel?: string
  /** D-059: what the project tells Claude changed outside Codehouse and waits for your review. */
  instructionsChanged?: boolean
  /** A fork from a point: its earlier conversation is shown up to this message only. */
  historyUntil?: string
  /** The session it replaced in its pane (Retry and Edit), so Chat keeps both as branches of one conversation. */
  replaces?: string
  /** CH-07: carried on here from an imported claude.ai chat, so it says it is not synced back. */
  forkOf?: { conversation: string; message: string }
  /** Works in a git worktree Codehouse made for it (B10): its branch, and the repository it came from. */
  worktree?: { branch: string; repo: string }
  /** Owner, 9 Nov: your bypass of the limits for this session, while it lasts. */
  bypass?: { since: string; until?: string; maxUsd?: number; spentUsd: number }
  /** Paused at the plan's 5-hour limit: starts again when it resets, or when you start it. */
  paused?: { until?: string; percent: number; wasRunning: boolean; reason?: "spend" | "risk" | "heartbeat" }
}

export interface SessionEvents {
  message: [SDKMessage]
  state: [SessionInfo]
  event: [
    {
      type:
        | "notification"
        | "stop"
        | "subagent_start"
        | "subagent_stop"
        | "decision"
        | "interrupted"
        | "paused"
        | "resumed"
        | "carry_on"
        | "carry_on_end"
        | "load"
        | "queue_empty"
        | "stuck"
        | "bypass_ended"
        | "tests_weakened"
        | "heldout_result"
        | "counterexample_pinned"
        | "claim_checked"
        | "remember_refused"
        | "risk_budget_exhausted"
        | "instructions_changed"
        | "heartbeat_missed"
        | "commit_noted"
      data: Record<string, unknown>
    },
  ]
  /** Its Claude Code process crashed (not a stop Codehouse made), and whether it was working then. */
  crashed: [{ wasRunning: boolean; message: string }]
  /** You sent a message. For the Host only (Chat's store, CH-03): it goes to no screen and no phone. */
  prompted: [string]
}

/**
 * The longest a session may take to start. Seen on this laptop (31 Oct): 40 s to 2 min 43 s each when several came
 * back together, so five minutes is past any slow start and short of a start that is never going to finish.
 */
export const START_TIMEOUT_MS = 300_000


export interface SessionDeps {
  queryFn: QueryFn
  /** Your title, pin and archive for a Claude Code session id. Absent where they are not kept. */
  sessionMeta?: (sdkSessionId: string | undefined) => {
    title?: string
    pinned?: boolean
    archived?: boolean
    group?: string
  }
  /** B37: why IT's signed policy could not be checked, if it could not; then no session starts. */
  managedPolicyProblem?: () => string | undefined
  /** C-004: refuses a new session or chat while this computer's memory is committed over the point in Settings. */
  governor?: { admit(what: HeavyJob, detail?: Record<string, unknown>): Promise<void> }
  /** What a Claude Code session last ran with (model, effort, mode, resources), so Resume starts it the same way. */
  resumeSettings?: (sdkSessionId: string) => {
    model?: string
    effort?: string
    mode?: SessionMode
    extreme?: boolean
    resources?: ResourceLevel
  }
  /** Where chats get their folders: %LOCALAPPDATA%\Gatehouse\chats. Absent where chats are not offered. */
  chatsDir?: string
  /** Runs each session inside a job object with its resource limits. Absent where that is not possible. */
  limiter?: Limiter
  /** The accounts signed in beside the main one. Absent where there is only the main one. */
  accounts?: Accounts
  /** The chat projects: their instructions and knowledge files. Absent where chats have none. */
  projects?: ProjectStore
  /** What chats remember. Absent where chats have no memory. */
  memory?: MemoryStore
  /**
   * Models on this computer (ADR 0011): checks the runtime and the model before a chat starts on one (throws with the
   * reason), and the query that runs it. Absent where other providers are off.
   */
  local?: {
    check: (model: string) => Promise<void>
    queryFn: (model: string) => QueryFn
    /** Where its chats send their words: "On this computer", or a provider through your gateway. */
    label?: () => string
  }
  /** Free memory in bytes, for the warm chat; os.freemem when absent. */
  freeMemory?: () => number
  /** Keeps a chat's first message as its title, by its Claude Code id, so it is named the same after a restart. */
  nameChat?: (sdkSessionId: string, title: string) => Promise<unknown>
  /** What chats show in a sandbox. Absent where chats have no artifacts. */
  artifacts?: ArtifactStore
  /** How long a session may take to start before Codehouse stops waiting. START_TIMEOUT_MS when absent. */
  startTimeoutMs?: number
  config: () => GatehouseConfig
  policy: () => Policy | undefined
  engine: PolicyEngine
  pwsh: PwshWorker | undefined
  audit: HostAudit
  /** The worktrees Codehouse makes for sessions (B10). Absent where there are none (tests). */
  worktrees?: Worktrees
  broker: Broker
  approver: ApproverClient
  kill: HostKillSwitch
  usage: UsageStore
  checkpoints: CheckpointManager
  /** C-013: counts the uses of remembered rules that have a limit. */
  grants?: GrantUses
  /** D-007: the locked tests. */
  locks?: TestLocks
  /** D-059: the pins of what each project tells Claude. */
  instructions?: InstructionPins
  /** D-025, tests only: how long a minute of the dead-man timer is, and how often it is looked at. */
  deadmanMinuteMs?: number
  deadmanLookMs?: number
  /** Section 6: runs a command as Codehouse's own action (D-009's claim checks). */
  codehouseAction?: (r: ActionRequest) => Promise<ActionResult>
  account: AccountMonitor
  /** Owner, 9 Nov: one look at the limits now, so a bypass that has run out pauses the session at once. */
  limitCheck?: () => Promise<void>
  /** Builds the in-process Companion for a session. */
  companion: (s: {
    sessionId: string
    cwd: string
    kind?: "chat"
    chatProject?: string
    /** Ask about code: the code session this chat is about. */
    about?: SessionLink
  }) => Record<string, unknown>
  /** Ask about code: how the linked session stands and the latest of what was said in it, redacted. */
  aboutSaid?: (about: SessionLink) => Promise<string>
  managedDetected: () => Promise<boolean | undefined>
  localRulesPath?: string
  /** Tells the phone about a request that Extreme approval mode approved. */
  notifyAutoApproved?: (toolName: string, project: string) => void
  log: (line: string) => void
}

export interface StartSessionOptions {
  cwd: string
  model?: string
  mode?: SessionMode
  effort?: Effort
  extreme?: boolean
  resume?: string
  fork?: boolean
  /** A new project in the projects folder: the folder must be new (a number is added if the name is taken). */
  freshFolder?: boolean
  /** A chat, not a coding session: it gets a folder of its own under the data folder, named from title. */
  kind?: "code" | "chat"
  /** The first thing said in a chat, which names its folder. */
  title?: string
  /** A chat project: its instructions and knowledge files go with this chat. */
  chatProject?: string
  /** Instructions for this one session, added to the global and project ones. */
  instructions?: string
  /** A research chat (W1-10): it is given the research instruction. Ignored for a coding session. */
  research?: boolean
  /** Ask about code (owner, 6 Nov): a chat about this code session, by its id; the manager looks it up. */
  aboutId?: string
  /** The code session this chat is about, as looked up (or as it was, when a chat comes back after a restart). */
  about?: SessionLink
  /**
   * Brought back after Codehouse restarted: the same id, so the screen finds its panes again, and its original start
   * time. A chat keeps its folder.
   */
  restore?: {
    id: string
    createdAt: string
    wasRunning: boolean
    forced?: boolean
    /** Started again because its Claude Code crashed while it was working. */
    crashed?: boolean
    /** It was paused at the plan limit when Codehouse closed: it comes back still paused, until the limit resets. */
    paused?: NonNullable<SessionInfo["paused"]>
    /** C-004: you started again a session suspended to free memory, so the memory governor is asked first. */
    wake?: boolean
  }
  /** How much of this computer it may use; High (no limits) when not given. */
  resources?: ResourceLevel
  /** The account to run it on; the main one when not given. */
  account?: string
  /** A chat with a model on this computer instead of Claude (ADR 0011). */
  localModel?: string
  /** With resume and fork: carry on from this message (its uuid), for Retry and Edit. */
  resumeAt?: string
  /** The session this one replaces in its pane (Retry and Edit). */
  replaces?: string
  /** CH-07: carried on from an imported chat, at this message of it. */
  forkOf?: { conversation: string; message: string }
  /** Start in a new git worktree of the repository cwd is in, from this base (its current commit when absent). */
  worktree?: { base?: string }
  /** The worktree it works in, once made (set by the manager, not the screen). */
  inWorktree?: { branch: string; repo: string }
  /**
   * B39: a run of a plugin's evaluation. Without it, the plugin is turned off for this session alone (inline settings
   * may only turn things off); with it, the plugin runs as installed.
   */
  evaluation?: { plugin: string; with: boolean }
}

/**
 * Claude's instructions in a chat (owner, 31 Oct, screenshot d3b9c0): a plain conversation with Claude, not a coding
 * session, so this replaces the coding preset altogether. A chat folder is outside your workspace folders and the
 * session is in Plan mode, so nothing can change; this keeps it talking and looking things up.
 */
export const CHAT_PROMPT =
  "You are Claude, made by Anthropic, in a conversation with someone using Codehouse on their Windows computer. This is a chat, not a coding session. Answer in plain, warm, clear language. Look things up on the web when that would help, and say where the information came from. You can read files in your working folder: what the person attaches (mentioned as @ and a path, kept in .codehouse/attachments) and a project's knowledge files. Read a file before answering about it. To show data as a chart or table, make an artifact from it (an svg picture or an html page). You cannot change files or run commands here; if someone wants something built or changed, suggest they start a coding session for it."

/**
 * The built-in tools a chat has: the web, and reading (W1-11: attachments and a project's knowledge files are in its own
 * folder). Nothing that changes a file or runs a command exists in a chat at all.
 */
export const CHAT_TOOLS = ["WebSearch", "WebFetch", "Read", "Glob", "Grep"]

/** The chat's instructions with today's date, which the coding preset would have given Claude. */
export const chatPrompt = (now: Date = new Date()): string =>
  `${CHAT_PROMPT} Today's date is ${now.toISOString().slice(0, 10)}.`

/** A prompt stream the Host pushes user messages into. It makes interrupt, mode and model changes possible. */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  #items: SDKUserMessage[] = []
  #waiting: ((r: IteratorResult<SDKUserMessage>) => void) | undefined
  #closed = false

  push(text: string): void {
    const msg: SDKUserMessage = {
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
    }
    if (this.#waiting) {
      const w = this.#waiting
      this.#waiting = undefined
      w({ value: msg, done: false })
    } else this.#items.push(msg)
  }

  end(): void {
    this.#closed = true
    this.#waiting?.({ value: undefined, done: true })
    this.#waiting = undefined
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.#items.shift()
        if (item) return Promise.resolve({ value: item, done: false })
        if (this.#closed) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve) => (this.#waiting = resolve))
      },
    }
  }
}

/** How a written file is remembered: its full path, resolved against the session folder, in lower case. */
export const writtenKey = (file: string, cwd: string): string =>
  path.resolve(cwd, file).toLowerCase()

export class Session extends EventEmitter<SessionEvents> {
  #memoryGiven: Array<{ id: string; scope: string; topic: string; text: string }> = []
  readonly id: string
  readonly cwd: string
  readonly project: string
  readonly createdAt: string
  readonly #deps: SessionDeps
  readonly #input = new InputQueue()
  readonly #decided = new Set<string>()
  /** The files this session wrote or edited, by full path in lower case, while Codehouse runs. */
  readonly #written = new Set<string>()
  /** G19: the same failure again and again, with nothing changed in between. */
  readonly #loop = new LoopGuard()
  /** O16: a turn with nothing from Claude for two minutes, and nothing waiting for you, is said to be possibly stuck. */
  readonly #stuck = new StuckWatch({
    waiting: () => this.#deps.broker.countFor(this.id) > 0,
    onStuck: () => this.emit("event", { type: "stuck", data: { minutes: STUCK_MS / 60_000 } }),
  })
  /** The Approver's verdicts from the PreToolUse hook (Auto and Accept edits), by toolUseID, for canUseTool. */
  readonly #verdicts = new Map<string, Verdict>()
  /** Background tasks still working (subagents, shell commands), by task id, from Claude Code's own list. */
  /** O21: each task's description and when it began, for how long it has run. */
  readonly #background = new Map<string, { description: string; startedAt: number }>()
  /** Extreme approval's run of automatic turns since your last message. */
  readonly #carry = new CarryOn(() => carryOnLimits(this.#deps.config().extremeCarryOn))
  /** The session's total cost after its last turn, so a run counts only what it spends. */
  #lastCost = 0
  /** You asked to compact while a turn ran: it compacts when the turn ends. */
  #compactAfterTurn = false
  /** Paused at the plan limit: nothing carries on by itself until it starts again. */
  #paused: SessionInfo["paused"]
  /**
   * Owner, 9 Nov: your bypass of the limits for this session, with a time, a spending limit or both. Kept only while
   * the Host runs: after a restart the limits in Settings apply again.
   */
  #bypass: { since: number; until?: number; maxUsd?: number; costAtStart: number } | undefined
  #bypassTimer: NodeJS.Timeout | undefined
  /** D-001: weakenings of the tests Extreme approval approved in this session, which it says. */
  #testsWeakened = 0
  /** D-008: the counterexamples this session's test runs found, to pin as locked regression tests. */
  get #pins(): CounterexamplePins {
    this.#pinsValue ??= new CounterexamplePins({
      sessionId: this.id,
      cwd: this.cwd,
      project: this.project,
      audit: this.#deps.audit,
      ...(this.#deps.locks ? { locks: this.#deps.locks } : {}),
      prompt: (text) => this.prompt(text),
    })
    return this.#pinsValue
  }
  #pinsValue: CounterexamplePins | undefined

  /** D-008: pins one of the counterexamples (the owner chose Pin on the desktop). */
  async pinCounterexample(id: string): Promise<{ file: string; by: string }> {
    const r = await this.#pins.pin(id)
    this.emit("event", { type: "counterexample_pinned", data: { file: r.file, by: r.by } })
    this.emit("state", this.info())
    return r
  }

  /** D-015: why a rule must not be remembered from this session, or undefined. */
  untrustedMention(rule: RuleTerms): string | undefined {
    return this.#provenance.mentions(rule, this.cwd)
  }

  dismissCounterexample(id: string): void {
    this.#pins.dismiss(id)
    this.emit("state", this.info())
  }

  /** D-018: what is left of the session's risk budget, or undefined when there is none (the default). */
  #budget: number | undefined
  /** D-025: the dead-man timer, off unless you set it: how often you must be heard from, and when you last were. */
  #deadman: { minutes: number; last: number } | undefined
  #deadmanTimer: NodeJS.Timeout | undefined

  /**
   * D-025: in Extreme approval, a session with the timer on wants a sign of you every so many minutes: anything you do
   * on the desktop or sign on the phone, or "I'm still here" on the phone. Without one it pauses until you start it.
   */
  async setDeadman(minutes: number | null): Promise<void> {
    clearInterval(this.#deadmanTimer)
    this.#deadmanTimer = undefined
    this.#deadman = minutes === null ? undefined : { minutes: Math.min(Math.max(Math.round(minutes), 1), 240), last: Date.now() }
    await this.#auditLimit(
      "deadman_set",
      "dead-man",
      minutes === null ? { off: true } : { minutes: this.#deadman!.minutes },
      minutes === null ? "You turned the dead-man timer off for this session." : `You set a dead-man timer of ${this.#deadman!.minutes} minutes on this session.`,
      "human-desktop",
    )
    if (this.#deadman) {
      this.#deadmanTimer = setInterval(() => void this.#deadmanLook(), this.#deps.deadmanLookMs ?? 5_000)
      this.#deadmanTimer.unref()
    }
    this.emit("state", this.info())
  }

  /** D-025: you were heard from. */
  heartbeat(): void {
    if (this.#deadman) this.#deadman.last = Date.now()
  }

  async #deadmanLook(): Promise<void> {
    const d = this.#deadman
    if (!d || !this.#extreme || this.#paused || !this.live) return
    const unit = this.#deps.deadmanMinuteMs ?? 60_000
    if (Date.now() - d.last < d.minutes * unit) return
    await this.#auditLimit(
      "extreme_heartbeat_missed",
      "dead-man",
      { minutes: d.minutes, lastHeardFrom: new Date(d.last).toISOString() },
      `Nothing was heard from you for ${d.minutes} minute${d.minutes === 1 ? "" : "s"}, so Codehouse paused this Extreme session.`,
      "rules",
    )
    this.emit("event", { type: "heartbeat_missed", data: { minutes: d.minutes } })
    await this.pause(0, undefined, "heartbeat")
  }

  /**
   * D-018, the risk budget (opt-in; Settings, Sessions): an allow given without a person, by Extreme approval or by
   * Claude Code in Auto or Accept edits, spends 1 point at Moderate risk and 3 at High. At zero a Manual-family session
   * drops to Manual and an Extreme one pauses until you start it again. Your own message fills it again.
   */
  async #spendRisk(risk: number, by: "extreme" | "self-approved"): Promise<void> {
    if (this.#budget === undefined || this.#budget <= 0) return
    const cost = risk >= 85 ? 3 : risk >= 70 ? 3 : risk >= 40 ? 1 : 0
    if (!cost) return
    this.#budget = Math.max(0, this.#budget - cost)
    this.emit("state", this.info())
    if (this.#budget > 0) return
    const extreme = this.#extreme
    await this.#auditLimit(
      "risk_budget_exhausted",
      "risk-budget",
      { by, extreme, mode: this.#mode },
      extreme
        ? "The session's risk budget is spent, so Extreme approval paused it."
        : "The session's risk budget is spent, so it went back to Manual: each call now asks you.",
      "rules",
    )
    this.emit("event", { type: "risk_budget_exhausted", data: { extreme, mode: this.#mode } })
    if (extreme) await this.pause(100, undefined, "risk")
    else if (this.#mode !== "default" && this.#mode !== "plan") await this.setMode("default")
  }

  /** D-018: the budget from Settings, filled again (a new session, or your own message). */
  #fillBudget(): void {
    const b = this.#deps.config().riskBudget
    this.#budget = b && !b.off && Number.isInteger(b.points) && b.points > 0 ? b.points : undefined
  }

  /** D-007: calls a person approved that touched locked tests, by toolUseID, so they are pinned again after. */
  readonly #lockedCalls = new Map<string, string[]>()
  /** D-059: the same for instruction files; and the change outside Codehouse last recorded, so it is recorded once. */
  readonly #instructionCalls = new Map<string, string[]>()
  #instructionsSeen: string | undefined

  /**
   * D-059: refuses when what the project tells Claude changed outside Codehouse since it was pinned, until the owner
   * approves the change on the desktop. Asked before each of your messages and each turn Extreme approval starts. A
   * chat reads no project's instructions. Pins that cannot be read count as changed.
   */
  async checkInstructions(): Promise<void> {
    if (this.#opts.kind === "chat" || !this.#deps.instructions) return
    const changed = await this.#deps.instructions.changedOutside(this.cwd).catch(() => ["(the pins could not be read)"])
    if (!changed.length) {
      if (this.#instructionsSeen !== undefined) {
        this.#instructionsSeen = undefined
        this.emit("state", this.info())
      }
      return
    }
    const key = changed.join("\n")
    if (this.#instructionsSeen !== key) {
      this.#instructionsSeen = key
      await recordInstructionsChanged(this.#deps.audit, this.id, this.cwd, this.project, changed)
      this.emit("event", { type: "instructions_changed", data: { files: changed } })
      // The screen shows the change for review while this is set.
      this.emit("state", this.info())
    }
    throw new InstructionsChangedError(changed)
  }
  #resources: ResourceLevel = "high"
  readonly #account: string
  /** B25: the check Extreme approval carries on until, or none. */
  #goal: string | undefined
  /** B32: what this session read from outside, for the lifetime of its Claude Code. */
  readonly #provenance = new Provenance()
  /** Its job object's name, unique to this start, for changing the limits while it runs. */
  readonly #job = `Local\\Codehouse-${uuidv7()}`
  /** Tells the screen how a tool call was decided: the rule, its reason and who decided. Never the input. */
  readonly #tellDecision = (toolUseId: string, v: Verdict) => {
    try {
      this.emit("event", {
        type: "decision",
        data: {
          toolUseId,
          outcome: v.outcome,
          decidedBy: v.decidedBy,
          ruleId: v.ruleId,
          reason: v.reason,
          risk: v.risk,
        },
      })
    } catch {
      // A problem showing the decision never changes it.
    }
  }
  #q: Query | undefined
  #state: SessionState = "starting"
  /** A chat's name until its title is kept: its first message. */
  #label: string | undefined
  /** Whether anything has been sent to Claude yet. */
  #said = false
  /** For a chat on a local runtime or gateway: where its words go, fixed when it starts. */
  readonly #localLabel: string | undefined
  #mode: SessionMode
  #model: string | undefined
  #effort: Effort | undefined
  #extreme: boolean
  #sdkSessionId: string | undefined
  #error: string | undefined
  #running = false
  readonly #opts: StartSessionOptions
  readonly #onBrokerChange: () => void

  constructor(deps: SessionDeps, opts: StartSessionOptions) {
    super()
    this.#deps = deps
    this.#opts = opts
    this.id = opts.restore?.id ?? uuidv7()
    this.createdAt = opts.restore?.createdAt ?? new Date().toISOString()
    // Resuming carries on in the same conversation, unless it forks; the first message says for certain.
    this.#sdkSessionId = opts.resume !== undefined && opts.fork !== true ? opts.resume : undefined
    this.cwd = opts.cwd
    this.project = path.basename(findProjectRoot(opts.cwd))
    // D-018: the risk budget from Settings, if any.
    this.#fillBudget()
    this.#mode = opts.mode ?? "default"
    this.#model = opts.localModel ?? opts.model
    // No higher than the cap in Settings (B18); a model on this computer has no effort to set.
    this.#effort =
      opts.localModel !== undefined ? undefined : capEffort(opts.effort, deps.config().effortCap)
    this.#extreme = opts.extreme === true
    this.#resources = opts.resources ?? "high"
    this.#account = opts.account ?? MAIN_ACCOUNT
    if (opts.kind === "chat" && opts.title) this.#label = chatTitle(opts.title)
    this.#localLabel = opts.localModel !== undefined ? deps.local?.label?.() : undefined
    this.#onBrokerChange = () => this.#refreshWaiting()
    deps.broker.on("created", this.#onBrokerChange)
    deps.broker.on("resolved", this.#onBrokerChange)
  }

  /** Whether this session wrote or edited the file at this full path. */
  wrote(absPath: string): boolean {
    return this.#written.has(writtenKey(absPath, this.cwd))
  }

  info(): SessionInfo {
    return {
      id: this.id,
      cwd: this.cwd,
      project: this.project,
      ...(this.#opts.kind === "chat" ? { kind: "chat" as const } : {}),
      ...(this.#model !== undefined ? { model: this.#model } : {}),
      mode: this.#mode,
      ...(this.#effort !== undefined ? { effort: this.#effort } : {}),
      extreme: this.#extreme,
      state: this.#state,
      ...(this.#sdkSessionId !== undefined ? { sdkSessionId: this.#sdkSessionId } : {}),
      pendingApprovals: this.#deps.broker.countFor(this.id),
      createdAt: this.createdAt,
      ...(this.#error !== undefined ? { error: this.#error } : {}),
      ...(this.#opts.resume !== undefined ? { historyFrom: this.#opts.resume } : {}),
      ...(this.#opts.resumeAt !== undefined ? { historyUntil: this.#opts.resumeAt } : {}),
      ...(this.#opts.replaces !== undefined ? { replaces: this.#opts.replaces } : {}),
      ...(this.#opts.forkOf !== undefined ? { forkOf: this.#opts.forkOf } : {}),
      ...(this.#opts.inWorktree ? { worktree: this.#opts.inWorktree } : {}),
      ...(this.#opts.restore
        ? {
            restarted: {
              wasRunning: this.#opts.restore.wasRunning,
              ...(this.#opts.restore.forced ? { forced: true } : {}),
              ...(this.#opts.restore.crashed ? { crashed: true } : {}),
            },
          }
        : {}),
      ...(this.#background.size
        ? {
            background: [...this.#background.values()].map((b) => b.description),
            backgroundTasks: [...this.#background].map(([id, b]) => ({
              id,
              description: b.description,
              startedAt: new Date(b.startedAt).toISOString(),
            })),
          }
        : {}),
      ...(this.#deps.limiter ? { resources: this.#resources } : {}),
      ...(this.#deps.config().effortCap ? { effortCap: this.#deps.config().effortCap } : {}),
      ...(this.#goal ? { goal: this.#goal } : {}),
      ...(this.#account !== MAIN_ACCOUNT ? { account: this.#account } : {}),
      ...(this.#compactAfterTurn ? { compactPending: true } : {}),
      ...(this.#paused ? { paused: this.#paused } : {}),
      ...(this.#testsWeakened ? { testsWeakened: this.#testsWeakened } : {}),
      ...(this.#budget !== undefined ? { riskBudget: this.#budget } : {}),
      ...(this.#deadman ? { deadman: { minutes: this.#deadman.minutes, lastHeardFrom: new Date(this.#deadman.last).toISOString() } } : {}),
      ...(this.#claims.length ? { claims: this.#claims.map((c) => ({ ...c })) } : {}),
      ...(this.#pins.list().length
        ? {
            counterexamples: this.#pins.list().map((p) => ({
              id: p.id,
              framework: p.framework,
              example: p.example.slice(0, 300),
              writesItself: p.writesItself,
              ...(p.test ? { test: p.test.slice(0, 200) } : {}),
            })),
          }
        : {}),
      ...(this.#bypass
        ? {
            bypass: {
              since: new Date(this.#bypass.since).toISOString(),
              ...(this.#bypass.until !== undefined
                ? { until: new Date(this.#bypass.until).toISOString() }
                : {}),
              ...(this.#bypass.maxUsd !== undefined ? { maxUsd: this.#bypass.maxUsd } : {}),
              spentUsd: this.bypass?.spentUsd ?? 0,
            },
          }
        : {}),
      ...(this.#opts.chatProject ? { chatProject: this.#opts.chatProject } : {}),
      ...(this.#opts.instructions ? { instructions: this.#opts.instructions } : {}),
      ...(this.#opts.kind === "chat" && this.#opts.research ? { research: true } : {}),
      ...(this.#opts.kind === "chat" && this.#opts.about ? { about: this.#opts.about } : {}),
      ...(this.#opts.evaluation ? { evaluation: this.#opts.evaluation } : {}),
      ...(this.#opts.localModel !== undefined
        ? { local: true, ...(this.#localLabel ? { localLabel: this.#localLabel } : {}) }
        : {}),
      // D-059: what the project tells Claude changed outside Codehouse and waits for your review.
      ...(this.#instructionsSeen !== undefined ? { instructionsChanged: true } : {}),
      ...(this.#extreme && (this.#carry.status().turns > 0 || this.#carry.status().ended)
        ? { carryOn: this.#carry.status() }
        : {}),
      ...(this.#label ? { title: this.#label } : {}),
      ...this.#deps.sessionMeta?.(this.#sdkSessionId),
    }
  }

  #setState(state: SessionState): void {
    if (this.#state === state) return
    // An error is final. A result or an end-of-stream that arrives afterwards must not hide it.
    if (this.#state === "error") return
    this.#state = state
    this.emit("state", this.info())
  }

  #refreshWaiting(): void {
    if (this.#state === "running" || this.#state === "waiting") {
      this.#setState(this.#deps.broker.countFor(this.id) > 0 ? "waiting" : "running")
    } else if (this.#state === "idle") {
      this.emit("state", this.info()) // the pending count changed
    }
  }

  /**
   * The person's own instructions for this session: everyone's, the chat project's and this session's. For a chat in a
   * project, its knowledge folder is made to match the project first, so Claude reads what the project holds now.
   */
  async #instructionsText(): Promise<string> {
    const project = this.#opts.chatProject
    let files: string[] = []
    if (project) {
      if (!this.#deps.projects) throw new Error("Chat projects are not available here.")
      files = this.#deps.projects.sync(project, this.cwd)
    }
    const info = project ? this.#deps.projects?.get(project) : undefined
    // A chat starts knowing what chats remember, and the use is recorded by the entries, never their words.
    const memory =
      this.#opts.kind === "chat" && this.#deps.memory
        ? this.#deps.memory.forChat(project)
        : undefined
    // Kept as given, so the chat can show exactly what Claude was told (CH-03).
    this.#memoryGiven = (memory ?? []).map((m) => ({
      id: m.id,
      scope: m.scope,
      topic: m.topic,
      text: m.text,
    }))
    if (memory?.length)
      await this.#deps.audit
        .record({
          session: this.id,
          event: "memory_used",
          channel: "host",
          tool: "memory",
          cwd: this.cwd,
          project: this.project,
          input: { entries: memory.map((m) => ({ id: m.id, scope: m.scope, topic: m.topic })) },
          verdict: {
            outcome: "allow",
            ruleId: "memory-used",
            reason: "What chats remember was given to this chat when it started.",
            risk: 0,
            decidedBy: "rules",
            policyHash: this.#deps.policy()?.hash ?? "",
          },
          latencyMs: 0,
        })
        .catch(() => undefined)
    // B23: a coding session's project may keep its instructions in AGENTS.md, for other coding agents.
    const agentsMd =
      this.#opts.kind !== "chat" ? await readAgentsMd(this.cwd, this.#deps.policy()) : undefined
    // Ask about code: the linked session as it stands, and the latest of what was said in it, redacted.
    const about =
      this.#opts.kind === "chat" && this.#opts.about
        ? {
            title: this.#opts.about.title,
            cwd: this.#opts.about.cwd,
            said: (await this.#deps.aboutSaid?.(this.#opts.about).catch(() => "")) ?? "",
          }
        : undefined
    return composeInstructions({
      profile: this.#deps.config().profile,
      global: this.#deps.config().globalInstructions,
      ...(agentsMd ? { agentsMd } : {}),
      ...(project && info ? { project: { name: project, text: info.instructions, files } } : {}),
      session: this.#opts.instructions,
      ...(memory ? { memory } : {}),
      artifacts: this.#opts.kind === "chat" && this.#deps.artifacts !== undefined,
      tidy: this.#opts.kind !== "chat",
      research: this.#opts.kind === "chat" && this.#opts.research === true,
      ...(about ? { about } : {}),
      // Settings, Pull requests: only a session in a worktree of its own, on its own branch.
      ...(this.#opts.inWorktree && this.#deps.config().pullRequests?.create === true
        ? {
            pullRequest: {
              branch: this.#opts.inWorktree.branch,
              draft: this.#deps.config().pullRequests?.draft !== false,
              fixChecks: this.#deps.config().pullRequests?.fixChecks === true,
            },
          }
        : {}),
    })
  }

  /** Before each message to a chat in a project: a file added or removed since is added or removed here too. */
  #syncKnowledge(): void {
    const project = this.#opts.chatProject
    if (!project || !this.#deps.projects) return
    try {
      this.#deps.projects.sync(project, this.cwd)
    } catch (e) {
      this.#deps.log(`session ${this.id}: knowledge files not updated: ${(e as Error).message}`)
    }
  }

  /** Builds the options and starts the SDK process. Fails if the options are unsafe or the organisation is wrong. */
  async start(): Promise<void> {
    const d = this.#deps
    const hookDeps: SessionHookDeps = {
      sessionId: this.id,
      cwd: this.cwd,
      sessionKind: this.#opts.kind === "chat" ? "chat" : "code",
      policy: d.policy,
      pwsh: d.pwsh,
      audit: d.audit,
      kill: () => d.kill.isEngaged(),
      checkpoints: d.checkpoints,
      ...(d.grants ? { grants: d.grants } : {}),
      ...(d.locks ? { locks: d.locks, lockedCalls: this.#lockedCalls } : {}),
      ...(d.instructions && this.#opts.kind !== "chat"
        ? { instructions: d.instructions, instructionCalls: this.#instructionCalls }
        : {}),
      decided: this.#decided,
      onEvent: (type, data) => this.emit("event", { type, data }),
      onDecision: this.#tellDecision,
      provenance: this.#provenance,
      log: d.log,
      mode: () => this.#mode,
      approver: d.approver,
      verdicts: this.#verdicts,
      onWritten: (file) => {
        this.#written.add(writtenKey(file, this.cwd))
        // D-008: a regression Claude was asked to write is locked once it is there.
        void this.#pins
          .noteWritten(file)
          .then((locked) => locked && this.emit("event", { type: "counterexample_pinned", data: { file } }))
          .catch((e: Error) => d.log(`counterexample pin: ${e.message}`))
      },
      // D-008: a test run's output is read for counterexamples, offered on the pane to pin as regression tests.
      untrustedFiles: () => d.config().untrustedFiles ?? UNTRUSTED_FILES,
      onSelfApproved: (verdict) => void this.#spendRisk(verdict.risk, "self-approved"),
      onCommitted: (cwd) =>
        void noteCommit({ sessionId: this.id, cwd, project: this.project, audit: d.audit, log: d.log }).then(
          (n) => n && this.emit("event", { type: "commit_noted", data: { auditSeq: n.auditSeq } }),
        ),
      onToolOutput: (_tool, output) => {
        if (this.#pins.noteOutput(output)) this.emit("state", this.info())
      },
      // G19: the same failure three times in a row with nothing changed stops the turn.
      onToolOutcome: (tool, input, error) => {
        // D-009: the turn's commands, for what a claim that the work is done rests on.
        const command = (input as { command?: unknown } | undefined)?.command
        if ((tool === "Bash" || tool === "PowerShell") && typeof command === "string")
          this.#turnCommands.push(command.slice(0, 2000))
        if (error === undefined) return this.#loop.succeeded(tool, input)
        if (this.#loop.failed(tool, input, error)) void this.#stopForLoop(tool)
      },
    }
    // Invariant 4: the SDK's warning that canUseTool is shadowed stops the session.
    const onStderr = (data: string) => {
      if (isShadowWarning(data))
        this.#fatal(new SafetyError(4, "the SDK reported that canUseTool is shadowed"))
    }
    const eventHook = createEventHook(hookDeps)
    const postHook = createPostToolHook(hookDeps)
    // What the person told every session, this project and this session, in that order (owner, 31 Oct).
    const instructions = await this.#instructionsText()
    // One permission path for tool calls and for a server's request to open a page (B06).
    const canUse = createCanUseTool({
      sessionId: this.id,
      cwd: this.cwd,
      sessionKind: this.#opts.kind === "chat" ? "chat" : "code",
      project: this.project,
      approver: d.approver,
      broker: d.broker,
      audit: d.audit,
      kill: () => d.kill.isEngaged(),
      policy: d.policy,
      engine: d.engine,
      pwsh: d.pwsh,
      checkpoints: d.checkpoints,
      ...(d.grants ? { grants: d.grants } : {}),
      ...(d.locks ? { locks: d.locks, lockedCalls: this.#lockedCalls } : {}),
      ...(d.instructions && this.#opts.kind !== "chat"
        ? { instructions: d.instructions, instructionCalls: this.#instructionCalls }
        : {}),
      ...(d.localRulesPath !== undefined ? { localRulesPath: d.localRulesPath } : {}),
      decided: this.#decided,
      verdicts: this.#verdicts,
      extreme: () => this.#extreme,
      mode: () => this.#mode,
      // D-001: whether this project is strict about its tests, read at each call; and what was weakened.
      strictTests: () => strictAboutTests(d.config().testIntegrity, this.project),
      onRememberRefused: (why) => this.emit("event", { type: "remember_refused", data: { why } }),
      onAutoApproved: (verdict) => void this.#spendRisk(verdict.risk, "extreme"),
      onTestsWeakened: (pattern, reason) => {
        this.#testsWeakened++
        this.emit("event", { type: "tests_weakened", data: { pattern, reason } })
        this.emit("state", this.info())
      },
      ...(d.notifyAutoApproved ? { notifyAutoApproved: d.notifyAutoApproved } : {}),
      onDecision: this.#tellDecision,
      provenance: this.#provenance,
      log: d.log,
    })
    const options: Options = {
      cwd: this.cwd,
      ...(this.#model !== undefined ? { model: this.#model } : {}),
      permissionMode: this.#mode,
      ...(this.#effort !== undefined ? { effort: this.#effort } : {}),
      // A chat is a plain conversation: its own instructions, no CLAUDE.md or project settings, and only the web.
      // `tools` limits what exists; it is not `allowedTools`, so every call still goes through the Approver.
      ...(this.#opts.kind === "chat"
        ? {
            systemPrompt: [chatPrompt(), instructions].filter(Boolean).join("\n\n"),
            settingSources: [],
            tools: CHAT_TOOLS,
            // One memory to edit: Codehouse's own, not Claude Code's (ADR 0006). The only inline setting allowed.
            ...(d.memory ? { settings: { autoMemoryEnabled: false } } : {}),
          }
        : {
            systemPrompt: {
              type: "preset",
              preset: "claude_code",
              snapshot: true,
              ...(instructions ? { append: instructions } : {}),
            },
            settingSources: ["user", "project", "local"],
            // The output style chosen in Settings, by name: an inline setting that carries nothing else.
            ...(d.config().outputStyle
              ? { settings: { outputStyle: d.config().outputStyle as string } }
              : {}),
          }),
      includePartialMessages: true,
      // Its account's own Claude Code folder, and never a credential (invariant 6).
      env: d.accounts ? d.accounts.env(this.#account) : sanitiseEnv(process.env),
      canUseTool: canUse,
      // B06: a server asking you to open a page is decided like a tool call; Codehouse never opens it itself.
      onElicitation: (req, o) =>
        decideElicitation(req, { canUse, extreme: () => this.#extreme, log: d.log }, o.signal),
      hooks: {
        PreToolUse: [{ hooks: [createFloorHook(hookDeps)] }],
        PostToolUse: [{ hooks: [postHook] }],
        PostToolUseFailure: [{ hooks: [postHook] }],
        Notification: [{ hooks: [eventHook] }],
        Stop: [{ hooks: [eventHook] }],
        SubagentStart: [{ hooks: [eventHook] }],
        SubagentStop: [{ hooks: [eventHook] }],
      },
      mcpServers: d.companion({
        sessionId: this.id,
        cwd: this.cwd,
        ...(this.#opts.kind === "chat" ? { kind: "chat" as const } : {}),
        ...(this.#opts.chatProject ? { chatProject: this.#opts.chatProject } : {}),
        ...(this.#opts.kind === "chat" && this.#opts.about ? { about: this.#opts.about } : {}),
      }) as Options["mcpServers"],
      stderr: onStderr,
      // Inside a job object with the session's limits, when Codehouse can make one. Its stderr comes back to onStderr.
      ...(d.limiter
        ? {
            spawnClaudeCodeProcess: d.limiter.spawn(
              this.#job,
              () => this.#resources,
              onStderr,
              // What it uses now, for the bars in its pane (owner, 1 Nov), against its level's memory cap.
              (u) =>
                this.emit("event", {
                  type: "load",
                  data: {
                    ...u,
                    capMb: LEVELS[this.#resources].memoryMb,
                    totalMb: Math.round(os.totalmem() / 1024 / 1024),
                  },
                }),
            ),
          }
        : {}),
      ...(this.#opts.resume !== undefined
        ? {
            resume: this.#opts.resume,
            forkSession: this.#opts.fork === true,
            ...(this.#opts.resumeAt !== undefined ? { resumeSessionAt: this.#opts.resumeAt } : {}),
          }
        : {}),
    }
    const ev = this.#opts.evaluation
    if (ev && !ev.with)
      options.settings = {
        ...(typeof options.settings === "object" ? options.settings : {}),
        enabledPlugins: { [ev.plugin]: false },
      }
    assertSafeOptions(options)

    // A chat on a model on this computer runs Codehouse's own loop with these same options: the floor hook, canUseTool and
    // the audit are the ones above.
    const queryFn =
      this.#opts.localModel !== undefined ? d.local?.queryFn(this.#opts.localModel) : d.queryFn
    if (!queryFn) throw new Error("Models on this computer are not switched on.")
    // Invariant 4: the SDK's own warning, raised in this process while query() reads the options.
    const unwatch = watchShadowWarning(() =>
      this.#fatal(new SafetyError(4, "the SDK reported that canUseTool is shadowed")),
    )
    let query: ReturnType<typeof queryFn>
    try {
      query = queryFn({ prompt: this.#input, options })
    } finally {
      // Node hands a warning to its listeners on the next tick; setImmediate runs after that.
      setImmediate(unwatch)
    }
    this.#q = query
    const checkStart = async (): Promise<void> => {
      const init = await query.initializationResult()
      const managed = await d.managedDetected().catch(() => undefined)
      // Invariant 14, per account: this account must still belong to the organisation confirmed for it.
      const snapshot = (d.accounts?.monitor(this.#account) ?? d.account).note(init.account, managed)
      if (!snapshot.org.ok) {
        // Invariant 14: nothing is sent to a session on the wrong account.
        throw new OrgGuardError(snapshot.org.code, snapshot.org.message)
      }
      // Owner, 31 Oct: only in-process MCP servers in a session. Nothing is sent to one that has another.
      const q = query as unknown as { mcpServerStatus?: () => Promise<unknown> }
      if (q.mcpServerStatus) {
        const outside = outOfProcessServers(await q.mcpServerStatus())
        if (outside.length)
          throw new SafetyError(
            17,
            `MCP servers outside the process are not allowed in a session: ${outside.join(", ")}`,
          )
      }
    }
    const began = Date.now()
    try {
      // Fail closed (invariant 1): a start that never finishes is an error with a way to try again, never a wait
      // with no end. Claude Code can take minutes on a busy computer with a long conversation to read back.
      const limit = d.startTimeoutMs ?? START_TIMEOUT_MS
      const waited =
        limit >= 120_000
          ? `${Math.round(limit / 60_000)} minutes`
          : `${Math.round(limit / 1000)} seconds`
      let timer: NodeJS.Timeout | undefined
      const done = checkStart()
      done.catch(() => undefined) // when the time runs out first, its late failure is not news
      try {
        await Promise.race([
          done,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    `Claude Code had not finished starting after ${waited}, so Codehouse stopped waiting. Start again tries once more.`,
                  ),
                ),
              limit,
            )
          }),
        ])
      } finally {
        clearTimeout(timer)
      }
      d.log(
        `session ${this.id} (${this.project}) started in ${Math.round((Date.now() - began) / 1000)} s`,
      )
    } catch (e) {
      this.#q.close()
      this.#input.end()
      d.broker.off("created", this.#onBrokerChange)
      d.broker.off("resolved", this.#onBrokerChange)
      // Closed by you while it started: it is ended, not failed.
      if (this.#state === "ended") throw e
      this.#error = describeStop((e as Error).message)
      this.#setState("error")
      throw e
    }
    this.#setState("idle")
    void this.#pump()
    // Paused at the plan limit when Codehouse closed: still paused, and starting again waits for the reset.
    if (this.#opts.restore?.paused && !this.#opts.restore.forced) {
      this.#paused = this.#opts.restore.paused
      this.emit("state", this.info())
      return
    }
    // Brought back mid-run in Extreme approval: it carries on where it was, as you asked it to.
    if (this.#opts.restore?.wasRunning && !this.#opts.restore.forced) {
      this.#carry.started()
      void this.#carryOnNow({
        restart: true,
        ...(this.#opts.restore.crashed ? { crashed: true } : {}),
      })
    }
  }

  async #pump(): Promise<void> {
    const q = this.#q
    if (!q) return
    try {
      for await (const msg of q) {
        this.#onMessage(msg)
        this.emit("message", msg)
      }
      if (this.#state !== "error") this.#setState("ended")
    } catch (e) {
      this.#fatal(e as Error)
    } finally {
      this.#deps.broker.off("created", this.#onBrokerChange)
      this.#deps.broker.off("resolved", this.#onBrokerChange)
    }
  }

  #onMessage(msg: SDKMessage): void {
    const m = msg as unknown as Record<string, unknown>
    // O16: anything from Claude means the turn is alive.
    this.#stuck.seen()
    if (typeof m.session_id === "string" && m.session_id !== this.#sdkSessionId) {
      this.#sdkSessionId = m.session_id
      this.emit("state", this.info())
    }
    if (msg.type === "system") {
      if (isShadowSystemMessage(m))
        this.#fatal(new SafetyError(4, "the SDK reported that canUseTool is shadowed"))
      if ((m.subtype as string) === "init" && typeof m.model === "string") this.#model = m.model
      // B03: a plugin installed outside Codehouse can hold a mod, whose tool.check hook has the last word after the
      // floor hook and so could allow a call the Approver never saw. Such a session stops before any tool runs.
      // B04: Codehouse's checks were made against the Claude Code versions its release names. A session on another
      // version, or one that does not say, stops before any tool runs. A model on this computer runs no Claude Code.
      if (
        (m.subtype as string) === "init" &&
        this.#opts.localModel === undefined &&
        !inClaudeRange(m.claude_code_version)
      )
        this.#fatal(
          new SafetyError(
            1,
            `this session reported ${typeof m.claude_code_version === "string" ? `Claude Code ${m.claude_code_version.slice(0, 40)}` : "no Claude Code version"}, and this Codehouse was checked with ${rangeText()}, so it was stopped before it ran anything. Update Codehouse (Settings, Updates), or reinstall it with Codehouse-Setup.exe.`,
          ),
        )
      if ((m.subtype as string) === "init") {
        const modded = pluginsWithMods(m.plugins)
        if (modded.length)
          this.#fatal(
            new SafetyError(
              2,
              `${modded.join(", ")} ${modded.length === 1 ? "is a plugin with a mod" : "are plugins with mods"}, which could let tool calls run without the Approver, so this session was stopped. Remove ${modded.length === 1 ? "it" : "them"} (claude plugin uninstall <name>) or turn ${modded.length === 1 ? "it" : "them"} off, then start the session again.`,
            ),
          )
      }
      this.#noteBackground(m)
    }
    if (msg.type === "result") {
      this.#deps.usage.record(this.id, this.project, m)
      this.#running = false
      this.#stuck.stop()
      this.#setState("idle")
      if (typeof m.total_cost_usd === "number") this.#lastCost = m.total_cost_usd
      // D-009: a claim that the work is done is checked by running its command again.
      if (typeof m.result === "string" && m.is_error !== true) void this.#checkClaims(m.result)
      // In any mode, a reply that ends the queue is worth telling you about, wherever you are (owner, 3 Nov).
      if (typeof m.result === "string" && m.is_error !== true && saysQueueEmpty(m.result))
        this.emit("event", { type: "queue_empty", data: {} })
      if (this.#compactAfterTurn) {
        // Asked for while the turn ran: it compacts now, and Extreme approval carries on after that.
        this.#compactAfterTurn = false
        try {
          this.#send("/compact")
          return
        } catch {
          this.emit("state", this.info())
        }
      }
      if (this.#extreme) void this.#afterTurn(m)
    }
  }

  /**
   * Work that carries on after a turn ends. Claude Code sends the whole list when it changes; a task that ends also
   * says so on its own. Watchers it marks ambient are not work, so they do not count.
   */
  #noteBackground(m: Record<string, unknown>): void {
    const sub = m.subtype as string
    if (sub === "background_tasks_changed" && Array.isArray(m.tasks)) {
      // A task still running keeps the time it began (O21: how long each has run).
      const before = new Map(this.#background)
      this.#background.clear()
      for (const t of m.tasks as Array<Record<string, unknown>>)
        if (typeof t.task_id === "string" && t.ambient !== true)
          this.#background.set(t.task_id, {
            description: typeof t.description === "string" ? t.description : "",
            startedAt: before.get(t.task_id)?.startedAt ?? Date.now(),
          })
      this.emit("state", this.info())
    } else if (
      sub === "task_notification" &&
      typeof m.task_id === "string" &&
      this.#background.delete(m.task_id)
    )
      this.emit("state", this.info())
  }

  #fatal(e: Error): void {
    const before = this.#state
    // Working: a turn, or background work that carries on after one.
    const wasRunning = this.#running || this.#background.size > 0
    // In words a person can use (owner, 1 Nov); the log keeps what Claude Code said.
    this.#error = describeStop(e.message)
    this.#deps.log(`session ${this.id} (${this.project}) stopped with an error: ${e.message}`)
    this.#deps.broker.cancelSession(this.id, "The session stopped with an error")
    this.#setState("error")
    this.#q?.close()
    this.#input.end()
    // Only the process crashing: never a stop Codehouse made for safety, nor one after it had already ended or failed.
    if (before === "error" || before === "ended") return
    if (e instanceof SafetyError || e instanceof OrgGuardError || !isProcessCrash(e.message)) return
    this.emit("crashed", { wasRunning, message: e.message })
  }

  /** What this chat was told it remembers when it started, in the words it was given (CH-03). */
  memoryGiven(): Array<{ id: string; scope: string; topic: string; text: string }> {
    return this.#memoryGiven.map((m) => ({ ...m }))
  }

  /** Your next message. Messages sent while a turn runs are queued by the SDK. It starts a new run for Extreme. */
  prompt(text: string): void {
    // Owner, 9 Nov: the limits in Settings hold. A message does not go past them; a bypass for this session does.
    if (this.#paused) throw new LimitPausedError(this.#paused.reason)
    // D-018: your own message fills the risk budget again.
    this.#fillBudget()
    this.#syncKnowledge()
    this.#send(text)
    this.emit("prompted", text)
    this.#carry.started(this.#lastCost)
  }

  /** D-009: the turn's shell commands, kept from its start. */
  #turnCommands: string[] = []
  /** D-009: the claims checked in this session, newest last. */
  #claims: Array<{ kind: ClaimKind; quote: string; outcome: ClaimOutcome; why: string; command?: string }> = []

  /**
   * D-009: each claim in a reply is stamped Verified, Contradicted or Unverified, by running what it rests on again as a
   * Codehouse action (section 6). With the tests weakened in this session (D-001), a claim about them is Unverified.
   */
  async #checkClaims(text: string): Promise<void> {
    const run = this.#deps.codehouseAction
    const claims = findClaims(text)
    const commands = this.#turnCommands
    this.#turnCommands = []
    if (!claims.length || !run) return
    const root = findProjectRoot(this.cwd)
    const runs = new Map<string, Promise<ActionResult>>()
    for (const c of claims) {
      let outcome: ClaimOutcome = "unverified"
      let why: string
      const cmd = commandFor(c, commands, this.cwd, root)
      if ((c.kind === "tests" || c.kind === "fixed") && this.#testsWeakened)
        why = "the tests were weakened in this session"
      else if (!cmd) why = "there is no command to check it with"
      else {
        const key = `${cmd.cwd}|${cmd.command}`
        if (!runs.has(key))
          runs.set(
            key,
            run({
              sessionId: this.id,
              cwd: cmd.cwd,
              project: this.project,
              command: cmd.command,
              why: `checking Claude's claim: ${c.quote.slice(0, 80)}`,
              level: this.#resources,
            }),
          )
        const r = await runs.get(key)!
        if (!r.ran) why = `it was not run: ${r.refused}`
        else if (r.killed) why = "the kill switch stopped the check"
        else if (r.timedOut) why = "the check did not finish in time"
        else if (r.exitCode === 0) {
          outcome = "verified"
          why = `${cmd.command} passed when Codehouse ran it`
        } else {
          outcome = "contradicted"
          why = `${cmd.command} failed when Codehouse ran it (exit ${r.exitCode})`
        }
      }
      const entry = { kind: c.kind, quote: c.quote, outcome, why, ...(cmd ? { command: cmd.command } : {}) }
      this.#claims = [...this.#claims, entry].slice(-10)
      await this.#deps.audit
        .record({
          session: this.id,
          event: "claim_verified",
          channel: "host",
          tool: "claims",
          cwd: this.cwd,
          project: this.project,
          input: entry,
          verdict: {
            outcome: outcome === "contradicted" ? "deny" : "allow",
            ruleId: "done-claim",
            reason: `${CLAIM_WORDS[outcome]}: ${why}.`,
            risk: 0,
            decidedBy: "rules",
            policyHash: this.#deps.policy()?.hash ?? "",
          },
          latencyMs: 0,
        })
        .catch(() => undefined)
      this.emit("event", { type: "claim_checked", data: entry })
    }
    this.emit("state", this.info())
  }

  #send(text: string): void {
    this.#said = true
    if (this.#state === "error" || this.#state === "ended")
      throw new Error(`The session has ${this.#state}`)
    if (this.#deps.kill.isEngaged()) throw new KillSwitchEngagedError()
    this.#running = true
    this.#stuck.start()
    this.#setState(this.#deps.broker.countFor(this.id) > 0 ? "waiting" : "running")
    this.#input.push(text)
  }

  /**
   * Summarises the older conversation to make room: now between turns, or straight after the turn that is running
   * (owner, 31 Oct). The screen shows it waiting.
   */
  compact(): void {
    if (this.#running) {
      this.#compactAfterTurn = true
      this.emit("state", this.info())
      return
    }
    this.#send("/compact")
  }

  /** Which signed-in account it runs on. */
  get account(): string {
    return this.#account
  }

  /** Paused at the plan limit, and when it should start again. */
  get paused(): SessionInfo["paused"] {
    return this.#paused
  }

  /** Your bypass of the limits, while it lasts, with what the session reports it used since you set it. */
  get bypass(): LimitBypass | undefined {
    const b = this.#bypass
    if (!b) return undefined
    return {
      since: b.since,
      ...(b.until !== undefined ? { until: b.until } : {}),
      ...(b.maxUsd !== undefined ? { maxUsd: b.maxUsd } : {}),
      spentUsd: Math.max(0, this.#lastCost - b.costAtStart),
    }
  }

  /** Names a warm chat from the first message it is given, as a chat started then would be named. */
  label(title: string): void {
    this.#label = chatTitle(title)
  }

  /** Waiting for its first message: started, nothing said yet, nothing running. */
  get fresh(): boolean {
    return this.live && this.#state === "idle" && !this.#said
  }

  /** Open and able to answer: started, and neither ended nor failed. */
  get live(): boolean {
    return this.#q !== undefined && this.#state !== "error" && this.#state !== "ended"
  }

  /**
   * The account's plan limits, from Claude Code's own /usage data. The SDK marks the call experimental, so anything
   * missing or unexpected is nothing (docs/sdk-notes.md). Asks no question of Claude and touches no token.
   */
  async planUsage(): Promise<PlanUsage | undefined> {
    type Read = (o: { skipBehaviors: boolean }) => Promise<unknown>
    const q = this.#q as unknown as
      { usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?: Read } | undefined
    const read = q?.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?.bind(q)
    if (!read) return undefined
    const first = planLimits(await read({ skipBehaviors: true }))
    if (first) return first
    // The first answer can come before Claude Code has fetched the numbers (probe, 31 Oct).
    await new Promise((r) => setTimeout(r, PLAN_RETRY_MS))
    return planLimits(await read({ skipBehaviors: true }))
  }

  /** O21: the session's MCP servers as Claude Code reports them (used only for names, states and kinds). */
  async mcpStatus(): Promise<unknown> {
    const q = this.#q as unknown as { mcpServerStatus?: () => Promise<unknown> } | undefined
    return q?.mcpServerStatus ? await q.mcpServerStatus() : []
  }

  /** How full the conversation is, from the last response and local estimates (no extra token counting). */
  async contextUsage(): Promise<unknown> {
    if (!this.#q) throw new Error("The session has not started")
    const q = this.#q as unknown as {
      getContextUsage?: (o: { detail: "summary" }) => Promise<unknown>
    }
    if (!q.getContextUsage) throw new Error("This version of Claude Code cannot report its context")
    return await q.getContextUsage({ detail: "summary" })
  }

  /**
   * G19: the same call failed the same way LOOP_REPEATS times in a row with nothing changed in between, so the turn
   * stops (and Extreme stops carrying on), recorded, and the screen says why. Your next message starts afresh.
   */
  async #stopForLoop(tool: string): Promise<void> {
    if (!this.#running) return
    await this.#auditLimit(
      "loop_stopped",
      "loop-guard",
      { tool, repeats: LOOP_REPEATS },
      `The same ${tool} call failed the same way ${LOOP_REPEATS} times in a row with nothing changed in between, so Codehouse stopped the turn.`,
      "rules",
    ).catch(() => undefined)
    await this.interrupt("loop").catch((e: Error) => this.#deps.log(`loop stop: ${e.message}`))
  }

  /** Stops the running turn. The screen hears first, so the result that follows reads as stopped, not failed. */
  async interrupt(by: "you" | "kill-switch" | "plan-limit" | "loop" = "you"): Promise<void> {
    // Stopping a turn stops Extreme carrying on, until your next message, and a compact that was to follow it.
    this.#carry.stopped()
    this.#compactAfterTurn = false
    if (this.#running) this.emit("event", { type: "interrupted", data: { by } })
    this.#deps.broker.cancelSession(this.id)
    await this.#q?.interrupt()
    if (this.#state === "running" || this.#state === "waiting") {
      this.#running = false
      this.#stuck.stop()
      this.#setState("idle")
    }
  }

  /**
   * Extreme approval: after a turn, carry on by itself until Claude says the build queue is empty, a limit is
   * reached, a turn fails or you stop it (CLAUDE.md invariant 3, owner 30 Oct).
   */
  async #afterTurn(m: Record<string, unknown>): Promise<void> {
    if (this.#paused) return
    // Owner, 9 Nov: with a bypass running, the limits are looked at before carrying on, so one whose spending ran out
    // in that turn pauses now rather than at the next look.
    if (this.#bypass && this.#deps.limitCheck) {
      await this.#deps.limitCheck().catch(() => undefined)
      if (this.#paused) return
    }
    const step = this.#carry.next({
      text: typeof m.result === "string" ? m.result : "",
      isError: m.is_error === true || String(m.subtype ?? "").startsWith("error"),
      ...(typeof m.total_cost_usd === "number" ? { costUsd: m.total_cost_usd } : {}),
      ...(typeof m.num_turns === "number" ? { steps: m.num_turns } : {}),
    })
    if (!step) return
    if (!step.go) {
      this.emit("event", {
        type: "carry_on_end",
        data: { why: step.why, turns: step.turns, spentUsd: step.spentUsd },
      })
      this.emit("state", this.info())
      return
    }
    await this.#carryOnNow({ turn: step.turn, ...(step.of !== undefined ? { of: step.of } : {}) })
  }

  /** Sends the carry-on message, once it is in the audit log. Nothing carries on that cannot be recorded. */
  async #carryOnNow(data: Record<string, unknown>): Promise<void> {
    if (this.#deps.kill.isEngaged() || this.#running || this.#paused) return
    if (this.#state === "error" || this.#state === "ended") return
    // D-059: no turn starts on instructions changed outside Codehouse; the screen is told, and the run waits for you.
    try {
      await this.checkInstructions()
    } catch {
      this.#carry.stopped()
      return
    }
    const written = await this.#deps.audit.record({
      session: this.id,
      event: "extreme_carry_on",
      channel: "host",
      tool: "session",
      cwd: this.cwd,
      project: this.project,
      input: data,
      verdict: {
        outcome: "allow",
        ruleId: "extreme-carry-on",
        reason:
          data.crashed === true
            ? "Claude Code crashed while the session was working, so it was started again and carried on where it was."
            : data.restart === true
              ? "Codehouse restarted while the session was working, so it carried on where it was."
              : "Extreme approval is on, so the session carried on with its build queue by itself.",
        risk: 0,
        decidedBy: "extreme-mode",
        policyHash: this.#deps.policy()?.hash ?? "",
      },
      latencyMs: 0,
    })
    if (!written) {
      this.#carry.stopped()
      return
    }
    // The session may have been closed, paused or stopped by the kill switch while the record was written.
    const now = this.#state as SessionState
    if (now === "error" || now === "ended" || this.#paused || this.#deps.kill.isEngaged()) return
    this.emit("event", { type: "carry_on", data })
    this.#send(
      data.restart !== true || this.#extreme
        ? this.#goal
          ? goalPrompt(this.#goal)
          : CARRY_ON_PROMPT
        : data.crashed === true
          ? CRASH_RESUME_PROMPT
          : RESUME_PROMPT,
    )
    this.emit("state", this.info())
  }

  /** Stops everything now: the running turn and every background task. */
  async stop(by: "you" | "kill-switch" | "plan-limit" | "loop" = "you"): Promise<void> {
    await this.interrupt(by)
    const q = this.#q as unknown as { stopTask?: (id: string) => Promise<void> } | undefined
    await Promise.allSettled([...this.#background.keys()].map((id) => q?.stopTask?.(id)))
  }

  /**
   * Pauses the session because the plan's 5-hour limit reached its pause point (owner, 31 Oct): the turn and the
   * background work stop, nothing carries on by itself, and it is recorded. It starts again when the limit resets, or
   * when you start it.
   */
  async pause(percent: number, until?: string, reason?: "spend" | "risk" | "heartbeat"): Promise<void> {
    if (!this.live || this.#paused) return
    const wasRunning = this.#running || this.#background.size > 0
    this.#paused = {
      percent,
      wasRunning,
      ...(until ? { until } : {}),
      ...(reason ? { reason } : {}),
    }
    await this.#auditLimit(
      "limit_pause",
      "limit-pause",
      {
        percent,
        wasRunning,
        ...(until ? { until } : {}),
      },
      reason === "heartbeat"
        ? "Nothing was heard from you in time, so Codehouse paused this Extreme session until you start it again."
        : reason === "risk"
        ? "The session's risk budget is spent, so Codehouse paused this Extreme session until you start it again."
        : reason === "spend"
          ? "Today's extra spending beyond the plan reached the most Settings allows a day, so Codehouse paused this session until tomorrow."
          : `The plan's 5-hour limit reached ${Math.round(percent)}%, so Codehouse paused this session until it resets.`,
      "rules",
    )
    this.emit("event", {
      type: "paused",
      data: { percent, ...(until ? { until } : {}), ...(reason ? { reason } : {}) },
    })
    await this.stop("plan-limit").catch((e: Error) => this.#deps.log(`pause: ${e.message}`))
    this.emit("state", this.info())
  }

  /**
   * Starts a paused session again, when the limit resets or when you ask. One that was working carries on where it
   * stopped; one that was idle simply becomes ready. Nothing changes if it is not paused.
   */
  async resume(by: "you" | "limit-reset"): Promise<boolean> {
    const p = this.#paused
    if (!p) return false
    // D-018: a session its risk budget paused starts again only when you start it, with its budget full. D-025: one
    // the dead-man timer paused, only when you start it, and that is hearing from you.
    if (p.reason === "risk" || p.reason === "heartbeat") {
      if (by !== "you") return false
      if (p.reason === "risk") this.#fillBudget()
      this.heartbeat()
    }
    if (p.wasRunning) {
      // Sent first: if it cannot be (the kill switch), it stays paused and is tried again.
      this.#send(LIMIT_RESUME_PROMPT)
      this.#carry.started(this.#lastCost)
    }
    await this.#endPause(by)
    return true
  }

  /**
   * Owner, 9 Nov: you bypass the limits in Settings for this session, for so many minutes, up to so much spending, or
   * both, whichever runs out first; or end the bypass (null). While it lasts neither the plan's 5-hour limit nor the
   * most spending a day pauses this session, and one they had paused carries on. When it runs out, the limits apply
   * again at once and pause it if they are still over; going on again needs a new bypass. Recorded before it applies:
   * a bypass that cannot be recorded is refused.
   */
  async setBypass(b: { minutes?: number; maxUsd?: number } | null): Promise<void> {
    if (b === null) {
      if (!this.#bypass) return
      await this.#recordBypass("limit_bypass_end", { by: "you" }, "You ended the bypass of the limits for this session.")
      this.#clearBypass()
      this.emit("state", this.info())
      await this.#deps.limitCheck?.().catch(() => undefined)
      return
    }
    const minutes =
      b.minutes !== undefined && Number.isFinite(b.minutes)
        ? Math.min(Math.max(Math.round(b.minutes), 1), BYPASS_MAX_MINUTES)
        : undefined
    const maxUsd =
      b.maxUsd !== undefined && Number.isFinite(b.maxUsd) && b.maxUsd > 0
        ? Math.min(Math.round(b.maxUsd * 100) / 100, BYPASS_MAX_USD)
        : undefined
    if (minutes === undefined && maxUsd === undefined)
      throw new Error("Give the bypass a time, a most it may spend, or both.")
    const since = Date.now()
    const until = minutes !== undefined ? since + minutes * 60_000 : undefined
    await this.#recordBypass(
      "limit_bypass",
      {
        ...(minutes !== undefined ? { minutes, until: new Date(until!).toISOString() } : {}),
        ...(maxUsd !== undefined ? { maxUsd } : {}),
      },
      `You bypassed the limits in Settings for this session${minutes !== undefined ? ` for ${minutes} minutes` : ""}${minutes !== undefined && maxUsd !== undefined ? " or" : ""}${maxUsd !== undefined ? ` up to ${maxUsd.toFixed(2)} of spending` : ""}, whichever comes first.`,
    )
    this.#clearBypass()
    this.#bypass = {
      since,
      ...(until !== undefined ? { until } : {}),
      ...(maxUsd !== undefined ? { maxUsd } : {}),
      costAtStart: this.#lastCost,
    }
    if (until !== undefined) {
      // A look at the limits the moment the time runs out, not up to a minute later.
      this.#bypassTimer = setTimeout(() => void this.#deps.limitCheck?.(), until - since + 50)
      this.#bypassTimer.unref()
    }
    if (this.#paused) await this.resume("you")
    this.emit("state", this.info())
  }

  /** The bypass ran out (the limit pauser): its time, or its spending. The limits apply again from this look. */
  async endBypass(why: "time" | "spend", spentUsd: number): Promise<void> {
    const b = this.#bypass
    if (!b) return
    this.#clearBypass()
    await this.#auditLimit(
      "limit_bypass_end",
      "limit-bypass",
      { by: why, spentUsd: Math.round(spentUsd * 100) / 100, ...(b.maxUsd !== undefined ? { maxUsd: b.maxUsd } : {}) },
      why === "time"
        ? "The time you gave the bypass of the limits ran out, so the limits in Settings apply to this session again."
        : "The bypass of the limits reached the most you allowed it to spend, so the limits in Settings apply to this session again.",
      "rules",
    )
    this.emit("event", { type: "bypass_ended", data: { why, spentUsd } })
    this.emit("state", this.info())
  }

  #clearBypass(): void {
    clearTimeout(this.#bypassTimer)
    this.#bypassTimer = undefined
    this.#bypass = undefined
  }

  /** Your bypass, in the audit log before it applies; refused when it cannot be recorded. */
  async #recordBypass(event: string, input: Record<string, unknown>, reason: string): Promise<void> {
    const written = await this.#deps.audit
      .record({
        session: this.id,
        event,
        channel: "desktop",
        tool: "session",
        cwd: this.cwd,
        project: this.project,
        input,
        verdict: {
          outcome: "allow",
          ruleId: "limit-bypass",
          reason,
          risk: 0,
          decidedBy: "human-desktop",
          policyHash: this.#deps.policy()?.hash ?? "",
        },
        latencyMs: 0,
      })
      .catch(() => false)
    if (!written) throw new Error("The bypass could not be recorded in the audit log, so it was not set.")
  }

  async #endPause(by: "you" | "limit-reset"): Promise<void> {
    if (!this.#paused) return
    const p = this.#paused
    this.#paused = undefined
    await this.#auditLimit(
      "limit_resume",
      "limit-resume",
      { by, wasRunning: p.wasRunning },
      by === "you"
        ? "You started this paused session again."
        : "The plan's 5-hour limit reset, so Codehouse started this paused session again.",
      by === "you" ? "human-desktop" : "rules",
    )
    this.emit("event", { type: "resumed", data: { by } })
    this.emit("state", this.info())
  }

  async #auditLimit(
    event: string,
    ruleId: string,
    input: Record<string, unknown>,
    reason: string,
    decidedBy: "rules" | "human-desktop",
  ): Promise<void> {
    await this.#deps.audit
      .record({
        session: this.id,
        event,
        channel: decidedBy === "rules" ? "host" : "desktop",
        tool: "session",
        cwd: this.cwd,
        project: this.project,
        input,
        verdict: {
          outcome: "allow",
          ruleId,
          reason,
          risk: 0,
          decidedBy,
          policyHash: this.#deps.policy()?.hash ?? "",
        },
        latencyMs: 0,
      })
      .catch(() => undefined)
  }

  /** What it takes to start this session again on the same conversation. */
  restartOptions(): StartSessionOptions {
    return {
      cwd: this.cwd,
      ...(this.#opts.kind ? { kind: this.#opts.kind } : {}),
      mode: this.#mode,
      ...(this.#model !== undefined ? { model: this.#model } : {}),
      ...(this.#effort !== undefined ? { effort: this.#effort } : {}),
      extreme: this.#extreme,
      resources: this.#resources,
      ...(this.#account !== MAIN_ACCOUNT ? { account: this.#account } : {}),
      ...(this.#opts.chatProject ? { chatProject: this.#opts.chatProject } : {}),
      ...(this.#opts.instructions ? { instructions: this.#opts.instructions } : {}),
      ...(this.#opts.research ? { research: true } : {}),
      ...(this.#opts.about ? { about: this.#opts.about } : {}),
      ...(this.#sdkSessionId !== undefined ? { resume: this.#sdkSessionId } : {}),
    }
  }

  /**
   * How much of this computer the session may use: applied at once to it and everything it started, and recorded.
   * If the running job cannot be changed, the level still applies from its next start.
   */
  async setResources(level: ResourceLevel): Promise<void> {
    const limiter = this.#deps.limiter
    if (!limiter) throw new Error("Codehouse cannot limit sessions here")
    if (this.#q)
      await limiter
        .set(this.#job, level)
        .catch((e: Error) => this.#deps.log(`resource limits not changed now: ${e.message}`))
    this.#resources = level
    await this.#deps.audit.record({
      session: this.id,
      event: "resources_changed",
      channel: "desktop",
      tool: "session",
      cwd: this.cwd,
      project: this.project,
      input: { level, ...LEVELS[level] },
      verdict: {
        outcome: "allow",
        ruleId: "resources-changed",
        reason: `Resources for this session set to ${level} from the desktop.`,
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: "",
      },
      latencyMs: 0,
    })
    this.emit("state", this.info())
  }

  /** Only default and plan are ever accepted (invariant 3). */
  async setMode(mode: SessionMode): Promise<void> {
    if (this.#opts.kind === "chat" && mode !== "plan") throw new ChatModeError()
    if (!isAllowedMode(mode))
      throw new SafetyError(
        3,
        `permission mode "${String(mode)}" is not allowed, only default, plan, acceptEdits and auto`,
      )
    await this.#q?.setPermissionMode(mode)
    this.#mode = mode
    this.emit("state", this.info())
  }

  /** Reasoning effort. Applied to the running session as a flag setting that carries only this one key. */
  async setEffort(effort: Effort): Promise<void> {
    if (this.#opts.localModel !== undefined)
      throw new Error("A model on this computer has no effort to set.")
    const cap = this.#deps.config().effortCap
    if (aboveCap(effort, cap))
      throw new Error(`Settings limits effort to ${cap}, so this session cannot use ${effort}.`)
    await this.#q?.applyFlagSettings({ effortLevel: effort })
    this.#effort = effort
    this.emit("state", this.info())
  }

  /**
   * B25: a check to carry on until it passes, such as "npm test", or none. Used while Extreme approval carries on;
   * recorded, because it changes what the session is told to do by itself.
   */
  async setGoal(check: string | undefined): Promise<void> {
    if (check !== undefined && !goalOk(check))
      throw new Error("A goal is one line of up to 300 characters.")
    const recorded = await this.#deps.audit.record({
      session: this.id,
      event: "settings_changed",
      channel: "desktop",
      tool: "goal",
      cwd: this.cwd,
      project: this.project,
      input: check === undefined ? { goal: null } : { goal: check.trim() },
      verdict: {
        outcome: "allow",
        ruleId: check === undefined ? "goal-off" : "goal-set",
        reason:
          check === undefined
            ? "The goal for this session was cleared from the desktop."
            : "A goal was set for this session from the desktop: Extreme approval carries on until its check passes.",
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: this.#deps.policy()?.hash ?? "",
      },
      latencyMs: 0,
    })
    if (!recorded) throw new Error("It could not be recorded, so the goal was not changed.")
    this.#goal = check?.trim()
    this.emit("state", this.info())
  }

  /** Extreme approval for this session only. Written to the audit log, because it changes what gets asked. */
  async setExtreme(on: boolean): Promise<void> {
    if (this.#opts.kind === "chat" && on) throw new ChatModeError()
    this.#extreme = on
    await this.#deps.audit.record({
      session: this.id,
      event: "settings_changed",
      channel: "desktop",
      tool: "extreme-approval",
      cwd: this.cwd,
      project: this.project,
      input: { on },
      verdict: {
        outcome: "allow",
        ruleId: on ? "extreme-on" : "extreme-off",
        reason: on
          ? "Extreme approval turned on for this session from the desktop."
          : "Extreme approval turned off for this session from the desktop.",
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: "",
      },
      latencyMs: 0,
    })
    this.emit("state", this.info())
  }

  async setModel(model?: string): Promise<void> {
    await this.#q?.setModel(model)
    this.#model = model
    this.emit("state", this.info())
  }

  get running(): boolean {
    return this.#running
  }

  async close(): Promise<void> {
    this.#stuck.stop()
    clearInterval(this.#deadmanTimer)
    this.#deps.broker.cancelSession(this.id, "The session was closed")
    this.#input.end()
    this.#q?.close()
    this.#deps.broker.off("created", this.#onBrokerChange)
    this.#deps.broker.off("resolved", this.#onBrokerChange)
    if (this.#state !== "error") this.#setState("ended")
  }
}

export interface ManagerEvents {
  session: [SessionInfo]
  message: [{ sessionId: string; message: SDKMessage }]
  event: [{ sessionId: string; type: string; data: Record<string, unknown> }]
  /** You sent a message in a session (Host only). */
  prompted: [{ sessionId: string; text: string }]
}

/** A chat's name from what was said first: one line, at most 80 characters. */
export const chatTitle = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 80)

/**
 * The warm chat (owner, 1 Nov): a plain chat started while New chat or the quick prompt is open, so the first message
 * does not wait for Claude Code to start. It is a whole chat, made exactly as one started then would be (its own
 * folder, the floor hook, canUseTool, the Companion, its job object, the organisation checked), only hidden until it
 * is claimed. It is put away after this long without being asked for, or at once when free memory is short.
 */
export const WARM_IDLE_MS = 3 * 60_000
export const WARM_MIN_FREE_BYTES = 2 * 1024 ** 3

/** Starts, finds and stops sessions. One SDK query() per session. */
/** How long the plan limits are kept before an open session is asked again, and the wait for unfetched numbers. */
const PLAN_FRESH_MS = 60_000
const PLAN_RETRY_MS = 2000

export class SessionManager extends EventEmitter<ManagerEvents> {
  readonly #deps: SessionDeps
  readonly #sessions = new Map<string, Session>()
  /**
   * Sessions coming back after a restart, listed as starting from the first moment so none looks lost (owner, 31 Oct),
   * and kept with the reason if one cannot come back, so Start again can try once more and Close can put it away.
   */
  readonly #coming = new Map<string, { info: SessionInfo; opts: StartSessionOptions }>()
  /** Sessions whose Claude Code is still starting, so closing one (or Codehouse) does not wait for it to finish. */
  readonly #starting = new Map<string, Session>()
  /** Closed while coming back: a start that has not reached it yet, or is still running, gives it up. */
  readonly #dismissed = new Set<string>()
  readonly #plan = new Map<
    string,
    { at: number; value?: PlanUsage; pending?: Promise<PlanUsage | undefined> }
  >()
  /** Starts after a crash, so one that keeps crashing stops being started again. */
  readonly #crashes = new CrashRestarts()
  /** The warm chat: started hidden, and what it was started with, to check it still fits when it is claimed. */
  #warm:
    | {
        session: Session
        key: string
        ready: Promise<boolean>
        seen: number
        timer: NodeJS.Timeout
      }
    | undefined
  /** Chats whose first message is to be kept as their title once Claude Code gives them an id. */
  readonly #toName = new Map<string, string>()

  constructor(deps: SessionDeps) {
    super()
    this.#deps = deps
  }

  /** A session about to be brought back: shown at once, as starting, with what it had. */
  expect(opts: StartSessionOptions): void {
    const r = opts.restore
    if (!r || this.#sessions.has(r.id)) return
    const info: SessionInfo = {
      id: r.id,
      cwd: opts.cwd,
      project: path.basename(findProjectRoot(opts.cwd)),
      ...(opts.kind === "chat" ? { kind: "chat" as const } : {}),
      ...(opts.model !== undefined ? { model: opts.model } : {}),
      mode: opts.mode ?? "default",
      ...(opts.effort !== undefined ? { effort: opts.effort } : {}),
      extreme: opts.extreme === true,
      state: "starting",
      ...(opts.resume !== undefined ? { sdkSessionId: opts.resume, historyFrom: opts.resume } : {}),
      pendingApprovals: 0,
      createdAt: r.createdAt,
      restarted: { wasRunning: r.wasRunning, ...(r.crashed ? { crashed: true } : {}) },
      ...(r.paused ? { paused: r.paused } : {}),
      ...(opts.resources !== undefined && this.#deps.limiter ? { resources: opts.resources } : {}),
      ...(opts.account !== undefined && opts.account !== MAIN_ACCOUNT
        ? { account: opts.account }
        : {}),
      ...this.#deps.sessionMeta?.(opts.resume),
    }
    this.#coming.set(r.id, { info, opts })
    this.emit("session", info)
  }

  async start(opts: StartSessionOptions): Promise<Session> {
    const id = opts.restore?.id
    try {
      if (id && this.#dismissed.has(id)) throw new Error("It was closed before it started")
      const s = await this.#start(opts)
      if (id) this.#coming.delete(id)
      return s
    } catch (e) {
      const c = id ? this.#coming.get(id) : undefined
      if (id && this.#dismissed.delete(id)) {
        // Closed by you: nothing is kept, and nothing is shown as failed.
        this.#coming.delete(id)
      } else if (id && c) {
        const info: SessionInfo = {
          ...c.info,
          state: "error",
          error: `Codehouse could not bring this session back: ${describeStop((e as Error).message)}`,
        }
        this.#coming.set(id, { ...c, info })
        this.emit("session", info)
      }
      throw e
    }
  }

  async #start(opts: StartSessionOptions): Promise<Session> {
    if (this.#deps.kill.isEngaged()) throw new KillSwitchEngagedError()
    // B37: IT's policy for this computer is there but does not check out, so nothing starts until it does.
    const managed = this.#deps.managedPolicyProblem?.()
    if (managed) throw new ManagedPolicyError(managed)
    // Resume starts a conversation with what it last ran with, for anything the screen did not choose (owner, 31 Oct).
    // The mode is checked again with every other option before Claude Code starts (invariant 3).
    if (opts.resume !== undefined && !opts.restore) {
      const was = this.#deps.resumeSettings?.(opts.resume) ?? {}
      const effort = Effort.safeParse(was.effort)
      opts = {
        ...(was.model !== undefined ? { model: was.model } : {}),
        ...(effort.success ? { effort: effort.data } : {}),
        ...(was.mode !== undefined ? { mode: was.mode } : {}),
        ...(was.extreme !== undefined ? { extreme: was.extreme } : {}),
        ...(was.resources !== undefined ? { resources: was.resources } : {}),
        ...opts,
      }
    }
    // C-004: nothing new starts while memory is committed over the point in Settings; one coming back after a restart
    // or a force stop was open before and takes back what it had.
    if (!opts.restore || opts.restore.wake)
      await this.#deps.governor?.admit(
        opts.restore?.wake ? "session started again" : opts.kind === "chat" ? "chat" : "session",
        opts.restore ? { sessionId: opts.restore.id } : { cwd: opts.cwd },
      )
    // D-007: a coding session does not start while a locked test has changed outside Codehouse; one coming back after
    // a restart was open before, and carries on.
    if (!opts.restore && opts.kind !== "chat" && this.#deps.locks) {
      const changed = await this.#deps.locks.changedOutside(opts.cwd)
      if (changed.length) throw new LockedTestsChangedError(changed)
    }
    // D-059: nor while what the project tells Claude changed outside Codehouse, until you approve the change.
    if (!opts.restore && opts.kind !== "chat" && this.#deps.instructions) {
      const changed = await this.#deps.instructions
        .changedOutside(opts.cwd)
        .catch(() => ["(the pins could not be read)"])
      if (changed.length) {
        await recordInstructionsChanged(this.#deps.audit, "desktop", opts.cwd, undefined, changed)
        throw new InstructionsChangedError(changed)
      }
    }
    const config = this.#deps.config()
    // B09: the most open at once, over every account and both kinds. A session coming back after a restart is not
    // counted against it: it was open before.
    if (config.maxSessions !== undefined && !opts.restore) {
      const open = [...this.#sessions.values()].filter((s) => s.live && this.#warm?.session !== s)
      if (open.length >= config.maxSessions) throw new SessionLimitError(config.maxSessions)
    }
    // Checked again inside Session.start with the live account. This early check gives a clear message
    // when there is nothing to compare against.
    // Each account has the organisation confirmed for it; an account Codehouse does not know never starts.
    const accountId = opts.account ?? MAIN_ACCOUNT
    if (accountId !== MAIN_ACCOUNT && !this.#deps.accounts?.get(accountId))
      throw new OrgGuardError("no-expected-org", "That account is not signed in to Codehouse.")
    const monitor =
      accountId === MAIN_ACCOUNT
        ? this.#deps.account
        : (this.#deps.accounts?.monitor(accountId) ?? this.#deps.account)
    const early = checkOrg(
      monitor.last()?.organization ? { organization: monitor.last()?.organization } : undefined,
      accountId === MAIN_ACCOUNT
        ? config.expectedOrg
        : this.#deps.accounts?.get(accountId)?.expectedOrg,
    )
    if (!early.ok && early.code === "no-expected-org")
      throw new OrgGuardError(early.code, early.message)
    if (opts.localModel !== undefined) {
      if (opts.kind !== "chat")
        throw new SessionFolderError("Only a chat can run on a model on this computer.")
      if (opts.research)
        throw new SessionFolderError(
          "Research needs web search, which models on this computer do not have.",
        )
      if (!this.#deps.local)
        throw new SessionFolderError("Models on this computer are not switched on.")
      try {
        await this.#deps.local.check(opts.localModel)
      } catch (e) {
        throw new SessionFolderError((e as Error).message)
      }
    }
    // A plain chat takes the warm one when it is ready and still fits; anything else is started as before.
    const warm = await this.#claimWarm(opts)
    if (warm) return warm
    // After the checks above, so a refused start leaves nothing behind.
    if (opts.kind === "chat" && (opts.restore || opts.resume !== undefined)) {
      // A chat brought back, or carried on in a fork (Retry, Edit), keeps its own folder, where Claude Code finds the
      // conversation; and only a folder Codehouse made for chats.
      const dir = this.#deps.chatsDir
      if (!dir || !sameFolder(path.dirname(path.resolve(opts.cwd)), dir))
        throw new SessionFolderError("That chat's folder is not one Codehouse made for chats.")
      opts = { ...opts, mode: "plan", extreme: false, freshFolder: false }
    } else if (opts.kind === "chat") {
      // The folder the screen sent is ignored: a chat always gets a new one of its own.
      const dir = this.#deps.chatsDir
      if (!dir) throw new SessionFolderError("Chats are not available here.")
      fs.mkdirSync(dir, { recursive: true })
      const name = projectName(opts.title ?? "")
      // Plan mode, whatever was asked: the folder keeps a chat away from your projects, Plan mode keeps it from
      // changing anything at all, including in your workspace folders, which the rules would otherwise let it edit.
      opts = {
        ...opts,
        mode: "plan",
        extreme: false,
        freshFolder: false,
        // Every chat a folder of its own, even when an earlier one with the same name is still empty.
        cwd: freeFolder(path.join(dir, name === "project" ? "chat" : name), false),
      }
    } else if (opts.freshFolder) {
      const root = config.projectsFolder
      if (!root || !sameFolder(path.dirname(path.resolve(opts.cwd)), root))
        throw new SessionFolderError(
          "A new project goes straight into your projects folder. Set it in Settings, then try again.",
        )
      opts = { ...opts, cwd: freeFolder(path.resolve(opts.cwd)) }
    } else if (opts.worktree) {
      // B10: a coding session in a worktree of its own, beside the repository, on a new branch. (A chat was dealt
      // with above: it always gets a folder of its own.)
      if (!this.#deps.worktrees) throw new SessionFolderError("Worktrees are not available here.")
      let wt: Awaited<ReturnType<Worktrees["create"]>>
      try {
        wt = await this.#deps.worktrees.create(opts.cwd, opts.worktree.base)
      } catch (e) {
        throw new SessionFolderError((e as Error).message)
      }
      await this.#deps.audit.record({
        session: "host",
        event: "worktree_created",
        channel: "host",
        tool: "git",
        cwd: wt.repo,
        input: { path: wt.path, branch: wt.branch, base: wt.baseName },
        verdict: {
          outcome: "allow",
          ruleId: "worktree-created",
          reason: "A worktree was made for a new coding session.",
          risk: 0,
          decidedBy: "human-desktop",
          policyHash: "",
        },
        latencyMs: 0,
      })
      opts = { ...opts, cwd: wt.path, inWorktree: { branch: wt.branch, repo: wt.repo } }
    }
    // Ask about code (owner, 6 Nov): a chat about a code session open now, looked up by its id. The chat keeps where
    // the session works and its conversation's id, so it can read them; it never writes to either.
    if (opts.aboutId !== undefined && !opts.about) {
      if (opts.kind !== "chat")
        throw new SessionFolderError("Only a chat can be about a code session.")
      const target = this.#sessions.get(opts.aboutId)?.info()
      if (!target || target.kind === "chat")
        throw new SessionFolderError("Choose a code session that is open to ask about.")
      opts = {
        ...opts,
        about: {
          id: target.id,
          title: target.title ?? target.project,
          cwd: target.cwd,
          ...(target.sdkSessionId ? { sdkSessionId: target.sdkSessionId } : {}),
        },
      }
    }
    // A project belongs to a chat only, and must exist.
    if (opts.chatProject) {
      if (opts.kind !== "chat") throw new SessionFolderError("Only a chat can belong to a project.")
      if (!this.#deps.projects?.get(opts.chatProject))
        throw new SessionFolderError("There is no project with that name.")
      // B17: a project can allow only some providers; a chat in it uses one of them or does not start.
      const allowed = this.#deps.projects.providers(opts.chatProject)
      const using = opts.localModel !== undefined ? "local" : "claude"
      if (allowed && !allowed.includes(using))
        throw new SessionFolderError(
          `The project ${opts.chatProject} allows only ${allowed.map((p) => (p === "claude" ? "Claude" : "models on this computer")).join(" and ")}, so this chat cannot use ${using === "claude" ? "Claude" : "a model on this computer"}.`,
        )
    }
    ensureFolder(opts.cwd, this.#deps.log)
    if (opts.freshFolder) await gitInit(opts.cwd, this.#deps.log)
    const session = new Session(this.#deps, opts)
    this.#wire(session)
    if (opts.kind === "chat" && opts.title && !opts.restore)
      this.#toName.set(session.id, opts.title)
    this.#starting.set(session.id, session)
    try {
      await session.start()
    } finally {
      this.#starting.delete(session.id)
    }
    this.#sessions.set(session.id, session)
    this.emit("session", session.info())
    return session
  }

  get(id: string): Session | undefined {
    return this.#sessions.get(id)
  }

  /** Sends a session's state, messages and events on, except a warm chat's, which no one sees until it is claimed. */
  #wire(session: Session): void {
    const hidden = () => this.#warm?.session === session
    session.on("state", (info) => {
      if (hidden()) return
      this.emit("session", info)
      const title = this.#toName.get(session.id)
      if (title && info.sdkSessionId) {
        this.#toName.delete(session.id)
        // Redacted before it is kept (invariant 12).
        const kept = chatTitle(redactString(title, { terms: this.#deps.config().redactTerms }))
        void this.#deps
          .nameChat?.(info.sdkSessionId, kept)
          ?.then(() => this.announce(info.sdkSessionId as string))
          .catch(() => undefined)
      }
    })
    session.on("message", (message) => {
      if (!hidden()) this.emit("message", { sessionId: session.id, message })
    })
    session.on("event", (e) => {
      if (!hidden()) this.emit("event", { sessionId: session.id, type: e.type, data: e.data })
    })
    session.on("prompted", (text) => {
      if (!hidden()) this.emit("prompted", { sessionId: session.id, text })
    })
    session.on("crashed", (c) => {
      if (hidden()) void this.#dropWarm("its Claude Code stopped")
      else void this.#afterCrash(session, c)
    })
  }

  /** What a plain chat is started with now; a warm chat started with anything else is not used. */
  #chatKey(): string {
    const c = this.#deps.config()
    const memory = this.#deps.memory?.forChat() ?? []
    return crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          day: new Date().toISOString().slice(0, 10),
          global: c.globalInstructions ?? "",
          profile: c.profile ?? null,
          memory: memory.map((m) => [m.id, m.at]),
          policy: this.#deps.policy()?.hash ?? "",
        }),
      )
      .digest("hex")
  }

  /**
   * Asked for while New chat or the quick prompt is open: starts the warm chat if there is none, or keeps the one there
   * is from being put away. Never with the kill switch on, without chats, or with free memory short; a warm chat that
   * cannot start is dropped quietly and the next chat starts as before.
   */
  warmChat(): void {
    const w = this.#warm
    if (w) {
      w.seen = Date.now()
      return
    }
    const d = this.#deps
    const dir = d.chatsDir
    if (!dir || d.kill.isEngaged()) return
    if ((d.freeMemory ?? os.freemem)() < WARM_MIN_FREE_BYTES) return
    // Only once the account has been checked and found in the right organisation (invariant 14 is checked again at start).
    if (d.account.last()?.org.ok !== true) return
    try {
      fs.mkdirSync(dir, { recursive: true })
      const cwd = freeFolder(path.join(dir, "chat"), false)
      ensureFolder(cwd, d.log)
      const session = new Session(d, {
        cwd,
        kind: "chat",
        mode: "plan",
        extreme: false,
        freshFolder: false,
      })
      const timer = setInterval(() => {
        const now = this.#warm
        if (now?.session !== session) return clearInterval(timer)
        if (Date.now() - now.seen > WARM_IDLE_MS) void this.#dropWarm("it was not used")
        else if ((d.freeMemory ?? os.freemem)() < WARM_MIN_FREE_BYTES / 2)
          void this.#dropWarm("free memory is short")
      }, 30_000)
      timer.unref()
      this.#wire(session)
      const ready = session.start().then(
        () => true,
        (e: Error) => {
          d.log(`warm chat not started: ${e.message}`)
          if (this.#warm?.session === session) void this.#dropWarm("it could not start")
          return false
        },
      )
      this.#warm = { session, key: this.#chatKey(), ready, seen: Date.now(), timer }
    } catch (e) {
      d.log(`warm chat not started: ${(e as Error).message}`)
    }
  }

  /** Puts the warm chat away and removes its empty folder. */
  async #dropWarm(why: string): Promise<void> {
    const w = this.#warm
    if (!w) return
    this.#warm = undefined
    clearInterval(w.timer)
    this.#deps.log(`warm chat put away: ${why}`)
    await w.session.close().catch(() => undefined)
    try {
      fs.rmdirSync(w.session.cwd)
    } catch {
      // not empty or already gone: left as it is
    }
  }

  /** The warm chat for a plain chat that fits it, named from the first message, or undefined to start as before. */
  async #claimWarm(opts: StartSessionOptions): Promise<Session | undefined> {
    const w = this.#warm
    if (!w) return undefined
    const plain =
      opts.kind === "chat" &&
      !opts.restore &&
      !opts.resume &&
      !opts.chatProject &&
      !opts.instructions &&
      !opts.research &&
      opts.aboutId === undefined &&
      opts.about === undefined &&
      opts.model === undefined &&
      opts.effort === undefined &&
      opts.resources === undefined &&
      opts.localModel === undefined &&
      (opts.account ?? MAIN_ACCOUNT) === MAIN_ACCOUNT
    if (!plain) return undefined
    const started = await w.ready
    if (this.#warm !== w) return undefined
    if (!started || !w.session.fresh || w.key !== this.#chatKey() || this.#deps.kill.isEngaged()) {
      await this.#dropWarm("it no longer fits")
      return undefined
    }
    this.#warm = undefined
    clearInterval(w.timer)
    const s = w.session
    if (opts.title) {
      s.label(opts.title)
      this.#toName.set(s.id, opts.title)
    }
    this.#sessions.set(s.id, s)
    this.emit("session", s.info())
    return s
  }

  /** The sessions that are open and able to answer. */
  liveSessions(): Session[] {
    return [...this.#sessions.values()].filter((s) => s.live)
  }

  /** A notify_user from the Companion: shown on the desktop as a session event. The phone path comes later. */
  notify(sessionId: string, text: string): void {
    this.emit("event", { sessionId, type: "notify_user", data: { text } })
  }

  list(): SessionInfo[] {
    const coming = [...this.#coming.values()]
      .filter((c) => !this.#sessions.has(c.info.id))
      .map((c) => c.info)
    return [...[...this.#sessions.values()].map((s) => s.info()), ...coming]
  }

  /**
   * Puts away a session that could not come back, or one still starting (owner, 31 Oct: End did nothing on a session
   * that sat on Starting). True when there was one.
   */
  dismiss(id: string): boolean {
    const c = this.#coming.get(id)
    if (!c || this.#sessions.has(id)) return false
    this.#coming.delete(id)
    if (c.info.state === "starting") {
      this.#dismissed.add(id)
      void this.#starting.get(id)?.close()
    }
    this.emit("session", { ...c.info, state: "ended" })
    return true
  }

  /** Tells the window again about every open session with this Claude Code id, after its title or pin changed. */
  announce(sdkSessionId: string): void {
    for (const s of this.#sessions.values()) {
      const info = s.info()
      if (info.sdkSessionId === sdkSessionId) this.emit("session", info)
    }
  }

  /**
   * The account's plan limits, read on one of its open sessions, at most once a minute unless asked fresh. Nothing
   * when the account has no session open, since starting one only to ask would start Claude Code.
   */
  async planUsage(account = MAIN_ACCOUNT, fresh = false): Promise<PlanUsage | undefined> {
    const c = this.#plan.get(account)
    if (c?.pending) return c.pending
    if (c && !fresh && Date.now() - c.at < PLAN_FRESH_MS) return c.value
    const s = [...this.#sessions.values()].find((x) => x.account === account && x.live)
    if (!s) return c?.value
    const pending = s
      .planUsage()
      .catch(() => undefined)
      .then((value) => {
        const kept = value ?? c?.value
        this.#plan.set(account, { at: Date.now(), ...(kept ? { value: kept } : {}) })
        return kept
      })
    this.#plan.set(account, { ...(c ?? { at: 0 }), pending })
    return pending
  }

  /** D-025: you were heard from, on the desktop or the phone: every session's dead-man timer starts again. */
  heartbeat(): void {
    for (const s of this.#sessions.values()) s.heartbeat()
  }

  /** The kill switch: every turn and every background task stops. */
  async interruptAll(): Promise<void> {
    await this.#dropWarm("the kill switch")
    await Promise.allSettled([...this.#sessions.values()].map((s) => s.stop("kill-switch")))
  }

  /** C-004: the sessions that could be suspended to free memory: open, idle, nothing in the background or waiting. */
  idle(): SessionInfo[] {
    return [...this.#sessions.values()]
      .filter((s) => s.live && this.#warm?.session !== s)
      .map((s) => s.info())
      .filter(
        (i) =>
          i.state === "idle" && !i.background?.length && i.pendingApprovals === 0 && !i.evaluation,
      )
  }

  /**
   * C-004: suspends an idle session to free memory. Its Claude Code process ends; the session stays listed, and
   * Start again brings it back on the same conversation under the same id (asking the memory governor first). Only
   * an idle one: nothing running, in the background or waiting for you.
   */
  async suspend(id: string): Promise<SessionInfo> {
    const s = this.#sessions.get(id)
    if (!s) throw new Error("That session is not open")
    if (!this.idle().some((i) => i.id === id))
      throw new Error("Only a session that is idle, with nothing in the background or waiting, can be suspended.")
    const opts = s.restartOptions()
    const before = s.info()
    await s.close()
    this.#sessions.delete(id)
    const info: SessionInfo = {
      ...before,
      state: "error",
      suspended: true,
      error:
        "Suspended to free memory. Start again brings it back on the same conversation, when memory allows.",
    }
    delete info.background
    delete info.backgroundTasks
    this.#coming.set(id, {
      info,
      opts: { ...opts, restore: { id, createdAt: s.createdAt, wasRunning: false, wake: true } },
    })
    this.emit("session", info)
    return info
  }

  /**
   * Ends a session's Claude Code process at once, for a session that does not stop when asked, and starts it again
   * on the same conversation under the same id, so its pane and transcript stay.
   */
  async forceStop(id: string): Promise<Session> {
    const s = this.#sessions.get(id)
    const c = this.#coming.get(id)
    if (!s && c?.info.state === "error" && c.opts.restore) {
      // One that could not come back: Start again tries once more, without carrying on by itself. A suspended one
      // asks the memory governor first (C-004), and stays suspended if it is refused.
      if (c.info.suspended) {
        await this.#deps.governor?.admit("session started again", { sessionId: id })
      }
      const info: SessionInfo = { ...c.info, state: "starting" }
      delete info.error
      delete info.suspended
      this.#coming.set(id, { ...c, info })
      this.emit("session", info)
      return await this.start({ ...c.opts, restore: { ...c.opts.restore, forced: true, wake: false } })
    }
    if (!s) throw new Error("That session is not open")
    const again = s.restartOptions()
    const wasRunning = s.running
    const createdAt = s.createdAt
    await s.close()
    this.#sessions.delete(id)
    return await this.start({ ...again, restore: { id, createdAt, wasRunning, forced: true } })
  }

  /**
   * A session that was working when its Claude Code crashed is started again on the same conversation and carries on
   * where it was (owner, 1 Nov: a crash when Windows ran out of memory stopped a build session). At most twice in 30
   * minutes, never with the kill switch engaged, and only once it is in the audit log. One that was not working, or
   * that has crashed too often, stays stopped with the reason in words, and Start again is yours.
   */
  async #afterCrash(s: Session, c: { wasRunning: boolean; message: string }): Promise<void> {
    if (!c.wasRunning || this.#deps.kill.isEngaged() || this.#sessions.get(s.id) !== s) return
    if (!this.#crashes.take(s.id)) {
      this.#deps.log(`session ${s.id} (${s.project}) crashed again; not started again by itself`)
      return
    }
    const written = await this.#deps.audit.record({
      session: s.id,
      event: "session_restarted_after_crash",
      channel: "host",
      tool: "session",
      cwd: s.cwd,
      project: s.project,
      input: { exit: c.message },
      verdict: {
        outcome: "allow",
        ruleId: "session-restarted-after-crash",
        reason:
          "Claude Code crashed while the session was working, so Codehouse started it again on the same conversation.",
        risk: 0,
        decidedBy: "rules",
        policyHash: this.#deps.policy()?.hash ?? "",
      },
      latencyMs: 0,
    })
    // Checked again after the wait: you may have closed it, or engaged the kill switch, meanwhile.
    if (!written || this.#deps.kill.isEngaged() || this.#sessions.get(s.id) !== s) return
    const opts: StartSessionOptions = {
      ...s.restartOptions(),
      restore: { id: s.id, createdAt: s.createdAt, wasRunning: true, crashed: true },
    }
    this.#sessions.delete(s.id)
    await s.close()
    // Listed as coming back, so if it cannot start it stays on screen with the reason and Start again.
    this.expect(opts)
    try {
      await this.start(opts)
      this.#deps.log(`session ${s.id} (${s.project}) started again after a crash`)
    } catch (e) {
      this.#deps.log(`session ${s.id} could not start again after a crash: ${(e as Error).message}`)
    }
  }

  async closeAll(): Promise<void> {
    await this.#dropWarm("Codehouse is closing")
    await Promise.allSettled(
      [...this.#sessions.values(), ...this.#starting.values()].map((s) => s.close()),
    )
  }
}
