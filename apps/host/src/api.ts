import { changeSize, reviewMinutes } from "@gatehouse/shared/contracts"
import { RememberFor } from "@gatehouse/shared/ws-protocol"
import { listDevices, screenshot } from "./devices-panel.js"
import type { Listening } from "./session-ports.js"
import type { ActionResult } from "./codehouse-action.js"
import { claimCalibration, failureTaxonomy } from "./failure-taxonomy.js"
import { hotspots } from "./hotspots.js"
import { listFiles } from "./mutation.js"
import { legalDraft, personalDataMap } from "./personal-data.js"
import { deadCode } from "./dead-code.js"
import { measuredTime, outcomes } from "./outcomes.js"
import { stakeholderSummary } from "./stakeholder-summary.js"
import { findAgents, findRuntimes } from "./welcome.js"
import { listDistros } from "./wsl-projects.js"
import { checkActions, repoActions } from "./project-actions.js"
import { contextReport, projectBlocks } from "./context-efficiency.js"
import { staleInstructions } from "./stale-instructions.js"
import { glossary } from "./glossary.js"
import { TestLocks } from "./test-locks.js"
import { grantLimitsFor } from "./canuse.js"
import { createHash, randomBytes } from "node:crypto"
import { registerAttachRoutes } from "./attach-api.js"
import { registerFilesRoutes } from "./files-api.js"
import type { SlackSecrets, SlackStatus } from "./push/slack.js"
import type { Conflict } from "./conflict-check.js"
import type { CanaryRun } from "./canaries.js"
import { registerSafeModeRoutes, type SafeMode } from "./safe-mode.js"
import { registerCrashBundleRoutes } from "./crash-bundle.js"
import { registerHealthScoreRoutes } from "./health-score.js"
import { registerRedactionListRoutes, type RedactionLists } from "./redaction-lists.js"
import { ownTopic, randomTopic, type NtfySettings, type NtfyStatus } from "./push/ntfy.js"
import type { LocalRelayStatus } from "./relay/local.js"
import { registerExportRoutes } from "./export-api.js"
import { registerPromptRoutes, type PromptStore } from "./prompts.js"
import { registerMarketplaceRoutes, type Marketplace } from "./marketplace.js"
import { registerEvalRoutes, type PluginEvaluator } from "./plugin-eval.js"
import type { NtfySecretStore } from "./push/ntfy.js"
import { registerDoctorRoutes } from "./doctor.js"
import { NavigationAudit, registerShellRoutes } from "./shell-nav.js"
import { registerChatRoutes, type ChatDeps } from "./chat/api.js"
import { registerRecapRoutes, type RecapDeps } from "./recap-api.js"
import { registerTitleRoutes, type TitleDeps } from "./title-api.js"
import { registerTriageRoutes } from "./triage.js"
import { registerCnwRoutes, type CnwService } from "./cnw/service.js"
import { registerTimelineRoutes } from "./session-timeline.js"
import { applyPricing } from "./model-pricing.js"
import { registerMcpBuilderRoutes, type McpRouteDeps } from "./mcp-builder/routes.js"
import { registerForgeRoutes } from "./forge/routes.js"
import type { PrWatcher } from "./forge/watch.js"
import { registerBtwRoutes, type BtwDeps } from "./btw.js"
import { registerImportRoutes, type ImportDeps } from "./chat/import-api.js"
import { registerHandoffRoutes, type HandoffDeps } from "./chat/handoff-api.js"
import { registerContinueRoutes, type ContinueDeps } from "./chat/continue-api.js"
import { usageDrivers } from "./usage-drivers.js"
import { registerWorktreeRoutes, type Worktrees } from "./worktrees.js"
import { registerBoardRoutes, type BoardStore, type Card } from "./board.js"
import { type GitPanelContext, registerGitPanelRoutes } from "./git-panel.js"
import type { Health } from "@gatehouse/shared"
import { registerProviderRoutes } from "./providers/api.js"
import { readItModels } from "./providers/it-models.js"
import { registerHousekeepingRoutes } from "./housekeeping.js"
import { registerLibraryRoutes } from "./library-api.js"
import { registerUpdateRoutes } from "./update-api.js"
import { ChangelogStore, registerChangelogRoutes } from "./update/changelog.js"
import { makeAuditBundle } from "./audit-bundle.js"
import { sessionRecords, sessionTimeline } from "./timeline.js"
import { makeTimelineExport, type TimelineSigner } from "./timeline-export.js"
import { gatehouseDataDir, listCheckpoints } from "@gatehouse/shared/node"
import type { Updates } from "./update/service.js"
import type { UpdateTokenStore } from "./update/token.js"
import type { FolderPicker, SaveAsPicker } from "./folder-picker.js"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { FastifyInstance, FastifyReply } from "fastify"
import {
  appendRemember,
  checkRemember,
  describeManaged,
  loadPolicy,
  lockedChanges,
  managedLabel,
  managedRefusal,
  phoneAllowed,
  PolicyEngine,
  PolicyLoadError,
  readRememberEntries,
  redactString,
  removeRemember,
  replay,
  type ReplayChange,
  type LoadOptions,
  type Policy,
  type PolicyStore,
  type PwshWorker,
  type ReplayRecord,
} from "@gatehouse/policy"
import { anchorsDirFor, AuditRecord, listAuditFiles, verifyAudit } from "@gatehouse/shared/audit"
import type { AnchorService } from "./anchors.js"
import type { EvidenceStore } from "./evidence.js"
import { AuditIndex, TEMPLATES, type QueryTemplate } from "./audit-index.js"
import { rebuildAt } from "./rebuild.js"
import { revealInExplorer } from "./files-api.js"
import {
  configPath,
  GatehouseConfig,
  managedPolicyDir,
  unknownConfigKeys,
  writeFileAtomic,
} from "@gatehouse/shared/node"
import {
  computeAnalytics,
  computeDigest,
  groupApprovals,
  type SuggestionCandidate,
} from "./analytics.js"
import type { HostAudit } from "./hostaudit.js"
import { localDay, type UsageStore } from "./usage.js"
import type { PlanUsage } from "./plan-usage.js"
import { ArtifactError, artifactHeaders, EXT, mermaidPage, readMermaidLib, themedHtml, type ArtifactStore } from "./artifacts.js"
import { MemoryError, type MemoryScope, type MemoryStore } from "./memory.js"
import { RoutineError, type Routine, type RoutineStore } from "./routines.js"
import { extractToken, secretsEqual } from "./server-guard.js"
import { CliAccess, registerCliRoutes, type CliDeps } from "./cli-access.js"
import { AUTONOMY_RAISE_RULE, AUTONOMY_RAISE_TOOL, EARN as AUTONOMY_EARN, isLevel, LEVEL_NAMES, LIMITS as AUTONOMY_LIMITS, rank, reviewAutonomy } from "./autonomy.js"
import { deferLoosening, registerLooseningRoutes, rulesRemoved, strictUnion, testStrictnessRemoved } from "./loosening-api.js"
import { looseningPhrase } from "./loosening.js"
import { isOpRef } from "./secret-providers.js"
import { registerVoiceRoutes, VoiceSettings } from "./voice.js"
import { deliveryKey, hashHookToken, HookDeliveries, MAX_BODY, passes } from "./webhooks.js"
import type { RoutineDrafts } from "./routine-drafts.js"
import { PROVIDER_IDS, ProjectError, type ProjectStore, type ProviderId } from "./projects.js"
import type { PhoneService } from "./relay/service.js"

/**
 * What the Host's admin endpoints need. They serve the desktop UI only: the same guard as the WebSocket
 * (loopback Host header, own Origin, per-launch token) applies, and nothing here is reachable from the phone.
 */
export interface AdminContext {
  /** D-015: why a rule must not be accepted, from what any open session read; undefined when nothing says so. */
  untrustedMention?: (rule: { command?: string; path?: string; host?: string }) => string | undefined
  engine: PolicyEngine
  store: PolicyStore
  pwsh: PwshWorker | undefined
  audit: HostAudit
  auditDir: string
  loadOptions: LoadOptions
  env: NodeJS.ProcessEnv
  /** The config the Host started with. Saved changes need a restart to take effect. */
  config: () => GatehouseConfig
  log: (line: string) => void
  /** For the digest's spend and the usage views. */
  usage?: UsageStore
  /** The phone channel, for the Devices page. */
  phone?: PhoneService
  /** Opens the Windows folder chooser. Absent where there is no desktop (tests). */
  pickFolder?: FolderPicker
  /** The Windows save window, for Save a copy. Injected so tests never open a window. */
  saveAs?: SaveAsPicker
  /** The chat projects: instructions and knowledge files. */
  projects?: ProjectStore
  /** What chats remember. */
  memory?: MemoryStore
  /** B34: routines, sessions that start themselves on a schedule. */
  routines?: RoutineStore
  /** T-119: a routine run now from the desktop. */
  runRoutine?: (id: string) => Promise<string>
  /** T-135: secrets sessions asked you for, answered on the desktop only. */
  secretRequests?: import("./secret-requests.js").SecretRequests
  /** C-015: each project's autonomy cap, from its record. */
  autonomy?: import("./autonomy.js").AutonomyStore
  /** D-019: asks the paired phone to confirm a raise with its passkey. */
  broker?: import("./broker.js").Broker
  /** D-024: loosening that waits ten minutes after you type its phrase. */
  loosening?: import("./loosening.js").LooseningStore
  /** D-024: tells the phone and push channels, for information only. */
  tell?: (title: string, body: string) => void
  /** D-095: Group Policy's Doctor check. */
  groupPolicy?: () => import("./doctor.js").DoctorCheck
  /** D-097: PowerShell's language mode for Doctor, read once. */
  lockdown?: () => Promise<import("./doctor.js").DoctorCheck>
  /** T-132: the Host's stalls and slow requests, for Doctor. */
  stalls?: import("./host-stalls.js").HostStalls
  /** T-124: the command line for scripts on this computer, its token and what it may do. */
  cli?: { access: CliAccess; deps: CliDeps }
  /** T-120: a call to a routine's address, past its token, filters and repeats: started, held, or over the day's number. */
  fireHook?: (id: string, payload: unknown) => "starting" | "held" | "capped"
  /** T-122: routines a session drafted, for you to save. */
  routineDrafts?: RoutineDrafts
  /** G24: the task board, and how a card's session starts. */
  board?: { store: BoardStore; start: (card: Card) => Promise<string> }
  /** What chats show in a sandbox. */
  artifacts?: ArtifactStore
  /** Your saved prompts (W1-14). */
  prompts?: PromptStore
  marketplace?: Marketplace
  /** The token or password for an ntfy server that needs a sign-in, sealed. */
  ntfySecrets?: NtfySecretStore
  /** Chat's own store and what records into it (CH-03). */
  chat?: ChatDeps
  /** While you were away, written by Claude (owner, 4 Nov). */
  recap?: RecapDeps
  /** T-018: session titles written by Claude. */
  titles?: TitleDeps
  /** O41: Neighbourhood Watch, paired and run from Settings. */
  cnw?: CnwService
  /** O42: each session's ten-minute summaries. */
  timeline?: Parameters<typeof registerTimelineRoutes>[1]
  /** O39: the MCP servers you build. */
  mcp?: McpRouteDeps
  /** T-125: the folder of a chat Codehouse made, for triage files. */
  triageFolder?: (sessionId: string) => string | undefined
  /** /btw: a side question about a session, answered without interrupting it (owner, 4 Nov). */
  btw?: BtwDeps
  /** CH-04: importing a claude.ai export. */
  chatImport?: ImportDeps
  /** CH-06: Open in Claude. */
  chatHandoff?: HandoffDeps
  /** CH-07: Continue locally. */
  chatContinue?: ContinueDeps
  /** What a chat was told it remembers when it started (CH-03). */
  sessionMemory?: (
    id: string,
  ) => Array<{ id: string; scope: string; topic: string; text: string }> | undefined
  /** B39: plugin evaluations, with and without a plugin, in Plan mode. */
  evals?: PluginEvaluator
  /** The working folder of a running session, for the files panel. */
  sessionCwd?: (sessionId: string) => string | undefined
  /** T-113: the ports a running session's processes listen on. */
  sessionPorts?: (sessionId: string) => Promise<Listening[]>
  /** T-080: pull requests watched for sessions. */
  prWatcher?: PrWatcher
  /** T-083: a fast-forward pull as a Codehouse action. */
  pullFastForward?: GitPanelContext["pullFastForward"]
  /** T-075: a gh command for a pull request, as a Codehouse action for a session. */
  forgeAct?: (sessionId: string, cwd: string, command: string, why: string) => Promise<ActionResult>
  /** Whether a running session wrote or edited the file at this full path. */
  sessionWrote?: (sessionId: string, absPath: string) => boolean
  /** An account's plan limits, read on one of its open sessions. */
  planUsage?: (account: string, fresh: boolean) => Promise<PlanUsage | undefined>
  /** The Windows file window for the composer's Add files. Injected so tests never open a window. */
  pickFiles?: () => Promise<string[]>
  /** Opens Explorer with a file selected. Injected so tests never open a window. */
  reveal?: (absPath: string) => void
  /** The ntfy push channel. Absent in tests that do not need it. */
  ntfy?: {
    status: () => NtfyStatus
    start: () => void
    stop: () => void
    test: () => Promise<{ ok: boolean; error?: string }>
  }
  /** The Slack push channel and its encrypted token store. Absent in tests that do not need it. */
  slack?: {
    status: () => SlackStatus
    start: () => Promise<void>
    stop: () => void
    test: () => Promise<{ ok: boolean; error?: string }>
    saveSecrets: (s: SlackSecrets) => Promise<void>
    forgetSecrets: () => void
  }
  /** The phone Relay run inside Codehouse. Absent in tests that do not need it. */
  localRelay?: {
    status: () => LocalRelayStatus
    start: (publicUrl: string, port: number) => Promise<LocalRelayStatus>
    stop: () => Promise<void>
  }
  /** Updates to Codehouse itself. Absent in tests that do not need it. */
  updates?: Updates
  /** The changelog in Settings (owner, 4 Nov): every release's notes, read from the releases and kept for offline. */
  changelog?: ChangelogStore
  /** G30: the PowerShell verifier, put in each audit bundle. */
  auditVerifier?: string
  /** E-100: the last run of the invariant canaries, for Doctor. */
  canaries?: () => CanaryRun | undefined
  /** E-096: safe mode, entered from Doctor and left from the desktop's banner. */
  safeMode?: SafeMode
  /** E-080: imported team redaction lists, and your own words without them (what Settings edits). */
  redactionLists?: RedactionLists
  ownRedactTerms?: () => string[]
  /** C-011: the key a session's timeline export is signed with. */
  timelineSigner?: TimelineSigner
  /** D-029: the audit anchors. */
  anchors?: AnchorService
  /** D-003: the evidence packs. */
  evidence?: EvidenceStore
  /** D-057: how the vulnerability snapshot stands, for Doctor. */
  vulnSnapshot?: () => import("./vuln-snapshot.js").SnapshotState
  /** The sealed GitHub token for a private repository. */
  updateToken?: Pick<UpdateTokenStore, "save" | "forget">
  /** The Approver's supervisor, for the workbench. Absent when the Approver is not run by this Host. */
  approver?: {
    state: () => string
    restart: () => Promise<void>
  }
  /** What the Host reports about itself, for the Doctor. */
  health?: () => Health
  /** The worktrees Codehouse made for sessions (B10). */
  worktrees?: Worktrees
  /** Whether a running session works in a folder. */
  openIn?: (folder: string) => boolean
  /** E-051: worktree branches the last check found would conflict. */
  conflicts?: () => Conflict[]
  /** Whether Claude Code is here, and its version, for the Doctor. */
  claude?: () => Promise<{ found: boolean; version?: string }>
}

