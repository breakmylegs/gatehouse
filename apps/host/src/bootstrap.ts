import { TestLocks } from "./test-locks.js"
import { helperReader, memoryPoint, MemoryGovernor } from "./memory-governor.js"
import { macMemoryReader } from "./memory-governor-mac.js" // Mac fork
import fs from "node:fs"
import { pickFilesWithWindows } from "./attach-api.js"
import { SlackChannel, SlackSecretStore } from "./push/slack.js"
import { NtfyChannel, NtfySecretStore } from "./push/ntfy.js"
import { ExtraSpendToday, LimitPauser, pausePoint } from "./limit-pause.js"
import { Telemetry } from "./telemetry.js"
import { routineSessionOptions, RoutineScheduler, RoutineStore, type Routine } from "./routines.js"
import { TriggerWatcher } from "./routine-triggers.js"
import { BoardStore } from "./board.js"
import { buildPhoneSessions, PhoneSessionsSharer } from "./phone-sessions.js"
import { OpenSessionsStore, restoreOpenSessions } from "./open-sessions.js"
import { chatArtifactClient } from "./artifact-client.js"
import { ArtifactStore } from "./artifacts.js"
import { clearTemp } from "./housekeeping.js"
import { PromptStore } from "./prompts.js"
import { chatMemoryClient } from "./memory-client.js"
import { MemoryStore } from "./memory.js"
import { ProjectStore } from "./projects.js"
import { findLimitsExe, limiter } from "./limits.js"
import { HeldOutChecks, type HeldOutExec } from "./heldout.js"
import { runCodehouseAction } from "./codehouse-action.js"
import { runHeldOutFor } from "./heldout-session.js"
import os from "node:os"
import { LocalRelay } from "./relay/local.js"
import { helperPickers, pickFolderWithWindows, saveAsWithWindows } from "./folder-picker.js"
import { pickFolderWithMac, saveAsWithMac } from "./folder-picker-mac.js" // Mac fork
import { findCodehouseHelper } from "./win-helper.js"
import { ChatStore } from "./chat/db.js"
import { ChatRecorder } from "./chat/recorder.js"
import { findEdge, hasAppLink, realLauncher } from "./chat/handoff.js"
import { macLauncher } from "./chat/handoff-mac.js" // Mac fork
import { DEFAULT_SEED } from "./chat/continue.js"
import { createSummariser } from "./chat/summarise.js"
import { createRecapWriter } from "./recap-writer.js"
import { createBtwWriter } from "./btw.js"
import { findClaudeBinary, SignInFlow } from "./signin.js"
import { binaryRunner, Marketplace } from "./marketplace.js"
import { EvalStore, PluginEvaluator } from "./plugin-eval.js"
import { readItModels } from "./providers/it-models.js"
import { claudeVersion } from "./doctor.js"
import { Worktrees } from "./worktrees.js"
import { checkRuntime, runtimeLabel, type LocalRuntimeConfig } from "./providers/local-runtime.js"
import { localQuery } from "./providers/local-query.js"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import {
  getSessionMessages,
  listSessions,
  query,
  renameSession,
  resolveSettings,
  type Options,
} from "@anthropic-ai/claude-agent-sdk"
import {
  PolicyEngine,
  PolicyStore,
  PwshWorker,
  redact,
  redactString,
  MANAGED_ERROR,
} from "@gatehouse/policy"
import { sanitiseEnv, type Health } from "@gatehouse/shared"
import { AuditWriter } from "@gatehouse/shared/audit"
import {
  auditDir,
  configPath,
  gatehouseDataDir,
  GatehouseConfig as GatehouseConfigSchema,
  loadConfig,
  writeFileAtomic,
  type GatehouseConfig,
  managedPolicyDir,
  useShadowCheckpoints,
} from "@gatehouse/shared/node"
import { AccountMonitor, type QueryFn } from "./account.js"
import { Accounts, type AccountEntry } from "./accounts.js"
import { APPROVER_TIMEOUT_MS, ApproverClient } from "./approver-client.js"
import { ApproverProcess, freePort, generateToken } from "./approver-process.js"
import { Broker } from "./broker.js"
import { CheckpointManager } from "./checkpoints.js"
import { GrantUses } from "./grant-uses.js"
import { createCompanionSdkServer } from "./companion-server.js"
import { lookAtPage } from "./page-look.js"
import { readAbout, type AboutDeps } from "./about-session.js"
import { noteFor } from "./carry-on.js"
import { denyOutput } from "./hooks.js"
import { HostAudit } from "./hostaudit.js"
import { computeDigest } from "./analytics.js"
import { recordsSince } from "./api.js"
import { DigestScheduler } from "./digest.js"
import { HostKillSwitch } from "./kill.js"
import { sealerFor, type Protector } from "./relay/protector.js"
import { PhoneService } from "./relay/service.js"
import { PhoneStore } from "./relay/store.js"
import type { HostApp } from "./server.js"
import { SessionManager, type SessionDeps } from "./sessions.js"
import { TerminalManager } from "./terminal.js"
import { SessionHistory, type SessionSdk } from "./history.js"
import { SessionMetaStore } from "./session-meta.js"
import { localDay, UsageStore } from "./usage.js"
import { UpdateService } from "./update/service.js"
import { GitHubSource } from "./update/source.js"
import { ChangelogStore } from "./update/changelog.js"
import { UpdateTokenStore } from "./update/token.js"
import { execFileSync } from "node:child_process"

const here = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(here, "../../..")

export interface HostOptions {
  /** Replaces the SDK's query(), for tests. */
  queryFn?: QueryFn
  /** Do not start the Approver process (tests that bring their own). */
  approver?: { url: string; token: string } | "spawn"
  env?: NodeJS.ProcessEnv
  config?: GatehouseConfig
  rulesPath?: string
  log?: (line: string) => void
  /** How the device token and the Host's phone key are kept on disk. Defaults to DPAPI on Windows. */
  phoneProtector?: Protector
  /** Called when something outside the server changes health, such as a finished sign-in. */
  onHealthChanged?: () => void
  /** Each step of the start, in words, for the start-up picture. */
  onProgress?: (text: string) => void
  /** Keeps the open sessions and brings them back at the next start. The desktop Host does; the CLI does not. */
  keepOpenSessions?: boolean
  /** Runs sessions inside job objects with their resource limits (Codehouse-Limits.exe). The desktop Host does. */
  limitResources?: boolean
}

export interface Host {
  app: HostApp
  updates: UpdateService
  config: GatehouseConfig
  approverProcess: ApproverProcess | undefined
  store: PolicyStore
  pwsh: PwshWorker
  start(): Promise<void>
  stop(): Promise<void>
}

/**
 * How to start another Codehouse program as a Node child: its built file when the package has one (apps/<name>/dist/
 * main.mjs, made by scripts/bundle.mjs), otherwise its TypeScript source through tsx.
 */
export function childArgs(name: "approver" | "relay"): string[] {
  const built = path.join(REPO_ROOT, "apps", name, "dist", "main.mjs")
  return fs.existsSync(built)
    ? [built]
    : ["--import", tsxLoaderUrl(), path.join(REPO_ROOT, "apps", name, "src", "main.ts")]
}

