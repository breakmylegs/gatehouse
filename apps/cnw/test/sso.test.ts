// O52: single sign-on for Neighbourhood Watch. OpenID Connect against a provider started here (discovery, PKCE, state,
// nonce, and the ID token's signature, issuer, audience and expiry), and SAML against an IdP started here (signed
// assertions only, for this service, in answer to its own request, once). The state rides in a Lax cookie for the
// callback; the session stays Strict. Identities match by email or a linked subject; nobody is made unless the owner
// says; an SSO sign-in is not a passkey sign-in and does not count as just signing in for a Severe allow; local
// passwords keep working; the secret is sealed; and every sign-in and refusal is in the audit log. The keys and the
// certificate here are made when the tests run, so nothing secret is kept in this file.
// @peculiar/x509 (which makes the test IdP's certificate) needs reflect-metadata loaded first.
import "reflect-metadata"
import crypto from "node:crypto"
import fs from "node:fs"
import http from "node:http"
import type { AddressInfo } from "node:net"
import os from "node:os"
import path from "node:path"
import zlib from "node:zlib"
import * as x509 from "@peculiar/x509"
import { exportJWK, generateKeyPair, SignJWT } from "jose"
import { SignedXml } from "xml-crypto"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { Sessions } from "../src/auth.js"
import { makeBackup, openBackup } from "../src/backup.js"
import { createCnw } from "../src/server.js"
import { checkSso, parseMetadata, resolve } from "../src/sso.js"

const ORIGIN = "https://cnw.home.arpa"
const CLIENT = "cnw-client"
const SECRET = ["oidc", "client", "secret", "for", "tests"].join("-")

// ------------------------------------------------------------------------------------------- an OpenID provider
type Mode = "ok" | "wrong-key" | "wrong-aud" | "expired" | "wrong-nonce" | "no-email" | "unverified"
let provider: http.Server
let issuer = ""
let mode: Mode = "ok"
let who = { sub: "user-1", email: "ana@example.com" }
const codes = new Map<string, { challenge: string; nonce: string; redirect: string }>()
let signing: CryptoKey
let other: CryptoKey