/** What the Approver offers over MCP, in words, for the workbench. */
export const APPROVER_TOOLS = [
  {
    name: "evaluate_permission",
    purpose:
      "Decides one permission request: allow, deny or escalate, with the rule id, the reason and a risk score.",
  },
  {
    name: "explain_verdict",
    purpose:
      "Explains a rule by its id: what it matches, which section it belongs to, and why it exists.",
  },
  {
    name: "policy_status",
    purpose:
      "Reports the policy hash, load errors, overlays, remembered rules, the PowerShell parser and the audit head.",
  },
  {
    name: "approval_prompt",
    purpose:
      "The same decision for a headless Claude Code run, where anything that would wait is denied with a clear message.",
  },
] as const

const sha = (text: string) => createHash("sha256").update(text).digest("hex")
const MAX_REPLAY = 5000

function bad(reply: FastifyReply, status: number, error: string, extra: object = {}) {
  return reply
    .code(status)
    .header("cache-control", "no-store")
    .send({ error, ...extra })
}

/** Newest first. Stops reading older files as soon as enough records matched. */
export function queryAudit(
  dir: string,
  q: {
    limit: number
    before?: number
    decision?: string
    channel?: string
    rule?: string
    project?: string
    session?: string
    text?: string
  },
): { records: AuditRecord[]; nextBefore?: number } {
  const out: AuditRecord[] = []
  const needle = q.text?.toLowerCase()
  const files = listAuditFiles(dir).reverse()
  for (const file of files) {
    const lines = fs.readFileSync(path.join(dir, file), "utf8").split("\n")
    for (let i = lines.length - 1; i >= 0; i--) {
      const raw = lines[i]
      if (!raw) continue
      let rec: AuditRecord
      try {
        const parsed = AuditRecord.safeParse(JSON.parse(raw))
        if (!parsed.success) continue
        rec = parsed.data
      } catch {
        continue
      }
      if (q.before !== undefined && rec.seq >= q.before) continue
      if (q.decision && rec.verdict.outcome !== q.decision) continue
      if (q.channel && rec.channel !== q.channel) continue
      if (q.rule && !rec.verdict.ruleId.toLowerCase().includes(q.rule.toLowerCase())) continue
      if (q.project && rec.project !== q.project) continue
      if (q.session && rec.session !== q.session) continue
      if (
        needle &&
        !`${rec.tool}\n${rec.inputJson}\n${rec.verdict.reason}\n${rec.verdict.ruleId}\n${rec.cwd ?? ""}`
          .toLowerCase()
          .includes(needle)
      )
        continue
      out.push(rec)
      if (out.length > q.limit) {
        const last = out.pop() as AuditRecord
        return { records: out, nextBefore: last.seq + 1 }
      }
    }
  }
  return { records: out }
}

/** D-026: how far back a save of the rules is checked against the decisions really made. */
export const REGRESSION_DAYS = 90

export function replayRecords(dir: string, opts: { since?: number } = {}): ReplayRecord[] {
  const records: ReplayRecord[] = []
  let old = false
  for (const file of listAuditFiles(dir).reverse()) {
    if (old) break
    const lines = fs.readFileSync(path.join(dir, file), "utf8").split("\n")
    for (let i = lines.length - 1; i >= 0 && records.length < MAX_REPLAY; i--) {
      const raw = lines[i]
      if (!raw) continue
      try {
        const parsed = AuditRecord.safeParse(JSON.parse(raw))
        if (!parsed.success) continue
        const r = parsed.data
        if (opts.since !== undefined && Date.parse(r.ts) < opts.since) {
          old = true
          break
        }
        if (!r.cwd || r.event === "policy_activated" || r.event === "settings_changed") continue
        const input: unknown = JSON.parse(r.inputJson)
        if (!input || typeof input !== "object" || Array.isArray(input)) continue
        records.push({
          line: r.seq,
          toolName: r.tool,
          input: input as Record<string, unknown>,
          cwd: r.cwd,
          before: { outcome: r.verdict.outcome, ruleId: r.verdict.ruleId },
        })
      } catch {
        continue
      }
    }
    if (records.length >= MAX_REPLAY) break
  }
  return records
}

/**
 * D-026: the past refusals and escalations (from the last REGRESSION_DAYS days of the audit log) that the candidate
 * rules would allow and the rules in force would not. Only these block a save; a change that only tightens saves at
 * once.
 */
export async function regressionsOf(
  ctx: Pick<AdminContext, "auditDir" | "engine" | "pwsh">,
  candidate: Policy,
  now = Date.now(),
): Promise<{ total: number; flipped: ReplayChange[] }> {
  const records = replayRecords(ctx.auditDir, { since: now - REGRESSION_DAYS * 86_400_000 }).filter(
    (r) => r.before.outcome !== "allow",
  )
  const engine = new PolicyEngine({
    getPolicy: () => candidate,
    ...(ctx.pwsh ? { pwsh: ctx.pwsh } : {}),
  })
  const byLine = new Map(records.map((r) => [r.line, r]))
  const flipped: ReplayChange[] = []
  for (const c of (await replay(engine, records)).changes) {
    const r = byLine.get(c.line)
    if (c.after.outcome !== "allow" || !r) continue
    const today = await ctx.engine.evaluate({ toolName: r.toolName, input: r.input }, { cwd: r.cwd })
    if (today.outcome !== "allow") flipped.push(c)
  }
  return { total: records.length, flipped }
}

/** D-026: what you type to save rules that would allow what was refused or escalated before. */
export const regressionPhrase = (n: number) => `allow ${n}`

/**
 * D-026, for every save of the rules (the rules file, the Library and Your choices): replays the last 90 days of
 * real decisions. Nothing would be allowed that was refused or asked about: the save goes ahead. Otherwise it goes
 * ahead only when confirm is the phrase you typed on the desktop (the admin API is the desktop's alone, invariant 7),
 * recorded first as policy_regression_accepted; a save without it is refused and recorded as policy_regression_blocked.
 */
export async function regressionGate(
  ctx: AdminContext,
  candidate: Policy,
  confirm: unknown,
  change: { from: string; to: string },
): Promise<{ error: string; regression?: { total: number; phrase: string; changes: ReplayChange[] } } | undefined> {
  const { total, flipped } = await regressionsOf(ctx, candidate)
  if (!flipped.length) return undefined
  const phrase = regressionPhrase(flipped.length)
  const input = {
    from: change.from.slice(0, 12),
    to: change.to.slice(0, 12),
    flipped: flipped.length,
    records: flipped.slice(0, 50).map((c) => c.line),
  }
  const policyHash = ctx.store.current?.hash ?? "n/a"
  if (confirm !== phrase) {
    await ctx.audit.record({
      session: "desktop",
      event: "policy_regression_blocked",
      channel: "desktop",
      tool: "policy",
      input,
      verdict: {
        outcome: "deny",
        ruleId: "policy-regression",
        reason: `The new rules would allow ${flipped.length} past calls that were refused or asked about, so they were not saved.`,
        risk: 0,
        decidedBy: "rules",
        policyHash,
      },
      latencyMs: 0,
    })
    return {
      error: `These rules would allow ${flipped.length} of the ${total} calls refused or asked about in the last ${REGRESSION_DAYS} days, so they were not saved. Type "${phrase}" to save them anyway.`,
      regression: { total, phrase, changes: flipped.slice(0, 100) },
    }
  }
  const accepted = await ctx.audit.record({
    session: "desktop",
    event: "policy_regression_accepted",
    channel: "desktop",
    tool: "policy",
    input,
    verdict: {
      outcome: "allow",
      ruleId: "policy-regression",
      reason: `You typed the confirmation to save rules that allow ${flipped.length} past calls that were refused or asked about.`,
      risk: 0,
      decidedBy: "human-desktop",
      policyHash,
    },
    latencyMs: 0,
  })
  return accepted ? undefined : { error: "Your confirmation could not be recorded, so nothing was saved." }
}

