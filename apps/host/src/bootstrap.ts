import fs from "node:fs"
import { pickFilesWithWindows } from "./attach-api.js"
import { SlackChannel, SlackSecretStore } from "./push/slack.js"
import { NtfyChannel } from "./push/ntfy.js"
import os from "node:os"
import { LocalRelay } from "./relay/local.js"
import { pickFolderWithWindows } from "./folder-picker.js"
import { findClaudeBinary, SignInFlow } from "./signin.js"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { listSessions, query, resolveSettings } from "@anthropic-ai/claude-agent-sdk"
import { PolicyEngine, PolicyStore, PwshWorker, redact, redactString } from "@gatehouse/policy"
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
} from "@gatehouse/shared/node"
import { AccountMonitor, type QueryFn } from "./account.js"
import { ApproverClient } from "./approver-client.js"
import { ApproverProcess, freePort, generateToken } from "./approver-process.js"
import { Broker } from "./broker.js"
import { CheckpointManager } from "./checkpoints.js"
import { createCompanionSdkServer } from "./companion-server.js"
import { denyOutput } from "./hooks.js"
import { HostAudit } from "./hostaudit.js"
import { computeDigest } from "./analytics.js"
import { recordsSince } from "./api.js"
import { DigestScheduler } from "./digest.js"
import { HostKillSwitch } from "./kill.js"
import { DpapiProtector, PlainProtector, type Protector } from "./relay/protector.js"
import { PhoneService } from "./relay/service.js"
import { PhoneStore } from "./relay/store.js"
import type { HostApp } from "./server.js"
import { SessionManager, type SessionDeps } from "./sessions.js"
import { localDay, UsageStore } from "./usage.js"
import { UpdateService } from "./update/service.js"
import { GitHubSource } from "./update/source.js"
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
 * How to start another JCVC program as a Node child: its built file when the package has one (apps/<name>/dist/
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
    ...(config.workspaceRoots ? { workspaceRootsOverride: config.workspaceRoots } : {}),
  }

  const store = new PolicyStore(loadOptions)
  const pwsh = new PwshWorker()
  const engine = new PolicyEngine({ getPolicy: () => store.current, pwsh })
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
  // 5 seconds, or 35 while the policy has the judge on (its own limit is 25). Still bounded, still fail-closed.
  const approverTimeout = (): number =>
    store.current?.rules.defaults?.judge?.enabled === true ? 35_000 : 5_000
  const usage = new UsageStore(path.join(gatehouseDataDir(env), "usage.json"))
  const checkpoints = new CheckpointManager({
    config: () => config,
    policy: () => store.current,
    log,
  })

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
  const kill = new HostKillSwitch({
    broker,
    audit,
    approver: { setKillSwitch: (e, by, reason) => approverClient.setKillSwitch(e, by, reason) },
    interruptAll: () => manager.interruptAll(),
    env,
    log,
  })

  const queryFn: QueryFn = opts.queryFn ?? (query as unknown as QueryFn)
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

  const deps: SessionDeps = {
    queryFn,
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
    account,
    companion: ({ sessionId, cwd }) => ({
      companion: createCompanionSdkServer({
        sessionId,
        cwd,
        // notify_user reaches the desktop through the session's event stream. The phone path is added with the relay.
        host: { notify: async (m) => (manager.notify(m.sessionId, m.text), true) },
        policy: () => store.current,
        redact: (v) => redact(v, { terms: config.redactTerms }),
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
  manager = new SessionManager(deps)

  const phoneStore = new PhoneStore(
    path.join(gatehouseDataDir(env), "phone.json"),
    opts.phoneProtector ??
      (process.platform === "win32" ? new DpapiProtector() : new PlainProtector()),
  )
  const phone = new PhoneService({ store: phoneStore, broker, kill, audit, log })
  phoneHolder.svc = phone
  // Push through ntfy: outbound only. Refused answers are recorded; good ones are recorded by the decision itself.
  const ntfy = new NtfyChannel({
    broker,
    settings: () => config.push?.ntfy,
    redact: (t) => redactString(t, { terms: config.redactTerms }),
    expiryMs: () => config.phoneExpiryMs,
    log,
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
    opts.phoneProtector ??
      (process.platform === "win32" ? new DpapiProtector() : new PlainProtector()),
  )
  const slack = new SlackChannel({
    broker,
    settings: () => config.push?.slack,
    secrets: () => slackSecrets.load(),
    redact: (t) => redactString(t, { terms: config.redactTerms }),
    expiryMs: () => config.phoneExpiryMs,
    log,
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
    opts.phoneProtector ??
      (process.platform === "win32" ? new DpapiProtector() : new PlainProtector()),
  )
  // Test hooks only: a local stand-in for GitHub and the key its releases are signed with. Both must be set.
  const testBase = env.GATEHOUSE_UPDATE_BASE
  const testKey =
    testBase && env.GATEHOUSE_UPDATE_KEY_FILE
      ? fs.readFileSync(env.GATEHOUSE_UPDATE_KEY_FILE, "utf8")
      : undefined
  if (testBase) log(`updates come from ${testBase} (a test setting)`)
  const updates = new UpdateService({
    installDir,
    sourceVersion: installDir ? "0.0.0-source" : sourceVersion(),
    dir: path.join(gatehouseDataDir(env), "updates"),
    source: new GitHubSource({
      token: () => updateToken.get(),
      ...(testBase ? { base: testBase } : {}),
    }),
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
          reason: "An update to JCVC itself, not a tool call.",
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
      await phone.notify("info", { title: "JCVC digest", body: d.text, project: "JCVC" })
      return true
    },
  })
  // A finished session or a note from Claude reaches the phone as a sealed message, never as plain text (invariant 9).
  manager.on("event", ({ sessionId, type, data }) => {
    const info = manager.get(sessionId)?.info()
    const project = info?.project ?? "a session"
    if (type === "notify_user" && typeof data.text === "string")
      void phone
        .notify("notify", { title: "Claude", body: String(data.text), project })
        .catch(() => undefined)
    else if (type === "stop")
      void phone
        .notify("stop", { title: "Session finished", body: "", project })
        .catch(() => undefined)
  })

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
      signin: {
        signedIn: acct?.signedIn ?? false,
        ...(acct?.email ? { email: acct.email } : {}),
        ...(acct?.organization ? { organization: acct.organization } : {}),
        managedPolicy: acct?.managedPolicy ?? "unknown",
        orgOk: acct?.org.ok ?? false,
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

  const app: HostApp = {
    updates,
    manager,
    signIn,
    broker,
    kill,
    checkpoints,
    usage,
    account,
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
      env,
      config: () => config,
      log,
      phone,
      usage,
      pickFolder: pickFolderWithWindows,
      localRelay,
      ntfy,
      sessionCwd: (id) => manager.get(id)?.cwd,
      pickFiles: pickFilesWithWindows,
      updates,
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
    listHistory: async (d) => listSessions({ ...(d ? { dir: d } : {}), limit: 50 }),
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
      // The Relay inside JCVC starts with it when you turned it on. A failure only shows on Devices.
      if (config.localRelay?.enabled)
        void localRelay
          .start(config.localRelay.publicUrl, config.localRelay.port)
          .then((st) =>
            st.state === "failed"
              ? log(`relay inside JCVC did not start: ${st.message ?? ""}`)
              : undefined,
          )
    },
    async stop() {
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

/** The version shown when JCVC runs from its source folder: major.minor from package.json, the commit count, -source. */
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
