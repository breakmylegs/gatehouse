import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ApproverServer } from "../../approver/src/server.js"
import { PolicyEngine, PolicyStore, redact } from "@gatehouse/policy"
import { AuditWriter, listAuditFiles, type AuditRecord } from "@gatehouse/shared/audit"
import { GatehouseConfig as GatehouseConfigSchema, type GatehouseConfig } from "@gatehouse/shared/node"
import { SEED_RULES } from "../../../packages/policy/test/helpers.js"
import { AccountMonitor, neverYields } from "../src/account.js"
import { ApproverClient } from "../src/approver-client.js"
import { Broker } from "../src/broker.js"
import { CheckpointManager } from "../src/checkpoints.js"
import { createCompanionSdkServer } from "../src/companion-server.js"
import { HostAudit } from "../src/hostaudit.js"
import { HostKillSwitch } from "../src/kill.js"
import { SessionManager, type SessionDeps } from "../src/sessions.js"
import { UsageStore } from "../src/usage.js"
import { FakeSdk } from "./fake-sdk.js"

export interface StackOptions {
  hardTimeoutMs?: number
  phoneExpiryMs?: number
  expectedOrg?: string | null
  /** Start no Approver at all, so the client cannot reach one. */
  approverDown?: boolean
  config?: Record<string, unknown>
}

export interface Stack {
  sdk: FakeSdk
  repo: string
  dir: string
  auditDir: string
  localRules: string
  statePath: string
  approverServer: ApproverServer | undefined
  approver: ApproverClient
  broker: Broker
  audit: HostAudit
  kill: HostKillSwitch
  manager: SessionManager
  usage: UsageStore
  checkpoints: CheckpointManager
  account: AccountMonitor
  store: PolicyStore
  logs: string[]
  deps: SessionDeps
  records(): AuditRecord[]
  git(...args: string[]): string
  waitForPending(n?: number, ms?: number): Promise<void>
  pendingId(index?: number): string
  stop(): Promise<void>
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
  }).trim()

export async function buildStack(opts: StackOptions = {}): Promise<Stack> {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-stack-")))
  const repo = path.join(dir, "proj")
  fs.mkdirSync(path.join(repo, "src"), { recursive: true })
  git(repo, "init", "-q")
  fs.writeFileSync(path.join(repo, "README.md"), "# proj\n")
  fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1\n")
  fs.writeFileSync(path.join(repo, ".env"), "SECRET=1\n")
  fs.writeFileSync(path.join(repo, ".gitignore"), ".env\n")
  git(repo, "add", ".")
  git(repo, "commit", "-q", "-m", "init")

  const rulesPath = path.join(dir, "rules.yaml")
  fs.copyFileSync(SEED_RULES, rulesPath)
  const localRules = path.join(dir, "rules.local.yaml")
  const auditDir = path.join(dir, "audit")
  const statePath = path.join(dir, "state.json")
  const env = { ...process.env, GATEHOUSE_STATE: statePath }
  const logs: string[] = []
  const log = (l: string) => logs.push(l)
  const fwd = repo.replace(/\\/g, "/")

  const parsed = GatehouseConfigSchema.parse({
    ...(opts.expectedOrg === null ? {} : { expectedOrg: opts.expectedOrg ?? "ACN - Premium" }),
    ...opts.config,
  })
  // The schema refuses timeouts under 10 seconds, which is right for real use but too slow for tests.
  const config: GatehouseConfig = {
    ...parsed,
    hardTimeoutMs: opts.hardTimeoutMs ?? parsed.hardTimeoutMs,
    phoneExpiryMs: opts.phoneExpiryMs ?? parsed.phoneExpiryMs,
  }

  const loadOpts = { rulesPath, localPath: localRules, workspaceRootsOverride: [fwd] }
  const store = new PolicyStore(loadOpts)
  store.load()
  const engine = new PolicyEngine({ getPolicy: () => store.current })

  let approverServer: ApproverServer | undefined
  let approverUrl = "http://127.0.0.1:9/mcp"
  const token = "s".repeat(24) + "-stack-test-token-" + "k".repeat(8)
  if (!opts.approverDown) {
    approverServer = new ApproverServer({
      token,
      port: 0,
      rules: loadOpts,
      auditDir,
      pwsh: undefined,
      watchRules: true,
      env,
      promptCwd: repo,
    })
    const port = await approverServer.start()
    approverUrl = `http://127.0.0.1:${port}/mcp`
  }
  const approver = new ApproverClient({ url: approverUrl, token, timeoutMs: 3000 })

  const audit = new HostAudit(new AuditWriter({ dir: auditDir, redact: (v) => redact(v) }), log)
  const broker = new Broker({
    phoneExpiryMs: config.phoneExpiryMs,
    hardTimeoutMs: config.hardTimeoutMs,
    redact: (v) => redact(v),
  })
  const sdk = new FakeSdk()
  const usage = new UsageStore(path.join(dir, "usage.json"))
  const checkpoints = new CheckpointManager({ config: () => config, policy: () => store.current, log })

  let manager!: SessionManager
  const kill = new HostKillSwitch({
    broker,
    audit,
    approver,
    interruptAll: () => manager.interruptAll(),
    env,
    log,
  })
  const account = new AccountMonitor({
    queryFn: sdk.queryFn,
    expectedOrg: () => config.expectedOrg,
    probeOptions: () => ({}) as never,
    managedDetected: async () => false,
  })
  const deps: SessionDeps = {
    queryFn: sdk.queryFn,
    config: () => config,
    policy: () => store.current,
    engine,
    pwsh: undefined,
    audit,
    broker,
    approver,
    kill,
    usage,
    checkpoints,
    account,
    companion: ({ sessionId, cwd }) => ({
      companion: createCompanionSdkServer({
        sessionId,
        cwd,
        host: { notify: async () => true },
        policy: () => store.current,
        redact: (v) => redact(v),
      }),
    }),
    managedDetected: async () => false,
    localRulesPath: localRules,
    log,
  }
  manager = new SessionManager(deps)
  void neverYields

  const records = (): AuditRecord[] =>
    listAuditFiles(auditDir).flatMap((f) =>
      fs
        .readFileSync(path.join(auditDir, f), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as AuditRecord),
    )

  return {
    sdk,
    repo,
    dir,
    auditDir,
    localRules,
    statePath,
    approverServer,
    approver,
    broker,
    audit,
    kill,
    manager,
    usage,
    checkpoints,
    account,
    store,
    logs,
    deps,
    records,
    git: (...args) => git(repo, ...args),
    async waitForPending(n = 1, ms = 10_000) {
      const end = Date.now() + ms
      while (broker.list().length < n) {
        if (Date.now() > end) throw new Error(`timed out waiting for ${n} pending request(s), have ${broker.list().length}`)
        await new Promise((r) => setTimeout(r, 10))
      }
    },
    pendingId: (index = 0) => broker.list()[index]?.request.id as string,
    async stop() {
      await manager.closeAll()
      await usage.flush()
      await approverServer?.close()
      store.close()
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
    },
  }
}