/** Loads a candidate rules file with the live overlays, without installing it. */
function loadCandidate(ctx: AdminContext, yaml: string): { policy?: Policy; errors: string[] } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-policy-"))
  try {
    const file = path.join(dir, "rules.yaml")
    fs.writeFileSync(file, yaml)
    return { policy: loadPolicy({ ...ctx.loadOptions, rulesPath: file }), errors: [] }
  } catch (e) {
    return { errors: e instanceof PolicyLoadError ? e.errors : [(e as Error).message] }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

export function registerApi(app: FastifyInstance, ctx: AdminContext): void {
  const policyHash = () => ctx.store.current?.hash ?? "none"

  app.get("/api/audit", async (req) => {
    const q = req.query as Record<string, string | undefined>
    const limit = Math.min(500, Math.max(1, Number(q.limit ?? 100) || 100))
    const before = q.before !== undefined && Number(q.before) > 0 ? Number(q.before) : undefined
    return queryAudit(ctx.auditDir, {
      limit,
      ...(before !== undefined ? { before } : {}),
      ...(q.decision ? { decision: q.decision } : {}),
      ...(q.channel ? { channel: q.channel } : {}),
      ...(q.rule ? { rule: q.rule } : {}),
      ...(q.project ? { project: q.project } : {}),
      ...(q.session ? { session: q.session } : {}),
      ...(q.q ? { text: q.q } : {}),
    })
  })

  // The Usage page: cost and tokens by day, session and model for a range of days (owner, 30 Oct).
  app.get("/api/usage/report", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>
    const day = /^\d{4}-\d{2}-\d{2}$/
    if (!ctx.usage) return bad(reply, 501, "Usage is not available here.")
    if (!day.test(q.from ?? "") || !day.test(q.to ?? "") || (q.from as string) > (q.to as string))
      return bad(reply, 400, "Give from and to as YYYY-MM-DD, from first.")
    // T-128: your own prices and counted-as, applied to what is shown, never to what was recorded.
    return applyPricing(ctx.usage.report(q.from as string, q.to as string), ctx.config().modelPricing)
  })

  // What drove the usage (B15): tool calls, subagents and skills, counted from the audit log.
  app.get("/api/usage/drivers", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>
    const day = /^\d{4}-\d{2}-\d{2}$/
    if (!day.test(q.from ?? "") || !day.test(q.to ?? "") || (q.from as string) > (q.to as string))
      return bad(reply, 400, "Give from and to as YYYY-MM-DD, from first.")
    const session = q.session && /^[\w-]{1,80}$/.test(q.session) ? q.session : undefined
    return usageDrivers(ctx.auditDir, q.from as string, q.to as string, session)
  })

  // The account's plan limits, for the meter beside the prompt box. Null where none can be read.
  app.get("/api/plan-usage", async (req) => {
    const q = req.query as Record<string, string | undefined>
    const account = q.account && /^[a-z0-9-]{1,20}$/.test(q.account) ? q.account : "main"
    return { usage: (await ctx.planUsage?.(account, q.fresh === "1")) ?? null }
  })

  // C-010: a session's timeline, every call in audit order, with the checkpoints taken in its folder.
  app.get("/api/timeline", async (req, reply) => {
    const session = String((req.query as { session?: string }).session ?? "")
    if (!/^[\w-]{1,80}$/.test(session)) return bad(reply, 400, "Name a session.")
    const records = sessionRecords(ctx.auditDir, session)
    const cwd = records.find((r) => r.cwd)?.cwd
    const checkpoints = cwd ? await listCheckpoints(cwd, session).catch(() => []) : []
    return { entries: sessionTimeline(records, checkpoints) }
  })

  // D-089: about how many minutes of review the changes allowed in the last hour need, against the capacity you set.
  // Each call is counted once (by its id), from the audit log; nothing is recorded.
  app.get("/api/review-load", async () => {
    const from = Date.now() - 3_600_000
    const seen = new Set<string>()
    let minutes = 0
    let changes = 0
    for (const r of recordsSince(ctx.auditDir, from)) {
      if (Date.parse(r.ts) < from || r.verdict.outcome !== "allow") continue
      let input: unknown = {}
      try {
        input = JSON.parse(r.inputJson) as unknown
      } catch {
        continue
      }
      const size = changeSize(r.tool, input)
      if (!size.files) continue
      const key = r.toolUseId ?? `seq:${r.seq}`
      if (seen.has(key)) continue
      seen.add(key)
      minutes += reviewMinutes({ ...size, risk: r.verdict.risk })
      changes++
    }
    const capacity = ctx.config().reviewCapacityMinutes
    return { lastHour: { minutes, changes }, ...(capacity ? { capacity, over: minutes > capacity } : {}) }
  })

  // D-031: saved questions about the audit log, answered from an index kept beside it, redacted.
  const index = new AuditIndex({ auditDir: ctx.auditDir, dir: path.join(path.dirname(path.resolve(ctx.auditDir)), "audit-index") })
  // C-015: each project's cap, from 30 days of this log: lowered by the record (five minutes after start, then daily,
  // or when you ask), raised only by you, here on the desktop.
  const autonomy = ctx.autonomy
  if (autonomy) {
    const record = (event: string, input: Record<string, unknown>, reason: string, by: "rules" | "human-desktop" | "human-phone") =>
      ctx.audit.record({
        session: "desktop",
        event,
        channel: by === "rules" ? "host" : by === "human-phone" ? "phone" : "desktop",
        tool: "autonomy",
        input,
        verdict: { outcome: "allow", ruleId: event.replace(/_/g, "-"), reason, risk: 0, decidedBy: by, policyHash: ctx.store.current?.hash ?? "" },
        latencyMs: 0,
      })
    const review = () => reviewAutonomy({ store: autonomy, entries: (from) => index.since(from), record: (e, input, why) => record(e, input, why, "rules") })
    const first = setTimeout(() => void review().catch(() => undefined), 5 * 60_000)
    first.unref?.()
    const daily = setInterval(() => void review().catch(() => undefined), 86_400_000)
    daily.unref?.()
    app.addHook("onClose", async () => {
      clearTimeout(first)
      clearInterval(daily)
    })
    app.get("/api/autonomy", async () => ({ caps: autonomy.caps(), limits: AUTONOMY_LIMITS }))
    app.post("/api/autonomy/review", async () => ({ lowered: await review(), caps: autonomy.caps() }))
    app.post("/api/autonomy/:project/raise", async (req, reply) => {
      const project = (req.params as { project: string }).project
      const level = (req.body as { level?: unknown } | undefined)?.level
      if (!isLevel(level)) return bad(reply, 422, "Say which level: plan, default, acceptEdits, auto or extreme.")
      if (rank(level) <= rank(autonomy.capFor(project))) return bad(reply, 409, `${LEVEL_NAMES[level]} is not higher than ${project}'s cap.`)
      // D-024: raising a cap waits ten minutes after its phrase; recorded as autonomy_raised when it applies.
      const r = await deferLoosening(ctx, "autonomy", `raise ${project} to ${level === "extreme" ? "no cap" : LEVEL_NAMES[level]}`, { project, level }, `autonomy:${project}`, (req.body as { confirm?: unknown } | undefined)?.confirm)
      return reply.code(r.status).send({ ...r.body, caps: autonomy.caps() })
    })
    // D-019: a proposal to raise a cap applies only when you accept it here; with a phone paired, only once its passkey
    // confirms too (the broker takes that answer from the phone alone). A failure to ask or to record applies nothing.
    const confirming = new Set<string>()
    const proposalView = () => ({ caps: autonomy.caps(), proposals: autonomy.proposals(), confirming: [...confirming] })
    app.get("/api/autonomy/proposals", async () => ({ ...proposalView(), earn: AUTONOMY_EARN }))
    app.post("/api/autonomy/:project/accept", async (req, reply) => {
      const project = (req.params as { project: string }).project
      const p = autonomy.proposals()[project]
      if (!p) return bad(reply, 404, "There is no proposal for that project.")
      if (autonomy.capFor(project) !== p.from) {
        await autonomy.dropProposal(project)
        return bad(reply, 409, "The cap has changed since, so the proposal no longer applies.")
      }
      // D-024: the raise then waits ten minutes after its phrase, typed on the desktop now.
      const what = `raise ${project} to ${p.to === "extreme" ? "no cap" : LEVEL_NAMES[p.to]}`
      const confirm = (req.body as { confirm?: unknown } | undefined)?.confirm
      if (confirm !== looseningPhrase(what)) {
        const r = await deferLoosening(ctx, "autonomy", what, {}, "", confirm)
        return reply.code(r.status).send(r.body)
      }
      const raise = async (by: "human-desktop" | "human-phone") => {
        const said = by === "human-phone" ? "on the desktop, confirmed with your phone's passkey" : "on the desktop"
        if (!(await record("autonomy_raise_accepted", { project, level: p.to, ...(by === "human-phone" ? { confirmedBy: "phone" } : {}) }, `You accepted raising ${project}'s cap from ${LEVEL_NAMES[p.from]} to ${LEVEL_NAMES[p.to]} ${said}, as proposed; it applies after the wait.`, by)))
          return false
        const r = await deferLoosening(ctx, "autonomy", what, { project, level: p.to }, `autonomy:${project}`, confirm)
        if (r.status !== 202) return false
        await autonomy.dropProposal(project)
        return true
      }
      if (!(ctx.phone?.listPhones().length ?? 0)) {
        if (!(await raise("human-desktop"))) return bad(reply, 503, "It could not be recorded, so the cap was not raised.")
        return reply.code(202).send({ ...proposalView(), pending: true })
      }
      if (!ctx.broker) return bad(reply, 503, "Your phone is paired but cannot be asked, so the cap was not raised.")
      if (!confirming.has(project)) {
        confirming.add(project)
        void ctx.broker
          .request({
            kind: "permission",
            sessionId: "desktop",
            toolUseId: `autonomy-raise-${randomBytes(8).toString("hex")}`,
            toolName: AUTONOMY_RAISE_TOOL,
            input: { project, from: LEVEL_NAMES[p.from], to: LEVEL_NAMES[p.to] },
            cwd: "",
            project,
            verdict: { outcome: "escalate", ruleId: AUTONOMY_RAISE_RULE, reason: `You accepted on the desktop to raise ${project}'s cap from ${LEVEL_NAMES[p.from]} to ${LEVEL_NAMES[p.to]}. Confirm it here with your passkey.`, risk: 50, decidedBy: "rules", policyHash: ctx.store.current?.hash ?? "" },
            defaultToNo: true,
          })
          .then(async (r) => {
            if (r.outcome === "allow" && r.channel === "phone" && autonomy.capFor(project) === p.from && autonomy.proposals()[project]) await raise("human-phone")
          })
          .catch(() => undefined)
          .finally(() => confirming.delete(project))
      }
      return reply.code(202).send({ ...proposalView(), waitingForPhone: true })
    })
    app.post("/api/autonomy/:project/decline", async (req, reply) => {
      const project = (req.params as { project: string }).project
      const p = autonomy.proposals()[project]
      if (!p) return bad(reply, 404, "There is no proposal for that project.")
      if (!(await record("autonomy_raise_declined", { project, from: p.from, to: p.to }, `You said no to raising ${project}'s cap to ${LEVEL_NAMES[p.to]}; it must be earned again from now.`, "human-desktop")))
        return bad(reply, 503, "It could not be recorded, so nothing changed.")
      await autonomy.decline(project)
      return proposalView()
    })
  }
  app.get("/api/audit/query", async (req, reply) => {
    const q = req.query as { template?: string; project?: string; limit?: string }
    const template = String(q.template ?? "") as QueryTemplate
    if (!Object.hasOwn(TEMPLATES, template)) return bad(reply, 400, "Choose one of the saved questions.")
    const project = q.project?.trim() ? q.project.trim().slice(0, 120) : undefined
    if (TEMPLATES[template].needsProject && !project) return bad(reply, 400, "Name the project.")
    const limit = Math.min(1000, Math.max(1, Number(q.limit ?? 200) || 200))
    const started = Date.now()
    const r = await index.query(template, {
      ...(project ? { project } : {}),
      limit,
      redact: (x) => redactString(x, { terms: ctx.config().redactTerms }),
    })
    return { title: TEMPLATES[template].title, ...r, ms: Date.now() - started }
  })

  // D-029: the anchors so far, and one now.
  app.get("/api/audit/anchors", async () => ({ anchors: ctx.anchors?.list().slice(0, 30) ?? [] }))
  app.post("/api/audit/anchor", async (_req, reply) => {
    if (!ctx.anchors) return bad(reply, 501, "Anchoring is not available on this Host.")
    const anchor = await ctx.anchors.anchor("on demand")
    if (!anchor) return bad(reply, 409, "There is nothing in the audit log to anchor yet.")
    return { anchor }
  })

  app.get("/api/audit/verify", async () => {
    // D-029: and each anchor against the record it names.
    const anchorsDir = anchorsDirFor(ctx.auditDir)
    const r = verifyAudit(ctx.auditDir, fs.existsSync(anchorsDir) ? { anchorsDir } : {})
    return {
      ...r,
      problems: r.problems.slice(0, 50),
      moreProblems: Math.max(0, r.problems.length - 50),
    }
  })

  // G30: the log as a zip anyone can check, with the verifier and a note; each one made is recorded.
  app.get("/api/audit/bundle", async (_req, reply) => {
    const { zip, records } = await makeAuditBundle(ctx.auditDir, ctx.auditVerifier)
    await ctx.audit.record({
      session: "host",
      event: "audit_exported",
      channel: "desktop",
      tool: "audit",
      input: { records, bytes: zip.length },
      verdict: {
        outcome: "allow",
        ruleId: "audit-exported",
        reason: "The audit log was exported as a bundle that can be checked.",
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: ctx.store.current?.hash ?? "",
      },
      latencyMs: 0,
    })
    const day = new Date().toISOString().slice(0, 10)
    return reply
      .header("content-type", "application/zip")
      .header("content-disposition", `attachment; filename="codehouse-audit-${day}.zip"`)
      .header("cache-control", "no-store")
      .send(zip)
  })

  // C-011: the signing key's fingerprint, to compare with the one an export names.
  app.get("/api/timeline/key", async (_req, reply) => {
    if (!ctx.timelineSigner) return bad(reply, 503, "Signed exports are not available here.")
    return { fingerprint: await ctx.timelineSigner.fingerprint() }
  })

  // C-011: one session's timeline, signed, in the audit bundle, with what both verifiers said of it.
  // D-027: the working tree as it was at one step of a session, rebuilt in a folder of its own; nothing of the session
  // runs. Recorded, and the folder shown in Explorer when asked.
  app.post("/api/timeline/rebuild", async (req, reply) => {
    const b = req.body
    if (!isObject(b) || typeof b.session !== "string" || !/^[\w-]{1,80}$/.test(b.session) || typeof b.seq !== "number")
      return bad(reply, 400, "Name a session and a record.")
    const records = sessionRecords(ctx.auditDir, b.session)
    const cwd = records.find((r) => r.cwd)?.cwd
    if (!cwd) return bad(reply, 404, "That session has no project folder in the audit log.")
    const checkpoints = await listCheckpoints(cwd, b.session).catch(() => [])
    const dir = path.join(path.dirname(ctx.auditDir), "rebuilds", `${b.session}-${b.seq}-${Date.now().toString(36)}`)
    let result: Awaited<ReturnType<typeof rebuildAt>>
    try {
      result = await rebuildAt({ cwd, seq: b.seq, records, checkpoints, dir })
    } catch (e) {
      fs.rmSync(dir, { recursive: true, force: true })
      return bad(reply, 422, (e as Error).message)
    }
    await ctx.audit.record({
      session: b.session,
      event: "step_rebuilt",
      channel: "desktop",
      tool: "audit",
      input: { seq: b.seq, from: result.from.ref, applied: result.applied, exact: result.exact, tree: result.tree },
      verdict: {
        outcome: "allow",
        ruleId: "step-rebuilt",
        reason: "The working tree at one step of the session was rebuilt in a folder of its own, from a checkpoint and the recorded edits.",
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: ctx.store.current?.hash ?? "",
      },
      latencyMs: 0,
    })
    if (b.open === true) revealInExplorer(result.dir)
    return result
  })

  // D-003: a session's evidence packs, newest first.
  app.get("/api/evidence", async (req, reply) => {
    const session = String((req.query as { session?: string }).session ?? "")
    if (!/^[\w-]{1,80}$/.test(session)) return bad(reply, 400, "Name a session.")
    return { packs: (ctx.evidence?.packs(session) ?? []).slice(0, 20) }
  })

  // T-008: the WSL distros on this computer, each with its home folder, for the start form (Windows only).
  app.get("/api/wsl/distros", async () => ({ distros: process.platform === "win32" ? await listDistros() : [] }))

  // T-091: a session's project actions: yours, from Settings, and the repository's own (run only through the card).
  app.get("/api/project-actions", async (req, reply) => {
    const id = String((req.query as { session?: string }).session ?? "")
    const cwd = ctx.sessionCwd?.(id)
    if (!cwd) return reply.code(404).send({ error: "That session is not running." })
    const project = path.basename(TestLocks.rootOf(cwd))
    return { project, own: checkActions(ctx.config().projectActions?.[project]), repo: repoActions(TestLocks.rootOf(cwd)) }
  })

  // T-091: your actions for a project, saved by adding to the settings file (what else is there is kept), recorded.
  app.put("/api/project-actions", async (req, reply) => {
    const b = (req.body ?? {}) as { session?: unknown; actions?: unknown }
    const cwd = typeof b.session === "string" ? ctx.sessionCwd?.(b.session) : undefined
    if (!cwd) return reply.code(404).send({ error: "That session is not running." })
    const project = path.basename(TestLocks.rootOf(cwd))
    const actions = checkActions(b.actions)
    if (Array.isArray(b.actions) && actions.length !== b.actions.length) return bad(reply, 422, "Each action needs a name (at most 60 characters) and a one-line command; a preview is an address on this computer.")
    const file = configPath(ctx.env)
    let onDisk: Record<string, unknown> = {}
    try {
      onDisk = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>
    } catch {
      // no settings file yet
    }
    const all = { ...((onDisk.projectActions as Record<string, unknown> | undefined) ?? {}) }
    if (actions.length) all[project] = actions
    else delete all[project]
    const recorded = await ctx.audit.record({
      session: "desktop",
      event: "settings_changed",
      channel: "desktop",
      tool: "settings",
      input: { changed: ["projectActions"], project, actions: actions.map((a) => a.name) },
      verdict: { outcome: "allow", ruleId: "settings-changed", reason: "Your project actions were changed from the desktop.", risk: 0, decidedBy: "human-desktop", policyHash: ctx.store.current?.hash ?? "" },
      latencyMs: 0,
    })
    if (!recorded) return bad(reply, 503, "It could not be recorded, so it was not saved.")
    const merged = { ...onDisk, projectActions: all }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    await writeFileAtomic(file, JSON.stringify(merged, null, 2) + "\n")
    ;(ctx.config() as { projectActions?: unknown }).projectActions = all
    return { project, own: actions }
  })

  // T-071: your own keys for Codehouse's commands, saved by adding to the settings file (what else is there is kept).
  app.put("/api/shortcuts", async (req, reply) => {
    const raw = (req.body as { shortcuts?: unknown } | undefined)?.shortcuts
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return bad(reply, 422, "Give the keys by command.")
    const entries = Object.entries(raw as Record<string, unknown>).filter(([k, v]) => /^[a-z][a-z0-9-]{0,39}$/.test(k) && typeof v === "string" && v.length <= 40)
    if (entries.length !== Object.keys(raw).length || entries.length > 60) return bad(reply, 422, "Each command needs keys of at most 40 characters, or nothing.")
    const shortcuts = Object.fromEntries(entries) as Record<string, string>
    const file = configPath(ctx.env)
    let onDisk: Record<string, unknown> = {}
    try {
      onDisk = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>
    } catch {
      // no settings file yet
    }
    const recorded = await ctx.audit.record({
      session: "desktop",
      event: "settings_changed",
      channel: "desktop",
      tool: "settings",
      input: { changed: ["shortcuts"], commands: Object.keys(shortcuts) },
      verdict: { outcome: "allow", ruleId: "settings-changed", reason: "Your keyboard shortcuts were changed from the desktop.", risk: 0, decidedBy: "human-desktop", policyHash: ctx.store.current?.hash ?? "" },
      latencyMs: 0,
    })
    if (!recorded) return bad(reply, 503, "It could not be recorded, so it was not saved.")
    const merged = { ...onDisk, shortcuts }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    await writeFileAtomic(file, JSON.stringify(merged, null, 2) + "\n")
    ;(ctx.config() as { shortcuts?: unknown }).shortcuts = shortcuts
    return { shortcuts }
  })

  // T-091: one of the repository's own actions, run only as a Codehouse action: judged by the rules, on the card.
  app.post("/api/project-actions/run", async (req, reply) => {
    const b = (req.body ?? {}) as { session?: unknown; index?: unknown }
    const session = typeof b.session === "string" ? b.session : ""
    const cwd = ctx.sessionCwd?.(session)
    if (!cwd) return reply.code(404).send({ error: "That session is not running." })
    if (!ctx.forgeAct) return reply.code(501).send({ error: "Running a repository's actions is not available here." })
    const action = repoActions(TestLocks.rootOf(cwd))[Number(b.index)]
    if (!action) return reply.code(404).send({ error: "The repository has no such action (it may have changed)." })
    const r = await ctx.forgeAct(session, cwd, action.command, `the repository's action "${action.name}"`)
    return { ran: r.ran, ...(r.refused ? { refused: r.refused } : {}), exitCode: r.exitCode, output: redactString(r.output, { terms: ctx.config().redactTerms }).slice(-8000) }
  })

  // T-118: the emulators and simulators running here, and a picture of one, taken when asked (only a listed device).
  app.get("/api/device-panel/list", async () => ({ devices: await listDevices() }))
  app.get("/api/device-panel/shot", async (req, reply) => {
    const q = req.query as { kind?: string; id?: string }
    const device = (await listDevices()).find((d) => d.kind === q.kind && d.id === q.id)
    if (!device) return reply.code(404).send({ error: "That device is not running here." })
    const png = await screenshot(device)
    if (!png) return reply.code(409).send({ error: "The device's screen could not be taken." })
    return reply.header("content-type", "image/png").header("cache-control", "no-store").send(png)
  })

  // T-113: the ports a session's processes listen on, for its browser panel.
  app.get("/api/session/ports", async (req, reply) => {
    const id = String((req.query as { session?: string }).session ?? "")
    if (!ctx.sessionCwd?.(id)) return reply.code(404).send({ error: "That session is not running." })
    return { ports: ctx.sessionPorts ? await ctx.sessionPorts(id) : [] }
  })

  // T-004: the coding agents on the PATH and the model runtimes answering on this computer, for the welcome.
  app.get("/api/welcome/found", async () => ({ agents: findAgents(process.env), runtimes: await findRuntimes() }))

  // D-099: a summary of a change for people who did not watch it, every sentence from its evidence pack, redacted.
  app.get("/api/evidence/summary", async (req, reply) => {
    const q = req.query as { session?: string; sha?: string }
    const session = String(q.session ?? "")
    if (!/^[\w-]{1,80}$/.test(session)) return bad(reply, 400, "Name a session.")
    const found = (ctx.evidence?.packs(session) ?? []).find((p) => p.sha === q.sha)
    if (!found) return bad(reply, 404, "That evidence pack is not this session's, or it is no longer kept.")
    return stakeholderSummary(found.pack, found.sha, (s) => redactString(s, { terms: ctx.config().redactTerms }))
  })

  app.get("/api/timeline/export", async (req, reply) => {
    const session = String((req.query as { session?: string }).session ?? "")
    if (!/^[\w-]{1,80}$/.test(session)) return bad(reply, 400, "Name a session.")
    if (!ctx.timelineSigner || !ctx.auditVerifier) return bad(reply, 503, "Signed exports are not available here.")
    // D-003: with an evidence pack of this session's, when one is named.
    const sha = String((req.query as { evidence?: string }).evidence ?? "")
    const evidence = sha ? ctx.evidence?.text(sha) : undefined
    if (sha && (!evidence || (JSON.parse(evidence) as { session?: string }).session !== session))
      return bad(reply, 404, "That evidence pack is not this session's, or it is no longer kept.")
    const records = sessionRecords(ctx.auditDir, session)
    const cwd = records.find((r) => r.cwd)?.cwd
    const checkpoints = cwd ? await listCheckpoints(cwd, session).catch(() => []) : []
    const entries = sessionTimeline(records, checkpoints)
    const { zip, fingerprint, ok } = await makeTimelineExport({
      auditDir: ctx.auditDir,
      session,
      entries,
      signer: ctx.timelineSigner,
      verifier: ctx.auditVerifier,
      ...(evidence !== undefined ? { evidence } : {}),
    })
    const written = await ctx.audit.record({
      session,
      event: "timeline_exported",
      channel: "desktop",
      tool: "audit",
      input: { entries: entries.length, bytes: zip.length, fingerprint, verified: ok, ...(sha ? { evidence: sha } : {}) },
      verdict: {
        outcome: "allow",
        ruleId: "timeline-exported",
        reason: "A session's timeline was exported, signed, with the records it was made from.",
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: ctx.store.current?.hash ?? "",
      },
      latencyMs: 0,
    })
    if (!written) return bad(reply, 500, "The export could not be recorded in the audit log, so it was not given.")
    const day = new Date().toISOString().slice(0, 10)
    return reply
      .header("content-type", "application/zip")
      .header("content-disposition", `attachment; filename="codehouse-timeline-${day}.zip"`)
      .header("x-codehouse-key", fingerprint)
      .header("cache-control", "no-store")
      .send(zip)
  })

  app.get("/api/audit/export", async (_req, reply) => {
    const text = listAuditFiles(ctx.auditDir)
      .map((f) => fs.readFileSync(path.join(ctx.auditDir, f), "utf8"))
      .join("")
    return reply
      .header("content-type", "application/x-ndjson; charset=utf-8")
      .header("content-disposition", 'attachment; filename="gatehouse-audit.jsonl"')
      .header("cache-control", "no-store")
      .send(text)
  })

  app.get("/api/policy", async () => {
    const policy = ctx.store.current
    const read = (f: string | undefined) =>
      f && fs.existsSync(f) ? fs.readFileSync(f, "utf8") : ""
    const yaml = read(ctx.loadOptions.rulesPath)
    return {
      status: ctx.store.status(),
      hash: policy?.hash,
      rulesPath: ctx.loadOptions.rulesPath,
      rulesYaml: yaml,
      rulesYamlHash: sha(yaml),
      rules: policy?.rules,
      remember: policy?.remember ?? [],
      localPath: ctx.loadOptions.localPath,
      localYaml: read(ctx.loadOptions.localPath),
      overlays: Object.keys(policy?.overlays ?? {}),
    }
  })

  app.post("/api/policy/test", async (req, reply) => {
    const b = req.body
    if (
      !isObject(b) ||
      typeof b.toolName !== "string" ||
      b.toolName === "" ||
      b.toolName.length > 200 ||
      !isObject(b.input) ||
      typeof b.cwd !== "string" ||
      b.cwd === ""
    )
      return bad(reply, 400, "Give toolName, input (an object) and cwd.")
    // Evaluating here writes nothing to the audit log: it is a dry run for the person at the desk.
    // D-020: with the stages it went through and what would change it, beside the verdict as before.
    const x = await ctx.engine.explain({ toolName: b.toolName, input: b.input }, { cwd: b.cwd })
    return { ...x.verdict, explain: { trace: x.trace, fixed: x.fixed, ...(x.change ? { change: x.change } : {}) } }
  })

  // D-020: why a request waiting for you was asked, stage by stage, and what would change it. The same rules judge it
  // again here, read only; nothing is recorded or decided. What it shows is redacted like the card.
  app.get("/api/pending/:id/explain", async (req, reply) => {
    const view = ctx.broker?.get((req.params as { id: string }).id)
    if (!view || view.request.kind !== "permission") return bad(reply, 404, "There is no such request waiting.")
    const x = await ctx.engine.explain({ toolName: view.request.toolName, input: view.rawInput }, { cwd: view.request.cwd })
    const redact = (s: string) => redactString(s, { terms: ctx.config().redactTerms })
    // A check the session makes beyond the rules (a value read from the web, a locked test, a spent grant) asked it.
    const asked = view.request.verdict
    const beyond = asked.ruleId !== x.verdict.ruleId || asked.outcome !== x.verdict.outcome
    const trace = beyond ? [...x.trace, { stage: "Session checks", result: `${asked.outcome} by ${asked.ruleId}`, rules: [asked.ruleId] }] : x.trace
    const change = beyond ? `It was asked by ${asked.ruleId}, a check Codehouse makes beyond the rules, which no rule switches off: ${asked.reason}` : x.change
    return {
      trace: trace.map((t) => ({ ...t, result: redact(t.result), ...(t.rules ? { rules: t.rules.map(redact) } : {}) })),
      fixed: asked.decidedBy === "floor" || (!beyond && x.fixed),
      ...(change && asked.decidedBy !== "floor" ? { change: redact(change) } : {}),
      outcome: asked.outcome,
      ruleId: redact(asked.ruleId),
    }
  })

  app.post("/api/policy/replay", async (req, reply) => {
    const b = req.body
    if (!isObject(b) || typeof b.rulesYaml !== "string")
      return bad(reply, 400, "Send the candidate rules as rulesYaml.")
    const cand = loadCandidate(ctx, b.rulesYaml)
    if (!cand.policy)
      return bad(reply, 422, "The candidate rules do not load.", { errors: cand.errors })
    const policy = cand.policy
    const engine = new PolicyEngine({
      getPolicy: () => policy,
      ...(ctx.pwsh ? { pwsh: ctx.pwsh } : {}),
    })
    const result = await replay(engine, replayRecords(ctx.auditDir))
    return { ...result, capped: result.total >= MAX_REPLAY, candidateHash: policy.hash }
  })

  app.put("/api/policy/rules", async (req, reply) => {
    const b = req.body
    if (!isObject(b) || typeof b.yaml !== "string" || typeof b.baseHash !== "string")
      return bad(reply, 400, "Send yaml and baseHash.")
    const file = ctx.loadOptions.rulesPath
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
    if (sha(current) !== b.baseHash)
      return bad(
        reply,
        409,
        "The rules file changed on disk since you opened it. Reload and try again.",
      )
    const cand = loadCandidate(ctx, b.yaml)
    if (!cand.policy)
      return bad(reply, 422, "The rules do not load, so nothing was saved.", {
        errors: cand.errors,
      })
    // D-026: a change that would allow what was refused or asked about is saved only with your typed phrase.
    const refused = await regressionGate(ctx, cand.policy, b.confirm, { from: sha(current), to: sha(b.yaml) })
    if (refused) return bad(reply, 409, refused.error, { regression: refused.regression })
    // D-024: and one that takes out a deny or an ask waits ten minutes after its own phrase.
    const was = current ? loadCandidate(ctx, current).policy : undefined
    const removed = was ? rulesRemoved(was, cand.policy) : []
    if (removed.length) {
      const r = await deferLoosening(ctx, "rules", `remove ${removed.join(", ")}`, { yaml: b.yaml, baseHash: sha(current) }, "rules", b.loosen)
      return reply.code(r.status).send(r.body)
    }
    await writeFileAtomic(file, b.yaml)
    ctx.store.load()
    const hash = ctx.store.current?.hash ?? cand.policy.hash
    const recorded = await ctx.audit.record({
      session: "desktop",
      event: "policy_activated",
      channel: "desktop",
      tool: "policy",
      input: { from: sha(current).slice(0, 12), to: sha(b.yaml).slice(0, 12), policyHash: hash },
      verdict: {
        outcome: "allow",
        ruleId: "policy-activated",
        reason: "The rules file was replaced from the desktop.",
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: hash,
      },
      latencyMs: 0,
    })
    ctx.log(
      `policy activated (${hash.slice(0, 12)}), audit ${recorded ? "recorded" : "NOT recorded"}`,
    )
    return { ok: true, hash, audited: recorded, rulesYamlHash: sha(b.yaml) }
  })

  // G29 (backlog): when each remembered rule was added and last used, from the audit log of the past year, so one you
  // no longer use can be seen and removed.
  app.get("/api/policy/remember/usage", async (_req, reply) => {
    const localPath = ctx.loadOptions.localPath
    let entries: ReturnType<typeof readRememberEntries> = []
    try {
      entries = localPath ? readRememberEntries(localPath) : []
    } catch (e) {
      return bad(reply, 422, (e as Error).message)
    }
    const used = new Map<string, { uses: number; lastUsed: string }>()
    for (const r of recordsSince(ctx.auditDir, Date.now() - 365 * DAY)) {
      if (r.verdict.outcome !== "allow" || !r.verdict.ruleId.startsWith("remember-")) continue
      const was = used.get(r.verdict.ruleId)
      used.set(r.verdict.ruleId, {
        uses: (was?.uses ?? 0) + 1,
        lastUsed: was && was.lastUsed > r.ts ? was.lastUsed : r.ts,
      })
    }
    return {
      rules: entries.map((e) => {
        const id = `remember-${e.id}`
        const u = used.get(id)
        return {
          id,
          ...(e.createdAt ? { createdAt: e.createdAt } : {}),
          uses: u?.uses ?? 0,
          ...(u ? { lastUsed: u.lastUsed } : {}),
        }
      }),
    }
  })

  app.post("/api/policy/remember/remove", async (req, reply) => {
    const b = req.body
    if (!isObject(b) || typeof b.id !== "string" || b.id === "" || b.id.length > 100)
      return bad(reply, 400, "Send the id of the remember rule.")
    const localPath = ctx.loadOptions.localPath
    if (!localPath) return bad(reply, 404, "There is no local rules file.")
    let removed: boolean
    try {
      removed = (await removeRemember(localPath, b.id)).removed
    } catch (e) {
      return bad(reply, 422, (e as Error).message)
    }
    if (!removed) return bad(reply, 404, "That remember rule is not there any more.")
    ctx.store.load()
    const hash = policyHash()
    await ctx.audit.record({
      session: "desktop",
      event: "remember_removed",
      channel: "desktop",
      tool: "policy",
      input: { id: b.id },
      verdict: {
        outcome: "allow",
        ruleId: "remember-removed",
        reason: "A remember rule was removed from the desktop.",
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: hash,
      },
      latencyMs: 0,
    })
    return { ok: true, hash }
  })

  registerRelayRoutes(app, ctx)
  registerLooseningRoutes(app, ctx)
  registerInsightRoutes(app, ctx)
  registerProjectRoutes(app, ctx)
  registerMemoryRoutes(app, ctx)
  registerRoutineRoutes(app, ctx)
  registerCliAccessRoutes(app, ctx)
  // T-136: speech to text through a Whisper-compatible server on this computer, off until you name it.
  registerVoiceRoutes(app, {
    settings: new VoiceSettings(gatehouseDataDir(ctx.env)),
    record: (event, input) =>
      ctx.audit.record({
        session: "desktop",
        event,
        channel: "desktop",
        tool: "settings",
        input,
        verdict: { outcome: "allow", ruleId: "voice-server", reason: "The speech server was changed from the desktop.", risk: 0, decidedBy: "human-desktop", policyHash: ctx.store.current?.hash ?? "" },
        latencyMs: 0,
      }),
  })
  registerSecretRequestRoutes(app, ctx)
  registerArtifactRoutes(app, ctx)
  registerLibraryRoutes(app, ctx)
  registerFilesRoutes(app, ctx)
  registerAttachRoutes(app, ctx)
  registerUpdateRoutes(app, ctx)
  if (ctx.changelog) registerChangelogRoutes(app, ctx.changelog)
  registerHousekeepingRoutes(app, ctx)
  registerExportRoutes(app, ctx)
  registerPromptRoutes(app, ctx)
  registerMarketplaceRoutes(app, ctx)
  registerEvalRoutes(app, ctx)
  // O41: the Doctor's Neighbourhood Watch line, without its address.
  const cnw = ctx.cnw
  const doctor = registerDoctorRoutes(app, {
    ...ctx,
    ...(cnw ? { cnwStatus: () => { const s = cnw.status(); return { paired: s.paired, on: s.on, state: s.state } } } : {}),
  })
  // E-099: the health score, for the dashboard's tile and Doctor.
  registerHealthScoreRoutes(app, {
    auditDir: ctx.auditDir,
    dataDir: gatehouseDataDir(ctx.env),
    ...(ctx.updates
      ? {
          updates: () => {
            const s = ctx.updates!.status()
            return s.checkError ? { checkError: s.checkError } : {}
          },
        }
      : {}),
  })
  // E-097: the crash bundle, previewed first and saved to Downloads exactly as previewed; audited.
  registerCrashBundleRoutes(app, {
    sources: {
      logPath: path.join(gatehouseDataDir(ctx.env), "host.log"),
      auditDir: ctx.auditDir,
      version: ctx.updates?.status().current ?? "unknown",
      doctorReport: () => doctor.report().catch(() => "The Doctor report could not be made."),
      settings: () => ctx.config(),
      redactTerms: () => ctx.config().redactTerms ?? [],
    },
    record: (input) =>
      ctx.audit.record({
        session: "desktop",
        event: "crash_bundle_exported",
        channel: "desktop",
        tool: "crash-bundle",
        input,
        verdict: { outcome: "allow", ruleId: "crash-bundle-exported", reason: "A crash bundle was saved to Downloads from Doctor: logs and outcomes, redacted, without inputs.", risk: 0, decidedBy: "human-desktop", policyHash: "" },
        latencyMs: 0,
      }),
  })
  registerWorktreeRoutes(app, ctx)
  if (ctx.safeMode) registerSafeModeRoutes(app, ctx.safeMode)
  if (ctx.redactionLists)
    registerRedactionListRoutes(app, {
      lists: ctx.redactionLists,
      trustedKeys: () => ctx.config().redactionListKeys ?? [],
      record: (input) =>
        ctx.audit.record({
          session: "desktop",
          event: "redaction_list_imported",
          channel: "desktop",
          tool: "redaction",
          input,
          verdict: { outcome: "allow", ruleId: "redaction-list-imported", reason: "A team's signed redaction list was imported from the desktop; its words are hidden everywhere from now on.", risk: 0, decidedBy: "human-desktop", policyHash: "" },
          latencyMs: 0,
        }),
    })
  if (ctx.board)
    registerBoardRoutes(app, { board: ctx.board.store, audit: ctx.audit, start: ctx.board.start })
  registerGitPanelRoutes(app, ctx)
  registerShellRoutes(app, new NavigationAudit(ctx.audit, () => ctx.store.current?.hash ?? ""))
  if (ctx.chat) registerChatRoutes(app, ctx.chat)
  if (ctx.recap) registerRecapRoutes(app, ctx.recap)
  if (ctx.titles) registerTitleRoutes(app, ctx.titles)
  // T-061: read-only GitHub, only while switched on.
  if (ctx.sessionCwd) {
    const cwdOf = ctx.sessionCwd
    registerForgeRoutes(app, {
      enabled: () => ctx.config().forges?.github === true,
      sessionCwd: (id) => cwdOf(id),
      audit: ctx.audit,
      ...(ctx.prWatcher ? { watcher: ctx.prWatcher } : {}),
      // T-075: a change to a pull request, as a Codehouse action on the approval card.
      ...(ctx.forgeAct ? { act: ctx.forgeAct } : {}),
      redact: (x) => redactString(x, { terms: ctx.config().redactTerms }),
    })
  }
  if (ctx.cnw) registerCnwRoutes(app, ctx.cnw)
  if (ctx.timeline) registerTimelineRoutes(app, ctx.timeline)
  if (ctx.mcp) registerMcpBuilderRoutes(app, ctx.mcp)
  if (ctx.triageFolder)
    registerTriageRoutes(app, {
      chatFolder: ctx.triageFolder,
      logFile: path.join(gatehouseDataDir(ctx.env), "host.log"),
      audit: ctx.audit,
      policyHash: () => ctx.store.current?.hash ?? "",
    })
  if (ctx.btw) registerBtwRoutes(app, ctx.btw)
  if (ctx.chatImport) registerImportRoutes(app, ctx.chatImport)
  if (ctx.chatHandoff) registerHandoffRoutes(app, ctx.chatHandoff)
  if (ctx.chatContinue) registerContinueRoutes(app, ctx.chatContinue)
  // CH-03: exactly what a chat was told it remembers, for its Memory panel. Already redacted when it was kept.
  app.get("/api/memory/given", async (req, reply) => {
    const id = String((req.query as { session?: unknown }).session ?? "")
    const entries = ctx.sessionMemory?.(id)
    if (!entries) return reply.code(404).send({ error: "There is no such session." })
    return { entries }
  })
  registerProviderRoutes(app, {
    audit: ctx.audit,
    config: ctx.config,
    configFile: configPath(ctx.env),
    itModels: () => readItModels(managedPolicyDir(ctx.env)),
    // T-067: the providers the organisation allows.
    managed: () => ctx.store.current?.managedSettings,
  })

  app.get("/api/approver", async () => {
    const status = ctx.store.status()
    return {
      state: ctx.approver?.state() ?? "up",
      supervised: ctx.approver !== undefined,
      policy: {
        hash: ctx.store.current?.hash ?? null,
        errors: status.errors,
        overlays: Object.keys(ctx.store.current?.overlays ?? {}),
        remembered: ctx.store.current?.remember.length ?? 0,
      },
      pwsh: {
        running: ctx.pwsh?.running ?? false,
        languageMode: ctx.pwsh?.languageMode ?? null,
      },
      tools: APPROVER_TOOLS,
      recent: queryAudit(ctx.auditDir, { limit: 25, channel: "approver" }).records.map((r) => ({
        seq: r.seq,
        ts: r.ts,
        tool: r.tool,
        project: r.project ?? null,
        outcome: r.verdict.outcome,
        ruleId: r.verdict.ruleId,
        reason: r.verdict.reason,
        risk: r.verdict.risk,
        latencyMs: r.latencyMs,
      })),
    }
  })

  // A restart goes through the supervisor, never around it. Calls made while it restarts escalate to you.
  app.post("/api/approver/restart", async (_req, reply) => {
    if (!ctx.approver)
      return bad(
        reply,
        409,
        "The Approver is not run by this Host, so it cannot be restarted here.",
      )
    const before = ctx.approver.state()
    try {
      await ctx.approver.restart()
    } catch (e) {
      return bad(reply, 500, `The Approver did not restart: ${(e as Error).message}`)
    }
    await ctx.audit.record({
      session: "desktop",
      event: "approver_restarted",
      channel: "desktop",
      tool: "approver",
      input: { before },
      verdict: {
        outcome: "allow",
        ruleId: "approver-restarted",
        reason: "The Approver was restarted from the desktop.",
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: ctx.store.current?.hash ?? "",
      },
      latencyMs: 0,
    })
    return { ok: true, state: ctx.approver.state() }
  })

  // The Relay run inside Codehouse. Starting saves the choice so it starts again with Codehouse; stopping clears it.
  const saveLocalRelay = async (value: GatehouseConfig["localRelay"]) => {
    const file = configPath(ctx.env)
    const saved = fs.existsSync(file)
      ? (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>)
      : {}
    if (value) saved.localRelay = value
    else delete saved.localRelay
    const parsed = GatehouseConfig.parse(saved)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    await writeFileAtomic(file, JSON.stringify(parsed, null, 2) + "\n")
    const running = ctx.config() as Record<string, unknown>
    if (value) running.localRelay = value
    else delete running.localRelay
  }
  // Push through ntfy. Switching it on makes two random topics: one Codehouse posts to, one your answers come back on.
  const savePushPart = async (part: "ntfy" | "slack", value: unknown) => {
    const file = configPath(ctx.env)
    const saved = fs.existsSync(file)
      ? (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>)
      : {}
    const push = { ...((saved.push as Record<string, unknown> | undefined) ?? {}) }
    if (value === undefined) delete push[part]
    else push[part] = value
    if (Object.keys(push).length) saved.push = push
    else delete saved.push
    const parsed = GatehouseConfig.parse(saved)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    await writeFileAtomic(file, JSON.stringify(parsed, null, 2) + "\n")
    const running = ctx.config() as Record<string, unknown>
    if (parsed.push) running.push = parsed.push
    else delete running.push
  }
  const savePush = async (ntfy: NtfySettings | undefined) => {
    const file = configPath(ctx.env)
    const saved = fs.existsSync(file)
      ? (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>)
      : {}
    if (ntfy) saved.push = { ...((saved.push as object | undefined) ?? {}), ntfy }
    else delete saved.push
    const parsed = GatehouseConfig.parse(saved)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    await writeFileAtomic(file, JSON.stringify(parsed, null, 2) + "\n")
    const running = ctx.config() as Record<string, unknown>
    if (parsed.push) running.push = parsed.push
    else delete running.push
  }
  const auditPush = (event: string, input: unknown) =>
    ctx.audit.record({
      session: "desktop",
      event,
      channel: "desktop",
      tool: "push",
      input,
      verdict: {
        outcome: "allow",
        ruleId: event.replace(/_/g, "-"),
        reason: "Push notifications were changed from the desktop.",
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: ctx.store.current?.hash ?? "",
      },
      latencyMs: 0,
    })
  const ntfyStatus = () => {
    const st = ctx.ntfy?.status() ?? { enabled: false, listening: false, sent: 0 }
    return st.auth && !ctx.ntfySecrets?.has() ? { ...st, missingSecret: true } : st
  }
  app.get("/api/push", async () => ({
    ntfy: ntfyStatus(),
    slack: ctx.slack?.status() ?? { enabled: false, connected: false, hasTokens: false, sent: 0 },
  }))
  app.post("/api/push/slack/enable", async (req, reply) => {
    if (!ctx.slack) return bad(reply, 501, "Slack is not available here.")
    const b = (req.body ?? {}) as Record<string, unknown>
    const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : "")
    const botToken = str("botToken")
    const appToken = str("appToken")
    // T-134: or a 1Password reference for each.
    const ok = (t: string, prefix: string) => t.startsWith(prefix) || isOpRef(t)
    if ((botToken || appToken) && !(ok(botToken, "xoxb-") && ok(appToken, "xapp-")))
      return bad(
        reply,
        400,
        "Give both tokens: the bot token starts xoxb- and the app-level token starts xapp-.",
      )
    if (!botToken && !ctx.slack.status().hasTokens)
      return bad(reply, 400, "Give the bot token (xoxb-) and the app-level token (xapp-).")
    const channel = str("channel").toUpperCase()
    const userId = str("userId").toUpperCase()
    if (!/^[A-Z0-9]{6,20}$/.test(channel))
      return bad(reply, 400, "Give the channel id, or your member id for a direct message.")
    if (!/^[UW][A-Z0-9]{6,20}$/.test(userId))
      return bad(reply, 400, "Give your Slack member id (it starts with U).")
    const maxRisk =
      typeof b.maxRisk === "number" ? Math.max(0, Math.min(84, Math.round(b.maxRisk))) : 69
    if (botToken) await ctx.slack.saveSecrets({ botToken, appToken })
    await savePushPart("slack", { enabled: true, channel, userId, maxRisk })
    ctx.slack.stop()
    await ctx.slack.start()
    await auditPush("push_slack_enabled", {
      channel,
      userId,
      maxRisk,
      newTokens: Boolean(botToken),
    })
    return ctx.slack.status()
  })
  app.post("/api/push/slack/disable", async (req, reply) => {
    if (!ctx.slack) return bad(reply, 501, "Slack is not available here.")
    ctx.slack.stop()
    const old = ctx.config().push?.slack
    if (old) await savePushPart("slack", { ...old, enabled: false })
    if ((req.body as { forgetTokens?: unknown } | undefined)?.forgetTokens === true)
      ctx.slack.forgetSecrets()
    await auditPush("push_slack_disabled", {})
    return ctx.slack.status()
  })
  app.post("/api/push/slack/test", async (_req, reply) => {
    if (!ctx.slack) return bad(reply, 501, "Slack is not available here.")
    return await ctx.slack.test()
  })
  app.post("/api/push/ntfy/enable", async (req, reply) => {
    if (!ctx.ntfy) return bad(reply, 501, "Push notifications are not available here.")
    const b = (req.body ?? {}) as {
      server?: unknown
      maxRisk?: unknown
      newTopics?: unknown
      topic?: unknown
      /** none, token or basic; absent keeps what is set. */
      auth?: unknown
      user?: unknown
      /** The token or password, given only when it changes. Sealed, never saved in the settings or recorded. */
      secret?: unknown
    }
    // The topic the phone already has, typed back in. Only one Codehouse made, so it cannot be guessed.
    const typed = typeof b.topic === "string" ? ownTopic(b.topic) : undefined
    if (b.topic !== undefined && !typed)
      return bad(
        reply,
        400,
        typeof b.topic === "string" && ownTopic(b.topic.toLowerCase())
          ? "That topic has capital letters, and ntfy treats them as different letters, so your phone would get nothing. In the ntfy app, subscribe to the topic all in lower case."
          : "That is not a topic Codehouse makes. Codehouse topics are a short word, a dash and five groups of four letters and digits, all lower case with no o or 0. Copy the name from the ntfy app on your phone, or make new topics.",
      )
    const server =
      typeof b.server === "string" && b.server.trim()
        ? b.server.trim().replace(/\/$/, "")
        : "https://ntfy.sh"
    let u: URL
    try {
      u = new URL(server)
    } catch {
      return bad(reply, 400, "That is not a web address.")
    }
    if (u.protocol !== "https:") return bad(reply, 400, "The ntfy server must use https.")
    const maxRisk =
      typeof b.maxRisk === "number" ? Math.max(0, Math.min(84, Math.round(b.maxRisk))) : 69
    const old = ctx.config().push?.ntfy
    const fresh = !old || (b.newTopics === true && !typed)
    // A server that needs a sign-in (owner, 4 Nov): an access token, or a user name and password.
    const auth =
      b.auth === undefined
        ? old?.auth
        : b.auth === "token" || b.auth === "basic"
          ? b.auth
          : undefined
    if (b.auth !== undefined && b.auth !== "none" && !auth)
      return bad(reply, 400, "Choose no sign-in, an access token, or a user name and password.")
    const user =
      auth === "basic" ? (typeof b.user === "string" ? b.user.trim() : (old?.user ?? "")) : ""
    if (auth === "basic" && (!user || user.includes(":") || user.length > 120))
      return bad(reply, 400, "Give the ntfy user name (without a colon).")
    const secret = typeof b.secret === "string" ? b.secret.trim() : ""
    if (secret.length > 500 || /[\r\n]/.test(secret))
      return bad(reply, 400, "That token or password is not one ntfy would take.")
    const changedKind = auth !== old?.auth
    if (auth && !secret && (changedKind || !ctx.ntfySecrets?.has()))
      return bad(
        reply,
        400,
        auth === "token" ? "Give the access token." : "Give the password for that user.",
      )
    if (auth && !ctx.ntfySecrets) return bad(reply, 501, "A sign-in cannot be kept safely here.")
    const ntfy: NtfySettings = {
      enabled: true,
      server: u.origin,
      topic: typed ?? (fresh ? randomTopic() : old.topic),
      replyTopic: fresh ? randomTopic() : old.replyTopic,
      maxRisk,
      ...(auth ? { auth } : {}),
      ...(auth === "basic" ? { user } : {}),
    }
    if (auth && secret) await ctx.ntfySecrets?.save(secret)
    if (!auth) ctx.ntfySecrets?.forget()
    await savePush(ntfy)
    ctx.ntfy.stop()
    ctx.ntfy.start()
    await auditPush("push_ntfy_enabled", {
      server: ntfy.server,
      maxRisk,
      newTopics: fresh,
      ...(typed ? { typedTopic: true } : {}),
      // Which sign-in and as whom, never the token or password.
      signIn: auth ?? "none",
      ...(auth === "basic" ? { user } : {}),
      ...(secret ? { newSecret: true } : {}),
    })
    return ntfyStatus()
  })
  app.post("/api/push/ntfy/disable", async (_req, reply) => {
    if (!ctx.ntfy) return bad(reply, 501, "Push notifications are not available here.")
    ctx.ntfy.stop()
    const old = ctx.config().push?.ntfy
    if (old) await savePush({ ...old, enabled: false })
    await auditPush("push_ntfy_disabled", {})
    return ctx.ntfy.status()
  })
  app.post("/api/push/ntfy/test", async (_req, reply) => {
    if (!ctx.ntfy) return bad(reply, 501, "Push notifications are not available here.")
    return await ctx.ntfy.test()
  })

  app.get("/api/relay/local", async () => ({
    ...(ctx.localRelay?.status() ?? { state: "off", port: 8087 }),
    saved: ctx.config().localRelay ?? null,
  }))
  app.post("/api/relay/local/start", async (req, reply) => {
    if (!ctx.localRelay)
      return bad(reply, 501, "Running the Relay inside Codehouse is not available here.")
    const b = (req.body ?? {}) as { publicUrl?: unknown; port?: unknown }
    const port =
      typeof b.port === "number" && Number.isInteger(b.port) && b.port >= 1024 && b.port <= 65535
        ? b.port
        : 8087
    if (typeof b.publicUrl !== "string" || b.publicUrl.length > 300)
      return bad(reply, 400, "Give the https address your phone uses.")
    const status = await ctx.localRelay.start(b.publicUrl, port)
    if (status.state === "running") {
      await saveLocalRelay({ enabled: true, publicUrl: status.publicUrl ?? b.publicUrl, port })
      await ctx.audit.record({
        session: "desktop",
        event: "relay_local_started",
        channel: "desktop",
        tool: "relay",
        input: { publicUrl: status.publicUrl, port },
        verdict: {
          outcome: "allow",
          ruleId: "relay-local-started",
          reason: "The Relay was started inside Codehouse from the desktop.",
          risk: 0,
          decidedBy: "human-desktop",
          policyHash: ctx.store.current?.hash ?? "",
        },
        latencyMs: 0,
      })
    }
    return status
  })
  app.post("/api/relay/local/stop", async (_req, reply) => {
    if (!ctx.localRelay)
      return bad(reply, 501, "Running the Relay inside Codehouse is not available here.")
    await ctx.localRelay.stop()
    await saveLocalRelay(undefined)
    return ctx.localRelay.status()
  })

  app.post("/api/pick-folder", async (req, reply) => {
    if (!ctx.pickFolder)
      return bad(reply, 501, "Choosing a folder in a window is not available here.")
    const body = (req.body ?? {}) as { start?: unknown }
    const start =
      typeof body.start === "string" && body.start.length < 4096 ? body.start : undefined
    try {
      const path = await ctx.pickFolder(start)
      return { path: path ?? null }
    } catch (e) {
      return bad(reply, 500, (e as Error).message)
    }
  })

  app.get("/api/settings", async () => {
    const file = configPath(ctx.env)
    const saved = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as unknown) : {}
    return {
      path: file,
      saved,
      // E-080: your own words only; imported team lists are shown, and kept, on their own.
      running: ctx.ownRedactTerms ? { ...ctx.config(), redactTerms: ctx.ownRedactTerms() } : ctx.config(),
      workspaceRootsInEffect: ctx.store.current?.rules.workspaceRoots ?? [],
      quietHoursInPolicy: ctx.store.current?.rules.quietHours ?? null,
    }
  })

  // T-067: what the organisation's managed settings allow, for the Settings page's Managed by note.
  app.get("/api/managed", async () => {
    const m = ctx.store.current?.managedSettings
    return { managed: m !== undefined, ...(m ? { label: managedLabel(m), locked: m.locked ?? [], lines: describeManaged(m).slice(1), settings: m } : {}) }
  })

  app.put("/api/settings", async (req, reply) => {
    const parsed = GatehouseConfig.safeParse(req.body)
    if (!parsed.success)
      return bad(reply, 422, "Those settings are not valid.", {
        errors: parsed.error.issues.map((i) => `${i.path.join(".") || "settings"}: ${i.message}`),
      })
    const file = configPath(ctx.env)
    // A setting this version does not know is refused, unless it is already in the file: a newer version wrote it
    // before an update was undone, and it is kept for when that version comes back.
    const onDisk = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as unknown) : {}
    const at = (v: unknown, dotted: string) =>
      dotted
        .split(".")
        .reduce<unknown>(
          (o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined),
          v,
        )
    const strangers = unknownConfigKeys(req.body).filter(
      (k) => JSON.stringify(at(req.body, k)) !== JSON.stringify(at(onDisk, k)),
    )
    if (strangers.length)
      return bad(reply, 422, "Those settings are not valid.", {
        errors: strangers.map((k) => `${k}: not a setting Codehouse knows`),
      })
    // T-067: what the organisation locked is not changed here, and no push channel is turned on with the phone off.
    const managed = ctx.store.current?.managedSettings
    const locked = lockedChanges(managed, (onDisk ?? {}) as Record<string, unknown>, parsed.data as Record<string, unknown>)
    if (locked.length) return bad(reply, 403, managedRefusal(managed, `${locked.join(", ")} cannot be changed here`))
    if (!phoneAllowed(managed) && (parsed.data.push?.ntfy?.enabled || parsed.data.push?.slack?.enabled))
      return bad(reply, 403, managedRefusal(managed, "the phone and push channels are turned off"))
    // D-024: a project no longer strict about its tests (a built-in ask switched off) waits ten minutes after its
    // phrase; meanwhile both stay strict, so the rest of the save, tightening included, applies at once.
    const loosened = testStrictnessRemoved((onDisk as { testIntegrity?: unknown }).testIntegrity, parsed.data.testIntegrity)
    let pending: Record<string, unknown> | undefined
    if (loosened.length) {
      const r = await deferLoosening(ctx, "test-integrity", `stop being strict about tests in ${loosened.join(", ")}`, { value: parsed.data.testIntegrity ?? null }, "test-integrity", (req.query as { loosen?: unknown }).loosen)
      if (r.status !== 202) return reply.code(r.status).send(r.body)
      pending = r.body.pending as Record<string, unknown>
      const union = strictUnion((onDisk as { testIntegrity?: unknown }).testIntegrity, parsed.data.testIntegrity)
      if (union) parsed.data.testIntegrity = union as typeof parsed.data.testIntegrity
    }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const before = ctx.config()
    await writeFileAtomic(file, JSON.stringify(parsed.data, null, 2) + "\n")
    const changed = (Object.keys(parsed.data) as Array<keyof GatehouseConfig>).filter(
      (k) => JSON.stringify(parsed.data[k]) !== JSON.stringify(before[k]),
    )
    // These are read each time they are used, so a saved change takes effect at once. The rest are read at
    // start-up and need a restart.
    const running = ctx.config() as Record<string, unknown>
    for (const k of LIVE_SETTINGS) {
      if (k in parsed.data) running[k] = (parsed.data as Record<string, unknown>)[k]
      else delete running[k]
    }
    // The names of what changed are recorded, never the values: the redaction list is itself sensitive.
    const recorded = await ctx.audit.record({
      session: "desktop",
      event: "settings_changed",
      channel: "desktop",
      tool: "settings",
      input: { changed },
      verdict: {
        outcome: "allow",
        ruleId: "settings-changed",
        reason: "Settings were saved from the desktop.",
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: policyHash(),
      },
      latencyMs: 0,
    })
    const needsRestart = changed.filter((k) => !(LIVE_SETTINGS as readonly string[]).includes(k))
    return {
      ok: true,
      restartRequired: needsRestart.length > 0,
      changed,
      appliedNow: changed.filter((k) => !needsRestart.includes(k)),
      audited: recorded,
      ...(pending ? { pending } : {}),
    }
  })
}

