import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import Fastify, { type FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { appendRemember, PolicyEngine, PolicyStore, redact } from "@gatehouse/policy"
import { AuditWriter } from "@gatehouse/shared/audit"
import { GatehouseConfig } from "@gatehouse/shared/node"
import { registerApi, queryAudit, regressionsOf, type AdminContext } from "../src/api.js"
import { HostAudit } from "../src/hostaudit.js"
import { AI_MARK, ArtifactStore } from "../src/artifacts.js"
import { MemoryStore } from "../src/memory.js"
import { ProjectStore } from "../src/projects.js"
import { UsageStore } from "../src/usage.js"

/** What every page Claude saves starts with (B38). */
const MARKED = `<meta name="generator" content="${AI_MARK}">\n`

const REPO = path.resolve(import.meta.dirname, "../../..")
let root: string
let app: FastifyInstance
let ctx: AdminContext
let rulesPath: string
let auditDir: string
// The real Host keeps one config object and reads it as it goes, so the test does too.
const runningConfig = GatehouseConfig.parse({})

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
    config: () => runningConfig,
    log: () => undefined,
    projects: new ProjectStore(path.join(root, "projects")),
    memory: new MemoryStore(path.join(root, "memory")),
    artifacts: new ArtifactStore(path.join(root, "artifacts")),
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

  it("exports a bundle that can be checked, as a zip, and records that it did (G30)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/audit/bundle" })
    expect(res.statusCode).toBe(200)
    expect(res.headers["content-type"]).toContain("application/zip")
    expect(res.headers["content-disposition"]).toMatch(/codehouse-audit-\d{4}-\d{2}-\d{2}\.zip/)
    expect(res.rawPayload.subarray(0, 2).toString()).toBe("PK")
    const log = await app.inject({ method: "GET", url: "/api/audit/export" })
    expect(log.body).toContain('"event":"audit_exported"')
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
    // D-020: with how it was decided and what would change it.
    expect(r.json().explain).toMatchObject({ fixed: false, change: expect.stringMatching(/allow rule/) })
    expect(r.json().explain.trace[0]).toMatchObject({ stage: "Floor", result: "passed" })
    expect((await get("/api/audit?limit=50")).records.length).toBe(before)
    for (const bad of [
      {},
      { toolName: "Bash", input: "x", cwd: root },
      { toolName: "", input: {}, cwd: root },
    ]) {
      expect((await post(bad)).statusCode).toBe(400)
    }
  })

  it("explains a request waiting for you, redacted, and says a check beyond the rules asked it (D-020)", async () => {
    const { Broker } = await import("../src/broker.js")
    const broker = new Broker({ phoneExpiryMs: 60_000, hardTimeoutMs: 120_000, redact: (v) => v })
    const app2 = Fastify()
    registerApi(app2, { ...ctx, broker, config: () => ({ ...ctx.config(), redactTerms: ["AcmeCorp"] }) } as never)
    const ask = (command: string, ruleId: string) =>
      void broker.request({ kind: "permission", sessionId: "s1", toolUseId: ruleId, toolName: "Bash", input: { command }, cwd: root, project: "p", verdict: { outcome: "escalate", ruleId, reason: "because", risk: 50, decidedBy: "rules", policyHash: "h" } })
    try {
      ask("make AcmeCorp", "no-rule")
      ask("make all", "AcmeCorp-check")
      const [plain, beyond] = broker.list()
      const x = (await app2.inject({ method: "GET", url: `/api/pending/${plain!.request.id}/explain` })).json()
      expect(x).toMatchObject({ fixed: false, outcome: "escalate", ruleId: "no-rule", change: expect.stringMatching(/an allow rule covered it/) })
      expect(JSON.stringify(x)).not.toContain("AcmeCorp")
      const y = (await app2.inject({ method: "GET", url: `/api/pending/${beyond!.request.id}/explain` })).json()
      expect(y.trace.at(-1)).toMatchObject({ stage: "Session checks" })
      expect(y.change).toMatch(/^It was asked by .+, a check Codehouse makes beyond the rules/)
      expect(JSON.stringify([y.trace, y.change])).not.toContain("AcmeCorp")
      expect((await app2.inject({ method: "GET", url: "/api/pending/nope/explain" })).statusCode).toBe(404)
    } finally {
      broker.cancelAll()
      await app2.close()
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

  it("refuses rules that would allow what was refused or asked about until you type the phrase, and saves a tightening at once (D-026)", async () => {
    await ctx.audit.record({
      session: "s1",
      event: "decision",
      channel: "approver",
      tool: "Bash",
      cwd: root,
      project: "alpha",
      input: { command: "echo hello" },
      verdict: verdict("escalate", "no-rule"),
      latencyMs: 1,
    })
    const put = (body: unknown) =>
      app.inject({ method: "PUT", url: "/api/policy/rules", payload: body as object })
    let p = await get("/api/policy")
    const looser = p.rulesYaml.replace('"npm test*",', '"npm test*", "echo hello*",')
    expect(looser).not.toBe(p.rulesYaml)
    const blocked = await put({ yaml: looser, baseHash: p.rulesYamlHash })
    expect(blocked.statusCode).toBe(409)
    const reg = blocked.json().regression
    expect(reg.phrase).toBe("allow 1")
    expect(reg.changes).toMatchObject([
      { summary: "Bash: echo hello", before: { outcome: "escalate" }, after: { outcome: "allow", ruleId: "safe-shell" } },
    ])
    expect(fs.readFileSync(rulesPath, "utf8")).toBe(p.rulesYaml)
    expect((await get("/api/audit?limit=1")).records[0]).toMatchObject({ event: "policy_regression_blocked" })
    // The wrong phrase saves nothing.
    expect((await put({ yaml: looser, baseHash: p.rulesYamlHash, confirm: "allow 2" })).statusCode).toBe(409)
    const ok = await put({ yaml: looser, baseHash: p.rulesYamlHash, confirm: "allow 1" })
    expect(ok.statusCode).toBe(200)
    expect((await get("/api/audit?limit=2")).records.map((r: { event: string }) => r.event)).toEqual([
      "policy_activated",
      "policy_regression_accepted",
    ])
    // Only the last 90 days count.
    expect((await regressionsOf(ctx, ctx.store.current!)).total).toBeGreaterThan(0)
    expect((await regressionsOf(ctx, ctx.store.current!, Date.now() + 91 * 86_400_000)).total).toBe(0)
    // Taking it out again only tightens: saved at once.
    p = await get("/api/policy")
    const tighter = p.rulesYaml.replace(' "echo hello*",', "")
    expect(tighter).not.toBe(p.rulesYaml)
    expect((await put({ yaml: tighter, baseHash: p.rulesYamlHash })).statusCode).toBe(200)
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

  it("says when each was added and last used, from the audit log (G29)", async () => {
    const localPath = path.join(root, "rules.local.yaml")
    const used = await appendRemember(localPath, { tool: "Bash", command: "npm run dev" })
    const idle = await appendRemember(localPath, { tool: "Bash", command: "npm run lint" })
    ctx.store.load()
    await ctx.audit.record({
      session: "s1",
      event: "evaluate_permission",
      channel: "approver",
      tool: "Bash",
      input: { command: "npm run dev" },
      verdict: {
        outcome: "allow",
        ruleId: used.id,
        reason: "Allowed by rule.",
        risk: 0,
        decidedBy: "rules",
        policyHash: "h",
      },
      latencyMs: 1,
    })
    const rules = (await get("/api/policy/remember/usage")).rules as Array<{
      id: string
      uses: number
      createdAt?: string
      lastUsed?: string
    }>
    const a = rules.find((r) => r.id === used.id)!
    const b = rules.find((r) => r.id === idle.id)!
    expect(a).toMatchObject({ uses: 1 })
    expect(a.lastUsed).toBeTruthy()
    expect(a.createdAt).toBeTruthy()
    expect(b).toMatchObject({ uses: 0 })
    expect(b.lastUsed).toBeUndefined()
  })
})

describe("project actions (T-091)", () => {
  it("lists yours and the repository's, saves yours by project, and runs the repository's only as a Codehouse action", async () => {
    const proj = path.join(root, "shop")
    fs.mkdirSync(path.join(proj, ".git"), { recursive: true })
    fs.mkdirSync(path.join(proj, ".codehouse"), { recursive: true })
    fs.writeFileSync(path.join(proj, ".codehouse", "actions.json"), JSON.stringify({ actions: [{ name: "Seed", command: "npm run seed" }] }))
    const ran: Array<{ command: string; why: string }> = []
    ctx.sessionCwd = (id) => (id === "s1" ? proj : undefined)
    ctx.forgeAct = async (_s, _c, command, why) => {
      ran.push({ command, why })
      return { ran: true, exitCode: 0, output: "seeded 3 rows for Acme", timedOut: false, killed: false, ms: 1 }
    }
    try {
      const get = async () => (await app.inject({ method: "GET", url: "/api/project-actions?session=s1" })).json()
      expect(await get()).toEqual({ project: "shop", own: [], repo: [{ name: "Seed", command: "npm run seed", kind: "run" }] })
      const put = await app.inject({ method: "PUT", url: "/api/project-actions", payload: { session: "s1", actions: [{ name: "Dev", command: "npm run dev", preview: "http://localhost:5173" }] } })
      expect(put.statusCode).toBe(200)
      expect((await get()).own).toEqual([{ name: "Dev", command: "npm run dev", kind: "run", preview: "http://localhost:5173" }])
      expect(JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8")).projectActions).toEqual({ shop: [{ name: "Dev", command: "npm run dev", kind: "run", preview: "http://localhost:5173" }] })
      expect((await app.inject({ method: "PUT", url: "/api/project-actions", payload: { session: "s1", actions: [{ name: "Bad", command: "a\nb" }] } })).statusCode).toBe(422)
      // Yours are never run by the Host: only the repository's, through the card.
      const r = await app.inject({ method: "POST", url: "/api/project-actions/run", payload: { session: "s1", index: 0 } })
      expect(r.json()).toMatchObject({ ran: true, exitCode: 0 })
      expect(ran).toEqual([{ command: "npm run seed", why: 'the repository\'s action "Seed"' }])
      expect((await app.inject({ method: "POST", url: "/api/project-actions/run", payload: { session: "s1", index: 5 } })).statusCode).toBe(404)
      expect((await app.inject({ method: "GET", url: "/api/project-actions?session=s9" })).statusCode).toBe(404)
    } finally {
      delete (ctx as { sessionCwd?: unknown }).sessionCwd
      delete (ctx as { forgeAct?: unknown }).forgeAct
      fs.rmSync(path.join(root, "config.json"), { force: true })
      fs.rmSync(proj, { recursive: true, force: true })
    }
  })
})

describe("Run now (T-119)", () => {
  it("runs a routine at once, recorded as yours by the runner, and says when there is none or it did not start", async () => {
    const { RoutineStore } = await import("../src/routines.js")
    const routines = new RoutineStore(path.join(root, "routines-t119.json"))
    const r = await routines.put({ name: "Tidy", folder: "C:\\dev\\shop", prompt: "Tidy the docs", time: "07:30", days: ["mon"] })
    const asked: string[] = []
    let fail = false
    const app2 = Fastify()
    registerApi(app2, {
      ...ctx,
      routines,
      runRoutine: async (id) => {
        asked.push(id)
        if (fail) throw new Error("the kill switch is on")
        return "s-run-1"
      },
    })
    try {
      const ok = await app2.inject({ method: "POST", url: `/api/routines/${r.id}/run` })
      expect(ok.json()).toEqual({ sessionId: "s-run-1" })
      expect(asked).toEqual([r.id])
      expect((await app2.inject({ method: "POST", url: "/api/routines/nope/run" })).statusCode).toBe(404)
      fail = true
      const no = await app2.inject({ method: "POST", url: `/api/routines/${r.id}/run` })
      expect(no.statusCode).toBe(409)
      expect(no.json().error).toBe("It did not start: the kill switch is on")
    } finally {
      await app2.close()
      fs.rmSync(path.join(root, "routines-t119.json"), { force: true })
    }
  })
})

describe("a routine's address (T-120)", () => {
  it("starts only with its own token, keeps to its filters and repeats, records every call, and never shows the token again", async () => {
    const { RoutineStore } = await import("../src/routines.js")
    const file = path.join(root, "routines-t120.json")
    const routines = new RoutineStore(file)
    const fired: Array<{ id: string; payload: unknown }> = []
    const recorded: Array<{ event: string; input: Record<string, unknown>; verdict: { outcome: string } }> = []
    const app2 = Fastify()
    registerApi(app2, {
      ...ctx,
      routines,
      audit: { ...ctx.audit, record: async (e: never) => (recorded.push(e), true) } as never,
      fireHook: (id, payload) => (fired.push({ id, payload }), "starting"),
    })
    try {
      const made = await app2.inject({
        method: "PUT",
        url: "/api/routines",
        payload: { name: "Triage", folder: "C:\\dev\\shop", prompt: "Triage {{title}}", trigger: { kind: "webhook", filters: [{ field: "action", equals: "opened" }] } },
      })
      const { routine, token } = made.json() as { routine: { id: string; trigger: unknown }; token: string }
      expect(routine.trigger).toEqual({ kind: "webhook", hasToken: true, filters: [{ field: "action", equals: "opened" }] })
      expect(JSON.stringify((await app2.inject({ method: "GET", url: "/api/routines" })).json())).not.toMatch(/tokenHash|[0-9a-f]{64}/)
      const call = (headers: Record<string, string>, payload: object = { action: "opened", title: "Login fails" }) =>
        app2.inject({ method: "POST", url: `/hook/${routine.id}`, headers, payload })
      expect((await call({})).statusCode).toBe(401)
      expect((await call({ authorization: "Bearer wrong" })).statusCode).toBe(401)
      expect((await app2.inject({ method: "POST", url: "/hook/nope", headers: { authorization: `Bearer ${token}` }, payload: {} })).statusCode).toBe(401)
      expect(fired).toEqual([])
      const auth = { authorization: `Bearer ${token}` }
      expect((await call(auth, { action: "closed" })).json()).toEqual({ started: false, reason: "filtered" })
      const ok = await call({ ...auth, "x-github-delivery": "d1" })
      expect(ok.statusCode).toBe(202)
      expect(ok.json()).toEqual({ started: true, reason: "starting" })
      expect(fired).toEqual([{ id: routine.id, payload: { action: "opened", title: "Login fails" } }])
      expect((await call({ ...auth, "x-github-delivery": "d1" })).json()).toEqual({ started: false, reason: "duplicate" })
      expect(fired).toHaveLength(1)
      const hooks = recorded.filter((e) => e.event === "routine_hook")
      expect(hooks.map((e) => [e.verdict.outcome, e.input.result ?? ""])).toEqual([
        ["deny", ""],
        ["deny", ""],
        ["allow", "filtered"],
        ["allow", "starting"],
        ["allow", "duplicate"],
      ])
      expect(JSON.stringify(recorded)).not.toContain(token)
      const fresh = (await app2.inject({ method: "POST", url: `/api/routines/${routine.id}/hook-token` })).json() as { token: string }
      expect((await call({ ...auth, "x-github-delivery": "d2" })).statusCode).toBe(401)
      expect((await call({ authorization: `Bearer ${fresh.token}`, "x-github-delivery": "d2" })).statusCode).toBe(202)
    } finally {
      await app2.close()
      fs.rmSync(file, { force: true })
    }
  })
})

describe("secrets a session asks for (T-135)", () => {
  it("are listed without values and answered on the desktop, recorded by name only", async () => {
    const { SecretRequests } = await import("../src/secret-requests.js")
    const { SecretTerms } = await import("../src/secret-providers.js")
    const secretRequests = new SecretRequests(new SecretTerms())
    const recorded: unknown[] = []
    const app2 = Fastify()
    registerApi(app2, { ...ctx, secretRequests, audit: { ...ctx.audit, record: async (e: never) => (recorded.push(e), true) } as never })
    try {
      const asked = secretRequests.ask("s1", "NPM_TOKEN", "to publish", "npm publish")
      const list = (await app2.inject({ method: "GET", url: "/api/secret-requests" })).json() as { requests: Array<{ id: string; name: string }> }
      expect(list.requests).toMatchObject([{ name: "NPM_TOKEN", sessionId: "s1", command: "npm publish" }])
      const id = list.requests[0]!.id
      expect((await app2.inject({ method: "POST", url: `/api/secret-requests/${id}`, payload: { value: "sk-ant-api03-zzzz" } })).statusCode).toBe(422)
      expect((await app2.inject({ method: "POST", url: `/api/secret-requests/${id}`, payload: { value: "npm_value_123456" } })).json()).toEqual({ ok: true })
      expect(await asked).toBe("given")
      expect((await app2.inject({ method: "POST", url: `/api/secret-requests/${id}`, payload: { value: "again" } })).statusCode).toBe(404)
      expect(JSON.stringify(recorded)).not.toMatch(/npm_value_123456|sk-ant/)
      expect(recorded).toMatchObject([{ event: "secret_given", channel: "desktop", input: { name: "NPM_TOKEN" } }])
    } finally {
      await app2.close()
    }
  })
})

describe("autonomy caps (C-015)", () => {
  const looseningAt = async (name: string) => {
    const { LooseningStore } = await import("../src/loosening.js")
    const clock = { now: Date.parse("2026-11-21T10:00:00Z") }
    const file = path.join(root, `${name}-loosening.json`)
    return { store: new LooseningStore(file, () => clock.now), clock, file }
  }

  it("lists caps, raises one only on your request after the phrase and the wait, recorded, and refuses a raise that is not one", async () => {
    const { AutonomyStore } = await import("../src/autonomy.js")
    const store = new AutonomyStore(path.join(root, "autonomy-c015.json"))
    await store.lower("shop", "default", ["the floor denied 10 calls in 30 days"])
    const recorded: Array<{ event: string; verdict: { decidedBy: string } }> = []
    const l = await looseningAt("c015")
    const app2 = Fastify()
    registerApi(app2, { ...ctx, autonomy: store, loosening: l.store, audit: { ...ctx.audit, record: async (e: never) => (recorded.push(e), true) } as never })
    try {
      expect((await app2.inject({ method: "GET", url: "/api/autonomy" })).json()).toMatchObject({ caps: { shop: { level: "default", by: "record" } } })
      expect((await app2.inject({ method: "POST", url: "/api/autonomy/shop/raise", payload: { level: "plan" } })).statusCode).toBe(409)
      expect((await app2.inject({ method: "POST", url: "/api/autonomy/shop/raise", payload: { level: "sideways" } })).statusCode).toBe(422)
      const asked = await app2.inject({ method: "POST", url: "/api/autonomy/shop/raise", payload: { level: "auto" } })
      expect(asked.statusCode).toBe(409)
      expect(asked.json().loosening).toMatchObject({ phrase: "loosen raise shop to Auto", minutes: 10 })
      const kept = await app2.inject({ method: "POST", url: "/api/autonomy/shop/raise", payload: { level: "auto", confirm: "loosen raise shop to Auto" } })
      expect(kept.statusCode).toBe(202)
      expect(store.capFor("shop")).toBe("default")
      l.clock.now += 9 * 60_000
      await app2.inject({ method: "GET", url: "/api/loosening" })
      expect(store.capFor("shop")).toBe("default")
      l.clock.now += 2 * 60_000
      expect((await app2.inject({ method: "GET", url: "/api/loosening" })).json()).toMatchObject({ pending: [] })
      expect(store.capFor("shop")).toBe("auto")
      expect(recorded.map((r) => r.event)).toEqual(["loosening_requested", "loosening_applied", "autonomy_raised"])
    } finally {
      await app2.close()
      fs.rmSync(path.join(root, "autonomy-c015.json"), { force: true })
      fs.rmSync(l.file, { force: true })
    }
  })

  it("applies a proposal only when you accept it with the phrase, after the wait; with a phone paired, only once the phone confirms (D-019, D-024)", async () => {
    const { AutonomyStore } = await import("../src/autonomy.js")
    const { Broker } = await import("../src/broker.js")
    const file = path.join(root, "autonomy-d019.json")
    const store = new AutonomyStore(file)
    await store.lower("shop", "default", ["the floor denied 10 calls in 30 days"])
    await store.lower("cafe", "acceptEdits", ["you denied 5 calls in 30 days"])
    await store.propose("shop", { from: "default", to: "acceptEdits", reasons: ["clean"] })
    await store.propose("cafe", { from: "acceptEdits", to: "auto", reasons: ["clean"] })
    const recorded: Array<{ event: string; channel: string; verdict: { decidedBy: string } }> = []
    const audit = { ...ctx.audit, record: async (e: never) => (recorded.push(e), true) } as never
    const l = await looseningAt("d019")
    const alone = Fastify()
    registerApi(alone, { ...ctx, autonomy: store, loosening: l.store, audit })
    const broker = new Broker({ phoneExpiryMs: 60_000, hardTimeoutMs: 120_000, redact: (v) => v })
    const paired = Fastify()
    registerApi(paired, { ...ctx, autonomy: store, loosening: l.store, audit, broker, phone: { listPhones: () => [{ id: "p1" }] } as never })
    const later = async () => {
      l.clock.now += 11 * 60_000
      await alone.inject({ method: "GET", url: "/api/loosening" })
    }
    try {
      expect((await alone.inject({ method: "GET", url: "/api/autonomy/proposals" })).json()).toMatchObject({ proposals: { shop: { to: "acceptEdits" } } })
      // No phone: your click with the phrase keeps it; it applies after the wait.
      expect((await alone.inject({ method: "POST", url: "/api/autonomy/shop/accept" })).statusCode).toBe(409)
      const kept = await alone.inject({ method: "POST", url: "/api/autonomy/shop/accept", payload: { confirm: "loosen raise shop to Accept edits" } })
      expect(kept.statusCode).toBe(202)
      expect(kept.json()).toMatchObject({ proposals: { cafe: {} } })
      expect(store.capFor("shop")).toBe("default")
      await later()
      expect(store.caps().shop).toMatchObject({ level: "acceptEdits", by: "you" })
      expect(recorded.at(-1)).toMatchObject({ event: "autonomy_raised", verdict: { decidedBy: "human-desktop" } })
      expect((await alone.inject({ method: "POST", url: "/api/autonomy/shop/accept", payload: { confirm: "x" } })).statusCode).toBe(404)
      // A phone paired: it waits for the phone; an allow from the desktop is refused; the phone's starts the wait.
      const r = await paired.inject({ method: "POST", url: "/api/autonomy/cafe/accept", payload: { confirm: "loosen raise cafe to Auto" } })
      expect(r.statusCode).toBe(202)
      expect(r.json()).toMatchObject({ waitingForPhone: true, confirming: ["cafe"] })
      const pending = broker.list()[0]!
      expect(pending.request).toMatchObject({ toolName: "AutonomyRaise", verdict: { ruleId: "autonomy-raise" } })
      expect(broker.resolve(pending.request.id, { kind: "decision", decision: "allow" }, "desktop")).toMatchObject({ ok: false, reason: "not-allowed-on-channel" })
      expect(broker.resolve(pending.request.id, { kind: "decision", decision: "allow" }, "push")).toMatchObject({ ok: false, reason: "not-allowed-on-channel" })
      expect(broker.resolve(pending.request.id, { kind: "decision", decision: "allow" }, "phone")).toMatchObject({ ok: true })
      await vi.waitFor(() => expect(recorded.some((e) => e.event === "autonomy_raise_accepted" && e.channel === "phone")).toBe(true))
      expect(store.capFor("cafe")).toBe("acceptEdits")
      await later()
      expect(store.capFor("cafe")).toBe("auto")
      // Saying no is recorded and forgets the proposal.
      await store.propose("cafe", { from: "auto", to: "extreme", reasons: ["clean"] })
      expect((await alone.inject({ method: "POST", url: "/api/autonomy/cafe/decline" })).json()).toMatchObject({ proposals: {} })
      expect(recorded.at(-1)).toMatchObject({ event: "autonomy_raise_declined" })
      expect(store.capFor("cafe")).toBe("auto")
    } finally {
      broker.cancelAll()
      await alone.close()
      await paired.close()
      fs.rmSync(file, { force: true })
      fs.rmSync(l.file, { force: true })
    }
  })

  it("refuses to raise when the raise cannot be recorded, or the paired phone cannot be asked (D-019)", async () => {
    const { AutonomyStore } = await import("../src/autonomy.js")
    const file = path.join(root, "autonomy-d019b.json")
    const store = new AutonomyStore(file)
    await store.lower("shop", "default", ["x"])
    await store.propose("shop", { from: "default", to: "acceptEdits", reasons: ["clean"] })
    const l = await looseningAt("d019b")
    const confirm = { confirm: "loosen raise shop to Accept edits" }
    const noAudit = Fastify()
    registerApi(noAudit, { ...ctx, autonomy: store, loosening: l.store, audit: { ...ctx.audit, record: async () => false } as never })
    const noBroker = Fastify()
    registerApi(noBroker, { ...ctx, autonomy: store, loosening: l.store, audit: { ...ctx.audit, record: async () => true } as never, phone: { listPhones: () => [{ id: "p1" }] } as never })
    try {
      expect((await noAudit.inject({ method: "POST", url: "/api/autonomy/shop/accept", payload: confirm })).statusCode).toBe(503)
      expect((await noAudit.inject({ method: "POST", url: "/api/autonomy/shop/raise", payload: { level: "auto", confirm: "loosen raise shop to Auto" } })).statusCode).toBe(503)
      expect((await noBroker.inject({ method: "POST", url: "/api/autonomy/shop/accept", payload: confirm })).statusCode).toBe(503)
      expect(l.store.list()).toEqual([])
      // Even a broker that let an allow through from elsewhere does not raise it: only the phone's answer does.
      const desktopAllow = Fastify()
      const request = vi.fn(async () => ({ outcome: "allow", channel: "desktop", at: "", waitedMs: 1 }))
      registerApi(desktopAllow, { ...ctx, autonomy: store, loosening: l.store, audit: { ...ctx.audit, record: async () => true } as never, broker: { request } as never, phone: { listPhones: () => [{ id: "p1" }] } as never })
      expect((await desktopAllow.inject({ method: "POST", url: "/api/autonomy/shop/accept", payload: confirm })).statusCode).toBe(202)
      await vi.waitFor(() => expect(request).toHaveBeenCalled())
      await new Promise((r) => setTimeout(r, 50))
      expect(l.store.list()).toEqual([])
      expect(store.capFor("shop")).toBe("default")
      await desktopAllow.close()
    } finally {
      await noAudit.close()
      await noBroker.close()
      fs.rmSync(file, { force: true })
      fs.rmSync(l.file, { force: true })
    }
  })
})

describe("the review load (D-089)", () => {
  it("adds up the review the last hour's allowed changes need, each call once, and warns above your capacity", async () => {
    const dir = path.join(root, "audit-d089")
    const audit = new HostAudit(new AuditWriter({ dir, redact: (v) => redact(v, { terms: [] }) }))
    const v = (outcome: "allow" | "deny", risk = 10) => ({ outcome, ruleId: "r", reason: "", risk, decidedBy: "rules" as const, policyHash: "h" })
    const rec = (tool: string, input: unknown, outcome: "allow" | "deny", toolUseId: string, risk = 10) =>
      audit.record({ session: "s", event: "decision", channel: "host", tool, toolUseId, cwd: root, input, verdict: v(outcome, risk), latencyMs: 0 })
    const fifty = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n")
    await rec("Write", { file_path: "a.ts", content: fifty }, "allow", "t1") // 50 lines at five a minute, and a minute for the file: 11
    await rec("Write", { file_path: "a.ts", content: fifty }, "allow", "t1") // the same call recorded twice: once
    await rec("Edit", { file_path: "b.ts", old_string: "x", new_string: "y" }, "allow", "t2", 90) // (1/5 + 1) * 2 = 3
    await rec("Write", { file_path: "c.ts", content: fifty }, "deny", "t3") // denied: not counted
    await rec("Bash", { command: "npm test" }, "allow", "t4") // not a change
    const app2 = Fastify()
    registerApi(app2, { ...ctx, auditDir: dir, audit, config: () => ({ ...ctx.config(), reviewCapacityMinutes: 10 }) } as never)
    const app3 = Fastify()
    registerApi(app3, { ...ctx, auditDir: dir, audit } as never)
    try {
      expect((await app2.inject({ method: "GET", url: "/api/review-load" })).json()).toEqual({ lastHour: { minutes: 14, changes: 2 }, capacity: 10, over: true })
      expect((await app3.inject({ method: "GET", url: "/api/review-load" })).json()).toEqual({ lastHour: { minutes: 14, changes: 2 } })
    } finally {
      await app2.close()
      await app3.close()
    }
  })
})

describe("loosening waits after its phrase; tightening applies at once (D-024)", () => {
  it("keeps a rules change that removes a deny or an ask until the wait is over, and saves one that adds a rule at once", async () => {
    const { LooseningStore } = await import("../src/loosening.js")
    const clock = { now: Date.parse("2026-11-21T10:00:00Z") }
    const lfile = path.join(root, "rules-loosening.json")
    const told: string[] = []
    const app2 = Fastify()
    registerApi(app2, { ...ctx, loosening: new LooseningStore(lfile, () => clock.now), tell: (t: string) => told.push(t) } as never)
    const original = fs.readFileSync(rulesPath, "utf8")
    const doc = parseYaml(original) as { deny: Array<{ id: string }>; escalate: Array<{ id: string }> }
    const base = () => ({ baseHash: createHash("sha256").update(fs.readFileSync(rulesPath, "utf8")).digest("hex") })
    try {
      // Tightening: a new deny rule is saved at once.
      const tighter = stringifyYaml({ ...doc, deny: [...doc.deny, { id: "no-ftp-d024", commands: ["ftp*"] }] })
      const t = await app2.inject({ method: "PUT", url: "/api/policy/rules", payload: { yaml: tighter, ...base() } })
      expect(t.statusCode).toBe(200)
      expect(fs.readFileSync(rulesPath, "utf8")).toBe(tighter)
      // Loosening: taking it out again needs the phrase, then waits.
      const looser = original
      const asked = await app2.inject({ method: "PUT", url: "/api/policy/rules", payload: { yaml: looser, ...base() } })
      expect(asked.statusCode).toBe(409)
      expect(asked.json().loosening.phrase).toBe("loosen remove no-ftp-d024")
      const kept = await app2.inject({ method: "PUT", url: "/api/policy/rules", payload: { yaml: looser, ...base(), loosen: "loosen remove no-ftp-d024" } })
      expect(kept.statusCode).toBe(202)
      expect(fs.readFileSync(rulesPath, "utf8")).toBe(tighter)
      expect(told).toEqual(["Loosening in 10 minutes"])
      clock.now += 10 * 60_000
      await app2.inject({ method: "GET", url: "/api/loosening" })
      expect(fs.readFileSync(rulesPath, "utf8")).toBe(original)
      expect(told).toEqual(["Loosening in 10 minutes", "Loosening applied"])
    } finally {
      fs.writeFileSync(rulesPath, original)
      ctx.store.load()
      await app2.close()
      fs.rmSync(lfile, { force: true })
    }
  })

  it("drops a rules loosening when the file changed in the wait, and lets you cancel one", async () => {
    const { LooseningStore } = await import("../src/loosening.js")
    const clock = { now: Date.parse("2026-11-21T10:00:00Z") }
    const lfile = path.join(root, "rules-loosening-2.json")
    const store = new LooseningStore(lfile, () => clock.now)
    const recorded: Array<{ event: string }> = []
    const app2 = Fastify()
    registerApi(app2, { ...ctx, loosening: store, audit: { ...ctx.audit, record: async (e: never) => (recorded.push(e), true) } as never })
    const original = fs.readFileSync(rulesPath, "utf8")
    try {
      await store.add("rules", "remove x", { yaml: "rules: []", baseHash: "not-the-file" }, "rules")
      clock.now += 11 * 60_000
      await app2.inject({ method: "GET", url: "/api/loosening" })
      expect(fs.readFileSync(rulesPath, "utf8")).toBe(original)
      expect(recorded.map((r) => r.event)).toEqual(["loosening_applied", "loosening_dropped"])
      const item = await store.add("autonomy", "raise shop to Auto", { project: "shop", level: "auto" }, "autonomy:shop")
      expect((await app2.inject({ method: "POST", url: `/api/loosening/${item.id}/cancel` })).json()).toMatchObject({ pending: [] })
      expect(recorded.at(-1)).toMatchObject({ event: "loosening_cancelled" })
    } finally {
      await app2.close()
      fs.rmSync(lfile, { force: true })
    }
  })

  it("keeps a project strict about its tests until the wait is over, and makes a new one strict at once", async () => {
    const { LooseningStore } = await import("../src/loosening.js")
    const clock = { now: Date.parse("2026-11-21T10:00:00Z") }
    const lfile = path.join(root, "settings-loosening.json")
    const app2 = Fastify()
    registerApi(app2, { ...ctx, loosening: new LooseningStore(lfile, () => clock.now) } as never)
    const cfgFile = path.join(root, "config.json")
    const saved = fs.existsSync(cfgFile) ? fs.readFileSync(cfgFile, "utf8") : undefined
    const onDisk = () => JSON.parse(fs.readFileSync(cfgFile, "utf8")) as { testIntegrity?: { strictProjects?: string[] } }
    const put = (strictProjects: string[], loosen?: string) =>
      app2.inject({ method: "PUT", url: `/api/settings${loosen ? `?loosen=${encodeURIComponent(loosen)}` : ""}`, payload: { ...ctx.config(), testIntegrity: { strictProjects } } })
    try {
      expect((await put(["shop"])).statusCode).toBe(200)
      expect(onDisk().testIntegrity?.strictProjects).toEqual(["shop"])
      expect((await put(["cafe"])).statusCode).toBe(409)
      const kept = await put(["cafe"], "loosen stop being strict about tests in shop")
      expect(kept.statusCode).toBe(200)
      expect(kept.json()).toMatchObject({ pending: { kind: "test-integrity" } })
      expect(onDisk().testIntegrity?.strictProjects?.sort()).toEqual(["cafe", "shop"])
      clock.now += 10 * 60_000
      await app2.inject({ method: "GET", url: "/api/loosening" })
      expect(onDisk().testIntegrity?.strictProjects).toEqual(["cafe"])
    } finally {
      if (saved === undefined) fs.rmSync(cfgFile, { force: true })
      else fs.writeFileSync(cfgFile, saved)
      await app2.close()
      fs.rmSync(lfile, { force: true })
    }
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

  it("keeps a setting a newer version wrote, but still refuses one nobody has", async () => {
    const put = (body: unknown) =>
      app.inject({ method: "PUT", url: "/api/settings", payload: body as object })
    fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({ fromNewer: { a: 1 } }))
    expect((await put({ fromNewer: { a: 1 }, hardTimeoutMs: 60_000 })).statusCode).toBe(200)
    expect(JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8")).fromNewer).toEqual({
      a: 1,
    })
    const r = await put({ fromNewer: { a: 2 } })
    expect(r.statusCode).toBe(422)
    expect(r.json().errors).toEqual(["fromNewer: not a setting Codehouse knows"])
    expect((await put({ fromNewer: { a: 1 }, typo: true })).statusCode).toBe(422)
    fs.rmSync(path.join(root, "config.json"))
  })

  it("refuses a change to what the organisation locked, and a push channel with the phone turned off (T-067)", async () => {
    const put = (body: unknown) => app.inject({ method: "PUT", url: "/api/settings", payload: body as object })
    const policy = ctx.store.current!
    Object.defineProperty(ctx.store, "current", { configurable: true, get: () => ({ ...policy, managedSettings: { managedBy: "Accenture IT", locked: ["expectedOrg"], phone: false } }) })
    try {
      fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({ expectedOrg: "ACN - Premium" }))
      const locked = await put({ expectedOrg: "Another Org" })
      expect(locked.statusCode).toBe(403)
      expect(locked.json().error).toBe("Managed by Accenture IT: expectedOrg cannot be changed here.")
      expect(JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8")).expectedOrg).toBe("ACN - Premium")
      // What is not locked still saves, the locked value kept as it is.
      expect((await put({ expectedOrg: "ACN - Premium", hardTimeoutMs: 60_000 })).statusCode).toBe(200)
      const ntfy = { enabled: true, server: "https://ntfy.example", topic: "abcdefgh12", replyTopic: "abcdefgh34", maxRisk: 40 }
      const push = await put({ expectedOrg: "ACN - Premium", push: { ntfy } })
      expect(push.statusCode).toBe(403)
      expect(push.json().error).toMatch(/the phone and push channels are turned off/)
      expect((await app.inject({ method: "GET", url: "/api/managed" })).json()).toMatchObject({ managed: true, label: "Managed by Accenture IT", locked: ["expectedOrg"] })
    } finally {
      // The store's own getter again.
      delete (ctx.store as unknown as Record<string, unknown>).current
      fs.rmSync(path.join(root, "config.json"), { force: true })
    }
    expect((await app.inject({ method: "GET", url: "/api/managed" })).json()).toEqual({ managed: false })
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

  it("applies the organisation, the redaction list and the digest time at once, and says a restart is only for the rest", async () => {
    const put = (body: unknown) =>
      app.inject({ method: "PUT", url: "/api/settings", payload: body as object })
    const live = await put({
      expectedOrg: "Another Org",
      redactTerms: ["Acme"],
      digestTime: "09:30",
      phoneExpiryMs: 120000,
    })
    expect(live.json()).toMatchObject({ ok: true, restartRequired: true })
    expect(live.json().appliedNow).toEqual(
      expect.arrayContaining(["expectedOrg", "redactTerms", "digestTime"]),
    )
    expect(ctx.config()).toMatchObject({
      expectedOrg: "Another Org",
      redactTerms: ["Acme"],
      digestTime: "09:30",
    })
    const onlyLive = await put({
      expectedOrg: "Third Org",
      redactTerms: [],
      digestTime: null,
    })
    expect(onlyLive.json()).toMatchObject({ ok: true, restartRequired: false })
    expect(ctx.config().expectedOrg).toBe("Third Org")
    expect(ctx.config().digestTime).toBeNull()
    const cleared = await put({})
    expect(cleared.json().restartRequired).toBe(false)
    expect(ctx.config().expectedOrg).toBeUndefined()
  })

  it("says no restart is needed when nothing differs from what is running", async () => {
    const r = await app.inject({ method: "PUT", url: "/api/settings", payload: {} })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ ok: true, restartRequired: false, changed: [] })
  })
})
describe("insights endpoints", () => {
  const human = (
    input: unknown,
    by: "human-desktop" | "human-phone" | "timeout" = "human-desktop",
    outcome: "allow" | "deny" = "allow",
  ) =>
    ctx.audit.record({
      session: "s9",
      event: "human_decision",
      channel: by === "human-phone" ? "phone" : "desktop",
      tool: "Bash",
      cwd: root,
      project: "alpha",
      input,
      verdict: { ...verdict(outcome, "package-install"), decidedBy: by },
      latencyMs: 4000,
    })

  it("reports analytics and a digest from the log", async () => {
    await ctx.audit.record({
      session: "s9",
      event: "evaluate_permission",
      channel: "approver",
      tool: "Bash",
      cwd: root,
      project: "alpha",
      input: { command: "npm install left-pad" },
      verdict: verdict("escalate", "package-install"),
      latencyMs: 2,
    })
    await human({ command: "npm install left-pad" })
    const a = await get("/api/analytics?days=7")
    expect(a.byOutcome.escalate).toBeGreaterThanOrEqual(1)
    const rule = a.byRule.find((r: { ruleId: string }) => r.ruleId === "package-install")
    expect(rule).toMatchObject({ escalated: 1, approved: 1 })
    expect(a.timeToDecideMs.p50).toBe(4000)
    const d = await get("/api/digest")
    expect(d.text).toMatch(/^In the last 24 hours:/)
    expect(d.askedYou).toBeGreaterThanOrEqual(1)
  })

  it("suggests only a call approved three times, accepts it as one exact rule, and refuses anything wider", async () => {
    const cmd = { command: "npm install left-pad" }
    await human(cmd)
    await human(cmd)
    const list = await get("/api/suggestions")
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      approvals: 3,
      candidate: { tool: "Bash", command: "npm install left-pad" },
    })
    expect(list[0].preview).toContain("exactly")
    const post = (body: unknown) =>
      app.inject({ method: "POST", url: "/api/suggestions/accept", payload: body as object })
    expect((await post({})).statusCode).toBe(400)
    expect((await post({ candidate: { tool: "Bash", command: "a", path: "b" } })).statusCode).toBe(
      400,
    )
    expect(
      (await post({ candidate: { tool: "Bash", command: "npm install a && rm -rf /" } }))
        .statusCode,
    ).toBe(422)
    expect(
      (await post({ candidate: { tool: "Bash", command: "git push --force origin main" } }))
        .statusCode,
    ).toBe(422)
    const ok = await post({ candidate: list[0].candidate, cwd: root })
    expect(ok.statusCode).toBe(200)
    expect(ok.json()).toMatchObject({ ok: true, added: true })
    expect((await get("/api/policy")).remember.length).toBeGreaterThanOrEqual(1)
    expect((await get("/api/audit?limit=1")).records[0]).toMatchObject({ event: "remember_added" })
    expect(await get("/api/suggestions")).toEqual([])
    expect((await post({ candidate: list[0].candidate, cwd: root })).statusCode).toBe(422)
  })

  it("does not suggest a call that was ever denied or left to time out", async () => {
    const cmd = { command: "npm install is-odd" }
    await human(cmd)
    await human(cmd)
    await human(cmd)
    await human(cmd, "human-desktop", "deny")
    expect(
      (await get("/api/suggestions")).some(
        (x: { candidate: { command?: string } }) => x.candidate.command === "npm install is-odd",
      ),
    ).toBe(false)
  })

  it("opens the folder chooser through the picker it is given, and says when you cancel", async () => {
    const starts: Array<string | undefined> = []
    ctx.pickFolder = async (start) => {
      starts.push(start)
      return start === "cancel" ? undefined : "C:\dev\chosen"
    }
    const ok = await app.inject({
      method: "POST",
      url: "/api/pick-folder",
      payload: { start: "C:\dev" },
    })
    expect(ok.json()).toEqual({ path: "C:\dev\chosen" })
    const no = await app.inject({
      method: "POST",
      url: "/api/pick-folder",
      payload: { start: "cancel" },
    })
    expect(no.json()).toEqual({ path: null })
    const bad = await app.inject({
      method: "POST",
      url: "/api/pick-folder",
      payload: { start: 42 },
    })
    expect(bad.statusCode).toBe(200)
    expect(starts.at(-1)).toBeUndefined()
    delete ctx.pickFolder
    const none = await app.inject({ method: "POST", url: "/api/pick-folder", payload: {} })
    expect(none.statusCode).toBe(501)
  })

  it("reports the Approver's status, tools and recent decisions for the workbench", async () => {
    const info = (await app.inject({ method: "GET", url: "/api/approver" })).json()
    expect(info.supervised).toBe(false)
    expect(info.tools.map((t: { name: string }) => t.name)).toEqual([
      "evaluate_permission",
      "explain_verdict",
      "policy_status",
      "approval_prompt",
    ])
    expect(info.recent.length).toBeGreaterThan(0)
    expect(info.recent.every((r: { outcome: string }) => typeof r.outcome === "string")).toBe(true)
    // Only the Approver's own decisions: none of the desktop's.
    expect(JSON.stringify(info.recent)).not.toContain("npm install left-pad")
  })

  it("restarts the Approver only through its supervisor, and audits the restart", async () => {
    expect((await app.inject({ method: "POST", url: "/api/approver/restart" })).statusCode).toBe(
      409,
    )
    let restarts = 0
    let state = "up"
    ctx.approver = {
      state: () => state,
      restart: async () => {
        restarts++
        state = "up"
      },
    }
    try {
      const r = await app.inject({ method: "POST", url: "/api/approver/restart" })
      expect(r.json()).toEqual({ ok: true, state: "up" })
      expect(restarts).toBe(1)
      const audit = (await app.inject({ method: "GET", url: "/api/audit?limit=5" })).json()
      expect(JSON.stringify(audit)).toContain("approver-restarted")
      ctx.approver.restart = async () => {
        throw new Error("port in use")
      }
      const bad = await app.inject({ method: "POST", url: "/api/approver/restart" })
      expect(bad.statusCode).toBe(500)
      expect(bad.json().error).toContain("port in use")
    } finally {
      delete ctx.approver
    }
  })

  describe("the rule library", () => {
    const swap = () => {
      const before = { loadOptions: ctx.loadOptions, store: ctx.store }
      const userRulesPath = path.join(root, "rules.user.yaml")
      const loadOptions = {
        ...ctx.loadOptions,
        libraryDir: path.join(REPO, "policy", "library"),
        userRulesPath,
      }
      const store = new PolicyStore(loadOptions)
      store.load()
      ctx.loadOptions = loadOptions
      ctx.store = store
      return {
        userRulesPath,
        restore: () => {
          ctx.loadOptions = before.loadOptions
          ctx.store = before.store
          fs.rmSync(userRulesPath, { force: true })
        },
      }
    }

    it("lists the packs, all off, and the built-in rules with the floor and deny fixed", async () => {
      const t = swap()
      try {
        const lib = (await app.inject({ method: "GET", url: "/api/library" })).json()
        expect(lib.errors).toEqual([])
        expect(lib.packs.length).toBeGreaterThanOrEqual(10)
        expect(lib.packs.every((p: { on: boolean }) => !p.on)).toBe(true)
        const floor = lib.base.find((r: { id: string }) => r.id === "secrets-files")
        expect(floor).toMatchObject({ section: "floor", fixed: true })
        expect(lib.base.find((r: { id: string }) => r.id === "safe-shell")).toMatchObject({
          fixed: false,
        })
      } finally {
        t.restore()
      }
    })

    it("saves only rules that load, applies them at once, and audits what changed", async () => {
      const t = swap()
      try {
        const ok = await app.inject({
          method: "PUT",
          url: "/api/library",
          payload: { version: 1, packs: ["node-dev"], disabled: ["safe-shell"] },
        })
        expect(ok.statusCode).toBe(200)
        expect(ok.json().changed).toEqual(["pack on: node-dev", "switched off: safe-shell"])
        expect(ctx.store.current?.rules.allow.some((r) => r.id === "node-dev-scripts")).toBe(true)
        expect(ctx.store.current?.rules.allow.some((r) => r.id === "safe-shell")).toBe(false)
        const lib = (await app.inject({ method: "GET", url: "/api/library" })).json()
        expect(lib.base.find((r: { id: string }) => r.id === "safe-shell")).toMatchObject({
          off: true,
        })
        expect(lib.packs.find((p: { id: string }) => p.id === "node-dev").on).toBe(true)
        const log = await app.inject({ method: "GET", url: "/api/audit/export" })
        expect(log.body).toContain("policy-library-changed")

        const saved = fs.readFileSync(t.userRulesPath, "utf8")
        for (const payload of [
          { version: 1, disabled: ["secrets-files"] },
          { version: 1, packs: ["no-such-pack"] },
          { version: 1, floor: [] },
          { version: 1, allow: [{ id: "my-everything" }] },
        ]) {
          const r = await app.inject({ method: "PUT", url: "/api/library", payload })
          expect(r.statusCode, JSON.stringify(payload)).toBe(422)
        }
        // A refused save writes nothing.
        expect(fs.readFileSync(t.userRulesPath, "utf8")).toBe(saved)
      } finally {
        t.restore()
      }
    })

    it("saves a choice that would allow what was refused only with the typed phrase in ?confirm= (D-026)", async () => {
      const t = swap()
      try {
        await ctx.audit.record({
          session: "s1",
          event: "decision",
          channel: "approver",
          tool: "Bash",
          cwd: root,
          input: { command: "echo library" },
          verdict: verdict("escalate", "no-rule"),
          latencyMs: 1,
        })
        const payload = { version: 1, allow: [{ id: "my-echo", commands: ["echo library*"] }] }
        const blocked = await app.inject({ method: "PUT", url: "/api/library", payload })
        expect(blocked.statusCode).toBe(409)
        const { phrase } = blocked.json().regression
        expect(fs.existsSync(t.userRulesPath)).toBe(false)
        const ok = await app.inject({ method: "PUT", url: `/api/library?confirm=${encodeURIComponent(phrase)}`, payload })
        expect(ok.statusCode).toBe(200)
        expect(ctx.store.current?.rules.allow.some((r) => r.id === "my-echo")).toBe(true)
      } finally {
        t.restore()
      }
    })

    it("tries asks against candidate choices, without saving or recording anything (W1-17)", async () => {
      const t = swap()
      try {
        const before = (await app.inject({ method: "GET", url: "/api/audit/export" })).body
        const ask = { toolName: "Bash", input: { command: "git status" }, cwd: process.cwd() }
        const run = async (rules: object) =>
          app.inject({ method: "POST", url: "/api/library/try", payload: { rules, asks: [ask] } })
        const plain = await run({ version: 1 })
        expect(plain.statusCode).toBe(200)
        expect(plain.json().verdicts[0]).toMatchObject({ outcome: "allow", ruleId: "safe-shell" })
        // The same ask, with that rule switched off in the candidate: it no longer goes through by itself.
        const off = await run({ version: 1, disabled: ["safe-shell"] })
        expect(off.json().verdicts[0].outcome).not.toBe("allow")
        expect(fs.existsSync(t.userRulesPath)).toBe(false)
        expect((await app.inject({ method: "GET", url: "/api/audit/export" })).body).toBe(before)
        const many = await app.inject({
          method: "POST",
          url: "/api/library/try",
          payload: { rules: { version: 1 }, asks: Array.from({ length: 21 }, () => ask) },
        })
        expect(many.statusCode).toBe(400)
        const floorOff = await run({ version: 1, disabled: ["secrets-files"] })
        expect(floorOff.statusCode).toBe(422)
      } finally {
        t.restore()
      }
    })

    it("previews which past decisions a change would alter, without saving", async () => {
      const t = swap()
      try {
        const r = await app.inject({
          method: "POST",
          url: "/api/library/preview",
          payload: { version: 1, disabled: ["read-workspace"] },
        })
        expect(r.statusCode).toBe(200)
        expect(r.json()).toHaveProperty("candidateHash")
        expect(fs.existsSync(t.userRulesPath)).toBe(false)
      } finally {
        t.restore()
      }
    })
  })

  it("starts the Relay inside Codehouse, remembers it for next time, audits it, and forgets it on stop", async () => {
    expect(
      (await app.inject({ method: "POST", url: "/api/relay/local/start", payload: {} })).statusCode,
    ).toBe(501)
    let state: "off" | "running" = "off"
    ctx.localRelay = {
      status: () => ({ state, port: 8099, publicUrl: "https://x.ts.net" }),
      start: async (publicUrl, port) => {
        state = "running"
        return { state, port, publicUrl: new URL(publicUrl).origin }
      },
      stop: async () => {
        state = "off"
      },
    }
    try {
      const bad = await app.inject({
        method: "POST",
        url: "/api/relay/local/start",
        payload: { port: 8099 },
      })
      expect(bad.statusCode).toBe(400)
      const r = await app.inject({
        method: "POST",
        url: "/api/relay/local/start",
        payload: { publicUrl: "https://x.ts.net", port: 8099 },
      })
      expect(r.json()).toMatchObject({ state: "running", port: 8099 })
      expect(runningConfig.localRelay).toEqual({
        enabled: true,
        publicUrl: "https://x.ts.net",
        port: 8099,
      })
      const saved = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"))
      expect(saved.localRelay).toEqual({ enabled: true, publicUrl: "https://x.ts.net", port: 8099 })
      const status = (await app.inject({ method: "GET", url: "/api/relay/local" })).json()
      expect(status).toMatchObject({ state: "running", saved: { enabled: true } })
      const log = await app.inject({ method: "GET", url: "/api/audit/export" })
      expect(log.body).toContain("relay-local-started")
      await app.inject({ method: "POST", url: "/api/relay/local/stop" })
      expect(runningConfig.localRelay).toBeUndefined()
      expect(
        JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8")).localRelay,
      ).toBeUndefined()
    } finally {
      delete ctx.localRelay
    }
  })

  it("switches ntfy on with two fresh random topics, keeps them on save, and audits it", async () => {
    let started = 0
    ctx.ntfy = {
      status: () => ({
        enabled: runningConfig.push?.ntfy?.enabled === true,
        listening: true,
        sent: 0,
        ...(runningConfig.push?.ntfy ? { topic: runningConfig.push.ntfy.topic } : {}),
      }),
      start: () => void started++,
      stop: () => undefined,
      test: async () => ({ ok: true }),
    }
    try {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/push/ntfy/enable",
            payload: { server: "http://ntfy.example" },
          })
        ).statusCode,
      ).toBe(400)
      const on = await app.inject({
        method: "POST",
        url: "/api/push/ntfy/enable",
        payload: { maxRisk: 99 },
      })
      expect(on.statusCode).toBe(200)
      const first = runningConfig.push?.ntfy
      expect(first).toMatchObject({ enabled: true, server: "https://ntfy.sh", maxRisk: 84 })
      expect(first?.topic).toMatch(/^codeh-[a-z2-9]{4}(-[a-z2-9]{4}){4}$/)
      expect(first?.topic).not.toBe(first?.replyTopic)
      expect(started).toBe(1)
      // Saving again keeps the topics, so the phone subscription keeps working.
      await app.inject({ method: "POST", url: "/api/push/ntfy/enable", payload: { maxRisk: 39 } })
      expect(runningConfig.push?.ntfy?.topic).toBe(first?.topic)
      expect(runningConfig.push?.ntfy?.maxRisk).toBe(39)
      // New topics on request.
      await app.inject({
        method: "POST",
        url: "/api/push/ntfy/enable",
        payload: { newTopics: true },
      })
      expect(runningConfig.push?.ntfy?.topic).not.toBe(first?.topic)
      await app.inject({ method: "POST", url: "/api/push/ntfy/disable" })
      expect(runningConfig.push?.ntfy?.enabled).toBe(false)
      const log = await app.inject({ method: "GET", url: "/api/audit/export" })
      expect(log.body).toContain("push-ntfy-enabled")
      expect(log.body).toContain("push-ntfy-disabled")
      expect((await app.inject({ method: "POST", url: "/api/push/ntfy/test" })).json()).toEqual({
        ok: true,
      })
    } finally {
      delete ctx.ntfy
    }
  })

  it("takes back a topic Codehouse makes, even pasted as an address, and refuses any other", async () => {
    ctx.ntfy = {
      status: () => ({ enabled: true, listening: true, sent: 0 }),
      start: () => undefined,
      stop: () => undefined,
      test: async () => ({ ok: true }),
    }
    const enable = (payload: unknown) =>
      app.inject({ method: "POST", url: "/api/push/ntfy/enable", payload: payload as object })
    try {
      await enable({})
      const before = runningConfig.push?.ntfy
      // As the phone shows it: an address, with spaces around it.
      const typed = await enable({
        topic: " https://ntfy.sh/codeh-abcd-efgh-jkmn-pqrs-tuvw ",
        maxRisk: 39,
      })
      expect(typed.statusCode).toBe(200)
      expect(runningConfig.push?.ntfy).toMatchObject({
        topic: "codeh-abcd-efgh-jkmn-pqrs-tuvw",
        replyTopic: before?.replyTopic,
        maxRisk: 39,
      })
      await enable({ topic: "codeh-wxyz-2345-6789-abcd-efgh", newTopics: true })
      expect(runningConfig.push?.ntfy).toMatchObject({
        topic: "codeh-wxyz-2345-6789-abcd-efgh",
        replyTopic: before?.replyTopic,
      })
      // ntfy treats capitals as different letters, so a phone on this name would get nothing.
      const caps = await enable({ topic: "Codehouse-ABCD-EFGH-JKMN-PQRS-TUVW" })
      expect(caps.statusCode).toBe(400)
      expect(caps.json().error).toMatch(/capital letters/)
      // Whoever reads the topic can tap Approve, so a name someone could guess is refused. So is the older
      // mixed-case kind, and any with letters that are easy to mix up (owner, 30 Oct). Nothing changes.
      for (const topic of [
        "alerts",
        "codeh-abc",
        "codeh-abcd-efgh",
        "my-phone-topic-2026-abcdef",
        "codeh-t6YdOCy5dH5TBqoPnEXrLC",
        "codeh-abcd-efgh-jkmn-pqrs-tuvo",
        "codeh-abcd-efgh-jkmn-pqrs-tuv0",
        42,
      ]) {
        const r = await enable({ topic })
        expect(r.statusCode).toBe(400)
        expect(r.json().error).toMatch(/all lower case with no o or 0/)
      }
      expect(runningConfig.push?.ntfy?.topic).toBe("codeh-wxyz-2345-6789-abcd-efgh")
      const log = await app.inject({ method: "GET", url: "/api/audit/export" })
      expect(log.body).toContain("typedTopic")
      expect(log.body).not.toContain("wxyz-2345")
    } finally {
      delete ctx.ntfy
    }
  })

  it("signs in to an ntfy server that needs it, with the secret sealed away, never in the settings file or the audit (owner, 4 Nov)", async () => {
    let sealed: string | undefined
    ctx.ntfy = {
      status: () => ({
        enabled: true,
        listening: true,
        sent: 0,
        ...(runningConfig.push?.ntfy?.auth ? { auth: runningConfig.push.ntfy.auth } : {}),
      }),
      start: () => undefined,
      stop: () => undefined,
      test: async () => ({ ok: true }),
    }
    ctx.ntfySecrets = {
      has: () => sealed !== undefined,
      save: async (s: string) => void (sealed = s),
      forget: () => void (sealed = undefined),
    } as never
    const enable = (payload: object) =>
      app.inject({ method: "POST", url: "/api/push/ntfy/enable", payload })
    try {
      expect((await enable({ auth: "token" })).json().error).toMatch(/Give the access token/)
      expect((await enable({ auth: "basic", secret: "pw" })).json().error).toMatch(/user name/)
      expect((await enable({ auth: "key", secret: "x" })).statusCode).toBe(400)
      const on = await enable({
        server: "https://ntfy.internal.example",
        auth: "token",
        secret: "tk_live_123",
      })
      expect(on.statusCode).toBe(200)
      expect(sealed).toBe("tk_live_123")
      expect(runningConfig.push?.ntfy).toMatchObject({ auth: "token" })
      // Saving again without the token keeps the one sealed.
      expect((await enable({ maxRisk: 39 })).statusCode).toBe(200)
      expect(sealed).toBe("tk_live_123")
      await enable({ auth: "basic", user: "codehouse", secret: "s3cret-pw" })
      expect(runningConfig.push?.ntfy).toMatchObject({ auth: "basic", user: "codehouse" })
      expect(sealed).toBe("s3cret-pw")
      const file = fs.readFileSync(path.join(root, "config.json"), "utf8")
      expect(file).not.toMatch(/tk_live_123|s3cret-pw/)
      const log = (await app.inject({ method: "GET", url: "/api/audit/export" })).body
      expect(log).toContain("newSecret")
      expect(log).not.toMatch(/tk_live_123|s3cret-pw/)
      // No sign-in forgets the secret.
      await enable({ auth: "none" })
      expect(sealed).toBeUndefined()
      expect(runningConfig.push?.ntfy?.auth).toBeUndefined()
    } finally {
      delete ctx.ntfy
      delete ctx.ntfySecrets
    }
  })

  it("switches Slack on with both tokens sealed away, never in the settings file, and audits it", async () => {
    let sealed: unknown
    let hasTokens = false
    ctx.slack = {
      status: () => ({
        enabled: runningConfig.push?.slack?.enabled === true,
        connected: false,
        hasTokens,
        sent: 0,
      }),
      start: async () => undefined,
      stop: () => undefined,
      test: async () => ({ ok: true }),
      saveSecrets: async (v) => {
        sealed = v
        hasTokens = true
      },
      forgetSecrets: () => {
        hasTokens = false
      },
    }
    try {
      const post = (payload: object) =>
        app.inject({ method: "POST", url: "/api/push/slack/enable", payload })
      expect((await post({ userId: "U0OWNER1" })).statusCode).toBe(400)
      expect(
        (await post({ botToken: "abc", appToken: "def", userId: "U0OWNER1", channel: "C0123ABCD" }))
          .statusCode,
      ).toBe(400)
      expect(
        (
          await post({
            botToken: "xoxb-1-2-abc",
            appToken: "xapp-1-A-2-def",
            userId: "nope",
            channel: "C0123ABCD",
          })
        ).statusCode,
      ).toBe(400)
      const ok = await post({
        botToken: "xoxb-1-2-abc",
        appToken: "xapp-1-A-2-def",
        userId: "u0owner1",
        channel: "u0owner1",
      })
      expect(ok.statusCode).toBe(200)
      expect(sealed).toEqual({ botToken: "xoxb-1-2-abc", appToken: "xapp-1-A-2-def" })
      expect(runningConfig.push?.slack).toEqual({
        enabled: true,
        channel: "U0OWNER1",
        userId: "U0OWNER1",
        maxRisk: 69,
      })
      const file = fs.readFileSync(path.join(root, "config.json"), "utf8")
      expect(file).not.toContain("xoxb-")
      expect(file).not.toContain("xapp-")
      // Saving again without tokens keeps the sealed ones.
      expect(
        (await post({ userId: "U0OWNER1", channel: "C0123ABCD", maxRisk: 39 })).statusCode,
      ).toBe(200)
      expect(runningConfig.push?.slack?.channel).toBe("C0123ABCD")
      await app.inject({
        method: "POST",
        url: "/api/push/slack/disable",
        payload: { forgetTokens: true },
      })
      expect(runningConfig.push?.slack?.enabled).toBe(false)
      expect(hasTokens).toBe(false)
      const log = await app.inject({ method: "GET", url: "/api/audit/export" })
      expect(log.body).toContain("push-slack-enabled")
      expect(log.body).not.toContain("xoxb-1-2-abc")
    } finally {
      delete ctx.slack
    }
  })
})

