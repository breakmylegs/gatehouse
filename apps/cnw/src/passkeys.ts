import crypto from "node:crypto"
import net from "node:net"
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"

/**
 * O41: passkeys for CNW, offered beside the password (the owner asked for both). Added by someone signed in; used to
 * sign in without typing a name (a discoverable credential, user verification required). Each challenge is used once
 * and lasts five minutes; the signature counter is checked so a cloned key is noticed. The relying party is CNW's own
 * name, so a passkey made for it works nowhere else.
 */
export interface StoredPasskey {
  id: string
  publicKey: string
  counter: number
}

export interface PasskeyDeps {
  rpId: string
  origin: string
  /** The user's passkeys, and saving them. */
  passkeysOf: (user: string) => StoredPasskey[]
  setPasskeys: (user: string, keys: StoredPasskey[]) => void
  /** Which user a credential belongs to. */
  ownerOf: (credentialId: string) => string | undefined
  /** The signed-in user of a request, if any. */
  signedIn: (req: FastifyRequest) => string | undefined
  /** Starts a signed-in session marked as made with a passkey, and returns its CSRF token. */
  startSession: (reply: FastifyReply, user: string) => string
  throttleKey: (req: FastifyRequest) => string
  throttle: { wait(k: string): number; failed(k: string): void; succeeded(k: string): void }
  log: (line: string) => void
  now?: () => number
}

const CHALLENGE_MS = 5 * 60_000

/**
 * WebAuthn needs a name as its relying party: browsers refuse a passkey for an IP address. CNW at an address keeps
 * password sign-in and says why passkeys are not offered.
 */
export const PASSKEY_ON_IP =
  "Passkeys need Neighbourhood Watch at a name, such as cnw.home.arpa: browsers refuse them at an IP address. Sign in with your password, or give it a name (see Start it in the guide)."

export const passkeysPossible = (rpId: string): boolean => net.isIP(rpId.replace(/^\[|\]$/g, "")) === 0

export function registerPasskeyRoutes(app: FastifyInstance, d: PasskeyDeps): void {
  if (!passkeysPossible(d.rpId)) {
    for (const route of ["/api/passkey/register/options", "/api/passkey/register/verify", "/api/passkey/login/options", "/api/passkey/login/verify"])
      app.post(route, async (_req, reply) => reply.code(409).send({ error: PASSKEY_ON_IP }))
    return
  }
  const now = d.now ?? Date.now
  const challenges = new Map<string, { challenge: string; user?: string; expires: number }>()
  const keep = (challenge: string, user?: string) => {
    for (const [k, v] of challenges) if (v.expires < now()) challenges.delete(k)
    const id = crypto.randomBytes(16).toString("base64url")
    challenges.set(id, { challenge, ...(user ? { user } : {}), expires: now() + CHALLENGE_MS })
    return id
  }
  const take = (id: unknown) => {
    if (typeof id !== "string") return undefined
    const c = challenges.get(id)
    challenges.delete(id)
    return c && c.expires >= now() ? c : undefined
  }

  app.post("/api/passkey/register/options", async (req, reply) => {
    const user = d.signedIn(req)
    if (!user) return reply.code(401).send({ error: "Sign in first." })
    const options = await generateRegistrationOptions({
      rpName: "Codehouse Neighbourhood Watch",
      rpID: d.rpId,
      userName: user,
      userID: new TextEncoder().encode(user),
      attestationType: "none",
      excludeCredentials: d.passkeysOf(user).map((k) => ({ id: k.id })),
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    })
    return { options, ticket: keep(options.challenge, user) }
  })

  app.post("/api/passkey/register/verify", async (req, reply) => {
    const user = d.signedIn(req)
    const b = (req.body ?? {}) as { ticket?: unknown; response?: unknown }
    const c = take(b.ticket)
    if (!user || !c || c.user !== user) return reply.code(400).send({ error: "That took too long. Try again." })
    try {
      const v = await verifyRegistrationResponse({
        response: b.response as RegistrationResponseJSON,
        expectedChallenge: c.challenge,
        expectedOrigin: d.origin,
        expectedRPID: d.rpId,
        requireUserVerification: true,
      })
      if (!v.verified || !v.registrationInfo) throw new Error("not verified")
      const cred = v.registrationInfo.credential
      d.setPasskeys(user, [...d.passkeysOf(user), { id: cred.id, publicKey: Buffer.from(cred.publicKey).toString("base64url"), counter: cred.counter }].slice(-10))
      d.log(`Passkey added for ${user}`)
      return { ok: true }
    } catch (e) {
      return reply.code(400).send({ error: `The passkey did not verify (${(e as Error).message.slice(0, 80)}).` })
    }
  })

  app.post("/api/passkey/login/options", async (req, reply) => {
    const wait = d.throttle.wait(d.throttleKey(req))
    if (wait) return reply.code(429).send({ error: `Too many tries. Wait ${Math.ceil(wait / 1000)} seconds.` })
    const options = await generateAuthenticationOptions({ rpID: d.rpId, userVerification: "required" })
    return { options, ticket: keep(options.challenge) }
  })

  app.post("/api/passkey/login/verify", async (req, reply) => {
    const key = d.throttleKey(req)
    const b = (req.body ?? {}) as { ticket?: unknown; response?: AuthenticationResponseJSON }
    const c = take(b.ticket)
    const credId = typeof b.response?.id === "string" ? b.response.id : ""
    const user = d.ownerOf(credId)
    const stored = user ? d.passkeysOf(user).find((k) => k.id === credId) : undefined
    if (!c || !user || !stored) {
      d.throttle.failed(key)
      return reply.code(401).send({ error: "That passkey is not one this Neighbourhood Watch knows." })
    }
    try {
      const v = await verifyAuthenticationResponse({
        response: b.response!,
        expectedChallenge: c.challenge,
        expectedOrigin: d.origin,
        expectedRPID: d.rpId,
        credential: { id: stored.id, publicKey: Buffer.from(stored.publicKey, "base64url"), counter: stored.counter },
        requireUserVerification: true,
      })
      if (!v.verified) throw new Error("not verified")
      d.setPasskeys(user, d.passkeysOf(user).map((k) => (k.id === stored.id ? { ...k, counter: v.authenticationInfo.newCounter } : k)))
      d.throttle.succeeded(key)
      d.log(`Signed in with a passkey: ${user}`)
      return { ok: true, csrf: d.startSession(reply, user) }
    } catch (e) {
      d.throttle.failed(key)
      return reply.code(401).send({ error: `The passkey did not verify (${(e as Error).message.slice(0, 80)}).` })
    }
  })
}
