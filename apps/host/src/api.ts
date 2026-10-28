import { createHash } from "node:crypto"
import { registerLibraryRoutes } from "./library-api.js"
import type { FolderPicker } from "./folder-picker.js"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { FastifyInstance, FastifyReply } from "fastify"
import {
  appendRemember,
  checkRemember,
  loadPolicy,
  PolicyEngine,
  PolicyLoadError,
  removeRemember,
  replay,
  type LoadOptions,
  type Policy,
  type PolicyStore,
  type PwshWorker,
  type ReplayRecord,
} from "@gatehouse/policy"
import { AuditRecord, listAuditFiles, verifyAudit } from "@gatehouse/shared/audit"
import {
  configPath,
  GatehouseConfig,
  gatehouseDataDir,
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
import type { PhoneService } from "./relay/service.js"

/**
 * What the Host's admin endpoints need. They serve the desktop UI only: the same guard as the WebSocket
 * (loopback Host header, own Origin, per-launch token) applies, and nothing here is reachable from the phone.
 */
export interface AdminContext {
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
  /** The Approver's supervisor, for the workbench. Absent when the Approver is not run by this Host. */
  approver?: {
    state: () => string
    restart: () => Promise<void>
  }
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

export function replayRecords(dir: string): ReplayRecord[] {
  const records: ReplayRecord[] = []
  for (const file of listAuditFiles(dir).reverse()) {
    const lines = fs.readFileSync(path.join(dir, file), "utf8").split("\n")
    for (let i = lines.length - 1; i >= 0 && records.length < MAX_REPLAY; i--) {
      const raw = lines[i]
      if (!raw) continue
      try {
        const parsed = AuditRecord.safeParse(JSON.parse(raw))
        if (!parsed.success) continue
        const r = parsed.data
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

  app.get("/api/audit/verify", async () => {
    const r = verifyAudit(ctx.auditDir)
    return {
      ...r,
      problems: r.problems.slice(0, 50),
      moreProblems: Math.max(0, r.problems.length - 50),
    }
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
    return await ctx.engine.evaluate({ toolName: b.toolName, input: b.input }, { cwd: b.cwd })
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
  registerInsightRoutes(app, ctx)
  registerLibraryRoutes(app, ctx)

  // Your own pictures for Jean-Claude mode: files in a folder in the data folder. Only picture files, only by a
  // name that is in the listing, so a request can never name a path.
  const picturesDir = () => path.join(gatehouseDataDir(ctx.env), "jcvc")
  const pictureTypes: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
  }
  const listPictures = (): string[] => {
    try {
      return fs
        .readdirSync(picturesDir(), { withFileTypes: true })
        .filter((e) => e.isFile() && path.extname(e.name).toLowerCase() in pictureTypes)
        .filter((e) => fs.statSync(path.join(picturesDir(), e.name)).size <= 8 * 1024 * 1024)
        .map((e) => e.name)
        .sort()
        .slice(0, 60)
    } catch {
      return []
    }
  }
  app.get("/api/jcvc/pictures", async () => ({ names: listPictures(), folder: picturesDir() }))
  app.get("/api/jcvc/pictures/:name", async (req, reply) => {
    const name = (req.params as { name: string }).name
    if (!listPictures().includes(name)) return bad(reply, 404, "No such picture.")
    return reply
      .header("cache-control", "no-store")
      .type(pictureTypes[path.extname(name).toLowerCase()] ?? "application/octet-stream")
      .send(fs.readFileSync(path.join(picturesDir(), name)))
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
      running: ctx.config(),
      workspaceRootsInEffect: ctx.store.current?.rules.workspaceRoots ?? [],
      quietHoursInPolicy: ctx.store.current?.rules.quietHours ?? null,
    }
  })

  app.put("/api/settings", async (req, reply) => {
    const parsed = GatehouseConfig.safeParse(req.body)
    if (!parsed.success)
      return bad(reply, 422, "Those settings are not valid.", {
        errors: parsed.error.issues.map((i) => `${i.path.join(".") || "settings"}: ${i.message}`),
      })
    const file = configPath(ctx.env)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const before = ctx.config()
    await writeFileAtomic(file, JSON.stringify(parsed.data, null, 2) + "\n")
    const changed = (Object.keys(parsed.data) as Array<keyof GatehouseConfig>).filter(
      (k) => JSON.stringify(parsed.data[k]) !== JSON.stringify(before[k]),
    )
    // These three are read each time they are used, so a saved change takes effect at once. The rest are read at
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
const LIVE_SETTINGS = ["expectedOrg", "redactTerms", "digestTime"] as const

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
    const r = await appendRemember(localPath, check.candidate)
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