/**
 * Artifacts (owner's plan, W1-09, ADR 0003). The list, the export and the address to show one come from the desktop
 * admin API. The page itself is served outside /api so a frame can load it, but only by an unguessable address, and
 * always with the sandbox headers: no network, no way out of its frame.
 */
function registerArtifactRoutes(app: FastifyInstance, ctx: AdminContext): void {
  const store = ctx.artifacts
  if (!store) return
  const addresses = new Map<string, { session: string; artifact: string; version: number }>()
  const failure = (reply: FastifyReply, e: unknown) => {
    if (!(e instanceof ArtifactError)) throw e
    return bad(reply, e.code === "missing" ? 404 : 422, e.message)
  }

  app.get("/api/artifacts", async (req, reply) => {
    try {
      return { artifacts: store.list(String((req.query as { session?: string }).session ?? "")) }
    } catch (e) {
      return failure(reply, e)
    }
  })
  app.post("/api/artifacts/open", async (req, reply) => {
    const b = (req.body ?? {}) as { session?: unknown; artifact?: unknown; version?: unknown }
    try {
      const session = String(b.session ?? "")
      const artifact = String(b.artifact ?? "")
      const version = Number(b.version)
      if (!store.read(session, artifact, version))
        return bad(reply, 404, "There is no such artifact.")
      for (const [t, a] of addresses)
        if (a.session === session && a.artifact === artifact && a.version === version)
          return { path: `/artifact/${t}` }
      const token = randomBytes(24).toString("base64url")
      addresses.set(token, { session, artifact, version })
      return { path: `/artifact/${token}` }
    } catch (e) {
      return failure(reply, e)
    }
  })
  app.get("/api/artifacts/export", async (req, reply) => {
    const q = req.query as { session?: string; artifact?: string; version?: string }
    try {
      const a = store.read(String(q.session ?? ""), String(q.artifact ?? ""), Number(q.version))
      if (!a) return bad(reply, 404, "There is no such artifact.")
      return {
        name: `${q.artifact}-v${Number(q.version)}.${EXT[a.kind]}`,
        content: a.content,
        kind: a.kind,
      }
    } catch (e) {
      return failure(reply, e)
    }
  })
  // The artifact: whatever the Host stored, with the sandbox headers and nothing else.
  app.get("/artifact/:token", async (req, reply) => {
    const a = addresses.get((req.params as { token: string }).token)
    const found = a ? store.read(a.session, a.artifact, a.version) : undefined
    if (!found) return bad(reply, 404, "This artifact has ended.")
    const origin = `http://${String(req.headers.host ?? "127.0.0.1")}`
    for (const [k, v] of Object.entries(artifactHeaders(origin, found.kind))) reply.header(k, v)
    // C-057: a diagram is drawn by a page made around its source. T-058: an HTML page follows the theme asked for.
    const q = (req.query as { theme?: string }).theme
    const theme = q === "dark" || q === "light" ? q : undefined
    return reply.send(found.kind === "mermaid" ? mermaidPage(found.content, readMermaidLib()) : found.kind === "html" ? themedHtml(found.content, theme) : found.content)
  })
}

