import { EventEmitter } from "node:events"
import fs from "node:fs"
import path from "node:path"
import fastifyStatic from "@fastify/static"
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server"
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify"
import {
  ConfirmPairing,
  CreatePairing,
  DeviceNotify,
  DeviceRequest,
  EnrolRequest,
  PAIRING_CODE,
  PAIRING_TTL_MS,
  PhoneEnvelopePost,
  PhoneRegistration,
  SessionChallengeRequest,
  SessionLogin,
} from "@gatehouse/shared/relay-protocol"
import { newId, safeEqual, Store, token, type DeviceRow, type PhoneRow } from "./db.js"
import type { PushSender } from "./push.js"

export interface RelayOptions {
  /** The address the phone reaches the Relay at, for example https://gatehouse.example.com. Fixes the WebAuthn origin and RP id. */
  publicUrl: string
  store: Store
  push: PushSender
  /** Folder of the built phone app. Optional. */
  phoneDist?: string
  now?: () => number
  log?: (line: string) => void
  /** Where the one-time enrolment token is written. */
  enrolFile?: string
  /** Requests per minute per address on endpoints that need no login. */
  anonymousLimit?: number
}

const SESSION_MS = 15 * 60_000
const CHALLENGE_MS = 2 * 60_000
const RESOLVED_VISIBLE_MS = 10 * 60_000
const MAX_WAIT_S = 25

