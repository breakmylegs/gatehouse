// E-040: the trace receiver takes only a project's token, from this computer, with no Origin, up to 4 MB of JSON; it
// redacts attributes and shows each trace as a span tree.
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { redactString } from "@gatehouse/policy"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { readExport, spanTree, startReceiver, TraceStore, TraceTokens } from "../src/trace-receiver.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-traces-"))
const tokens = new TraceTokens(path.join(dir, "trace-tokens.json"))
const store = new TraceStore()
let server: http.Server
let port = 0
let token = ""
/** A key-shaped secret, made here so none is written in the repository. */
const secret = ["AKIA", "IOSFODNN7", "EXAMPLE"].join("")

const fixture = {
  resourceSpans: [
    {
      resource: { attributes: [{ key: "service.name", value: { stringValue: "shop-api" } }] },
      scopeSpans: [
        {
          spans: [
            { traceId: "0af7651916cd43dd8448eb211c80319c", spanId: "b7ad6b7169203331", name: "GET /orders", startTimeUnixNano: "1763859723000000000", endTimeUnixNano: "1763859723250000000", attributes: [{ key: "http.status_code", value: { intValue: "200" } }] },
            { traceId: "0af7651916cd43dd8448eb211c80319c", spanId: "00f067aa0ba902b7", parentSpanId: "b7ad6b7169203331", name: "SELECT orders", startTimeUnixNano: "1763859723010000000", endTimeUnixNano: "1763859723200000000", status: { code: 2 }, attributes: [{ key: "db.connection", value: { stringValue: `aws_key=${secret}` } }] },
            { traceId: "0af7651916cd43dd8448eb211c80319c", spanId: "1111111111111111", parentSpanId: "00f067aa0ba902b7", name: "pool.acquire", startTimeUnixNano: "1763859723011000000", endTimeUnixNano: "1763859723020000000", attributes: [] },
          ],
        },
      ],
    },
  ],
}

function post(o: { body?: string | Buffer; headers?: Record<string, string>; path?: string }): Promise<number> {
  return new Promise((resolve, reject) => {
    const body = o.body ?? JSON.stringify(fixture)
    const req = http.request({ host: "127.0.0.1", port, path: o.path ?? "/v1/traces", method: "POST", headers: { host: `127.0.0.1:${port}`, "content-type": "application/json", "content-length": String(Buffer.byteLength(body)), authorization: `Bearer ${token}`, ...o.headers } }, (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on("error", (e) => ((e as NodeJS.ErrnoException).code === "ECONNRESET" || (e as NodeJS.ErrnoException).code === "EPIPE" ? resolve(413) : reject(e)))
    req.end(body)
  })
}

beforeAll(async () => {
  token = tokens.issue("C:/dev/shop")
  server = await startReceiver(0, { tokens, store, redact: (t) => redactString(t) })
  port = (server.address() as { port: number }).port
})
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
  fs.rmSync(dir, { recursive: true, force: true })
})

describe("the local trace receiver", () => {
  it("listens on 127.0.0.1 only", () => {
    expect((server.address() as { address: string }).address).toBe("127.0.0.1")
  })

  it("refuses a request with no token, or another project's", async () => {
    expect(await post({ headers: { authorization: "" } })).toBe(401)
    expect(await post({ headers: { authorization: "Bearer not-a-token" } })).toBe(401)
  })

  it("refuses a web page's request, another Host, other content and other paths", async () => {
    expect(await post({ headers: { origin: "https://evil.example" } })).toBe(403)
    expect(await post({ headers: { host: `evil.example:${port}` } })).toBe(421)
    expect(await post({ headers: { "content-type": "application/x-protobuf" } })).toBe(415)
    expect(await post({ path: "/v1/metrics" })).toBe(404)
  })

  it("refuses a 10 MB body", async () => {
    expect(await post({ body: Buffer.alloc(10 * 1024 * 1024, 32) })).toBe(413)
    // Refused by its stated length before any of it is read, even when less arrives.
    const said = await new Promise<number>((resolve) => {
      const req = http.request({ host: "127.0.0.1", port, path: "/v1/traces", method: "POST", headers: { host: `127.0.0.1:${port}`, "content-type": "application/json", authorization: `Bearer ${token}`, "content-length": String(10 * 1024 * 1024) } }, (res) => (res.resume(), resolve(res.statusCode ?? 0)))
      req.on("error", () => resolve(0))
      req.write(JSON.stringify(fixture))
    })
    expect(said).toBe(413)
    // Without a length said up front, it is cut off as it comes.
    const status = await new Promise<number>((resolve) => {
      const req = http.request({ host: "127.0.0.1", port, path: "/v1/traces", method: "POST", headers: { host: `127.0.0.1:${port}`, "content-type": "application/json", authorization: `Bearer ${token}`, "transfer-encoding": "chunked" } }, (res) => (res.resume(), resolve(res.statusCode ?? 0)))
      req.on("error", () => resolve(413))
      for (let i = 0; i < 10; i++) req.write(Buffer.alloc(1024 * 1024, 32))
      req.end()
    })
    expect(status).toBe(413)
  })

  it("takes a fixture trace, redacts its attributes, and renders it as a span tree", async () => {
    expect(await post({})).toBe(200)
    const [t] = store.traces("C:/dev/shop")
    expect(t).toMatchObject({ traceId: "0af7651916cd43dd8448eb211c80319c", root: "shop-api: GET /orders", spans: 3, ms: 250, error: true })
    const [root] = store.tree("C:/dev/shop", t!.traceId)
    expect(root!.name).toBe("GET /orders")
    expect(root!.children.map((c) => c.name)).toEqual(["SELECT orders"])
    expect(root!.children[0]!.children.map((c) => c.name)).toEqual(["pool.acquire"])
    expect(JSON.stringify(root)).not.toContain(secret)
    expect(store.traces("C:/dev/other")).toEqual([])
  })

  it("keeps tokens only as hashes, and a new token replaces the old one", () => {
    expect(fs.readFileSync(path.join(dir, "trace-tokens.json"), "utf8")).not.toContain(token)
    const next = tokens.issue("C:/dev/shop")
    expect(tokens.projectOf(next)).toBe("c:/dev/shop")
    expect(tokens.projectOf(token)).toBeUndefined()
    token = next
  })

  it("reads base64 ids and a span whose parent is missing as a root", () => {
    const spans = readExport({ resourceSpans: [{ scopeSpans: [{ spans: [{ traceId: Buffer.from("0af7651916cd43dd8448eb211c80319c", "hex").toString("base64"), spanId: "AAAAAAAAAAE=", parentSpanId: "ffffffffffffffff", name: "orphan" }] }] }] }, (t) => t)
    expect(spans[0]!.traceId).toBe("0af7651916cd43dd8448eb211c80319c")
    expect(spanTree(spans).map((n) => n.name)).toEqual(["orphan"])
  })
})
