import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Throttle } from "./auth.js"
import type { Role } from "./roles.js"
import {
  Flows,
  FLOW_MS,
  flowCookie,
  handOffPage,
  identityKey,
  OidcClients,
  oidcFinish,
  oidcStart,
  resolve,
  SamlServices,
  samlIdentity,
  SSO_COOKIE,
  SsoError,
  type Identity,
  type SsoSettings,
  type SsoUser,
} from "./sso.js"

/**
 * O52: the single sign-on routes. A sign-in starts at /api/sso/<kind>/start (a link the sign-in page or your account
 * page opens), which keeps its state here and its id in the Lax cookie, and sends the browser to the provider. The
 * provider sends it back: OpenID Connect to /api/sso/oidc/callback (a GET the Lax cookie comes with); SAML posts to
 * /api/sso/saml/acs, which checks the assertion, keeps the identity with its flow, and sends the browser on to
 * /api/sso/saml/finish, a same-site request the Lax cookie comes with, where the person is signed in. Every sign-in,
 * link and refusal is in CNW's audit log and its log.
 */
export interface SsoRouteDeps {
  origin: string
  publicUrl: string
  now: () => number
  allowHttp: boolean
  fetchText: (url: string) => Promise<string>
  settings: () => SsoSettings
  secret: () => string
  users: () => readonly SsoUser[]
  makeUser: (name: string, email: string | undefined, role: Role, key: string) => void
  link: (name: string, key: string) => void
  hasTotp: (name: string) => boolean
  ticket: (name: string) => string
  signIn: (req: FastifyRequest, reply: FastifyReply, name: string) => void
  signedIn: (req: FastifyRequest) => string | undefined
  ipOf: (req: FastifyRequest) => string
  throttle: Throttle
  record: (user: string, action: string, detail: string) => void
  log: (line: string) => void
}

/** The SAML metadata URL's text: https only (unless tests say), 10 seconds, no redirects followed elsewhere. */
export async function fetchMetadata(url: string): Promise<string> {
  const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(10_000) })
  if (!r.ok) throw new Error(`it answered ${r.status}`)
  return await r.text()
}