describe("the plan meter's limits", () => {
  it("gives the account's limits, or null, and keeps an account name to the shape Codehouse makes", async () => {
    const asked: Array<[string, boolean]> = []
    ctx.planUsage = async (account, fresh) => {
      asked.push([account, fresh])
      return account === "main" ? { limits: [], at: "2026-10-31T10:00:00Z" } : undefined
    }
    try {
      const main = await app.inject({ method: "GET", url: "/api/plan-usage?fresh=1" })
      expect(main.json()).toEqual({ usage: { limits: [], at: "2026-10-31T10:00:00Z" } })
      const other = await app.inject({ method: "GET", url: "/api/plan-usage?account=personal" })
      expect(other.json()).toEqual({ usage: null })
      await app.inject({ method: "GET", url: "/api/plan-usage?account=..%2F..%2Fx" })
      expect(asked).toEqual([
        ["main", true],
        ["personal", false],
        ["main", false],
      ])
    } finally {
      delete ctx.planUsage
    }
  })
})

describe("the Usage page's report", () => {
  it("gives cost and tokens for a range of days, and refuses a range it cannot read", async () => {
    const usage = new UsageStore(undefined, () => new Date(2026, 9, 31, 9))
    usage.record("s1", "shop", { total_cost_usd: 1, num_turns: 1, usage: {} })
    ctx.usage = usage
    try {
      const ok = await app.inject({
        method: "GET",
        url: "/api/usage/report?from=2026-10-31&to=2026-10-31",
      })
      expect(ok.statusCode).toBe(200)
      expect(ok.json().days["2026-10-31"].s1.total.costUsd).toBe(1)
      for (const q of [
        "",
        "?from=2026-10-31",
        "?from=31-10-2026&to=2026-10-31",
        "?from=2026-11-01&to=2026-10-31",
      ]) {
        const bad = await app.inject({ method: "GET", url: `/api/usage/report${q}` })
        expect(bad.statusCode).toBe(400)
      }
    } finally {
      delete ctx.usage
    }
  })

  it("says what drove the usage for a real range of days and a session, and refuses one it cannot read (B15)", async () => {
    // The route once checked dates with its backslashes lost, so every real date was refused (inventory, 4 Nov).
    const ok = await app.inject({
      method: "GET",
      url: "/api/usage/drivers?from=2026-10-31&to=2026-11-04&session=01a1a559-4b41-72ef",
    })
    expect(ok.statusCode).toBe(200)
    expect(ok.json()).toMatchObject({ from: "2026-10-31", to: "2026-11-04" })
    for (const q of [
      "",
      "?from=2026-10-31",
      "?from=2026-11-05&to=2026-11-04",
      "?from=dddd-dd-dd&to=dddd-dd-dd",
    ]) {
      const bad = await app.inject({ method: "GET", url: `/api/usage/drivers${q}` })
      expect(bad.statusCode, q).toBe(400)
    }
  })
})