/**
 * T-135: the secrets sessions ask you for. Under /api, so only the desktop (with the per-launch token) sees or answers
 * them: never the phone or a push channel. Recorded by name, never by value.
 */
function registerSecretRequestRoutes(app: FastifyInstance, ctx: AdminContext): void {
  const secrets = ctx.secretRequests
  if (!secrets) return
  app.get("/api/secret-requests", async () => ({ requests: secrets.pending() }))
  app.post("/api/secret-requests/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id
    const b = (req.body ?? {}) as { value?: unknown; decline?: unknown }
    const asked = secrets.pending().find((x) => x.id === id)
    if (!asked) return bad(reply, 404, "That request is no longer waiting.")
    const value = b.decline === true ? undefined : typeof b.value === "string" ? b.value : ""
    const why = secrets.answer(id, value)
    if (why) return bad(reply, 422, why)
    await ctx.audit.record({
      session: asked.sessionId,
      event: value === undefined ? "secret_declined" : "secret_given",
      channel: "desktop",
      tool: "secrets",
      input: { name: asked.name },
      verdict: {
        outcome: value === undefined ? "deny" : "allow",
        ruleId: "secret-answer",
        reason: value === undefined ? `You declined to give ${asked.name}.` : `You gave ${asked.name} for one command.`,
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: ctx.store.current?.hash ?? "",
      },
      latencyMs: 0,
    })
    return { ok: true }
  })
}

