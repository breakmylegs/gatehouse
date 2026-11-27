import { processesUnder, stopUnder, taskkill, windowsSnapshot } from "./session-procs.js"
import type { LocalRuntimeConfig } from "./providers/local-runtime.js"
import { AdversaryStore, adversaryOf, applyChange, BREAKER_PROMPT } from "./adversary.js"
import { reviewerRuntime, sessionDiff } from "./review.js"
import { secretGlobs } from "@gatehouse/policy"
import { tourPrompt } from "./tours.js"
import { signReport } from "./egress.js"
import { projectSchemaDiff } from "./schema-diff.js"
import { findMigrations, rehearse } from "./migration-rehearsal.js"
import { explainAll, gitOut, queriesIn } from "./query-plan.js"
import { generateFixtures, scanFixtures } from "./fixtures.js"
import { findProjectRoot, IAC_PARSERS, iacFormat, lintIac } from "@gatehouse/policy"
import { probe, readSpec } from "./conformance-probe.js"
import { mocksFrom } from "./mock-gen.js"
import { lintApi } from "./api-lint.js"
import { checkSpecErrors } from "./error-contract.js"
import { checkDrift, findGenerators, hasDrift } from "./client-drift.js"
import { fixTask, triage } from "./error-triage.js"
import { profileDotnet, profileNode, profileSummary } from "./profiler.js"
import { findLeaks, leakSummary } from "./leak-detector.js"
import { crashText, dotnetDumpCommand, readDotnetCrashes, runWithCrashReports, summariseCrashes } from "./crash-summary.js"
import { confirmFails, confirmPasses, reproPrompt } from "./repro.js"
import { bisect } from "./bisect.js"
import { changedFiles, HANDOVER_PROMPT } from "./handover.js"
import { playbookPrompt, readPlaybooks, verifyPlaybook } from "./playbooks.js"
import { evaluateGate, parseGate, type GateSources } from "./gates.js"
import { readRoles, rolePrompt, type Role } from "./roles.js"
import { advance, dryRun, newRun, readWorkflows, type StepDeps } from "./workflows.js"
import { morningReport, newNight, order, runNight } from "./night-shift.js"
import { epicPrompt, STORY_SCHEMA, writeStories, type StoryInput } from "./epic.js"
import { exportLinks, scanLinks } from "./work-items.js"
import { dodItems, dodStatus, readDod } from "./dod.js"
import { readiness, readinessMarkdown, type ReadinessInput } from "./release-readiness.js"
import { sessionNotes } from "./slsa.js"
import { verifyBackout } from "./backout.js"
import { judgePromotion, promotionFor, readEnvironments, PROMOTION_GATE_RULE } from "./promotion.js"
import { cabPack, changeRecord } from "./change-record.js"
import { check, lastJson, readSchema, resultInstruction } from "./task-results.js"
import { findOnPath } from "./welcome.js"
import { languageOf } from "./outline.js"
import { importPack, makePack, openPack, type KnowledgeKey } from "./knowledge-pack.js"
import { upgradePack, type AdmissionCheck } from "./upgrade-pack.js"
import { admit, DEFAULT_LICENCES, fromManifestEdit, licenceFindings, type AddedDependency } from "@gatehouse/policy"
import { inlineScriptArgs, powerShellExe } from "@gatehouse/policy"
import { ANALYZER_SCRIPT, modernise, type AnalyzerRun } from "./pwsh-modernise.js"
import { MigrationStore, planMigration, sourcesIn, waveState, wavePrompt, type MigrationPlan } from "./migration.js"
import { ensureRunner, fuzzTargets, pinLines, runFuzz } from "./fuzz.js"
import { AsyncLocalStorage } from "node:async_hooks"
import { TerminalScrollback } from "./terminal-scrollback.js"
import { RubberStamp } from "./rubber-stamp.js"
import { NEVER_AUTO_APPROVED } from "./canuse.js"
import { arc42, deploymentFiles } from "./arc42.js"
import { decisionsIn, draftAdr, nextNumber, readAdrs, writeAdr } from "./adr.js"
import { draftMarkdown, threatDelta } from "./threat-delta.js"
import { fitnessCheck } from "./fitness.js"
import { approve as approveArch, c4Diagrams, cyclesOf, driftOf, modulesOf, readApproved } from "./arch-view.js"
import { readArchRules, updateGraph } from "./architecture.js"
import { approvedPlan, impactOf, readRequirements, REQUIREMENTS_DIR, scopeOf, traceMatrix, unrequested } from "./requirements.js"
import { execFile as execFileCb } from "node:child_process"
import { provenanceGraph } from "./provenance-graph.js"
import { sessionRecords } from "./timeline.js"
import { UNTRUSTED_FILES } from "./provenance.js"
import { behaviourDiff, capture, exportedFunctions, looksUntested, type BehaviourDelta, type Capture } from "./characterise.js"
import { listFiles, TEST_FILE } from "./mutation.js"
import { writeFileAtomic } from "@gatehouse/shared/node"
import { createHash } from "node:crypto"
import { runMutation } from "./mutation.js"
import { projectCommand } from "./claims.js"
import os from "node:os"
import { TestLockError, TestLocks } from "./test-locks.js"
import { approveInstructions, InstructionsChangedError, type InstructionPins } from "./instruction-pins.js"
import { BoundaryStaleError, classificationOf, refuseHandoff, refuseStaleSend, type Boundaries } from "./boundary.js"
import { HeldOutError, type HeldOutChecks, type HeldOutExec } from "./heldout.js"
import { runHeldOutFor } from "./heldout-session.js"
import { sessionDetails } from "./session-details.js"
import { MemoryRefusedError, type MemoryGovernor } from "./memory-governor.js"
import { MAIN_ACCOUNT, type Accounts } from "./accounts.js"
import fs from "node:fs"
import type { SignInFlow } from "./signin.js"
import type net from "node:net"
import path from "node:path"
import { cannotRevert, EDIT_REVERT_RULE } from "./edit-revert.js"
import fastifyStatic from "@fastify/static"
import websocket from "@fastify/websocket"
import Fastify, { type FastifyInstance } from "fastify"
import type { WebSocket } from "ws"
import { checkRemember, compileGlobs, isLockfile, redactString, SEVERE_RISK, type Policy, type PolicyEngine, type PwshWorker } from "@gatehouse/policy"
import { lockfileChanges, sbomDiff, type DependencyChange } from "./sbom.js"
import { addedLines, scanSource, type SastFinding } from "./sast.js"
import {
  ClientMessage,
  WS_SUBPROTOCOL,
  type ClientCommand,
  type Health,
  type PendingView,
  type Resolution as WireResolution,
  type ServerEvent,
} from "@gatehouse/shared"
import type { AccountMonitor } from "./account.js"
import { recordsSince, registerApi, type AdminContext } from "./api.js"
import { addLesson, lessonsFor } from "./lessons-store.js"
import type { PhoneService } from "./relay/service.js"
import {
  Broker,
  describeResolution,
  type PendingView as BrokerView,
  type Resolution,
} from "./broker.js"
import type { CheckpointManager } from "./checkpoints.js"
import type { HostAudit } from "./hostaudit.js"
import type { HostKillSwitch } from "./kill.js"
import { SafetyError } from "./safety.js"
import { TerminalError, type TerminalManager } from "./terminal.js"
import type { SessionHistory } from "./history.js"
import { checkHostRequest } from "./server-guard.js"
import {
  KillSwitchEngagedError,
  ChatModeError,
  OrgGuardError,
  SessionFolderError,
  SessionLimitError,
  LockedTestsChangedError,
  ManagedPolicyError,
  CanaryFailedError,
  type SessionManager,
} from "./sessions.js"
import type { UsageStore } from "./usage.js"
import type { EffortLog } from "./effort-log.js"
import { estimate as energyEstimate, type EnergyConfig, type EnergyLog } from "./energy.js"
import { configPath } from "@gatehouse/shared/node"
import type { AiRegister } from "./ai-register.js"
import type { ResidencyLog } from "./residency.js"
import { sequenceFrom } from "./sequence.js"
import { areaOf, asksToExplain, type SkillLog } from "./skills.js"
import { changedSince, teachBack } from "./teach-back.js"
import { historyOf, suggestReviewers } from "./reviewers.js"
import { dailyPlan } from "./daily-plan.js"
import { tutorPrompt } from "./tutor.js"
import { cardsMarkdown, patternCards } from "./patterns.js"
import { handoverMarkdown, makeHandover, openHandover, signHandover } from "./handover-pack.js"
import { register as exceptionsRegister, registerCsv, reminders as grantReminders } from "./exceptions-register.js"
import { readGrantLimits, readRememberEntries } from "@gatehouse/policy"
import { draftPacks, installIndustryPack, signIndustryPack, type SignedIndustryPack } from "./industry-packs.js"
import { extract as extractMeeting, plan as planMeeting, writePlan as writeMeeting } from "./meeting-notes.js"
import { retentionDays, RETENTION_KINDS, type LegalHolds, type RetentionConfig } from "./retention.js"
import { collectNotices, noticesText } from "./notices.js"

/** D-021: how long the friction holds a High approval back before the deliberate one. */
const FRICTION_WAIT_MS = 2000

export interface HostApp {
  manager: SessionManager
  /** Your own commands in a session's folder. Absent in tests that do not need it. */
  terminal?: TerminalManager
  broker: Broker
  kill: HostKillSwitch
  checkpoints: CheckpointManager
  usage: UsageStore
  /** E-063: the effort and billing log, kept on this computer. */
  effort?: EffortLog
  /** E-090: CPU time by project, for the energy estimate. */
  energy?: EnergyLog
  /** E-069: the AI system register. */
  aiRegister?: AiRegister
  /** E-068: where each session's words went, and the region. */
  residency?: ResidencyLog
  /** E-066: the legal holds. */
  legalHolds?: LegalHolds
  account: AccountMonitor
  /** D-007: the locked tests. Absent where they cannot be kept (tests). */
  locks?: TestLocks
  /** D-003: the change evidence packs. Absent where they cannot be kept (tests). */
  evidence?: import("./evidence.js").EvidenceService
  /** D-059: the pins of what each project tells Claude. Absent where they cannot be kept (tests). */
  instructions?: InstructionPins
  /** D-002: the sealed held-out checks. Absent where they cannot be kept (tests). */
  heldOut?: HeldOutChecks
  /** Section 6: the command that runs them, as a Codehouse action for the session. */
  heldOutExec?: (sessionId: string) => HeldOutExec
  /** D-066: Codehouse's data folder, for the captures. */
  dataDir?: string
  /** D-004: a mutation run's test runs, as Codehouse actions. */
  mutationExec?: (sessionId: string) => import("./mutation.js").MutationExec
  /** D-012: a fuzz pass's runs, as Codehouse actions. */
  fuzzExec?: (sessionId: string) => import("./fuzz.js").FuzzExec
  /** D-071: the managed vulnerability snapshot, for an upgrade's admission checks. */
  vulnSnapshot?: Pick<import("./vuln-snapshot.js").VulnSnapshot, "matches" | "status">
  /** D-080: this computer's key for signing knowledge packs. */
  knowledgeKey?: KnowledgeKey
  /** E-073: what you accepted, undid and asked to have explained, by area; on this computer only. */
  skills?: SkillLog
  /** E-092: where the draft industry packs are, where signed ones wait, and where installed ones go. */
  industryPacks?: { draftsDir: string; signedDir: string; packsDir: string; checklistDir: string }
  /** D-094: what each session's processes reached. */
  egress?: Pick<import("./egress.js").EgressMonitor, "report">
  /** O59: what secret-in-commit held in each repository, and findings the owner allowed once. */
  secretHolds?: import("./secret-holds.js").SecretHolds
  /** D-084: each session's breaker run and what it found. */
  adversary?: AdversaryStore
  /** E-012: where a schema diff is kept, as a Mermaid artifact of its session. */
  artifacts?: Pick<import("./artifacts.js").ArtifactStore, "save">
  /** E-013 (with E-026): the container a session's heavy jobs run in, when container runs are on and Podman is here. */
  container?: (sessionId: string) => import("./codehouse-action.js").ContainerRun | undefined
  /** E-019: signed price sheets. */
  priceSheets?: import("./price-sheet.js").PriceSheets
  /** E-031: whether the rules allow a command by themselves for a session, as a Codehouse action's would be judged. */
  rulesAllow?: (sessionId: string, cwd: string, command: string) => Promise<boolean>
  /** E-034: the shapes of probed answers, per project. */
  contractSnapshots?: import("./contract-snapshots.js").ContractSnapshots
  /** E-036: a command run as a Codehouse action for a session (judged, no credentials, at its level). */
  /** E-038: the project log store, and whether the rules allow reading a file by themselves. */
  logs?: import("./log-capture.js").LogStore
  /** E-052 results a role's session hands off, as E-046 starts them. */
  taskResults?: Pick<import("./task-results.js").TaskResults, "expect">
  /** E-047: workflow runs, saved after each step. */
  workflowRuns?: import("./workflows.js").RunStore
  /** E-049: Codehouse's heavy jobs waiting for memory or CPU. */
  scheduler?: Pick<import("./scheduler.js").Scheduler, "waiting" | "cancelSession" | "run">
  /** E-054: night runs. */
  nights?: import("./night-shift.js").NightStore
  /** E-056: work item links, per project. */
  workItems?: import("./work-items.js").WorkItemStore
  /** E-057: definition of done items ticked by hand, per session. */
  dodTicks?: import("./dod.js").DodTicks
  /** E-062: a project's estimate per change from its history (D-100). */
  projectEstimate?: (project: string) => import("./outcomes.js").Estimate | undefined
  /** E-050: the lock table. */
  sessionLocks?: Pick<import("./locks.js").LockTable, "list">
  /** E-043: each project's verified reproductions. */
  repros?: import("./repro.js").ReproStore
  /** E-040: the trace receiver's tokens and spans, its port and whether it is on. */
  traces?: { tokens: import("./trace-receiver.js").TraceTokens; store: import("./trace-receiver.js").TraceStore; port: () => number; on: () => boolean }
  rulesAllowRead?: (sessionId: string, cwd: string, abs: string) => Promise<boolean>
  runAction?: (sessionId: string, command: string, cwd: string, why: string, env?: Record<string, string>) => Promise<{ exitCode: number | null; output: string; refused?: string }>
  /** C-004: the memory governor, for its status and the idle sessions it offers to suspend. */
  governor?: Pick<MemoryGovernor, "status">
  /** Owner, 9 Nov: whether a limit in Settings would pause an account now (Start now checks it). */
  limits?: { over(account: string): Promise<string | undefined> }
  /** Starts Anthropic's own sign-in. Absent in tests that do not need it. */
  signIn?: SignInFlow
  /** The accounts signed in beside the main one. */
  accounts?: Accounts
  audit: HostAudit
  engine: PolicyEngine
  policy: () => Policy | undefined
  pwsh: PwshWorker | undefined
  health: () => Health
  expectedOrg: () => string | undefined
  /** Policy, audit and settings endpoints for the desktop UI. Absent in tests that do not need them. */
  admin?: AdminContext
  /** Updates to Codehouse itself. Absent in tests that do not need them. */
  updates?: import("./update/service.js").Updates
  /** The phone channel. Absent in tests that do not need it. */
  phone?: PhoneService
  /** Restarts Codehouse through the window app. Absent where nothing can restart it (the console launcher, tests). */
  restart?: () => void
  /** Past sessions, your titles, pins and archives, and search. Absent in tests that do not need them. */
  history?: SessionHistory
  /** Past sessions from the SDK. */
  listHistory: (dir?: string) => Promise<unknown>
  log: (line: string) => void
}

export interface HostServerOptions {
  app: HostApp
  /** The per-launch session token the UI must present. */
  token: string
  /** 0 picks a free port (tests). Always bound to 127.0.0.1. */
  port: number
  /** Built UI files. Without it, a short placeholder page is served. */
  staticDir?: string
}

/** O41: who a command from Neighbourhood Watch came from. */
export interface RemoteVia {
  user: string
  signedIn: boolean
}
const VIA = new AsyncLocalStorage<RemoteVia>()
/** The deciding channel for the command running now. */
const channelNow = (): "desktop" | "cnw" => (VIA.getStore() ? "cnw" : "desktop")

class CommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

function toWire(r: Resolution): WireResolution {
  return {
    outcome: r.outcome,
    channel: r.channel,
    ...(r.message !== undefined ? { message: r.message } : {}),
    at: r.at,
    waitedMs: r.waitedMs,
    summary: describeResolution(r),
  }
}

/**
 * The Host's HTTP and WebSocket server for the desktop UI. It listens on 127.0.0.1 only. Every request
 * passes the guard (Host header, Origin, per-launch token), then the WebSocket carries typed commands in
 * and typed events out. The server holds no logic of its own: each command calls the component that owns it.
 */
/** E-054: milliseconds until the next HH:MM on this computer's clock. */
const msUntil = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number]
  const now = new Date()
  const at = new Date(now)
  at.setHours(h, m, 0, 0)
  if (at <= now) at.setDate(at.getDate() + 1)
  return at.getTime() - now.getTime()
}

export class HostServer {
  readonly #opts: HostServerOptions
  readonly #fastify: FastifyInstance
  readonly #clients = new Set<WebSocket>()
  /** T-112: each session's terminal, kept in memory for a window that reconnects. */
  readonly #scrollback = new TerminalScrollback()
  readonly #rawSockets = new Set<net.Socket>()
  /** D-021: approvals given faster than they could be read, and when each friction was shown. */
  readonly #rubberStamp = new RubberStamp()
  readonly #frictionAt = new Map<string, number>()
  #port = 0
  dropped = 0

  constructor(opts: HostServerOptions) {
    this.#opts = opts
    // E-061: a promotion's gate reads the session's evidence, which the server holds.
    opts.app.manager?.setPromotionGate?.((id, cwd, command) => this.promotionVerdict(id, cwd, command))
    this.#fastify = Fastify({ logger: false, bodyLimit: 1_048_576, trustProxy: false })
  }

  get port(): number {
    return this.#port
  }

  get clientCount(): number {
    return this.#clients.size
  }