describe("chat project endpoints (owner's plan, W1-07)", () => {
  const call = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: object) =>
    app.inject({ method, url, ...(payload ? { payload } : {}) })

  // Each of these makes a dozen audited writes; the 60 s limit is for a computer busy with other work, where one
  // took seconds in a 20 minute full run (31 Oct), as the checkpoint tests did.
  it("makes a project, keeps its instructions and files, and records each change without the content", async () => {
    expect((await call("POST", "/api/projects", { name: "Garden" })).statusCode).toBe(200)
    expect((await call("POST", "/api/projects", { name: "Garden" })).statusCode).toBe(409)
    expect((await call("POST", "/api/projects", { name: "../escape" })).statusCode).toBe(422)
    const text = "Secret plan: the gate code is 4401."
    expect((await call("PUT", "/api/projects/Garden/instructions", { text })).statusCode).toBe(200)
    expect((await call("PUT", "/api/projects/Garden/instructions", { text: 5 })).statusCode).toBe(
      422,
    )
    expect(
      (await call("PUT", "/api/projects/Garden/instructions", { text: "x".repeat(8001) }))
        .statusCode,
    ).toBe(413)
    const added = await call("POST", "/api/projects/Garden/files", {
      name: "beds.md",
      base64: Buffer.from("raised beds").toString("base64"),
    })
    expect(added.statusCode).toBe(200)
    expect(added.json().file).toEqual({ name: "beds.md", size: 11 })
    const got = (await call("GET", "/api/projects/Garden")).json().project
    expect(got).toEqual({
      name: "Garden",
      instructions: text,
      files: [{ name: "beds.md", size: 11 }],
    })
    expect((await call("GET", "/api/projects")).json().projects).toEqual([
      { name: "Garden", hasInstructions: true, files: 1 },
    ])
    expect((await call("DELETE", "/api/projects/Garden/files/beds.md")).statusCode).toBe(200)
    expect((await call("DELETE", "/api/projects/Garden/files/beds.md")).statusCode).toBe(404)
    // Each change is in the audit log, by name and size, and never the instructions themselves.
    const log = (await call("GET", "/api/audit?limit=20")).json().records as Array<{
      event: string
      inputJson: string
    }>
    const events = log.map((r) => r.event)
    for (const e of [
      "project_created",
      "project_instructions_changed",
      "project_file_added",
      "project_file_removed",
    ])
      expect(events, e).toContain(e)
    expect(JSON.stringify(log)).not.toContain("4401")
    expect((await call("DELETE", "/api/projects/Garden")).statusCode).toBe(200)
    expect((await call("GET", "/api/projects/Garden")).statusCode).toBe(404)
  }, 60_000)

  it("turns away what is not a project or a file name", async () => {
    await call("POST", "/api/projects", { name: "Plain" })
    expect((await call("GET", "/api/projects/con")).statusCode).toBe(422)
    const bad = await call("POST", "/api/projects/Plain/files", {
      name: "..\\x.md",
      base64: "eA==",
    })
    expect(bad.statusCode).toBe(422)
    expect((await call("POST", "/api/projects/Plain/files", { name: "x.md" })).statusCode).toBe(422)
    expect(
      (await call("POST", "/api/projects/Nothing/files", { name: "x.md", base64: "eA==" }))
        .statusCode,
    ).toBe(404)
  })

  it("takes global instructions as a setting an older version keeps", async () => {
    const put = (body: unknown) =>
      app.inject({ method: "PUT", url: "/api/settings", payload: body as object })
    expect((await put({ globalInstructions: "Be brief." })).statusCode).toBe(200)
    expect(
      JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8")).globalInstructions,
    ).toBe("Be brief.")
    // It is read each time it is used: no restart.
    expect(runningConfig.globalInstructions).toBe("Be brief.")
    expect((await put({ globalInstructions: "x".repeat(8001) })).statusCode).toBe(422)
    delete runningConfig.globalInstructions
  })
})