/**
 * T-124: the command line. Switched on and off from the desktop only; on, its own routes take its own token (cli-access.ts).
 * It stays on across restarts while its sealed token is there.
 */
function registerCliAccessRoutes(app: FastifyInstance, ctx: AdminContext): void {
  const cli = ctx.cli
  if (!cli) return
  registerCliRoutes(app, cli.access, cli.deps)
  app.addHook("onListen", async () => {
    const port = (app.server.address() as { port?: number } | null)?.port
    if (port) await cli.access.resumeIfOn(port).catch(() => undefined)
  })
  const record = (on: boolean) =>
    ctx.audit.record({
      session: "desktop",
      event: "cli_access",
      channel: "desktop",
      tool: "settings",
      input: { on },
      verdict: { outcome: "allow", ruleId: "cli-access", reason: on ? "The command line was switched on from the desktop." : "The command line was switched off from the desktop.", risk: 0, decidedBy: "human-desktop", policyHash: ctx.store.current?.hash ?? "" },
      latencyMs: 0,
    })
  app.get("/api/cli-access", async () => ({ on: cli.access.enabled }))
  app.put("/api/cli-access", async (req, reply) => {
    const on = (req.body as { on?: unknown } | undefined)?.on
    if (typeof on !== "boolean") return bad(reply, 400, "Say on or off.")
    if (on) await cli.access.enable(req.socket.localPort ?? 0)
    else cli.access.disable()
    await record(on)
    return { on: cli.access.enabled }
  })
}

