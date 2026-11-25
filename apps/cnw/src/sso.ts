/**
 * O52 (owner, 25 Nov): single sign-on for Neighbourhood Watch, beside the password, TOTP and passkeys (auth.ts,
 * passwords.ts, passkeys.ts, totp.ts), which keep working so an owner can never be locked out.
 *
 * OpenID Connect, with openid-client (panva's, the maintained reference library): the authorization code flow with
 * PKCE (S256), state and nonce, the provider found by discovery from its issuer URL, and the ID token's signature
 * (non-repudiation checks, against the provider's JWKS), issuer, audience, expiry and nonce checked.
 *
 * SAML 2.0, with @node-saml/node-saml (the maintained core of passport-saml, its signatures checked by xml-crypto):
 * the assertion must be signed by a certificate from the IdP's metadata, for this service as its audience, from the
 * IdP's own issuer, in answer to a request CNW made (InResponseTo, used once), not replayed, and within its validity.
 * Nothing here checks an XML signature itself. The metadata, from its URL or a file, is only read for the IdP's
 * name, its sign-in address and its signing certificates.
 *
 * Who it is: an identity is matched to an existing CNW user by the claim chosen in settings: email (verified when the
 * provider says) or the subject (linked to an account first, from that account, while signed in). No user is made and
 * no role given unless the owner switches that on. A sign-in this way is never a passkey sign-in, and does not count as
 * having just signed in for a Severe allow, which still wants the password (and its code) or a passkey again.
 *
 * The session cookie is SameSite=Strict, which a provider's redirect back would not carry, so the sign-in's own state
 * is a short-lived SameSite=Lax cookie used only by the callback, holding a random id for state kept here.
 */
import crypto from "node:crypto"
import { DOMParser } from "@xmldom/xmldom"
import { SAML, ValidateInResponseTo, type Profile } from "@node-saml/node-saml"
import * as oidc from "openid-client"
import { ROLES, type Role } from "./roles.js"

export const SSO_COOKIE = "cnw_sso"
/** How long a sign-in may take at the provider. */
export const FLOW_MS = 10 * 60_000
const MAX_FLOWS = 500
const MAX_METADATA = 1024 * 1024

export interface SsoSettings {
  oidc?: {
    issuer: string
    clientId: string
    /** The client secret, sealed (totp.ts Sealer); never sent back to a page. */
    sealedSecret?: string
    /** What the sign-in button says. */
    label?: string
  }
  saml?: {
    /** The IdP's metadata, from its URL (fetched, kept an hour) or pasted from its file. */
    metadataUrl?: string
    metadataXml?: string
    label?: string
  }
  /** How an identity finds its CNW user: its email, or its subject (NameID for SAML) once linked. */
  match?: "email" | "sub"
  /** Off unless the owner switches it on: a person with no CNW user gets one, with this role. */
  autoCreate?: boolean
  autoRole?: Role
  savedAt?: string
  savedBy?: string
}

export interface Identity {
  kind: "oidc" | "saml"
  issuer: string
  subject: string
  email?: string
}

/** The key a linked identity is kept under on its user. */
export const identityKey = (i: Identity): string => `${i.kind}:${i.issuer}|${i.subject}`

export class SsoError extends Error {}

// ------------------------------------------------------------------------------------------------ settings, checked

const httpsUrl = (v: string, allowHttp: boolean) => {
  let u: URL
  try {
    u = new URL(v)
  } catch {
    return false
  }
  return u.protocol === "https:" || (allowHttp && u.protocol === "http:")
}