  /** ready states (0 connecting, 1 open, 2 closing, 3 closed) of the sockets the plugin still tracks. */
  get socketStates(): number[] {
    const wss = (this.#fastify as unknown as { websocketServer?: { clients?: Set<WebSocket> } })
      .websocketServer
    return [...(wss?.clients ?? [])].map((c) => c.readyState)
  }

  get address(): string | undefined {
    const a = this.#fastify.server.address()
    return typeof a === "object" && a !== null ? a.address : undefined
  }

  async start(): Promise<number> {
    const app = this.#fastify
    // The port is known only after listen, so the guard reads it from the live address.
    app.addHook("onRequest", async (req, reply) => {
      const result = checkHostRequest(req.raw, { token: this.#opts.token, port: this.#port })
      if (!result.ok)
        return reply
          .code(result.status)
          .header("cache-control", "no-store")
          .send({ error: result.error })
      return undefined
    })
    await app.register(websocket, {
      options: {
        maxPayload: 1 << 20,
        handleProtocols: (protocols: Set<string>) =>
          protocols.has(WS_SUBPROTOCOL) ? WS_SUBPROTOCOL : false,
      },
    })
    app.get("/ws", { websocket: true }, (socket) => this.#onSocket(socket))
    app.get("/api/state", async () => this.#snapshot())
    if (this.#opts.app.admin) registerApi(app, this.#opts.app.admin)

    const dir = this.#opts.staticDir
    if (dir && fs.existsSync(path.join(dir, "index.html"))) {
      // index: false because "/" is declared below, and fastify-static would declare it a second time.
      await app.register(fastifyStatic, { root: dir, wildcard: false, index: false })
      app.get("/", (_req, reply) => reply.sendFile("index.html"))
    } else {
      app.get("/", (_req, reply) =>
        reply
          .type("text/plain; charset=utf-8")
          .send("Codehouse host is running. The interface is served here once it has been built."),
      )
    }
    this.#wireEvents()
    app.server.on("connection", (sock: net.Socket) => {
      this.#rawSockets.add(sock)
      sock.on("close", () => this.#rawSockets.delete(sock))
    })
    await app.listen({ host: "127.0.0.1", port: this.#opts.port })
    this.#port = (app.server.address() as { port: number }).port
    return this.#port
  }

  async close(): Promise<void> {
    // Ask politely, then insist: a client that never answers the close handshake must not hold the Host open.
    // The websocket plugin keeps its own list of sockets, including ones that are part-way through
    // closing, so that list (not ours) is the one to finish off.
    const wss = (this.#fastify as unknown as { websocketServer?: { clients?: Set<WebSocket> } })
      .websocketServer
    const all = (): WebSocket[] => [...new Set([...this.#clients, ...(wss?.clients ?? [])])]
    for (const c of all()) c.close(1001, "host stopping")
    const force = setTimeout(() => {
      for (const c of all()) c.terminate()
      this.#fastify.server.closeAllConnections?.()
      // Sockets of upgrade attempts (including refused ones) are no longer tracked by the HTTP server.
      for (const sock of this.#rawSockets) sock.destroy()
    }, 500)
    try {
      await this.#fastify.close()
    } finally {
      clearTimeout(force)
    }
  }

  // ---- events out ----

  #snapshot(): Extract<ServerEvent, { type: "hello" }> {
    const a = this.#opts.app
    return {
      type: "hello",
      sessions: a.manager.list(),
      pending: a.broker.list().map((v) => v as unknown as PendingView),
      health: a.health(),
      usage: a.usage.snapshot(),
      ...(a.expectedOrg() !== undefined ? { expectedOrg: a.expectedOrg() as string } : {}),
    }
  }

  #send(socket: WebSocket, event: ServerEvent): void {
    if (socket.readyState !== socket.OPEN) return
    // A UI that cannot keep up must not make the Host buffer the transcript without limit.
    if (event.type === "sdk_message" && socket.bufferedAmount > 8_000_000) {
      this.dropped++
      return
    }
    socket.send(JSON.stringify(event))
  }

  #broadcast(event: ServerEvent): void {
    for (const c of this.#clients) this.#send(c, event)
  }

  #wireEvents(): void {
    const a = this.#opts.app
    a.manager.on("session", (info) => this.#broadcast({ type: "session", info }))
    a.manager.on("message", ({ sessionId, message }) =>
      this.#broadcast({ type: "sdk_message", sessionId, message }),
    )
    a.manager.on("event", ({ sessionId, type, data }) =>
      this.#broadcast({ type: "session_event", sessionId, event: type, data }),
    )
    a.broker.on("created", (view: BrokerView) =>
      this.#broadcast({ type: "approval_request", view: view as unknown as PendingView }),
    )
    a.broker.on("resolved", ({ id, sessionId, resolution }) =>
      this.#broadcast({ type: "approval_resolved", id, sessionId, resolution: toWire(resolution) }),
    )
    a.broker.on("phone", ({ id, status }) => this.#broadcast({ type: "phone_status", id, status }))
    a.audit.onRecord = (record) => this.#broadcast({ type: "audit", record })
    a.usage.onChange = (usage) => this.#broadcast({ type: "usage", usage })
    a.kill.on("changed", () => this.#broadcast({ type: "health", health: a.health() }))
    a.phone?.on("health", () => this.#broadcast({ type: "health", health: a.health() }))
    a.updates?.on("status", (update) => this.#broadcast({ type: "update", update }))
    a.terminal?.on(
      "output",
      (e: { sessionId: string; runId: string; stream: "out" | "err"; text: string }) => {
        // T-112: kept, so a window that reconnects shows it again.
        this.#scrollback.add(e.sessionId, { stream: e.stream, text: e.text })
        this.#broadcast({ type: "term_output", ...e })
      },
    )
    a.terminal?.on(
      "exit",
      (e: { sessionId: string; runId: string; code: number | null; signal?: string }) =>
        this.#broadcast({ type: "term_exit", ...e }),
    )
  }

  /** Called when something outside the server changes health (the Approver restarting, a sign-in check). */
  announceHealth(): void {
    this.#broadcast({ type: "health", health: this.#opts.app.health() })
  }

  #signIn(account?: string): SignInFlow {
    if (account && account !== MAIN_ACCOUNT) {
      const accounts = this.#accounts()
      if (!accounts.get(account))
        throw new CommandError("unknown-account", "There is no such account")
      return accounts.signIn(account)
    }
    const f = this.#opts.app.signIn
    if (!f) throw new CommandError("unavailable", "Signing in from the app is not available here")
    return f
  }

  #accounts(): Accounts {
    const a = this.#opts.app.accounts
    if (!a) throw new CommandError("unavailable", "More accounts are not available here")
    return a
  }

  /** Adding, confirming and removing an account are recorded, as other changes from the desktop are. */
  async #auditAccount(
    event: string,
    input: Record<string, unknown>,
    reason: string,
  ): Promise<void> {
    await this.#opts.app.audit.record({
      session: "desktop",
      event,
      channel: "desktop",
      tool: "accounts",
      input,
      verdict: {
        outcome: "allow",
        ruleId: event.replace(/_/g, "-"),
        reason,
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: "",
      },
      latencyMs: 0,
    })
  }

  /** O41: a command from Neighbourhood Watch: what it was, and who sent it. Never its text. */
  async #auditRemote(via: RemoteVia, cmd: { type: string }): Promise<boolean> {
    const c = cmd as { type: string; requestId?: unknown; sessionId?: unknown }
    return await this.#opts.app.audit
      .record({
        session: typeof c.sessionId === "string" ? c.sessionId : "cnw",
        event: "cnw_command",
        channel: "desktop",
        tool: "cnw",
        input: {
          command: c.type,
          user: via.user,
          signedIn: via.signedIn,
          ...(typeof c.requestId === "string" ? { requestId: c.requestId } : {}),
        },
        verdict: {
          outcome: "allow",
          ruleId: "cnw-command",
          reason: `Sent from Codehouse Neighbourhood Watch by ${via.user}${via.signedIn ? "" : " (an allow-listed address, not signed in)"}.`,
          risk: 0,
          decidedBy: "human-desktop",
          policyHash: "",
        },
        latencyMs: 0,
      })
      .catch(() => false)
  }

  /** An undo from the Changes pane, after it was made (a safety checkpoint was saved first). */
  async #auditUndo(
    event: string,
    session: string,
    cwd: string,
    input: Record<string, unknown>,
    reason: string,
  ): Promise<void> {
    await this.#opts.app.audit.record({
      session,
      event,
      channel: "desktop",
      tool: "checkpoint",
      cwd,
      input,
      verdict: {
        outcome: "allow",
        ruleId: event.replace(/_/g, "-"),
        reason,
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: "",
      },
      latencyMs: 0,
    })
  }

  // ---- commands in ----

  /**
   * O41: a connection from Codehouse Neighbourhood Watch, as one more client. Its commands run with who sent them, so
   * decisions are recorded with the channel cnw, and a Severe approval needs a signed-in sender.
   */
  attachRemote(socket: WebSocket, via: RemoteVia): void {
    this.#via.set(socket, via)
    this.#onSocket(socket)
  }

  readonly #via = new WeakMap<WebSocket, RemoteVia>()

  #onSocket(socket: WebSocket): void {
    this.#clients.add(socket)
    this.#send(socket, this.#snapshot())
    socket.on("message", (raw: Buffer) => {
      void this.#onMessage(socket, raw.toString("utf8"))
    })
    socket.on("close", () => this.#clients.delete(socket))
    socket.on("error", () => this.#clients.delete(socket))
  }

  async #onMessage(socket: WebSocket, text: string): Promise<void> {
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      this.#send(socket, {
        type: "reply",
        ok: false,
        error: { code: "invalid-json", message: "The message is not valid JSON" },
      })
      return
    }
    const parsed = ClientMessage.safeParse(json)
    const cmdId =
      typeof (json as { cmdId?: unknown } | null)?.cmdId === "string"
        ? (json as { cmdId: string }).cmdId
        : undefined
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      this.#send(socket, {
        type: "reply",
        ...(cmdId ? { cmdId } : {}),
        ok: false,
        error: {
          code: "invalid-command",
          message: `${issue?.path.join(".") || "command"}: ${issue?.message ?? "is not valid"}`,
        },
      })
      return
    }
    try {
      const via = this.#via.get(socket)
      // O41: each command from Neighbourhood Watch is recorded first, with who sent it (invariant 13). The record uses
      // the desktop channel, which older copies can read; one that cannot be written is refused.
      if (via && !(await this.#auditRemote(via, parsed.data.command)))
        throw new CommandError("audit", "The command could not be recorded in the audit log, so it was not run.")
      const data = await (via ? VIA.run(via, () => this.#handle(parsed.data.command)) : this.#handle(parsed.data.command))
      this.#send(socket, {
        type: "reply",
        ...(parsed.data.cmdId ? { cmdId: parsed.data.cmdId } : {}),
        ok: true,
        ...(data !== undefined ? { data } : {}),
      })
    } catch (e) {
      const err = e instanceof CommandError ? e : classify(e)
      this.#opts.app.log(`command ${parsed.data.command.type} failed: ${err.code}`)
      this.#send(socket, {
        type: "reply",
        ...(parsed.data.cmdId ? { cmdId: parsed.data.cmdId } : {}),
        ok: false,
        error: { code: err.code, message: err.message },
      })
    }
  }

  /** E-060: the last backout check of each project, for its change record. */
  readonly #backouts = new Map<string, { reversible: boolean; detail: string }>()

  /** Where the project's change began: where it left its default branch. */
  async #base(root: string): Promise<string> {
    return ((await gitOut(root, ["merge-base", "HEAD", "origin/HEAD"])) ?? (await gitOut(root, ["merge-base", "HEAD", "main"])) ?? "").trim()
  }

