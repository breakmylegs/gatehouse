// O41 with caddy's own certificate (an IP address or a home name): against a real TLS server with a self-signed
// certificate, the connector connects and answers the challenge when the pinned certificate is the one served; with
// another it sends nothing, not even hello, and stays refused; pairing sends the code and key to nothing unpinned; and
// a pairing with no label is named after this computer.
import crypto from "node:crypto"
import https from "node:https"
import os from "node:os"
import { afterEach, describe, expect, it } from "vitest"
import { WebSocketServer } from "ws"
import { CnwConnector, newComputerKey } from "../src/cnw/connector.js"
import { pair, pinnedPost } from "../src/cnw/pairing.js"
import { opensslPath, selfSigned } from "./helpers/self-signed.js"

let close: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of close) await c()
  close = []
})

/** A CNW stand-in at https://127.0.0.1:<port>: /agent speaks the challenge, and every request body is kept. */
async function fakeCnw(tls: { key: string; cert: string }) {
  const bodies: string[] = []
  const agentMessages: Array<Record<string, unknown>> = []
  const server = https.createServer(tls, (req, res) => {
    let b = ""
    req.on("data", (c) => (b += c))
    req.on("end", () => {
      bodies.push(b)
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ computer: "c1" }))
    })
  })
  const wss = new WebSocketServer({ server, path: "/agent" })
  wss.on("connection", (ws) => {
    ws.send(JSON.stringify({ type: "challenge", challenge: "abc" }))
    ws.on("message", (raw) => {
      const m = JSON.parse(String(raw)) as Record<string, unknown>
      agentMessages.push(m)
      if (m.type === "hello") ws.send(JSON.stringify({ type: "welcome" }))
    })
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  close.push(async () => {
    for (const c of wss.clients) c.terminate()
    await new Promise((r) => wss.close(r))
    server.closeAllConnections()
    await new Promise((r) => server.close(r))
  })
  return { url: `https://127.0.0.1:${(server.address() as { port: number }).port}`, bodies, agentMessages }
}

function connector(url: string, certSha256: string) {
  const c = new CnwConnector({ url, computerId: "c1", privateKey: newComputerKey().privateKey, certSha256, version: "x", attach: () => undefined, log: () => undefined })
  close.push(async () => c.stop())
  return c
}

const until = async (ok: () => boolean, ms = 15_000) => {
  const end = Date.now() + ms
  while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 50))
}

describe.skipIf(!opensslPath)("Neighbourhood Watch over TLS with its own certificate (needs openssl to make one)", () => {
  it("connects and answers the challenge when the pinned certificate is the one served", async () => {
    const tls = selfSigned()
    const cnw = await fakeCnw(tls)
    const c = connector(cnw.url, tls.sha256)
    c.start()
    await until(() => c.status === "connected")
    expect(c.status).toBe("connected")
    expect(cnw.agentMessages[0]).toMatchObject({ type: "hello", computer: "c1" })
  }, 30_000)

  it("sends nothing, not even hello, to a server with another certificate, and stays refused saying why", async () => {
    const served = selfSigned()
    const pinned = selfSigned()
    const cnw = await fakeCnw(served)
    const c = connector(cnw.url, pinned.sha256)
    c.start()
    await until(() => c.status === "refused")
    expect([c.status, c.refusal]).toEqual(["refused", "certificate"])
    // A moment for anything that might still arrive.
    await new Promise((r) => setTimeout(r, 300))
    expect(cnw.agentMessages).toEqual([])
  }, 30_000)

  it("pairing writes the code and key only to the pinned certificate, and nothing to another", async () => {
    const tls = selfSigned()
    const cnw = await fakeCnw(tls)
    await expect(pinnedPost(new URL("/agent/pair", cnw.url), { code: "K7M2", publicKey: "pk" }, crypto.randomBytes(32).toString("hex"))).rejects.toThrow(/nothing was sent/)
    expect(cnw.bodies).toEqual([])
    const r = await pinnedPost(new URL("/agent/pair", cnw.url), { code: "K7M2", publicKey: "pk" }, tls.sha256)
    expect(r.status).toBe(200)
    expect(JSON.parse(cnw.bodies[0]!)).toEqual({ code: "K7M2", publicKey: "pk" })
  }, 30_000)
})

describe("pairing's label", () => {
  it("is this computer's name when none is given", async () => {
    const sent: Array<Record<string, unknown>> = []
    await pair("https://192.168.1.225:8443", "K7M2", "  ", {
      seal: async () => undefined,
      fingerprint: async () => "f".repeat(64),
      post: async (_u, body) => (sent.push(body as Record<string, unknown>), { status: 200, json: { computer: "c1" } }),
    })
    expect(sent[0]?.label).toBe(os.hostname().slice(0, 60))
  })
})