describe("memory endpoints (owner's plan, W1-08)", () => {
  const call = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: object) =>
    app.inject({ method, url, ...(payload ? { payload } : {}) })

  it("adds, edits and forgets, and records each change without the words", async () => {
    const made = await call("POST", "/api/memory", {
      scope: "everyone",
      topic: "Units",
      text: "The vault code is 7788.",
    })
    expect(made.statusCode).toBe(200)
    const id = made.json().entry.id as string
    expect(made.json().entry).toMatchObject({ topic: "Units", by: "you" })
    expect(
      (await call("POST", "/api/memory", { scope: "Home", topic: "Beds", text: "Raised." }))
        .statusCode,
    ).toBe(200)
    const all = (await call("GET", "/api/memory")).json()
    expect(all.everyone.map((e: { id: string }) => e.id)).toContain(id)
    expect(Object.keys(all.projects)).toEqual(["Home"])
    expect(
      (await call("PUT", "/api/memory/" + id, { text: "Prefers metric." })).json().entry.text,
    ).toBe("Prefers metric.")
    expect((await call("PUT", "/api/memory/nope", { text: "x" })).statusCode).toBe(404)
    expect((await call("PUT", "/api/memory/" + id, { text: "" })).statusCode).toBe(422)
    expect((await call("DELETE", "/api/memory/" + id)).statusCode).toBe(200)
    expect((await call("DELETE", "/api/memory/" + id)).statusCode).toBe(404)
    // Waited for, not read once: on a busy computer the last record can land a moment after the reply (it failed
    // three times only under load, 1 and 2 Nov). A record that never lands still fails.
    let log: Array<{ event: string }> = []
    await vi.waitFor(
      async () => {
        log = (await call("GET", "/api/audit?limit=30")).json().records as Array<{ event: string }>
        for (const e of ["memory_written", "memory_edited", "memory_forgotten"])
          expect(
            log.map((r) => r.event),
            e,
          ).toContain(e)
      },
      { timeout: 10_000, interval: 200 },
    )
    // Never the words themselves, even the one that was later edited out.
    expect(JSON.stringify(log)).not.toMatch(/7788|metric|Raised/)
  }, 60_000)

  it("refuses a bad topic, text or project name", async () => {
    expect((await call("POST", "/api/memory", { topic: "", text: "x" })).statusCode).toBe(422)
    expect(
      (await call("POST", "/api/memory", { topic: "t", text: "x".repeat(1001) })).statusCode,
    ).toBe(422)
    expect(
      (await call("POST", "/api/memory", { scope: "../escape", topic: "t", text: "x" })).statusCode,
    ).toBe(422)
  })

  it("exports as Markdown and imports it back, once", async () => {
    await call("POST", "/api/memory", { scope: "everyone", topic: "Tea", text: "Likes it strong." })
    const md = (await call("GET", "/api/memory-export")).json().markdown as string
    expect(md).toContain("- [Tea] Likes it strong.")
    expect((await call("POST", "/api/memory-import", { markdown: md })).json()).toMatchObject({
      added: 0,
    })
    expect(
      (
        await call("POST", "/api/memory-import", { markdown: "## Global\n- [New] A new one." })
      ).json(),
    ).toEqual({ added: 1, skipped: 0 })
    expect((await call("POST", "/api/memory-import", { markdown: 5 })).statusCode).toBe(422)
  }, 60_000)
})