beforeAll(async () => {
  const kp = await generateKeyPair("RS256")
  signing = kp.privateKey as CryptoKey
  other = (await generateKeyPair("RS256")).privateKey as CryptoKey
  const jwk = { ...(await exportJWK(kp.publicKey)), kid: "k1", alg: "RS256", use: "sig" }
  provider = http.createServer(async (req, res) => {
    const url = new URL(req.url!, issuer)
    const json = (o: unknown, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" })
      res.end(JSON.stringify(o))
    }
    if (url.pathname === "/.well-known/openid-configuration")
      return json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`, response_types_supported: ["code"], subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["RS256"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"] })
    if (url.pathname === "/jwks") return json({ keys: [jwk] })
    if (url.pathname === "/token") {
      let body = ""
      for await (const c of req) body += c
      const p = new URLSearchParams(body)
      // Basic or in the body, whichever the client uses.
      const basic = /^Basic (.+)$/.exec(String(req.headers.authorization ?? ""))?.[1]
      const [id, sec] = basic ? Buffer.from(basic, "base64").toString().split(":").map(decodeURIComponent) : [undefined, undefined]
      const c = codes.get(p.get("code") ?? "")
      const verifier = p.get("code_verifier") ?? ""
      const challenge = crypto.createHash("sha256").update(verifier).digest("base64url")
      if ((id ?? p.get("client_id")) !== CLIENT || (sec ?? p.get("client_secret")) !== SECRET) return json({ error: "invalid_client" }, 401)
      if (!c || c.challenge !== challenge || c.redirect !== p.get("redirect_uri")) return json({ error: "invalid_grant" }, 400)
      codes.delete(p.get("code")!)
      const now = Math.floor(Date.now() / 1000)
      const claims: Record<string, unknown> = { sub: who.sub, nonce: mode === "wrong-nonce" ? "another" : c.nonce }
      if (mode !== "no-email") Object.assign(claims, { email: who.email, email_verified: mode !== "unverified" })
      const token = await new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer(issuer)
        .setAudience(mode === "wrong-aud" ? "someone-else" : CLIENT)
        .setIssuedAt(mode === "expired" ? now - 7200 : now)
        .setExpirationTime(mode === "expired" ? now - 3600 : now + 300)
        .sign(mode === "wrong-key" ? other : signing)
      return json({ access_token: "at", token_type: "Bearer", id_token: token, expires_in: 300 })
    }
    res.writeHead(404).end()
  })
  await new Promise<void>((r) => provider.listen(0, "127.0.0.1", r))
  issuer = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((r) => provider.close(() => r())))

/** The provider's sign-in page: it takes the request CNW sent and answers with a code for it. */
function authorize(location: string, overrides: { state?: string } = {}): string {
  const u = new URL(location)
  expect(u.origin).toBe(issuer)
  expect(u.searchParams.get("code_challenge_method")).toBe("S256")
  expect(u.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/)
  expect(u.searchParams.get("scope")).toContain("openid")
  const code = crypto.randomBytes(12).toString("hex")
  codes.set(code, { challenge: u.searchParams.get("code_challenge")!, nonce: u.searchParams.get("nonce")!, redirect: u.searchParams.get("redirect_uri")! })
  return `/api/sso/oidc/callback?code=${code}&state=${encodeURIComponent(overrides.state ?? u.searchParams.get("state")!)}`
}

// --------------------------------------------------------------------------------------------------- a SAML IdP
const IDP = "https://idp.example.org/saml"
let idpKey = ""
let idpCert = ""
let otherKey = ""
beforeAll(async () => {
  x509.cryptoProvider.set(crypto.webcrypto as unknown as Crypto)
  const alg = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256", publicExponent: new Uint8Array([1, 0, 1]), modulusLength: 2048 }
  const make = async () => {
    const keys = (await crypto.webcrypto.subtle.generateKey(alg, true, ["sign", "verify"])) as CryptoKeyPair
    const cert = await x509.X509CertificateGenerator.createSelfSigned({ serialNumber: "01", name: "CN=Test IdP", notBefore: new Date(Date.now() - 86_400_000), notAfter: new Date(Date.now() + 86_400_000), signingAlgorithm: alg, keys })
    const pkcs8 = Buffer.from(await crypto.webcrypto.subtle.exportKey("pkcs8", keys.privateKey)).toString("base64")
    return { key: `-----BEGIN ${"PRIVATE"} KEY-----\n${pkcs8.match(/.{1,64}/g)!.join("\n")}\n-----END ${"PRIVATE"} KEY-----\n`, cert: cert.toString("base64") }
  }
  const a = await make()
  idpKey = a.key
  idpCert = a.cert
  otherKey = (await make()).key
})

const metadata = () => `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" entityID="${IDP}">
  <md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:KeyDescriptor use="signing"><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${idpCert}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example.org/sso"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>`

/** The IdP's answer to the request in the redirect: an assertion, signed unless told otherwise. */
function samlResponse(location: string, o: { sign?: "idp" | "other" | "none"; audience?: string; email?: string } = {}): { SAMLResponse: string; RelayState: string } {
  const u = new URL(location)
  const request = zlib.inflateRawSync(Buffer.from(u.searchParams.get("SAMLRequest")!, "base64")).toString()
  const requestId = /ID="([^"]+)"/.exec(request)![1]!
  const now = new Date()
  const later = new Date(now.getTime() + 5 * 60_000).toISOString()
  const id = `_a${crypto.randomBytes(8).toString("hex")}`
  const acs = `${ORIGIN}/api/sso/saml/acs`
  const audience = o.audience ?? `${ORIGIN}/api/sso/saml/metadata`
  const assertion = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" Version="2.0" IssueInstant="${now.toISOString()}"><saml:Issuer>${IDP}</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified">ana-at-idp</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="${requestId}" Recipient="${acs}" NotOnOrAfter="${later}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${new Date(now.getTime() - 60_000).toISOString()}" NotOnOrAfter="${later}"><saml:AudienceRestriction><saml:Audience>${audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${now.toISOString()}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:Password</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement><saml:AttributeStatement><saml:Attribute Name="email"><saml:AttributeValue>${o.email ?? "ana@example.com"}</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion>`
  let signed = assertion
  if ((o.sign ?? "idp") !== "none") {
    const sig = new SignedXml({ privateKey: o.sign === "other" ? otherKey : idpKey, canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#", signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256" })
    sig.addReference({ xpath: "//*[local-name(.)='Assertion']", digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256", transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/2001/10/xml-exc-c14n#"] })
    sig.computeSignature(assertion, { location: { reference: "//*[local-name(.)='Issuer']", action: "after" } })
    signed = sig.getSignedXml()
  }
  const response = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r${crypto.randomBytes(8).toString("hex")}" Version="2.0" IssueInstant="${now.toISOString()}" Destination="${acs}" InResponseTo="${requestId}"><saml:Issuer>${IDP}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>${signed}</samlp:Response>`
  return { SAMLResponse: Buffer.from(response).toString("base64"), RelayState: u.searchParams.get("RelayState")! }
}

// ---------------------------------------------------------------------------------------------------------- CNW
let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cnw-sso-"))
  mode = "ok"
  who = { sub: "user-1", email: "ana@example.com" }
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

const cookie = (r: { headers: Record<string, unknown> }, name: string): string | undefined => {
  const all = ([] as string[]).concat((r.headers["set-cookie"] as string | string[] | undefined) ?? [])
  return all.find((c) => c.startsWith(`${name}=`))
}
const value = (c: string | undefined) => c?.split(";")[0]

/** CNW with its first account (ana, an owner, with a password), signed in, and single sign-on set as asked. */
async function cnw(sso: Record<string, unknown> = {}) {
  const lines: string[] = []
  const { app } = await createCnw({ dataDir: dir, publicUrl: ORIGIN, log: (l) => void lines.push(l), webDir: path.join(dir, "none"), ssoAllowHttp: true, fetchText: async () => metadata() })
  const code = /shown once\): (\S+)/.exec(lines.join("\n"))![1]
  const setup = await app.inject({ method: "POST", url: "/api/setup", payload: { code, email: "ana@example.com", password: "a long password here" } })
  const owner = { cookie: value(cookie(setup, "cnw_session"))!, csrf: (setup.json() as { csrf: string }).csrf }
  const put = await app.inject({
    method: "PUT",
    url: "/api/server/sso",
    headers: { origin: ORIGIN, cookie: owner.cookie, "x-csrf-token": owner.csrf },
    payload: { oidc: { issuer, clientId: CLIENT, clientSecret: SECRET, label: "Authentik" }, saml: { metadataXml: metadata(), label: "Keycloak" }, ...sso },
  })
  expect(put.statusCode, put.body).toBe(200)
  const audit = () => (JSON.parse(fs.readFileSync(path.join(dir, "audit.json"), "utf8")) as { entries: Array<{ user: string; action: string; detail: string }> }).entries
  return { app, owner, lines, audit }
}

/** Starts an OpenID Connect sign-in and comes back from the provider with its code. */
async function oidcRound(app: Awaited<ReturnType<typeof cnw>>["app"], o: { cookie?: string; link?: boolean; state?: string } = {}) {
  const start = await app.inject({ method: "GET", url: `/api/sso/oidc/start${o.link ? "?link=1" : ""}`, headers: o.cookie ? { cookie: o.cookie } : {} })
  expect(start.statusCode, start.body).toBe(303)
  const lax = cookie(start, "cnw_sso")!
  const callback = authorize(start.headers.location as string, o.state ? { state: o.state } : {})
  const back = await app.inject({ method: "GET", url: callback, headers: { cookie: [value(lax), o.cookie].filter(Boolean).join("; ") } })
  return { start, lax, back, callback }
}

describe("OpenID Connect sign-in (O52)", () => {
  it("signs a matched person in: PKCE, state and nonce; the state in a Lax cookie for the callback only; the session Strict", async () => {
    const { app, audit, lines } = await cnw()
    const { lax, back } = await oidcRound(app)
    expect(lax).toMatch(/^cnw_sso=[\w-]+; Path=\/api\/sso; HttpOnly; Secure; SameSite=Lax; Max-Age=600$/)
    expect(back.statusCode).toBe(303)
    expect(back.headers.location).toBe("/")
    const session = cookie(back, "cnw_session")!
    expect(session).toMatch(/HttpOnly; Secure; SameSite=Strict/)
    expect(cookie(back, "cnw_sso")).toMatch(/Max-Age=0/)
    const me = (await app.inject({ method: "GET", url: "/api/me", headers: { cookie: value(session)! } })).json() as { user: string; passkey: boolean; severeReady: boolean }
    // Not a passkey sign-in, and not as having just signed in: a Severe allow asks for the password or a passkey again.
    expect(me).toMatchObject({ user: "ana@example.com", passkey: false, severeReady: false })
    const password = await app.inject({ method: "POST", url: "/api/login", payload: { login: "ana@example.com", password: "a long password here" } })
    expect(((await app.inject({ method: "GET", url: "/api/me", headers: { cookie: value(cookie(password, "cnw_session"))! } })).json() as { severeReady: boolean }).severeReady).toBe(true)
    const again = await app.inject({ method: "POST", url: "/api/reauth", headers: { origin: ORIGIN, cookie: value(session)!, "x-csrf-token": (me as unknown as { csrf: string }).csrf }, payload: { password: "a long password here" } })
    expect(again.statusCode).toBe(200)
    expect(((await app.inject({ method: "GET", url: "/api/me", headers: { cookie: value(session)! } })).json() as { severeReady: boolean }).severeReady).toBe(true)
    expect(audit().at(-1)).toMatchObject({ user: "ana@example.com", action: "sso-sign-in", detail: `oidc ${issuer}` })
    expect(lines.some((l) => /Signed in with single sign-on: ana@example.com \(oidc\)/.test(l))).toBe(true)
  })

  it("refuses an ID token signed with another key, for another audience, expired, or with the wrong nonce", async () => {
    for (const m of ["wrong-key", "wrong-aud", "expired", "wrong-nonce"] as const) {
      mode = m
      const { app, audit } = await cnw()
      const { back } = await oidcRound(app)
      expect(back.headers.location, m).toMatch(/^\/\?sso_error=/)
      expect(cookie(back, "cnw_session"), m).toBeUndefined()
      expect(audit().at(-1), m).toMatchObject({ action: "sso-failed" })
      await app.close()
      fs.rmSync(dir, { recursive: true, force: true })
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "cnw-sso-"))
    }
  })

  it("refuses a callback without its Lax cookie, with another state, or used twice", async () => {
    const { app } = await cnw()
    const start = await app.inject({ method: "GET", url: "/api/sso/oidc/start" })
    const noCookie = await app.inject({ method: "GET", url: authorize(start.headers.location as string) })
    expect(noCookie.headers.location).toMatch(/sso_error=.*not%20started%20here/)
    const wrongState = await oidcRound(app, { state: "forged" })
    expect(wrongState.back.headers.location).toMatch(/^\/\?sso_error=/)
    const ok = await oidcRound(app)
    expect(cookie(ok.back, "cnw_session")).toBeDefined()
    // The same callback again: the flow was used.
    const again = await app.inject({ method: "GET", url: ok.callback, headers: { cookie: value(ok.lax)! } })
    expect(again.headers.location).toMatch(/^\/\?sso_error=/)
    // Even with a fresh, good code from the provider for the same flow: CNW used the flow up, not only the provider its code.
    const fresh = await app.inject({ method: "GET", url: authorize(ok.start.headers.location as string), headers: { cookie: value(ok.lax)! } })
    expect(fresh.headers.location).toMatch(/sso_error=.*not%20started%20here/)
    expect(cookie(fresh, "cnw_session")).toBeUndefined()
  })

  it("matches no one without a verified email, and makes nobody unless the owner switched that on, never an owner", async () => {
    who = { sub: "user-2", email: "bo@example.com" }
    const off = await cnw()
    expect((await oidcRound(off.app)).back.headers.location).toMatch(/sso_error=No%20Neighbourhood%20Watch%20account%20matches/)
    expect((JSON.parse(fs.readFileSync(path.join(dir, "users.json"), "utf8")) as { users: unknown[] }).users).toHaveLength(1)
    mode = "unverified"
    who = { sub: "user-1", email: "ana@example.com" }
    expect((await oidcRound(off.app)).back.headers.location).toMatch(/sso_error=The%20provider%20sent%20no%20verified%20email/)
    await off.app.close()
    fs.rmSync(dir, { recursive: true, force: true })
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cnw-sso-"))
    mode = "ok"
    who = { sub: "user-2", email: "bo@example.com" }
    const on = await cnw({ autoCreate: true, autoRole: "approver" })
    expect(cookie((await oidcRound(on.app)).back, "cnw_session")).toBeDefined()
    const made = (JSON.parse(fs.readFileSync(path.join(dir, "users.json"), "utf8")) as { users: Array<{ name: string; role?: string; sso?: string[] }> }).users.find((u) => u.name === "bo@example.com")!
    expect(made).toMatchObject({ role: "approver", sso: [`oidc:${issuer}|user-2`] })
    expect(on.audit().map((e) => e.action)).toContain("sso-user-made")
    expect(checkSso({ autoCreate: true, autoRole: "owner" })).toMatchObject({ error: expect.stringMatching(/never makes an owner/) })
  })

  it("matches by subject once linked from the account, and keeps the password working beside it", async () => {
    who = { sub: "the-sub", email: "someone-else@example.com" }
    const { app, owner } = await cnw({ match: "sub" })
    // Not linked yet: refused.
    expect((await oidcRound(app)).back.headers.location).toMatch(/^\/\?sso_error=/)
    // Linking needs the account signed in.
    expect((await app.inject({ method: "GET", url: "/api/sso/oidc/start?link=1" })).statusCode).toBe(401)
    const linked = await oidcRound(app, { cookie: owner.cookie, link: true })
    expect(linked.back.headers.location).toBe("/?sso=linked#you")
    const signIn = await oidcRound(app)
    expect(cookie(signIn.back, "cnw_session")).toBeDefined()
    expect(((await app.inject({ method: "GET", url: "/api/me", headers: { cookie: value(cookie(signIn.back, "cnw_session"))! } })).json() as { user: string }).user).toBe("ana@example.com")
    const password = await app.inject({ method: "POST", url: "/api/login", payload: { login: "ana@example.com", password: "a long password here" } })
    expect(password.statusCode).toBe(200)
  })

  it("keeps the client secret sealed and never sends it back, and its settings in the backup", async () => {
    const { app, owner } = await cnw()
    expect(fs.readFileSync(path.join(dir, "sso.json"), "utf8")).not.toContain(SECRET)
    // A backup holds the settings (and seal.key, so the sealed secret still opens after a restore).
    const files = openBackup(makeBackup(dir, "a backup passphrase"), "a backup passphrase").files
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["sso.json", "seal.key"]))
    expect(JSON.parse(files["sso.json"]!)).toMatchObject({ oidc: { issuer, clientId: CLIENT } })
    const view = await app.inject({ method: "GET", url: "/api/server/sso", headers: { cookie: owner.cookie } })
    expect(view.body).not.toContain(SECRET)
    expect(view.json()).toMatchObject({ oidc: { issuer, clientId: CLIENT, secretSet: true }, oidcRedirect: `${ORIGIN}/api/sso/oidc/callback`, samlAcs: `${ORIGIN}/api/sso/saml/acs` })
    expect(((await app.inject({ method: "GET", url: "/api/me" })).json() as { sso: unknown }).sso).toEqual({ oidc: "Authentik", saml: "Keycloak" })
  })
})