/** What the Server page sends, checked. The secret comes back apart, to be sealed; blank keeps the one there. */
export function checkSso(
  input: unknown,
  allowHttp = false,
): { settings: Omit<SsoSettings, "savedAt" | "savedBy">; secret?: string; clearSecret: boolean } | { error: string } {
  const b = (input && typeof input === "object" ? input : {}) as Record<string, unknown>
  const text = (o: unknown, k: string, max: number) => (o && typeof o === "object" && typeof (o as Record<string, unknown>)[k] === "string" ? ((o as Record<string, unknown>)[k] as string).trim().slice(0, max) : "")
  const out: Omit<SsoSettings, "savedAt" | "savedBy"> = {}
  let secret: string | undefined
  let clearSecret = false
  const issuer = text(b.oidc, "issuer", 500)
  const clientId = text(b.oidc, "clientId", 300)
  if (issuer || clientId) {
    if (!httpsUrl(issuer, allowHttp)) return { error: "The OpenID Connect issuer is an https:// address, such as https://auth.example.org/application/o/cnw/." }
    if (!clientId) return { error: "The OpenID Connect client id is needed with the issuer." }
    const label = text(b.oidc, "label", 60)
    out.oidc = { issuer, clientId, ...(label ? { label } : {}) }
    const s = text(b.oidc, "clientSecret", 500)
    if (s) secret = s
    clearSecret = (b.oidc as Record<string, unknown> | undefined)?.clearSecret === true
  }
  const metadataUrl = text(b.saml, "metadataUrl", 500)
  const metadataXml = typeof (b.saml as Record<string, unknown> | undefined)?.metadataXml === "string" ? String((b.saml as Record<string, unknown>).metadataXml).trim() : ""
  if (metadataUrl || metadataXml) {
    if (metadataUrl && !httpsUrl(metadataUrl, allowHttp)) return { error: "The SAML metadata URL is an https:// address." }
    if (metadataXml.length > MAX_METADATA) return { error: "The SAML metadata file is too large (1 MB at most)." }
    if (metadataXml) {
      try {
        parseMetadata(metadataXml)
      } catch (e) {
        return { error: (e as Error).message }
      }
    }
    const label = text(b.saml, "label", 60)
    out.saml = { ...(metadataUrl ? { metadataUrl } : {}), ...(metadataXml ? { metadataXml } : {}), ...(label ? { label } : {}) }
  }
  const match = b.match === "sub" ? "sub" : "email"
  out.match = match
  out.autoCreate = b.autoCreate === true
  const role = String(b.autoRole ?? "viewer")
  if (!(ROLES as readonly string[]).includes(role)) return { error: "Choose the role a new person gets." }
  // A person made by single sign-on is never made an owner by it.
  if (role === "owner") return { error: "Single sign-on never makes an owner. Choose admin, approver or viewer." }
  out.autoRole = role as Role
  return { settings: out, ...(secret ? { secret } : {}), clearSecret }
}

// ------------------------------------------------------------------------------------------------------ SAML metadata

export interface IdpMetadata {
  entityId: string
  ssoUrl: string
  certs: string[]
}

const MD = "urn:oasis:names:tc:SAML:2.0:metadata"
const DS = "http://www.w3.org/2000/09/xmldsig#"
const REDIRECT = "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"

