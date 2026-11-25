import crypto from "node:crypto"
import tls from "node:tls"
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify"
import websocket from "@fastify/websocket"
import fastifyStatic from "@fastify/static"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { accessOf, COOKIE, csrfOk, may, Sessions, Throttle, type Access } from "./auth.js"
import { parseRange, type Range } from "./allowlist.js"
import { Hub, PROTOCOL } from "./hub.js"
import { FRESH_MS, order, SEVERE_RISK, summarise, type BoardRow } from "./board.js"
import { checkPublicKey, newCode, redeem, type Computer, type PendingCode } from "./pairing.js"
import { hashPassword, verifyPassword } from "./passwords.js"
import { JsonStore } from "./store.js"
import { PASSKEY_ON_IP, passkeysPossible, registerPasskeyRoutes } from "./passkeys.js"
import { checkSso, type SsoSettings } from "./sso.js"
import { fetchMetadata, registerSsoRoutes } from "./sso-routes.js"
import { checkSettings, effective, grouped, newCertificate, type ServerSettings } from "./server-settings.js"
import { bareHost } from "./tls.js"
import { BackupError, makeBackup, openBackup, restoreFiles } from "./backup.js"
import { CHANNEL_KINDS, checkChannel, checkRule, ruleAllows, sendMail, sendTo, type Channel, type ChannelKind } from "./channels.js"
import { checkSubscription, sendPush, Vapid, type Subscription } from "./webpush.js"
import { base32, hashRecovery, newSecret, otpauthUri, recoveryCodes, Sealer, verifyCode } from "./totp.js"
import { commandAllowed, httpAllowed, roleMay, roleOf, ROLES, seesComputer, type Role } from "./roles.js"

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
  /** The built Codehouse interface (apps/web/dist), served at /app/. */
  webDir?: string
  /** The environment the settings fall back to (CNW_HOST, CNW_TLS, CNW_PORT, CNW_MODE...). */
  env?: Record<string, string | undefined>
  /** caddy's configuration folder (root.crt), read only. */
  caddyConfigDir?: string
  /** Reads the certificate caddy serves for a host, as SHA-256 hex; for tests. */
  certificateOf?: (host: string) => Promise<string | undefined>
  /** Sends one email; for tests. */
  smtp?: typeof sendMail
  /** Posts a push to its service; for tests. */
  post?: (url: string, init: { method: string; headers: Record<string, string>; body: Buffer }) => Promise<{ status: number }>
  /** Ends the process after a restore, so it starts again from the restored files; for tests. */
  exit?: (code: number) => void
  /** Asks the updater to apply the Server page's settings; for tests. */
  applySettings?: (s: { host: string; tls: string; port: string }) => Promise<{ ok: boolean; message: string }>
  now?: () => number
  log?: (line: string) => void
  /** O52, tests only: an OpenID Connect provider or SAML metadata on plain http on this machine. */
  ssoAllowHttp?: boolean
  /** O52: reads the SAML metadata URL; tests stand in for the IdP. */
  fetchText?: (url: string) => Promise<string>
}

interface Users {
  /** `name` is the account's key and display name; `email` is what you sign in with (uplift phase 2). An account
   * made before email sign-in has none until its next sign-in asks for it. */
  users: Array<{
    name: string
    email?: string
    password: string
    passkeys: Array<{ id: string; publicKey: string; counter: number }>
    /** Uplift phase 4: absent on an account from before roles, which is an owner. */
    role?: Role
    /** The computers this person sees; absent for every one. */
    computers?: string[]
    /** A second factor (TOTP), its secret sealed. */
    totp?: { sealed: string; recovery: string[]; lastStep?: number }
    /** O52: the single sign-on identities linked to this account ("oidc:<issuer>|<sub>", "saml:<idp>|<NameID>"). */
    sso?: string[]
  }>
  setupHash?: string
}
interface Settings {
  allowlist: string[]
  /** Uplift phase 5: whether CNW updates by itself, and at which hour. */
  updates?: { auto: boolean; hour: number }
}
/** What changed CNW's own settings, and who: kept for the audit log viewer (uplift phase 5), the newest 1000. */
interface Audit {
  entries: Array<{ at: string; user: string; action: string; detail: string }>
}
/** Invites to join, kept as hashes of their links, for seven days. */
interface Invites {
  invites: Array<{ hash: string; email: string; role: Role; computers?: string[]; by: string; expires: string }>
}
interface Paired {
  computers: Computer[]
  pending: PendingCode[]
}

/** An address as compared: no IPv4-mapped prefix, no brackets, lower case. */
const bare = (a: string) => a.trim().replace(/^\[|\]$/g, "").replace(/^::ffff:/i, "").toLowerCase()

/** An email address as CNW takes it: one @, a dot in the domain, no spaces, at most 254 characters. */
export const EMAIL = /^[^s@]{1,64}@[^s@.]+(.[^s@.]+)+$/
const email = z.string().trim().toLowerCase().max(254).regex(EMAIL)
// `login` (or `email`, or `name` from an older page) is an email, or the name of an account that has no email yet.
const Login = z.object({ login: z.string().min(1).max(254).optional(), email: z.string().max(254).optional(), name: z.string().max(60).optional(), password: z.string().min(1).max(500) })
const Setup = z.object({ code: z.string().min(1).max(100), email: email.optional(), name: z.string().min(1).max(60).optional(), password: z.string().min(12).max(500) }).refine((b) => b.email || b.name)
const SetEmail = z.object({ email, password: z.string().max(500).optional() })

