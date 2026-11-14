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

const client = (timeoutMs = 500, token = "tok") =>
  new ApproverClient({ url: `http://127.0.0.1:${port}/mcp`, token, timeoutMs })
const call = { toolName: "Bash", input: { command: "git status" } }
const ctx = { cwd: "C:/dev", sessionId: "s1" }
const reply = (res: http.ServerResponse, result: unknown) =>
  res
    .writeHead(200, { "content-type": "application/json" })
    .end(JSON.stringify({ jsonrpc: "2.0", id: 1, result }))
const good: Verdict = {
  outcome: "allow",
  ruleId: "safe-shell",
  reason: "ok",
  risk: 0,
  decidedBy: "rules",
  policyHash: "a".repeat(64),
}

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
      params: {
        name: "evaluate_permission",
        arguments: {
          toolName: "Bash",
          input: { command: "git status" },
          ctx: { cwd: "C:/dev", sessionId: "s1", mcpSource: "sdk", toolUseId: "t1" },
        },
      },
    })
  })

  it("escalates when the server answers slowly, using the timeout", async () => {
    handler = () => undefined // never answers
    const t0 = Date.now()
    const v = await client(300).evaluate(call, ctx)
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(v).toMatchObject({
      outcome: "escalate",
      ruleId: "evaluator-unavailable",
      decidedBy: "evaluator-unavailable",
    })
    expect(v.reason).toContain("timed out")
  })

  it("tries once more after a timeout, with twice the time, and takes the answer (O30)", async () => {
    // The Approver stalls on the first call (as it did under memory pressure, 12 and 14 Nov) and answers the second.
    let n = 0
    handler = (_q, res) => {
      n++
      if (n === 1) return // stalls past the limit
      setTimeout(() => reply(res, { structuredContent: good, content: [] }), 350)
    }
    const retried: string[] = []
    const c = new ApproverClient({ url: `http://127.0.0.1:${port}/mcp`, token: "tok", timeoutMs: 300, onRetry: (call) => retried.push(call.toolName) })
    // 350 ms is past the first limit (300) but within the second (600).
    expect(await c.evaluate(call, ctx)).toEqual(good)
    expect(n).toBe(2)
    expect(retried).toEqual(["Bash"])
  })

  it("still escalates when the second try times out too, and retries nothing but a timeout", async () => {
    let n = 0
    handler = () => void n++ // never answers
    expect(await client(200).evaluate(call, ctx)).toMatchObject({ outcome: "escalate", ruleId: "evaluator-unavailable" })
    expect(n).toBe(2)
    n = 0
    handler = (_q, res) => {
      n++
      reply(res, { structuredContent: { outcome: "allow" }, content: [] })
    }
    expect(await client(200).evaluate(call, ctx)).toMatchObject({ outcome: "escalate", reason: expect.stringContaining("malformed") })
    expect(n).toBe(1)
  })

  const bad: [string, Handler][] = [
    ["an HTTP error", (_q, res) => res.writeHead(500).end("boom")],
    ["a refusal (wrong token)", (_q, res) => res.writeHead(401).end("{}")],
    ["garbage instead of JSON", (_q, res) => res.writeHead(200).end("<html>not json</html>")],
    [
      "a JSON-RPC error",
      (_q, res) =>
        res
          .writeHead(200)
          .end(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32603, message: "x" } })),
    ],
    [
      "an empty result",
      (_q, res) => res.writeHead(200).end(JSON.stringify({ jsonrpc: "2.0", id: 1 })),
    ],
    [
      "a tool error",
      (_q, res) => reply(res, { isError: true, content: [{ type: "text", text: "bad" }] }),
    ],
    [
      "a result with no structured content",
      (_q, res) => reply(res, { content: [{ type: "text", text: "{}" }] }),
    ],
    [
      "an unknown outcome",
      (_q, res) => reply(res, { structuredContent: { ...good, outcome: "maybe" } }),
    ],
    [
      "an allow with no policy hash",
      (_q, res) => reply(res, { structuredContent: { ...good, policyHash: undefined } }),
    ],
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
