// ADR 0020 (owner, 20 Nov): Codehouse trusts CNW through caddy's root certificate, not the leaf caddy renews every few
// hours. Against a real TLS server with a chain shaped like caddy's own authority (root, intermediate, leaf for the
// address): a leaf renewed under the same root keeps connecting, and so does a restart; another root, or a leaf for
// another address, is refused and CNW is told so (signed, never usable as a sign-in); an old leaf-pinned pairing moves
// to the root by itself; and trusting again needs the fingerprint you were shown and keeps the computer's id and key.
import crypto from "node:crypto"
import fs from "node:fs"
import https from "node:https"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { WebSocketServer } from "ws"
import { CnwConnector, newComputerKey, refusedText } from "../src/cnw/connector.js"
import { pair } from "../src/cnw/pairing.js"
import { CnwService } from "../src/cnw/service.js"
import { grouped, trustFor, type Trust } from "../src/cnw/trust.js"
import { makeIntermediate, makeLeaf, makeRoot, opensslPath, served, sha256Of, type Issued } from "./helpers/ca-chain.js"

let close: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of close.reverse()) await c()
  close = []
})

const until = async (ok: () => boolean, ms = 15_000) => {
  const end = Date.now() + ms
  while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 50))
}

/** A CNW stand-in at https://127.0.0.1:<port>: /agent/ca gives the root, /agent/pair answers, /agent speaks the challenge. */
async function fakeCnw(o: { tls: { key: string; cert: string }; root?: string; port?: number; welcomeCa?: boolean }) {
  const state = { root: o.root, hellos: 0, refusals: [] as Array<{ computer: string; ok: boolean }>, pairs: 0, challenge: "" }
  const keys = new Map<string, crypto.KeyObject>()
  const server = https.createServer(o.tls, (req, res) => {
    let b = ""
    req.on("data", (c) => (b += c))
    req.on("end", () => {
      if (req.url === "/agent/ca") return state.root ? res.writeHead(200).end(state.root) : res.writeHead(404).end("{}")
      if (req.url === "/agent/pair") {
        state.pairs++
        const body = JSON.parse(b) as { publicKey: string }
        keys.set("c1", crypto.createPublicKey({ key: Buffer.from(body.publicKey, "base64url"), format: "der", type: "spki" }))
        return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ computer: "c1" }))
      }
      res.writeHead(404).end()
    })
  })
  const wss = new WebSocketServer({ server, path: "/agent" })
  wss.on("connection", (ws) => {
    const challenge = crypto.randomBytes(16).toString("base64url")
    ws.send(JSON.stringify({ type: "challenge", challenge }))
    ws.on("message", (raw) => {
      const m = JSON.parse(String(raw)) as { type: string; computer: string; signature: string }
      const key = keys.get(m.computer)
      const signed = (text: string) => !!key && crypto.verify(null, Buffer.from(text), key, Buffer.from(m.signature, "base64url"))
      if (m.type === "hello" && signed(challenge)) {
        state.hellos++
        ws.send(JSON.stringify({ type: "welcome", protocol: 2, ...(state.root && o.welcomeCa !== false ? { ca: state.root } : {}) }))
      } else if (m.type === "refused") {
        state.refusals.push({ computer: m.computer, ok: signed(refusedText(challenge)) && !signed(challenge) })
        ws.close(4000)
      } else ws.close(4401)
    })
  })
  await new Promise<void>((r) => server.listen(o.port ?? 0, "127.0.0.1", r))
  const stop = async () => {
    for (const c of wss.clients) c.terminate()
    await new Promise((r) => wss.close(r))
    server.closeAllConnections()
    await new Promise((r) => server.close(r))
  }
  close.push(stop)
  return {
    url: `https://127.0.0.1:${(server.address() as { port: number }).port}`,
    port: (server.address() as { port: number }).port,
    state,
    keys,
    /** caddy renewing its leaf: the next connection gets the new one, and the open ones are dropped. */
    serve(tls: { key: string; cert: string }) {
      server.setSecureContext(tls)
      for (const c of wss.clients) c.terminate()
    },
    stop,
  }
}