export function registerSsoRoutes(app: FastifyInstance, d: SsoRouteDeps): void {
  const flows = new Flows(d.now)
  const oidcClients = new OidcClients({ allowHttp: d.allowHttp }, d.now)
  const samls = new SamlServices(d.fetchText, d.now)
  const sp = { entityId: `${d.origin}/api/sso/saml/metadata`, acsUrl: `${d.origin}/api/sso/saml/acs` }
  const redirectUri = `${d.origin}/api/sso/oidc/callback`

  // The IdP's form POST.
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string", bodyLimit: 512 * 1024 }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(String(body))))
  })

  const flowOf = (req: FastifyRequest) =>
    String(req.headers.cookie ?? "")
      .split(";")
      .map((c) => c.trim().split("="))
      .find(([k]) => k === SSO_COOKIE)?.[1]
  const back = (reply: FastifyReply, to: string) => reply.header("set-cookie", flowCookie("", 0)).redirect(to, 303)
  const failed = (req: FastifyRequest, reply: FastifyReply, kind: string, why: string) => {
    d.throttle.failed(`sso:${d.ipOf(req)}`)
    d.record("-", "sso-failed", `${kind}: ${why}`)
    d.log(`Single sign-on refused (${kind}) from ${d.ipOf(req)}: ${why}`)
    return back(reply, `/?sso_error=${encodeURIComponent(why)}`)
  }
  const waitOf = (req: FastifyRequest) => d.throttle.wait(`sso:${d.ipOf(req)}`)

  /** An identity checked: linked, signed in (or asked for the code), or refused; and the flow's cookie cleared. */
  const complete = (req: FastifyRequest, reply: FastifyReply, identity: Identity, link: string | undefined) => {
    const r = resolve(identity, d.settings(), d.users(), link)
    if ("refused" in r) return failed(req, reply, identity.kind, r.refused)
    d.throttle.succeeded(`sso:${d.ipOf(req)}`)
    const key = identityKey(identity)
    if (r.created) {
      d.makeUser(r.user, identity.email, r.created, key)
      d.record(r.user, "sso-user-made", `${identity.kind} ${identity.issuer}, made as ${r.created} (single sign-on makes people, as the owner chose)`)
      d.log(`Single sign-on made an account: ${r.user} as ${r.created}`)
    }
    if (link) {
      if (r.linked) d.link(link, key)
      d.record(link, "sso-linked", `${identity.kind} ${identity.issuer}`)
      d.log(`Single sign-on linked to ${link}: ${identity.kind} ${identity.issuer}`)
      return back(reply, "/?sso=linked#you")
    }
    // A second factor on the account is asked for here too, as after a password.
    if (d.hasTotp(r.user)) return back(reply, `/?sso_totp=${encodeURIComponent(d.ticket(r.user))}`)
    d.signIn(req, reply, r.user)
    d.record(r.user, "sso-sign-in", `${identity.kind} ${identity.issuer}`)
    d.log(`Signed in with single sign-on: ${r.user} (${identity.kind}) from ${d.ipOf(req)}`)
    // The flow's cookie goes too (Fastify sends each set-cookie, so the session's stays).
    return reply.header("set-cookie", flowCookie("", 0)).redirect("/", 303)
  }

  /** A sign-in or, from your account, a link: who is linking, or a refusal when linking without being signed in. */
  const linking = (req: FastifyRequest): string | undefined | false => {
    if ((req.query as { link?: string }).link !== "1") return undefined
    return d.signedIn(req) ?? false
  }

  // ------------------------------------------------------------------------------------------------ OpenID Connect
  app.get("/api/sso/oidc/start", async (req, reply) => {
    const s = d.settings().oidc
    const secret = s ? d.secret() : ""
    if (!s || !secret) return reply.code(404).send({ error: "OpenID Connect sign-in is not set up." })
    const link = linking(req)
    if (link === false) return reply.code(401).send({ error: "Sign in first, then link single sign-on from your account." })
    if (waitOf(req)) return reply.code(429).send({ error: `Too many tries. Wait ${Math.ceil(waitOf(req) / 1000)} seconds.` })
    try {
      const config = await oidcClients.config(s.issuer, s.clientId, secret)
      const start = await oidcStart(config, redirectUri)
      const id = flows.start({ kind: "oidc", state: start.state, nonce: start.nonce, verifier: start.verifier, ...(link ? { link } : {}) })
      return reply.header("set-cookie", flowCookie(id, FLOW_MS / 1000)).redirect(start.url, 303)
    } catch (e) {
      return failed(req, reply, "oidc", e instanceof SsoError ? e.message : `the sign-in could not start (${(e as Error).message})`)
    }
  })

  app.get("/api/sso/oidc/callback", async (req, reply) => {
    if (waitOf(req)) return failed(req, reply, "oidc", `too many tries from this address; wait ${Math.ceil(waitOf(req) / 1000)} seconds`)
    const flow = flows.get(flowOf(req), true)
    if (!flow || flow.kind !== "oidc") return failed(req, reply, "oidc", "this sign-in was not started here, or took more than ten minutes; start it again")
    const q = req.query as Record<string, string>
    if (q.error) return failed(req, reply, "oidc", `the provider said ${String(q.error).slice(0, 100)}${q.error_description ? `: ${String(q.error_description).slice(0, 200)}` : ""}`)
    const s = d.settings().oidc
    if (!s) return failed(req, reply, "oidc", "OpenID Connect sign-in is no longer set up")
    try {
      const config = await oidcClients.config(s.issuer, s.clientId, d.secret())
      const identity = await oidcFinish(config, new URL(req.url, d.origin), flow)
      return complete(req, reply, identity, flow.link)
    } catch (e) {
      return failed(req, reply, "oidc", e instanceof SsoError ? e.message : `the answer could not be checked (${(e as Error).message})`)
    }
  })

  // ------------------------------------------------------------------------------------------------------------ SAML
  app.get("/api/sso/saml/start", async (req, reply) => {
    const s = d.settings().saml
    if (!s) return reply.code(404).send({ error: "SAML sign-in is not set up." })
    const link = linking(req)
    if (link === false) return reply.code(401).send({ error: "Sign in first, then link single sign-on from your account." })
    if (waitOf(req)) return reply.code(429).send({ error: `Too many tries. Wait ${Math.ceil(waitOf(req) / 1000)} seconds.` })
    try {
      const { saml } = await samls.service(s, sp)
      const id = flows.start({ kind: "saml", ...(link ? { link } : {}) })
      const url = await saml.getAuthorizeUrlAsync(id, undefined, {})
      return reply.header("set-cookie", flowCookie(id, FLOW_MS / 1000)).redirect(url, 303)
    } catch (e) {
      return failed(req, reply, "saml", e instanceof SsoError ? e.message : `the sign-in could not start (${(e as Error).message})`)
    }
  })

  // The IdP's POST: no cookie comes with it (it is a cross-site POST), so it signs nobody in; it checks the assertion
  // and keeps the identity with the flow named by RelayState, for this browser's own request to finish.
  app.post("/api/sso/saml/acs", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const relay = typeof body.RelayState === "string" ? body.RelayState : ""
    if (waitOf(req)) return failed(req, reply, "saml", `too many tries from this address; wait ${Math.ceil(waitOf(req) / 1000)} seconds`)
    const flow = flows.get(relay, false)
    if (!flow || flow.kind !== "saml" || flow.done) return failed(req, reply, "saml", "this sign-in was not started here, or took more than ten minutes; start it again")
    const s = d.settings().saml
    if (!s || typeof body.SAMLResponse !== "string") return failed(req, reply, "saml", "the IdP sent no SAML response")
    try {
      const { saml, meta } = await samls.service(s, sp)
      const { profile } = await saml.validatePostResponseAsync({ SAMLResponse: body.SAMLResponse })
      if (!profile) return failed(req, reply, "saml", "the IdP sent a sign-out, not a sign-in")
      flows.finish(relay, samlIdentity(profile, meta))
      return reply.type("text/html; charset=utf-8").header("cache-control", "no-store").send(handOffPage(`/api/sso/saml/finish?flow=${encodeURIComponent(relay)}`))
    } catch (e) {
      return failed(req, reply, "saml", e instanceof SsoError ? e.message : `the IdP's answer was refused (${(e as Error).message})`)
    }
  })

  // This browser's own request: its Lax cookie must name the same flow the IdP answered.
  app.get("/api/sso/saml/finish", async (req, reply) => {
    const named = String((req.query as { flow?: string }).flow ?? "")
    const mine = flowOf(req)
    if (!named || named !== mine) return failed(req, reply, "saml", "this sign-in was answered for another browser")
    const flow = flows.get(mine, true)
    if (!flow?.done) return failed(req, reply, "saml", "this sign-in was not answered, or took more than ten minutes; start it again")
    return complete(req, reply, flow.done, flow.link)
  })

  // What to give the IdP: this service's own metadata (its entity id and where it is answered).
  app.get("/api/sso/saml/metadata", async (_req, reply) => {
    const s = d.settings().saml
    if (!s) return reply.code(404).send({ error: "SAML sign-in is not set up." })
    try {
      const { saml } = await samls.service(s, sp)
      return reply.type("application/samlmetadata+xml").send(saml.generateServiceProviderMetadata(null, null))
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message })
    }
  })
}
