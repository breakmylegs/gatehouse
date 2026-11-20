// ADR 0020, checked against caddy's real internal authority (tls internal), as CNW's stack runs it: pairs on caddy's
// root, connects, then makes caddy issue a new leaf with a new key (its stored leaf removed, caddy restarted, as a
// renewal or a rebuild does) and checks the computer connects again with no pairing; an old leaf-pinned pairing moves
// to the root. Nothing is published and nothing is trusted on this computer (skip_install_trust).
//
// Usage: CADDY=<path to caddy 2.10 or later> node node_modules/tsx/dist/cli.mjs scripts/cnw-caddy-check.ts
import { spawn, type ChildProcess } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import http from "node:http"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import tls from "node:tls"
import { WebSocketServer } from "ws"
import { CnwConnector, newComputerKey } from "../apps/host/src/cnw/connector.js"
import { pair } from "../apps/host/src/cnw/pairing.js"
import type { Trust } from "../apps/host/src/cnw/trust.js"

const caddy = process.env.CADDY
if (!caddy || !fs.existsSync(caddy)) throw new Error("Set CADDY to caddy's program.")
const say = (t: string) => console.log(`[cnw-caddy] ${t}`)
let failed = false
const check = (ok: boolean, what: string) => {
  say(`${ok ? "ok  " : "FAIL"} ${what}`)
  if (!ok) failed = true
}
const until = async (ok: () => boolean, ms: number) => {
  const end = Date.now() + ms
  while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 200))
  return ok()
}
const freePort = () =>
  new Promise<number>((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port
      s.close(() => resolve(p))
    })
  })

const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "cnw-caddy-")))
const storage = path.join(dir, "data")
const rootFile = path.join(storage, "pki", "authorities", "local", "root.crt")
const leafDir = path.join(storage, "certificates", "local", "127.0.0.1")

// The stand-in for CNW behind caddy: /agent/ca, /agent/pair and the agent socket, as apps/cnw does them.
const keys = new Map<string, crypto.KeyObject>()
let hellos = 0
const backend = http.createServer((req, res) => {
  let b = ""
  req.on("data", (c) => (b += c))
  req.on("end", () => {
    if (req.url === "/agent/ca") return fs.existsSync(rootFile) ? res.writeHead(200).end(fs.readFileSync(rootFile)) : res.writeHead(404).end()
    if (req.url === "/agent/pair") {
      const body = JSON.parse(b) as { publicKey: string }
      keys.set("c1", crypto.createPublicKey({ key: Buffer.from(body.publicKey, "base64url"), format: "der", type: "spki" }))
      return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ computer: "c1" }))
    }
    res.writeHead(404).end()
  })
})
const wss = new WebSocketServer({ server: backend, path: "/agent" })
wss.on("connection", (ws) => {
  const challenge = crypto.randomBytes(16).toString("base64url")
  ws.send(JSON.stringify({ type: "challenge", challenge }))
  ws.on("message", (raw) => {
    const m = JSON.parse(String(raw)) as { type: string; computer: string; signature: string }
    const key = keys.get(m.computer)
    if (m.type === "hello" && key && crypto.verify(null, Buffer.from(challenge), key, Buffer.from(m.signature, "base64url"))) {
      hellos++
      ws.send(JSON.stringify({ type: "welcome", protocol: 2, ca: fs.readFileSync(rootFile, "utf8") }))
    } else ws.close(4401)
  })
})

let proc: ChildProcess | undefined
async function startCaddy(port: number, back: number): Promise<void> {
  const file = path.join(dir, "Caddyfile")
  fs.writeFileSync(
    file,
    [
      "{",
      "\tadmin off",
      "\tskip_install_trust",
      `\tstorage file_system ${JSON.stringify(storage)}`,
      "\tdefault_sni 127.0.0.1",
      "\tauto_https disable_redirects",
      `\thttps_port ${port}`,
      `\thttp_port ${await freePort()}`,
      "}",
      `https://127.0.0.1:${port} {`,
      "\ttls internal",
      `\treverse_proxy 127.0.0.1:${back}`,
      "}",
      "",
    ].join("\n"),
  )
  proc = spawn(caddy!, ["run", "--config", file, "--adapter", "caddyfile"], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true })
  proc.stderr?.on("data", () => undefined)
  const ok = await until(() => fs.existsSync(rootFile) && fs.existsSync(leafDir), 30_000)
  if (!ok) throw new Error("caddy did not make its certificates")
  await new Promise((r) => setTimeout(r, 1500))
}
async function stopCaddy(): Promise<void> {
  const p = proc
  proc = undefined
  if (!p || p.exitCode !== null) return
  p.kill()
  await new Promise((r) => p.once("exit", r))
}
const leafSha = (port: number) =>
  new Promise<string>((resolve, reject) => {
    const s = tls.connect({ host: "127.0.0.1", port, rejectUnauthorized: false }, () => {
      const raw = s.getPeerCertificate(false).raw
      s.end()
      resolve(crypto.createHash("sha256").update(raw).digest("hex"))
    })
    s.on("error", reject)
  })

try {
  await new Promise<void>((r) => backend.listen(0, "127.0.0.1", r))
  const back = (backend.address() as net.AddressInfo).port
  const port = await freePort()
  await startCaddy(port, back)
  const url = `https://127.0.0.1:${port}`
  say(`caddy ${url}, its own authority in ${storage}`)
  let key: Buffer | undefined
  const p = await pair(url, "K7M2-9QXP", "Check", { seal: async (k) => void (key = k) })
  const root = crypto.createHash("sha256").update(new crypto.X509Certificate(fs.readFileSync(rootFile)).raw).digest("hex")
  check(p.trust?.kind === "root" && p.trust.sha256 === root, "paired on caddy's root certificate")
  const c = new CnwConnector({ url, computerId: "c1", privateKey: key!, certSha256: p.certSha256, trust: p.trust!, version: "check", attach: () => undefined, log: (l) => say(`  ${l}`) })
  c.start()
  check(await until(() => c.status === "connected", 20_000), "connected")
  const before = await leafSha(port)
  // A renewal or a rebuild: caddy's stored leaf goes, and caddy issues a new one with a new key under the same root.
  await stopCaddy()
  fs.rmSync(leafDir, { recursive: true, force: true })
  await startCaddy(port, back)
  const after = await leafSha(port)
  check(before !== after, "caddy issued a new leaf certificate")
  check(await until(() => c.status === "connected" && hellos >= 2, 90_000), "connected again with no pairing, on the new leaf")
  // A pairing from before, pinned on today's leaf, moves to the root while that leaf matches.
  const old = newComputerKey()
  keys.set("c1", crypto.createPublicKey({ key: Buffer.from(old.publicKey, "base64url"), format: "der", type: "spki" }))
  c.stop()
  const legacy = new CnwConnector({ url, computerId: "c1", privateKey: old.privateKey, certSha256: after, version: "check", attach: () => undefined, log: (l) => say(`  ${l}`) })
  const moved: Trust[] = []
  legacy.on("trust", (t: Trust) => moved.push(t))
  legacy.start()
  check(await until(() => moved.length > 0, 20_000) && moved[0]?.kind === "root" && moved[0].sha256 === root, "an old leaf-pinned pairing moved to the root")
  legacy.stop()
} catch (e) {
  failed = true
  say(`FAIL ${(e as Error).message}`)
} finally {
  await stopCaddy()
  for (const w of wss.clients) w.terminate()
  wss.close()
  backend.close()
  fs.rmSync(dir, { recursive: true, force: true })
}
say(failed ? "FAILED" : "passed")
process.exit(failed ? 1 : 0)
