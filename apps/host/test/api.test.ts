import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Fastify, { type FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { appendRemember, PolicyEngine, PolicyStore, redact } from "@gatehouse/policy"
import { AuditWriter } from "@gatehouse/shared/audit"
import { GatehouseConfig } from "@gatehouse/shared/node"
import { registerApi, queryAudit, type AdminContext } from "../src/api.js"
import { HostAudit } from "../src/hostaudit.js"

const REPO = path.resolve(import.meta.dirname, "../../..")
let root: string
let app: FastifyInstance
let ctx: AdminContext
let rulesPath: string
let auditDir: string

const verdict = (outcome: "allow" | "deny" | "escalate", ruleId: string) => ({
  outcome,
  ruleId,
  reason: `because ${ruleId}`,
  risk: outcome === "escalate" ? 60 : 5,
  decidedBy: "rules" as const,
  policyHash: "h",
})

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-api-"))
  rulesPath = path.join(root, "rules.yaml")
  fs.copyFileSync(path.join(REPO, "policy", "rules.yaml"), rulesPath)
  auditDir = path.join(root, "audit")
  const store = new PolicyStore({
    rulesPath,
    localPath: path.join(root, "rules.local.yaml"),
    workspaceRootsOverride: [root],
  })
  store.load()
  const writer = new AuditWriter({ dir: auditDir, redact: (v) => redact(v, { terms: [] }) })
  const audit = new HostAudit(writer)
  const engine = new PolicyEngine({ getPolicy: () => store.current })
  const env = { GATEHOUSE_CONFIG: path.join(root, "config.json") } as NodeJS.ProcessEnv
  ctx = {
    engine,
    store,
    pwsh: undefined,
    audit,
    auditDir,
    loadOptions: {
      rulesPath,
      localPath: path.join(root, "rules.local.yaml"),
      workspaceRootsOverride: [root],
    },
    env,
    config: () => GatehouseConfig.parse({}),
    log: () => undefined,
  }
  for (const [tool, input, v, channel, project] of [
    [
      "Read",
      { file_path: path.join(root, "a.txt") },
      verdict("allow", "read-workspace"),
      "approver",
      "alpha",
    ],
    [
      "Bash",
      { command: "npm install left-pad" },
      verdict("escalate", "no-rule"),
      "desktop",
      "alpha",
    ],
    ["Bash", { command: "rm -rf /" }, verdict("deny", "destructive-shell"), "approver", "beta"],
  ] as const) {
    await audit.record({
      session: "s1",
      event: "decision",
      channel,
      tool,
      cwd: root,
      project,
      input,
      verdict: v,
      latencyMs: 3,
    })
  }
  app = Fastify()
  registerApi(app, ctx)
  await app.ready()
})

afterAll(async () => {
  await app.close()
  fs.rmSync(root, { recursive: true, force: true })
})

const get = async (url: string) => (await app.inject({ method: "GET", url })).json()

describe("audit endpoints", () => {
  it("lists newest first and pages with nextBefore", async () => {
    const all = await get("/api/audit?limit=10")
    expect(all.records.map((r: { seq: number }) => r.seq)).toEqual([3, 2, 1])
    const page = await get("/api/audit?limit=2")
    expect(page.records.length).toBe(2)
    expect(page.nextBefore).toBe(2)
    const rest = await get(`/api/audit?limit=2&before=${page.nextBefore}`)
    expect(rest.records.map((r: { seq: number }) => r.seq)).toEqual([1])
    expect(rest.nextBefore).toBeUndefined()
  })

  it("filters by decision, channel, project, rule and text", async () => {
    expect((await get("/api/audit?decision=deny")).records.length).toBe(1)
    expect((await get("/api/audit?channel=desktop")).records[0].tool).toBe("Bash")
    expect((await get("/api/audit?project=alpha")).records.length).toBe(2)
    expect((await get("/api/audit?rule=DESTRUCTIVE")).records.length).toBe(1)
    expect((await get("/api/audit?q=left-pad")).records.length).toBe(1)
    expect((await get("/api/audit?q=nothing-like-this")).records.length).toBe(0)
    expect(queryAudit(auditDir, { limit: 5, session: "other" }).records).toEqual([])
  })

  it("reports an intact chain, then a broken one", async () => {
    const ok = await get("/api/audit/verify")
    expect(ok).toMatchObject({ ok: true, records: 3, problems: [] })
    const file = path.join(
      auditDir,
      fs.readdirSync(auditDir).find((f) => f.endsWith(".jsonl")) as string,
    )
    const text = fs.readFileSync(file, "utf8")
    fs.writeFileSync(file, text.replace("destructive-shell", "destructive-shelx"))
    const broken = await get("/api/audit/verify")
    expect(broken.ok).toBe(false)
    expect(broken.problems.length).toBeGreaterThan(0)
    fs.writeFileSync(file, text)
  })

  it("exports the log as it is on disk", async () => {
    const res = await app.inject({ method: "GET", url: "/api/audit/export" })
    expect(res.headers["content-type"]).toContain("application/x-ndjson")
    expect(res.headers["content-disposition"]).toContain("attachment")
    expect(res.body.trim().split("\n").length).toBe(3)
  })
})