describe("an SSO sign-in is not a passkey sign-in (O52)", () => {
  it("starts as not having just signed in, so a Severe allow asks again", () => {
    let now = 1_000_000
    const s = new Sessions(() => now)
    const sso = s.start("ana", false, {}, { confirmed: false })
    const local = s.start("ana", false)
    expect(s.get(sso.id)).toMatchObject({ passkey: false, confirmed: 0 })
    expect(s.get(local.id)).toMatchObject({ confirmed: now })
    now += 1000
    s.confirm(sso.id)
    expect(s.get(sso.id)!.confirmed).toBe(now)
  })
})

describe("SAML sign-in (O52)", () => {
  async function samlRound(app: Awaited<ReturnType<typeof cnw>>["app"], o: Parameters<typeof samlResponse>[1] = {}) {
    const start = await app.inject({ method: "GET", url: "/api/sso/saml/start" })
    expect(start.statusCode, start.body).toBe(303)
    expect(start.headers.location).toMatch(/^https:\/\/idp\.example\.org\/sso\?SAMLRequest=/)
    const lax = cookie(start, "cnw_sso")!
    // The IdP's POST, from its own origin, with no cookie (a cross-site POST carries none).
    const payload = new URLSearchParams(samlResponse(start.headers.location as string, o)).toString()
    const acs = await app.inject({ method: "POST", url: "/api/sso/saml/acs", headers: { origin: "https://idp.example.org", "content-type": "application/x-www-form-urlencoded" }, payload })
    return { start, lax, acs, payload }
  }

  it("checks the signed assertion at the IdP's POST, then signs in on this browser's own request", async () => {
    const { app, audit } = await cnw()
    const { lax, acs } = await samlRound(app)
    expect(acs.statusCode, acs.body).toBe(200)
    expect(cookie(acs, "cnw_session")).toBeUndefined()
    const to = /url=([^"]+)"/.exec(acs.body)![1]!.replace(/&#38;/g, "&")
    expect(to).toMatch(/^\/api\/sso\/saml\/finish\?flow=/)
    // Another browser, without the cookie, gets nothing.
    expect((await app.inject({ method: "GET", url: to })).headers.location).toMatch(/sso_error=/)
    const finish = await app.inject({ method: "GET", url: to, headers: { cookie: value(lax)! } })
    // The first try above used nothing up: the flow waits for its own browser.
    expect(finish.headers.location, finish.body).toBe("/")
    expect(cookie(finish, "cnw_session")).toMatch(/SameSite=Strict/)
    expect(audit().at(-1)).toMatchObject({ action: "sso-sign-in", detail: `saml ${IDP}` })
  })

  it("refuses an unsigned assertion, one signed by another key, one for another audience, and a replay", async () => {
    const { app, audit } = await cnw()
    for (const o of [{ sign: "none" as const }, { sign: "other" as const }, { audience: "https://elsewhere.example/sp" }]) {
      const { acs } = await samlRound(app, o)
      expect(acs.statusCode, JSON.stringify(o)).toBe(303)
      expect(acs.headers.location, JSON.stringify(o)).toMatch(/^\/\?sso_error=/)
      expect(audit().at(-1)?.action).toBe("sso-failed")
    }
    // The same signed answer posted again: its flow has its identity already, and its request id was used.
    const { acs, payload } = await samlRound(app)
    expect(acs.statusCode).toBe(200)
    const replay = await app.inject({ method: "POST", url: "/api/sso/saml/acs", headers: { origin: "https://idp.example.org", "content-type": "application/x-www-form-urlencoded" }, payload })
    expect(replay.headers.location).toMatch(/^\/\?sso_error=/)
    // The same assertion carried into a new sign-in: its request id was not this one's, and it was seen before.
    const fresh = await app.inject({ method: "GET", url: "/api/sso/saml/start" })
    const relay = new URL(fresh.headers.location as string).searchParams.get("RelayState")!
    const carried = new URLSearchParams(payload)
    carried.set("RelayState", relay)
    const moved = await app.inject({ method: "POST", url: "/api/sso/saml/acs", headers: { origin: "https://idp.example.org", "content-type": "application/x-www-form-urlencoded" }, payload: carried.toString() })
    expect(moved.headers.location).toMatch(/^\/\?sso_error=/)
    expect(audit().at(-1)?.action).toBe("sso-failed")
  })

  it("reads the IdP's metadata for its name, address and certificates, and refuses a DOCTYPE or no certificate", () => {
    expect(parseMetadata(metadata())).toMatchObject({ entityId: IDP, ssoUrl: "https://idp.example.org/sso", certs: [idpCert] })
    expect(() => parseMetadata(`<!DOCTYPE x [<!ENTITY e "x">]>${metadata()}`)).toThrow(/DOCTYPE/)
    expect(() => parseMetadata(metadata().replace(/<md:KeyDescriptor[\s\S]*?<\/md:KeyDescriptor>/, ""))).toThrow(/no signing certificate/)
  })
})

describe("who an identity is (O52)", () => {
  const users = [{ name: "ana", email: "ana@example.com", sso: ["saml:https://idp|ana-at-idp"] }, { name: "cy", email: "cy@example.com" }]
  it("finds a linked identity, then an email, and refuses a link already on another account", () => {
    expect(resolve({ kind: "saml", issuer: "https://idp", subject: "ana-at-idp" }, { match: "sub" }, users, undefined)).toEqual({ user: "ana" })
    expect(resolve({ kind: "oidc", issuer: "i", subject: "s", email: "cy@example.com" }, { match: "email" }, users, undefined)).toEqual({ user: "cy" })
    expect(resolve({ kind: "oidc", issuer: "i", subject: "s", email: "cy@example.com" }, { match: "sub" }, users, undefined)).toMatchObject({ refused: expect.any(String) })
    expect(resolve({ kind: "saml", issuer: "https://idp", subject: "ana-at-idp" }, {}, users, "cy")).toMatchObject({ refused: expect.stringMatching(/another account/) })
  })
})