export async function createCnw(o: CnwOptions) {
  const log = o.log ?? ((l: string) => process.stdout.write(`[cnw] ${l}\n`))
  const users = new JsonStore<Users>(o.dataDir, "users", () => ({ users: [] }))
  const settings = new JsonStore<Settings>(o.dataDir, "settings", () => ({ allowlist: [] }))
  const paired = new JsonStore<Paired>(o.dataDir, "computers", () => ({ computers: [], pending: [] }))
  const server = new JsonStore<ServerSettings>(o.dataDir, "server", () => ({}))
  const audit = new JsonStore<Audit>(o.dataDir, "audit", () => ({ entries: [] }))
  const invites = new JsonStore<Invites>(o.dataDir, "invites", () => ({ invites: [] }))
  const sha = (t: string) => crypto.createHash("sha256").update(t).digest("hex")
  const sealer = new Sealer(o.dataDir)
  const loginTickets = new Map<string, { user: string; until: number; sso?: boolean }>()
  const ssoStore = new JsonStore<SsoSettings>(o.dataDir, "sso", () => ({}))
  const env = o.env ?? process.env
  const ownProxy = env.CNW_MODE === "own-proxy"
  const record = (user: string, action: string, detail: string) =>
    audit.update((a) => ({ entries: [...a.entries, { at: new Date((o.now ?? Date.now)()).toISOString(), user, action, detail }].slice(-1000) }))
  const sessions = new Sessions(o.now)
  const throttle = new Throttle(o.now)
  // ADR 0020: caddy's root certificate (public), copied by cnw-config next to its configuration.
  const caddyRoot = () => {
    try {
      const pem = fs.readFileSync(path.join(o.caddyConfigDir ?? "/caddy-config", "root.crt"), "utf8")
      return pem.includes("-----BEGIN CERTIFICATE-----") && !/PRIVATE KEY/.test(pem) ? pem : undefined
    } catch {
      return undefined
    }
  }
  const hub = new Hub(() => paired.read().computers, o.now, caddyRoot)
  const origin = new URL(o.publicUrl).origin
  const rpId = new URL(o.publicUrl).hostname

  // First start: a one-time setup code, printed to the log only, kept as a hash.
  if (!users.read().users.length && !users.read().setupHash) {
    const code = crypto.randomBytes(9).toString("base64url")
    users.update((u) => ({ ...u, setupHash: crypto.createHash("sha256").update(code).digest("hex") }))
    log(`Setup code for the first account (shown once): ${code}`)
  }

  const ranges = (): Range[] => settings.read().allowlist.map(parseRange).filter((r): r is Range => typeof r !== "string")
  // X-Forwarded-For is believed only from the trusted proxy (the bundled caddy, or your own); from anyone else, or
  // with no trusted proxy set, it is ignored and the connection's own address counts.
  // Behind your own proxy, the one saved on the Server page wins over .env; with the bundled caddy it is always caddy.
  const trusted = () => {
    const saved = server.read().trustedProxy
    const list = ownProxy && saved !== undefined ? saved : (o.trustedProxy ?? "")
    return new Set(list.split(",").map((a) => bare(a)).filter(Boolean))
  }
  const ipOf = (req: FastifyRequest) => {
    const direct = req.socket.remoteAddress ?? ""
    const fwd = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim()
    return trusted().has(bare(direct)) && fwd ? fwd : direct
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
    // O52: the IdP posts its SAML answer from its own origin; that one address checks it by its signature and a request
    // id CNW made and uses once, and signs nobody in until this browser's own same-site request (/api/sso/saml/finish).
    const samlAcs = req.method === "POST" && req.url.split("?")[0] === "/api/sso/saml/acs"
    if (o2 && o2 !== origin && !req.url.startsWith("/agent") && !samlAcs) return reply.code(403).send({ error: "Wrong origin." })
    // /agent is a computer, not a browser: no cookie gives it anything, and it proves itself with the pairing code or
    // its signed key, so a CSRF token means nothing there.
    if (req.method !== "GET" && req.method !== "HEAD" && !req.url.startsWith("/agent") && !req.url.startsWith("/api/login") && !req.url.startsWith("/api/setup") && !req.url.startsWith("/api/passkey/login") && !req.url.startsWith("/api/invite/accept") && !req.url.startsWith("/api/password/") && !samlAcs) {
      if (!csrfOk(access(req), String(req.headers["x-csrf-token"] ?? ""))) return reply.code(403).send({ error: "Sign in again." })
    }
  })

  const userOf = (name: string) => users.read().users.find((u) => u.name === name)
  const startFor = (req: FastifyRequest, user: string, passkey: boolean) => sessions.start(user, passkey, { ua: String(req.headers["user-agent"] ?? ""), ip: ipOf(req) })
  /** A code from the person's app, or one of their recovery codes (used up); the step used is kept, so no code is used twice. */
  const secondFactor = (u: Users["users"][number], code: string): boolean => {
    if (!u.totp) return true
    let secret: Buffer
    try {
      secret = sealer.open(u.totp.sealed)
    } catch {
      return false
    }
    const step = verifyCode(secret, code, (o.now ?? Date.now)(), u.totp.lastStep ?? -1)
    if (step !== undefined) {
      users.update((v) => ({ ...v, users: v.users.map((x) => (x.name === u.name && x.totp ? { ...x, totp: { ...x.totp, lastStep: step } } : x)) }))
      return true
    }
    const h = hashRecovery(code)
    if (code.trim() && u.totp.recovery.includes(h)) {
      users.update((v) => ({ ...v, users: v.users.map((x) => (x.name === u.name && x.totp ? { ...x, totp: { ...x.totp, recovery: x.totp.recovery.filter((r) => r !== h) } } : x)) }))
      record(u.name, "recovery-code-used", `${u.totp.recovery.length - 1} left`)
      return true
    }
    return false
  }
  // Uplift phase 2: an account from before email sign-in adds its email first; until then it can do nothing else.
  const needsEmail = (a: Access) => a.kind === "user" && !userOf(a.user)?.email
  const need = (req: FastifyRequest, reply: FastifyReply, action: string): Access | undefined => {
    const a = access(req)
    if (needsEmail(a)) {
      reply.code(403).send({ error: "Add your email first: it is how you sign in from now on.", needEmail: true })
      return undefined
    }
    if (!may(a, action)) {
      reply.code(401).send({ error: a.kind === "allowlisted" ? "This needs you to sign in, even on an allowed network." : "Sign in first." })
      return undefined
    }
    // Uplift phase 4: what this person's role allows.
    if (a.kind === "user" && !roleMay(roleOf(userOf(a.user)?.role), action)) {
      reply.code(403).send({ error: "Your role in Neighbourhood Watch does not allow that. An owner or an admin can change it." })
      return undefined
    }
    return a
  }
  // The role a request acts with: a person's own; an allowed network's as before roles (everything but the signed-in
  // actions, which may() refuses it).
  const roleFor = (a: Access): Role => (a.kind === "user" ? roleOf(userOf(a.user)?.role) : "owner")
  const sees = (a: Access, id: string) => a.kind !== "user" || seesComputer(userOf(a.user)?.computers, id)

  app.get("/api/me", async (req) => {
    const a = access(req)
    return {
      access: a.kind,
      ...(a.kind === "user" ? { user: a.user, csrf: a.csrf, passkey: a.passkey, role: roleFor(a), totp: Boolean(userOf(a.user)?.totp), ...(userOf(a.user)?.email ? { email: userOf(a.user)!.email } : { needsEmail: true }) } : {}),
      setup: !users.read().users.length,
      // O52: the single sign-on buttons the sign-in page offers.
      ...(() => {
        const s = ssoStore.read()
        const sso = { ...(s.oidc?.sealedSecret ? { oidc: s.oidc.label ?? "Single sign-on" } : {}), ...(s.saml ? { saml: s.saml.label ?? "Single sign-on (SAML)" } : {}) }
        return Object.keys(sso).length ? { sso } : {}
      })(),
      ...(a.kind === "user" && userOf(a.user)?.sso?.length ? { ssoLinked: userOf(a.user)!.sso!.length } : {}),
      // Whether a Severe allow would go through now (signed in or again in the last five minutes); after a single
      // sign-on it would not, until the password (and its code) or a passkey is given again.
      ...(a.kind === "user" ? { severeReady: (o.now ?? Date.now)() - a.confirmedAt <= FRESH_MS } : {}),
      // Passkeys cannot work at an IP address; the page says so and offers the password only.
      passkeys: passkeysPossible(rpId),
      ...(passkeysPossible(rpId) ? {} : { passkeyNote: PASSKEY_ON_IP }),
    }
  })

  app.post("/api/setup", async (req, reply) => {
    const b = Setup.safeParse(req.body)
    if (!b.success) return reply.code(422).send({ error: "Your email, a password of 12 or more characters, and the setup code." })
    const u = users.read()
    const given = crypto.createHash("sha256").update(b.data.code).digest("hex")
    if (u.users.length || !u.setupHash || u.setupHash !== given) return reply.code(403).send({ error: "That setup code is not right, or CNW is set up already." })
    const password = await hashPassword(b.data.password)
    const name = b.data.name ?? b.data.email!
    users.write({ users: [{ name, ...(b.data.email ? { email: b.data.email } : {}), password, passkeys: [] }] })
    const s = startFor(req, name, false)
    setCookie(reply, s.id, 7 * 24 * 3600)
    log(`First account made: ${name}`)
    return { ok: true, csrf: s.csrf }
  })

  app.post("/api/login", async (req, reply) => {
    const b = Login.safeParse(req.body)
    const login = (b.success ? (b.data.login ?? b.data.email ?? b.data.name ?? "") : "").trim().toLowerCase()
    if (!b.success || !login) return reply.code(422).send({ error: "Your email and your password." })
    const keys = [`name:${login}`, `ip:${ipOf(req)}`]
    const wait = Math.max(...keys.map((k) => throttle.wait(k)))
    if (wait) return reply.code(429).send({ error: `Too many tries. Wait ${Math.ceil(wait / 1000)} seconds.` })
    // An email signs in its account; a name only an account that has no email yet, once, to add one.
    const user = users.read().users.find((x) => (x.email ? x.email === login : x.name.toLowerCase() === login))
    // The same work whether or not the name exists, so a wrong name and a wrong password look alike.
    const ok = await verifyPassword(b.data.password, user?.password ?? "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
    if (!user || !ok) {
      for (const k of keys) throttle.failed(k)
      log(`Sign-in refused for ${login} from ${ipOf(req)}`)
      return reply.code(401).send({ error: "That email and password do not match." })
    }
    for (const k of keys) throttle.succeeded(k)
    // Uplift phase 4: with a second factor, the password alone signs nothing in; a code follows, within five minutes.
    if (user.totp) {
      const ticket = crypto.randomBytes(24).toString("base64url")
      loginTickets.set(ticket, { user: user.name, until: (o.now ?? Date.now)() + 5 * 60_000 })
      return { totp: true, ticket }
    }
    const s = startFor(req, user.name, false)
    setCookie(reply, s.id, 7 * 24 * 3600)
    log(`Signed in: ${user.name} from ${ipOf(req)}`)
    return { ok: true, csrf: s.csrf, ...(user.email ? {} : { needsEmail: true }) }
  })

  // Your email: added once by an account from before email sign-in (no password asked again, it has just signed in),
  // and changed later only with the password.
  app.post("/api/account/email", async (req, reply) => {
    const a = access(req)
    if (a.kind !== "user") return reply.code(401).send({ error: "Sign in first." })
    const b = SetEmail.safeParse(req.body)
    if (!b.success) return reply.code(422).send({ error: "That is not an email address." })
    const me = userOf(a.user)
    if (!me) return reply.code(401).send({ error: "Sign in first." })
    if (me.email) {
      const wait = throttle.wait(`name:${me.email}`)
      if (wait) return reply.code(429).send({ error: `Too many tries. Wait ${Math.ceil(wait / 1000)} seconds.` })
      if (!b.data.password || !(await verifyPassword(b.data.password, me.password))) {
        throttle.failed(`name:${me.email}`)
        return reply.code(403).send({ error: "Your password is needed to change your email, and that is not it." })
      }
    }
    if (users.read().users.some((u) => u.name !== a.user && u.email === b.data.email))
      return reply.code(409).send({ error: "Another account uses that email." })
    users.update((u) => ({ ...u, users: u.users.map((x) => (x.name === a.user ? { ...x, email: b.data.email } : x)) }))
    log(`Email ${me.email ? "changed" : "added"} for ${a.user}`)
    return { ok: true, email: b.data.email }
  })

  // Passkeys, beside the password.
  registerPasskeyRoutes(app, {
    rpId,
    origin,
    passkeysOf: (user) => users.read().users.find((u) => u.name === user)?.passkeys ?? [],
    setPasskeys: (user, keys) =>
      users.update((u) => ({ ...u, users: u.users.map((x) => (x.name === user ? { ...x, passkeys: keys } : x)) })),
    ownerOf: (id) => users.read().users.find((u) => u.passkeys.some((k) => k.id === id))?.name,
    signedIn: (req) => {
      const a = access(req)
      return a.kind === "user" ? a.user : undefined
    },
    startSession: (reply, user) => {
      const s = sessions.start(user, true)
      setCookie(reply, s.id, 7 * 24 * 3600)
      return s.csrf
    },
    throttleKey: (req) => `passkey:${ipOf(req)}`,
    throttle,
    log,
  })

  // O52: single sign-on, OpenID Connect and SAML, beside the password and passkeys.
  registerSsoRoutes(app, {
    origin,
    publicUrl: o.publicUrl,
    now: o.now ?? Date.now,
    allowHttp: o.ssoAllowHttp === true,
    fetchText: o.fetchText ?? fetchMetadata,
    settings: () => ssoStore.read(),
    secret: () => {
      const s = ssoStore.read().oidc?.sealedSecret
      return s ? sealer.open(s).toString("utf8") : ""
    },
    users: () => users.read().users,
    makeUser: (name, email, role, key) =>
      users.update((u) => ({ ...u, users: [...u.users, { name, ...(email ? { email } : {}), password: "sso-only", passkeys: [], role, sso: [key] }] })),
    link: (name, key) => users.update((u) => ({ ...u, users: u.users.map((x) => (x.name === name ? { ...x, sso: [...new Set([...(x.sso ?? []), key])] } : x)) })),
    hasTotp: (name) => Boolean(userOf(name)?.totp),
    ticket: (name) => {
      const ticket = crypto.randomBytes(24).toString("base64url")
      loginTickets.set(ticket, { user: name, until: (o.now ?? Date.now)() + 5 * 60_000, sso: true })
      return ticket
    },
    signIn: (req, reply, name) => {
      const s = sessions.start(name, false, { ua: String(req.headers["user-agent"] ?? ""), ip: ipOf(req) }, { confirmed: false })
      setCookie(reply, s.id, 7 * 24 * 3600)
    },
    signedIn: (req) => {
      const a = access(req)
      return a.kind === "user" ? a.user : undefined
    },
    ipOf,
    throttle,
    record,
    log,
  })
  app.get("/api/server/sso", async (req, reply) => {
    if (!need(req, reply, "server")) return
    const s = ssoStore.read()
    return {
      ...(s.oidc ? { oidc: { issuer: s.oidc.issuer, clientId: s.oidc.clientId, secretSet: Boolean(s.oidc.sealedSecret), ...(s.oidc.label ? { label: s.oidc.label } : {}) } } : {}),
      ...(s.saml ? { saml: { ...(s.saml.metadataUrl ? { metadataUrl: s.saml.metadataUrl } : {}), metadataFile: Boolean(s.saml.metadataXml), ...(s.saml.label ? { label: s.saml.label } : {}) } } : {}),
      match: s.match ?? "email",
      autoCreate: s.autoCreate === true,
      autoRole: s.autoRole ?? "viewer",
      ...(s.savedAt ? { savedAt: s.savedAt, savedBy: s.savedBy } : {}),
      // What to give the provider: where it sends people back.
      oidcRedirect: `${origin}/api/sso/oidc/callback`,
      samlAcs: `${origin}/api/sso/saml/acs`,
      samlEntityId: `${origin}/api/sso/saml/metadata`,
    }
  })
  app.put("/api/server/sso", async (req, reply) => {
    const a = need(req, reply, "server")
    if (!a || a.kind !== "user") return
    const checked = checkSso(req.body, o.ssoAllowHttp === true)
    if ("error" in checked) return reply.code(422).send({ error: checked.error })
    const before = ssoStore.read()
    const keep = checked.clearSecret ? undefined : before.oidc?.sealedSecret
    const sealed = checked.secret ? sealer.seal(Buffer.from(checked.secret, "utf8")) : keep
    if (checked.settings.oidc && !sealed) return reply.code(422).send({ error: "The OpenID Connect client secret is needed." })
    ssoStore.write({
      ...checked.settings,
      ...(checked.settings.oidc ? { oidc: { ...checked.settings.oidc, ...(sealed ? { sealedSecret: sealed } : {}) } } : {}),
      savedAt: new Date((o.now ?? Date.now)()).toISOString(),
      savedBy: a.user,
    })
    const s = checked.settings
    const detail = [s.oidc ? `OpenID Connect ${s.oidc.issuer}` : "no OpenID Connect", s.saml ? `SAML ${s.saml.metadataUrl ?? "from a file"}` : "no SAML", `matched by ${s.match}`, s.autoCreate ? `new people made as ${s.autoRole}` : "nobody made"].join(", ")
    record(a.user, "sso-settings", detail)
    log(`Single sign-on settings changed by ${a.user}: ${detail}`)
    return { ok: true }
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

  // Uplift phase 2: CNW's own settings, on its Server page. Reading and changing them needs a signed-in person.
  const caddyDir = o.caddyConfigDir ?? "/caddy-config"
  const certificateOf =
    o.certificateOf ??
    ((host: string) =>
      new Promise<string | undefined>((resolve) => {
        const addr = env.CNW_CADDY_ADDR
        if (!addr) return resolve(undefined)
        // An IP address is sent no server name (caddy answers it through default_sni); a name is.
        const name = bareHost(host)
        const s = tls.connect({ host: addr, port: 443, ...(name && !/^[\d.:a-f]+$/.test(name) ? { servername: name } : {}), rejectUnauthorized: false, timeout: 4000 }, () => {
          const raw = s.getPeerCertificate(false)?.raw
          s.end()
          resolve(raw ? crypto.createHash("sha256").update(raw).digest("hex") : undefined)
        })
        s.on("error", () => resolve(undefined))
        s.on("timeout", () => (s.destroy(), resolve(undefined)))
      }))
  const applySettings =
    o.applySettings ??
    (async (s: { host: string; tls: string; port: string }) => {
      if (!env.CNW_UPDATER) return { ok: false, message: "There is no updater in this setup, so start the stack again yourself: docker compose up -d." }
      try {
        const r = await fetch(new URL("/apply", env.CNW_UPDATER), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(s) })
        return { ok: r.ok, message: await r.text() }
      } catch (e) {
        return { ok: false, message: `The updater could not be reached: ${(e as Error).message}` }
      }
    })
  const serverView = async () => {
    const saved = server.read()
    const e = effective(env, saved)
    const sha = await certificateOf(e.host).catch(() => undefined)
    return {
      saved,
      effective: e,
      ownProxy,
      // Docker publishes the port from .env when the stack is started by hand; a different one saved here is lost then.
      ...(saved.port !== undefined && (env.CNW_PORT ?? "") !== saved.port ? { portInEnv: env.CNW_PORT ?? "" } : {}),
      ...(sha ? { certificate: grouped(sha) } : {}),
      rootCertificate: fs.existsSync(path.join(caddyDir, "root.crt")),
      // ADR 0020: what Codehouse pins, to compare when it asks to trust CNW's certificate again.
      ...((): { rootFingerprint?: string } => {
        const pem = caddyRoot()
        if (!pem) return {}
        try {
          return { rootFingerprint: grouped(crypto.createHash("sha256").update(new crypto.X509Certificate(pem).raw).digest("hex")) }
        } catch {
          return {}
        }
      })(),
    }
  }
  app.get("/api/server", async (req, reply) => (need(req, reply, "server") ? await serverView() : undefined))
  app.put("/api/server", async (req, reply) => {
    const a = need(req, reply, "server")
    if (!a || a.kind !== "user") return
    const checked = checkSettings(req.body)
    if ("error" in checked) return reply.code(422).send({ error: checked.error })
    const before = effective(env, server.read())
    const next = checked.settings
    // A new certificate unpairs every computer: said first, with their names, and done only when confirmed.
    if (!ownProxy && newCertificate(before, next) && (req.body as { confirm?: unknown })?.confirm !== true)
      return reply.code(409).send({
        breaks: paired.read().computers.map((c) => c.label),
        error: "This gives CNW a new certificate, so every paired computer stops connecting until you pair it again.",
      })
    server.write({
      host: next.host,
      tls: next.tls,
      port: next.port,
      ...(ownProxy ? { trustedProxy: next.trustedProxy } : {}),
      savedAt: new Date((o.now ?? Date.now)()).toISOString(),
      savedBy: a.user,
    })
    const detail = `address ${next.host}, certificate ${next.tls || "chosen from the address"}, port ${next.port || "443"}${ownProxy ? `, trusted proxy ${next.trustedProxy || "none"}` : ""}`
    record(a.user, "server-settings", detail)
    log(`Server settings changed by ${a.user}: ${detail}`)
    const changed = before.host !== next.host || before.tls !== next.tls || before.port !== next.port
    if (!changed) return { ok: true, applied: false, message: "Saved. Nothing caddy uses changed, so nothing starts again." }
    const r = await applySettings({ host: next.host, tls: next.tls, port: next.port })
    return reply.code(r.ok ? 200 : 502).send({ ok: r.ok, applied: r.ok, message: r.message })
  })
  // caddy's root certificate, the public part, for a phone or computer to trust (Web Push needs a trusted one).
  app.get("/api/server/root.crt", async (_req, reply) => {
    const file = path.join(caddyDir, "root.crt")
    if (!fs.existsSync(file)) return reply.code(404).send({ error: "caddy has not made its root certificate yet; it is here after the next start." })
    return reply
      .header("content-disposition", 'attachment; filename="codehouse-neighbourhood-watch-root.crt"')
      .type("application/x-x509-ca-cert")
      .send(fs.readFileSync(file))
  })

  // Uplift phase 3: the board across computers and the one inbox. Each connected computer is asked for its state at
  // most every few seconds; an offline one keeps only its last seen.
  const boardCache = new Map<string, { at: number; row: BoardRow }>()
  const rowOf = async (c: ReturnType<Hub["status"]>[number], user: string, signedIn: boolean): Promise<BoardRow> => {
    const base: BoardRow = { id: c.id, label: c.label, ...(c.tags?.length ? { tags: c.tags } : {}), online: c.online, waiting: [], ...(c.lastSeen ? { lastSeen: c.lastSeen } : {}), ...(c.version ? { version: c.version } : {}), ...(c.needsUpdate ? { needsUpdate: c.needsUpdate } : {}), ...(c.refused ? { refused: c.refused } : {}) }
    if (!c.online) return { ...base, note: "Not connected." }
    const t = (o.now ?? Date.now)()
    const hit = boardCache.get(c.id)
    if (hit && t - hit.at < 3000) return { ...hit.row, ...base, waiting: hit.row.waiting }
    const r = await hub.http(c.id, { method: "GET", path: "/api/state", user, signedIn })
    let row: BoardRow
    try {
      row = r.status === 200 ? { ...base, ...summarise(c, JSON.parse(r.body.toString("utf8"))) } : { ...base, note: "It did not answer." }
    } catch {
      row = { ...base, note: "It did not answer." }
    }
    boardCache.set(c.id, { at: t, row })
    return row
  }
  const boardFor = async (a: Access) => {
    const user = a.kind === "user" ? a.user : "allowed network"
    const rows = await Promise.all(hub.status().filter((c) => sees(a, c.id)).map((c) => rowOf(c, user, a.kind === "user")))
    return order(rows)
  }
  app.get("/api/board", async (req, reply) => {
    const a = need(req, reply, "view")
    if (!a) return
    return await boardFor(a)
  })

  // Signing in again, for a Severe approval: the password, checked as at sign-in, makes this sign-in recent.
  // Notification channels (Server, for an owner or admin): email, ntfy, Pushover, Telegram, webhooks, each with its own
  // rule. A secret is sealed when saved and never sent back; left blank on a change, the one saved is kept.
  const channelStore = new JsonStore<{ channels: Channel[] }>(o.dataDir, "channels", () => ({ channels: [] }))
  const channelView = (c: Channel) => ({ id: c.id, kind: c.kind, on: c.on, rule: c.rule, config: c.config, hasSecret: Boolean(c.sealedSecret) })
  const secretOf = (c: Channel) => {
    try {
      return c.sealedSecret ? sealer.open(c.sealedSecret).toString("utf8") : undefined
    } catch {
      return undefined
    }
  }
  const channelDeps = { ...(o.post ? { post: async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => o.post!(url, { ...init, body: Buffer.from(init.body) }) } : {}), ...(o.smtp ? { smtp: o.smtp } : {}) }
  app.get("/api/channels", async (req, reply) => (need(req, reply, "server") ? { channels: channelStore.read().channels.map(channelView) } : undefined))
  const saveChannel = async (req: FastifyRequest, reply: FastifyReply, id?: string) => {
    const a = need(req, reply, "server")
    if (!a || a.kind !== "user") return
    const b = (req.body ?? {}) as Record<string, unknown>
    const before = id ? channelStore.read().channels.find((c) => c.id === id) : undefined
    if (id && !before) return reply.code(404).send({ error: "There is no such channel." })
    const kind = (before?.kind ?? b.kind) as ChannelKind
    if (!(CHANNEL_KINDS as readonly string[]).includes(String(kind))) return reply.code(422).send({ error: "Email, ntfy, Pushover, Telegram or a webhook." })
    const checked = checkChannel(kind, { ...b, ...(b.secret ? {} : before ? { secret: secretOf(before) ?? "" } : {}) })
    if (typeof checked === "string") return reply.code(422).send({ error: checked })
    const rule = checkRule(b.rule)
    if (typeof rule === "string") return reply.code(422).send({ error: rule })
    const ch: Channel = { id: before?.id ?? crypto.randomUUID(), kind, on: b.on !== false, rule, config: checked.config, ...(checked.secret ? { sealedSecret: sealer.seal(Buffer.from(checked.secret)) } : {}) }
    channelStore.update((v) => ({ channels: [...v.channels.filter((c) => c.id !== ch.id), ch].slice(-20) }))
    record(a.user, before ? "channel-changed" : "channel-added", `${kind}${ch.on ? "" : " (off)"}, ${rule.minRisk ? `risk ${rule.minRisk} and over` : "every request"}`)
    return { channel: channelView(ch) }
  }
  app.post("/api/channels", async (req, reply) => saveChannel(req, reply))
  app.put("/api/channels/:id", async (req, reply) => saveChannel(req, reply, (req.params as { id: string }).id))
  app.delete("/api/channels/:id", async (req, reply) => {
    const a = need(req, reply, "server")
    if (!a || a.kind !== "user") return
    const id = (req.params as { id: string }).id
    const c = channelStore.read().channels.find((x) => x.id === id)
    if (!c) return reply.code(404).send({ error: "There is no such channel." })
    channelStore.update((v) => ({ channels: v.channels.filter((x) => x.id !== id) }))
    record(a.user, "channel-removed", c.kind)
    return { ok: true }
  })
  app.post("/api/channels/:id/test", async (req, reply) => {
    const a = need(req, reply, "server")
    if (!a || a.kind !== "user") return
    const c = channelStore.read().channels.find((x) => x.id === (req.params as { id: string }).id)
    if (!c) return reply.code(404).send({ error: "There is no such channel." })
    try {
      await sendTo(c, secretOf(c), { title: "Neighbourhood Watch", body: "A test: this channel works.", url: `${origin}/#server` }, channelDeps)
      return { ok: true }
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message })
    }
  })
  /** Tells every channel whose rule allows it; a channel that fails says so in CNW's log, and the rest go on. */
  const tellChannels = async (w: { computer: string; computerLabel: string; tool: string; project: string; risk: number; requestId: string }) => {
    let n = 0
    for (const c of channelStore.read().channels.filter((x) => x.on && ruleAllows(x.rule, w, new Date((o.now ?? Date.now)())))) {
      const band = w.risk >= 85 ? "Severe" : w.risk >= 70 ? "High" : w.risk >= 40 ? "Moderate" : "Low"
      try {
        await sendTo(c, secretOf(c), { title: `${w.computerLabel} needs you`, body: `${w.tool} in ${w.project}, ${band} ${w.risk}`, url: `${origin}/#inbox` }, channelDeps)
        n++
      } catch (e) {
        log(`channel ${c.kind}: ${(e as Error).message}`)
      }
    }
    return n
  }
  /** The email channel's server, for invites and password resets to someone else's address. */
  const mailTo = async (to: string, subject: string, text: string): Promise<boolean> => {
    const c = channelStore.read().channels.find((x) => x.kind === "email" && x.on)
    if (!c) return false
    try {
      await (o.smtp ?? sendMail)({ host: c.config.host!, port: Number(c.config.port), tls: c.config.tls === "implicit" ? "implicit" : "starttls", user: c.config.user || undefined, pass: secretOf(c), from: c.config.from!, to }, subject, text)
      return true
    } catch (e) {
      log(`email to ${to}: ${(e as Error).message}`)
      return false
    }
  }

  // Forgotten passwords, when email is set up: a link by email, used once, for 30 minutes. The answer is the same
  // whether or not the email has an account. A second factor still applies after a reset.
  const resets = new Map<string, { user: string; until: number }>()
  app.post("/api/password/forgot", async (req, reply) => {
    const key = `forgot:${ipOf(req)}`
    if (throttle.wait(key)) return reply.code(429).send({ error: "Too many tries. Wait a while." })
    throttle.failed(key)
    const addr = String((req.body as { email?: unknown })?.email ?? "").trim().toLowerCase().slice(0, 254)
    const u = users.read().users.find((x) => x.email === addr)
    if (u) {
      const token = crypto.randomBytes(24).toString("base64url")
      resets.set(sha(token), { user: u.name, until: (o.now ?? Date.now)() + 30 * 60_000 })
      const sent = await mailTo(addr, "Neighbourhood Watch: set a new password", `Someone asked to set a new password for ${addr} on Neighbourhood Watch.\n\nOpen this link within 30 minutes to set one:\n${origin}/#reset=${token}\n\nIf it was not you, do nothing: your password stays as it is.`)
      record(u.name, "password-reset-asked", sent ? "a link was emailed" : "no email channel, nothing was sent")
    }
    return { ok: true, message: "If that email has an account here and email is set up, a link to set a new password is on its way." }
  })
  app.post("/api/password/reset", async (req, reply) => {
    const b = (req.body ?? {}) as { token?: unknown; password?: unknown }
    const r = resets.get(sha(String(b.token ?? "")))
    const password = String(b.password ?? "")
    if (!r || r.until < (o.now ?? Date.now)()) return reply.code(403).send({ error: "That link has been used or has expired. Ask for a new one." })
    if (password.length < 12 || password.length > 500) return reply.code(422).send({ error: "A password of 12 characters or more." })
    const hash = await hashPassword(password)
    users.update((v) => ({ ...v, users: v.users.map((x) => (x.name === r.user ? { ...x, password: hash } : x)) }))
    resets.delete(sha(String(b.token)))
    sessions.endUser(r.user)
    record(r.user, "password-reset", "a new password was set from an emailed link; every device was signed out")
    return { ok: true }
  })

  // Web Push (owner, 17 Nov): a closed tab or a locked phone hears when something newly waits. Each device subscribes
  // from You; CNW then looks at its computers every 15 seconds while anyone is subscribed, and tells each person what
  // newly waits on a computer they see, at the risk they chose. A push says the computer, the tool, the project and
  // the risk band, never the command (as the ntfy channel's rule), and only the subscribed browser can read it.
  const vapid = new Vapid(o.dataDir, sealer)
  const pushStore = new JsonStore<{ subs: Array<{ user: string; sub: Subscription; minRisk: number; at: string }> }>(o.dataDir, "push", () => ({ subs: [] }))
  const subject = origin
  app.get("/api/push/key", async (req, reply) => {
    const a = need(req, reply, "view")
    if (!a || a.kind !== "user") return reply.code(401).send({ error: "Sign in first." })
    return { publicKey: vapid.publicKey, subscribed: pushStore.read().subs.filter((x) => x.user === a.user).map((x) => ({ endpointHost: new URL(x.sub.endpoint).hostname, minRisk: x.minRisk })) }
  })
  app.post("/api/push/subscribe", async (req, reply) => {
    const a = need(req, reply, "view")
    if (!a || a.kind !== "user") return reply.code(401).send({ error: "Sign in first." })
    const b = (req.body ?? {}) as { subscription?: unknown; minRisk?: unknown }
    const sub = checkSubscription(b.subscription)
    if (typeof sub === "string") return reply.code(422).send({ error: sub })
    const minRisk = b.minRisk === 70 ? 70 : 0
    pushStore.update((v) => ({ subs: [...v.subs.filter((x) => x.sub.endpoint !== sub.endpoint), { user: a.user, sub, minRisk, at: new Date((o.now ?? Date.now)()).toISOString() }].filter((x, i, all) => all.filter((y) => y.user === x.user).indexOf(x) < 10) }))
    record(a.user, "push-on", `a device (${new URL(sub.endpoint).hostname})${minRisk ? ", High and Severe only" : ""}`)
    return { ok: true }
  })
  app.delete("/api/push/subscribe", async (req, reply) => {
    const a = need(req, reply, "view")
    if (!a || a.kind !== "user") return reply.code(401).send({ error: "Sign in first." })
    const endpoint = String((req.body as { endpoint?: unknown })?.endpoint ?? "")
    pushStore.update((v) => ({ subs: v.subs.filter((x) => !(x.user === a.user && x.sub.endpoint === endpoint)) }))
    return { ok: true }
  })
  app.post("/api/push/test", async (req, reply) => {
    const a = need(req, reply, "view")
    if (!a || a.kind !== "user") return reply.code(401).send({ error: "Sign in first." })
    const mine = pushStore.read().subs.filter((x) => x.user === a.user)
    if (!mine.length) return reply.code(409).send({ error: "This account has no device that asked for notifications yet." })
    const results = await Promise.all(mine.map((x) => sendPush(x.sub, { title: "Neighbourhood Watch", body: "Notifications reach this device.", url: "/#you" }, vapid, subject, o.post)))
    return { sent: results.filter((r) => r === "sent").length, of: results.length }
  })
  // What waited at the last look, by computer: only requests newly waiting are told, and the first look tells nothing.
  const told = new Map<string, Set<string>>()
  const pushLook = async (): Promise<number> => {
    const subs = pushStore.read().subs
    if (!subs.length && !channelStore.read().channels.some((c) => c.on)) return 0
    let sent = 0
    for (const c of hub.status().filter((x) => x.online)) {
      boardCache.delete(c.id)
      const row = await rowOf(c, "Neighbourhood Watch notifications", false)
      const before = told.get(c.id)
      const now = new Set(row.waiting.map((w) => w.requestId))
      told.set(c.id, now)
      if (!before) continue
      for (const w of row.waiting.filter((x) => !before.has(x.requestId))) {
        sent += await tellChannels(w)
        for (const s of subs) {
          const u = userOf(s.user)
          if (!u || !seesComputer(u.computers, c.id) || w.risk < s.minRisk) continue
          const band = w.risk >= 85 ? "Severe" : w.risk >= 70 ? "High" : w.risk >= 40 ? "Moderate" : "Low"
          const r = await sendPush(s.sub, { title: `${c.label} needs you`, body: `${w.tool} in ${w.project}, ${band} ${w.risk}`, tag: `${c.id}/${w.requestId}`, url: "/#inbox" }, vapid, subject, o.post)
          if (r === "sent") sent++
          if (r === "gone") pushStore.update((v) => ({ subs: v.subs.filter((x) => x.sub.endpoint !== s.sub.endpoint) }))
        }
      }
    }
    return sent
  }
  const pushTimer = setInterval(() => void pushLook().catch((e: Error) => log(`push: ${e.message}`)), 15_000)
  pushTimer.unref()
  app.addHook("onClose", async () => clearInterval(pushTimer))

  app.post("/api/reauth", async (req, reply) => {
    const a = access(req)
    if (a.kind !== "user") return reply.code(401).send({ error: "Sign in first." })
    const me = userOf(a.user)
    const key = `name:${me?.email ?? a.user}`
    const wait = throttle.wait(key)
    if (wait) return reply.code(429).send({ error: `Too many tries. Wait ${Math.ceil(wait / 1000)} seconds.` })
    const password = String((req.body as { password?: unknown })?.password ?? "").slice(0, 500)
    // With a second factor, signing in again for a Severe allow wants a code from the app too.
    if (!me || !(await verifyPassword(password, me.password)) || !secondFactor(me, String((req.body as { code?: unknown })?.code ?? ""))) {
      throttle.failed(key)
      return reply.code(403).send({ error: "That is not your password." })
    }
    throttle.succeeded(key)
    sessions.confirm(cookieOf(req))
    return { ok: true }
  })

  // An answer from the inbox: sent to that computer, whose floor and policy decide. The risk is read again from the
  // computer, never taken from the page; a Severe allow needs a signed-in person who signed in in the last five minutes.
  const Answer = z.object({
    computer: z.string().min(1).max(100),
    requestId: z.string().min(1).max(100),
    decision: z.enum(["allow", "deny"]),
    message: z.string().max(500).optional(),
  })
  app.post("/api/inbox/answer", async (req, reply) => {
    const a = need(req, reply, "answer")
    if (!a) return
    const b = Answer.safeParse(req.body)
    if (!b.success) return reply.code(422).send({ error: "Say which computer, which request, and allow or deny." })
    const c = hub.status().find((x) => x.id === b.data.computer && sees(a, x.id))
    if (!c?.online) return reply.code(409).send({ error: "That computer is not connected." })
    boardCache.delete(c.id)
    const user = a.kind === "user" ? a.user : "allowed network"
    const row = await rowOf(c, user, a.kind === "user")
    const w = row.waiting.find((x) => x.requestId === b.data.requestId)
    if (!w) return reply.code(410).send({ error: "That request is no longer waiting: it was answered or ended." })
    if (b.data.decision === "allow" && w.risk >= SEVERE_RISK) {
      if (!may(a, "severe-approve")) return reply.code(401).send({ error: "A Severe request needs you signed in, even on an allowed network." })
      if (a.kind === "user" && (o.now ?? Date.now)() - a.confirmedAt > FRESH_MS)
        return reply.code(428).send({ error: "This is Severe: sign in again to allow it.", reauth: true })
    }
    const data =
      b.data.decision === "allow"
        ? { type: "approve", requestId: w.requestId, ...(b.data.message ? { message: b.data.message } : {}) }
        : { type: "deny", requestId: w.requestId, ...(b.data.message ? { message: b.data.message } : {}) }
    const sent = hub.commandAs(c.id, user, a.kind === "user", data)
    if (sent !== "sent") return reply.code(409).send({ error: "That computer is not connected." })
    boardCache.delete(c.id)
    record(user, `inbox-${b.data.decision}`, `${c.label}: ${w.tool} in ${w.project} (risk ${w.risk})`)
    return { ok: true, sent: `Sent to ${c.label}. Its own rules decide; the inbox shows what it did.` }
  })

  // Uplift phase 4: a second factor (TOTP), set up from You. Set-up shows the key and an otpauth link for the
  // authenticator app; it is on once a code from the app is confirmed, and ten recovery codes are shown once.
  const pendingTotp = new Map<string, { secret: Buffer; until: number }>()
  app.post("/api/totp/start", async (req, reply) => {
    const a = need(req, reply, "view")
    if (!a || a.kind !== "user") return reply.code(401).send({ error: "Sign in first." })
    const me = userOf(a.user)!
    if (me.totp) return reply.code(409).send({ error: "A second factor is on already. Turn it off first to set up another." })
    const secret = newSecret()
    pendingTotp.set(a.user, { secret, until: (o.now ?? Date.now)() + 10 * 60_000 })
    return { key: (base32(secret).match(/.{1,4}/g) ?? []).join(" "), uri: otpauthUri(me.email ?? me.name, secret) }
  })
  app.post("/api/totp/confirm", async (req, reply) => {
    const a = need(req, reply, "view")
    if (!a || a.kind !== "user") return reply.code(401).send({ error: "Sign in first." })
    const p = pendingTotp.get(a.user)
    if (!p || p.until < (o.now ?? Date.now)()) return reply.code(409).send({ error: "Start again: the key was not confirmed within ten minutes." })
    const step = verifyCode(p.secret, String((req.body as { code?: unknown })?.code ?? ""), (o.now ?? Date.now)())
    if (step === undefined) return reply.code(403).send({ error: "That code does not match. Check the time on your phone, and type the newest code." })
    const rec = recoveryCodes()
    users.update((u) => ({ ...u, users: u.users.map((x) => (x.name === a.user ? { ...x, totp: { sealed: sealer.seal(p.secret), recovery: rec.hashes, lastStep: step } } : x)) }))
    pendingTotp.delete(a.user)
    record(a.user, "totp-on", "a second factor was turned on")
    return { ok: true, recovery: rec.codes }
  })
  app.delete("/api/totp", async (req, reply) => {
    const a = need(req, reply, "view")
    if (!a || a.kind !== "user") return reply.code(401).send({ error: "Sign in first." })
    const me = userOf(a.user)!
    const b = (req.body ?? {}) as { password?: unknown; code?: unknown }
    if (!me.totp) return { ok: true }
    if (!(await verifyPassword(String(b.password ?? "").slice(0, 500), me.password)) || !secondFactor(me, String(b.code ?? "")))
      return reply.code(403).send({ error: "Your password and a code from your app are needed to turn it off." })
    users.update((u) => ({ ...u, users: u.users.map((x) => { if (x.name !== a.user) return x; const next = { ...x }; delete next.totp; return next }) }))
    record(a.user, "totp-off", "the second factor was turned off")
    return { ok: true }
  })
  app.post("/api/login/totp", async (req, reply) => {
    const b = (req.body ?? {}) as { ticket?: unknown; code?: unknown }
    const t = loginTickets.get(String(b.ticket ?? ""))
    if (!t || t.until < (o.now ?? Date.now)()) return reply.code(403).send({ error: "Sign in again: that took more than five minutes." })
    const me = userOf(t.user)
    const key = `totp:${t.user}`
    const wait = throttle.wait(key)
    if (wait) return reply.code(429).send({ error: `Too many tries. Wait ${Math.ceil(wait / 1000)} seconds.` })
    if (!me || !secondFactor(me, String(b.code ?? ""))) {
      throttle.failed(key)
      return reply.code(401).send({ error: "That code does not match." })
    }
    throttle.succeeded(key)
    loginTickets.delete(String(b.ticket))
    // O52: after a single sign-on, the code completes it, still as not having just signed in for a Severe allow.
    const s = sessions.start(me.name, false, { ua: String(req.headers["user-agent"] ?? ""), ip: ipOf(req) }, t.sso ? { confirmed: false } : {})
    setCookie(reply, s.id, 7 * 24 * 3600)
    if (t.sso) record(me.name, "sso-sign-in", "single sign-on, then the second factor")
    log(`Signed in: ${me.name} from ${ipOf(req)}, with a second factor${t.sso ? " after single sign-on" : ""}`)
    return { ok: true, csrf: s.csrf }
  })

  // Signed-in devices, each with Sign out; your own only.
  app.get("/api/devices", async (req, reply) => {
    const a = need(req, reply, "view")
    if (!a || a.kind !== "user") return reply.code(401).send({ error: "Sign in first." })
    return { devices: sessions.list(a.user, cookieOf(req)) }
  })
  app.delete("/api/devices/:id", async (req, reply) => {
    const a = need(req, reply, "view")
    if (!a || a.kind !== "user") return reply.code(401).send({ error: "Sign in first." })
    const ok = sessions.revoke(a.user, (req.params as { id: string }).id)
    if (ok) record(a.user, "device-signed-out", (req.params as { id: string }).id)
    return reply.code(ok ? 200 : 404).send(ok ? { ok: true } : { error: "There is no such device." })
  })

  // Uplift phase 4: people. An owner or an admin invites by email with a role and, if chosen, only some computers; the
  // invite is a link to copy (email follows once SMTP is set on the Server page), used once, for seven days. Only an
  // owner adds, changes or removes an owner, and there is always one left.
  const peopleView = () =>
    users.read().users.map((u) => ({ name: u.name, ...(u.email ? { email: u.email } : {}), role: roleOf(u.role), ...(u.computers ? { computers: u.computers } : {}), totp: Boolean(u.totp) }))
  const owners = () => users.read().users.filter((u) => roleOf(u.role) === "owner").length
  const Invite = z.object({ email, role: z.enum(ROLES), computers: z.array(z.string().max(100)).max(100).optional() })
  app.get("/api/people", async (req, reply) => {
    if (!need(req, reply, "people")) return
    return { people: peopleView(), invites: invites.read().invites.filter((i) => Date.parse(i.expires) > (o.now ?? Date.now)()).map((i) => ({ email: i.email, role: i.role, expires: i.expires })) }
  })
  app.post("/api/people/invite", async (req, reply) => {
    const a = need(req, reply, "people")
    if (!a || a.kind !== "user") return
    const b = Invite.safeParse(req.body)
    if (!b.success) return reply.code(422).send({ error: "An email and a role." })
    if (b.data.role === "owner" && !roleMay(roleOf(userOf(a.user)?.role), "owners")) return reply.code(403).send({ error: "Only an owner can invite an owner." })
    if (users.read().users.some((u) => u.email === b.data.email)) return reply.code(409).send({ error: "Someone already signs in with that email." })
    const token = crypto.randomBytes(24).toString("base64url")
    const expires = new Date((o.now ?? Date.now)() + 7 * 24 * 3_600_000).toISOString()
    invites.update((v) => ({ invites: [...v.invites.filter((i) => i.email !== b.data.email), { hash: sha(token), email: b.data.email, role: b.data.role, ...(b.data.computers ? { computers: b.data.computers } : {}), by: a.user, expires }].slice(-100) }))
    record(a.user, "invite", `${b.data.email} as ${b.data.role}${b.data.computers ? ` for ${b.data.computers.length} computer(s)` : ""}`)
    const link = `${origin}/#invite=${token}`
    const emailed = await mailTo(b.data.email, "You are invited to Neighbourhood Watch", `${a.user} invited you to Codehouse Neighbourhood Watch as ${b.data.role}.\n\nOpen this link within seven days to choose a password and join:\n${link}\n`)
    return { link, expires, emailed }
  })
  app.post("/api/invite/accept", async (req, reply) => {
    const b = z.object({ token: z.string().min(10).max(100), password: z.string().min(12).max(500) }).safeParse(req.body)
    if (!b.success) return reply.code(422).send({ error: "A password of 12 characters or more." })
    const key = `invite:${ipOf(req)}`
    const wait = throttle.wait(key)
    if (wait) return reply.code(429).send({ error: `Too many tries. Wait ${Math.ceil(wait / 1000)} seconds.` })
    const inv = invites.read().invites.find((i) => i.hash === sha(b.data.token) && Date.parse(i.expires) > (o.now ?? Date.now)())
    if (!inv || users.read().users.some((u) => u.email === inv.email)) {
      throttle.failed(key)
      return reply.code(403).send({ error: "That invite is not right, has been used, or has expired." })
    }
    const password = await hashPassword(b.data.password)
    users.update((u) => ({ ...u, users: [...u.users, { name: inv.email, email: inv.email, password, passkeys: [], role: inv.role, ...(inv.computers ? { computers: inv.computers } : {}) }] }))
    invites.update((v) => ({ invites: v.invites.filter((i) => i.hash !== inv.hash) }))
    record(inv.email, "joined", `invited by ${inv.by} as ${inv.role}`)
    const s = startFor(req, inv.email, false)
    setCookie(reply, s.id, 7 * 24 * 3600)
    return { ok: true, csrf: s.csrf }
  })
  const Change = z.object({ role: z.enum(ROLES).optional(), computers: z.array(z.string().max(100)).max(100).nullable().optional() })
  app.patch("/api/people/:name", async (req, reply) => {
    const a = need(req, reply, "people")
    if (!a || a.kind !== "user") return
    const name = (req.params as { name: string }).name
    const them = userOf(name)
    const b = Change.safeParse(req.body)
    if (!them || !b.success) return reply.code(them ? 422 : 404).send({ error: them ? "A role, or the computers they see." : "There is no such person." })
    const touchesOwner = roleOf(them.role) === "owner" || b.data.role === "owner"
    if (touchesOwner && !roleMay(roleOf(userOf(a.user)?.role), "owners")) return reply.code(403).send({ error: "Only an owner can change an owner." })
    if (roleOf(them.role) === "owner" && b.data.role && b.data.role !== "owner" && owners() <= 1) return reply.code(409).send({ error: "There must always be an owner." })
    users.update((u) => ({
      ...u,
      users: u.users.map((x) => {
        if (x.name !== name) return x
        const next = { ...x, ...(b.data.role ? { role: b.data.role } : {}) }
        if (b.data.computers === null) delete next.computers
        else if (b.data.computers) next.computers = b.data.computers
        return next
      }),
    }))
    record(a.user, "person-changed", `${name}${b.data.role ? ` now ${b.data.role}` : ""}${b.data.computers !== undefined ? `, ${b.data.computers === null ? "every computer" : `${b.data.computers.length} computer(s)`}` : ""}`)
    return { people: peopleView() }
  })
  app.delete("/api/people/:name", async (req, reply) => {
    const a = need(req, reply, "people")
    if (!a || a.kind !== "user") return
    const name = (req.params as { name: string }).name
    const them = userOf(name)
    if (!them) return reply.code(404).send({ error: "There is no such person." })
    if (roleOf(them.role) === "owner" && !roleMay(roleOf(userOf(a.user)?.role), "owners")) return reply.code(403).send({ error: "Only an owner can remove an owner." })
    if (roleOf(them.role) === "owner" && owners() <= 1) return reply.code(409).send({ error: "There must always be an owner." })
    users.update((u) => ({ ...u, users: u.users.filter((x) => x.name !== name) }))
    sessions.endUser(name)
    record(a.user, "person-removed", name)
    return { people: peopleView() }
  })

  // Uplift phase 5: backup and restore, for an owner who signed in within the last five minutes. A restore writes the
  // backup's files, is audited, and CNW starts again so that nothing it kept in memory is left from before.
  const recentOwner = (a: Access | undefined, reply: FastifyReply): boolean => {
    if (!a || a.kind !== "user") return false
    if (!roleMay(roleFor(a), "owners")) return void reply.code(403).send({ error: "Only an owner makes or restores a backup." }), false
    if ((o.now ?? Date.now)() - a.confirmedAt > FRESH_MS) return void reply.code(428).send({ error: "Sign in again first: a backup holds everything.", reauth: true }), false
    return true
  }
  app.post("/api/backup", async (req, reply) => {
    const a = need(req, reply, "server")
    if (!recentOwner(a, reply)) return
    const passphrase = String((req.body as { passphrase?: unknown })?.passphrase ?? "")
    if (passphrase.length < 12 || passphrase.length > 500) return reply.code(422).send({ error: "A passphrase of 12 characters or more: the backup cannot be opened without it." })
    const text = makeBackup(o.dataDir, passphrase, (o.now ?? Date.now)())
    record((a as { user: string }).user, "backup", "a backup was made")
    const day = new Date((o.now ?? Date.now)()).toISOString().slice(0, 10)
    return reply.header("content-disposition", `attachment; filename="neighbourhood-watch-${day}.cnwbackup"`).type("application/octet-stream").send(text)
  })
  app.post("/api/restore", { bodyLimit: 50 * 1024 * 1024 }, async (req, reply) => {
    const a = need(req, reply, "server")
    if (!recentOwner(a, reply)) return
    const b = (req.body ?? {}) as { backup?: unknown; passphrase?: unknown }
    let opened: ReturnType<typeof openBackup>
    try {
      opened = openBackup(String(b.backup ?? ""), String(b.passphrase ?? ""))
    } catch (e) {
      if (e instanceof BackupError) return reply.code(422).send({ error: e.message })
      throw e
    }
    restoreFiles(o.dataDir, opened.files)
    const by = (a as { user: string }).user
    // Recorded into the restored audit (read afresh: the one in memory is from before), so the restore is in it.
    const restoredAudit = new JsonStore<Audit>(o.dataDir, "audit", () => ({ entries: [] }))
    restoredAudit.update((x) => ({ entries: [...x.entries, { at: new Date((o.now ?? Date.now)()).toISOString(), user: by, action: "restore", detail: `restored a backup made ${opened.at}` }].slice(-1000) }))
    log(`Backup from ${opened.at} restored by ${by}; starting again`)
    setTimeout(() => (o.exit ?? ((code: number) => process.exit(code)))(0), 500)
    return { ok: true, message: `Restored the backup made ${opened.at}. Neighbourhood Watch starts again now; sign in with the people in the backup.` }
  })

  // Uplift phase 5: Server, Updates. This version, the newest signed one with its notes, the one to go back to, and
  // updating by itself at an hour you choose. Going back wants an owner or admin who signed in in the last five minutes.
  const updater = async (method: string, route: string): Promise<{ ok: boolean; status: number; text: string }> => {
    if (!env.CNW_UPDATER) return { ok: false, status: 501, text: "There is no updater in this setup." }
    try {
      const r = await fetch(new URL(route, env.CNW_UPDATER), { method, signal: AbortSignal.timeout(30_000) })
      return { ok: r.ok, status: r.status, text: await r.text() }
    } catch (e) {
      return { ok: false, status: 502, text: `The updater could not be reached: ${(e as Error).message}` }
    }
  }
  app.get("/api/updates", async (req, reply) => {
    if (!need(req, reply, "update")) return
    const r = await updater("GET", "/info")
    let info: unknown = undefined
    try {
      info = r.ok ? JSON.parse(r.text) : undefined
    } catch {
      info = undefined
    }
    return { ...(info && typeof info === "object" ? info : { current: env.CNW_VERSION ?? "0.0.0", newer: false }), auto: settings.read().updates ?? { auto: false, hour: 3 }, ...(r.ok ? {} : { note: r.text }) }
  })
  const Auto = z.object({ auto: z.boolean(), hour: z.number().int().min(0).max(23) })
  app.put("/api/updates", async (req, reply) => {
    const a = need(req, reply, "update")
    if (!a) return
    const b = Auto.safeParse(req.body)
    if (!b.success) return reply.code(422).send({ error: "On or off, and an hour from 0 to 23." })
    settings.update((s) => ({ ...s, updates: b.data }))
    record(a.kind === "user" ? a.user : "?", "updates-setting", b.data.auto ? `updates by itself at ${b.data.hour}:00` : "updates only when asked")
    return { auto: b.data }
  })
  app.post("/api/update/rollback", async (req, reply) => {
    const a = need(req, reply, "update")
    if (!a || a.kind !== "user") return
    if ((o.now ?? Date.now)() - a.confirmedAt > FRESH_MS) return reply.code(428).send({ error: "Sign in again first.", reauth: true })
    const r = await updater("POST", "/rollback")
    record(a.user, "rollback", r.ok ? "went back to the previous version" : `going back was refused: ${r.text}`)
    return reply.code(r.ok ? 200 : r.status).send(r.ok ? { ok: true, message: r.text } : { error: r.text })
  })
  // Updating by itself: once a day, at the hour chosen, if a newer signed release is out. Each one is audited.
  let lastAuto = ""
  const autoTimer = setInterval(() => {
    const u = settings.read().updates
    const t = new Date((o.now ?? Date.now)())
    const day = t.toISOString().slice(0, 10)
    if (!u?.auto || t.getHours() !== u.hour || lastAuto === day) return
    lastAuto = day
    void updater("POST", "/update").then((r) => record("CNW", "auto-update", r.text.slice(0, 200)))
  }, 5 * 60_000)
  autoTimer.unref()
  app.addHook("onClose", async () => clearInterval(autoTimer))

  // Uplift phase 5: Server, Health. The data volume's free space, memory, how long CNW has run, whether the updater
  // and caddy answer, and each computer's connections and drops.
  const updaterUp = async (): Promise<boolean | undefined> => {
    if (!env.CNW_UPDATER) return undefined
    try {
      const r = await fetch(new URL("/health", env.CNW_UPDATER), { signal: AbortSignal.timeout(3000) })
      return r.ok
    } catch {
      return false
    }
  }
  app.get("/api/health", async (req, reply) => {
    if (!need(req, reply, "server")) return
    let disk: { free: number; total: number } | undefined
    try {
      const st = await fs.promises.statfs(o.dataDir)
      disk = { free: st.bavail * st.bsize, total: st.blocks * st.bsize }
    } catch {
      disk = undefined
    }
    const e = effective(env, server.read())
    const [updater, certificate] = await Promise.all([updaterUp(), ownProxy ? Promise.resolve(undefined) : certificateOf(e.host).catch(() => undefined)])
    return {
      ...(disk ? { disk } : {}),
      memory: { free: os.freemem(), total: os.totalmem() },
      uptimeSeconds: Math.round(process.uptime()),
      version: env.CNW_VERSION ?? "0.0.0",
      ...(updater !== undefined ? { updater } : {}),
      ...(ownProxy ? {} : { caddy: certificate !== undefined }),
      computers: hub.status().map((c) => ({ id: c.id, label: c.label, online: c.online, history: hub.history(c.id) })),
    }
  })

  // The audit log of CNW's own changes and answers, newest first, a page at a time.
  app.get("/api/audit", async (req, reply) => {
    if (!need(req, reply, "server")) return
    const q = req.query as { before?: string; limit?: string }
    const limit = Math.max(1, Math.min(200, Number(q.limit) || 50))
    const all = [...audit.read().entries].reverse()
    const from = q.before ? all.findIndex((x) => x.at < String(q.before)) : 0
    const page = from < 0 ? [] : all.slice(from, from + limit)
    return { entries: page, total: all.length, ...(from >= 0 && from + limit < all.length ? { more: page.at(-1)?.at } : {}) }
  })

  // Renaming a computer, and its tags (groups on the board).
  const Rename = z.object({ label: z.string().trim().min(1).max(60).optional(), tags: z.array(z.string().trim().min(1).max(30)).max(10).optional() })
  app.patch("/api/computers/:id", async (req, reply) => {
    const a = need(req, reply, "pair")
    if (!a) return
    const id = (req.params as { id: string }).id
    const b = Rename.safeParse(req.body)
    if (!b.success) return reply.code(422).send({ error: "A name of up to 60 characters, and tags of up to 30." })
    const c = paired.read().computers.find((x) => x.id === id)
    if (!c) return reply.code(404).send({ error: "There is no such computer." })
    paired.update((p) => ({ ...p, computers: p.computers.map((x) => (x.id === id ? { ...x, ...(b.data.label ? { label: b.data.label } : {}), ...(b.data.tags ? { tags: b.data.tags } : {}) } : x)) }))
    record(a.kind === "user" ? a.user : "allowed network", "computer-renamed", `${c.label}${b.data.label ? ` to ${b.data.label}` : ""}${b.data.tags ? `, tags ${b.data.tags.join(", ") || "none"}` : ""}`)
    return { ok: true }
  })

  app.get("/api/computers", async (req, reply) => {
    const a = need(req, reply, "view")
    return a ? { computers: hub.status().filter((c) => sees(a, c.id)) } : undefined
  })
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

  // Update: the updater service (the only part that reaches Docker) fetches the signed release and rebuilds CNW.
  // The protocol number too (the handshake with Codehouse), for scripts/update.sh to print.
  app.get("/api/version", async () => ({ version: process.env.CNW_VERSION ?? "0.0.0", protocol: PROTOCOL }))
  app.post("/api/update", async (req, reply) => {
    const a = need(req, reply, "update")
    if (!a) return
    const updater = process.env.CNW_UPDATER
    if (!updater) return reply.code(501).send({ error: "There is no updater in this setup." })
    log(`Update asked for by ${a.kind === "user" ? a.user : "?"}`)
    try {
      const r = await fetch(new URL("/update", updater), { method: "POST" })
      const text = await r.text()
      return reply.code(r.ok ? 200 : 502).send({ message: text })
    } catch (e) {
      return reply.code(502).send({ error: `The updater could not be reached: ${(e as Error).message}` })
    }
  })

  // ADR 0020: caddy's root certificate, the public part, for Codehouse to pin at pairing. Codehouse believes it only once
  // CNW's own certificate verifies against it. None with a certificate the system trusts (Let's Encrypt).
  app.get("/agent/ca", async (_req, reply) => {
    const pem = caddyRoot()
    if (!pem) return reply.code(404).send({ error: "There is no root certificate here." })
    return reply.type("application/x-pem-file").send(pem)
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

  app.all("/c/:computer/api/*", async (req, reply) => {
    const a = need(req, reply, "view")
    if (!a) return
    const { computer } = req.params as { computer: string }
    if (!sees(a, computer)) return reply.code(404).send({ error: "That computer is not one you see." })
    if (!httpAllowed(roleFor(a), req.method)) return reply.code(403).send({ error: "Your role in Neighbourhood Watch only looks at this computer." })
    const rest = req.url.slice(`/c/${computer}`.length)
    if (!rest.startsWith("/api/")) return reply.code(404).send({ error: "Not found." })
    const body = req.body === undefined ? undefined : typeof req.body === "string" ? req.body : JSON.stringify(req.body)
    const r = await hub.http(computer, {
      method: req.method,
      path: rest,
      ...(body !== undefined ? { body } : {}),
      user: a.kind === "user" ? a.user : "allowed network",
      signedIn: a.kind === "user",
    })
    return reply.code(r.status).type(r.contentType).send(r.body)
  })

  app.get("/ws/:computer", { websocket: true }, (socket, req) => {
    const a = access(req)
    if (!may(a, "view") || needsEmail(a)) return socket.close(4401, "sign in")
    const user = a.kind === "user" ? a.user : "allowed network"
    const id = (req.params as { computer: string }).computer
    if (!sees(a, id)) return socket.close(4404, "not yours")
    const s = { send: (d: string) => socket.send(d), close: (c?: number, r?: string) => socket.close(c, r) }
    const stop = hub.watch(id, s, user, a.kind === "user")
    socket.on("message", (raw: Buffer) => {
      // An approver's tab sends answers only, a viewer's nothing; the role is read at each command.
      let data: unknown
      try {
        data = JSON.parse(raw.toString())
      } catch {
        data = undefined
      }
      if (!commandAllowed(roleFor(access(req)), data)) return s.send(JSON.stringify({ type: "refused", why: "role" }))
      const r = hub.command(id, s, raw.toString())
      if (r !== "sent") s.send(JSON.stringify({ type: "refused", why: r }))
    })
    socket.on("close", stop)
  })

  // CNW's own pages at /, and the full Codehouse interface, built for remote use, at /app/.
  const here = path.dirname(fileURLToPath(import.meta.url))
  await app.register(fastifyStatic, { root: path.resolve(here, "../public"), prefix: "/", index: ["index.html"], wildcard: false })
  const web = o.webDir ?? path.resolve(here, "../../web/dist")
  if (fs.existsSync(path.join(web, "index.html")))
    await app.register(fastifyStatic, { root: web, prefix: "/app/", decorateReply: false, index: ["index.html"] })

  return { app, hub, pushLook }
}