/** B34: routines. Desktop only; each change is recorded by id, name and when, never by the prompt. */
function registerRoutineRoutes(app: FastifyInstance, ctx: AdminContext): void {
  const routines = ctx.routines
  if (!routines) return
  const deliveries = new HookDeliveries()
  const record = (event: string, input: Record<string, unknown>) =>
    ctx.audit.record({
      session: "desktop",
      event,
      channel: "desktop",
      tool: "routines",
      input,
      verdict: {
        outcome: "allow",
        ruleId: event.replaceAll("_", "-"),
        reason: "Your routines were changed from the desktop.",
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: ctx.store.current?.hash ?? "",
      },
      latencyMs: 0,
    })
  // T-120: the token's hash stays on the Host; the screen is told only that there is one.
  app.get("/api/routines", async () => ({
    routines: routines.list().map((r) =>
      r.trigger?.kind === "webhook" ? { ...r, trigger: { kind: "webhook", hasToken: !!r.trigger.tokenHash, ...(r.trigger.filters ? { filters: r.trigger.filters } : {}) } } : r,
    ),
  }))
  // G23: the review inbox: each run's session, newest first. The screen adds its state, changes and cost.
  app.get("/api/routines/runs", async () => ({ runs: routines.runs() }))
  app.put("/api/routines", async (req, reply) => {
    try {
      const before = routines.list().find((x) => x.id === (req.body as { id?: unknown } | undefined)?.id)
      const r = await routines.put((req.body ?? {}) as Partial<Routine>)
      // T-120: a new routine started by a call gets its token now, shown this once.
      const token = r.trigger?.kind === "webhook" && !r.trigger.tokenHash ? await routines.newHookToken(r.id) : undefined
      await record("routine_saved", {
        id: r.id,
        name: r.name,
        time: r.time,
        days: r.days,
        extreme: r.extreme === true,
        worktree: r.worktree === true,
        phone: r.phone === true,
        enabled: r.enabled,
        ...(r.once ? { once: r.once } : {}),
        ...(r.into ? { into: r.into } : {}),
        ...(r.trigger ? { trigger: r.trigger.kind } : {}),
        ...(r.trigger?.kind === "webhook" && r.trigger.filters ? { filters: r.trigger.filters.length } : {}),
        ...(token ? { token: before ? "replaced" : "made" } : {}),
      })
      const { trigger, ...shown } = r
      return {
        routine: trigger?.kind === "webhook" ? { ...shown, trigger: { kind: "webhook", hasToken: true, ...(trigger.filters ? { filters: trigger.filters } : {}) } } : r,
        ...(token ? { token } : {}),
      }
    } catch (e) {
      if (e instanceof RoutineError) return bad(reply, 422, e.message)
      throw e
    }
  })
  // T-122: drafts a session made. You save one through PUT /api/routines like your own; dismissing is recorded.
  app.get("/api/routines/drafts", async () => ({ drafts: ctx.routineDrafts?.list() ?? [] }))
  app.delete("/api/routines/drafts/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id
    if (!ctx.routineDrafts?.remove(id)) return bad(reply, 404, "There is no such draft.")
    await record("routine_draft_dismissed", { id })
    return { ok: true }
  })
  // T-119: Run now, recorded as yours.
  app.post("/api/routines/:id/run", async (req, reply) => {
    const id = (req.params as { id: string }).id
    if (!routines.list().some((r) => r.id === id)) return bad(reply, 404, "There is no such routine.")
    if (!ctx.runRoutine) return bad(reply, 501, "Running a routine now is not available here.")
    try {
      return { sessionId: await ctx.runRoutine(id) }
    } catch (e) {
      return bad(reply, 409, `It did not start: ${(e as Error).message}`)
    }
  })
  // T-120: a new token for a routine started by a call; the old one stops working.
  app.post("/api/routines/:id/hook-token", async (req, reply) => {
    const id = (req.params as { id: string }).id
    const token = await routines.newHookToken(id)
    if (!token) return bad(reply, 404, "That routine is not started by a call.")
    await record("routine_hook_token", { id })
    return { token }
  })
  /**
   * T-120: a program on this computer starts a routine. Not under /api, so the per-launch token is not needed, but the
   * Host and Origin checks apply as to every request (invariant 7) and the routine's own token is. Every call naming a
   * routine started this way is recorded, refused or not; one naming nothing gets the same answer as a wrong token.
   */
  app.post("/hook/:id", { bodyLimit: MAX_BODY }, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const r = routines.list().find((x) => x.id === id && x.trigger?.kind === "webhook")
    const presented = extractToken(req.headers)
    const trigger = r?.trigger?.kind === "webhook" ? r.trigger : undefined
    const hook = (outcome: "allow" | "deny", why: string, extra: Record<string, unknown> = {}) =>
      ctx.audit.record({
        session: "desktop",
        event: "routine_hook",
        channel: "host",
        tool: "routines",
        input: { id, via: "webhook", ...extra },
        verdict: { outcome, ruleId: "routine-hook", reason: why, risk: 0, decidedBy: "rules", policyHash: ctx.store.current?.hash ?? "" },
        latencyMs: 0,
      })
    if (!r || !trigger) return bad(reply, 401, "unauthorized")
    if (!trigger.tokenHash || presented === undefined || !secretsEqual(hashHookToken(presented), trigger.tokenHash)) {
      await hook("deny", "A call to a routine's address without its token was refused.")
      return bad(reply, 401, "unauthorized")
    }
    const body = req.body ?? {}
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      await hook("deny", "A call to a routine's address was refused: its body was not a JSON object.")
      return bad(reply, 400, "The body must be a JSON object.")
    }
    if (!r.enabled) {
      await hook("deny", `A call to ${r.name} was refused: the routine is off.`)
      return reply.code(202).send({ started: false, reason: "off" })
    }
    if (!passes(body, trigger.filters ?? [])) {
      await hook("allow", `A call to ${r.name} did not pass its filters, so nothing started.`, { result: "filtered" })
      return reply.code(202).send({ started: false, reason: "filtered" })
    }
    if (!deliveries.first(id, deliveryKey(req.headers as Record<string, unknown>, JSON.stringify(body)))) {
      await hook("allow", `A call to ${r.name} repeated one from the last day, so nothing started again.`, { result: "duplicate" })
      return reply.code(200).send({ started: false, reason: "duplicate" })
    }
    if (!ctx.fireHook) return bad(reply, 503, "Routines are not running yet.")
    const result = ctx.fireHook(id, body)
    await hook(result === "capped" ? "deny" : "allow", `A call to ${r.name}: ${result === "starting" ? "it starts" : result === "held" ? "held until the gap between runs is over" : "refused, it already ran its number of times today"}.`, { result })
    return reply.code(result === "capped" ? 429 : 202).send({ started: result === "starting", reason: result })
  })
  app.delete("/api/routines/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id
    if (!(await routines.remove(id))) return bad(reply, 404, "There is no such routine.")
    await record("routine_removed", { id })
    return { ok: true }
  })
}

/**
 * What chats remember (owner's plan, W1-08): look, add, edit, forget, export and import. Desktop only. Each change is
 * recorded by id, scope and size, never by what it says.
 */
function registerMemoryRoutes(app: FastifyInstance, ctx: AdminContext): void {
  const memory = ctx.memory
  if (!memory) return
  const record = (event: string, input: Record<string, unknown>) =>
    ctx.audit.record({
      session: "desktop",
      event,
      channel: "desktop",
      tool: "memory",
      input,
      verdict: {
        outcome: "allow",
        ruleId: event.replaceAll("_", "-"),
        reason: "What chats remember was changed from the desktop.",
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: ctx.store.current?.hash ?? "",
      },
      latencyMs: 0,
    })
  const failure = (reply: FastifyReply, e: unknown) => {
    if (!(e instanceof MemoryError)) throw e
    return bad(reply, e.code === "missing" ? 404 : e.code === "full" ? 409 : 422, e.message)
  }
  const scopeOf = (v: unknown): MemoryScope =>
    typeof v !== "string" || v === "" || v === "everyone"
      ? { kind: "global" }
      : { kind: "project", name: v }
  const label = (s: MemoryScope) => (s.kind === "global" ? "everyone" : s.name)

  app.get("/api/memory", async () => ({
    everyone: memory.list({ kind: "global" }),
    projects: Object.fromEntries(
      memory.projects().map((p) => [p, memory.list({ kind: "project", name: p })]),
    ),
  }))
  app.post("/api/memory", async (req, reply) => {
    const b = (req.body ?? {}) as { scope?: unknown; topic?: unknown; text?: unknown }
    try {
      const scope = scopeOf(b.scope)
      const e = await memory.add(scope, String(b.topic ?? ""), String(b.text ?? ""), "you")
      await record("memory_written", {
        id: e.id,
        scope: label(scope),
        topic: e.topic,
        characters: e.text.length,
        by: "you",
      })
      return { entry: e }
    } catch (e) {
      return failure(reply, e)
    }
  })
  app.put("/api/memory/:id", async (req, reply) => {
    const id = String((req.params as { id?: string }).id ?? "")
    const b = (req.body ?? {}) as { topic?: unknown; text?: unknown }
    try {
      const e = await memory.update(id, {
        ...(typeof b.topic === "string" ? { topic: b.topic } : {}),
        ...(typeof b.text === "string" ? { text: b.text } : {}),
      })
      await record("memory_edited", { id, topic: e.topic, characters: e.text.length })
      return { entry: e }
    } catch (e) {
      return failure(reply, e)
    }
  })
  app.delete("/api/memory/:id", async (req, reply) => {
    const id = String((req.params as { id?: string }).id ?? "")
    try {
      const removed = await memory.remove(id)
      await record("memory_forgotten", { id, topic: removed.topic, by: "you" })
      return { ok: true }
    } catch (e) {
      return failure(reply, e)
    }
  })
  app.get("/api/memory-export", async () => ({ markdown: memory.exportMarkdown() }))
  app.post("/api/memory-import", async (req, reply) => {
    const md = (req.body as { markdown?: unknown } | null)?.markdown
    if (typeof md !== "string") return bad(reply, 422, "Send the memory as Markdown text.")
    if (md.length > 2_000_000) return bad(reply, 413, "That file is too large to import.")
    const r = await memory.importMarkdown(md)
    await record("memory_imported", r)
    return r
  })
}

/**
 * Chat projects (owner's plan, W1-07): their instructions and knowledge files. Desktop only, like Settings. A change
 * is recorded by name and size, never by content: instructions can hold anything.
 */
function registerProjectRoutes(app: FastifyInstance, ctx: AdminContext): void {
  const projects = ctx.projects
  if (!projects) return
  const record = (event: string, input: Record<string, unknown>) =>
    ctx.audit.record({
      session: "desktop",
      event,
      channel: "desktop",
      tool: "projects",
      input,
      verdict: {
        outcome: "allow",
        ruleId: event.replaceAll("_", "-"),
        reason: "A chat project was changed from the desktop.",
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: ctx.store.current?.hash ?? "",
      },
      latencyMs: 0,
    })
  const failure = (reply: FastifyReply, e: unknown) => {
    if (!(e instanceof ProjectError)) throw e
    const status =
      e.code === "missing" ? 404 : e.code === "exists" ? 409 : e.code === "too-big" ? 413 : 422
    return bad(reply, status, e.message)
  }
  const nameOf = (req: { params: unknown }) => String((req.params as { name?: string }).name ?? "")

  app.get("/api/projects", async () => ({ projects: projects.list() }))
  app.post("/api/projects", async (req, reply) => {
    try {
      const made = projects.create(String((req.body as { name?: unknown } | null)?.name ?? ""))
      await record("project_created", { project: made.name })
      return { project: made }
    } catch (e) {
      return failure(reply, e)
    }
  })
  app.get("/api/projects/:name", async (req, reply) => {
    try {
      const p = projects.get(nameOf(req))
      return p ? { project: p } : bad(reply, 404, "There is no such project.")
    } catch (e) {
      return failure(reply, e)
    }
  })
  app.delete("/api/projects/:name", async (req, reply) => {
    try {
      projects.remove(nameOf(req))
      await record("project_deleted", { project: nameOf(req) })
      return { ok: true }
    } catch (e) {
      return failure(reply, e)
    }
  })
  // B17: the providers this project's chats may use; null for every one. Recorded, like every project change.
  app.put("/api/projects/:name/providers", async (req, reply) => {
    try {
      const list = (req.body as { providers?: unknown } | null)?.providers
      if (
        list !== null &&
        !(
          Array.isArray(list) && list.every((p) => (PROVIDER_IDS as readonly unknown[]).includes(p))
        )
      )
        return bad(
          reply,
          422,
          `Send providers as a list of ${PROVIDER_IDS.join(" and ")}, or null.`,
        )
      await projects.setProviders(nameOf(req), (list as ProviderId[] | null) ?? undefined)
      await record("project_providers_changed", { project: nameOf(req), providers: list ?? "all" })
      return { ok: true }
    } catch (e) {
      return failure(reply, e)
    }
  })
  app.put("/api/projects/:name/instructions", async (req, reply) => {
    try {
      const text = (req.body as { text?: unknown } | null)?.text
      if (typeof text !== "string") return bad(reply, 422, "Send the instructions as text.")
      await projects.setInstructions(nameOf(req), text)
      await record("project_instructions_changed", {
        project: nameOf(req),
        characters: text.length,
      })
      return { ok: true }
    } catch (e) {
      return failure(reply, e)
    }
  })
  app.post("/api/projects/:name/files", async (req, reply) => {
    try {
      const body = req.body as { name?: unknown; base64?: unknown } | null
      if (typeof body?.name !== "string" || typeof body.base64 !== "string")
        return bad(reply, 422, "Send the file's name and its content.")
      const file = await projects.addFile(
        nameOf(req),
        body.name,
        Buffer.from(body.base64, "base64"),
      )
      await record("project_file_added", {
        project: nameOf(req),
        file: file.name,
        bytes: file.size,
      })
      return { file }
    } catch (e) {
      return failure(reply, e)
    }
  })
  app.delete("/api/projects/:name/files/:file", async (req, reply) => {
    try {
      const file = String((req.params as { file?: string }).file ?? "")
      projects.removeFile(nameOf(req), file)
      await record("project_file_removed", { project: nameOf(req), file })
      return { ok: true }
    } catch (e) {
      return failure(reply, e)
    }
  })
}

