import http from "node:http"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { ApproverClient, unavailableVerdict } from "../src/approver-client.js"
import { Verdict } from "@gatehouse/shared"

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void
let server: http.Server
let port: number
let handler: Handler
const seen: { auth: string | undefined; body: any }[] = []

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      seen.push({ auth: req.headers.authorization, body: body ? JSON.parse(body) : undefined })
      handler(req, res, body)
    })
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()))
  port = (server.address() as { port: number }).port
})
afterAll(() => {
  server.closeAllConnections()
  return new Promise<void>((r) => server.close(() => r()))
})

const client = (timeoutMs = 500, token = "tok") => new ApproverClient({ url: `http://127.0.0.1:${port}/mcp`, token, timeoutMs })
const call = { toolName: "Bash", input: { command: "git status" } }
const ctx = { cwd: "C:/dev", sessionId: "s1" }
const reply = (res: http.ServerResponse, result: unknown) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: 1, result }))
const good: Verdict = { outcome: "allow", ruleId: "safe-shell", reason: "ok", risk: 0, decidedBy: "rules", policyHash: "a".repeat(64) }

describe("ApproverClient fails closed (invariant 1)", () => {
  it("returns the Approver's verdict and sends the token and the request shape", async () => {
    handler = (_q, res) => reply(res, { structuredContent: good, content: [] })
    const v = await client().evaluate(call, { ...ctx, mcpSource: "sdk", toolUseId: "t1" })
    expect(v).toEqual(good)
    const last = seen.at(-1)
    expect(last?.auth).toBe("Bearer tok")
    expect(last?.body).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "evaluate_permission", arguments: { toolName: "Bash", input: { command: "git status" }, ctx: { cwd: "C:/dev", sessionId: "s1", mcpSource: "sdk", toolUseId: "t1" } } },
    })
  })

  it("escalates when the server answers slowly, using the timeout", async () => {
    handler = () => undefined // never answers
    const t0 = Date.now()
    const v = await client(300).evaluate(call, ctx)
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(v).toMatchObject({ outcome: "escalate", ruleId: "evaluator-unavailable", decidedBy: "evaluator-unavailable" })
    expect(v.reason).toContain("timed out")
  })

  const bad: [string, Handler][] = [
    ["an HTTP error", (_q, res) => res.writeHead(500).end("boom")],
    ["a refusal (wrong token)", (_q, res) => res.writeHead(401).end("{}")],
    ["garbage instead of JSON", (_q, res) => res.writeHead(200).end("<html>not json</html>")],
    ["a JSON-RPC error", (_q, res) => res.writeHead(200).end(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32603, message: "x" } }))],
    ["an empty result", (_q, res) => res.writeHead(200).end(JSON.stringify({ jsonrpc: "2.0", id: 1 }))],
    ["a tool error", (_q, res) => reply(res, { isError: true, content: [{ type: "text", text: "bad" }] })],
    ["a result with no structured content", (_q, res) => reply(res, { content: [{ type: "text", text: "{}" }] })],
    ["an unknown outcome", (_q, res) => reply(res, { structuredContent: { ...good, outcome: "maybe" } })],
    ["an allow with no policy hash", (_q, res) => reply(res, { structuredContent: { ...good, policyHash: undefined } })],
    ["a risk out of range", (_q, res) => reply(res, { structuredContent: { ...good, risk: 500 } })],
    ["a dropped connection", (q) => q.socket.destroy()],
  ]
  for (const [name, h] of bad) {
    it(`escalates on ${name}, never allowing`, async () => {
      handler = h
      const v = await client().evaluate(call, ctx)
      expect(v.outcome).toBe("escalate")
      expect(v.decidedBy).toBe("evaluator-unavailable")
      expect(Verdict.safeParse(v).success).toBe(true)
    })
  }

  it("escalates when nothing is listening, without throwing", async () => {
    const dead = new ApproverClient({ url: "http://127.0.0.1:9/mcp", token: "tok", timeoutMs: 500 })
    const v = await dead.evaluate(call, ctx)
    expect(v).toMatchObject({ outcome: "escalate", ruleId: "evaluator-unavailable" })
  })

  it("reports status only when the Approver answers", async () => {
    handler = (_q, res) => reply(res, { structuredContent: { loaded: true } })
    expect(await client().status()).toEqual({ loaded: true })
    handler = (_q, res) => res.writeHead(500).end()
    expect(await client().status()).toBeUndefined()
  })

  it("builds an escalate verdict that is a valid Verdict", () => {
    expect(Verdict.safeParse(unavailableVerdict("down")).success).toBe(true)
    expect(unavailableVerdict("down").outcome).toBe("escalate")
  })
})