describe("artifact endpoints (owner's plan, W1-09, ADR 0003)", () => {
  const SESSION = "019a0000-0000-7000-8000-0000000000aa"
  const call = (
    method: "GET" | "POST",
    url: string,
    payload?: object,
    headers?: Record<string, string>,
  ) => app.inject({ method, url, ...(payload ? { payload } : {}), ...(headers ? { headers } : {}) })

  it("lists what was saved, gives an address, and serves the page only in the sandbox", async () => {
    await ctx.artifacts!.save(SESSION, "Chart", "html", "<h1>hello</h1><script>1+1</script>")
    expect((await call("GET", "/api/artifacts?session=" + SESSION)).json().artifacts).toEqual([
      expect.objectContaining({ id: "chart", kind: "html" }),
    ])
    const open = await call("POST", "/api/artifacts/open", {
      session: SESSION,
      artifact: "chart",
      version: 1,
    })
    expect(open.statusCode).toBe(200)
    const where = open.json().path as string
    expect(where).toMatch(/^\/artifact\/[\w-]{20,}$/)
    // The same version gets the same address.
    expect(
      (
        await call("POST", "/api/artifacts/open", {
          session: SESSION,
          artifact: "chart",
          version: 1,
        })
      ).json().path,
    ).toBe(where)
    const page = await call("GET", where, undefined, { host: "127.0.0.1:5199" })
    expect(page.statusCode).toBe(200)
    // Marked as made by AI where a program can read it (B38).
    expect(page.body).toBe(`${MARKED}<h1>hello</h1><script>1+1</script>`)
    const csp = String(page.headers["content-security-policy"])
    expect(csp).toContain("sandbox allow-scripts;")
    expect(csp).toContain("connect-src 'none'")
    expect(csp).toContain("frame-ancestors http://127.0.0.1:5199")
    expect(csp).not.toContain("allow-same-origin")
    expect(page.headers["x-content-type-options"]).toBe("nosniff")
    expect(page.headers["cache-control"]).toBe("no-store")
    expect(String(page.headers["content-type"])).toContain("text/html")
    // T-058: in the theme asked for, before the page's own content, under the same sandbox; any other value is ignored.
    const dark = await call("GET", `${where}?theme=dark`, undefined, { host: "127.0.0.1:5199" })
    expect(dark.body).toMatch(/^<style data-codehouse-theme="dark">:root\{color-scheme:dark;--codehouse-bg:#0e1217;/)
    expect(dark.body.endsWith(`${MARKED}<h1>hello</h1><script>1+1</script>`)).toBe(true)
    expect(String(dark.headers["content-security-policy"])).toContain("sandbox allow-scripts;")
    const odd = await call("GET", `${where}?theme=</style><script>x()</script>`, undefined, { host: "127.0.0.1:5199" })
    expect(odd.body).toBe(`${MARKED}<h1>hello</h1><script>1+1</script>`)
  })

  it("has no address for what was not saved, or for a session that is not one", async () => {
    expect(
      (
        await call("POST", "/api/artifacts/open", {
          session: SESSION,
          artifact: "nope",
          version: 1,
        })
      ).statusCode,
    ).toBe(404)
    expect(
      (
        await call("POST", "/api/artifacts/open", {
          session: SESSION,
          artifact: "chart",
          version: 9,
        })
      ).statusCode,
    ).toBe(404)
    expect(
      (
        await call("POST", "/api/artifacts/open", {
          session: "../x",
          artifact: "chart",
          version: 1,
        })
      ).statusCode,
    ).toBe(422)
    expect((await call("GET", "/artifact/not-a-token")).statusCode).toBe(404)
    expect((await call("GET", "/api/artifacts?session=../x")).statusCode).toBe(422)
  })

  it("exports the stored page as it is", async () => {
    const r = await call(
      "GET",
      "/api/artifacts/export?session=" + SESSION + "&artifact=chart&version=1",
    )
    expect(r.json()).toEqual({
      name: "chart-v1.html",
      kind: "html",
      content: `${MARKED}<h1>hello</h1><script>1+1</script>`,
    })
    expect(
      (await call("GET", "/api/artifacts/export?session=" + SESSION + "&artifact=chart&version=7"))
        .statusCode,
    ).toBe(404)
  })
})