/** Pairing and device management for the Devices page. Desktop only: the phone has no way to reach these. */
function registerRelayRoutes(app: FastifyInstance, ctx: AdminContext): void {
  const phone = ctx.phone
  if (!phone) return
  const record = (event: string, input: unknown) =>
    ctx.audit.record({
      session: "desktop",
      event,
      channel: "desktop",
      tool: "phone",
      input,
      verdict: {
        outcome: "allow",
        ruleId: event,
        reason: "A phone setting was changed from the desktop.",
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: ctx.store.current?.hash ?? "none",
      },
      latencyMs: 0,
    })
  const guard = async (reply: FastifyReply, fn: () => Promise<unknown>) => {
    try {
      return await fn()
    } catch (e) {
      return bad(reply, 502, (e as Error).message)
    }
  }

  app.get("/api/relay", async () => ({
    health: phone.health(),
    phones: phone.listPhones().map((p) => ({ id: p.id, name: p.name, pairedAt: p.pairedAt })),
  }))

  app.post("/api/relay/setup", (req, reply) =>
    guard(reply, async () => {
      const b = req.body
      if (
        !isObject(b) ||
        typeof b.url !== "string" ||
        typeof b.enrolToken !== "string" ||
        typeof b.name !== "string"
      )
        return bad(reply, 400, "Give url, enrolToken and name.")
      await phone.setup(b.url, b.enrolToken.trim(), b.name.trim().slice(0, 80) || "Laptop")
      await record("relay_setup", { url: new URL(b.url).origin })
      return { ok: true, health: phone.health() }
    }),
  )

  app.post("/api/relay/pairing", (_req, reply) =>
    guard(reply, async () => {
      const v = await phone.startPairing()
      await record("pairing_started", { id: v.id })
      return v
    }),
  )
  app.get("/api/relay/pairing/:id", (req, reply) =>
    guard(reply, () => phone.pairingStatus((req.params as { id: string }).id)),
  )
  app.post("/api/relay/pairing/:id/confirm", (req, reply) =>
    guard(reply, async () => {
      const p = await phone.confirmPairing((req.params as { id: string }).id)
      await record("phone_paired", { phoneId: p.id, name: p.name })
      return { ok: true, phone: { id: p.id, name: p.name, pairedAt: p.pairedAt } }
    }),
  )
  app.delete("/api/relay/pairing/:id", async (req) => {
    phone.cancelPairing((req.params as { id: string }).id)
    return { ok: true }
  })

  app.post("/api/relay/rotate-token", (_req, reply) =>
    guard(reply, async () => {
      await phone.rotateToken()
      await record("relay_token_rotated", {})
      return { ok: true }
    }),
  )

  app.put("/api/relay/phones/:id", (req, reply) =>
    guard(reply, async () => {
      const name = (req.body as { name?: unknown } | null)?.name
      if (typeof name !== "string" || name.trim().length < 1 || name.length > 80)
        return bad(reply, 400, "Give a name of up to 80 characters.")
      return (await phone.renamePhone((req.params as { id: string }).id, name.trim()))
        ? { ok: true }
        : bad(reply, 404, "No such phone.")
    }),
  )
  app.delete("/api/relay/phones/:id", (req, reply) =>
    guard(reply, async () => {
      const id = (req.params as { id: string }).id
      const r = await phone.revokePhone(id)
      if (!r.removed) return bad(reply, 404, "No such phone.")
      await record("phone_revoked", { phoneId: id, relayNotified: r.relayNotified })
      return { ok: true, ...r }
    }),
  )
}

/** Every record newer than `fromMs`, oldest first. Reads newest files first and stops at the first old record. */
export function recordsSince(dir: string, fromMs: number): AuditRecord[] {
  const out: AuditRecord[] = []
  outer: for (const file of listAuditFiles(dir).reverse()) {
    const lines = fs.readFileSync(path.join(dir, file), "utf8").split("\n")
    for (let i = lines.length - 1; i >= 0; i--) {
      const raw = lines[i]
      if (!raw) continue
      try {
        const parsed = AuditRecord.safeParse(JSON.parse(raw))
        if (!parsed.success) continue
        if (Date.parse(parsed.data.ts) < fromMs) break outer
        out.push(parsed.data)
      } catch {
        continue
      }
    }
  }
  return out.reverse()
}

const DAY = 86_400_000

/** Settings the Host reads at the moment it uses them. */
const LIVE_SETTINGS = [
  "expectedOrg",
  "redactTerms",
  // E-086: read each time an export is made or a commit checked.
  "writingRules",
  // E-080: read at each import.
  "redactionListKeys",
  "digestTime",
  // D-087: read at each notice.
  "noticeBatchMinutes",
  // D-089: read each time the review load is asked for.
  "reviewCapacityMinutes",
  "extremeCarryOn",
  "planLimitPause",
  "effortCap",
  "maxSessions",
  "telemetry",
  "spendCapUsd",
  "memoryGovernor",
  "testIntegrity",
  "untrustedFiles",
  "allowedLicences",
  "evidence",
  "mutation",
  "dataClassification",
  "riskBudget",
  "outputStyle",
  "worktreeLocation",
  "pullRequests",
  "browserTools",
  "globalInstructions",
  "profile",
  "keepAwake",
  "phoneAlerts", // Mac fork: relay/service.ts reads it at each notification
  "recapByClaude",
  "extremeRiskLimit",
  // E-094: read by the broker for each request.
  "escalationLadder",
  // O42: read at each ten-minute look.
  "timelineSummaries",
  // E-089: read when the computer goes on battery.
  "pauseExtremeOnBattery",
  // T-134: read each time a credential is needed.
  "onePassword",
  // T-020: read when a session starts.
  "promptSuggestions",
  // T-024: read at each hourly look.
  "settleAfterDays",
  // T-128: read for each usage report.
  "modelPricing",
  "forges",
  "worktreeCleanup",
  "titleByClaude",
  "titleInstructions",
  "chatHandoff",
  "chatContinue",
  "providers",
] as const

/** Policy analytics, the digest and suggestions. Read-only except accepting a suggestion, which is desktop only. */
function registerInsightRoutes(app: FastifyInstance, ctx: AdminContext): void {
  app.get("/api/analytics", async (req) => {
    const days = Math.min(
      90,
      Math.max(1, Number((req.query as { days?: string }).days ?? 30) || 30),
    )
    const to = Date.now()
    return computeAnalytics(recordsSince(ctx.auditDir, to - days * DAY), to - days * DAY, to)
  })

  // D-072: what went wrong in agent work over the last days, by kind, project and model, from the audit alone.
  app.get("/api/insights/failures", async (req) => {
    const days = Math.min(90, Math.max(1, Number((req.query as { days?: string }).days ?? 30) || 30))
    const to = Date.now()
    const records = recordsSince(ctx.auditDir, to - days * DAY)
    // D-078: with each model's claim calibration.
    return { days, ...failureTaxonomy(records), calibration: claimCalibration(records) }
  })

  // D-083: the words a session's project names things with, and two words used for one thing.
  app.get("/api/insights/glossary", async (req, reply) => {
    const id = String((req.query as { session?: string }).session ?? "")
    const cwd = ctx.sessionCwd?.(id)
    if (!cwd) return reply.code(404).send({ error: "That session is not running." })
    const root = TestLocks.rootOf(cwd)
    return glossary(root, await listFiles(root).catch(() => [] as string[]))
  })

  // D-090: Claude's measured time per change in this period, against your own baseline, the period before it.
  app.get("/api/insights/time", async (req, reply) => {
    if (!ctx.usage) return bad(reply, 501, "Usage is not available here.")
    const days = Math.min(90, Math.max(7, Number((req.query as { days?: string }).days ?? 30) || 30))
    const to = Date.now()
    const split = to - days * DAY
    const records = recordsSince(ctx.auditDir, to - 2 * days * DAY)
    const window = (from: number, until: number) =>
      outcomes(
        applyPricing(ctx.usage!.report(localDay(new Date(from + DAY)), localDay(new Date(until))), ctx.config().modelPricing),
        records.filter((r) => {
          const t = Date.parse(r.ts)
          return t > from && t <= until
        }),
      )
    return measuredTime(window(split, to), window(to - 2 * days * DAY, split), days)
  })

  // D-077: the instruction blocks a session never used, with the project's recent sessions for comparison.
  app.get("/api/insights/context", async (req, reply) => {
    const id = String((req.query as { session?: string }).session ?? "")
    const cwd = ctx.sessionCwd?.(id)
    if (!cwd) return reply.code(404).send({ error: "That session is not running." })
    const root = TestLocks.rootOf(cwd)
    const norm = (p: string) => path.resolve(p).replace(/\\/g, "/").toLowerCase()
    const inside = (p?: string) => !!p && (norm(p) === norm(root) || norm(p).startsWith(norm(root) + "/"))
    const recent = new Map<string, AuditRecord[]>()
    for (const r of recordsSince(ctx.auditDir, Date.now() - 30 * DAY))
      if (r.session !== id && r.session !== "desktop" && inside(r.cwd)) recent.set(r.session, [...(recent.get(r.session) ?? []), r])
    // D-082: and what the instructions name that the project no longer has.
    const stale = await staleInstructions(root, await listFiles(root).catch(() => [] as string[]))
    return { root: path.basename(root), ...contextReport(projectBlocks(root), sessionRecords(ctx.auditDir, id), recent), stale }
  })

  // D-076 and D-100: cost per accepted change, rework included, and estimates from that history.
  app.get("/api/insights/outcomes", async (req, reply) => {
    if (!ctx.usage) return bad(reply, 501, "Usage is not available here.")
    const days = Math.min(90, Math.max(1, Number((req.query as { days?: string }).days ?? 30) || 30))
    const to = Date.now()
    const report = applyPricing(ctx.usage.report(localDay(new Date(to - (days - 1) * DAY)), localDay(new Date(to))), ctx.config().modelPricing)
    return { days, ...outcomes(report, recordsSince(ctx.auditDir, to - days * DAY)) }
  })

  // D-069: the hotspot map of a session's project: churn from git, complexity, and agent failures from the audit.
  app.get("/api/insights/hotspots", async (req, reply) => {
    const id = String((req.query as { session?: string }).session ?? "")
    const root = ctx.sessionCwd?.(id)
    if (!root) return reply.code(404).send({ error: "That session is not running." })
    const to = Date.now()
    return { root: path.basename(root), hotspots: await hotspots(root, recordsSince(ctx.auditDir, to - 90 * DAY)) }
  })

  // D-051: the personal data flow map of a session's project, a draft, with its legal-review Markdown.
  app.get("/api/insights/personal-data", async (req, reply) => {
    const id = String((req.query as { session?: string }).session ?? "")
    const root = ctx.sessionCwd?.(id)
    if (!root) return reply.code(404).send({ error: "That session is not running." })
    const map = personalDataMap(root, await listFiles(root).catch(() => [] as string[]))
    return { ...map, markdown: legalDraft(map) }
  })

  // D-068: dead code in a session's project, with static and coverage evidence and removal in small slices.
  app.get("/api/insights/dead-code", async (req, reply) => {
    const id = String((req.query as { session?: string }).session ?? "")
    const root = ctx.sessionCwd?.(id)
    if (!root) return reply.code(404).send({ error: "That session is not running." })
    return deadCode(root, await listFiles(root).catch(() => [] as string[]))
  })

  app.get("/api/digest", async () => {
    const to = Date.now()
    const cost = ctx.usage?.snapshot().byDay[localDay(new Date(to))]?.costUsd ?? 0
    return computeDigest(recordsSince(ctx.auditDir, to - DAY), to - DAY, to, cost)
  })

  app.get("/api/suggestions", async () => {
    const policy = ctx.store.current
    const from = Date.now() - 30 * DAY
    const out: Array<{
      candidate: SuggestionCandidate
      preview: string
      approvals: number
      lastSeen: string
      ruleIds: string[]
    }> = []
    for (const g of groupApprovals(recordsSince(ctx.auditDir, from), from).slice(0, 40)) {
      // The same check the Remember button uses: one exact command or file, never a chain, never a deny.
      const check = await checkRemember(
        ctx.engine,
        policy,
        { toolName: g.tool, input: g.input },
        { cwd: g.cwd },
        ctx.pwsh,
      )
      if (check.ok)
        out.push({
          candidate: check.candidate,
          preview: check.preview,
          approvals: g.approvals,
          lastSeen: g.lastSeen,
          ruleIds: g.ruleIds,
        })
      if (out.length >= 20) break
    }
    return out
  })

  app.post("/api/suggestions/accept", async (req, reply) => {
    const b = req.body as {
      candidate?: { tool?: unknown; command?: unknown; path?: unknown }
      cwd?: unknown
      rememberFor?: unknown
    } | null
    const c = b?.candidate
    if (
      !c ||
      typeof c.tool !== "string" ||
      (typeof c.command !== "string") === (typeof c.path !== "string")
    )
      return bad(reply, 400, "Give a candidate with a tool and exactly one of command or path.")
    const localPath = ctx.loadOptions.localPath
    if (!localPath) return bad(reply, 404, "There is no local rules file.")
    // Rebuild the call from the candidate and check it again: what is added is only ever what the Remember check allows.
    const input =
      typeof c.command === "string" ? { command: c.command } : { file_path: c.path as string }
    const cwd =
      typeof b?.cwd === "string" && b.cwd
        ? b.cwd
        : (ctx.store.current?.rules.workspaceRoots[0] ?? process.cwd())
    const check = await checkRemember(
      ctx.engine,
      ctx.store.current,
      { toolName: c.tool, input },
      { cwd },
      ctx.pwsh,
    )
    if (!check.ok) return bad(reply, 422, check.reason)
    // D-015: not while what an open session read mentions it.
    const why = ctx.untrustedMention?.(check.candidate)
    if (why) {
      await ctx.audit
        .record({
          session: "desktop",
          event: "remember_refused_provenance",
          channel: "desktop",
          tool: "policy",
          input: { candidate: check.candidate, from: "suggestion" },
          verdict: { outcome: "deny", ruleId: "remember-provenance", reason: why, risk: 0, decidedBy: "rules", policyHash: ctx.store.current?.hash ?? "" },
          latencyMs: 0,
        })
        .catch(() => false)
      return bad(reply, 409, why.replace("It is allowed this once, not remembered.", "So it is not added."))
    }
    // C-013: like one remembered from a request, it lasts 30 days and only in that folder unless asked otherwise.
    const rememberFor = RememberFor.safeParse(b?.rememberFor)
    const r = await appendRemember(
      localPath,
      check.candidate,
      undefined,
      grantLimitsFor(rememberFor.success ? rememberFor.data : undefined, cwd),
    )
    ctx.store.load()
    await ctx.audit.record({
      session: "desktop",
      event: "remember_added",
      channel: "desktop",
      tool: "policy",
      input: { id: r.id, preview: check.preview, from: "suggestion" },
      verdict: {
        outcome: "allow",
        ruleId: "remember-added",
        reason: "A suggested remember rule was accepted on the desktop.",
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: ctx.store.current?.hash ?? "none",
      },
      latencyMs: 0,
    })
    return { ok: true, id: r.id, added: r.added, preview: check.preview }
  })
}