describe("policy endpoints", () => {
  it("returns the rules file, its hash and the loaded rules", async () => {
    const p = await get("/api/policy")
    expect(p.rulesYaml).toBe(fs.readFileSync(rulesPath, "utf8"))
    expect(p.rulesYamlHash).toMatch(/^[0-9a-f]{64}$/)
    expect(p.rules.allow.length).toBeGreaterThan(0)
    expect(p.status.errors).toEqual([])
  })

  it("tests a command without writing to the audit log", async () => {
    const before = (await get("/api/audit?limit=50")).records.length
    const post = (body: unknown) =>
      app.inject({ method: "POST", url: "/api/policy/test", payload: body as object })
    const r = await post({ toolName: "Bash", input: { command: "git status" }, cwd: root })
    expect(r.statusCode).toBe(200)
    expect(r.json().outcome).toBe("allow")
    const d = await post({
      toolName: "Bash",
      input: { command: "git push --force origin main" },
      cwd: root,
    })
    expect(d.json().outcome).not.toBe("allow")
    expect((await get("/api/audit?limit=50")).records.length).toBe(before)
    for (const bad of [
      {},
      { toolName: "Bash", input: "x", cwd: root },
      { toolName: "", input: {}, cwd: root },
    ]) {
      expect((await post(bad)).statusCode).toBe(400)
    }
  })

  it("replays a candidate against the log and lists what would change", async () => {
    const yaml = fs.readFileSync(rulesPath, "utf8")
    const same = await app.inject({
      method: "POST",
      url: "/api/policy/replay",
      payload: { rulesYaml: yaml },
    })
    expect(same.statusCode).toBe(200)
    expect(same.json().total).toBe(3)
    expect(same.json().changes).toEqual([])
    const bad = await app.inject({
      method: "POST",
      url: "/api/policy/replay",
      payload: { rulesYaml: "version: 1\nnope: [" },
    })
    expect(bad.statusCode).toBe(422)
    expect(bad.json().errors.length).toBeGreaterThan(0)
    expect(
      (await app.inject({ method: "POST", url: "/api/policy/replay", payload: {} })).statusCode,
    ).toBe(400)
  })

  it("activates only a valid file, only on the hash it was based on, and audits it", async () => {
    const p = await get("/api/policy")
    const put = (body: unknown) =>
      app.inject({ method: "PUT", url: "/api/policy/rules", payload: body as object })
    expect((await put({ yaml: "x" })).statusCode).toBe(400)
    expect((await put({ yaml: p.rulesYaml, baseHash: "0".repeat(64) })).statusCode).toBe(409)
    const broken = await put({ yaml: "not: [valid", baseHash: p.rulesYamlHash })
    expect(broken.statusCode).toBe(422)
    expect(fs.readFileSync(rulesPath, "utf8")).toBe(p.rulesYaml)
    const edited = p.rulesYaml + "\n# edited from the desktop\n"
    const ok = await put({ yaml: edited, baseHash: p.rulesYamlHash })
    expect(ok.statusCode).toBe(200)
    expect(ok.json()).toMatchObject({ ok: true, audited: true })
    expect(fs.readFileSync(rulesPath, "utf8")).toBe(edited)
    const last = (await get("/api/audit?limit=1")).records[0]
    expect(last).toMatchObject({ event: "policy_activated", channel: "desktop" })
    expect((await get("/api/audit/verify")).ok).toBe(true)
  })
})

describe("remember rules", () => {
  it("removes one by id and audits it, and says so when it is gone", async () => {
    const localPath = path.join(root, "rules.local.yaml")
    const { id } = await appendRemember(localPath, { tool: "Bash", command: "npm test" })
    ctx.store.load()
    expect((await get("/api/policy")).remember.map((r: { id: string }) => r.id)).toContain(id)
    const post = (body: unknown) =>
      app.inject({ method: "POST", url: "/api/policy/remember/remove", payload: body as object })
    expect((await post({})).statusCode).toBe(400)
    expect((await post({ id: "remember-nope" })).statusCode).toBe(404)
    const ok = await post({ id })
    expect(ok.statusCode).toBe(200)
    expect((await get("/api/policy")).remember.map((r: { id: string }) => r.id)).not.toContain(id)
    expect((await get("/api/audit?limit=1")).records[0]).toMatchObject({
      event: "remember_removed",
    })
    expect((await post({ id })).statusCode).toBe(404)
  })
})

describe("settings endpoints", () => {
  it("rejects unknown keys and bad values", async () => {
    const put = (body: unknown) =>
      app.inject({ method: "PUT", url: "/api/settings", payload: body as object })
    expect((await put({ surprise: 1 })).statusCode).toBe(422)
    expect((await put({ phoneExpiryMs: 5 })).statusCode).toBe(422)
    expect(
      (await put({ quietHours: { start: "25:00", end: "07:00", tz: "Europe/London" } })).statusCode,
    ).toBe(422)
    expect(fs.existsSync(path.join(root, "config.json"))).toBe(false)
  })

  it("saves valid settings, says a restart is needed, and records names but not values", async () => {
    const r = await app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: {
        expectedOrg: "ACN - Premium",
        redactTerms: ["SecretClient"],
        workspaceRoots: ["C:/dev"],
      },
    })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ ok: true, restartRequired: true, audited: true })
    expect(JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8")).expectedOrg).toBe(
      "ACN - Premium",
    )
    const s = await get("/api/settings")
    expect(s.saved.redactTerms).toEqual(["SecretClient"])
    const log = await app.inject({ method: "GET", url: "/api/audit/export" })
    expect(log.body).not.toContain("SecretClient")
    expect(log.body).toContain("redactTerms")
  })
})