/** The IdP's name, its sign-in address (the redirect binding) and its signing certificates, from its metadata. */
export function parseMetadata(xml: string): IdpMetadata {
  if (/<!DOCTYPE/i.test(xml)) throw new SsoError("The SAML metadata has a DOCTYPE, which CNW does not read.")
  const doc = new DOMParser({ errorHandler: () => undefined }).parseFromString(xml, "text/xml")
  const all = (parent: { getElementsByTagNameNS(ns: string, n: string): ArrayLike<Element> }, ns: string, n: string) => Array.from(parent.getElementsByTagNameNS(ns, n))
  const entity = all(doc as unknown as Document, MD, "EntityDescriptor")[0]
  const idp = entity ? all(entity, MD, "IDPSSODescriptor")[0] : undefined
  if (!entity || !idp) throw new SsoError("That is not an IdP's SAML metadata: it has no IDPSSODescriptor.")
  const entityId = entity.getAttribute("entityID") ?? ""
  const sso = all(idp, MD, "SingleSignOnService").find((s) => s.getAttribute("Binding") === REDIRECT)
  const ssoUrl = sso?.getAttribute("Location") ?? ""
  if (!entityId || !/^https?:\/\//.test(ssoUrl)) throw new SsoError("The SAML metadata names no sign-in address for the HTTP-Redirect binding.")
  const certs = all(idp, MD, "KeyDescriptor")
    .filter((k) => !k.getAttribute("use") || k.getAttribute("use") === "signing")
    .flatMap((k) => all(k, DS, "X509Certificate").map((c) => (c.textContent ?? "").replace(/\s+/g, "")))
    .filter(Boolean)
  if (!certs.length) throw new SsoError("The SAML metadata has no signing certificate.")
  return { entityId, ssoUrl, certs }
}

// ---------------------------------------------------------------------------------------------- sign-ins in progress

export interface Flow {
  kind: "oidc" | "saml"
  created: number
  /** OpenID Connect: the checks the callback must see again. */
  state?: string
  nonce?: string
  verifier?: string
  /** A signed-in user linking this identity to their account. */
  link?: string
  /** SAML: the identity, once the IdP's POST was checked, waiting for this browser's own request. */
  done?: Identity
}

/** The sign-ins under way, by a random id kept in the Lax cookie; each used once, gone after ten minutes. */
export class Flows {
  readonly #flows = new Map<string, Flow>()
  constructor(private readonly now: () => number = Date.now) {}

  start(f: Omit<Flow, "created">): string {
    const t = this.now()
    for (const [k, v] of this.#flows) if (t - v.created > FLOW_MS) this.#flows.delete(k)
    if (this.#flows.size >= MAX_FLOWS) this.#flows.delete(this.#flows.keys().next().value!)
    const id = crypto.randomBytes(24).toString("base64url")
    this.#flows.set(id, { ...f, created: t })
    return id
  }

  /** The flow for an id, while it lasts; `take` ends it, so it can be used once. */
  get(id: string | undefined, take: boolean): Flow | undefined {
    if (!id) return undefined
    const f = this.#flows.get(id)
    if (!f) return undefined
    if (this.now() - f.created > FLOW_MS) {
      this.#flows.delete(id)
      return undefined
    }
    if (take) this.#flows.delete(id)
    return f
  }

  finish(id: string, identity: Identity): void {
    const f = this.#flows.get(id)
    if (f) f.done = identity
  }
}

export const flowCookie = (id: string, maxAgeS: number) => `${SSO_COOKIE}=${id}; Path=/api/sso; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeS}`

// ------------------------------------------------------------------------------------------------------ OpenID Connect

export interface OidcDeps {
  /** Tests only: a provider on plain http on this machine. Never from settings or the environment. */
  allowHttp?: boolean
}

/** One discovery per issuer and client, kept an hour, then found again. */
export class OidcClients {
  readonly #cache = new Map<string, { at: number; config: Promise<oidc.Configuration> }>()
  constructor(private readonly d: OidcDeps = {}, private readonly now: () => number = Date.now) {}

  config(issuer: string, clientId: string, secret: string): Promise<oidc.Configuration> {
    const key = `${issuer}\u0000${clientId}\u0000${crypto.createHash("sha256").update(secret).digest("hex")}`
    const hit = this.#cache.get(key)
    if (hit && this.now() - hit.at < 3_600_000) return hit.config
    const config = oidc
      .discovery(new URL(issuer), clientId, secret, undefined, {
        // The ID token's signature checked against the provider's keys, as well as its claims.
        execute: [oidc.enableNonRepudiationChecks, ...(this.d.allowHttp ? [oidc.allowInsecureRequests] : [])],
      })
      .catch((e: Error) => {
        this.#cache.delete(key)
        throw new SsoError(`The OpenID Connect provider could not be found at ${issuer} (${e.message}).`)
      })
    this.#cache.set(key, { at: this.now(), config })
    return config
  }
}

/** Where to send the browser, and the checks to keep for the callback. */
export async function oidcStart(config: oidc.Configuration, redirectUri: string): Promise<{ url: string; state: string; nonce: string; verifier: string }> {
  const verifier = oidc.randomPKCECodeVerifier()
  const state = oidc.randomState()
  const nonce = oidc.randomNonce()
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: "openid email profile",
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
    state,
    nonce,
  })
  return { url: url.href, state, nonce, verifier }
}

/** The code exchanged and the ID token checked (signature, issuer, audience, expiry, nonce, state, PKCE). */
export async function oidcFinish(config: oidc.Configuration, callbackUrl: URL, flow: Flow): Promise<Identity> {
  let tokens: Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>
  try {
    tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
      pkceCodeVerifier: flow.verifier!,
      expectedState: flow.state!,
      expectedNonce: flow.nonce!,
      idTokenExpected: true,
    })
  } catch (e) {
    throw new SsoError(`The provider's answer was refused: ${(e as Error).message}`)
  }
  const claims = tokens.claims()
  if (!claims?.sub || !claims.iss) throw new SsoError("The provider's ID token has no subject.")
  const email = typeof claims.email === "string" && claims.email_verified !== false ? claims.email.trim().toLowerCase() : undefined
  return { kind: "oidc", issuer: claims.iss, subject: claims.sub, ...(email ? { email } : {}) }
}

// ------------------------------------------------------------------------------------------------------------- SAML

/** One SAML service per IdP metadata, so the request ids it made are there when the IdP answers. */
export class SamlServices {
  readonly #by = new Map<string, { saml: SAML; meta: IdpMetadata }>()
  readonly #fetched = new Map<string, { at: number; xml: string }>()
  constructor(
    private readonly fetchText: (url: string) => Promise<string>,
    private readonly now: () => number = Date.now,
  ) {}