function connector(url: string, privateKey: Buffer, o: { trust?: Trust; certSha256?: string }) {
  const c = new CnwConnector({ url, computerId: "c1", privateKey, ...o, version: "x", attach: () => undefined, log: (l) => process.env.CNW_DEBUG && console.log("LOG", l) })
  close.push(async () => c.stop())
  return c
}

/** Pairs as Codehouse does, keeping the private key. */
async function paired(url: string) {
  let key: Buffer | undefined
  const p = await pair(url, "K7M2-9QXP", "Desk", { seal: async (k) => void (key = k) })
  return { p, key: key! }
}

describe.skipIf(!opensslPath)("CNW's certificate, trusted through caddy's root (ADR 0020)", () => {
  const root = opensslPath ? makeRoot() : (undefined as unknown as Issued)
  const int = opensslPath ? makeIntermediate(root) : (undefined as unknown as Issued)

  it("pairs on the root, and keeps connecting when caddy renews the leaf, its intermediate, or restarts", async () => {
    // No root in the welcome: what keeps it connecting is the root pinned at pairing, not a move-over.
    const cnw = await fakeCnw({ tls: served(makeLeaf(int), int), root: root.cert, welcomeCa: false })
    const { p, key } = await paired(cnw.url)
    expect(p.trust).toEqual({ kind: "root", pem: new crypto.X509Certificate(root.cert).toString(), sha256: sha256Of(root.cert) })
    const c = connector(cnw.url, key, { trust: p.trust!, certSha256: p.certSha256 })
    c.start()
    await until(() => c.status === "connected")
    expect(c.status).toBe("connected")
    // A new leaf, with a new key, as caddy renews it every few hours.
    cnw.serve(served(makeLeaf(int), int))
    await until(() => cnw.state.hellos >= 2 && c.status === "connected")
    expect([cnw.state.hellos, c.status]).toEqual([2, "connected"])
    // A new intermediate too (caddy's renews about weekly), under the same root.
    const int2 = makeIntermediate(root)
    cnw.serve(served(makeLeaf(int2), int2))
    await until(() => cnw.state.hellos >= 3 && c.status === "connected")
    expect(c.status).toBe("connected")
    // caddy restarted, or scripts/update.sh rebuilt the stack: a new server on the same address, the same root kept.
    const port = cnw.port
    await cnw.stop()
    close = close.filter((f) => f !== cnw.stop)
    const again = await fakeCnw({ tls: served(makeLeaf(int2), int2), root: root.cert, port, welcomeCa: false })
    for (const [k, v] of cnw.keys) again.keys.set(k, v)
    // It may have tried the address while nothing listened, so it waits its growing pause first.
    await until(() => again.state.hellos >= 1 && c.status === "connected", 90_000)
    expect([again.state.hellos, c.status, c.refusal]).toEqual([1, "connected", undefined])
  }, 180_000)

  it("refuses another root or a leaf for another address, says so, sends nothing, and tells CNW in a way that signs no one in", async () => {
    const cnw = await fakeCnw({ tls: served(makeLeaf(int), int), root: root.cert })
    const { p, key } = await paired(cnw.url)
    const c = connector(cnw.url, key, { trust: p.trust!, certSha256: p.certSha256 })
    c.start()
    await until(() => c.status === "connected")
    const otherRoot = makeRoot("Another Authority")
    const otherInt = makeIntermediate(otherRoot)
    cnw.serve(served(makeLeaf(otherInt), otherInt))
    await until(() => c.status === "refused")
    expect([c.status, c.refusal]).toEqual(["refused", "certificate"])
    await until(() => cnw.state.refusals.length > 0)
    expect(cnw.state.refusals).toEqual([{ computer: "c1", ok: true }])
    expect(cnw.state.hellos).toBe(1)
    // The same root, but a certificate for another address: refused as well.
    const c2 = connector(cnw.url, key, { trust: p.trust!, certSha256: p.certSha256 })
    cnw.serve(served(makeLeaf(int, "127.0.0.2"), int))
    c2.start()
    await until(() => c2.status === "refused")
    expect([c2.status, c2.refusal, cnw.state.hellos]).toEqual(["refused", "certificate", 1])
  }, 90_000)

  it("moves an old leaf-pinned pairing to the root while its leaf still matches, so a renewal no longer breaks it", async () => {
    const leaf = makeLeaf(int)
    const cnw = await fakeCnw({ tls: served(leaf, int), root: root.cert })
    const k = newComputerKey()
    cnw.keys.set("c1", crypto.createPublicKey({ key: Buffer.from(k.publicKey, "base64url"), format: "der", type: "spki" }))
    const c = connector(cnw.url, k.privateKey, { certSha256: sha256Of(leaf.cert) })
    const moved: Trust[] = []
    c.on("trust", (t: Trust) => moved.push(t))
    c.start()
    await until(() => moved.length > 0)
    expect(moved.map((t) => [t.kind, t.kind === "root" ? t.sha256 : ""])).toEqual([["root", sha256Of(root.cert)]])
    cnw.serve(served(makeLeaf(int), int))
    await until(() => cnw.state.hellos >= 2 && c.status === "connected")
    expect([cnw.state.hellos, c.status]).toEqual([2, "connected"])
  }, 90_000)

  it("does not move an old pairing to a root its certificate does not check against", async () => {
    const leaf = makeLeaf(int)
    const cnw = await fakeCnw({ tls: served(leaf, int), root: makeRoot("Not the issuer").cert })
    const k = newComputerKey()
    cnw.keys.set("c1", crypto.createPublicKey({ key: Buffer.from(k.publicKey, "base64url"), format: "der", type: "spki" }))
    const c = connector(cnw.url, k.privateKey, { certSha256: sha256Of(leaf.cert) })
    const moved: Trust[] = []
    c.on("trust", (t: Trust) => moved.push(t))
    c.start()
    await until(() => c.status === "connected")
    await new Promise((r) => setTimeout(r, 1500))
    expect(moved).toEqual([])
  }, 60_000)

  it("trusts again only the fingerprint you confirmed, keeping this computer's id and key", async () => {
    const cnw = await fakeCnw({ tls: served(makeLeaf(int), int), root: root.cert })
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-cnw-trust-"))
    close.push(async () => fs.rmSync(dir, { recursive: true, force: true }))
    const recorded: string[] = []
    const svc = new CnwService({ dataDir: dir, version: "x", audit: { record: async (e: { event: string }) => (recorded.push(e.event), true) } as never, seal: async (b) => b, open: async (b) => b, log: () => undefined })
    close.push(async () => svc.stop())
    // A pairing from before, pinned on a leaf that has since been renewed.
    fs.writeFileSync(path.join(dir, "neighbourhood-watch.json"), JSON.stringify({ url: cnw.url, computerId: "c1", certSha256: "00".repeat(32), on: false }))
    fs.writeFileSync(path.join(dir, "neighbourhood-watch.key"), newComputerKey().privateKey)
    const seen = await svc.candidate()
    expect(seen).toEqual({ kind: "root", root: grouped(sha256Of(root.cert)) })
    await expect(svc.trustAgain(grouped(sha256Of(makeRoot("Someone else").cert)))).rejects.toThrow(/not the one you confirmed/)
    expect(svc.saved()?.trust).toBeUndefined()
    await svc.trustAgain(seen.root!)
    expect(svc.saved()).toMatchObject({ computerId: "c1", trust: { kind: "root", sha256: sha256Of(root.cert) } })
    expect(recorded).toEqual(["cnw_trusted_again"])
  }, 60_000)

  it("pins nothing it was given unless CNW's own certificate checks against it", async () => {
    const cnw = await fakeCnw({ tls: served(makeLeaf(int), int), root: makeRoot("Not the issuer").cert })
    await expect(trustFor(new URL(cnw.url))).rejects.toThrow(/does not check against the root it gave/)
    expect(cnw.state.pairs).toBe(0)
  }, 60_000)
})
