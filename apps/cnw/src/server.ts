import crypto from "node:crypto"
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify"
import websocket from "@fastify/websocket"
import { z } from "zod"
import { accessOf, COOKIE, csrfOk, may, Sessions, Throttle, type Access } from "./auth.js"
import { parseRange, type Range } from "./allowlist.js"
import { Hub } from "./hub.js"
import { checkPublicKey, newCode, redeem, type Computer, type PendingCode } from "./pairing.js"
import { hashPassword, verifyPassword } from "./passwords.js"
import { JsonStore } from "./store.js"

/**
 * The CNW server (O41). Behind caddy, which ends TLS and passes the client's address in a header only caddy can set
 * (the server trusts it only from caddy's address on the private network). Every change needs a CSRF token; requests
 * from another origin are refused; the first account needs the one-time setup code the server prints at its first
 * start, so whoever reaches a new CNW first cannot claim it.
 */
export interface CnwOptions {
  dataDir: string
  /** The address people browse to, such as https://cnw.home.arpa. Origins other than this are refused. */
  publicUrl: string
  /** caddy's address, the only one whose X-Forwarded-For is believed. */
  trustedProxy?: string
  now?: () => number
  log?: (line: string) => void
}

interface Users {
  users: Array<{ name: string; password: string; passkeys: Array<{ id: string; publicKey: string; counter: number }> }>
  setupHash?: string
}
interface Settings {
  allowlist: string[]
}
interface Paired {
  computers: Computer[]
  pending: PendingCode[]
}

const Login = z.object({ name: z.string().min(1).max(60), password: z.string().min(1).max(500) })
const Setup = z.object({ code: z.string().min(1).max(100), name: z.string().min(1).max(60), password: z.string().min(12).max(500) })

