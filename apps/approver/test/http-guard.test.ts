import http from "node:http"
import net from "node:net"
import os from "node:os"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { ApproverServer } from "../src/server.js"
import { MAX_BODY_BYTES } from "../src/guard.js"
import { startApprover, TOKEN, type Running } from "./helpers.js"

let r: Running

beforeAll(async () => {
  r = await startApprover({ pwsh: undefined })
}, 60000)
afterAll(() => r.stop())

interface Reply {
  status: number
  body: string
  headers: http.IncomingHttpHeaders
}

function raw(opts: {
  method?: string
  path?: string
  headers?: Record<string, string>
  body?: string | Buffer
  chunked?: Buffer[]
}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: r.port,
        method: opts.method ?? "POST",
        path: opts.path ?? "/mcp",
        headers: opts.headers,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (c: Buffer) => chunks.push(c))
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            headers: res.headers,
          }),
        )
      },
    )
    req.on("error", reject)
    for (const c of opts.chunked ?? []) req.write(c)
    if (opts.body !== undefined) req.write(opts.body)
    req.end()
  })
}

const good = (extra: Record<string, string> = {}) => ({
  host: `127.0.0.1:${r.port}`,
  authorization: `Bearer ${TOKEN}`,
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  ...extra,
})
const listTools = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })

/** A refused oversize request may be answered with 413 or the connection may be reset after the answer. */
const statusOrReset = (e: NodeJS.ErrnoException) => ({
  status: e.code === "ECONNRESET" || e.code === "EPIPE" ? 413 : 0,
})

describe("the Approver listener (invariant 7)", () => {
  it("accepts a correct request", async () => {
    const reply = await raw({ headers: good(), body: listTools })
    expect(reply.status).toBe(200)
    expect(
      JSON.parse(reply.body)
        .result.tools.map((t: { name: string }) => t.name)
        .sort(),
    ).toEqual(["approval_prompt", "evaluate_permission", "explain_verdict", "policy_status"])
  })

  it("listens on 127.0.0.1 only", () => {
    expect(r.port).toBeGreaterThan(0)
    expect(r.server.address).toBe("127.0.0.1")
    return new Promise<void>((resolve, reject) => {
      // Another address of this machine must not reach it.
      const otherIps = Object.values(os.networkInterfaces())
        .flat()
        .filter((i) => i !== undefined && i.family === "IPv4" && !i.internal)
        .map((i) => (i as os.NetworkInterfaceInfo).address)
      if (otherIps.length === 0) return resolve()
      const sock = net.connect({ host: otherIps[0], port: r.port, timeout: 2000 })
      sock.on("connect", () => {
        sock.destroy()
        reject(new Error(`reachable on ${otherIps[0]}`))
      })
      sock.on("error", () => resolve())
      sock.on("timeout", () => {
        sock.destroy()
        resolve()
      })
    })
  })

  it("rejects a missing token and a wrong token with 401", async () => {
    for (const authorization of [undefined, "Bearer nope", `Bearer ${TOKEN}x`, TOKEN]) {
      const headers: Record<string, string> = good()
      if (authorization === undefined) delete headers.authorization
      else headers.authorization = authorization
      const reply = await raw({ headers, body: listTools })
      expect(reply.status, String(authorization)).toBe(401)
      expect(reply.headers["www-authenticate"]).toBe("Bearer")
      expect(reply.body).not.toContain("tools")
    }
  })

  it("rejects a Host header that is not the loopback address, even with the token", async () => {
    for (const host of [
      "evil.example",
      `evil.example:${r.port}`,
      "127.0.0.1:1",
      `localhost.evil.example:${r.port}`,
    ]) {
      const reply = await raw({ headers: good({ host }), body: listTools })
      expect(reply.status, host).toBe(403)
    }
    expect((await raw({ headers: good({ host: `localhost:${r.port}` }), body: listTools })).status).toBe(
      200,
    )
  })

  it("rejects any Origin header, even with the token and the right Host", async () => {
    for (const origin of ["https://evil.example", `http://127.0.0.1:${r.port}`, "null"]) {
      const reply = await raw({ headers: good({ origin }), body: listTools })
      expect(reply.status, origin).toBe(403)
    }
  })

  it("rejects other methods and paths", async () => {
    for (const method of ["GET", "DELETE", "PUT"]) {
      expect((await raw({ method, headers: good() })).status, method).toBe(405)
    }
    expect((await raw({ path: "/admin", headers: good(), body: listTools })).status).toBe(404)
    expect(
      (await raw({ path: "/admin", headers: { host: `127.0.0.1:${r.port}` }, body: listTools })).status,
    ).toBe(401)
  })

  it("rejects a body over 256 KB, declared or streamed", async () => {
    const big = Buffer.alloc(MAX_BODY_BYTES + 1, 0x61)
    const declared = await raw({
      headers: good({ "content-length": String(big.length) }),
      body: big,
    }).catch(statusOrReset)
    expect(declared.status).toBe(413)
    const streamed = await raw({
      headers: good({ "transfer-encoding": "chunked" }),
      chunked: [big.subarray(0, 200_000), big.subarray(200_000)],
    }).catch(statusOrReset)
    expect(streamed.status).toBe(413)
  })

  it("refuses a declared oversize body at once, without waiting for it to arrive", async () => {
    const status = await new Promise<number>((resolve) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: r.port,
          method: "POST",
          path: "/mcp",
          headers: good({ "content-length": "10000000" }),
        },
        (res) => {
          res.resume()
          resolve(res.statusCode ?? 0)
        },
      )
      req.on("error", () => resolve(413)) // the server closed the connection after answering
      req.write("{}") // a few bytes, then silence: only the declared length can reveal the problem
      setTimeout(() => {
        resolve(-1)
        req.destroy()
      }, 2500)
    })
    expect(status).toBe(413)
  })

  it("accepts a body just under the limit and the server stays up", async () => {
    const pad = "x".repeat(MAX_BODY_BYTES - 200)
    const body = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: { pad } })
    expect(Buffer.byteLength(body)).toBeLessThan(MAX_BODY_BYTES)
    expect((await raw({ headers: good(), body })).status).toBe(200)
    expect((await raw({ headers: good(), body: listTools })).status).toBe(200)
  })

  it("answers malformed JSON with a parse error and not a crash", async () => {
    const reply = await raw({ headers: good(), body: "{not json" })
    expect(reply.status).toBe(400)
    expect(JSON.parse(reply.body).error.code).toBe(-32700)
    expect((await raw({ headers: good(), body: listTools })).status).toBe(200)
  })

  it("will not start with a short token", () => {
    expect(
      () =>
        new ApproverServer({
          token: "short",
          port: 0,
          rules: { rulesPath: r.rulesPath },
          auditDir: r.auditDir,
        }),
    ).toThrow(/at least 32/)
  })
})