  async #backout(s: NonNullable<ReturnType<HostServerOptions["app"]["manager"]["get"]>>, root: string) {
    const base = await this.#base(root)
    if (!base) return { reversible: false, revert: "conflicts" as const, tests: "not run" as const, migrations: "none" as const, detail: "where the change began could not be found (no default branch to compare with)." }
    const run = this.#opts.app.runAction
    return await verifyBackout(root, base, async (command, cwd) => {
      if (!run) return { ran: false, exitCode: null, output: "", refused: "Codehouse actions are not available here" }
      const x = await run(s.id, command, cwd, "checking the change can be backed out")
      return { ran: !x.refused, exitCode: x.exitCode, output: x.output, ...(x.refused ? { refused: x.refused } : {}) }
    })
  }

  /** E-058: what a release readiness report reads, for a session's project. */
  async #readinessInput(s: NonNullable<ReturnType<HostServerOptions["app"]["manager"]["get"]>>, root: string): Promise<ReadinessInput> {
    const a = this.#opts.app
    const pending = a.broker.list().filter((p) => p.request.project === s.project).map((p) => ({ risk: p.request.verdict.risk, ruleId: p.request.verdict.ruleId, toolName: p.request.toolName, reason: p.request.verdict.reason }))
    const sources = this.gateSources(s)
    const sealed = a.heldOut && (await a.heldOut.summary(s.project).catch(() => ({ count: 0 }))).count > 0 ? await sources.sealedPass().catch(() => false) : undefined
    // The candidate's own commits: since it left the default branch.
    const base = ((await gitOut(root, ["merge-base", "HEAD", "origin/HEAD"])) ?? (await gitOut(root, ["merge-base", "HEAD", "main"])) ?? "").trim()
    const range = base ? `${base}..HEAD` : "-50"
    const commits = ((await gitOut(root, ["log", "--format=%H", range])) ?? "").split("\n").filter(Boolean)
    const withPack = new Set(sessionNotes(root, range).filter((n) => n.evidence).map((n) => n.commit))
    // Dependencies, from the lockfiles at the project's root.
    const LOCKS = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock", "Pipfile.lock", "Cargo.lock", "go.sum", "composer.lock", "packages.lock.json", "Gemfile.lock"]
    const changes = LOCKS.flatMap((f) => {
      try {
        return lockfileChanges(f, undefined, fs.readFileSync(path.join(root, f), "utf8"))
      } catch {
        return []
      }
    })
    const snap = a.vulnSnapshot
    const vulnerabilities = snap && snap.status().state === "ok" ? snap.matches(changes).map((m) => `${m.ecosystem}:${m.name}@${m.version} (${m.ids.slice(0, 3).join(", ")})`) : undefined
    let licences: string[] | undefined
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { dependencies?: Record<string, string> }
      const direct = Object.keys(pkg.dependencies ?? {}).map((name) => ({ ecosystem: "npm" as const, name, via: "package.json" }))
      const allowed = a.policy()?.managedLicences ?? a.admin?.config().allowedLicences ?? DEFAULT_LICENCES
      licences = direct.length ? licenceFindings(direct.slice(0, 300), [root], allowed).map((f) => f.reason) : undefined
    } catch {
      licences = undefined
    }
    const reportFile = path.join(root, ".codehouse", "a11y.json")
    const a11y = fs.existsSync(reportFile) ? await evaluateGate({ a11y: { report: ".codehouse/a11y.json", ...(fs.existsSync(path.join(root, ".codehouse", "a11y-baseline.json")) ? { baseline: ".codehouse/a11y-baseline.json" } : {}) } }, sources) : undefined
    const dodPlan = readDod(root)
    const run = a.runAction
    const dod = dodPlan
      ? dodStatus(
          await dodItems(root, dodPlan, a.dodTicks?.of(s.id) ?? new Set(), {
            changed: (await changedFiles(root)) ?? new Set<string>(),
            run: async (command, cwd) => {
              if (!run) return { ran: false, exitCode: null, refused: "Codehouse actions are not available here" }
              const x = await run(s.id, command, cwd, "checking the definition of done for a release")
              return { ran: !x.refused, exitCode: x.exitCode, ...(x.refused ? { refused: x.refused } : {}) }
            },
          }),
        )
      : undefined
    return { pending, ...(sealed !== undefined ? { sealed } : {}), evidence: { commits: commits.length, withPack: commits.filter((c) => withPack.has(c)).length }, ...(vulnerabilities ? { vulnerabilities } : {}), ...(licences ? { licences } : {}), ...(a11y ? { a11y } : {}), ...(dod ? { dod } : {}) }
  }

  /** E-054: one night task: a session through the scheduler, its cap as the SDK's spend cap, run until it settles. */
  async #nightTask(t: import("./night-shift.js").NightTask): Promise<{ sessionId: string; ok: boolean; costUsd: number; why?: string }> {
    const a = this.#opts.app
    const start = () => a.manager.start({ cwd: t.folder, mode: "default", ...(t.extreme ? { extreme: true } : {}), ...(t.budgetUsd ? { maxBudgetUsd: t.budgetUsd } : {}) })
    const s = await (a.scheduler ? a.scheduler.run({ label: `night task ${t.id}`, kind: "session", priority: 3 }, start) : start())
    // It has settled when it has been idle for a minute (Extreme carries on by itself), or it failed or ended.
    const ended = await new Promise<"idle" | "error" | "ended">((resolve) => {
      let timer: NodeJS.Timeout | undefined
      const onState = (i: { state: string }) => {
        clearTimeout(timer)
        if (i.state === "error" || i.state === "ended") return finish(i.state)
        if (i.state === "idle") timer = setTimeout(() => finish("idle"), 60_000)
      }
      const finish = (v: "idle" | "error" | "ended") => {
        clearTimeout(timer)
        s.off("state", onState as never)
        resolve(v)
      }
      s.on("state", onState as never)
    })
    s.prompt(t.prompt)
    const costUsd = this.#opts.app.usage?.snapshot().bySession[s.id]?.costUsd ?? 0
    return ended === "idle" ? { sessionId: s.id, ok: true, costUsd } : { sessionId: s.id, ok: false, costUsd, why: ended === "error" ? "its session failed" : "its session ended" }
  }

  /** E-047: a workflow event, recorded against the session it was started from. */
  async #record(s: { id: string; cwd: string; project: string }, event: string, input: Record<string, unknown>): Promise<void> {
    await this.#opts.app.audit.record({
      session: s.id, event, channel: "host", tool: "workflow", cwd: s.cwd, project: s.project, input,
      verdict: { outcome: "allow", ruleId: "workflow", reason: `A workflow step: ${event.replace(/_/g, " ")}.`, risk: 0, decidedBy: "rules", policyHash: "n/a" },
      latencyMs: 0,
    })
  }

  /** E-047: how a workflow's steps run: each its role's session in its own worktree, to the end of its turn. */
  #stepDeps(s: NonNullable<ReturnType<HostServerOptions["app"]["manager"]["get"]>>, root: string, roles: Role[]): StepDeps {
    const a = this.#opts.app
    return {
      record: (event, detail) => this.#record(s, event, detail),
      gate: async (sessionId, g) => {
        const child = a.manager.get(sessionId)
        return child ? await evaluateGate(g, this.gateSources(child)) : { pass: false, reason: "The step's session is gone, so its gate could not be read." }
      },
      runStep: async (step, prompt) => {
        const role = roles.find((x) => x.name === step.role)
        if (!role) return { sessionId: "", error: `the role ${step.role} is no longer in roles.yml` }
        const child = await a.manager.start({ cwd: root, worktree: { about: role.name }, role, mode: "default", ...(role.model ? { model: role.model } : {}), ...(role.effort ? { effort: role.effort } : {}) })
        // To the end of its turn, or until the session fails or ends.
        const turn = () =>
          new Promise<boolean>((resolve) => {
            const onMessage = (m: { type: string }) => m.type === "result" && finish(true)
            const onState = (i: { state: string }) => (i.state === "error" || i.state === "ended") && finish(false)
            const finish = (ok: boolean) => {
              child.off("message", onMessage as never)
              child.off("state", onState as never)
              resolve(ok)
            }
            child.on("message", onMessage as never)
            child.on("state", onState as never)
          })
        let ended = turn()
        child.prompt(`${rolePrompt(role, prompt)}${step.outputs ? resultInstruction(JSON.stringify(step.outputs, null, 2)) : ""}`)
        if (!(await ended)) return { sessionId: child.id, error: "its session failed or ended before it finished" }
        if (!step.outputs) return { sessionId: child.id }
        let r = check(lastJson(child.lastResult()), step.outputs)
        if (!r.ok) {
          ended = turn()
          child.prompt(`Your result did not match the JSON Schema it was asked for:\n- ${r.errors.join("\n- ")}\nGive the result again, as one JSON code block at the end of your message, matching the schema exactly.`)
          if (!(await ended)) return { sessionId: child.id, error: "its session failed or ended before it finished" }
          r = check(lastJson(child.lastResult()), step.outputs)
        }
        return r.ok ? { sessionId: child.id, result: r.value } : { sessionId: child.id, error: `its result did not match its schema twice: ${r.errors.join("; ")}` }
      },
    }
  }

  /** E-047: after a restart, each workflow that was running goes on from its last completed step. */
  resumeWorkflows(): number {
    const a = this.#opts.app
    if (!a.workflowRuns) return 0
    let n = 0
    for (const run of a.workflowRuns.all().filter((r) => r.status === "running")) {
      const r = readRoles(run.folder)
      if ("refused" in r) continue
      const w = readWorkflows(run.folder, r.roles).find((x) => x.id === run.workflow)?.workflow
      if (!w) continue
      // Recorded against a stand-in for the session it was started from, which a restart has closed.
      const owner = { id: `workflow-${run.runId}`, cwd: run.folder, project: path.basename(run.folder) } as unknown as NonNullable<ReturnType<HostServerOptions["app"]["manager"]["get"]>>
      void this.#record(owner, "workflow_resumed", { run: run.runId, after: run.done.at(-1) ?? "" })
      void advance(w, run, a.workflowRuns, this.#stepDeps(owner, run.folder, r.roles))
      n++
    }
    return n
  }

  /** E-048: each session's latest mutation score. */
  readonly #mutationScores = new Map<string, number>()

  /** E-078: every grant (remembered rules, with who and why) and the year's other exceptions. */
  exceptions(): ReturnType<typeof exceptionsRegister> {
    const admin = this.#opts.app.admin
    const local = admin?.loadOptions.localPath
    let entries: ReturnType<typeof readRememberEntries> = []
    try {
      entries = local ? readRememberEntries(local) : []
    } catch {
      entries = []
    }
    return exceptionsRegister({
      entries,
      limits: local ? readGrantLimits(local) : {},
      records: admin ? recordsSince(admin.auditDir, Date.now() - 365 * 86_400_000) : [],
    })
  }

  /** E-061: what the gates of the environment a command promotes to make of it; undefined when it promotes to none. */
  async promotionVerdict(sessionId: string, cwd: string, command: string) {
    const env = promotionFor(readEnvironments(findProjectRoot(cwd)).environments, command)
    if (!env) return undefined
    const s = this.#opts.app.manager.get(sessionId)
    if (!s) return { ruleId: PROMOTION_GATE_RULE, risk: env.production ? 90 : 70, reason: `A promotion to ${env.name}, whose gate could not be read (the session is gone).` }
    return await judgePromotion(env, this.gateSources(s))
  }

  /** E-048: the evidence a gate reads for a session; anything that cannot be had is undefined, and the gate fails closed. */
  gateSources(s: NonNullable<ReturnType<HostServerOptions["app"]["manager"]["get"]>>): GateSources {
    const a = this.#opts.app
    const root = findProjectRoot(s.cwd)
    return {
      testsVerified: async () => {
        const last = [...(s.info().claims ?? [])].reverse().find((c) => c.kind === "tests" || c.kind === "fixed")
        return last ? last.outcome === "verified" : undefined
      },
      sealedPass: async () => (a.heldOut ? (await runHeldOutFor(s, a.heldOut, a.audit, "you", a.heldOutExec?.(s.id))).ok : undefined),
      mutationScore: async () => this.#mutationScores.get(s.id),
      readFile: (rel) => {
        const abs = path.resolve(root, rel)
        const r = path.relative(root, abs)
        if (r.startsWith("..") || path.isAbsolute(r)) return undefined
        try {
          return fs.readFileSync(abs, "utf8")
        } catch {
          return undefined
        }
      },
      dodItems: async (id) => {
        const p = readPlaybooks(root).find((x) => x.id === id)
        if (!p) return undefined
        const run = a.runAction
        return await verifyPlaybook(root, p, {
          changed: (await changedFiles(root)) ?? new Set<string>(),
          run: async (command, cwd) => {
            if (!run) return { ran: false, exitCode: null, refused: "Codehouse actions are not available here" }
            const x = await run(s.id, command, cwd, `checking the definition of done "${p.name}"`)
            return { ran: !x.refused, exitCode: x.exitCode, ...(x.refused ? { refused: x.refused } : {}) }
          },
        })
      },
    }
  }

  #session(id: string) {
    const s = this.#opts.app.manager.get(id)
    if (!s) throw new CommandError("unknown-session", "There is no such session")
    return s
  }

  #history(): SessionHistory {
    const h = this.#opts.app.history
    if (!h) throw new CommandError("unavailable", "Past sessions are not available here")
    return h
  }

  #knownCwd(cwd: string): void {
    const known = this.#opts.app.manager
      .list()
      .some((s) => path.resolve(s.cwd).toLowerCase() === path.resolve(cwd).toLowerCase())
    if (!known) throw new CommandError("unknown-folder", "That folder does not belong to a session")
  }

  async #handle(cmd: ClientCommand): Promise<unknown> {
    const a = this.#opts.app
    // D-025: anything you do on the desktop shows you are there.
    a.manager.heartbeat()
    switch (cmd.type) {
      case "set_deadman":
        await this.#session(cmd.sessionId).setDeadman(cmd.minutes)
        return undefined
      case "create_session": {
        const s = await a.manager.start({
          cwd: cmd.cwd,
          ...(cmd.model ? { model: cmd.model } : {}),
          ...(cmd.mode ? { mode: cmd.mode } : {}),
          ...(cmd.effort ? { effort: cmd.effort } : {}),
          ...(cmd.extreme !== undefined ? { extreme: cmd.extreme } : {}),
          ...(cmd.resume ? { resume: cmd.resume } : {}),
          ...(cmd.fork !== undefined ? { fork: cmd.fork } : {}),
          ...(cmd.freshFolder ? { freshFolder: true } : {}),
          ...(cmd.extremeMax ? { extremeMax: true } : {}),
          ...(cmd.kind ? { kind: cmd.kind } : {}),
          ...(cmd.title ? { title: cmd.title } : {}),
          ...(cmd.chatProject ? { chatProject: cmd.chatProject } : {}),
          ...(cmd.instructions ? { instructions: cmd.instructions } : {}),
          ...(cmd.research ? { research: true } : {}),
          ...(cmd.about ? { aboutId: cmd.about } : {}),
          ...(cmd.account ? { account: cmd.account } : {}),
          ...(cmd.localModel ? { localModel: cmd.localModel } : {}),
          ...(cmd.resumeAt ? { resumeAt: cmd.resumeAt } : {}),
          ...(cmd.replaces ? { replaces: cmd.replaces } : {}),
          ...(cmd.worktree ? { worktree: cmd.worktree } : {}),
        })
        return { sessionId: s.id, info: s.info() }
      }
      case "warm_chat":
        a.manager.warmChat()
        return undefined
      case "pin_counterexample":
        return await this.#session(cmd.sessionId).pinCounterexample(cmd.id)
      case "dismiss_counterexample":
        this.#session(cmd.sessionId).dismissCounterexample(cmd.id)
        return undefined
      case "locks_state": {
        const s = this.#session(cmd.sessionId)
        if (!a.locks) throw new CommandError("unavailable", "Locked tests are not available here")
        return await a.locks.state(s.cwd)
      }
      case "lock_test":
      case "unlock_test":
      case "locks_accept": {
        const l = a.locks
        if (!l) throw new CommandError("unavailable", "Locked tests are not available here")
        const s = cmd.type === "locks_accept" ? undefined : this.#session(cmd.sessionId)
        const cwd = s?.cwd ?? (cmd.type === "locks_accept" ? cmd.cwd : "")
        let paths: string[]
        try {
          if (cmd.type === "lock_test") paths = [await l.lock(cwd, cmd.path)]
          else if (cmd.type === "unlock_test") {
            await l.unlock(cwd, cmd.path)
            paths = [cmd.path]
          } else {
            paths = await l.changedOutside(cwd)
            await l.accept(cwd)
          }
        } catch (e) {
          if (e instanceof TestLockError) throw new CommandError("invalid", e.message)
          throw e
        }
        const event =
          cmd.type === "lock_test" ? "test_locked" : cmd.type === "unlock_test" ? "test_unlocked" : "test_locks_accepted"
        const written = await a.audit.record({
          session: s?.id ?? "desktop",
          event,
          channel: "desktop",
          tool: "locks",
          cwd,
          input: { paths },
          verdict: {
            outcome: "allow",
            ruleId: "locked-test",
            reason:
              event === "test_locked"
                ? "You locked a test: a session changes it only with you."
                : event === "test_unlocked"
                  ? "You unlocked a test."
                  : "You accepted locked tests as they now are, after they changed outside Codehouse.",
            risk: 0,
            decidedBy: "human-desktop",
            policyHash: "",
          },
          latencyMs: 0,
        })
        if (!written) a.log("locks: the change could not be recorded in the audit log")
        return await l.state(cwd)
      }
      case "instructions_state": {
        if (!a.instructions) throw new CommandError("unavailable", "Instruction pins are not available here")
        return await a.instructions.state(cmd.cwd)
      }
      case "instructions_approve": {
        // D-059: you read the change on the desktop and approve it; recorded before the pins move.
        const pins = a.instructions
        if (!pins) throw new CommandError("unavailable", "Instruction pins are not available here")
        if (!(await approveInstructions(pins, a.audit, cmd.cwd)))
          throw new CommandError("audit", "The approval could not be recorded, so the change is not approved.")
        return await pins.state(cmd.cwd)
      }
      case "lessons_list": {
        // D-073: what your undos and denials here suggest for CLAUDE.md, with the records each rests on.
        this.#knownCwd(cmd.cwd)
        const auditDir = a.admin?.auditDir
        return { lessons: auditDir ? lessonsFor(recordsSince(auditDir, Date.now() - 90 * 86_400_000), cmd.cwd) : [] }
      }
      case "lesson_add": {
        // D-073 through D-059: the line is made here from the records, never taken from the page; recorded first.
        this.#knownCwd(cmd.cwd)
        const auditDir = a.admin?.auditDir
        if (!auditDir || !a.instructions) throw new CommandError("unavailable", "Lessons are not available here")
        const added = await addLesson({ pins: a.instructions, audit: a.audit, records: recordsSince(auditDir, Date.now() - 90 * 86_400_000), cwd: cmd.cwd, key: cmd.key })
        if (typeof added === "string") throw new CommandError("not-allowed", added)
        return added
      }
      case "heldout_list": {
        // The desktop only: this socket is the desktop's, never the phone's or a push channel's.
        const s = this.#session(cmd.sessionId)
        const h = a.heldOut
        if (!h) throw new CommandError("unavailable", "Held-out checks are not available here")
        return { project: s.project, ...(await h.list(s.project)) }
      }
      case "heldout_add":
      case "heldout_remove":
      case "heldout_command": {
        const s = this.#session(cmd.sessionId)
        const h = a.heldOut
        if (!h) throw new CommandError("unavailable", "Held-out checks are not available here")
        try {
          if (cmd.type === "heldout_add") await h.add(s.project, cmd.name, cmd.content)
          else if (cmd.type === "heldout_remove") await h.remove(s.project, cmd.name)
          else await h.setCommand(s.project, cmd.command)
        } catch (e) {
          if (e instanceof HeldOutError) throw new CommandError("invalid", e.message)
          throw e
        }
        // Recorded without the name or the content: that a check was added, removed, or the command changed.
        await a.audit.record({
          session: s.id,
          event: "sealed_check_changed",
          channel: "desktop",
          tool: "heldout",
          cwd: s.cwd,
          project: s.project,
          input: { change: cmd.type.slice("heldout_".length) },
          verdict: {
            outcome: "allow",
            ruleId: "heldout-checks",
            reason: "You changed this project's sealed held-out checks.",
            risk: 0,
            decidedBy: "human-desktop",
            policyHash: "",
          },
          latencyMs: 0,
        })
        return await h.summary(s.project)
      }
      case "heldout_run": {
        const s = this.#session(cmd.sessionId)
        const h = a.heldOut
        if (!h) throw new CommandError("unavailable", "Held-out checks are not available here")
        try {
          return await runHeldOutFor(s, h, a.audit, "you", a.heldOutExec?.(s.id))
        } catch (e) {
          if (e instanceof HeldOutError) throw new CommandError("invalid", e.message)
          throw e
        }
      }
      case "memory_status": {
        const st = (await a.governor?.status()) ?? { over: false }
        return {
          ...st,
          idle: a.manager.idle().map((i) => ({ id: i.id, title: i.title ?? i.project, project: i.project })),
        }
      }
      case "suspend_session": {
        // Recorded before it applies; refused when it cannot be.
        const s = this.#session(cmd.sessionId)
        const written = await a.audit.record({
          session: s.id,
          event: "session_suspended",
          channel: "desktop",
          tool: "session",
          cwd: s.cwd,
          project: s.project,
          input: { why: "memory" },
          verdict: {
            outcome: "allow",
            ruleId: "memory-governor",
            reason: "You suspended this idle session to free memory.",
            risk: 0,
            decidedBy: "human-desktop",
            policyHash: "",
          },
          latencyMs: 0,
        })
        if (!written) throw new CommandError("audit-failure", "It could not be recorded, so it was not suspended")
        a.terminal?.stop(s.id)
        return { info: await a.manager.suspend(s.id) }
      }
      case "close_session":
        a.terminal?.stop(cmd.sessionId)
        // One that could not come back after a restart is only put away.
        if (!a.manager.get(cmd.sessionId) && a.manager.dismiss(cmd.sessionId)) return undefined
        await this.#session(cmd.sessionId).close()
        return undefined
      case "term_run": {
        const t = a.terminal
        if (!t) throw new CommandError("unavailable", "The terminal is not available here")
        const s = this.#session(cmd.sessionId)
        try {
          const started = await t.run(s.id, s.cwd, cmd.command)
          this.#scrollback.add(s.id, { stream: "cmd", text: `> ${cmd.command}\n` })
          return started
        } catch (e) {
          if (e instanceof TerminalError) throw new CommandError("terminal", e.message)
          throw e
        }
      }
      case "term_stop":
        return { stopped: a.terminal?.stop(cmd.sessionId) ?? false }
      case "term_history":
        // T-112: the session's terminal as the Host kept it.
        this.#session(cmd.sessionId)
        return { chunks: this.#scrollback.get(cmd.sessionId) }
      case "term_clear":
        this.#scrollback.clear(cmd.sessionId)
        return { cleared: true }
      case "prompt": {
        const s = this.#session(cmd.sessionId)
        a.effort?.active(s.project)
        // E-073: a request for an explanation, by the area of the first project file it names, or the project.
        if (a.skills && asksToExplain(cmd.text)) {
          const named = /(?:^|[\s`'"(])((?:[\w.-]+\/)+[\w.-]+\.[A-Za-z]{1,6})\b/.exec(cmd.text)?.[1]
          a.skills.note("explain", named ? areaOf(findProjectRoot(s.cwd), named) : { language: "Any", area: `${s.project}/(the project)` })
        }
        // D-059: no turn starts on instructions changed outside Codehouse until you approve the change.
        await s.checkInstructions()
        // C-016: nor is anything sent to a model whose card saying where your words go is stale. Recorded.
        try {
          await refuseStaleSend(s, a.admin?.config().providers?.boundaries as Boundaries | undefined, a.audit)
        } catch (e) {
          if (e instanceof BoundaryStaleError) throw new CommandError("boundary-stale", e.message)
          throw e
        }
        s.prompt(cmd.text)
        return undefined
      }
      case "tell": {
        // G18: your message to another session, sent from this one's prompt box. It is yours, so it is a prompt like
        // any other there; the record says where it came from and went, and how long it was, never the words.
        if (cmd.from === cmd.to)
          throw new Error("Use the prompt box itself to talk to this session.")
        const target = this.#session(cmd.to)
        this.#session(cmd.from)
        target.prompt(cmd.text)
        await this.#opts.app.audit.record({
          session: cmd.to,
          event: "message_relayed",
          channel: "desktop",
          tool: "session",
          cwd: target.cwd,
          input: { from: cmd.from, to: cmd.to, chars: cmd.text.length },
          verdict: {
            outcome: "allow",
            ruleId: "message-relayed",
            reason: "You sent a message to this session from another session's prompt box (/tell).",
            risk: 0,
            decidedBy: "human-desktop",
            policyHash: "",
          },
          latencyMs: 0,
        })
        return undefined
      }
      case "review_dismiss": {
        // G16: a finding on a review card you chose not to fix. Recorded (redacted, like every record) before the card
        // lets it go; not recorded, it stays.
        const s = this.#session(cmd.sessionId)
        const recorded = await this.#opts.app.audit.record({
          session: cmd.sessionId,
          event: "review_finding_dismissed",
          channel: "desktop",
          tool: "review",
          cwd: s.cwd,
          input: { file: cmd.file, summary: cmd.summary },
          verdict: {
            outcome: "deny",
            ruleId: "review-dismissed",
            reason: "You dismissed a finding from a review of this session's changes.",
            risk: 0,
            decidedBy: "human-desktop",
            policyHash: "",
          },
          latencyMs: 0,
        })
        if (!recorded) throw new Error("It could not be recorded, so it stays.")
        return undefined
      }
      case "interrupt":
        // E-049: its jobs waiting to start are cancelled too; Interrupt itself never waits for them.
        a.scheduler?.cancelSession(cmd.sessionId, "the session was interrupted")
        await this.#session(cmd.sessionId).interrupt()
        return undefined
      case "stop_session":
        a.scheduler?.cancelSession(cmd.sessionId)
        await this.#session(cmd.sessionId).stop()
        return undefined
      case "resume_session": {
        // A session a limit paused, started again by you. Owner, 9 Nov: only once no limit in Settings would pause it
        // again; past a limit it takes a bypass, with a time or a most it may spend.
        const s = this.#session(cmd.sessionId)
        const over = await a.limits?.over(s.account)
        if (over)
          throw new Error(`${over} Bypass the limits for this session, with a time or a most it may spend, to keep going.`)
        await s.resume("you")
        return undefined
      }
      case "set_limit_protection":
        // The earlier form, from before 9 Nov: a time only.
        await this.#session(cmd.sessionId).setBypass(
          cmd.offMinutes === null ? null : { minutes: cmd.offMinutes },
        )
        return undefined
      case "set_limit_bypass":
        await this.#session(cmd.sessionId).setBypass(
          cmd.end
            ? null
            : {
                ...(cmd.minutes !== undefined ? { minutes: cmd.minutes } : {}),
                ...(cmd.maxUsd !== undefined ? { maxUsd: cmd.maxUsd } : {}),
              },
        )
        return undefined
      case "set_resources":
        await this.#session(cmd.sessionId).setResources(cmd.level)
        return undefined
      case "force_stop":
        return { info: (await a.manager.forceStop(cmd.sessionId)).info() }
      case "set_mode":
        await this.#session(cmd.sessionId).setMode(cmd.mode)
        return undefined
      case "set_effort":
        await this.#session(cmd.sessionId).setEffort(cmd.effort)
        return undefined
      case "set_goal":
        await this.#session(cmd.sessionId).setGoal(cmd.check ?? undefined)
        return undefined
      case "set_lease":
        await this.#session(cmd.sessionId).setLease(cmd.paths ?? undefined, cmd.commands ?? undefined)
        return undefined
      case "set_extreme":
        await this.#session(cmd.sessionId).setExtreme(cmd.on, cmd.max === true)
        return undefined
      case "set_model":
        await this.#session(cmd.sessionId).setModel(cmd.model)
        return undefined
      case "grant_tool": {
        // Owner, 13 Nov: one choice instead of one approval a fetch. Recorded by the session before it applies; then
        // the calls of that tool already waiting are allowed too, except those Extreme approval may never approve.
        const s = this.#session(cmd.sessionId)
        await s.grantTool(cmd.tool)
        let allowed = 0
        for (const v of a.broker.list())
          if (v.request.sessionId === s.id && v.request.toolName === cmd.tool && v.request.kind === "permission" && !NEVER_AUTO_APPROVED.has(v.request.verdict.ruleId))
            if (a.broker.resolve(v.request.id, { kind: "decision", decision: "allow" }, "desktop").ok) allowed++
        return { tool: cmd.tool, allowed }
      }
      case "secret_holds":
      case "secret_allow_once":
      case "secret_holds_clear": {
        // O59: the desktop only, as a grant is; never through Neighbourhood Watch or the phone (invariant 11).
        if (VIA.getStore()) throw new CommandError("desktop-only", "Held for secrets is on this computer's Codehouse window only.")
        const holds = a.secretHolds
        if (!holds) throw new CommandError("unavailable", "Held for secrets is not available in this Codehouse.")
        if (cmd.type === "secret_holds") return { repos: holds.list() }
        if (cmd.type === "secret_holds_clear") {
          const cleared = holds.clear(cmd.repo)
          await a.audit
            .record({
              session: "desktop",
              event: "secret_holds_cleared",
              channel: "desktop",
              tool: "secret-in-commit",
              cwd: cmd.repo,
              input: { repo: cmd.repo },
              verdict: { outcome: "allow", ruleId: "secret-in-commit", reason: "You cleared what was held for secrets in this repository.", risk: 0, decidedBy: "human-desktop", policyHash: "" },
              latencyMs: 0,
            })
            .catch(() => false)
          return { cleared }
        }
        const finding = { kind: cmd.kind, file: cmd.file, ...(cmd.line !== undefined ? { line: cmd.line } : {}) }
        if (!holds.isHeld(cmd.repo, finding)) throw new CommandError("not-held", "That finding is not held in this repository now.")
        // Recorded before it applies: an allowance that is not in the audit log is not given (invariant 13).
        const written = await a.audit
          .record({
            session: "desktop",
            event: "secret_allowed_once",
            channel: "desktop",
            tool: "secret-in-commit",
            cwd: cmd.repo,
            input: { repo: cmd.repo, ...finding },
            verdict: {
              outcome: "allow",
              ruleId: "secret-in-commit",
              reason: `You allowed ${cmd.kind} in ${cmd.file || "a staged file"}${cmd.line ? `, line ${cmd.line}` : ""} once, for the next commit or push that finds it.`,
              risk: 100,
              decidedBy: "human-desktop",
              policyHash: "",
            },
            latencyMs: 0,
          })
          .catch(() => false)
        if (!written) throw new CommandError("audit", "The allowance could not be recorded in the audit log, so it was not given.")
        if (!holds.allowOnce(cmd.repo, finding)) throw new CommandError("not-held", "That finding is not held in this repository now.")
        return { allowed: true }
      }
      case "approve": {
        // D-021: after approvals too fast to have been read, the next High one wants a second, deliberate approval.
        const view = a.broker.get(cmd.requestId)
        const risk = view?.request.verdict.risk ?? 0
        const stamp = this.#rubberStamp
        // A Severe request you typed allow for has been read on purpose: the friction does not ask again (owner, 13 Nov).
        const typedSevere = cmd.typed === true && risk >= SEVERE_RISK
        // O57 (owner, 26 Nov): "Slow down fast approvals", off unless switched on. Off, nothing asks again or waits;
        // a run of fast approvals is still recorded in the audit log below.
        const slow = a.admin?.config().slowFastApprovals === true
        if (slow && view && !typedSevere && stamp.needsDeliberate(risk)) {
          const shownAt = this.#frictionAt.get(cmd.requestId)
          if (!cmd.deliberate || shownAt === undefined || Date.now() - shownAt < FRICTION_WAIT_MS) {
            if (shownAt === undefined) {
              this.#frictionAt.set(cmd.requestId, Date.now())
              await a.audit
                .record({
                  session: view.request.sessionId,
                  event: "approval_friction_shown",
                  channel: "desktop",
                  tool: view.request.toolName,
                  toolUseId: view.request.toolUseId,
                  cwd: view.request.cwd,
                  project: view.request.project,
                  input: { risk },
                  verdict: {
                    outcome: "escalate",
                    ruleId: "rubber-stamp",
                    reason: "Approvals came faster than they could be read, so this High one asks again.",
                    risk,
                    decidedBy: "rules",
                    policyHash: "",
                  },
                  latencyMs: 0,
                })
                .catch(() => false)
            }
            throw new CommandError(
              "friction",
              "You approved several requests faster than they could be read. Look at what this one does; you can allow it after two seconds, or give it a limited grant instead.",
            )
          }
        }
        // O41: from Neighbourhood Watch, a Severe approval needs someone signed in, not just an allowed network.
        const via = VIA.getStore()
        if (via && !via.signedIn && risk >= SEVERE_RISK)
          throw new CommandError("sign-in", "Sign in to Neighbourhood Watch to approve a Severe request.")
        const r = a.broker.resolve(
          cmd.requestId,
          {
            kind: "decision",
            decision: "allow",
            ...(cmd.message !== undefined ? { message: cmd.message } : {}),
            ...(cmd.updatedInput !== undefined ? { updatedInput: cmd.updatedInput } : {}),
            ...(cmd.remember ? { remember: true } : {}),
            ...(cmd.remember && cmd.rememberFor ? { rememberFor: cmd.rememberFor } : {}),
          },
          channelNow(),
        )
        if (r.ok && view) {
          // E-073: an agent's edit you accepted, by its language and area.
          const file = (view.request.input as { file_path?: unknown; notebook_path?: unknown } | undefined)?.file_path ?? (view.request.input as { notebook_path?: unknown } | undefined)?.notebook_path
          if (a.skills && typeof file === "string" && ["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(view.request.toolName)) a.skills.note("accept", areaOf(findProjectRoot(view.request.cwd), file))
          this.#frictionAt.delete(cmd.requestId)
          if (slow && (cmd.deliberate || typedSevere) && stamp.needsDeliberate(risk)) stamp.deliberate()
          else {
            const run = stamp.approved({ risk, ...(cmd.shownMs !== undefined ? { shownMs: cmd.shownMs } : {}), ...(cmd.opened !== undefined ? { opened: cmd.opened } : {}) })
            if (run && !slow) {
              // O57: off, the run is recorded and counting starts again; nothing is slowed.
              stamp.deliberate()
              await a.audit
                .record({
                  session: view.request.sessionId,
                  event: "approval_fast_run",
                  // The audit's channels, as the friction's record has; Neighbourhood Watch answers through this one.
                  channel: "desktop",
                  tool: view.request.toolName,
                  toolUseId: view.request.toolUseId,
                  cwd: view.request.cwd,
                  project: view.request.project,
                  input: { risk, ...(cmd.shownMs !== undefined ? { shownMs: cmd.shownMs } : {}), ...(cmd.opened !== undefined ? { opened: cmd.opened } : {}) },
                  verdict: {
                    outcome: "allow",
                    ruleId: "rubber-stamp",
                    reason: "Approvals came faster than they could be read. Slow down fast approvals is off, so nothing asked again.",
                    risk,
                    decidedBy: "rules",
                    policyHash: "",
                  },
                  latencyMs: 0,
                })
                .catch(() => false)
            }
          }
        }
        return resolveResult(r)
      }
      case "deny":
        // D-021: a deny is never slowed, and ends a run of fast approvals.
        this.#rubberStamp.denied()
        return resolveResult(
          a.broker.resolve(
            cmd.requestId,
            {
              kind: "decision",
              decision: "deny",
              ...(cmd.message !== undefined ? { message: cmd.message } : {}),
            },
            channelNow(),
          ),
        )
      case "answer":
        return resolveResult(
          a.broker.resolve(cmd.requestId, { kind: "answers", answers: cmd.answers }, channelNow()),
        )
      case "remember_preview": {
        const view = a.broker.get(cmd.requestId)
        if (!view) throw new CommandError("unknown-request", "That request is not waiting any more")
        const check = await checkRemember(
          a.engine,
          a.policy(),
          { toolName: view.request.toolName, input: view.rawInput },
          { cwd: view.request.cwd },
          a.pwsh,
        )
        if (!check.ok) return check
        // D-015: refused when what the session read mentions it; a site is to be typed to confirm.
        const why = a.manager.get(view.request.sessionId)?.untrustedMention(check.candidate)
        if (why) return { ok: false, reason: why }
        return { ...check, ...(check.candidate.host ? { typeToConfirm: check.candidate.host } : {}) }
      }
      case "restart":
        if (!a.restart)
          throw new CommandError(
            "unavailable",
            "Codehouse cannot restart itself from here. Quit it from the tray icon and open it again.",
          )
        a.restart()
        return { restarting: true }
      case "kill":
        return await a.kill.engage("desktop", "Kill switch from the desktop")
      case "rearm":
        return await a.kill.rearm("desktop")
      case "changes": {
        const s = this.#session(cmd.sessionId)
        return await a.checkpoints.changes(s.cwd, s.id, cmd.ref)
      }
      case "mutant_task": {
        const s = this.#session(cmd.sessionId)
        s.startMutantTask(cmd.survivor)
        return { started: true }
      }
      case "mutation_run": {
        // D-004: the changed lines of the change since the checkpoint, mutated one at a time in a sandbox copy.
        const s = this.#session(cmd.sessionId)
        if (!a.mutationExec) throw new CommandError("unavailable", "Mutation runs are not available here.")
        const c = await a.checkpoints.changes(s.cwd, s.id, cmd.ref)
        if (!c.since || !("files" in c)) throw new CommandError("no-checkpoint", "This session has no checkpoint yet, so there is no change to test.")
        const command = projectCommand(s.cwd, "tests")
        if (!command) throw new CommandError("no-tests", "Codehouse could not find this project's test command (an npm test script, pytest or dotnet test).")
        const changes: Array<{ path: string; text: string; lines: Set<number> }> = []
        for (const x of c.files.filter((x) => x.change !== "deleted" && !x.binary && /\.[cm]?[jt]sx?$/i.test(x.path)).slice(0, 30)) {
          const lines = [...addedLines(x.diff).values()][0]
          const v = lines?.size ? await a.checkpoints.versions(s.cwd, c.since.ref, x.path).catch(() => undefined) : undefined
          if (lines && v?.after !== undefined) changes.push({ path: x.path, text: v.after, lines })
        }
        const threshold = a.admin?.config().mutation?.thresholds?.[s.project]
        const report = await runMutation({
          root: s.cwd,
          changes,
          command,
          exec: a.mutationExec(s.id),
          sandbox: path.join(os.tmpdir(), `codeh-mutants-${s.id}-${Date.now().toString(36)}`),
          ...(threshold !== undefined ? { threshold } : {}),
        })
        // E-048: the latest mutation score, for a gate that asks for one.
        if (report.score !== undefined) this.#mutationScores.set(s.id, report.score)
        await a.audit.record({
          session: s.id,
          event: "mutation_run",
          channel: "host",
          tool: "mutation",
          cwd: s.cwd,
          project: s.project,
          input: { tool: report.tool, mutants: report.mutants, killed: report.killed, survived: report.survived.length, ...(report.score !== undefined ? { score: report.score } : {}), ...(report.aborted ? { aborted: report.aborted } : {}) },
          verdict: { outcome: "allow", ruleId: "mutation-run", reason: report.aborted ? `A mutation run stopped: ${report.aborted}.` : "The tests were run against small changes to the change's new lines.", risk: 0, decidedBy: "rules", policyHash: "n/a" },
          latencyMs: 0,
        })
        return report
      }
      case "third_party_notices": {
        const s = this.#session(cmd.sessionId)
        const root = findProjectRoot(s.cwd)
        const n = collectNotices(root)
        const text = noticesText(s.project, n)
        let written: string | undefined
        if (cmd.write && !n.none) {
          // Your action, from this window: one file at the project's root, written whole.
          const file = path.join(root, "THIRD-PARTY-NOTICES.txt")
          await writeFileAtomic(file, text)
          written = "THIRD-PARTY-NOTICES.txt"
          await a.audit.record({
            session: s.id, event: "notices_written", channel: "desktop", tool: "release", cwd: s.cwd, project: s.project, input: { file: written, packages: n.entries.length, missing: n.missing.length },
            verdict: { outcome: "allow", ruleId: "third-party-notices", reason: `You wrote the third-party notices (${n.entries.length} packages, ${n.missing.length} with something missing)`, risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
            latencyMs: 0,
          })
        }
        return { packages: n.entries.length, missing: n.missing, ...(n.none ? { none: n.none } : {}), text, ...(written ? { written } : {}) }
      }
      case "daily_plan": {
        const pendingOf = (id: string) => a.broker.list().filter((p) => p.request.sessionId === id).length
        const last = a.nights?.all().at(-1)
        const night = last
          ? { lines: morningReport(last, (id) => a.manager.get(id)?.info(), pendingOf).lines.map((l) => ({ ...l, ...(last.outcomes[l.task]?.sessionId ? { sessionId: last.outcomes[l.task]!.sessionId! } : {}) })) }
          : undefined
        const today = new Date()
        const day = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][today.getDay()]!
        const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
        const routines = a.admin?.routines?.list() ?? []
        return {
          items: dailyPlan({
            sessions: a.manager.list().map((s) => ({ id: s.id, project: s.project, title: (s as { title?: string }).title ?? s.project, claims: (s.claims ?? []).map((c) => ({ outcome: c.outcome, quote: c.quote })) })),
            pending: a.broker.list().map((p) => ({ id: p.request.id, sessionId: p.request.sessionId, project: p.request.project, tool: p.request.toolName, risk: p.request.verdict.risk, reason: p.request.verdict.reason })),
            reminders: grantReminders(this.exceptions().grants),
            ...(night ? { night } : {}),
            runs: a.admin?.routines?.runs() ?? [],
            today: routines.filter((r) => r.enabled && !r.trigger && (r.once ? r.once.startsWith(ymd) : r.days.includes(day as never))).map((r) => ({ name: r.name, time: r.once ? r.once.slice(11) : r.time })),
          }),
        }
      }
      case "reviewers": {
        const s = this.#session(cmd.sessionId)
        const root = findProjectRoot(s.cwd)
        const files = (await changedSince(root)).map((f) => f.file)
        const { history, me } = await historyOf(root, files)
        return { files: files.length, suggestions: suggestReviewers(history, me) }
      }
      case "exceptions_register": {
        const r = this.exceptions()
        return { ...r, reminders: grantReminders(r.grants), csv: registerCsv(r) }
      }
      case "handover_pack": {
        // E-077: across every project; redacted, then signed with this computer's key.
        if (!a.knowledgeKey) throw new CommandError("unavailable", "Handover packs are not available here.")
        const key = a.knowledgeKey
        const terms = a.admin?.config().redactTerms ?? []
        const pack = makeHandover({
          by: cmd.by,
          note: cmd.note,
          sessions: a.manager.list().map((s) => ({ id: s.id, project: s.project, title: (s as { title?: string }).title ?? s.project, state: String(s.state), mode: String((s as { mode?: string }).mode ?? "") })),
          pending: a.broker.list().map((p) => ({ id: p.request.id, project: p.request.project, tool: p.request.toolName, risk: p.request.verdict.risk, reason: p.request.verdict.reason, waitingSince: String((p.request as { createdAt?: string }).createdAt ?? "") })),
          grants: (a.policy()?.rules.allow ?? []).filter((r) => r.id.startsWith("remember-")).map((r) => ({ id: r.id, reason: r.message ?? r.commands?.join(" ") ?? r.id, ...(typeof (r as { notAfter?: number }).notAfter === "number" ? { notAfter: (r as { notAfter?: number }).notAfter } : {}) })),
          routines: (a.admin?.routines?.list() ?? []).map((r) => ({ id: r.id, name: r.name, project: path.basename(r.folder), when: r.once ?? (r.trigger ? `on ${r.trigger.kind}` : `${r.time} on ${r.days.join(", ")}`), enabled: r.enabled })),
          redact: (t) => redactString(t, { terms }),
        })
        const signed = await signHandover(pack, (b) => key.signBytes(b))
        await a.audit.record({
          session: "desktop", event: "handover_pack_made", channel: "desktop", tool: "handover", input: { sessions: pack.sessions.length, pending: pack.pending.length, grants: pack.grants.length, routines: pack.routines.length },
          verdict: { outcome: "allow", ruleId: "handover-pack", reason: "You made a signed handover pack across your projects", risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
          latencyMs: 0,
        })
        return { signed, markdown: handoverMarkdown(pack) }
      }
      case "handover_open": {
        // The signature must hold; whether the key is one you trust is said, not required.
        const r = openHandover(cmd.signed)
        if (!r.ok) throw new CommandError("refused", r.why)
        const pub = (cmd.signed as { publicKey?: string }).publicKey?.trim()
        return { markdown: handoverMarkdown(r.pack), trustedKey: (a.admin?.config().rulePackKeys ?? []).some((k) => k.trim() === pub) }
      }
      case "pattern_cards": {
        const s = this.#session(cmd.sessionId)
        const root = findProjectRoot(s.cwd)
        const cards = patternCards(root, await listFiles(root).catch(() => [] as string[]))
        const markdown = cardsMarkdown(s.project, cards)
        if (cmd.save) {
          if (!cards.length) throw new CommandError("no-cards", "No pattern has two examples yet, so there is nothing to save.")
          // Your action, from this window: one file in the project's .codehouse folder.
          fs.mkdirSync(path.join(root, ".codehouse"), { recursive: true })
          await writeFileAtomic(path.join(root, ".codehouse", "patterns.md"), markdown)
          await a.audit.record({
            session: s.id, event: "pattern_cards_saved", channel: "desktop", tool: "patterns", cwd: s.cwd, project: s.project, input: { cards: cards.map((c) => c.topic) },
            verdict: { outcome: "allow", ruleId: "pattern-cards", reason: "You saved the project's pattern cards as .codehouse/patterns.md", risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
            latencyMs: 0,
          })
        }
        return { cards, markdown }
      }
      case "tutor_start": {
        // E-072: in Manual mode, with the tutor overlay; it can only restrict.
        const s = this.#session(cmd.sessionId)
        const child = await a.manager.start({ cwd: s.cwd, tutor: true, mode: "default" })
        await a.audit.record({
          session: child.id, event: "tutor_started", channel: "desktop", tool: "tutor", cwd: child.cwd, project: child.project, input: { from: s.id, topic: cmd.topic },
          verdict: { outcome: "allow", ruleId: "tutor-started", reason: "You started a tutor session: the agent gives hints, and may edit only tests.", risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
          latencyMs: 0,
        })
        child.prompt(tutorPrompt(cmd.topic))
        return { session: child.info() }
      }
      case "teach_back": {
        // E-071: the change from git and your words; nothing is sent anywhere.
        const s = this.#session(cmd.sessionId)
        const files = await changedSince(findProjectRoot(s.cwd))
        if (!files.length) throw new CommandError("no-change", "There is no change to explain: nothing differs from the default branch.")
        return teachBack(cmd.explanation, files)
      }
      case "skills":
        return { areas: a.skills?.areas() ?? [], suggestions: a.skills?.suggestions() ?? [] }
      case "skills_delete": {
        const n = (await a.skills?.delete()) ?? 0
        await a.audit.record({
          session: "desktop", event: "skills_deleted", channel: "desktop", tool: "skills", input: { areas: n },
          verdict: { outcome: "allow", ruleId: "skills", reason: "You deleted the skill growth record", risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
          latencyMs: 0,
        })
        return { deleted: n }
      }
      case "industry_packs": {
        const ip = a.industryPacks
        if (!ip) throw new CommandError("unavailable", "Industry packs are not available here.")
        const trusted = a.admin?.config().rulePackKeys ?? []
        const mine = a.knowledgeKey ? await a.knowledgeKey.publicKey() : undefined
        const signedOf = (id: string): SignedIndustryPack | undefined => {
          try {
            return JSON.parse(fs.readFileSync(path.join(ip.signedDir, `${id}.json`), "utf8")) as SignedIndustryPack
          } catch {
            return undefined
          }
        }
        return {
          publicKey: mine,
          keyTrusted: !!mine && trusted.some((k) => k.trim() === mine.trim()),
          packs: draftPacks(ip.draftsDir).map((d) => {
            const id = d.pack?.id
            const signed = id ? signedOf(id) : undefined
            return { file: d.file, ...(d.pack ? { id, industry: d.pack.industry, title: d.pack.title, status: d.pack.status, rules: [...(d.pack.rules.escalate ?? []), ...(d.pack.rules.deny ?? [])].map((r) => ({ id: r.id, message: r.message ?? "" })), checklist: d.pack.checklist } : {}), ...(d.errors ? { errors: d.errors } : {}), ...(signed ? { review: signed.review } : {}), installed: !!id && fs.existsSync(path.join(ip.packsDir, `${id}.yaml`)) }
          }),
        }
      }
      case "industry_pack_sign": {
        const ip = a.industryPacks
        if (!ip || !a.knowledgeKey) throw new CommandError("unavailable", "Industry packs are not available here.")
        const pack = draftPacks(ip.draftsDir).find((d) => d.pack?.id === cmd.id)?.pack
        if (!pack) throw new CommandError("unknown-pack", "There is no such industry pack, or it is not valid.")
        const key = a.knowledgeKey
        let signed: SignedIndustryPack
        try {
          signed = await signIndustryPack(pack, { by: cmd.by, note: cmd.note }, (b) => key.signBytes(b))
        } catch (e) {
          throw new CommandError("not-signed", (e as Error).message)
        }
        fs.mkdirSync(ip.signedDir, { recursive: true })
        await writeFileAtomic(path.join(ip.signedDir, `${cmd.id}.json`), JSON.stringify(signed, null, 2) + "\n")
        await a.audit.record({
          session: "desktop", event: "industry_pack_signed", channel: "desktop", tool: "policy", input: { pack: cmd.id, by: signed.review.by, note: signed.review.note },
          verdict: { outcome: "allow", ruleId: "industry-pack", reason: `${signed.review.by} reviewed and signed the industry pack ${cmd.id}`, risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
          latencyMs: 0,
        })
        return { signed: cmd.id, review: signed.review }
      }
      case "industry_pack_install": {
        const ip = a.industryPacks
        if (!ip) throw new CommandError("unavailable", "Industry packs are not available here.")
        let signed: SignedIndustryPack | undefined
        try {
          signed = JSON.parse(fs.readFileSync(path.join(ip.signedDir, `${cmd.id}.json`), "utf8")) as SignedIndustryPack
        } catch {
          signed = undefined
        }
        let r: Awaited<ReturnType<typeof installIndustryPack>>
        try {
          r = await installIndustryPack(signed, { trustedKeys: a.admin?.config().rulePackKeys ?? [], packsDir: ip.packsDir, checklistDir: ip.checklistDir })
        } catch (e) {
          throw new CommandError("not-installed", (e as Error).message)
        }
        await a.audit.record({
          session: "desktop", event: "industry_pack_installed", channel: "desktop", tool: "policy", input: { pack: r.id, rules: r.rules, checklist: r.checklist, reviewedBy: signed?.review.by ?? "" },
          verdict: { outcome: "allow", ruleId: "industry-pack", reason: `You installed the signed industry pack ${r.id}: ${r.rules} rules and ${r.checklist} checklist items`, risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
          latencyMs: 0,
        })
        return r
      }
      case "sequence_diagram": {
        // E-084: read from the code with Tree-sitter; nothing is run.
        const s = this.#session(cmd.sessionId)
        const root = findProjectRoot(s.cwd)
        const files = await listFiles(root).catch(() => [] as string[])
        let seq: Awaited<ReturnType<typeof sequenceFrom>>
        try {
          seq = await sequenceFrom(root, files, cmd.entry, cmd.depth ?? 3)
        } catch (e) {
          throw new CommandError("no-entry", (e as Error).message)
        }
        const name = cmd.entry.split("#")[1] ?? cmd.entry
        const artifact = a.artifacts ? await a.artifacts.save(s.id, `Sequence: ${name}`, "mermaid", seq.mermaid) : undefined
        return { ...seq, ...(artifact ? { artifact: { id: artifact.id, version: artifact.version.version } } : {}) }
      }
      case "meeting_notes": {
        const s = this.#session(cmd.sessionId)
        const root = findProjectRoot(s.cwd)
        const abs = path.resolve(root, cmd.file)
        const rel = path.relative(root, abs)
        if (rel.startsWith("..") || path.isAbsolute(rel)) throw new CommandError("outside", "The transcript must be in the project.")
        if (!/\.(txt|vtt|srt|md)$/i.test(abs)) throw new CommandError("not-transcript", "A transcript is a .txt, .vtt, .srt or .md file.")
        let text: string
        try {
          if (fs.statSync(abs).size > 5 * 1024 * 1024) throw new CommandError("too-big", "A transcript can be up to 5 MB.")
          text = fs.readFileSync(abs, "utf8")
        } catch (e) {
          if (e instanceof CommandError) throw e
          throw new CommandError("missing", "There is no such transcript in the project.")
        }
        const file = rel.replace(/\\/g, "/")
        const x = extractMeeting(file, text)
        const files = planMeeting(root, file, x)
        const out = { ...x, files: files.map((f) => ({ file: f.file, exists: f.exists })) }
        if (!cmd.write) return out
        const done = await writeMeeting(root, files)
        await a.audit.record({
          session: s.id, event: "meeting_notes_written", channel: "desktop", tool: "backlog", cwd: s.cwd, project: s.project, input: { transcript: file, written: done.written, skipped: done.skipped, stories: x.stories.length, decisions: x.decisions.length, actions: x.actions.length },
          verdict: { outcome: "allow", ruleId: "meeting-notes", reason: `You added a meeting's ${x.stories.length} stories, ${x.decisions.length} decisions and ${x.actions.length} actions to the backlog`, risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
          latencyMs: 0,
        })
        return { ...out, ...done }
      }
      case "retention_status": {
        const s = this.#session(cmd.sessionId)
        const c = (a.admin?.config() ?? {}) as RetentionConfig
        return {
          project: s.project,
          classification: classificationOf(c.dataClassification, s.project),
          days: Object.fromEntries(RETENTION_KINDS.map((k) => [k, retentionDays(c, k, s.project)])),
          holds: (a.legalHolds?.list() ?? []).filter((h) => h.project === undefined || h.project.toLowerCase() === s.project.toLowerCase()),
        }
      }
      case "legal_hold_place": {
        const s = this.#session(cmd.sessionId)
        if (!a.legalHolds) throw new CommandError("unavailable", "Legal holds are not kept here")
        const hold = await a.legalHolds.place({ ...(cmd.all ? {} : { project: s.project }), reason: cmd.reason })
        await a.audit.record({
          session: s.id, event: "legal_hold_placed", channel: "desktop", tool: "retention", cwd: s.cwd, project: s.project, input: { hold: hold.id, all: cmd.all === true, reason: cmd.reason },
          verdict: { outcome: "allow", ruleId: "legal-hold", reason: `You placed a legal hold on ${cmd.all ? "every project" : s.project}: ${cmd.reason}`, risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
          latencyMs: 0,
        })
        return hold
      }
      case "legal_hold_release": {
        const s = this.#session(cmd.sessionId)
        if (!a.legalHolds) throw new CommandError("unavailable", "Legal holds are not kept here")
        const gone = await a.legalHolds.release(cmd.holdId)
        if (!gone) throw new CommandError("unknown-hold", "That legal hold is not there any more")
        await a.audit.record({
          session: s.id, event: "legal_hold_released", channel: "desktop", tool: "retention", cwd: s.cwd, project: s.project, input: { hold: gone.id, project: gone.project ?? "(every project)", reason: gone.reason },
          verdict: { outcome: "allow", ruleId: "legal-hold", reason: `You released the legal hold on ${gone.project ?? "every project"} (${gone.reason})`, risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
          latencyMs: 0,
        })
        return { released: gone.id }
      }
      case "residency_statement": {
        const s = this.#session(cmd.sessionId)
        if (!a.residency) throw new CommandError("unavailable", "The data residency record is not kept here")
        return { markdown: a.residency.statement(s.project, cmd.from, cmd.to) }
      }
      case "ai_register": {
        const s = this.#session(cmd.sessionId)
        if (!a.aiRegister) throw new CommandError("unavailable", "The AI system register is not kept here")
        const project = cmd.all ? undefined : s.project
        return { entries: a.aiRegister.list(project), markdown: a.aiRegister.markdown(project) }
      }
      case "energy_estimate": {
        const s = this.#session(cmd.sessionId)
        const project = cmd.all ? undefined : s.project
        const snap = a.usage.snapshot()
        const t = project ? snap.byProject[project] : snap.total
        return {
          project: project ?? "every project",
          ...energyEstimate({
            cpuSeconds: a.energy?.cpuSeconds(project) ?? 0,
            cores: os.cpus().length,
            tokens: (t?.inputTokens ?? 0) + (t?.outputTokens ?? 0),
            config: ((a.admin?.config() as { energy?: EnergyConfig } | undefined)?.energy ?? {}),
          }),
          figures: (a.admin?.config() as { energy?: EnergyConfig } | undefined)?.energy ?? {},
        }
      }
      case "energy_figures": {
        // Only the energy figures change; everything else in the settings file is kept as it is.
        const admin = a.admin
        if (!admin) throw new CommandError("unavailable", "Settings are not available here.")
        const file = configPath(admin.env)
        let onDisk: Record<string, unknown> = {}
        try {
          onDisk = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>
        } catch {
          onDisk = {}
        }
        const energy: EnergyConfig = {
          ...((onDisk.energy as EnergyConfig | undefined) ?? {}),
          ...(cmd.deviceWatts !== null ? { deviceWatts: cmd.deviceWatts } : {}),
          ...(cmd.modelWhPer1kTokens !== null ? { modelWhPer1kTokens: cmd.modelWhPer1kTokens } : {}),
          ...(cmd.gridGramsPerKwh !== null ? { gridGramsPerKwh: cmd.gridGramsPerKwh } : {}),
        }
        for (const k of ["deviceWatts", "modelWhPer1kTokens", "gridGramsPerKwh"] as const) if (cmd[k] === null) delete energy[k]
        fs.mkdirSync(path.dirname(file), { recursive: true })
        await writeFileAtomic(file, JSON.stringify({ ...onDisk, energy }, null, 2) + "\n")
        ;(admin.config() as { energy?: EnergyConfig }).energy = energy
        return { figures: energy }
      }
      case "effort_active": {
        a.effort?.active(this.#session(cmd.sessionId).project)
        return { ok: true }
      }
      case "effort_export": {
        // E-063: to this window only; the log is never sent anywhere else.
        const s = this.#session(cmd.sessionId)
        if (!a.effort) throw new CommandError("unavailable", "The effort log is not kept here")
        return { csv: a.effort.csv(cmd.all ? {} : { project: s.project }) }
      }
      case "effort_delete": {
        const s = this.#session(cmd.sessionId)
        if (!a.effort) throw new CommandError("unavailable", "The effort log is not kept here")
        const days = await a.effort.delete(cmd.all ? undefined : s.project)
        await a.audit.record({
          session: s.id, event: "effort_log_deleted", channel: "desktop", tool: "effort", cwd: s.cwd, project: s.project, input: { all: cmd.all === true, days },
          verdict: { outcome: "allow", ruleId: "effort-log", reason: `You deleted the effort log of ${cmd.all ? "every project" : s.project}`, risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
          latencyMs: 0,
        })
        return { days }
      }
      case "backout_check": {
        // E-060: a scratch worktree; the tests after the revert run as a Codehouse action; your tree is never touched.
        const s = this.#session(cmd.sessionId)
        const root = findProjectRoot(s.cwd)
        const r = await this.#backout(s, root)
        this.#backouts.set(root.toLowerCase(), { reversible: r.reversible, detail: r.detail })
        await a.audit.record({
          session: s.id, event: "backout_checked", channel: "desktop", tool: "release", cwd: s.cwd, project: s.project, input: { reversible: r.reversible, revert: r.revert, tests: r.tests, migrations: r.migrations },
          verdict: { outcome: "allow", ruleId: "backout-check", reason: `The change is ${r.reversible ? "" : "not "}reversible: ${r.detail}`, risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
          latencyMs: 0,
        })
        return r
      }
      case "change_record": {
        // E-059: every field from the evidence, or marked as needing your input.
        const s = this.#session(cmd.sessionId)
        const root = findProjectRoot(s.cwd)
        const rd = readiness(await this.#readinessInput(s, root))
        const base = await this.#base(root)
        const range = base ? `${base}..HEAD` : "-50"
        const commits = ((await gitOut(root, ["log", "--format=%H%x00%s", range])) ?? "").split("\n").filter(Boolean).map((l) => {
          const [sha, subject] = l.split("\x00")
          return { sha: sha!, subject: subject ?? "" }
        })
        const named = new Set(commits.flatMap((c) => c.subject.match(/[A-Z][A-Z0-9]{1,9}-[0-9A-F]{1,7}/g) ?? []))
        const requirements = readRequirements(root).requirements.filter((q) => named.has(q.id)).map((q) => ({ id: q.id, title: q.title }))
        const files = ((await gitOut(root, ["diff", "--name-only", base ? `${base}` : "HEAD~1", "HEAD"])) ?? "").split("\n").map((l) => l.trim()).filter(Boolean)
        const candidate = cmd.candidate?.trim() || `${s.project} at ${commits[0]?.sha.slice(0, 7) ?? "HEAD"}`
        const backout = this.#backouts.get(root.toLowerCase())
        const fields = changeRecord({ candidate, commits, requirements, readiness: rd, claims: s.info().claims ?? [], files, ...(backout ? { backout } : {}), ...(cmd.schedule?.trim() ? { schedule: cmd.schedule.trim() } : {}) })
        return { fields, markdown: cabPack(candidate, fields, readinessMarkdown(rd, candidate)) }
      }
      case "release_readiness": {
        // E-058: read only, apart from the sealed checks and the definition of done's commands, run as Codehouse actions.
        const s = this.#session(cmd.sessionId)
        const root = findProjectRoot(s.cwd)
        const r = readiness(await this.#readinessInput(s, root))
        const candidate = cmd.candidate?.trim() || `${s.project} at ${((await gitOut(root, ["rev-parse", "--short", "HEAD"])) ?? "").trim() || "HEAD"}`
        await a.audit.record({
          session: s.id, event: "release_readiness", channel: "desktop", tool: "release", cwd: s.cwd, project: s.project,
          input: { candidate, ready: r.ready, blocks: r.sections.filter((x) => x.state === "blocks").map((x) => x.name) },
          verdict: { outcome: "allow", ruleId: "release-readiness", reason: r.ready ? `${candidate} is ready.` : `${candidate} is not ready: ${r.reasons.join(" ")}`, risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
          latencyMs: 0,
        })
        return { ...r, candidate, markdown: readinessMarkdown(r, candidate) }
      }
      case "dod": {
        // E-057: ticks are the desktop's alone, recorded; the status reads the change and runs the item's commands.
        const s = this.#session(cmd.sessionId)
        const root = findProjectRoot(s.cwd)
        const dod = readDod(root)
        if (!dod) return { items: undefined }
        if (cmd.step !== "status") {
          if (!cmd.item || !a.dodTicks) throw new CommandError("invalid", "Name the item.")
          a.dodTicks.tick(s.id, cmd.item, cmd.step === "tick")
          await a.audit.record({
            session: s.id, event: cmd.step === "tick" ? "dod_ticked" : "dod_unticked", channel: "desktop", tool: "dod", cwd: s.cwd, project: s.project, input: { item: cmd.item },
            verdict: { outcome: "allow", ruleId: "dod", reason: `You ${cmd.step === "tick" ? "ticked" : "unticked"} "${cmd.item}" in the definition of done.`, risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
            latencyMs: 0,
          })
        }
        const run = a.runAction
        const items = await dodItems(root, dod, a.dodTicks?.of(s.id) ?? new Set(), {
          changed: (await changedFiles(root)) ?? new Set<string>(),
          run: async (command, cwd) => {
            if (!run) return { ran: false, exitCode: null, refused: "Codehouse actions are not available here" }
            const x = await run(s.id, command, cwd, "checking the definition of done")
            return { ran: !x.refused, exitCode: x.exitCode, ...(x.refused ? { refused: x.refused } : {}) }
          },
        })
        return { items }
      }
      case "work_items": {
        // E-056: found locally and kept locally; nothing is sent to Azure DevOps or Jira.
        const s = this.#session(cmd.sessionId)
        const root = findProjectRoot(s.cwd)
        if (!a.workItems) throw new CommandError("unavailable", "Work item links are not available here.")
        const links = a.workItems.merge(root, await scanLinks(root, s.id, s.cwd))
        if (cmd.step === "export") return { text: exportLinks(links, cmd.format ?? "csv") }
        return { links }
      }
      case "epic": {
        // E-062: the session returns the stories as a checked result; Codehouse writes them with stable ids.
        const s = this.#session(cmd.sessionId)
        if (cmd.step === "ask") {
          if (!cmd.brief?.trim()) throw new CommandError("invalid", "Give the epic's brief.")
          s.prompt(`${epicPrompt(cmd.epic, cmd.brief)}${resultInstruction(JSON.stringify(STORY_SCHEMA, null, 2))}`)
          return undefined
        }
        const r = check(lastJson(s.lastResult()), STORY_SCHEMA as unknown as Record<string, unknown>)
        if (!r.ok) throw new CommandError("invalid", `The session's last message does not hold the stories as asked: ${r.errors.join("; ")}`)
        const written = writeStories(findProjectRoot(s.cwd), cmd.epic, (r.value as { stories: StoryInput[] }).stories, a.projectEstimate?.(s.project))
        await a.audit.record({
          session: s.id, event: "epic_decomposed", channel: "desktop", tool: "ledger", cwd: s.cwd, project: s.project,
          input: { epic: cmd.epic, stories: written.map((w) => w.id), written: written.filter((w) => w.written).length },
          verdict: { outcome: "allow", ruleId: "epic", reason: `You wrote ${written.filter((w) => w.written).length} stories of "${cmd.epic}" into the requirement ledger.`, risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
          latencyMs: 0,
        })
        return { stories: written }
      }
      case "night": {
        // E-054: in dependency order, through the scheduler, each within its cap and the night's budget.
        const store = a.nights
        if (!store) throw new CommandError("unavailable", "The night shift is not available here.")
        if (cmd.step === "report") {
          const run = store.latest()
          if (!run) return { report: undefined }
          return { run: { id: run.id, startedAt: run.startedAt, endedAt: run.endedAt }, report: morningReport(run, (id) => a.manager.get(id)?.info(), (id) => a.broker.list().filter((p) => p.request.sessionId === id).length) }
        }
        if (!cmd.tasks?.length || !cmd.budgetUsd) throw new CommandError("invalid", "Queue at least one task, and give the night a budget.")
        const o = order(cmd.tasks)
        if ("problem" in o) throw new CommandError("invalid", `The night cannot run: ${o.problem}.`)
        const run = newNight(cmd.tasks, cmd.budgetUsd)
        store.save(run)
        const go = () => void runNight(run, { save: (r) => store.save(r), runTask: (t) => this.#nightTask(t) })
        const wait = cmd.at ? msUntil(cmd.at) : 0
        if (wait > 0) setTimeout(go, wait).unref()
        else go()
        return { run: { id: run.id }, order: o.order, startsInMs: wait }
      }
      case "workflow": {
        // E-047: validated and dry-run before it starts; every step recorded; resumable after a restart.
        const s = this.#session(cmd.sessionId)
        const root = findProjectRoot(s.cwd)
        const r = readRoles(root)
        if ("refused" in r) throw new CommandError("refused", `The roles were refused: ${r.refused}.`)
        const all = readWorkflows(root, r.roles)
        if (cmd.step === "list") return { workflows: all.map((w) => ({ id: w.id, ...(w.workflow ? { name: w.workflow.name, steps: w.workflow.steps.length } : { problems: w.problems }) })) }
        if (cmd.step === "runs") return { runs: (a.workflowRuns?.all() ?? []).filter((x) => x.folder.toLowerCase() === root.toLowerCase()).reverse() }
        if (!a.workflowRuns) throw new CommandError("unavailable", "Workflows are not available here.")
        if (cmd.step === "approve") {
          const run = cmd.runId ? a.workflowRuns.get(cmd.runId) : undefined
          if (!run || run.status !== "waiting-approval") throw new CommandError("invalid", "That run is not waiting for your approval.")
          const w = all.find((x) => x.id === run.workflow)?.workflow
          if (!w) throw new CommandError("invalid", "Its workflow is no longer valid in this project.")
          await this.#record(s, "workflow_approved", { run: run.runId })
          void advance(w, run, a.workflowRuns, this.#stepDeps(s, root, r.roles))
          return { run: { ...run, status: "running" } }
        }
        const found = all.find((x) => x.id === cmd.id)
        if (!found) throw new CommandError("not-found", "That workflow is not in this project.")
        if (!found.workflow) throw new CommandError("invalid", `The workflow is not valid, so it was not started: ${found.problems!.join("; ")}.`)
        if (cmd.step === "dry") return { plan: dryRun(found.workflow) }
        if (!cmd.task?.trim()) throw new CommandError("invalid", "Give the workflow its task.")
        const run = newRun(found.workflow, root, cmd.task.trim())
        a.workflowRuns.put(run)
        await this.#record(s, "workflow_started", { run: run.runId, workflow: found.id, steps: found.workflow.steps.length })
        void advance(found.workflow, run, a.workflowRuns, this.#stepDeps(s, root, r.roles))
        return { run, plan: dryRun(found.workflow) }
      }
      case "team": {
        // E-046: a role's session in a worktree of its own, its scope an overlay that can only restrict.
        const s = this.#session(cmd.sessionId)
        const r = readRoles(findProjectRoot(s.cwd))
        if ("refused" in r) throw new CommandError("refused", `The roles were refused: ${r.refused}.`)
        if (cmd.step === "list") return { roles: r.roles }
        const role = r.roles.find((x) => x.name === cmd.role)
        if (!role) throw new CommandError("not-found", "That role is not in this project's roles.yml.")
        if (!cmd.task?.trim()) throw new CommandError("invalid", "Give the role its task.")
        const shape = cmd.resultSchema ? readSchema(cmd.resultSchema) : undefined
        if (typeof shape === "string") throw new CommandError("invalid", `The result schema is not usable: ${shape}`)
        const child = await a.manager.start({ cwd: s.cwd, worktree: { about: role.name }, role, mode: "default", ...(role.model ? { model: role.model } : {}), ...(role.effort ? { effort: role.effort } : {}) })
        if (shape) a.taskResults?.expect(child.id, shape.schema)
        await a.audit.record({
          session: child.id, event: "role_started", channel: "desktop", tool: "team", cwd: child.cwd, project: child.project,
          input: { role: role.name, from: s.id, ...(role.paths ? { paths: role.paths } : {}), ...(role.readOnly ? { readOnly: true } : {}) },
          verdict: { outcome: "allow", ruleId: "role-started", reason: `You started the ${role.name} role, in a worktree of its own.`, risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
          latencyMs: 0,
        })
        child.prompt(`${rolePrompt(role, cmd.task)}${shape ? resultInstruction(shape.text) : ""}`)
        return { session: child.info() }
      }
      case "gate_check": {
        // E-048: a gate checked now; what cannot be read fails closed.
        const s = this.#session(cmd.sessionId)
        const g = parseGate(cmd.gate)
        if ("error" in g) throw new CommandError("invalid", `That gate is ${g.error}.`)
        return await evaluateGate(g, this.gateSources(s))
      }
      case "playbooks": {
        // E-053: read only, apart from the checklist's commands, which run as Codehouse actions.
        const s = this.#session(cmd.sessionId)
        const root = findProjectRoot(s.cwd)
        const all = readPlaybooks(root)
        if (cmd.step === "list") return { playbooks: all }
        const p = all.find((x) => x.id === cmd.id)
        if (!p) throw new CommandError("not-found", "That playbook is not in this project.")
        if (cmd.step === "start") {
          s.prompt(playbookPrompt(p))
          return undefined
        }
        const run = a.runAction
        const items = await verifyPlaybook(root, p, {
          changed: (await changedFiles(root)) ?? new Set<string>(),
          run: async (command, cwd) => {
            if (!run) return { ran: false, exitCode: null, refused: "Codehouse actions are not available here" }
            const x = await run(s.id, command, cwd, `checking the playbook "${p.name}"`)
            return { ran: !x.refused, exitCode: x.exitCode, ...(x.refused ? { refused: x.refused } : {}) }
          },
        })
        await a.audit.record({
          session: s.id, event: "playbook_verified", channel: "desktop", tool: "playbooks", cwd: s.cwd, project: s.project,
          input: { playbook: p.id, met: items.filter((i) => i.status === "met").length, unmet: items.filter((i) => i.status === "unmet").map((i) => i.text) },
          verdict: { outcome: "allow", ruleId: "playbook", reason: `The playbook "${p.name}" was checked: ${items.filter((i) => i.status === "unmet").length} item(s) unmet.`, risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
          latencyMs: 0,
        })
        return { items }
      }
      case "handover_ask":
        this.#session(cmd.sessionId).prompt(HANDOVER_PROMPT)
        return undefined
      case "locks_list":
        return { locks: a.sessionLocks?.list() ?? [] }
      case "scheduler_status":
        return { waiting: a.scheduler?.waiting() ?? [] }
      case "session_processes": {
        // E-029: the processes under the session's root, with their ports and when each started; read only.
        const s = this.#session(cmd.sessionId)
        if (process.platform !== "win32" || s.rootPid === undefined) return { processes: [] }
        const { procs, listening } = await windowsSnapshot()
        return { processes: processesUnder(s.rootPid, procs, listening) }
      }
      case "stop_process": {
        // E-029: only with your confirmation, only a process still under this session; recorded first.
        const s = this.#session(cmd.sessionId)
        if (process.platform !== "win32" || s.rootPid === undefined) throw new CommandError("unavailable", "Codehouse cannot see this session's processes here.")
        if (!cmd.confirm) throw new CommandError("not-confirmed", "Stopping a process needs your confirmation.")
        const recorded = await a.audit.record({
          session: s.id, event: "process_stopped", channel: "desktop", tool: "processes", cwd: s.cwd, project: s.project,
          input: { pid: cmd.pid },
          verdict: { outcome: "allow", ruleId: "process-stopped", reason: `You stopped process ${cmd.pid}, which this session started, from the desktop.`, risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
          latencyMs: 0,
        })
        if (!recorded) throw new CommandError("not-recorded", "It could not be recorded, so nothing was stopped.")
        const r = await stopUnder(s.rootPid, cmd.pid, cmd.confirm, windowsSnapshot, taskkill)
        if (!r.stopped) throw new CommandError("not-stopped", r.why ?? "It was not stopped.")
        return r
      }
      case "adversary_start": {
        // D-084: the reviewer model, through the runtime or gateway on this computer, tries to break this session's change
        // in a worktree of its own, with read tools and RunTests only.
        const s = this.#session(cmd.sessionId)
        const p = a.admin?.config().providers
        const model = p?.reviewer?.model
        if (!a.adversary || !model || !reviewerRuntime(p?.local as LocalRuntimeConfig | undefined, model))
          throw new CommandError("unavailable", "Name a reviewer model on the runtime or gateway on this computer first (Settings, Other AI providers).")
        const policy = a.policy()
        if (!policy) throw new CommandError("unavailable", "No policy is loaded, so the change cannot be copied safely.")
        const diff = await sessionDiff(s.cwd, secretGlobs(policy))
        if (!diff.trim()) throw new CommandError("no-change", "This session has no change to break.")
        const b = await a.manager.start({ cwd: s.cwd, localModel: model, worktree: { about: "breaker" }, breaker: { of: s.id }, mode: "plan" })
        await applyChange(diff, b.cwd)
        a.adversary.started(s.id, b.id, model)
        await a.audit.record({
          session: s.id, event: "adversary_started", channel: "desktop", tool: "adversary", cwd: s.cwd, project: s.project,
          input: { breaker: b.id, model },
          verdict: { outcome: "allow", ruleId: "adversary-started", reason: `${model} was asked to break this session's change, in a worktree of its own.`, risk: 0, decidedBy: "human-desktop", policyHash: policy.hash },
          latencyMs: 0,
        })
        b.prompt(BREAKER_PROMPT)
        return { breaker: b.info() }
      }
      case "tour_ask": {
        // D-079: Claude writes the tour; Codehouse links and checks it.
        this.#session(cmd.sessionId).prompt(tourPrompt(cmd.topic))
        return undefined
      }
      case "schema_diff": {
        // E-012: read only; drawn in the artifact sandbox like any Mermaid diagram.
        const s = this.#session(cmd.sessionId)
        const d = await projectSchemaDiff(s.cwd, (p) => {
          try {
            return fs.readFileSync(path.join(s.cwd, p), "utf8")
          } catch {
            return undefined
          }
        })
        if (!d) throw new CommandError("no-schema", "This project keeps no schema Codehouse reads: SQL migrations, a DDL file, a Prisma schema or an EF Core model snapshot.")
        const artifact = d.tables.length && a.artifacts ? await a.artifacts.save(s.id, "Schema changes", "mermaid", d.mermaid) : undefined
        return { source: d.source, files: d.files, summary: d.summary, ...(artifact ? { artifact: { id: artifact.id, version: artifact.version.version } } : {}) }
      }
      case "migration_rehearse": {
        // E-013: a throwaway database, deleted afterwards; Postgres only in a container; recorded with its outcome.
        const s = this.#session(cmd.sessionId)
        const listed = await gitLines(s.cwd, ["-c", "core.quotePath=false", "ls-files", "--cached", "--others", "--exclude-standard"]).catch(() => undefined)
        if (!listed) throw new CommandError("not-a-repo", "The folder is not a git repository, so its migrations cannot be listed.")
        const ms = findMigrations(listed, (p) => {
          try {
            return fs.readFileSync(path.join(s.cwd, p), "utf8")
          } catch {
            return ""
          }
        })
        const container = a.container?.(s.id)
        const r = await rehearse(ms, container ? { container } : {})
        await a.audit.record({
          session: s.id, event: "migration_rehearsed", channel: "desktop", tool: "migrations", cwd: s.cwd, project: s.project,
          input: { engine: r.engine, migrations: r.steps.length, irreversible: r.irreversible.length, failures: r.failures.length },
          verdict: { outcome: "allow", ruleId: "migration-rehearsed", reason: r.notRun ?? `${r.steps.length} migration(s) rehearsed on ${r.engine}: ${r.irreversible.length} irreversible, ${r.failures.length} failed.`, risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
          latencyMs: 0,
        })
        return r
      }
      case "query_plan": {
        // E-014: EXPLAIN QUERY PLAN compiles each query without running it, in a database deleted afterwards.
        const s = this.#session(cmd.sessionId)
        const read = (p: string) => {
          try {
            return fs.readFileSync(path.join(s.cwd, p), "utf8")
          } catch {
            return ""
          }
        }
        const listed = await gitLines(s.cwd, ["-c", "core.quotePath=false", "ls-files", "--cached", "--others", "--exclude-standard"]).catch(() => undefined)
        if (!listed) throw new CommandError("not-a-repo", "The folder is not a git repository, so there is no change to read.")
        const lines = addedLines((await gitOut(s.cwd, ["diff", "HEAD", "-U0", "--no-color", "--no-ext-diff"])) ?? "")
        for (const f of (await gitOut(s.cwd, ["ls-files", "--others", "--exclude-standard"]))?.split("\n").filter(Boolean) ?? []) lines.set(f, new Set(read(f).split("\n").map((_, i) => i + 1)))
        const queries = (await Promise.all([...lines].filter(([f, l]) => l.size && languageOf(f)).slice(0, 200).map(([f, l]) => queriesIn(f, read(f), l)))).flat()
        const r = explainAll(findMigrations(listed, read), queries)
        await a.audit.record({
          session: s.id, event: "query_plans_read", channel: "desktop", tool: "query-plans", cwd: s.cwd, project: s.project,
          input: { queries: queries.length, scans: r.findings.filter((f) => f.scans.length).length },
          verdict: { outcome: "allow", ruleId: "query-plans-read", reason: r.notRun ?? `${queries.length} added quer${queries.length === 1 ? "y" : "ies"} explained.`, risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
          latencyMs: 0,
        })
        return { queries: queries.length, ...r }
      }
      case "price_sheet_import": {
        // E-019: kept only when it verifies; recorded either way.
        if (!a.priceSheets) throw new CommandError("unavailable", "Price sheets are not available here.")
        const r = a.priceSheets.import(cmd.sheet, cmd.signature)
        await a.audit.record({
          session: "host", event: "price_sheet_imported", channel: "desktop", tool: "price-sheet", cwd: "", project: "",
          input: { kept: r.state === "ok", ...(r.state === "ok" ? { items: r.items } : {}) },
          verdict: { outcome: r.state === "ok" ? "allow" : "deny", ruleId: "price-sheet", reason: r.state === "refused" ? `A price sheet was refused: ${r.why}.` : "A signed price sheet was imported.", risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
          latencyMs: 0,
        })
        if (r.state === "refused") throw new CommandError("refused", `The price sheet was not kept: ${r.why}.`)
        return r
      }
      case "profile_run": {
        // E-041: run once with Node's CPU profiler as a Codehouse action; no inspector port is ever opened.
        const s = this.#session(cmd.sessionId)
        const run = a.runAction
        if (!run) throw new CommandError("unavailable", "Codehouse actions are not available here.")
        // A .NET command goes through dotnet-trace when it is on this computer; anything else through Node's profiler.
        const dotnet = /^dotnet\s/.test(cmd.command.trim()) && !!findOnPath("dotnet-trace", process.env)
        const r = await (dotnet ? profileDotnet : profileNode)(cmd.command, s.cwd, async (command, cwd, env) => {
          const x = await run(s.id, command, cwd, "profiling it on request", env)
          return { ran: !x.refused, exitCode: x.exitCode, output: x.output, ...(x.refused ? { refused: x.refused } : {}) }
        })
        if ("notProfiled" in r) throw new CommandError("not-profiled", `It was not profiled: ${r.notProfiled}.`)
        return { ...r, summary: profileSummary(cmd.command, r) }
      }
      case "repro": {
        // E-043: the test runs as a Codehouse action; a pass before the fix is rejected; after, it is locked (D-007).
        const s = this.#session(cmd.sessionId)
        if (cmd.step === "list") return { repros: a.repros?.read(s.cwd) ?? [] }
        if (cmd.step === "ask") {
          if (!cmd.bug?.trim()) throw new CommandError("invalid", "Say what the bug is.")
          s.prompt(reproPrompt(cmd.bug))
          return undefined
        }
        const run = a.runAction
        if (!run || !a.repros) throw new CommandError("unavailable", "Reproductions are not available here.")
        if (!cmd.file) throw new CommandError("invalid", "Name the test file.")
        const exec = async (command: string, cwd: string) => {
          const x = await run(s.id, command, cwd, "checking a reproduction test")
          return { ran: !x.refused, exitCode: x.exitCode, output: x.output, ...(x.refused ? { refused: x.refused } : {}) }
        }
        if (cmd.step === "before") {
          if (!cmd.command?.trim()) throw new CommandError("invalid", "Give the command that runs the test.")
          return await confirmFails(s.cwd, cmd.file, cmd.command.trim(), cmd.bug ?? "", exec, a.repros)
        }
        const locks = a.locks
        if (!locks) throw new CommandError("unavailable", "Locked tests are not available here.")
        return await confirmPasses(s.cwd, cmd.file, exec, a.repros, async (file) => {
          await locks.lock(s.cwd, file)
          await a.audit.record({
            session: s.id, event: "test_locked", channel: "desktop", tool: "locks", cwd: s.cwd, project: s.project,
            input: { paths: [file], why: "a verified reproduction" },
            verdict: { outcome: "allow", ruleId: "test-locked", reason: `${file} reproduced a bug before its fix and passed after it, so it was locked.`, risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
            latencyMs: 0,
          })
        })
      }
      case "bisect": {
        // E-044: a scratch worktree; git bisect and the check as Codehouse actions; links removed first on the way out.
        const s = this.#session(cmd.sessionId)
        const run = a.runAction
        if (!run) throw new CommandError("unavailable", "Codehouse actions are not available here.")
        const r = await bisect(findProjectRoot(s.cwd), cmd.good, cmd.bad, cmd.check, async (command, cwd) => {
          const x = await run(s.id, command, cwd, "finding the first bad commit")
          return { ran: !x.refused, exitCode: x.exitCode, output: x.output, ...(x.refused ? { refused: x.refused } : {}) }
        })
        await a.audit.record({
          session: s.id, event: "bisect_run", channel: "desktop", tool: "bisect", cwd: s.cwd, project: s.project,
          input: { good: cmd.good, bad: cmd.bad, ...(r.first ? { first: r.first.sha } : {}), steps: r.steps },
          verdict: { outcome: "allow", ruleId: "bisect", reason: r.first ? `The first bad commit is ${r.first.sha.slice(0, 10)}.` : `No first bad commit: ${r.notFound}`, risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
          latencyMs: 0,
        })
        return r
      }
      case "leak_check": {
        // E-042: a preload writes heap snapshots; no inspector port is opened; the folder is deleted afterwards.
        const s = this.#session(cmd.sessionId)
        const run = a.runAction
        if (!run) throw new CommandError("unavailable", "Codehouse actions are not available here.")
        const r = await findLeaks(cmd.command, s.cwd, async (command, cwd, env) => {
          const x = await run(s.id, command, cwd, "looking for memory that keeps growing", env)
          return { ran: !x.refused, exitCode: x.exitCode, output: x.output, ...(x.refused ? { refused: x.refused } : {}) }
        })
        if ("notChecked" in r) throw new CommandError("not-checked", `It was not checked: ${r.notChecked}.`)
        return { ...r, summary: leakSummary(cmd.command, r) }
      }
      case "crash_summary": {
        // E-045: read only, or one Codehouse action with Node's report flags (files only, nothing listens).
        const s = this.#session(cmd.sessionId)
        const run = a.runAction
        if (cmd.dump) {
          const dump = path.resolve(s.cwd, cmd.dump)
          const rel = path.relative(s.cwd, dump)
          if (rel.startsWith("..") || path.isAbsolute(rel)) throw new CommandError("outside", "The dump must be a file in the project.")
          if (!run || !findOnPath("dotnet-dump", process.env)) throw new CommandError("unavailable", "dotnet-dump is not on this computer.")
          const x = await run(s.id, dotnetDumpCommand(dump), s.cwd, "reading a .NET crash dump")
          if (x.refused) throw new CommandError("not-run", `dotnet-dump was not run: ${x.refused}.`)
          return { crashes: readDotnetCrashes(s.cwd, x.output, "dump"), output: x.output.slice(-20_000) }
        }
        if (cmd.command) {
          if (!run) throw new CommandError("unavailable", "Codehouse actions are not available here.")
          const r = await runWithCrashReports(s.cwd, cmd.command, async (command, cwd, env) => {
            const x = await run(s.id, command, cwd, "running it once with crash reports on", env)
            return { ran: !x.refused, exitCode: x.exitCode, output: x.output, ...(x.refused ? { refused: x.refused } : {}) }
          })
          if ("notRun" in r) throw new CommandError("not-run", `It was not run: ${r.notRun}.`)
          return { exitCode: r.exitCode, crashes: r.crashes.map((c) => ({ ...c, text: crashText(c) })) }
        }
        const logText = a.logs ? a.logs.query(s.cwd, { limit: 5000 }).reverse().map((e) => e.message).join("\n") : ""
        return { crashes: summariseCrashes(s.cwd, logText).map((c) => ({ ...c, text: crashText(c) })) }
      }
      case "traces_list": {
        const s = this.#session(cmd.sessionId)
        if (!a.traces) throw new CommandError("unavailable", "The trace receiver is not available here.")
        return { on: a.traces.on(), port: a.traces.port(), traces: a.traces.store.traces(s.cwd) }
      }
      case "trace_tree": {
        const s = this.#session(cmd.sessionId)
        if (!a.traces) throw new CommandError("unavailable", "The trace receiver is not available here.")
        return { tree: a.traces.store.tree(s.cwd, cmd.traceId) }
      }
      case "trace_token": {
        // E-040: a new token for this project, shown once; the old one stops working. Recorded, never the token.
        const s = this.#session(cmd.sessionId)
        if (!a.traces) throw new CommandError("unavailable", "The trace receiver is not available here.")
        const token = a.traces.tokens.issue(s.cwd)
        await a.audit.record({
          session: s.id, event: "trace_token_issued", channel: "desktop", tool: "traces", cwd: s.cwd, project: s.project, input: {},
          verdict: { outcome: "allow", ruleId: "trace-token", reason: "A new trace token was made for this project; the old one no longer works.", risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
          latencyMs: 0,
        })
        const port = a.traces.port()
        return { token, env: [`OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:${port}`, "OTEL_EXPORTER_OTLP_PROTOCOL=http/json", `OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer%20${token}`] }
      }
      case "log_errors": {
        // E-039: read only; frames are mapped through source maps inside the project only.
        const s = this.#session(cmd.sessionId)
        if (!a.logs) throw new CommandError("unavailable", "The log viewer is not available here.")
        const signatures = triage(s.cwd, a.logs.query(s.cwd, { limit: 5000 }).reverse()).slice(0, 50)
        return { signatures: signatures.map((g) => ({ ...g, task: fixTask(g) })) }
      }
      case "logs_query": {
        // E-038: the listed files are read first (each judged by the rules), then the store is searched; redacted.
        const s = this.#session(cmd.sessionId)
        if (!a.logs) throw new CommandError("unavailable", "The log viewer is not available here.")
        const allow = a.rulesAllowRead
        const tailed = await a.logs.tail(s.cwd, s.cwd, (abs) => (allow ? allow(s.id, s.cwd, abs) : Promise.resolve(false)))
        const entries = a.logs.query(s.cwd, { ...(cmd.text ? { text: cmd.text } : {}), ...(cmd.level ? { level: cmd.level } : {}), ...(cmd.since ? { since: cmd.since } : {}), limit: cmd.limit ?? 500 })
        return { entries, read: tailed.read, refused: tailed.refused }
      }
      case "client_drift": {
        // E-036: the tool runs as a Codehouse action in a scratch folder inside .codehouse, deleted afterwards.
        const s = this.#session(cmd.sessionId)
        const run = a.runAction
        if (!run) throw new CommandError("unavailable", "Codehouse actions are not available here.")
        const listed = await gitLines(s.cwd, ["-c", "core.quotePath=false", "ls-files", "--cached", "--others", "--exclude-standard"]).catch(() => undefined)
        if (!listed) throw new CommandError("not-a-repo", "The folder is not a git repository, so its files cannot be listed.")
        const gens = findGenerators(listed, (p) => {
          try {
            return fs.readFileSync(path.join(s.cwd, p), "utf8")
          } catch {
            return undefined
          }
        }).slice(0, 10)
        const results = []
        for (const g of gens)
          results.push(
            await checkDrift(s.cwd, g, async (command, cwd) => {
              const r = await run(s.id, command, cwd, `generating the ${g.tool} client again to compare it with the committed one`)
              return { ran: !r.refused, exitCode: r.exitCode, output: r.output, ...(r.refused ? { refused: r.refused } : {}) }
            }),
          )
        await a.audit.record({
          session: s.id, event: "client_drift_checked", channel: "desktop", tool: "client-drift", cwd: s.cwd, project: s.project,
          input: { clients: results.length, drifted: results.filter((r) => hasDrift(r.drift)).length },
          verdict: { outcome: "allow", ruleId: "client-drift", reason: `${results.length} generated client(s) compared with a fresh generation.`, risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
          latencyMs: 0,
        })
        return { results }
      }
      case "api_lint": {
        // E-035: read only.
        const s = this.#session(cmd.sessionId)
        const file = path.resolve(s.cwd, cmd.spec)
        const rel = path.relative(s.cwd, file)
        if (rel.startsWith("..") || path.isAbsolute(rel)) throw new CommandError("outside", "The spec must be a file in the project.")
        let text: string
        try {
          text = fs.readFileSync(file, "utf8")
        } catch {
          throw new CommandError("no-spec", "The spec could not be read.")
        }
        const spec = readSpec(text)
        if (!spec) throw new CommandError("not-openapi", "That file is not an OpenAPI 3 spec.")
        // E-037: error answers against RFC 9457 or the project's convention, beside the security gaps.
        return { findings: [...lintApi(spec), ...checkSpecErrors(spec).map((e) => ({ rule: "error-contract", where: e.where, message: e.message }))] }
      }
      case "mock_defs": {
        // E-032: read only; the mocks are shown to copy, never written, and Codehouse hosts no mock server.
        const s = this.#session(cmd.sessionId)
        const file = path.resolve(s.cwd, cmd.spec)
        const rel = path.relative(s.cwd, file)
        if (rel.startsWith("..") || path.isAbsolute(rel)) throw new CommandError("outside", "The spec must be a file in the project.")
        let text: string
        try {
          text = fs.readFileSync(file, "utf8")
        } catch {
          throw new CommandError("no-spec", "The spec could not be read.")
        }
        const mocks = mocksFrom(text, rel.replace(/\\/g, "/"))
        if (!mocks) throw new CommandError("not-openapi", "That file is not an OpenAPI 3 spec.")
        return mocks
      }
      case "contract_probe": {
        // E-031: loopback only; each request judged as the same curl command would be; recorded with its outcome.
        const s = this.#session(cmd.sessionId)
        const file = path.resolve(s.cwd, cmd.spec)
        if (path.relative(s.cwd, file).startsWith("..") || path.isAbsolute(path.relative(s.cwd, file))) throw new CommandError("outside", "The spec must be a file in the project.")
        let text: string
        try {
          text = fs.readFileSync(file, "utf8")
        } catch {
          throw new CommandError("no-spec", "The spec could not be read.")
        }
        const spec = readSpec(text)
        if (!spec) throw new CommandError("not-openapi", "That file is not an OpenAPI 3 spec.")
        const allow = a.rulesAllow
        const report = await probe(spec, cmd.base, { allowed: (command) => (allow ? allow(s.id, s.cwd, command) : Promise.resolve(false)) })
        if (!report.refused) s.contractProbed({ base: report.base, operations: report.operations.length, mismatches: report.mismatches })
        // E-034: how each answer's shape changed since the last probe of this project.
        const changes = !report.refused && a.contractSnapshots ? a.contractSnapshots.record(s.cwd, report.operations) : []
        await a.audit.record({
          session: s.id, event: "contract_probed", channel: "desktop", tool: "contract-probe", cwd: s.cwd, project: s.project,
          input: { spec: cmd.spec, base: report.base, operations: report.operations.length, mismatches: report.mismatches.length, ...(report.refused ? { refused: true } : {}) },
          verdict: { outcome: report.refused ? "deny" : "allow", ruleId: "contract-probe", reason: report.refused ?? `${report.operations.length} operation(s) probed on ${report.base}: ${report.mismatches.length} mismatch(es).`, risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
          latencyMs: 0,
        })
        return { ...report, operations: report.operations.map(({ shape: _s, ...o }) => o), changes }
      }
      case "iac_check": {
        // E-022: read only, in process; nothing is run.
        const s = this.#session(cmd.sessionId)
        const listed = await gitLines(s.cwd, ["-c", "core.quotePath=false", "ls-files", "--cached", "--others", "--exclude-standard"]).catch(() => undefined)
        if (!listed) throw new CommandError("not-a-repo", "The folder is not a git repository, so its files cannot be listed.")
        const files = listed
          .filter((p) => /\.(tf|bicep|json|ya?ml|template)$/i.test(p) && !/(^|\/)(node_modules|\.terraform)\//.test(p))
          .slice(0, 2000)
          .flatMap((p) => {
            try {
              const st = fs.statSync(path.join(s.cwd, p))
              if (st.size > 2 * 1024 * 1024) return []
              const text = fs.readFileSync(path.join(s.cwd, p), "utf8")
              return iacFormat(p, text) ? [{ file: p, text }] : []
            } catch {
              return []
            }
          })
        const findings = lintIac(files)
        await a.audit.record({
          session: s.id, event: "iac_checked", channel: "desktop", tool: "iac-check", cwd: s.cwd, project: s.project,
          input: { files: files.length, findings: findings.length, rules: [...new Set(findings.map((f) => f.rule))] },
          verdict: { outcome: "allow", ruleId: "iac-checked", reason: `${files.length} infrastructure file(s) checked: ${findings.length} finding(s).`, risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
          latencyMs: 0,
        })
        return { files: files.length, findings, parsers: IAC_PARSERS }
      }
      case "test_data": {
        // E-015: the scan reads only; generated rows are checked in a throwaway database and shown, never written.
        const s = this.#session(cmd.sessionId)
        const read = (p: string) => {
          try {
            return fs.readFileSync(path.join(s.cwd, p), "utf8")
          } catch {
            return ""
          }
        }
        const listed = await gitLines(s.cwd, ["-c", "core.quotePath=false", "ls-files", "--cached", "--others", "--exclude-standard"]).catch(() => undefined)
        if (!listed) throw new CommandError("not-a-repo", "The folder is not a git repository, so its files cannot be listed.")
        const findings = scanFixtures(listed, read)
        const generated = cmd.generate ? generateFixtures(findMigrations(listed, read), { rows: cmd.rows ?? 10, seed: s.project }) : undefined
        await a.audit.record({
          session: s.id, event: "test_data_checked", channel: "desktop", tool: "test-data", cwd: s.cwd, project: s.project,
          input: { findings: findings.length, kinds: [...new Set(findings.map((f) => f.kind))], ...(generated ? { generated: Object.values(generated.rows).reduce((x, y) => x + y, 0) } : {}) },
          verdict: { outcome: "allow", ruleId: "test-data-checked", reason: `${findings.length} real-looking value(s) found in the fixtures${generated ? ", and seed rows made" : ""}.`, risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
          latencyMs: 0,
        })
        return { findings, ...(generated ? { generated } : {}) }
      }
      case "egress_report": {
        // D-094: the endpoints sampled for this session, signed so the report can be checked later.
        const s = this.#session(cmd.sessionId)
        if (!a.egress || !a.knowledgeKey) throw new CommandError("unavailable", "Egress reports are not available here.")
        const report = a.egress.report(s.id) ?? { v: 1 as const, session: s.id, from: new Date().toISOString(), to: new Date().toISOString(), endpoints: [], flagged: 0 }
        const key = a.knowledgeKey
        return { report, signed: await signReport(report, (b) => key.signBytes(b)) }
      }
      case "knowledge_export": {
        // D-080: signed with this computer's key; the public key is shown so the receiver can trust it.
        const s = this.#session(cmd.sessionId)
        if (!a.knowledgeKey) throw new CommandError("unavailable", "Knowledge packs are not available here.")
        const pack = makePack(s.cwd, s.project)
        if (!pack.files.length) throw new CommandError("nothing", "This project has no ADRs, glossary settings or CLAUDE.md to pack.")
        const signed = await a.knowledgeKey.sign(pack)
        await a.audit.record({
          session: s.id, event: "knowledge_exported", channel: "desktop", tool: "knowledge", cwd: s.cwd, project: s.project,
          input: { files: pack.files.map((f) => f.path) },
          verdict: { outcome: "allow", ruleId: "knowledge-exported", reason: `The project's knowledge was exported as a signed pack of ${pack.files.length} file(s).`, risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
          latencyMs: 0,
        })
        return { signed, files: pack.files.map((f) => f.path) }
      }
      case "knowledge_import": {
        // D-080: only a pack signed by a key you trust, unchanged, carrying only knowledge files; refused otherwise.
        const s = this.#session(cmd.sessionId)
        const opened = openPack(cmd.pack, a.admin?.config().rulePackKeys ?? [])
        if (!opened.ok) {
          await a.audit.record({
            session: s.id, event: "knowledge_refused", channel: "desktop", tool: "knowledge", cwd: s.cwd, project: s.project,
            input: { why: opened.why },
            verdict: { outcome: "deny", ruleId: "knowledge-refused", reason: `A knowledge pack was refused: ${opened.why}`, risk: 0, decidedBy: "rules", policyHash: "n/a" },
            latencyMs: 0,
          })
          throw new CommandError("refused", opened.why)
        }
        const recorded = await a.audit.record({
          session: s.id, event: "knowledge_imported", channel: "desktop", tool: "knowledge", cwd: s.cwd, project: s.project,
          input: { from: opened.pack.project, files: opened.pack.files.map((f) => f.path) },
          verdict: { outcome: "allow", ruleId: "knowledge-imported", reason: `A signed knowledge pack from ${opened.pack.project} was imported from the desktop.`, risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
          latencyMs: 0,
        })
        if (!recorded) throw new CommandError("not-recorded", "It could not be recorded, so nothing was written.")
        const done = await importPack(s.cwd, opened.pack)
        // What the project tells agents changed by your hand, so D-059 takes it as the new pinned version.
        const told = done.written.filter((p) => p === "CLAUDE.md" || p === "AGENTS.md")
        if (told.length) await a.instructions?.repin(s.cwd, told).catch(() => undefined)
        return done
      }
      case "upgrade_pack": {
        // D-071: the lockfiles' change, the evidence pack's test runs, the SBOM delta and the admission checks; nothing runs.
        const s = this.#session(cmd.sessionId)
        const c = await a.checkpoints.changes(s.cwd, s.id, cmd.ref)
        if (!c.since || !("files" in c)) throw new CommandError("no-checkpoint", "This session has no checkpoint yet, so there is no change to gather.")
        const all: DependencyChange[] = []
        const direct: AddedDependency[] = []
        for (const x of c.files.filter((x) => isLockfile(x.path) || /(^|\/)(package\.json|requirements\.txt|pyproject\.toml|Cargo\.toml|go\.mod|[^/]+\.csproj)$/i.test(x.path)).slice(0, 30)) {
          const v = await a.checkpoints.versions(s.cwd, c.since.ref, x.path)
          if (isLockfile(x.path)) all.push(...lockfileChanges(x.path, v.before, v.after))
          else direct.push(...fromManifestEdit(x.path, v.before ?? "", v.after ?? ""))
        }
        if (!all.length && !direct.length) throw new CommandError("no-upgrade", "This change does not touch the project's dependencies.")
        const admission: AdmissionCheck[] = []
        // New names in a manifest, as D-053 judges them; licences of new and upgraded direct dependencies, as D-055 does.
        // With nothing counted as known, admit judges every name, one finding each, in order.
        admit(direct, new Set(), new Set()).forEach((f, i) => admission.push({ dependency: `${direct[i]!.ecosystem}:${direct[i]!.name}`, check: "new name", outcome: f.outcome, reason: f.reason }))
        const upgradedDirect = all.filter((x) => x.kind === "changed").map((x) => ({ ecosystem: x.package.ecosystem as AddedDependency["ecosystem"], name: x.package.name, via: x.lockfile }))
        const allowed = a.policy()?.managedLicences ?? a.admin?.config().allowedLicences ?? DEFAULT_LICENCES
        for (const f of licenceFindings([...direct, ...upgradedDirect].slice(0, 200), [s.cwd], allowed)) admission.push({ dependency: f.dependency, check: "licence", outcome: "escalate", reason: f.reason })
        for (const m of a.vulnSnapshot?.matches(all) ?? []) admission.push({ dependency: `${m.ecosystem}:${m.name}`, check: "vulnerability", outcome: "escalate", reason: `${m.name} ${m.version} is in the vulnerability snapshot (${m.ids.join(", ")}).` })
        const evidence = a.evidence ? await a.evidence.build({ id: s.id, cwd: s.cwd, project: s.project, assumptions: s.openAssumptions(), ...adversaryOf(a, s.id), ...(s.contract() ? { contract: s.contract()! } : {}) }, cmd.ref ? { ref: cmd.ref } : {}).catch(() => undefined) : undefined
        const pack = upgradePack({
          changes: all,
          evidence: evidence?.pack,
          sbom: sbomDiff(all, { project: s.project, version: a.updates?.status().current ?? "unknown", describe: `changes since ${c.since.label} (${c.since.ref})` }),
          admission,
        })
        await a.audit.record({
          session: s.id, event: "upgrade_pack", channel: "desktop", tool: "dependencies", cwd: s.cwd, project: s.project,
          input: { upgrades: pack.upgrades.length, added: pack.added.length, removed: pack.removed.length, testsPassed: pack.testsPassed, admission: pack.admission.length, complete: pack.complete, ...(evidence ? { evidence: evidence.sha.slice(0, 12) } : {}) },
          verdict: { outcome: "allow", ruleId: "upgrade-pack", reason: pack.complete ? "The upgrade's evidence is complete." : `The upgrade's evidence is not complete: ${pack.missing.join("; ")}.`, risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
          latencyMs: 0,
        })
        return pack
      }
      case "pwsh_modernise": {
        // D-070: the project's scripts read with the AST worker (and PSScriptAnalyzer where installed); nothing runs.
        const s = this.#session(cmd.sessionId)
        const worker = a.pwsh
        if (!worker) throw new CommandError("unavailable", "The PowerShell parser is not available here.")
        const analyzer: AnalyzerRun | undefined = a.dataDir
          ? async (file) => {
              const script = path.join(a.dataDir!, "pwsh", "analyzer.ps1")
              if (!fs.existsSync(script) || fs.readFileSync(script, "utf8") !== ANALYZER_SCRIPT) {
                fs.mkdirSync(path.dirname(script), { recursive: true })
                await writeFileAtomic(script, ANALYZER_SCRIPT)
              }
              const out = await new Promise<string>((resolve) =>
                execFileCb(powerShellExe(), inlineScriptArgs(script, [`'${file.replace(/'/g, "''")}'`]), { timeout: 60_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (_e, stdout) => resolve(String(stdout ?? ""))),
              )
              const t = out.trim()
              if (!t || t === "NOPSSA") return undefined
              const v = JSON.parse(t) as unknown
              return (Array.isArray(v) ? v : [v]) as Array<{ RuleName: string; Line: number; Message: string }>
            }
          : undefined
        const reports = await modernise({ root: s.cwd, parse: (t) => worker.parse(t), ...(analyzer ? { analyzer } : {}) })
        await a.audit.record({
          session: s.id, event: "pwsh_modernise", channel: "desktop", tool: "pwsh", cwd: s.cwd, project: s.project,
          input: { scripts: reports.length, findings: reports.reduce((n, r) => n + r.findings.length, 0), analyzer: reports.some((r) => r.analyzer) },
          verdict: { outcome: "allow", ruleId: "pwsh-modernise", reason: "The project's PowerShell scripts were checked for PowerShell 7.", risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
          latencyMs: 0,
        })
        return { reports }
      }
      case "migration_plan": {
        // D-067: waves from the folder's own imports, leaves first; each file's callable exports found as D-066 finds them.
        const s = this.#session(cmd.sessionId)
        if (!a.dataDir) throw new CommandError("unavailable", "Migration plans are not available here.")
        const folder = path.posix.normalize(cmd.folder.replace(/\\/g, "/") || ".")
        if (folder.startsWith("..") || path.isAbsolute(folder)) throw new CommandError("bad-folder", "Give a folder inside the project.")
        const files = sourcesIn(s.cwd, folder)
        if (!files.length) throw new CommandError("no-files", "That folder has no JavaScript or TypeScript source files.")
        const plan = await planMigration({ root: s.cwd, goal: cmd.goal, files, callable: async (f, t) => (await exportedFunctions(f, t).catch(() => [])).length > 0 })
        await new MigrationStore(path.join(a.dataDir, "migrations")).save(plan)
        await a.audit.record({
          session: s.id, event: "migration_planned", channel: "desktop", tool: "migration", cwd: s.cwd, project: s.project,
          input: { planId: plan.id, waves: plan.waves.length, files: files.length },
          verdict: { outcome: "allow", ruleId: "migration-planned", reason: `A migration was planned in ${plan.waves.length} waves.`, risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
          latencyMs: 0,
        })
        return { plan, states: plan.waves.map(waveState) }
      }
      case "migration_wave": {
        // D-067: a wave's evidence: its callable files captured before it changes, then compared after; or Claude asked to do it.
        const s = this.#session(cmd.sessionId)
        if (!a.dataDir) throw new CommandError("unavailable", "Migration plans are not available here.")
        const store = new MigrationStore(path.join(a.dataDir, "migrations"))
        let plan: MigrationPlan
        try {
          plan = store.get(cmd.planId)
        } catch {
          throw new CommandError("no-plan", "There is no such migration plan.")
        }
        const w = plan.waves.find((x) => x.n === cmd.wave)
        if (!w) throw new CommandError("no-wave", `There is no wave ${cmd.wave}.`)
        if (cmd.step === "ask") {
          s.prompt(wavePrompt(plan, cmd.wave))
          return { plan, states: plan.waves.map(waveState) }
        }
        if (!a.mutationExec) throw new CommandError("unavailable", "Captures are not available here.")
        const redact = (x: string) => redactString(x, { terms: a.admin?.config().redactTerms ?? [] })
        const stamp = Date.now().toString(36)
        const failed: Array<{ file: string; why: string }> = []
        for (const f of w.files.filter((x) => x.callable && (cmd.step === "capture" || x.captured))) {
          const text = fs.readFileSync(path.join(s.cwd, f.file), "utf8")
          try {
            if (cmd.step === "capture") {
              const cap = await capture({ root: s.cwd, file: f.file, before: text, from: `before wave ${w.n}`, exec: a.mutationExec(s.id), sandbox: (n) => path.join(os.tmpdir(), `codeh-migrate-${s.id}-${stamp}-${n}`), redact })
              await store.captured(plan, f.file, cap)
            } else {
              const deltas = await behaviourDiff({ root: s.cwd, capture: store.capture(plan, f.file), now: text, exec: a.mutationExec(s.id), sandbox: path.join(os.tmpdir(), `codeh-migrate-${s.id}-${stamp}-c`), redact })
              await store.compared(plan, f.file, deltas)
            }
          } catch (e) {
            failed.push({ file: f.file, why: (e as Error).message.slice(0, 300) })
          }
        }
        const state = waveState(w)
        await a.audit.record({
          session: s.id, event: cmd.step === "capture" ? "migration_captured" : "migration_compared", channel: "desktop", tool: "migration", cwd: s.cwd, project: s.project,
          input: { planId: plan.id, wave: w.n, done: state.done, changed: state.changed, failed: failed.length },
          verdict: { outcome: "allow", ruleId: cmd.step === "capture" ? "migration-captured" : "migration-compared", reason: `Wave ${w.n}'s behaviour was ${cmd.step === "capture" ? "captured before it changes" : "compared after it changed"}.`, risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
          latencyMs: 0,
        })
        return { plan, states: plan.waves.map(waveState), failed }
      }
      case "fuzz_run": {
        // D-012: the changed files' parsing functions, fuzzed within a time box and a heap cap, as Codehouse actions.
        const s = this.#session(cmd.sessionId)
        if (!a.fuzzExec || !a.dataDir) throw new CommandError("unavailable", "Fuzz passes are not available here.")
        const c = await a.checkpoints.changes(s.cwd, s.id, cmd.ref)
        if (!c.since || !("files" in c)) throw new CommandError("no-checkpoint", "This session has no checkpoint yet, so there is no change to fuzz.")
        const changes: Array<{ path: string; text: string }> = []
        for (const x of c.files.filter((x) => x.change !== "deleted" && !x.binary && /\.[cm]?[jt]s$/i.test(x.path)).slice(0, 30)) {
          const v = await a.checkpoints.versions(s.cwd, c.since.ref, x.path).catch(() => undefined)
          if (v?.after !== undefined) changes.push({ path: x.path, text: v.after })
        }
        const targets = fuzzTargets(changes)
        if (!targets.length) return { targets: [], findings: [], calls: 0, ms: 0 }
        const scratch = path.join(os.tmpdir(), `codeh-fuzz-${s.id}-${Date.now().toString(36)}`)
        const report = await runFuzz({ root: s.cwd, targets, exec: a.fuzzExec(s.id), runner: await ensureRunner(a.dataDir), scratch, seed: cmd.seed ?? 1 }).finally(() =>
          fs.rmSync(scratch, { recursive: true, force: true }),
        )
        s.noteTestOutput(pinLines(report))
        await a.audit.record({
          session: s.id,
          event: "fuzz_run",
          channel: "host",
          tool: "fuzz",
          cwd: s.cwd,
          project: s.project,
          // Counts and where each finding was written; never the inputs themselves.
          input: { targets: report.targets.length, calls: report.calls, findings: report.findings.map((f) => ({ fn: f.fn, kind: f.kind, written: f.written })), ...(report.refused ? { refused: report.refused } : {}) },
          verdict: { outcome: "allow", ruleId: "fuzz-run", reason: report.refused ? `A fuzz pass did not run: ${report.refused}.` : `The changed parsing functions were fuzzed: ${report.findings.length} finding(s).`, risk: 0, decidedBy: "rules", policyHash: "n/a" },
          latencyMs: report.ms,
        })
        return report
      }
      case "evidence_build": {
        const s = this.#session(cmd.sessionId)
        if (!a.evidence) throw new CommandError("unavailable", "Evidence packs are not available here.")
        const got = await a.evidence.build({ id: s.id, cwd: s.cwd, project: s.project, assumptions: s.openAssumptions(), ...adversaryOf(a, s.id), ...(s.contract() ? { contract: s.contract()! } : {}) }, cmd.ref ? { ref: cmd.ref } : {})
        if (!got) throw new CommandError("no-checkpoint", "This session has no checkpoint yet, so there is no change to gather.")
        return got
      }
      case "change_findings": {
        // D-062: the lines each changed file adds, parsed as they are now; nothing runs.
        const s = this.#session(cmd.sessionId)
        const c = await a.checkpoints.changes(s.cwd, s.id, cmd.ref)
        if (!c.since || !("files" in c)) return { findings: [] }
        const findings: SastFinding[] = []
        for (const x of c.files.filter((x) => x.change !== "deleted" && !x.binary).slice(0, 60)) {
          const lines = [...addedLines(x.diff).values()][0]
          if (!lines?.size) continue
          const v = await a.checkpoints.versions(s.cwd, c.since.ref, x.path).catch(() => undefined)
          if (v?.after !== undefined) findings.push(...(await scanSource(x.path, v.after, lines)))
        }
        // D-066: the changed source files nothing in the project's tests names, to offer a capture for.
        const tests = await listFiles(s.cwd).then((l) => l.filter((p) => TEST_FILE.test(p))).catch(() => [] as string[])
        const untested = c.files
          .filter((x) => x.change === "modified" && /\.[cm]?[jt]sx?$/i.test(x.path) && !TEST_FILE.test(x.path))
          .map((x) => x.path)
          .filter((p) => looksUntested(s.cwd, p, tests))
        return { findings, untested }
      }
      case "requirement_impact": {
        const s = this.#session(cmd.sessionId)
        const c = await a.checkpoints.changes(s.cwd, s.id, cmd.ref)
        const changed = c.since && "files" in c ? c.files.map((x) => x.path.replace(/\\/g, "/")) : []
        const { requirements } = readRequirements(s.cwd)
        const touched = requirements.filter((r) => changed.includes(r.file))
        if (!touched.length) return { impacts: [] }
        const testFiles = await listFiles(s.cwd).then((l) => l.filter((p) => TEST_FILE.test(p))).catch(() => [] as string[])
        const commits = new Map<string, string[]>()
        for (const r of touched) commits.set(r.id, await gitLines(s.cwd, ["log", "--all", "--format=%H", "-F", `--grep=${r.id}`]).catch(() => []))
        const rows = traceMatrix({ root: s.cwd, requirements: touched, commitsFor: (id) => commits.get(id) ?? [], testFiles, evidenceFor: () => [] })
        const filesOf = new Map<string, string[]>()
        for (const ids of commits.values())
          for (const h of ids.slice(0, 30))
            if (!filesOf.has(h)) filesOf.set(h, await gitLines(s.cwd, ["show", "--name-only", "--format=", h]).catch(() => []))
        return {
          impacts: touched.map((r, i) => impactOf({ root: s.cwd, requirement: r, row: rows[i]!, filesOf: (h) => filesOf.get(h) ?? [] })),
        }
      }
      case "adr_drafts": {
        const s = this.#session(cmd.sessionId)
        const auditDir = a.admin?.auditDir
        const decisions = auditDir ? decisionsIn(sessionRecords(auditDir, s.id)) : []
        const first = nextNumber(s.cwd)
        const date = new Date().toISOString().slice(0, 10)
        return { drafts: decisions.map((d, i) => ({ seq: d.seq, kind: d.kind, title: d.title, ...draftAdr(d, { number: first + i, session: s.id, date }) })) }
      }
      case "adr_write": {
        // D-038: written by the Host only after you accept it, and recorded.
        const s = this.#session(cmd.sessionId)
        let rel: string
        try {
          rel = await writeAdr(s.cwd, cmd.file, cmd.text)
        } catch (e) {
          throw new CommandError("not-written", (e as Error).message)
        }
        await a.audit.record({
          session: s.id,
          event: "adr_written",
          channel: "desktop",
          tool: "adr",
          cwd: s.cwd,
          project: s.project,
          input: { file: rel, chars: cmd.text.length },
          verdict: { outcome: "allow", ruleId: "adr", reason: "You accepted an architecture decision record, and Codehouse wrote it into the project.", risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
          latencyMs: 0,
        })
        return { file: rel }
      }
      case "threat_delta": {
        const s = this.#session(cmd.sessionId)
        const c = await a.checkpoints.changes(s.cwd, s.id, cmd.ref)
        if (!c.since || !("files" in c)) return { drafts: [] }
        const added = c.files
          .filter((x) => x.change !== "deleted" && !x.binary)
          .map((x) => {
            const lines: Array<{ line: number; text: string }> = []
            let at: number | undefined
            for (const l of x.diff.split(/\r?\n/)) {
              const h = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(l)
              if (h) at = Number(h[1])
              else if (at !== undefined && l.startsWith("+") && !l.startsWith("+++")) lines.push({ line: at++, text: l.slice(1) })
              else if (at !== undefined && !l.startsWith("-")) at++
            }
            return { file: x.path, lines }
          })
        const dependencies: DependencyChange[] = []
        for (const x of c.files.filter((x) => isLockfile(x.path)).slice(0, 20)) {
          const v = await a.checkpoints.versions(s.cwd, c.since.ref, x.path).catch(() => undefined)
          if (v) dependencies.push(...lockfileChanges(x.path, v.before, v.after))
        }
        const drafts = threatDelta({ added, dependencies })
        return { drafts: drafts.map((d) => ({ ...d, markdown: draftMarkdown(d) })) }
      }
      case "architecture": {
        const s = this.#session(cmd.sessionId)
        const files = await listFiles(s.cwd).catch(() => [] as string[])
        const graph = modulesOf(await updateGraph(s.cwd, files))
        const approved = readApproved(s.cwd)
        const drift = driftOf(graph, approved)
        return {
          ...(readArchRules(s.cwd).problem ? { problem: readArchRules(s.cwd).problem } : {}),
          modules: Object.keys(graph.modules).length,
          approved: approved !== undefined,
          drift,
          cycles: cyclesOf(graph),
          diagrams: c4Diagrams(s.project, graph, drift),
          // D-045: and the project's fitness checks.
          ...(await fitnessCheck(s.cwd, files).then((x) => (x ? { fitness: x } : {})).catch(() => ({}))),
        }
      }
      case "arc42": {
        const s = this.#session(cmd.sessionId)
        const files = await listFiles(s.cwd).catch(() => [] as string[])
        const graph = modulesOf(await updateGraph(s.cwd, files))
        const drift = driftOf(graph, readApproved(s.cwd))
        return arc42({
          project: s.project,
          date: new Date().toISOString().slice(0, 10),
          requirements: readRequirements(s.cwd).requirements,
          ...(readArchRules(s.cwd).rules ? { rules: readArchRules(s.cwd).rules! } : {}),
          ...(Object.keys(graph.modules).length ? { diagrams: c4Diagrams(s.project, graph, drift) } : {}),
          adrs: readAdrs(s.cwd),
          ...(await fitnessCheck(s.cwd, files).then((x) => (x ? { fitness: x } : {})).catch(() => ({}))),
          drift,
          deployment: deploymentFiles(s.cwd),
          threats: [],
        })
      }
      case "architecture_approve": {
        const s = this.#session(cmd.sessionId)
        const graph = modulesOf(await updateGraph(s.cwd, await listFiles(s.cwd).catch(() => [] as string[])))
        await approveArch(s.cwd, graph)
        await a.audit.record({
          session: s.id,
          event: "architecture_approved",
          channel: "desktop",
          tool: "architecture",
          cwd: s.cwd,
          project: s.project,
          input: { modules: Object.keys(graph.modules).length, edges: graph.edges.length },
          verdict: { outcome: "allow", ruleId: "architecture", reason: "You approved the project's architecture as it is; drift is measured from here.", risk: 0, decidedBy: "human-desktop", policyHash: "n/a" },
          latencyMs: 0,
        })
        return { ok: true }
      }
      case "tests_first": {
        const s = this.#session(cmd.sessionId)
        s.startTestsFirst(cmd.criteria)
        return { started: true }
      }
      case "tests_first_approve": {
        // D-036: the test files the session changed since its first checkpoint are the ones approved and locked.
        const s = this.#session(cmd.sessionId)
        const c = await a.checkpoints.changes(s.cwd, s.id)
        const files = c.since && "files" in c ? c.files.filter((x) => x.change !== "deleted" && TEST_FILE.test(x.path)).map((x) => x.path) : []
        try {
          return { locked: await s.approveTests(files) }
        } catch (e) {
          throw new CommandError("not-approved", (e as Error).message)
        }
      }
      case "assumption_verify": {
        const s = this.#session(cmd.sessionId)
        await s.verifyAssumption(cmd.id)
        return { ok: true }
      }
      case "requirements": {
        // D-033: read from the project's docs\requirements, linked by the ids commits and tests name.
        const s = this.#session(cmd.sessionId)
        const { requirements, problems } = readRequirements(s.cwd)
        const testFiles = await listFiles(s.cwd).then((l) => l.filter((p) => TEST_FILE.test(p))).catch(() => [] as string[])
        const commits = new Map<string, string[]>()
        for (const r of requirements)
          commits.set(r.id, await gitLines(s.cwd, ["log", "--all", "--format=%H", "-F", `--grep=${r.id}`]).catch(() => []))
        const packs = a.evidence?.store.packs(s.id) ?? []
        const rows = traceMatrix({
          root: s.cwd,
          requirements,
          commitsFor: (id) => commits.get(id) ?? [],
          testFiles,
          evidenceFor: (c) => packs.filter((p) => p.pack.range.commit === c).map((p) => p.sha),
        })
        return { dir: REQUIREMENTS_DIR, rows, problems }
      }
      case "scope": {
        // D-034, D-035: from the plan in the audit log and the change since the checkpoint.
        const s = this.#session(cmd.sessionId)
        const auditDir = a.admin?.auditDir
        const plan = auditDir ? approvedPlan(sessionRecords(auditDir, s.id)) : undefined
        const c = await a.checkpoints.changes(s.cwd, s.id, cmd.ref)
        const files = c.since && "files" in c ? c.files : []
        const { requirements } = readRequirements(s.cwd)
        const { planned, outside } = scopeOf(plan, files.map((x) => x.path))
        return {
          hasPlan: plan !== undefined,
          planned,
          outside,
          unrequested: unrequested({ plan, requirements, files: files.filter((x) => !x.binary && x.change !== "deleted") }),
        }
      }
      case "provenance_graph": {
        // D-028: each changed hunk, the edit that made it, and what was read before it; from the audit log alone.
        const s = this.#session(cmd.sessionId)
        const c = await a.checkpoints.changes(s.cwd, s.id, cmd.ref)
        if (!c.since || !("files" in c)) return { hunks: [] }
        const auditDir = a.admin?.auditDir
        const records = auditDir ? sessionRecords(auditDir, s.id) : []
        const isUntrusted = compileGlobs((a.admin?.config().untrustedFiles ?? UNTRUSTED_FILES).map((g) => g.toLowerCase()))
        return {
          hunks: provenanceGraph({
            records,
            files: c.files.filter((x) => x.path === cmd.file || cmd.file === undefined),
            untrusted: (file) => isUntrusted(file.replace(/\\/g, "/").toLowerCase()),
          }),
        }
      }
      case "characterise": {
        // D-066: the file's behaviour as it was at the checkpoint, captured in a sandbox and kept only if it replays green.
        const s = this.#session(cmd.sessionId)
        if (!a.mutationExec || !a.dataDir) throw new CommandError("unavailable", "Captures are not available here.")
        const c = await a.checkpoints.changes(s.cwd, s.id, cmd.ref)
        if (!c.since) throw new CommandError("no-checkpoint", "This session has no checkpoint yet, so there is nothing from before to capture.")
        const v = await a.checkpoints.versions(s.cwd, c.since.ref, cmd.file)
        if (v.before === undefined) throw new CommandError("new-file", "The file did not exist before the change, so it had no behaviour to capture.")
        const stamp = Date.now().toString(36)
        let cap: Capture
        try {
          cap = await capture({
            root: s.cwd,
            file: cmd.file,
            before: v.before,
            from: c.since.ref,
            exec: a.mutationExec(s.id),
            sandbox: (n) => path.join(os.tmpdir(), `codeh-capture-${s.id}-${stamp}-${n}`),
            redact: (x) => redactString(x, { terms: a.admin?.config().redactTerms ?? [] }),
          })
        } catch (e) {
          throw new CommandError("not-captured", `It could not be captured: ${(e as Error).message}`)
        }
        const dir = path.join(a.dataDir, "characterisation", s.id)
        fs.mkdirSync(dir, { recursive: true })
        await writeFileAtomic(path.join(dir, `${captureKey(cmd.file)}.json`), JSON.stringify(cap, null, 1))
        await a.audit.record({
          session: s.id,
          event: "behaviour_captured",
          channel: "host",
          tool: "characterise",
          cwd: s.cwd,
          project: s.project,
          input: { file: cmd.file, cases: cap.cases.length },
          verdict: { outcome: "allow", ruleId: "characterisation", reason: "What the file did before the change was captured, redacted, and replayed green.", risk: 0, decidedBy: "rules", policyHash: "n/a" },
          latencyMs: 0,
        })
        return { cases: cap.cases.length }
      }
      case "behaviour_diff": {
        // D-006: the captured inputs replayed against the file as it is now.
        const s = this.#session(cmd.sessionId)
        if (!a.mutationExec || !a.dataDir) throw new CommandError("unavailable", "Captures are not available here.")
        let cap: Capture
        try {
          cap = JSON.parse(fs.readFileSync(path.join(a.dataDir, "characterisation", s.id, `${captureKey(cmd.file)}.json`), "utf8")) as Capture
        } catch {
          throw new CommandError("no-capture", "Capture the file's behaviour first.")
        }
        const now = fs.readFileSync(path.join(s.cwd, cmd.file), "utf8")
        let deltas: BehaviourDelta[]
        try {
          deltas = await behaviourDiff({
            root: s.cwd,
            capture: cap,
            now,
            exec: a.mutationExec(s.id),
            sandbox: path.join(os.tmpdir(), `codeh-replay-${s.id}-${Date.now().toString(36)}`),
            redact: (x) => redactString(x, { terms: a.admin?.config().redactTerms ?? [] }),
          })
        } catch (e) {
          throw new CommandError("not-replayed", `It could not be replayed: ${(e as Error).message}`)
        }
        await a.audit.record({
          session: s.id,
          event: "behaviour_compared",
          channel: "host",
          tool: "characterise",
          cwd: s.cwd,
          project: s.project,
          input: { file: cmd.file, cases: cap.cases.length, changed: deltas.length },
          verdict: { outcome: "allow", ruleId: "characterisation", reason: "The captured inputs were replayed against the file as it is now.", risk: 0, decidedBy: "rules", policyHash: "n/a" },
          latencyMs: 0,
        })
        return { cases: cap.cases.length, deltas }
      }
      case "change_sbom": {
        // D-056: from the lockfiles as they were at the checkpoint and as they are now; nothing runs or is fetched.
        const s = this.#session(cmd.sessionId)
        const c = await a.checkpoints.changes(s.cwd, s.id, cmd.ref)
        const locks = c.since ? ("files" in c ? c.files : []).filter((x) => isLockfile(x.path)).slice(0, 20) : []
        const all: DependencyChange[] = []
        for (const x of locks) {
          const v = await a.checkpoints.versions(s.cwd, c.since!.ref, x.path)
          all.push(...lockfileChanges(x.path, v.before, v.after))
        }
        return {
          lockfiles: locks.map((x) => x.path),
          bom: sbomDiff(all, {
            project: s.project,
            version: a.updates?.status().current ?? "unknown",
            ...(c.since ? { describe: `changes since ${c.since.label} (${c.since.ref})` } : {}),
          }),
        }
      }
      case "change_versions": {
        const s = this.#session(cmd.sessionId)
        return await a.checkpoints.versions(s.cwd, cmd.ref, cmd.path)
      }
      case "undo_files": {
        const s = this.#session(cmd.sessionId)
        if (!cmd.confirm) throw new CommandError("not-confirmed", "Undoing needs your confirmation")
        const done = await a.checkpoints.undoFiles(s.cwd, cmd.ref, cmd.paths, s.id, true)
        for (const p of cmd.paths) a.skills?.note("undo", areaOf(findProjectRoot(s.cwd), p))
        await this.#auditUndo(
          "files_undone",
          s.id,
          s.cwd,
          { paths: cmd.paths, ref: cmd.ref },
          "Files were put back as they were at a checkpoint, from the desktop.",
        )
        return done
      }
      case "undo_change": {
        const s = this.#session(cmd.sessionId)
        if (!cmd.confirm) throw new CommandError("not-confirmed", "Undoing needs your confirmation")
        const done = await a.checkpoints.undoChange(s.cwd, {
          ref: cmd.ref,
          path: cmd.path,
          hunk: cmd.hunk,
          afterHash: cmd.afterHash,
          sessionId: s.id,
          confirm: true,
        })
        a.skills?.note("undo", areaOf(findProjectRoot(s.cwd), cmd.path))
        await this.#auditUndo(
          "change_undone",
          s.id,
          s.cwd,
          { path: cmd.path, hunk: cmd.hunk, ref: cmd.ref },
          "One change in a file was put back as it was at a checkpoint, from the desktop.",
        )
        return done
      }
      case "checkpoint_list":
        this.#knownCwd(cmd.cwd)
        return await a.checkpoints.list(cmd.cwd, cmd.sessionId)
      case "checkpoint_preview":
        this.#knownCwd(cmd.cwd)
        return await a.checkpoints.preview(cmd.cwd, cmd.ref)
      case "checkpoint_restore":
        this.#knownCwd(cmd.cwd)
        if (!cmd.confirm)
          throw new CommandError("not-confirmed", "Restoring needs confirmation after the preview")
        return await a.checkpoints.restore(cmd.cwd, cmd.ref, cmd.sessionId, true)
      case "edit_revert": {
        // T-042: only a session in its own worktree that no other open session shares, only to one of its own
        // checkpoints, and recorded before anything is put back (a checkpoint of how things are now is saved too).
        const s = this.#session(cmd.sessionId)
        const why = cannotRevert({ id: s.id, cwd: s.cwd, worktree: s.info().worktree }, a.manager.list())
        if (why) throw new CommandError("not-allowed", why)
        const mine = await a.checkpoints.list(s.cwd, s.id)
        if (!mine.some((c) => c.ref === cmd.ref))
          throw new CommandError("invalid", "That checkpoint is not one of this session's.")
        const written = await a.audit.record({
          session: s.id,
          event: "edit_files_reverted",
          channel: "desktop",
          tool: "checkpoint",
          cwd: s.cwd,
          input: { ref: cmd.ref },
          verdict: {
            outcome: "allow",
            ruleId: EDIT_REVERT_RULE,
            reason: "You edited a message and asked for the files to be put back as they were when you sent it.",
            risk: 0,
            decidedBy: "human-desktop",
            policyHash: "",
          },
          latencyMs: 0,
        })
        if (!written) throw new CommandError("audit-failure", "It could not be recorded, so nothing was put back.")
        return await a.checkpoints.restore(s.cwd, cmd.ref, s.id, true)
      }
      case "list_history":
        return await a.listHistory(cmd.dir)
      case "session_meta": {
        const h = this.#history()
        const live = a.manager.list().find((s) => s.sdkSessionId === cmd.sdkSessionId)
        const meta = await h.setMeta(
          cmd.sdkSessionId,
          {
            ...(cmd.title !== undefined ? { title: cmd.title } : {}),
            ...(cmd.pinned !== undefined ? { pinned: cmd.pinned } : {}),
            ...(cmd.archived !== undefined ? { archived: cmd.archived } : {}),
            ...(cmd.group !== undefined ? { group: cmd.group } : {}),
          },
          live?.cwd ?? cmd.cwd,
          a.log,
        )
        a.manager.announce(cmd.sdkSessionId)
        return meta
      }
      case "fallback_used": {
        // B21: only a chat, only to a model you allow on this computer or its gateway; recorded by session and model.
        const from = a.manager.get(cmd.from)?.info()
        if (!from || from.kind !== "chat")
          throw new Error("Only a chat can be carried on with another model.")
        const local = a.admin?.config().providers?.local
        if (!local?.models.some((m) => m.name === cmd.model))
          throw new Error("That model is not one you allow in Settings, Other AI providers.")
        // The same data boundary as Claude or stricter: this computer, or a gateway whose provider keeps nothing or 30
        // days at most. One whose provider's keeping is not known is not offered.
        if (local.kind === "gateway" && local.keeps !== "nothing" && local.keeps !== "30-days")
          throw new Error(
            "That gateway's provider may keep more than Claude does, so a chat is not carried on there.",
          )
        // D-085: and only content the target model's card allows: confidential content needs a card in date that says so.
        const config = a.admin?.config()
        const classification = classificationOf(config?.dataClassification as Parameters<typeof classificationOf>[0], from.project)
        const refused = await refuseHandoff(
          { session: cmd.from, from: from.model ?? "default", to: cmd.model, local: true, classification },
          config?.providers?.boundaries as Boundaries | undefined,
          this.#opts.app.audit,
        )
        if (refused) throw new CommandError("handoff-denied", refused)
        const recorded = await this.#opts.app.audit.record({
          session: cmd.from,
          event: "fallback_used",
          channel: "desktop",
          tool: "fallback",
          input: { from: from.model ?? "default", to: cmd.model, kind: local.kind },
          verdict: {
            outcome: "allow",
            ruleId: "fallback-used",
            reason:
              "You carried a chat on with another model you allow, whose data boundary is the same or stricter.",
            risk: 0,
            decidedBy: "human-desktop",
            policyHash: "",
          },
          latencyMs: 0,
        })
        if (!recorded) throw new Error("It could not be recorded, so the chat was not carried on.")
        return undefined
      }
      case "compare_chosen": {
        // B22: which answer you kept, by session and model, never what was said. The screen closes the rest.
        // G25: or which of several runs of one prompt, each in its own worktree, by session and branch.
        const all = [cmd.kept, ...cmd.others].map((id) => a.manager.get(id)?.info())
        const runs = all.every((s) => s && s.kind !== "chat" && s.worktree)
        if (!runs && all.some((s) => !s || s.kind !== "chat"))
          throw new Error(
            "Only chats started side by side, or runs each in its own worktree, can be compared.",
          )
        const model = (s: (typeof all)[number]) => s?.model ?? "default"
        const which = (s: (typeof all)[number]) => ({
          session: s?.id,
          model: model(s),
          ...(runs ? { branch: s?.worktree?.branch } : {}),
        })
        await this.#opts.app.audit.record({
          session: cmd.kept,
          event: "compare_chosen",
          channel: "desktop",
          tool: "compare",
          input: {
            kept: which(all[0]),
            others: all.slice(1).map(which),
          },
          verdict: {
            outcome: "allow",
            ruleId: "compare-chosen",
            reason: runs
              ? "You kept one of several runs of the same prompt, each in its own worktree."
              : "You kept one of several answers compared side by side.",
            risk: 0,
            decidedBy: "human-desktop",
            policyHash: "",
          },
          latencyMs: 0,
        })
        return undefined
      }
      case "history_messages":
        return cmd.all
          ? await this.#history().allMessages(cmd.sdkSessionId, cmd.cwd)
          : await this.#history().messages(cmd.sdkSessionId, cmd.cwd)
      case "search_history":
        return await this.#history().search(cmd.query)
      case "stop_task": {
        // T-063: one background task of this session stopped from its details, recorded first.
        if (!(await this.#session(cmd.sessionId).stopBackgroundTask(cmd.taskId)))
          throw new CommandError("not-found", "That task is not running in this session, or the stop could not be recorded.")
        return { stopped: true }
      }
      case "context_usage":
        return await this.#session(cmd.sessionId).contextUsage()
      case "session_details": {
        const s = this.#session(cmd.sessionId)
        return await sessionDetails(s.cwd, () => s.mcpStatus())
      }
      case "compact":
        this.#session(cmd.sessionId).compact()
        return undefined
      case "signin_start":
        return this.#signIn(cmd.account).start(cmd.method)
      case "signin_status":
        return this.#signIn(cmd.account).status()
      case "signin_cancel":
        return this.#signIn(cmd.account).cancel()
      case "account_add": {
        const added = await this.#accounts().add(cmd.label)
        await this.#auditAccount(
          "account_added",
          { account: added.id, label: added.label },
          `The account ${added.label} was added from the desktop.`,
        )
        this.announceHealth()
        return added
      }
      case "account_confirm_org": {
        const confirmed = await this.#accounts().confirmOrg(cmd.account)
        await this.#auditAccount(
          "account_org_confirmed",
          { account: confirmed.id, organization: confirmed.expectedOrg },
          `The account ${confirmed.label} must belong to ${confirmed.expectedOrg ?? "its organisation"}, as confirmed from the desktop.`,
        )
        this.announceHealth()
        return confirmed
      }
      case "account_remove":
        await this.#accounts().remove(cmd.account)
        await this.#auditAccount(
          "account_removed",
          { account: cmd.account },
          "An account was removed from the desktop.",
        )
        this.announceHealth()
        return undefined
      case "account_private_window":
        this.#accounts().openPrivate(cmd.account)
        return undefined
      case "refresh_account": {
        const snapshot =
          cmd.account && cmd.account !== MAIN_ACCOUNT
            ? await this.#accounts().monitor(cmd.account).refresh()
            : await a.account.refresh()
        // Every open window shows the new result, not only the one that asked.
        this.announceHealth()
        return snapshot
      }
    }
  }
}

function resolveResult(r: ReturnType<Broker["resolve"]>): unknown {
  if (r.ok) return { resolution: toWire(r.resolution) }
  throw new CommandError(
    r.reason === "not-pending" ? "unknown-request" : r.reason,
    r.detail ?? "The answer was not accepted",
  )
}

function classify(e: unknown): CommandError {
  if (e instanceof OrgGuardError) return new CommandError(`org-guard.${e.code}`, e.message)
  if (e instanceof KillSwitchEngagedError) return new CommandError("kill-switch", e.message)
  if (e instanceof SessionFolderError) return new CommandError("folder-missing", e.message)
  if (e instanceof SessionLimitError) return new CommandError("session-limit", e.message)
  if (e instanceof MemoryRefusedError) return new CommandError("memory", e.message)
  if (e instanceof LockedTestsChangedError) return new CommandError("locked-tests", e.message)
  if (e instanceof InstructionsChangedError) return new CommandError("instructions-changed", e.message)
  if (e instanceof ManagedPolicyError) return new CommandError("managed-policy", e.message)
  if (e instanceof CanaryFailedError) return new CommandError("canary-failed", e.message)
  if (e instanceof ChatModeError) return new CommandError("chat-mode", e.message)
  if (e instanceof SafetyError) return new CommandError("safety", e.message)
  return new CommandError("failed", (e as Error).message ?? "The command failed")
}

/** D-066: a capture's file name, from the file's path. */
const captureKey = (file: string) => createHash("sha256").update(file.replace(/\\/g, "/")).digest("hex").slice(0, 24)

/** D-033: a git command's output, a line at a time. */
const gitLines = (cwd: string, args: string[]): Promise<string[]> =>
  new Promise((resolve, reject) =>
    execFileCb("git", args, { cwd, windowsHide: true, timeout: 20_000, maxBuffer: 16 * 1024 * 1024 }, (e, out) =>
      e ? reject(e) : resolve(String(out).split(/\r?\n/).filter(Boolean)),
    ),
  )

