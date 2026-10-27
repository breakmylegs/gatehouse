import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { listSessions, query, resolveSettings } from "@anthropic-ai/claude-agent-sdk"
import { PolicyEngine, PolicyStore, PwshWorker, redact } from "@gatehouse/policy"
import { sanitiseEnv, type Health } from "@gatehouse/shared"
import { AuditWriter } from "@gatehouse/shared/audit"
import {
  auditDir,
  gatehouseDataDir,
  loadConfig,
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
import { HostKillSwitch } from "./kill.js"
import type { HostApp } from "./server.js"
import { SessionManager, type SessionDeps } from "./sessions.js"
import { UsageStore } from "./usage.js"

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
}

export interface Host {
  app: HostApp
  config: GatehouseConfig
  approverProcess: ApproverProcess | undefined
  store: PolicyStore
  pwsh: PwshWorker
  start(): Promise<void>
  stop(): Promise<void>
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
  const broker = new Broker({
    phoneExpiryMs: config.phoneExpiryMs,
    hardTimeoutMs: config.hardTimeoutMs,
    quietHours: () => config.quietHours ?? store.current?.rules.quietHours,
    redact: (v) => redact(v, { terms: config.redactTerms }),
  })
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
      relay: { state: "not-configured", devices: 0 },
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

  const app: HostApp = {
    manager,
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
    admin: { engine, store, pwsh, audit, auditDir: dir, loadOptions, env, config: () => config, log },
    listHistory: async (d) => listSessions({ ...(d ? { dir: d } : {}), limit: 50 }),
    log,
  }

  return {
    app,
    config,
    get approverProcess() {
      return approverProcess
    },
    store,
    pwsh,
    async start() {
      fs.mkdirSync(gatehouseDataDir(env), { recursive: true })
      store.load()
      if (store.status().errors.length > 0)
        log(`policy did not load: ${store.status().errors.join("; ")}`)
      store.watch()
      await pwsh
        .start()
        .catch((e) =>
          log(
            `PowerShell parser did not start (${(e as Error).message}), PowerShell calls will escalate`,
          ),
        )
      if (spawnApprover) {
        const port = await approverPortPromise
        approverProcess = new ApproverProcess({
          command: process.execPath,
          args: [
            "--import",
            tsxLoaderUrl(),
            path.join(REPO_ROOT, "apps", "approver", "src", "main.ts"),
          ],
          cwd: REPO_ROOT,
          env: {
            GATEHOUSE_RULES_PATH: rulesPath,
            GATEHOUSE_LOCAL_RULES: localRules,
            GATEHOUSE_OVERLAY_DIR: loadOptions.overlayDir,
            GATEHOUSE_AUDIT_DIR: dir,
          },
          token: approverToken,
          port,
          onLog: (l) => log(`approver: ${l}`),
        })
        await approverProcess.start()
        approverUrl = approverProcess.url
        approverClient = new ApproverClient({ url: approverUrl, token: approverToken })
      }
      await kill.syncApprover()
    },
    async stop() {
      await manager.closeAll()
      await usage.flush()
      await approverProcess?.stop()
      store.close()
      pwsh.close()
    },
  }
}