/** The loader URL a child process in another folder needs to run TypeScript directly. */
export function tsxLoaderUrl(): string {
  return pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href
}

/**
 * Assembles the Host's parts: the policy and its PowerShell parser, the Approver process and its client,
 * the audit log, the broker, the kill switch, usage and checkpoints, the account monitor and the session
 * manager. The real Host and the command line harness both start here, so they behave the same.
 */
export function createHost(opts: HostOptions = {}): Host {
  const env = opts.env ?? process.env
  const log = opts.log ?? ((line: string) => process.stderr.write(`[host] ${line}\n`))
  const config = opts.config ?? loadConfig(env)
  const rulesPath =
    opts.rulesPath ??
    env.GATEHOUSE_RULES_PATH ??
    config.rulesPath ??
    path.join(REPO_ROOT, "policy", "rules.yaml")
  const rulesDir = path.dirname(rulesPath)
  const localRules = env.GATEHOUSE_LOCAL_RULES ?? path.join(rulesDir, "rules.local.yaml")
  const loadOptions = {
    rulesPath,
    overlayDir: env.GATEHOUSE_OVERLAY_DIR ?? path.join(rulesDir, "projects"),
    localPath: localRules,
    libraryDir: env.GATEHOUSE_LIBRARY_DIR ?? path.join(rulesDir, "library"),
    userRulesPath: env.GATEHOUSE_USER_RULES ?? path.join(rulesDir, "rules.user.yaml"),
    // B37: IT's signed policy, when there is one.
    managedDir: managedPolicyDir(env),
    ...(config.workspaceRoots ? { workspaceRootsOverride: config.workspaceRoots } : {}),
    ...(config.projectsFolder ? { extraWorkspaceRoots: [config.projectsFolder] } : {}),
  }

  const store = new PolicyStore(loadOptions)
  const pwsh = new PwshWorker()
  const engine = new PolicyEngine({
    getPolicy: () => store.current,
    pwsh,
    sensitiveTerms: () => config.redactTerms ?? [],
  })
  const dir = auditDir(env)
  const audit = new HostAudit(
    new AuditWriter({ dir, redact: (v) => redact(v, { terms: config.redactTerms }) }),
    log,
  )
  const phoneHolder: { svc?: PhoneService } = {}
  const broker = new Broker({
    phone: {
      deliver: (r) =>
        phoneHolder.svc
          ? phoneHolder.svc.deliver(r)
          : Promise.reject(new Error("No phone is paired")),
      cancel: (id, summary) =>
        phoneHolder.svc ? phoneHolder.svc.cancel(id, summary) : Promise.resolve(),
    },
    phoneExpiryMs: config.phoneExpiryMs,
    hardTimeoutMs: config.hardTimeoutMs,
    quietHours: () => config.quietHours ?? store.current?.rules.quietHours,
    redact: (v) => redact(v, { terms: config.redactTerms }),
  })
  // 15 seconds, or 35 while the policy has the judge on (its own limit is 25). Still bounded, still fail-closed.
  // It was 5: on a busy laptop (Claude streaming a 40,000 character file, 29 Oct) a 30 ms answer took 7 seconds
  // to come back, and the call went to a person even in Extreme approval.
  const approverTimeout = (): number =>
    store.current?.rules.defaults?.judge?.enabled === true ? 35_000 : APPROVER_TIMEOUT_MS
  const usage = new UsageStore(path.join(gatehouseDataDir(env), "usage.json"))
  // G27: undo points for a folder outside git, kept in Codehouse's data folder, never in the folder itself.
  useShadowCheckpoints(path.join(gatehouseDataDir(env), "undo"))
  const checkpoints = new CheckpointManager({
    config: () => config,
    policy: () => store.current,
    log,
  })
  // C-013: how often each remembered rule with a use limit has allowed a call.
  const grants = new GrantUses(path.join(gatehouseDataDir(env), "grant-uses.json"), () => store.current)

  // The Approver: spawned with a fresh token, or one that already exists (tests).
  let approverProcess: ApproverProcess | undefined
  let approverClient: ApproverClient
  const spawnApprover = opts.approver === undefined || opts.approver === "spawn"
  const approverToken = spawnApprover ? generateToken() : (opts.approver as { token: string }).token
  const approverPortPromise = spawnApprover ? freePort() : Promise.resolve(0)
  let approverUrl = spawnApprover ? "" : (opts.approver as { url: string }).url
  approverClient = new ApproverClient({
    url: approverUrl || "http://127.0.0.1:9/mcp",
    token: approverToken,
    timeoutMs: approverTimeout,
  })

  // Assigned once, below, after the kill switch that needs it is built, so it cannot be a const here.
  // eslint-disable-next-line prefer-const
  let manager!: SessionManager
  // eslint-disable-next-line prefer-const
  let terminal!: TerminalManager
  let routineTriggers: TriggerWatcher<Routine> | undefined
  const kill = new HostKillSwitch({
    broker,
    audit,
    approver: { setKillSwitch: (e, by, reason) => approverClient.setKillSwitch(e, by, reason) },
    // The kill switch also stops your own commands in the terminal pane.
    interruptAll: () => {
      terminal.stopAll()
      return manager.interruptAll()
    },
    env,
    log,
  })

  const queryFn: QueryFn = opts.queryFn ?? (query as unknown as QueryFn)
  const probeOptions = (probeEnv: Record<string, string | undefined>): Options => ({
    cwd: process.cwd(),
    permissionMode: "default",
    env: probeEnv,
    settingSources: [],
    // The probe sends no prompt, so nothing can run. If something somehow did, it would be denied.
    canUseTool: async () => ({
      behavior: "deny",
      message: "This is an account check, not a session.",
    }),
    hooks: {
      PreToolUse: [{ hooks: [async () => denyOutput("This is an account check, not a session.")] }],
    },
  })
  const account = new AccountMonitor({
    queryFn,
    expectedOrg: () => config.expectedOrg,
    probeOptions: () => ({
      cwd: process.cwd(),
      permissionMode: "default",
      env: sanitiseEnv(process.env),
      settingSources: [],
      // The probe sends no prompt, so nothing can run. If something somehow did, it would be denied.
      canUseTool: async () => ({
        behavior: "deny",
        message: "This is an account check, not a session.",
      }),
      hooks: {
        PreToolUse: [
          { hooks: [async () => denyOutput("This is an account check, not a session.")] },
        ],
      },
    }),
    managedDetected: async () => {
      const r = await resolveSettings({ cwd: process.cwd(), settingSources: [] })
      return r.sources.some((s) => s.source === "managed")
    },
  })
  const managedDetected = async () => {
    try {
      const r = await resolveSettings({ cwd: process.cwd(), settingSources: [] })
      return r.sources.some((s) => s.source === "managed")
    } catch {
      return undefined
    }
  }

  const sessionMeta = new SessionMetaStore(path.join(gatehouseDataDir(env), "sessions.json"))
  const history = new SessionHistory(
    {
      listSessions: listSessions as unknown as SessionSdk["listSessions"],
      getSessionMessages: getSessionMessages as unknown as SessionSdk["getSessionMessages"],
      renameSession,
    },
    sessionMeta,
  )
  // Ask about code: the linked session read from Claude Code's own record of it, and as it is now when it is open.
  const aboutDeps = (): AboutDeps => ({
    messages: (sdkSessionId, cwd) => history.allMessages(sdkSessionId, cwd),
    live: (id) => manager.get(id)?.info(),
    redact: (t) => redactString(t, { terms: config.redactTerms }),
  })
  const projects = new ProjectStore(path.join(gatehouseDataDir(env), "projects"))
  // Where new worktrees go is read from Settings each time one is made; a folder must be inside a workspace root.
  const worktrees = new Worktrees(gatehouseDataDir(env), {
    place: () => config.worktreeLocation,
    roots: () => store.current?.rules.workspaceRoots ?? [],
    branchPrefix: () => config.pullRequests?.branchPrefix,
  })
  // B34: routines, started as normal sessions on their days and times while Codehouse is open.
  const routines = new RoutineStore(path.join(gatehouseDataDir(env), "routines.json"))
  const board = new BoardStore(path.join(gatehouseDataDir(env), "board.json"))
  // What chats remember: redacted before it is written, with the same word list as everything else.
  const memory = new MemoryStore(path.join(gatehouseDataDir(env), "memory"), (t) =>
    redact(t, { terms: config.redactTerms }),
  )
  // Codehouse's own temporary leftovers (owner, 1 Nov: the disk filled): cleared at start and once a day, an hour old
  // or more, so nothing still in use is touched.
  const tidy = () => {
    const r = clearTemp(60 * 60_000)
    if (r.removed)
      log(`cleared ${r.removed} temporary leftover(s), ${Math.round(r.bytes / 1024 / 1024)} MB`)
  }
  tidy()
  setInterval(tidy, 24 * 60 * 60_000).unref()
  // Your saved prompts (W1-14): redacted before they are kept, as memory is.
  const prompts = new PromptStore(path.join(gatehouseDataDir(env), "prompts.json"), (t) =>
    redactString(t, { terms: config.redactTerms }),
  )
  // What chats show in a sandbox: redacted before it is kept.
  const artifacts = new ArtifactStore(path.join(gatehouseDataDir(env), "artifacts"), (t) =>
    redact(t, { terms: config.redactTerms }),
  )
  // C-004: above the commit charge in Settings, nothing heavy of Codehouse's own starts. Read through the helper, found
  // when first needed (below); a reading it cannot have refuses nothing.
  const governor = new MemoryGovernor({
    read: process.platform === "darwin" ? macMemoryReader() : helperReader(() => helper()), // Mac fork
    point: () => memoryPoint(config.memoryGovernor),
    audit,
    log,
  })
  const deps: SessionDeps = {
    governor,
    queryFn,
    worktrees,
    sessionMeta: (id) => sessionMeta.get(id),
    // A chat's first message becomes its title, unless you already gave it one.
    nameChat: async (id, title) => {
      if (!sessionMeta.get(id).title) await sessionMeta.set(id, { title })
    },
    resumeSettings: (id) => sessionMeta.settings(id),
    managedPolicyProblem: () => store.status().errors.find((e) => e.startsWith(MANAGED_ERROR)),
    // Models on this computer (ADR 0011), only while other providers are on, checked before each chat starts.
    local: {
      label: () =>
        runtimeLabel((config.providers?.local ?? { kind: "ollama" }) as LocalRuntimeConfig),
      check: async (model) => {
        const p = config.providers
        if (p?.multi?.enabled !== true || !p.local)
          throw new Error("Models on this computer are not switched on.")
        const r = await checkRuntime(
          p.local as LocalRuntimeConfig,
          fetch,
          readItModels(managedPolicyDir(env)),
        )
        if (!r.ok) throw new Error(r.reason)
        if (!r.models.includes(model))
          throw new Error("That model is not one you allowed, or the runtime does not have it.")
      },
      queryFn: (model) => (params) => {
        const runtime = config.providers?.local as LocalRuntimeConfig
        return localQuery(params, {
          runtime,
          model,
          models: runtime.models.map((m) => m.name),
          // The main account, so the organisation check at start is the one every session has (invariant 14).
          account: () => {
            const a = account.last()
            return a?.signedIn
              ? ({
                  email: a.email,
                  organization: a.organization,
                  subscriptionType: a.subscriptionType,
                  apiProvider: a.apiProvider,
                } as never)
              : undefined
          },
          redact: (t) => redactString(t, { terms: config.redactTerms }),
        }) as unknown as ReturnType<QueryFn>
      },
    },
    chatsDir: path.join(gatehouseDataDir(env), "chats"),
    projects,
    memory,
    artifacts,
    config: () => config,
    policy: () => store.current,
    engine,
    pwsh,
    audit,
    broker,
    approver: undefined as unknown as ApproverClient,
    kill,
    usage,
    checkpoints,
    grants,
    account,
    // Owner, 9 Nov: a bypass that ran out pauses its session at once, not at the next look.
    limitCheck: () => limitPauser.check(),
    // Ask about code: how a linked code session stands and the latest of what was said in it, redacted.
    aboutSaid: (about) => readAbout(about, aboutDeps()),
    companion: ({ sessionId, cwd, kind, chatProject, about }) => ({
      companion: createCompanionSdkServer({
        sessionId,
        cwd,
        // A chat can show artifacts; a coding session cannot.
        ...(kind === "chat"
          ? {
              artifacts: chatArtifactClient({
                store: artifacts,
                audit,
                sessionId,
                cwd,
                policyHash: () => store.current?.hash ?? "",
              }),
            }
          : {}),
        // A chat can remember, recall and forget; a coding session has no memory tools.
        ...(kind === "chat"
          ? {
              memory: chatMemoryClient({
                store: memory,
                audit,
                sessionId,
                cwd,
                project: chatProject,
                policyHash: () => store.current?.hash ?? "",
              }),
            }
          : {}),
        // notify_user reaches the desktop through the session's event stream. The phone path is added with the relay.
        host: { notify: async (m) => (manager.notify(m.sessionId, m.text), true) },
        policy: () => store.current,
        redact: (v) => redact(v, { terms: config.redactTerms }),
        // Ask about code: a chat about a code session reads it as it is now; it never writes to it.
        ...(kind === "chat" && about
          ? {
              about: {
                read: async () => ({ text: await readAbout(about, aboutDeps()) }),
              },
            }
          : {}),
        // Browser tools (Settings, off unless turned on): a coding session may look at a page on this computer.
        ...(kind !== "chat" && config.browserTools === true
          ? {
              pages: {
                look: async (url: string) => {
                  await governor.admit("page look", { sessionId })
                  return await lookAtPage(url, {
                    edge: () => findEdge(),
                    redact: (t) => redactString(t, { terms: config.redactTerms }),
                  })
                },
              },
            }
          : {}),
      }),
    }),
    managedDetected,
    localRulesPath: localRules,
    // Sealed for the phone like any other note. It names the tool and the project, never the input.
    notifyAutoApproved: (toolName, project) =>
      void phoneHolder.svc
        ?.notify("notify", {
          title: "Approved automatically",
          body: `Extreme approval mode is on, so this was approved without asking: ${toolName}.`,
          project,
        })
        .catch(() => undefined),
    log,
  }
  // The client is replaced once the Approver's port is known, so the session deps hold a stable proxy.
  const approverProxy = {
    evaluate: (...a: Parameters<ApproverClient["evaluate"]>) => approverClient.evaluate(...a),
    status: () => approverClient.status(),
    setKillSwitch: (...a: Parameters<ApproverClient["setKillSwitch"]>) =>
      approverClient.setKillSwitch(...a),
  }
  deps.approver = approverProxy as unknown as ApproverClient
  if (opts.limitResources) {
    const exe = findLimitsExe({
      installDir: env.GATEHOUSE_PACKAGED === "1" ? path.dirname(REPO_ROOT) : undefined,
      repoRoot: REPO_ROOT,
      dataDir: gatehouseDataDir(env),
      log,
    })
    if (exe) deps.limiter = limiter(exe)
  }
  manager = new SessionManager(deps)
  // D-007: the locked tests, their pins sealed by a key DPAPI keeps for this Windows user.
  const locks = new TestLocks({ dir: path.join(gatehouseDataDir(env), "locks"), sealer: () => sealer() })
  deps.locks = locks
  // D-002: sealed held-out checks, run under a job object where Codehouse-Limits.exe can be had.
  const limitsExe = findLimitsExe({
    installDir: env.GATEHOUSE_PACKAGED === "1" ? path.dirname(REPO_ROOT) : undefined,
    repoRoot: REPO_ROOT,
    dataDir: gatehouseDataDir(env),
    log,
  })
  const heldOut = new HeldOutChecks({ dataDir: gatehouseDataDir(env), sealer: () => sealer() })
  // D-009: a claim's check runs as Codehouse's own action, for the session it was made in.
  deps.codehouseAction = (r) =>
    runCodehouseAction(r, {
      approver: deps.approver,
      broker,
      audit,
      kill,
      extreme: () => manager.get(r.sessionId)?.info().extreme === true,
      ...(limitsExe ? { limitsExe } : {}),
    })
  // Section 6: what Codehouse runs itself is judged, run without credentials in a job at the session's level, and
  // stopped by the kill switch.
  const actionFor = (sessionId: string): HeldOutExec => async (command, cwd, timeoutMs) => {
    const s = manager.get(sessionId)
    const r = await runCodehouseAction(
      {
        sessionId,
        cwd,
        project: s?.project ?? "",
        command,
        why: "this project's held-out checks",
        level: s?.info().resources ?? "high",
        timeoutMs,
      },
      {
        approver: deps.approver,
        broker,
        audit,
        kill,
        extreme: () => s?.info().extreme === true,
        ...(limitsExe ? { limitsExe } : {}),
      },
    )
    return { exitCode: r.exitCode, output: r.output, timedOut: r.timedOut, ...(r.refused ? { refused: r.refused } : {}) }
  }
  // Chat's own store (CH-02, CH-03): every native chat is recorded as it happens, redacted first (invariant 12).
  const chatStore = new ChatStore({
    file: path.join(gatehouseDataDir(env), "chat", "chat.db"),
    redact: (v) => redact(v, { terms: config.redactTerms }),
  })
  const chatRecorder = new ChatRecorder(chatStore, (id) => manager.get(id)?.info(), log)
  manager.on("prompted", ({ sessionId, text }) => chatRecorder.prompted(sessionId, text))
  manager.on("message", ({ sessionId, message }) =>
    chatRecorder.message(sessionId, message as unknown as Record<string, unknown>),
  )
  manager.on("session", (info) => {
    if (info.state === "ended") chatRecorder.closed(info.id)
  })
  const extraSpend = new ExtraSpendToday({
    file: path.join(gatehouseDataDir(env), "extra-spend-today.json"),
    today: () => localDay(new Date()),
  })
  // Pauses every session at 95% of the plan's 5-hour limit and starts them again when it resets (owner, 31 Oct).
  const limitPauser = new LimitPauser({
    sessions: () => manager.liveSessions(),
    planUsage: (account, fresh) => manager.planUsage(account, fresh),
    pauseAt: () => pausePoint(config.planLimitPause),
    // B20: what was really spent today, and the cap on it. Owner, 6 Nov: a Claude session runs on the plan, so the
    // API price it reports is not money spent and never counts; a model through a gateway may charge, so its does.
    spendToday: () => {
      const day = localDay(new Date())
      const cells = usage.report(day, day).days[day] ?? {}
      return manager
        .liveSessions()
        .filter((s) => s.info().local === true)
        .reduce((n, s) => n + (cells[s.id]?.total.costUsd ?? 0), 0)
    },
    spendCap: () => config.spendCapUsd,
    extraToday: (account, used) => extraSpend.spent(account, used),
    autoResume: () => config.planLimitPause?.noAutoResume !== true,
    log,
  })
  // The sessions open now, so a restart or an update brings them back (owner, 30 Oct: nothing lost).
  const openSessions = opts.keepOpenSessions
    ? new OpenSessionsStore(path.join(gatehouseDataDir(env), "open-sessions.json"))
    : undefined
  // A chat on a model on this computer has no saved conversation to carry on from yet, so it is not brought back.
  if (openSessions)
    manager.on("session", (info) => !info.local && !info.evaluation && openSessions.note(info))
  // What each conversation runs with, kept by its Claude Code id, so Resume starts it the same way (owner, 31 Oct).
  manager.on("session", (info) => {
    if (!info.sdkSessionId || info.kind === "chat") return
    sessionMeta.keepSettings(info.sdkSessionId, {
      ...(info.model !== undefined ? { model: info.model } : {}),
      ...(info.effort !== undefined ? { effort: info.effort } : {}),
      mode: info.mode,
      extreme: info.extreme === true,
      ...(info.resources !== undefined ? { resources: info.resources } : {}),
    })
  })

  // Codehouse's own Windows work needs no PowerShell (owner, 4 Nov: "Why do I need powershell at all?"): DPAPI and the
  // file windows go through Codehouse-Helper.exe, found once when first needed. PowerShell is only the fallback where
  // the helper cannot be had (a source checkout with no C# compiler).
  let helperExe: string | null | undefined
  const helper = (): string | undefined => {
    if (helperExe === undefined)
      helperExe =
        findCodehouseHelper({
          installDir: env.GATEHOUSE_PACKAGED === "1" ? path.dirname(REPO_ROOT) : undefined,
          repoRoot: REPO_ROOT,
          dataDir: gatehouseDataDir(env),
          log,
        }) ?? null
    return helperExe ?? undefined
  }
  const sealer = (): Protector => sealerFor({ given: opts.phoneProtector, helper })
  const phoneStore = new PhoneStore(path.join(gatehouseDataDir(env), "phone.json"), sealer())
  const phone = new PhoneService({
    store: phoneStore,
    broker,
    kill,
    audit,
    log,
    // G32: a signed message or Interrupt from the phone reaches only a session open here, as the phone was shown it.
    sessions: {
      has: (id) => {
        const i = manager.get(id)?.info()
        return i !== undefined && i.state !== "ended" && !i.evaluation
      },
      prompt: (id, text) => manager.get(id)?.prompt(text),
      interrupt: async (id) => {
        await manager.get(id)?.interrupt()
      },
      // G32 (B35's safe variant): only a routine you allowed for the phone, started the way the routine starts.
      canStart: (id) => routines.list().some((r) => r.id === id && r.phone === true),
      start: async (id) => {
        const r = routines.list().find((x) => x.id === id && x.phone === true)
        if (!r) throw new Error("no such routine")
        const session = await manager.start(routineSessionOptions(r))
        session.prompt(r.prompt)
        const branch = session.info().worktree?.branch
        await routines
          .noteRun({
            routineId: r.id,
            name: r.name,
            sessionId: session.id,
            at: new Date().toISOString(),
            ...(branch ? { branch } : {}),
          })
          .catch(() => undefined)
      },
    },
  })
  phoneHolder.svc = phone
  // Push through ntfy: outbound only. Refused answers are recorded; good ones are recorded by the decision itself.
  // A server that needs a sign-in has its token or password sealed as Slack's tokens are (owner, 4 Nov).
  const ntfySecrets = new NtfySecretStore(path.join(gatehouseDataDir(env), "ntfy.sealed"), sealer())
  const ntfy = new NtfyChannel({
    broker,
    settings: () => config.push?.ntfy,
    secret: () => ntfySecrets.load(),
    redact: (t) => redactString(t, { terms: config.redactTerms }),
    expiryMs: () => config.phoneExpiryMs,
    log,
    onChange: () => opts.onHealthChanged?.(),
    onRefused: (reason, requestId) =>
      void audit.record({
        session: "push",
        event: "push_answer_refused",
        channel: "push",
        tool: "push",
        input: { reason, ...(requestId ? { requestId } : {}) },
        verdict: {
          outcome: "deny",
          ruleId: "push-answer-refused",
          reason: `A push answer was refused: ${reason}.`,
          risk: 0,
          decidedBy: "rules",
          policyHash: store.current?.hash ?? "",
        },
        latencyMs: 0,
      }),
  })
  // Slack through Socket Mode: outbound only. Its tokens are kept with the same protection as the phone keys.
  const slackSecrets = new SlackSecretStore(
    path.join(gatehouseDataDir(env), "slack.sealed"),
    sealer(),
  )
  const slack = new SlackChannel({
    broker,
    settings: () => config.push?.slack,
    secrets: () => slackSecrets.load(),
    redact: (t) => redactString(t, { terms: config.redactTerms }),
    expiryMs: () => config.phoneExpiryMs,
    log,
    onChange: () => opts.onHealthChanged?.(),
    onRefused: (reason, requestId) =>
      void audit.record({
        session: "push",
        event: "push_answer_refused",
        channel: "push",
        tool: "slack",
        input: { reason, ...(requestId ? { requestId } : {}) },
        verdict: {
          outcome: "deny",
          ruleId: "push-answer-refused",
          reason: `A Slack answer was refused: ${reason}.`,
          risk: 0,
          decidedBy: "rules",
          policyHash: store.current?.hash ?? "",
        },
        latencyMs: 0,
      }),
  })
  // Updates. Packaged, the Host runs from <install>\app, so the install folder is the one above it.
  const installDir = env.GATEHOUSE_PACKAGED === "1" ? path.dirname(REPO_ROOT) : undefined
  const updateToken = new UpdateTokenStore(
    path.join(gatehouseDataDir(env), "update-token.sealed"),
    sealer(),
  )
  // Test hooks only: a local stand-in for GitHub and the key its releases are signed with. Both must be set.
  const testBase = env.GATEHOUSE_UPDATE_BASE
  const testKey =
    testBase && env.GATEHOUSE_UPDATE_KEY_FILE
      ? fs.readFileSync(env.GATEHOUSE_UPDATE_KEY_FILE, "utf8")
      : undefined
  if (testBase) log(`updates come from ${testBase} (a test setting)`)
  const updateSource = new GitHubSource({
    token: () => updateToken.get(),
    ...(testBase ? { base: testBase } : {}),
  })
  // The changelog in Settings: read from the same releases, only when Settings asks, and kept for offline.
  const changelog = new ChangelogStore({
    file: path.join(gatehouseDataDir(env), "updates", "changelog.json"),
    fetch: () => updateSource.changelog(),
  })
  const updates = new UpdateService({
    installDir,
    sourceVersion: installDir ? "0.0.0-source" : sourceVersion(),
    dir: path.join(gatehouseDataDir(env), "updates"),
    source: updateSource,
    ...(testKey ? { keys: [testKey] } : {}),
    settings: () => {
      const u = config.updates ?? { checkEveryMinutes: 30, skipped: [], downloadInBackground: true }
      return {
        checkEveryMinutes: u.checkEveryMinutes,
        downloadInBackground: u.downloadInBackground,
        skipped: u.skipped,
      }
    },
    saveSettings: async (u) => {
      const file = configPath(env)
      const saved = fs.existsSync(file)
        ? (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>)
        : {}
      saved.updates = { ...((saved.updates as object | undefined) ?? {}), ...u }
      const parsed = GatehouseConfigSchema.parse(saved) as GatehouseConfig
      fs.mkdirSync(path.dirname(file), { recursive: true })
      await writeFileAtomic(file, JSON.stringify(parsed, null, 2) + "\n")
      ;(config as { updates?: GatehouseConfig["updates"] }).updates = parsed.updates
    },
    audit: async (event, input) => {
      await audit.record({
        session: "desktop",
        event,
        channel: "desktop",
        tool: "updates",
        input,
        verdict: {
          outcome: "allow",
          ruleId: event.replace(/_/g, "-"),
          reason: "An update to Codehouse itself, not a tool call.",
          risk: 0,
          decidedBy: "human-desktop",
          policyHash: store.current?.hash ?? "",
        },
        latencyMs: 0,
      })
    },
    log,
    tokenSet: () => updateToken.get() !== undefined,
  })
  const localRelay = new LocalRelay({
    command: process.execPath,
    args: childArgs("relay"),
    cwd: REPO_ROOT,
    dataDir: path.join(gatehouseDataDir(env), "relay"),
    log,
    enrol: (url, token) => phone.setup(url, token, os.hostname()),
    linked: () => phoneStore.relay() !== undefined,
  })
  // The daily digest goes to the phone once a day after the chosen time (default 08:00). Off if digestTime is null.
  const digest = new DigestScheduler({
    time: () => (config.digestTime === null ? null : (config.digestTime ?? "08:00")),
    stateFile: path.join(gatehouseDataDir(env), "digest.json"),
    log,
    send: async () => {
      if (phone.health().state === "not-configured" || phone.listPhones().length === 0) return false
      const to = Date.now()
      const cost = usage.snapshot().byDay[localDay(new Date(to))]?.costUsd ?? 0
      const d = computeDigest(recordsSince(dir, to - 86_400_000), to - 86_400_000, to, cost)
      await phone.notify("info", { title: "Codehouse digest", body: d.text, project: "Codehouse" })
      return true
    },
  })
  // B36: each decision as an OpenTelemetry span, to a file or a collector on this computer, when Settings say so.
  const telemetry = new Telemetry({
    dir: path.join(gatehouseDataDir(env), "telemetry"),
    settings: () => config.telemetry,
    log,
  })
  manager.on("event", ({ sessionId, type, data }) => {
    if (type !== "decision") return
    telemetry.span({
      name: "codehouse.decision",
      session: sessionId,
      outcome: String(data.outcome ?? ""),
      rule: String(data.ruleId ?? ""),
      risk: Number(data.risk ?? 0),
      decidedBy: String(data.decidedBy ?? ""),
    })
  })
  // Your answers and the floor's blocks, which the Host itself records.
  audit.listeners.add((r) => {
    if (!r.verdict.decidedBy.startsWith("human") && r.verdict.decidedBy !== "floor") return
    telemetry.span({
      name: "codehouse.decision",
      session: r.session,
      outcome: r.verdict.outcome,
      rule: r.verdict.ruleId,
      risk: r.verdict.risk,
      decidedBy: r.verdict.decidedBy,
      tool: r.tool,
      channel: r.channel,
      latencyMs: r.latencyMs,
    })
  })
  // A finished session or a note from Claude reaches the phone as a sealed message, never as plain text (invariant 9).
  manager.on("event", ({ sessionId, type, data }) => {
    const info = manager.get(sessionId)?.info()
    const project = info?.project ?? "a session"
    if (type === "notify_user" && typeof data.text === "string")
      void phone
        .notify("notify", { title: "Claude", body: String(data.text), project })
        .catch(() => undefined)
    else if (type === "queue_empty") {
      void phone
        .notify("notify", {
          title: "Build queue empty",
          body: "Claude has finished its queue.",
          project,
        })
        .catch(() => undefined)
      void ntfy.note("build queue empty", "Claude has finished its queue.", project)
      // D-002: when a session says it is done, its project's held-out checks run, if it has any; the counts only
      // reach it. A failure here is logged without the checks' names or output.
      const s = manager.get(sessionId)
      if (s)
        void heldOut
          .summary(s.project)
          .then((x) =>
            x.count && x.command ? runHeldOutFor(s, heldOut, audit, "queue-empty", actionFor(s.id)) : undefined,
          )
          .catch((e: Error) => log(`held-out checks could not run: ${e.message.slice(0, 200)}`))
    } else if (type === "risk_budget_exhausted") {
      // D-018: the risk budget is spent: the phone and push channels are told.
      const body = data.extreme
        ? "Its risk budget is spent, so Extreme approval paused it until you start it again."
        : "Its risk budget is spent, so it went back to Manual."
      void phone.notify("notify", { title: "Risk budget spent", body, project }).catch(() => undefined)
      void ntfy.note("risk budget spent", body, project)
    } else if (type === "carry_on_end" || type === "stuck") {
      // O16: the end of an Extreme run, and a turn that may be stuck, reach your phone too. A run that ended because
      // the queue is empty is told above, and one you stopped needs no telling.
      const words = noteFor(type, data)
      if (words) {
        void phone.notify("notify", { ...words, project }).catch(() => undefined)
        void ntfy.note(words.title.toLowerCase(), words.body, project)
      }
    } else if (type === "stop")
      void phone
        .notify("stop", { title: "Session finished", body: "", project })
        .catch(() => undefined)
    // G32: what was said changed, so the phone's view of it is shared again soon.
    if (type === "stop" || type === "queue_empty") phoneSessions.poke()
  })
  // G32 (O18, owner 30 Oct): the sessions on the phone, read only, redacted and sealed to each phone; only while one
  // is paired.
  const phoneSessions = new PhoneSessionsSharer({
    build: () =>
      buildPhoneSessions({
        list: () => manager.list(),
        messages: (sdkSessionId, cwd) => history.allMessages(sdkSessionId, cwd),
        redact: (t) => redactString(t, { terms: config.redactTerms }),
        templates: () =>
          routines
            .list()
            .filter((r) => r.phone === true)
            .map((r) => ({ id: r.id, name: r.name })),
      }),
    share: (s) => phone.shareSessions(s),
    wanted: () => phoneStore.relay() !== undefined && phoneStore.phones().length > 0,
    log,
  })
  manager.on("session", () => phoneSessions.poke())
  phoneSessions.start()

  const health = (): Health => {
    const acct = account.last()
    const ks = kill.status()
    const policy = store.status()
    return {
      approver: {
        state: approverProcess?.state ?? (spawnApprover ? "stopped" : "up"),
        ...(policy.hash ? { policyHash: policy.hash } : {}),
        errors: policy.errors,
      },
      relay: phone.health(),
      push: [
        ...(ntfy.status().enabled
          ? [{ channel: "ntfy" as const, ok: ntfy.status().listening }]
          : []),
        ...(slack.status().enabled
          ? [{ channel: "slack" as const, ok: slack.status().connected }]
          : []),
      ],
      accounts: accounts.all().map((a) => {
        const s = accounts.monitor(a.id).last()
        return {
          id: a.id,
          label: a.label,
          signedIn: s?.signedIn ?? false,
          ...(s?.email ? { email: s.email } : {}),
          ...(s?.organization ? { organization: s.organization } : {}),
          ...(a.expectedOrg ? { expectedOrg: a.expectedOrg } : {}),
          orgOk: s?.org.ok ?? false,
        }
      }),
      signin: {
        signedIn: acct?.signedIn ?? false,
        ...(acct?.email ? { email: acct.email } : {}),
        ...(acct?.organization ? { organization: acct.organization } : {}),
        managedPolicy: acct?.managedPolicy ?? "unknown",
        orgOk: acct?.org.ok ?? false,
        checked: acct !== undefined,
        ...(acct && !acct.org.ok ? { orgMessage: acct.org.message } : {}),
      },
      killSwitch: {
        engaged: ks.engaged,
        ...(ks.since ? { since: ks.since } : {}),
        ...(ks.by ? { by: ks.by } : {}),
        approverConfirmed: ks.approverConfirmed,
      },
      pwsh: {
        running: pwsh.running,
        ...(pwsh.languageMode ? { languageMode: pwsh.languageMode } : {}),
      },
    }
  }

  const signIn = new SignInFlow({
    binary: findClaudeBinary,
    onEnded: async () => {
      await account.refresh()
      opts.onHealthChanged?.()
    },
  })
  // Several accounts at once (owner, 30 Oct): the main one is the sign-in above; each added one has its own folder.
  const accounts = new Accounts({
    saved: () => (config.accounts ?? []) as AccountEntry[],
    save: async (list) => {
      const file = configPath(env)
      const saved = fs.existsSync(file)
        ? (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>)
        : {}
      saved.accounts = list
      const parsed = GatehouseConfigSchema.parse(saved) as GatehouseConfig
      fs.mkdirSync(path.dirname(file), { recursive: true })
      await writeFileAtomic(file, JSON.stringify(parsed, null, 2) + "\n")
      ;(config as { accounts?: GatehouseConfig["accounts"] }).accounts = parsed.accounts
    },
    mainExpectedOrg: () => config.expectedOrg,
    dataDir: gatehouseDataDir(env),
    queryFn,
    probeOptions,
    managedDetected,
    mainMonitor: account,
    mainSignIn: signIn,
    onSignedIn: () => opts.onHealthChanged?.(),
  })
  deps.accounts = accounts

  terminal = new TerminalManager({
    audit,
    killed: () => kill.isEngaged(),
    policyHash: () => store.current?.hash ?? "none",
    log,
    env,
  })

  // The marketplace (W1-19): the main account's Claude Code, with no credential in its environment.
  const marketplace = new Marketplace(binaryRunner(findClaudeBinary, () => accounts.env()))
  // B39: a plugin's evaluation runs as normal sessions in Plan mode, with the plugin and without it.
  const evals = new PluginEvaluator({
    store: new EvalStore(path.join(gatehouseDataDir(env), "plugin-evals.json")),
    start: (o) => manager.start(o),
    enabled: async (id) => {
      try {
        const e = await marketplace.entry(id)
        return e.installed?.enabled === true
      } catch {
        return undefined
      }
    },
    audit,
    policyHash: () => store.current?.hash ?? "",
    log,
  })

  const app: HostApp = {
    updates,
    manager,
    terminal,
    signIn,
    accounts,
    broker,
    kill,
    checkpoints,
    usage,
    account,
    limits: limitPauser,
    heldOut,
    heldOutExec: actionFor,
    locks,
    governor,
    audit,
    engine,
    policy: () => store.current,
    pwsh,
    health,
    expectedOrg: () => config.expectedOrg,
    admin: {
      engine,
      store,
      pwsh,
      audit,
      auditDir: dir,
      loadOptions,
      untrustedMention: (rule) => manager.liveSessions().map((s) => s.untrustedMention(rule)).find(Boolean),
      env,
      config: () => config,
      log,
      phone,
      usage,
      pickFolder: (start) => {
        if (process.platform === "darwin") return pickFolderWithMac(start) // Mac fork
        const exe = helper()
        return exe ? helperPickers(exe).pickFolder(start) : pickFolderWithWindows(start)
      },
      saveAs: (name) => {
        if (process.platform === "darwin") return saveAsWithMac(name) // Mac fork
        const exe = helper()
        return exe ? helperPickers(exe).saveAs(name) : saveAsWithWindows(name)
      },
      localRelay,
      ntfy,
      ntfySecrets,
      sessionCwd: (id) => manager.get(id)?.cwd,
      sessionWrote: (id, abs) => manager.get(id)?.wrote(abs) ?? false,
      chat: { store: chatStore, recorder: chatRecorder },
      sessionMemory: (id) => manager.get(id)?.memoryGiven(),
      // While you were away, written by Claude (owner, 4 Nov): redacted first, no tools, audited, and only when the
      // signed-in account passed the organisation check (invariant 14).
      recap: {
        writer: createRecapWriter(),
        enabled: () => config.recapByClaude !== false,
        session: (id) => {
          const i = manager.get(id)?.info()
          return i ? { project: i.project, ...(i.local ? { local: true } : {}) } : undefined
        },
        orgOk: () => account.last()?.org.ok === true,
        redact: (t) => redactString(t, { terms: config.redactTerms }),
        audit,
        policyHash: () => store.current?.hash ?? "",
      },
      // /btw (owner, 4 Nov): the same limits as the recap, asked for by you, so not turned off with it.
      btw: {
        writer: createBtwWriter(),
        session: (id) => {
          const i = manager.get(id)?.info()
          return i ? { project: i.project, ...(i.local ? { local: true } : {}) } : undefined
        },
        orgOk: () => account.last()?.org.ok === true,
        redact: (t) => redactString(t, { terms: config.redactTerms }),
        audit,
        policyHash: () => store.current?.hash ?? "",
      },
      projects,
      memory,
      routines,
      // G24: a card moved to Running starts a normal session in its folder, with its prompt.
      board: {
        store: board,
        start: async (card) => {
          const session = await manager.start({ cwd: card.folder, mode: "default" })
          session.prompt(card.prompt)
          return session.id
        },
      },
      artifacts,
      prompts,
      marketplace,
      evals,
      planUsage: (account, fresh) => manager.planUsage(account, fresh),
      // The open window through Codehouse-Helper.exe; PowerShell only where the helper cannot be had (owner, 4 Nov).
      pickFiles: () => {
        const exe = helper()
        return exe
          ? helperPickers(exe).openFiles({ many: true, title: "Add files or photos" })
          : pickFilesWithWindows()
      },
      // CH-07: Continue locally. The chat starts like any other (the organisation guard, Plan mode, the floor and the
      // Approver), with the seed you saw in its instructions.
      chatContinue: {
        store: chatStore,
        options: () => ({ ...DEFAULT_SEED, ...(config.chatContinue ?? {}) }),
        redact: (t) => redactString(t, { terms: config.redactTerms }),
        summarise: createSummariser(),
        start: async (o) =>
          (
            await manager.start({
              cwd: "chat",
              kind: "chat",
              mode: "plan",
              title: o.title,
              instructions: o.seed,
              forkOf: o.forkOf,
            })
          ).id,
        audit,
        policyHash: () => store.current?.hash ?? "",
      },
      // CH-06: Open in Claude, in a separate program; nothing is read back.
      chatHandoff: {
        store: chatStore,
        settings: () => config.chatHandoff ?? {},
        launcher: process.platform === "darwin" ? macLauncher : realLauncher(helper), // Mac fork
        findEdge: () => findEdge(),
        hasAppLink: () => hasAppLink(),
        audit,
        policyHash: () => store.current?.hash ?? "",
      },
      // CH-04: importing a claude.ai export, the zip chosen in the open window and nowhere else.
      chatImport: {
        store: chatStore,
        pickZip: async () => {
          const exe = helper()
          const picked = exe
            ? await helperPickers(exe).openFiles({
                many: false,
                title: "Choose your claude.ai export",
                filter: "claude.ai export (*.zip)|*.zip",
              })
            : (await pickFilesWithWindows()).filter((f) => f.toLowerCase().endsWith(".zip"))
          return picked[0]
        },
        audit,
        policyHash: () => store.current?.hash ?? "",
        tmpDir: os.tmpdir(),
      },
      updates,
      changelog,
      // G30: the verifier that goes in each audit bundle (scripts\verify-audit.ps1, in the app folder too).
      auditVerifier: path.join(REPO_ROOT, "scripts", "verify-audit.ps1"),
      health,
      claude: () => claudeVersion(findClaudeBinary),
      worktrees,
      // A worktree in use by a running session is not removed from under it.
      openIn: (folder) =>
        manager
          .list()
          .some(
            (i) =>
              i.state !== "ended" &&
              path.resolve(i.cwd).toLowerCase() === path.resolve(folder).toLowerCase(),
          ),
      updateToken,
      slack: {
        status: () => slack.status(),
        start: () => slack.start(),
        stop: () => slack.stop(),
        test: () => slack.test(),
        saveSecrets: (v) => slackSecrets.save(v),
        forgetSecrets: () => slackSecrets.forget(),
      },
      ...(spawnApprover
        ? {
            approver: {
              state: () => approverProcess?.state ?? "stopped",
              restart: async () => {
                if (!approverProcess) throw new Error("the Approver has not started yet")
                await approverProcess.stop()
                await approverProcess.start()
                await kill.syncApprover()
                opts.onHealthChanged?.()
              },
            },
          }
        : {}),
    },
    phone,
    listHistory: (d) => history.list(d),
    history,
    log,
  }

  return {
    app,
    updates,
    config,
    get approverProcess() {
      return approverProcess
    },
    store,
    pwsh,
    async start() {
      const step = opts.onProgress ?? (() => undefined)
      fs.mkdirSync(gatehouseDataDir(env), { recursive: true })
      step("Loading your rules")
      store.load()
      try {
        phoneStore.load()
        phone.start()
        digest.start()
      } catch (e) {
        log(`phone settings did not load (${(e as Error).message}), the phone channel is off`)
      }
      if (store.status().errors.length > 0)
        log(`policy did not load: ${store.status().errors.join("; ")}`)
      store.watch()
      step("Starting the PowerShell checker")
      await pwsh
        .start()
        .catch((e) =>
          log(
            `PowerShell parser did not start (${(e as Error).message}), PowerShell calls will escalate`,
          ),
        )
      if (spawnApprover) {
        step("Starting the Approver, which decides requests")
        const port = await approverPortPromise
        approverProcess = new ApproverProcess({
          command: process.execPath,
          args: childArgs("approver"),
          cwd: REPO_ROOT,
          env: {
            GATEHOUSE_RULES_PATH: rulesPath,
            GATEHOUSE_LOCAL_RULES: localRules,
            GATEHOUSE_OVERLAY_DIR: loadOptions.overlayDir,
            GATEHOUSE_LIBRARY_DIR: loadOptions.libraryDir,
            GATEHOUSE_USER_RULES: loadOptions.userRulesPath,
            GATEHOUSE_AUDIT_DIR: dir,
          },
          token: approverToken,
          port,
          onLog: (l) => log(`approver: ${l}`),
        })
        await approverProcess.start()
        approverUrl = approverProcess.url
        approverClient = new ApproverClient({
          url: approverUrl,
          token: approverToken,
          timeoutMs: approverTimeout,
        })
      }
      await kill.syncApprover()
      step("Connecting notifications and updates")
      ntfy.start()
      await updateToken.load()
      updates.start()
      void slack.start()
      // The Relay inside Codehouse starts with it when you turned it on. A failure only shows on Devices.
      if (config.localRelay?.enabled)
        void localRelay
          .start(config.localRelay.publicUrl, config.localRelay.port)
          .then((st) =>
            st.state === "failed"
              ? log(`relay inside Codehouse did not start: ${st.message ?? ""}`)
              : undefined,
          )
      // Each added account's sign-in is checked in the background, as the main one's is.
      for (const a of accounts.all().slice(1))
        void accounts
          .monitor(a.id)
          .refresh()
          .then(() => opts.onHealthChanged?.())
          .catch(() => undefined)
      limitPauser.start()
      // B34: each routine through the same path as any session: kill switch, sign-in, organisation, limits.
      const runRoutine = async (r: Routine): Promise<string> => {
        const why =
          r.trigger?.kind === "commit"
            ? "a new commit in its folder"
            : r.trigger?.kind === "files"
              ? "files in its folder changing"
              : "its time"
        const recorded = await audit.record({
          session: "desktop",
          event: "routine_run",
          channel: "host",
          tool: "routines",
          cwd: r.folder,
          input: { id: r.id, name: r.name, ...(r.trigger ? { trigger: r.trigger.kind } : {}) },
          verdict: {
            outcome: "allow",
            ruleId: "routine-run",
            reason: `The routine ${r.name} started at ${why}.`,
            risk: 0,
            decidedBy: "rules",
            policyHash: store.current?.hash ?? "",
          },
          latencyMs: 0,
        })
        if (!recorded) throw new Error("it could not be recorded, so it did not start")
        const session = await manager.start(routineSessionOptions(r))
        session.prompt(r.prompt)
        // G23: kept for the review inbox in Settings; a run that cannot be noted still runs.
        const branch = session.info().worktree?.branch
        await routines
          .noteRun({
            routineId: r.id,
            name: r.name,
            sessionId: session.id,
            at: new Date().toISOString(),
            ...(branch ? { branch } : {}),
          })
          .catch((e: Error) => log(`routine run not noted: ${e.message}`))
        return session.id
      }
      new RoutineScheduler({ store: routines, log, start: runRoutine }).start()
      // And those started by a new commit or by files changing, never by their own session's work.
      routineTriggers = new TriggerWatcher({
        list: () => routines.list(),
        start: runRoutine,
        working: (id) => {
          const st = manager.get(id)?.info().state
          return st === "running" || st === "waiting"
        },
        log,
      })
      routineTriggers.start()
      // In the background: the window opens at once and each session appears as it comes back.
      if (openSessions)
        void restoreOpenSessions(openSessions, {
          start: (o) => manager.start(o),
          expect: (o) => manager.expect(o),
          killed: () => kill.isEngaged(),
          log,
          audit: (o) =>
            audit.record({
              session: o.id,
              event: "session_restored",
              channel: "host",
              tool: "session",
              cwd: o.cwd,
              input: {
                mode: o.mode,
                extreme: o.extreme,
                resumed: o.sdkSessionId !== undefined,
                wasRunning: o.running,
              },
              verdict: {
                outcome: "allow",
                ruleId: "session-restored",
                reason:
                  "Codehouse brought this session back after it restarted, with the settings it had.",
                risk: 0,
                decidedBy: "rules",
                policyHash: store.current?.hash ?? "",
              },
              latencyMs: 0,
            }),
        }).then((n) => (n ? log(`brought back ${n} open session(s)`) : undefined))
    },
    async stop() {
      // First, so the sessions closed below come back next time.
      await openSessions?.freeze()
      limitPauser.stop()
      routineTriggers?.stop()
      ntfy.stop()
      updates.stop()
      slack.stop()
      await localRelay.stop()
      digest.stop()
      phone.stop()
      await manager.closeAll()
      await usage.flush()
      await approverProcess?.stop()
      store.close()
      pwsh.close()
    },
  }
}

/** The version shown when Codehouse runs from its source folder: major.minor from package.json, the commit count, -source. */
function sourceVersion(): string {
  let mm = "1.0"
  try {
    const v = (
      JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as {
        version?: string
      }
    ).version
    const m = /^(\d+)\.(\d+)\./.exec(v ?? "")
    if (m) mm = `${m[1]}.${m[2]}`
  } catch {
    // keep 1.0
  }
  let count = "0"
  try {
    count = execFileSync("git", ["rev-list", "--count", "HEAD"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
    }).trim()
  } catch {
    // not a git folder
  }
  return `${mm}.${/^\d+$/.test(count) ? count : "0"}-source`
}