export async function createCnw(o: CnwOptions) {
  const log = o.log ?? ((l: string) => process.stdout.write(`[cnw] ${l}\n`))
  const users = new JsonStore<Users>(o.dataDir, "users", () => ({ users: [] }))
  const settings = new JsonStore<Settings>(o.dataDir, "settings", () => ({ allowlist: [] }))
  const paired = new JsonStore<Paired>(o.dataDir, "computers", () => ({ computers: [], pending: [] }))
  const sessions = new Sessions(o.now)
  const throttle = new Throttle(o.now)
  const hub = new Hub(() => paired.read().computers, o.now)
  const origin = new URL(o.publicUrl).origin

  // First start: a one-time setup code, printed to the log only, kept as a hash.
  if (!users.read().users.length && !users.read().setupHash) {
    const code = crypto.randomBytes(9).toString("base64url")
    users.update((u) => ({ ...u, setupHash: crypto.createHash("sha256").update(code).digest("hex") }))
    log(`Setup code for the first account (shown once): ${code}`)
  }

  const ranges = (): Range[] => settings.read().allowlist.map(parseRange).filter((r): r is Range => typeof r !== "string")
  const ipOf = (req: FastifyRequest) => {
    const direct = req.socket.remoteAddress ?? ""
    const fwd = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim()
    return o.trustedProxy && direct.replace(/^::ffff:/, "") === o.trustedProxy && fwd ? fwd : direct
  }
  const cookieOf = (req: FastifyRequest) =>
    String(req.headers.cookie ?? "")
      .split(";")
      .map((c) => c.trim().split("="))
      .find(([k]) => k === COOKIE)?.[1]
  const access = (req: FastifyRequest): Access => accessOf(ipOf(req), cookieOf(req), sessions, ranges())
  const setCookie = (reply: FastifyReply, id: string, maxAge: number) =>
    reply.header("set-cookie", `${COOKIE}=${id}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`)

  const app = Fastify({ bodyLimit: 1024 * 1024 })
  await app.register(websocket, { options: { maxPayload: 4 * 1024 * 1024 } })

  // Another site's page can never drive CNW: a change must come from CNW's own origin and carry the CSRF token.
  app.addHook("onRequest", async (req, reply) => {
    const o2 = req.headers.origin
    if (o2 && o2 !== origin && !req.url.startsWith("/agent")) return reply.code(403).send({ error: "Wrong origin." })
    if (req.method !== "GET" && req.method !== "HEAD" && !req.url.startsWith("/api/login") && !req.url.startsWith("/api/setup")) {
      if (!csrfOk(access(req), String(req.headers["x-csrf-token"] ?? ""))) return reply.code(403).send({ error: "Sign in again." })
    }
  })

  const need = (req: FastifyRequest, reply: FastifyReply, action: string): Access | undefined => {
    const a = access(req)
    if (!may(a, action)) {
      reply.code(401).send({ error: a.kind === "allowlisted" ? "This needs you to sign in, even on an allowed network." : "Sign in first." })
      return undefined
    }
    return a
  }

  app.get("/api/me", async (req) => {
    const a = access(req)
    return { access: a.kind, ...(a.kind === "user" ? { user: a.user, csrf: a.csrf, passkey: a.passkey } : {}), setup: !users.read().users.length }
  })

  app.post("/api/setup", async (req, reply) => {
    const b = Setup.safeParse(req.body)
    if (!b.success) return reply.code(422).send({ error: "A name, a password of 12 or more characters, and the setup code." })
    const u = users.read()
    const given = crypto.createHash("sha256").update(b.data.code).digest("hex")
    if (u.users.length || !u.setupHash || u.setupHash !== given) return reply.code(403).send({ error: "That setup code is not right, or CNW is set up already." })
    const password = await hashPassword(b.data.password)
    users.write({ users: [{ name: b.data.name, password, passkeys: [] }] })
    const s = sessions.start(b.data.name, false)
    setCookie(reply, s.id, 7 * 24 * 3600)
    log(`First account made: ${b.data.name}`)
    return { ok: true, csrf: s.csrf }
  })

  app.post("/api/login", async (req, reply) => {
    const b = Login.safeParse(req.body)
    if (!b.success) return reply.code(422).send({ error: "A name and a password." })
    const keys = [`name:${b.data.name.toLowerCase()}`, `ip:${ipOf(req)}`]
    const wait = Math.max(...keys.map((k) => throttle.wait(k)))
    if (wait) return reply.code(429).send({ error: `Too many tries. Wait ${Math.ceil(wait / 1000)} seconds.` })
    const user = users.read().users.find((x) => x.name.toLowerCase() === b.data.name.toLowerCase())
    // The same work whether or not the name exists, so a wrong name and a wrong password look alike.
    const ok = await verifyPassword(b.data.password, user?.password ?? "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
    if (!user || !ok) {
      for (const k of keys) throttle.failed(k)
      log(`Sign-in refused for ${b.data.name} from ${ipOf(req)}`)
      return reply.code(401).send({ error: "That name and password do not match." })
    }
    for (const k of keys) throttle.succeeded(k)
    const s = sessions.start(user.name, false)
    setCookie(reply, s.id, 7 * 24 * 3600)
    log(`Signed in: ${user.name} from ${ipOf(req)}`)
    return { ok: true, csrf: s.csrf }
  })

  app.post("/api/logout", async (req, reply) => {
    sessions.end(cookieOf(req))
    setCookie(reply, "", 0)
    return { ok: true }
  })

  app.get("/api/allowlist", async (req, reply) => (need(req, reply, "view") ? { ranges: settings.read().allowlist } : undefined))
  app.put("/api/allowlist", async (req, reply) => {
    if (!need(req, reply, "allowlist")) return
    const list = z.array(z.string().max(60)).max(50).safeParse((req.body as { ranges?: unknown })?.ranges)
    if (!list.success) return reply.code(422).send({ error: "A list of addresses or ranges." })
    const bad = list.data.map((r) => [r, parseRange(r)] as const).find(([, p]) => typeof p === "string")
    if (bad) return reply.code(422).send({ error: `${bad[0]}: ${bad[1] as string}` })
    settings.update((s) => ({ ...s, allowlist: list.data }))
    log(`Allow list changed by ${(access(req) as { user?: string }).user ?? "?"}: ${list.data.join(", ") || "(empty)"}`)
    return { ranges: list.data }
  })

  app.get("/api/computers", async (req, reply) => (need(req, reply, "view") ? { computers: hub.status() } : undefined))
  app.post("/api/computers/code", async (req, reply) => {
    if (!need(req, reply, "pair")) return
    const label = String((req.body as { label?: unknown })?.label ?? "").slice(0, 60)
    const { code, pending } = newCode(label, (o.now ?? Date.now)())
    paired.update((p) => ({ ...p, pending: [...p.pending, pending].slice(-10) }))
    return { code, expiresInMinutes: 10 }
  })
  app.delete("/api/computers/:id", async (req, reply) => {
    if (!need(req, reply, "unpair")) return
    const id = (req.params as { id: string }).id
    paired.update((p) => ({ ...p, computers: p.computers.filter((c) => c.id !== id) }))
    hub.forget(id)
    log(`Computer removed: ${id}`)
    return { ok: true }
  })

  // A computer pairs with a code and its public key; no session needed, the code is the proof.
  app.post("/agent/pair", async (req, reply) => {
    const b = z.object({ code: z.string().max(20), publicKey: z.string().max(200), label: z.string().max(60).optional() }).safeParse(req.body)
    if (!b.success) return reply.code(422).send({ error: "A code and a public key." })
    const key = checkPublicKey(b.data.publicKey)
    if (!key) return reply.code(422).send({ error: "That is not an Ed25519 public key." })
    const wait = throttle.wait(`pair:${ipOf(req)}`)
    if (wait) return reply.code(429).send({ error: "Too many tries." })
    const r = redeem(b.data.code, paired.read().pending, (o.now ?? Date.now)())
    if (!r.match) {
      throttle.failed(`pair:${ipOf(req)}`)
      paired.update((p) => ({ ...p, pending: r.pending }))
      return reply.code(403).send({ error: "That code is not right, or it has expired." })
    }
    const computer: Computer = { id: crypto.randomUUID(), label: b.data.label || r.match.label, publicKey: key, pairedAt: new Date().toISOString() }
    paired.update((p) => ({ computers: [...p.computers, computer], pending: r.pending }))
    log(`Computer paired: ${computer.label}`)
    return { computer: computer.id }
  })

  app.get("/agent", { websocket: true }, (socket) => {
    const s = { send: (d: string) => socket.send(d), close: (c?: number, r?: string) => socket.close(c, r) }
    hub.agentOpened(s)
    socket.on("message", (raw: Buffer) => hub.agentMessage(s, raw.toString()))
    socket.on("close", () => hub.agentClosed(s))
  })

  app.get("/ws/:computer", { websocket: true }, (socket, req) => {
    const a = access(req)
    if (!may(a, "view")) return socket.close(4401, "sign in")
    const user = a.kind === "user" ? a.user : "allowed network"
    const id = (req.params as { computer: string }).computer
    const s = { send: (d: string) => socket.send(d), close: (c?: number, r?: string) => socket.close(c, r) }
    const stop = hub.watch(id, s, user, a.kind === "user")
    socket.on("message", (raw: Buffer) => {
      const r = hub.command(id, s, raw.toString())
      if (r !== "sent") s.send(JSON.stringify({ type: "refused", why: r }))
    })
    socket.on("close", stop)
  })

  return { app, hub }
}