  async metadata(s: NonNullable<SsoSettings["saml"]>): Promise<string> {
    if (s.metadataXml) return s.metadataXml
    if (!s.metadataUrl) throw new SsoError("No SAML metadata is set.")
    const hit = this.#fetched.get(s.metadataUrl)
    if (hit && this.now() - hit.at < 3_600_000) return hit.xml
    let xml: string
    try {
      xml = await this.fetchText(s.metadataUrl)
    } catch (e) {
      throw new SsoError(`The SAML metadata could not be read from ${s.metadataUrl} (${(e as Error).message}).`)
    }
    if (xml.length > MAX_METADATA) throw new SsoError("The SAML metadata is too large (1 MB at most).")
    this.#fetched.set(s.metadataUrl, { at: this.now(), xml })
    return xml
  }

  async service(s: NonNullable<SsoSettings["saml"]>, sp: { entityId: string; acsUrl: string }): Promise<{ saml: SAML; meta: IdpMetadata }> {
    const xml = await this.metadata(s)
    const key = crypto.createHash("sha256").update(`${xml}\u0000${sp.entityId}\u0000${sp.acsUrl}`).digest("hex")
    const hit = this.#by.get(key)
    if (hit) return hit
    const meta = parseMetadata(xml)
    const saml = new SAML({
      entryPoint: meta.ssoUrl,
      issuer: sp.entityId,
      callbackUrl: sp.acsUrl,
      idpCert: meta.certs,
      idpIssuer: meta.entityId,
      audience: sp.entityId,
      // The assertion itself must be signed; a signed response around an unsigned assertion is not enough.
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: false,
      validateInResponseTo: ValidateInResponseTo.always,
      requestIdExpirationPeriodMs: FLOW_MS,
      rejectReplayedAssertions: true,
      acceptedClockSkewMs: 60_000,
      // Entra ID and others refuse a request that names an authentication context they do not offer.
      disableRequestedAuthnContext: true,
      identifierFormat: null,
      signatureAlgorithm: "sha256",
    })
    const made = { saml, meta }
    this.#by.set(key, made)
    return made
  }
}

const EMAIL_ATTRS = ["email", "mail", "urn:oid:0.9.2342.19200300.100.1.3", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"]

/** The identity in a checked SAML profile: the IdP, the NameID, and an email when it sends one. */
export function samlIdentity(profile: Profile, meta: IdpMetadata): Identity {
  if (!profile.nameID) throw new SsoError("The IdP's assertion names nobody.")
  const raw = EMAIL_ATTRS.map((a) => profile[a]).find((v) => typeof v === "string" || (Array.isArray(v) && typeof v[0] === "string"))
  const email = (Array.isArray(raw) ? String(raw[0]) : (raw as string | undefined))?.trim().toLowerCase()
  const byName = /^[^\s@]+@[^\s@]+$/.test(profile.nameID) && /emailAddress$/.test(profile.nameIDFormat ?? "") ? profile.nameID.toLowerCase() : undefined
  return { kind: "saml", issuer: meta.entityId, subject: profile.nameID, ...(email || byName ? { email: (email || byName)! } : {}) }
}

// ----------------------------------------------------------------------------------------------------- who it is

export interface SsoUser {
  name: string
  email?: string
  role?: Role
  sso?: string[]
}

export type Resolution = { user: string; created?: Role; linked?: boolean } | { refused: string }

/**
 * The CNW user an identity signs in as: by its email or its linked subject, as settings say. Linking adds it to the
 * signed-in user's account. A person with no user is refused, or made one, with the role set, when that is on.
 */
export function resolve(identity: Identity, settings: SsoSettings, users: readonly SsoUser[], link: string | undefined): Resolution {
  const key = identityKey(identity)
  const owner = users.find((u) => u.sso?.includes(key))
  if (link) {
    if (owner && owner.name !== link) return { refused: "That single sign-on identity is linked to another account." }
    return { user: link, linked: !owner }
  }
  if (owner) return { user: owner.name }
  if ((settings.match ?? "email") === "email") {
    if (!identity.email) return { refused: "The provider sent no verified email, which is how this CNW matches people." }
    const byEmail = users.find((u) => u.email === identity.email)
    if (byEmail) return { user: byEmail.name }
  }
  if (!settings.autoCreate) return { refused: "No Neighbourhood Watch account matches you. An owner can invite you, or you can link single sign-on from your account." }
  const name = identity.email ?? identity.subject
  if (users.some((u) => u.name === name || (identity.email && u.email === identity.email))) return { refused: "An account by that name exists and is not linked to this identity." }
  return { user: name, created: settings.autoRole ?? "viewer" }
}

/** The page the SAML POST answers with: it sends this browser on to the finish, a same-site request the Lax cookie goes with. */
export function handOffPage(to: string): string {
  const href = to.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${href}"><title>Signing in</title></head><body><p>Signing in to Neighbourhood Watch. <a href="${href}">Carry on</a>.</p></body></html>`
}
