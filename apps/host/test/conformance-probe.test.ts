// E-031: each operation of an OpenAPI spec is sent to the app on this computer and its answer checked; a missing
// required field is reported, a server elsewhere is refused, and mismatches make done-claims Contradicted.
import http from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { ActionResult } from "../src/codehouse-action.js"
import { isLoopback, plainSchema, planRequests, probe, readSpec } from "../src/conformance-probe.js"
import { buildStack, type Stack } from "./stack.js"

const SPEC = `openapi: 3.0.3
info: { title: shop, version: "1" }
servers: [{ url: "http://127.0.0.1:1" }]
paths:
  /users/{id}:
    get:
      parameters:
        - { name: id, in: path, required: true, schema: { type: integer, minimum: 7 } }
      responses:
        "200":
          description: a user
          content:
            application/json:
              schema: { $ref: "#/components/schemas/User" }
  /orders:
    post:
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [sku, qty]
              properties: { sku: { type: string }, qty: { type: integer, minimum: 1 }, note: { type: string, nullable: true } }
      responses:
        "201":
          description: made
          content:
            application/json:
              schema: { type: object, required: [id], properties: { id: { type: string } } }
  /health:
    get:
      responses:
        "200": { description: ok, content: { application/json: { schema: { type: object, properties: { ok: { type: boolean } } } } } }
components:
  schemas:
    User:
      type: object
      required: [id, name]
      properties: { id: { type: integer }, name: { type: string } }
`

let server: http.Server
let base = ""
const seen: Array<{ method: string; url: string; body: string }> = []
beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = ""
    req.on("data", (c: Buffer) => (body += String(c)))
    req.on("end", () => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", body })
      res.setHeader("content-type", "application/json")
      if (req.url === "/users/7") return void res.end(JSON.stringify({ id: 7 })) // name is missing
      if (req.url === "/orders" && req.method === "POST") return void ((res.statusCode = 201), res.end(JSON.stringify({ id: "o1" })))
      res.end(JSON.stringify({ ok: true }))
    })
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))

describe("the contract probe", () => {
  it("reports a missing required field, and passes what matches", async () => {
    const spec = readSpec(SPEC)!
    const r = await probe(spec, base, { allowed: async () => true })
    expect(r.refused).toBeUndefined()
    expect(r.operations.map((o) => [o.method, o.path, o.status, o.ok])).toEqual([
      ["GET", "/users/{id}", 200, false],
      ["POST", "/orders", 201, true],
      ["GET", "/health", 200, true],
    ])
    expect(r.mismatches).toEqual(["GET /users/{id}: the response is missing the required field /name"])
    // A valid request: the path parameter meets its minimum, the body has its required fields.
    expect(seen.find((x) => x.method === "POST")?.body).toBe(JSON.stringify({ sku: "probe", qty: 1, note: "probe" }))
    expect(seen.some((x) => x.url === "/users/7")).toBe(true)
    // E-037: no error was answered, so no error contract finding.
    expect(r.errors).toBeUndefined()
  })

  it("reports an error answer without a type field (E-037), without counting it against claims", async () => {
    const spec = readSpec(SPEC.replace('"200": { description: ok, content: { application/json: { schema: { type: object, properties: { ok: { type: boolean } } } } } }', '"500": { description: broke }'))!
    const fake = (async (url: string) => new Response(JSON.stringify(String(url).endsWith("/health") ? { message: "down" } : { id: 7, name: "a" }), { status: String(url).endsWith("/health") ? 500 : String(url).endsWith("/orders") ? 201 : 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch
    const r = await probe(spec, "http://127.0.0.1:9", { allowed: async () => true, fetch: fake })
    expect(r.errors).toEqual(["GET /health: Its 500 answer has no type field (RFC 9457).", "GET /health: Its 500 answer is served as application/json, not application/problem+json."])
    expect(r.mismatches.some((m) => /type field/.test(m))).toBe(false)
  })

  it("refuses a server that is not on this computer, sending nothing", async () => {
    const fetchSpy = vi.fn()
    const r = await probe(readSpec(SPEC)!, "https://api.example.com", { allowed: async () => true, fetch: fetchSpy as never })
    expect(r.refused).toMatch(/Only a server on this computer is probed .* not https:\/\/api\.example\.com/)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(isLoopback("http://localhost:3000")).toBe(true)
    expect(isLoopback("http://[::1]:3000")).toBe(true)
    expect(isLoopback("http://127.0.0.1.example.com")).toBe(false)
    expect(isLoopback("http://10.0.0.5")).toBe(false)
  })

  it("sends nothing the rules would not let the session send by itself", async () => {
    const before = seen.length
    const r = await probe(readSpec(SPEC)!, base, { allowed: async (c) => !c.includes("-X POST") })
    expect(r.operations.find((o) => o.method === "POST")).toMatchObject({ ok: false, skipped: expect.stringMatching(/rules/) })
    expect(seen.slice(before).some((x) => x.method === "POST")).toBe(false)
  })

  it("reports a status the spec does not list, and reads OpenAPI 3.0's nullable", () => {
    const spec = readSpec(SPEC)!
    expect(plainSchema(spec, { type: "string", nullable: true })).toEqual({ type: ["string", "null"] })
    expect(planRequests(spec, "http://127.0.0.1:9").map((p) => p.url)).toEqual(["http://127.0.0.1:9/users/7", "http://127.0.0.1:9/orders", "http://127.0.0.1:9/health"])
    expect(readSpec('{"swagger": "2.0", "paths": {}}')).toBeUndefined()
  })
})

describe("on a real session", () => {
  let s: Stack
  beforeAll(async () => {
    s = await buildStack({
      hardTimeoutMs: 1500,
      phoneExpiryMs: 800,
      codehouseAction: async (): Promise<ActionResult> => ({ ran: true, exitCode: 0, output: "", timedOut: false, killed: false, ms: 5 }),
    })
  }, 60000)
  afterAll(async () => {
    for (const x of s.manager.liveSessions()) await x.close()
    await s.stop()
  })

  it("makes a claim of done Contradicted while the last probe has mismatches", async () => {
    s.sdk.turn = async (api) => {
      await api.callTool("Bash", { command: "npm test" }, { selfApproved: false })
      api.say("All tests pass now.")
    }
    const session = await s.manager.start({ cwd: s.repo })
    session.contractProbed({ base: "http://127.0.0.1:3000", operations: 3, mismatches: ["GET /users/{id}: the response is missing the required field /name"] })
    const events: Array<Record<string, unknown>> = []
    session.on("event", (e) => e.type === "claim_checked" && events.push(e.data))
    session.prompt("go")
    await vi.waitFor(() => expect(events.length).toBeGreaterThan(0), { timeout: 10_000 })
    expect(events[0]).toMatchObject({ outcome: "contradicted", why: expect.stringMatching(/contract probe found 1 mismatch/) })
    expect(session.contract()).toMatchObject({ operations: 3, mismatches: [expect.stringMatching(/\/name/)] })
  })
})