const b64uToBytes = (s: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(Buffer.from(s, "base64url"))

/** True for addresses a reverse proxy on this machine or a private network would have. Function form, never a hop count. */
export const trustProxy = (ip: string): boolean =>
  ip === "127.0.0.1" ||
  ip === "::1" ||
  ip === "::ffff:127.0.0.1" ||
  /^(::ffff:)?(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)

declare module "fastify" {
  interface FastifyRequest {
    device?: DeviceRow
    phone?: PhoneRow
  }
}

export interface Relay {
  app: FastifyInstance
  events: EventEmitter
  /** Makes a fresh one-time enrolment token, replacing any earlier one, and returns it. */
  newEnrolToken(): string
  close(): Promise<void>
}

export async function buildRelay(opts: RelayOptions): Promise<Relay> {
  const now = opts.now ?? Date.now
  const log = opts.log ?? (() => undefined)
  const { store, push } = opts
  const origin = new URL(opts.publicUrl).origin
  const rpId = new URL(opts.publicUrl).hostname
  const events = new EventEmitter()
  events.setMaxListeners(100)
  const limit = opts.anonymousLimit ?? 30

  const app = Fastify({ logger: false, bodyLimit: 64 * 1024, trustProxy })

  function newEnrolToken(): string {
    const t = token(24)
    store.kvSet("enrol", t)
    if (opts.enrolFile) {
      fs.mkdirSync(path.dirname(opts.enrolFile), { recursive: true })
      fs.writeFileSync(opts.enrolFile, t + "\n", { mode: 0o600 })
    }
    return t
  }
  if (!store.kvGet("enrol")) newEnrolToken()

  // ---- guards ----
  const hits = new Map<string, { n: number; reset: number }>()
  function tooMany(req: FastifyRequest): boolean {
    const t = now()
    const key = `${req.ip}|${req.routeOptions.url ?? req.url}`
    const h = hits.get(key)
    if (!h || h.reset < t) {
      hits.set(key, { n: 1, reset: t + 60_000 })
      return false
    }
    h.n++
    return h.n > limit
  }
  const sweep = setInterval(() => {
    const t = now()
    for (const [k, h] of hits) if (h.reset < t) hits.delete(k)
    store.purge(t)
  }, 60_000)
  sweep.unref()

  const fail = (reply: FastifyReply, status: number, error: string) =>
    reply.code(status).send({ error })

  app.addHook("onSend", async (req, reply, payload) => {
    reply.header("x-content-type-options", "nosniff")
    reply.header("referrer-policy", "no-referrer")
    reply.header("cross-origin-opener-policy", "same-origin")
    if (req.url.startsWith("/api/")) reply.header("cache-control", "no-store")
    else
      reply.header(
        "content-security-policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      )
    return payload
  })

  // A laptop proves itself with its bearer token, a phone with the session it got from a passkey.
  app.addHook("preHandler", async (req, reply) => {
    const url = req.url.split("?")[0] ?? ""
    const bearer = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? "")?.[1]
    if (url.startsWith("/api/device/") && url !== "/api/device/enroll") {
      const dev = bearer ? store.deviceByToken(bearer) : undefined
      if (!dev) return fail(reply, 401, "unauthorized")
      req.device = dev
    } else if (
      url.startsWith("/api/phone/") &&
      !/^\/api\/phone\/(pairing-info|pairings\/|session)/.test(url)
    ) {
      const phoneId = bearer ? store.sessionPhone(bearer, now()) : undefined
      const phone = phoneId ? store.phoneById(phoneId) : undefined
      if (!phone) return fail(reply, 401, "unauthorized")
      req.phone = phone
    } else if (url.startsWith("/api/") && !url.startsWith("/api/public")) {
      if (tooMany(req)) return fail(reply, 429, "slow down")
    }
    return undefined
  })

  // ================= laptop side =================

  app.post("/api/device/enroll", async (req, reply) => {
    if (tooMany(req)) return fail(reply, 429, "slow down")
    const b = EnrolRequest.safeParse(req.body)
    if (!b.success) return fail(reply, 400, "bad request")
    const expected = store.kvGet("enrol")
    if (!expected || !safeEqual(b.data.enrolToken, expected))
      return fail(reply, 401, "unauthorized")
    const t = token(32)
    const dev = store.addDevice(b.data.name, t, now())
    // One enrolment per token: the next device needs a fresh one, read from the Relay's own volume.
    newEnrolToken()
    log(`device enrolled: ${dev.id}`)
    return { deviceId: dev.id, token: t }
  })

  app.post("/api/device/pairings", async (req, reply) => {
    const b = CreatePairing.safeParse(req.body)
    if (!b.success) return fail(reply, 400, "bad request")
    const id = newId()
    const expiresAt = now() + PAIRING_TTL_MS
    store.addPairing(
      {
        id,
        device_id: req.device!.id,
        code: b.data.code,
        challenge: b.data.challenge,
        host_pub: b.data.hostPublicKey,
        expires_at: expiresAt,
      },
      now(),
    )
    return { id, expiresAt: new Date(expiresAt).toISOString(), rpId, origin }
  })

  app.get("/api/device/pairings/:id", async (req, reply) => {
    const p = store.pairingById((req.params as { id: string }).id)
    if (!p || p.device_id !== req.device!.id) return fail(reply, 404, "not found")
    const expired = p.expires_at < now() && p.status !== "confirmed"
    return {
      status: expired ? "expired" : p.status,
      ...(p.registration && !expired
        ? { registration: JSON.parse(p.registration) as unknown }
        : {}),
      ...(p.phone_id ? { phoneId: p.phone_id } : {}),
    }
  })

  app.post("/api/device/pairings/:id/confirm", async (req, reply) => {
    const p = store.pairingById((req.params as { id: string }).id)
    if (!p || p.device_id !== req.device!.id) return fail(reply, 404, "not found")
    if (p.status !== "registered" || !p.registration || p.expires_at < now())
      return fail(reply, 409, "the pairing is not waiting for confirmation")
    const b = ConfirmPairing.safeParse(req.body)
    if (!b.success) return fail(reply, 400, "bad request")
    const reg = PhoneRegistration.parse(JSON.parse(p.registration))
    const phoneId = store.addPhone(
      {
        device_id: p.device_id,
        name: reg.phoneName,
        credential_id: b.data.credentialId,
        credential_pub: b.data.credentialPublicKey,
        counter: b.data.counter,
        ecdh_pub: reg.ecdhPublicKey,
        push_sub: reg.pushSubscription ? JSON.stringify(reg.pushSubscription) : null,
      },
      now(),
    )
    store.confirmPairing(p.id, phoneId)
    return { phoneId }
  })

  app.get("/api/device/phones", async (req) =>
    store
      .phonesOfDevice(req.device!.id)
      .map((p) => ({ id: p.id, name: p.name, push: p.push_sub !== null })),
  )
  app.put("/api/device/phones/:id", async (req, reply) => {
    const name = (req.body as { name?: unknown } | null)?.name
    if (typeof name !== "string" || name.length < 1 || name.length > 80)
      return fail(reply, 400, "bad request")
    return store.renamePhone(req.device!.id, (req.params as { id: string }).id, name)
      ? { ok: true }
      : fail(reply, 404, "not found")
  })
  app.delete("/api/device/phones/:id", async (req, reply) =>
    store.deletePhone(req.device!.id, (req.params as { id: string }).id)
      ? { ok: true }
      : fail(reply, 404, "not found"),
  )

  async function pushTo(
    phone: PhoneRow,
    message: Parameters<PushSender["send"]>[1],
    urgent: boolean,
  ) {
    if (!phone.push_sub) return
    const r = await push.send(phone.push_sub, message, urgent)
    if (r === "gone") store.setPushSub(phone.id, null)
  }

  app.post("/api/device/requests", async (req, reply) => {
    const b = DeviceRequest.safeParse(req.body)
    if (!b.success) return fail(reply, 400, "bad request")
    const phone = store.phoneById(b.data.phoneId)
    if (!phone || phone.device_id !== req.device!.id) return fail(reply, 404, "no such phone")
    const exp = Date.parse(b.data.expiresAt)
    if (Number.isNaN(exp) || exp <= now()) return fail(reply, 400, "already expired")
    const existing = store.requestById(b.data.id)
    if (existing && existing.device_id !== req.device!.id) return fail(reply, 409, "id in use")
    store.putRequest(
      {
        id: b.data.id,
        device_id: req.device!.id,
        phone_id: phone.id,
        sealed: JSON.stringify(b.data.sealed),
        expires_at: exp,
        priority: b.data.priority,
      },
      now(),
    )
    void pushTo(phone, { t: "request", id: b.data.id }, b.data.priority === "high")
    return { ok: true }
  })

  app.get("/api/device/decisions", async (req) => {
    const wait = Math.min(
      MAX_WAIT_S,
      Math.max(0, Number((req.query as { wait?: string }).wait ?? 0) || 0),
    )
    const deviceId = req.device!.id
    const read = () =>
      store.envelopesFor(deviceId).map((e) => ({
        id: e.id,
        phoneId: e.phone_id,
        requestId: e.request_id,
        sealed: JSON.parse(e.sealed) as unknown,
        createdAt: new Date(e.created_at).toISOString(),
      }))
    let found = read()
    if (found.length > 0 || wait === 0) return found
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(t)
        events.off(`envelope:${deviceId}`, done)
        resolve()
      }
      const t = setTimeout(done, wait * 1000)
      events.on(`envelope:${deviceId}`, done)
      req.raw.on("close", done)
    })
    found = read()
    return found
  })

  app.delete("/api/device/decisions/:id", async (req) => {
    store.ackEnvelope(req.device!.id, (req.params as { id: string }).id)
    return { ok: true }
  })

  app.post("/api/device/requests/:id/resolved", async (req, reply) => {
    const summary = (req.body as { summary?: unknown } | null)?.summary
    if (typeof summary !== "string" || summary.length > 200) return fail(reply, 400, "bad request")
    return store.resolveRequest(req.device!.id, (req.params as { id: string }).id, summary, now())
      ? { ok: true }
      : fail(reply, 404, "not found")
  })

  app.post("/api/device/notify", async (req, reply) => {
    const b = DeviceNotify.safeParse(req.body)
    if (!b.success) return fail(reply, 400, "bad request")
    const phone = store.phoneById(b.data.phoneId)
    if (!phone || phone.device_id !== req.device!.id) return fail(reply, 404, "no such phone")
    await pushTo(
      phone,
      { t: b.data.kind === "notify" ? "notify" : b.data.kind, sealed: b.data.sealed },
      false,
    )
    return { ok: true }
  })

  // ================= phone side =================

  app.get("/api/public/config", async () => ({ vapidPublicKey: push.publicKey(), rpId, origin }))

  app.get("/api/phone/pairing-info", async (req, reply) => {
    if (tooMany(req)) return fail(reply, 429, "slow down")
    const code = String((req.query as { code?: string }).code ?? "").toUpperCase()
    if (!PAIRING_CODE.test(code)) return fail(reply, 404, "not found")
    const p = store.pairingByCode(code, now())
    if (!p || p.status !== "waiting") return fail(reply, 404, "not found")
    return {
      pairingId: p.id,
      challenge: p.challenge,
      hostPublicKey: p.host_pub,
      rpId,
      origin,
      expiresAt: new Date(p.expires_at).toISOString(),
    }
  })

  app.post("/api/phone/pairings/:id/register", async (req, reply) => {
    if (tooMany(req)) return fail(reply, 429, "slow down")
    const body = req.body as { code?: unknown } & Record<string, unknown>
    const p = store.pairingById((req.params as { id: string }).id)
    // The code is the secret that ties the phone to this pairing, so it is checked again here.
    if (
      !p ||
      typeof body?.code !== "string" ||
      !safeEqual(body.code.toUpperCase(), p.code) ||
      p.expires_at < now()
    )
      return fail(reply, 404, "not found")
    const { code: _code, ...rest } = body
    const b = PhoneRegistration.safeParse(rest)
    if (!b.success) return fail(reply, 400, "bad request")
    if (!store.registerPairing(p.id, JSON.stringify(b.data)))
      return fail(reply, 409, "already used")
    return { ok: true }
  })

  app.get("/api/phone/pairings/:id/status", async (req, reply) => {
    if (tooMany(req)) return fail(reply, 429, "slow down")
    const code = String((req.query as { code?: string }).code ?? "").toUpperCase()
    const p = store.pairingById((req.params as { id: string }).id)
    if (!p || !safeEqual(code, p.code)) return fail(reply, 404, "not found")
    return {
      status: p.expires_at < now() && p.status !== "confirmed" ? "expired" : p.status,
      ...(p.phone_id ? { phoneId: p.phone_id } : {}),
    }
  })

  app.post("/api/phone/session/challenge", async (req, reply) => {
    if (tooMany(req)) return fail(reply, 429, "slow down")
    const b = SessionChallengeRequest.safeParse(req.body)
    if (!b.success) return fail(reply, 400, "bad request")
    const phone = store.phoneById(b.data.phoneId)
    if (!phone) return fail(reply, 404, "not found")
    const options = await generateAuthenticationOptions({
      rpID: rpId,
      allowCredentials: [{ id: phone.credential_id }],
      userVerification: "required",
      timeout: 60_000,
    })
    store.addChallenge(phone.id, options.challenge, now() + CHALLENGE_MS)
    return options
  })

  app.post("/api/phone/session", async (req, reply) => {
    if (tooMany(req)) return fail(reply, 429, "slow down")
    const b = SessionLogin.safeParse(req.body)
    if (!b.success) return fail(reply, 400, "bad request")
    const phone = store.phoneById(b.data.phoneId)
    if (!phone) return fail(reply, 401, "unauthorized")
    const response = b.data.assertion as unknown as AuthenticationResponseJSON
    let challenge: string
    try {
      const cd = JSON.parse(
        Buffer.from(response.response.clientDataJSON, "base64url").toString("utf8"),
      ) as { challenge?: string }
      challenge = String(cd.challenge)
    } catch {
      return fail(reply, 400, "bad request")
    }
    if (!store.takeChallenge(phone.id, challenge, now())) return fail(reply, 401, "unauthorized")
    try {
      const v = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
        requireUserVerification: true,
        credential: {
          id: phone.credential_id,
          publicKey: b64uToBytes(phone.credential_pub),
          counter: phone.counter,
        },
      })
      if (!v.verified) return fail(reply, 401, "unauthorized")
      if (v.authenticationInfo.newCounter > phone.counter)
        store.setPhoneCounter(phone.id, v.authenticationInfo.newCounter)
    } catch {
      return fail(reply, 401, "unauthorized")
    }
    const t = token(32)
    store.addSession(t, phone.id, now() + SESSION_MS)
    return { token: t, expiresAt: new Date(now() + SESSION_MS).toISOString() }
  })

  app.get("/api/phone/pending", async (req) =>
    store.pendingForPhone(req.phone!.id, now(), RESOLVED_VISIBLE_MS).map((r) => ({
      id: r.id,
      sealed: JSON.parse(r.sealed) as unknown,
      expiresAt: new Date(r.expires_at).toISOString(),
      priority: r.priority,
      ...(r.resolved_at
        ? { resolvedAt: new Date(r.resolved_at).toISOString(), summary: r.summary ?? "Decided" }
        : {}),
    })),
  )

  app.get("/api/phone/requests/:id", async (req, reply) => {
    const r = store.requestById((req.params as { id: string }).id)
    if (!r || r.phone_id !== req.phone!.id) return fail(reply, 404, "not found")
    return {
      id: r.id,
      sealed: JSON.parse(r.sealed) as unknown,
      expiresAt: new Date(r.expires_at).toISOString(),
      ...(r.resolved_at
        ? { resolvedAt: new Date(r.resolved_at).toISOString(), summary: r.summary ?? "Decided" }
        : {}),
    }
  })

  app.post("/api/phone/envelopes", async (req, reply) => {
    const b = PhoneEnvelopePost.safeParse(req.body)
    if (!b.success) return fail(reply, 400, "bad request")
    if (b.data.requestId) {
      const r = store.requestById(b.data.requestId)
      if (!r || r.phone_id !== req.phone!.id) return fail(reply, 404, "not found")
    }
    store.addEnvelope(
      {
        device_id: req.phone!.device_id,
        phone_id: req.phone!.id,
        request_id: b.data.requestId ?? null,
        sealed: JSON.stringify(b.data.sealed),
      },
      now(),
    )
    events.emit(`envelope:${req.phone!.device_id}`)
    return { ok: true }
  })

  app.put("/api/phone/push-subscription", async (req, reply) => {
    const sub = (req.body as { subscription?: unknown } | null)?.subscription
    if (!sub || typeof sub !== "object") return fail(reply, 400, "bad request")
    store.setPushSub(req.phone!.id, JSON.stringify(sub))
    return { ok: true }
  })

  // ================= the phone app =================

  const dist = opts.phoneDist
  if (dist && fs.existsSync(path.join(dist, "index.html"))) {
    await app.register(fastifyStatic, { root: dist, wildcard: false, index: false })
    app.get("/", (_req, reply) => reply.sendFile("index.html"))
    app.addHook("onSend", async (req, reply, payload) => {
      if (req.url === "/sw.js") reply.header("cache-control", "no-cache")
      return payload
    })
  } else {
    app.get("/", (_req, reply) => reply.type("text/plain; charset=utf-8").send("Gatehouse relay"))
  }

  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send(req.url.startsWith("/api/") ? { error: "not found" } : "Not found"),
  )

  await app.ready()
  return {
    app,
    events,
    newEnrolToken,
    async close() {
      clearInterval(sweep)
      await app.close()
    },
  }
}
