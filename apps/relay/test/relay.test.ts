import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { verifyRegistrationResponse } from "@simplewebauthn/server"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { generateKeyPair, exportPublicKey, sealJson } from "@gatehouse/shared/e2e"
import { FakeAuthenticator } from "../../../packages/shared/test/support/fake-authenticator.js"
import { Store } from "../src/db.js"
import type { PushMessage, PushSender } from "../src/push.js"
import { buildRelay, trustProxy, type Relay } from "../src/server.js"

const PUBLIC = "https://gh.example.test"
const RP = "gh.example.test"

let root: string
let relay: Relay
let store: Store
let base: string
let clock = Date.now()
const pushes: Array<{ sub: string; msg: PushMessage; urgent: boolean }> = []
const sender: PushSender = {
  publicKey: () => "BPUBLIC",
  send: async (sub, msg, urgent) => {
    pushes.push({ sub, msg, urgent })
    return sub.includes("gone") ? "gone" : "ok"
  },
}

async function call(method: string, url: string, body?: unknown, bearer?: string, ip?: string) {
  const res = await fetch(base + url, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...(ip ? { "x-forwarded-for": ip } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  let json: unknown
  try {
    json = text ? JSON.parse(text) : undefined
  } catch {
    json = text
  }
  return { status: res.status, json: json as Record<string, any> & any[] }
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-relay-"))
  store = new Store(root)
  relay = await buildRelay({
    publicUrl: PUBLIC,
    store,
    push: sender,
    now: () => clock,
    enrolFile: path.join(root, "enrol.txt"),
    anonymousLimit: 1000,
  })
  await relay.app.listen({ host: "127.0.0.1", port: 0 })
  base = `http://127.0.0.1:${(relay.app.server.address() as { port: number }).port}`
})
afterAll(async () => {
  await relay.close()
  store.close()
  fs.rmSync(root, { recursive: true, force: true })
})

async function enrol(name = "laptop") {
  const tokenValue = fs.readFileSync(path.join(root, "enrol.txt"), "utf8").trim()
  const r = await call("POST", "/api/device/enroll", { enrolToken: tokenValue, name })
  return { r, tokenValue }
}

async function pair(device: string, withPush = true) {
  const auth = await FakeAuthenticator.create()
  const phoneKeys = await generateKeyPair(false)
  const code = "ABCDEFGH"
    .split("")
    .sort(() => Math.random() - 0.5)
    .join("")
  const challenge = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
  const created = await call(
    "POST",
    "/api/device/pairings",
    { code, challenge, hostPublicKey: "AAAA" },
    device,
  )
  expect(created.status).toBe(200)
  const info = await call("GET", `/api/phone/pairing-info?code=${code}`)
  expect(info.status).toBe(200)
  const registration = auth.register({
    challenge: info.json.challenge,
    rpId: info.json.rpId,
    origin: info.json.origin,
  })
  const reg = await call("POST", `/api/phone/pairings/${info.json.pairingId}/register`, {
    code,
    phoneName: "Test iPhone",
    ecdhPublicKey: await exportPublicKey(phoneKeys.publicKey),
    registration,
    ...(withPush
      ? {
          pushSubscription: {
            endpoint: "https://push.example.test/abc",
            keys: { p256dh: "BBBB", auth: "CCCC" },
          },
        }
      : {}),
  })
  expect(reg.status).toBe(200)
  const status = await call("GET", `/api/device/pairings/${created.json.id}`, undefined, device)
  // The Host verifies the attestation itself, then pins the passkey.
  const verified = await verifyRegistrationResponse({
    response: status.json.registration.registration,
    expectedChallenge: challenge,
    expectedOrigin: PUBLIC,
    expectedRPID: RP,
    requireUserVerification: true,
  })
  expect(verified.verified).toBe(true)
  const info2 = verified.registrationInfo!
  const confirm = await call(
    "POST",
    `/api/device/pairings/${created.json.id}/confirm`,
    {
      credentialId: info2.credential.id,
      credentialPublicKey: Buffer.from(info2.credential.publicKey).toString("base64url"),
      counter: info2.credential.counter,
    },
    device,
  )
  expect(confirm.status).toBe(200)
  return {
    auth,
    phoneKeys,
    phoneId: confirm.json.phoneId as string,
    code,
    pairingId: created.json.id as string,
  }
}

async function login(phoneId: string, auth: FakeAuthenticator) {
  const ch = await call("POST", "/api/phone/session/challenge", { phoneId })
  expect(ch.status).toBe(200)
  const assertion = await auth.assert({ challenge: ch.json.challenge, rpId: RP, origin: PUBLIC })
  return call("POST", "/api/phone/session", { phoneId, assertion })
}

describe("enrolment", () => {
  it("makes a device token from the one-time enrolment token, and refuses it a second time", async () => {
    const { r, tokenValue } = await enrol()
    expect(r.status).toBe(200)
    expect(r.json.token.length).toBeGreaterThan(30)
    const again = await call("POST", "/api/device/enroll", { enrolToken: tokenValue, name: "x" })
    expect(again.status).toBe(401)
    const fresh = fs.readFileSync(path.join(root, "enrol.txt"), "utf8").trim()
    expect(fresh).not.toBe(tokenValue)
  })

  it("refuses a wrong token, a malformed body, and every device call without a bearer token", async () => {
    expect(
      (await call("POST", "/api/device/enroll", { enrolToken: "x".repeat(20), name: "n" })).status,
    ).toBe(401)
    expect((await call("POST", "/api/device/enroll", { nope: 1 })).status).toBe(400)
    for (const [m, u] of [
      ["GET", "/api/device/phones"],
      ["POST", "/api/device/requests"],
      ["GET", "/api/device/decisions"],
      ["POST", "/api/device/pairings"],
      ["POST", "/api/device/notify"],
    ] as const) {
      expect((await call(m, u, m === "POST" ? {} : undefined)).status).toBe(401)
      expect((await call(m, u, m === "POST" ? {} : undefined, "wrong-token")).status).toBe(401)
    }
  })

  it("does not keep the device token itself, only its hash", async () => {
    const { r } = await enrol("hash check")
    const rows = store.db.prepare("select token_hash from devices").all() as Array<{
      token_hash: string
    }>
    expect(rows.some((x) => x.token_hash === r.json.token)).toBe(false)
    expect(rows.every((x) => /^[0-9a-f]{64}$/.test(x.token_hash))).toBe(true)
  })
})

describe("pairing", () => {
  it("runs the whole flow, with the Host verifying the attestation and pinning the passkey", async () => {
    const { r } = await enrol()
    const p = await pair(r.json.token)
    const phones = await call("GET", "/api/device/phones", undefined, r.json.token)
    expect(phones.json).toEqual([{ id: p.phoneId, name: "Test iPhone", push: true }])
    const status = await call("GET", `/api/phone/pairings/${p.pairingId}/status?code=${p.code}`)
    expect(status.json).toMatchObject({ status: "confirmed", phoneId: p.phoneId })
  })

  it("hides a pairing from anyone without the code, and lets it be used once", async () => {
    const { r } = await enrol()
    const auth = await FakeAuthenticator.create()
    const code = "ZZZZZZZZ"
    const created = await call(
      "POST",
      "/api/device/pairings",
      { code, challenge: "c".repeat(24), hostPublicKey: "AAAA" },
      r.json.token,
    )
    expect((await call("GET", "/api/phone/pairing-info?code=YYYYYYYY")).status).toBe(404)
    expect((await call("GET", "/api/phone/pairing-info?code=short")).status).toBe(404)
    const body = {
      phoneName: "p",
      ecdhPublicKey: "AAAA",
      registration: auth.register({ challenge: "c".repeat(24), rpId: RP, origin: PUBLIC }),
    }
    expect(
      (
        await call("POST", `/api/phone/pairings/${created.json.id}/register`, {
          ...body,
          code: "AAAAAAAA",
        })
      ).status,
    ).toBe(404)
    expect(
      (await call("POST", `/api/phone/pairings/${created.json.id}/register`, { ...body, code }))
        .status,
    ).toBe(200)
    expect(
      (await call("POST", `/api/phone/pairings/${created.json.id}/register`, { ...body, code }))
        .status,
    ).toBe(409)
    expect((await call("GET", `/api/phone/pairing-info?code=${code}`)).status).toBe(404)
  })

  it("expires after five minutes", async () => {
    const { r } = await enrol()
    const code = "KKKKKKKK"
    const created = await call(
      "POST",
      "/api/device/pairings",
      { code, challenge: "c".repeat(24), hostPublicKey: "AAAA" },
      r.json.token,
    )
    expect((await call("GET", `/api/phone/pairing-info?code=${code}`)).status).toBe(200)
    clock += 5 * 60_000 + 1
    expect((await call("GET", `/api/phone/pairing-info?code=${code}`)).status).toBe(404)
    expect(
      (await call("GET", `/api/device/pairings/${created.json.id}`, undefined, r.json.token)).json
        .status,
    ).toBe("expired")
    clock -= 5 * 60_000 + 1
  })

  it("refuses to confirm a pairing that nobody registered, or one that belongs to another device", async () => {
    const a = await enrol("a")
    const b = await enrol("b")
    const created = await call(
      "POST",
      "/api/device/pairings",
      { code: "MMMMMMMM", challenge: "c".repeat(24), hostPublicKey: "AAAA" },
      a.r.json.token,
    )
    const body = { credentialId: "abc", credentialPublicKey: "abc", counter: 0 }
    expect(
      (await call("POST", `/api/device/pairings/${created.json.id}/confirm`, body, a.r.json.token))
        .status,
    ).toBe(409)
    expect(
      (await call("POST", `/api/device/pairings/${created.json.id}/confirm`, body, b.r.json.token))
        .status,
    ).toBe(404)
  })
})

describe("phone login with a passkey", () => {
  it("gives a session for a valid assertion and refuses a replay of the same challenge", async () => {
    const { r } = await enrol()
    const p = await pair(r.json.token)
    const ch = await call("POST", "/api/phone/session/challenge", { phoneId: p.phoneId })
    expect(ch.json.rpId).toBe(RP)
    expect(ch.json.userVerification).toBe("required")
    const assertion = await p.auth.assert({
      challenge: ch.json.challenge,
      rpId: RP,
      origin: PUBLIC,
    })
    const ok = await call("POST", "/api/phone/session", { phoneId: p.phoneId, assertion })
    expect(ok.status).toBe(200)
    expect((await call("GET", "/api/phone/pending", undefined, ok.json.token)).status).toBe(200)
    const replay = await call("POST", "/api/phone/session", { phoneId: p.phoneId, assertion })
    expect(replay.status).toBe(401)
  })

  it("refuses a wrong origin, a wrong RP id, no user verification, another passkey and an expired challenge", async () => {
    const { r } = await enrol()
    const p = await pair(r.json.token)
    const run = async (opts: {
      origin?: string
      rpId?: string
      who?: FakeAuthenticator
      uv?: boolean
      late?: boolean
    }) => {
      const ch = await call("POST", "/api/phone/session/challenge", { phoneId: p.phoneId })
      const who = opts.who ?? p.auth
      who.userVerified = opts.uv ?? true
      const assertion = await who.assert({
        challenge: ch.json.challenge,
        rpId: opts.rpId ?? RP,
        origin: opts.origin ?? PUBLIC,
      })
      who.userVerified = true
      if (opts.late) clock += 2 * 60_000 + 1
      const res = await call("POST", "/api/phone/session", { phoneId: p.phoneId, assertion })
      if (opts.late) clock -= 2 * 60_000 + 1
      return res.status
    }
    expect(await run({ origin: "https://evil.example.test" })).toBe(401)
    expect(await run({ rpId: "evil.example.test" })).toBe(401)
    expect(await run({ uv: false })).toBe(401)
    expect(await run({ who: await FakeAuthenticator.create() })).toBe(401)
    expect(await run({ late: true })).toBe(401)
    expect(await run({})).toBe(200)
  })

  it("accepts a signature counter of zero, as synced passkeys send", async () => {
    const { r } = await enrol()
    const p = await pair(r.json.token)
    const ch = await call("POST", "/api/phone/session/challenge", { phoneId: p.phoneId })
    const assertion = await p.auth.assert({
      challenge: ch.json.challenge,
      rpId: RP,
      origin: PUBLIC,
      counter: 0,
    })
    expect(
      (await call("POST", "/api/phone/session", { phoneId: p.phoneId, assertion })).status,
    ).toBe(200)
  })

  it("refuses phone calls without a session, with a made-up one, or after it has expired", async () => {
    const { r } = await enrol()
    const p = await pair(r.json.token)
    expect((await call("GET", "/api/phone/pending")).status).toBe(401)
    expect((await call("GET", "/api/phone/pending", undefined, "made-up")).status).toBe(401)
    const s = await login(p.phoneId, p.auth)
    expect((await call("GET", "/api/phone/pending", undefined, s.json.token)).status).toBe(200)
    clock += 15 * 60_000 + 1
    expect((await call("GET", "/api/phone/pending", undefined, s.json.token)).status).toBe(401)
    clock -= 15 * 60_000 + 1
  })
})

describe("requests, decisions and revocation", () => {
  it("carries a sealed request to the phone with only a generic push, and a sealed decision back", async () => {
    const { r } = await enrol()
    const dev = r.json.token
    const p = await pair(dev)
    const sealed = await sealJson(
      { command: "rm -rf secret-client-folder" },
      p.phoneKeys.publicKey,
      "req-1",
    )
    pushes.length = 0
    const put = await call(
      "POST",
      "/api/device/requests",
      {
        id: "req-1",
        phoneId: p.phoneId,
        sealed,
        expiresAt: new Date(clock + 600_000).toISOString(),
        priority: "high",
      },
      dev,
    )
    expect(put.status).toBe(200)
    await new Promise((res) => setTimeout(res, 20))
    expect(pushes).toHaveLength(1)
    expect(pushes[0]).toMatchObject({ msg: { t: "request", id: "req-1" }, urgent: true })
    expect(JSON.stringify(pushes[0])).not.toContain("secret-client-folder")
    const session = await login(p.phoneId, p.auth)
    const pending = await call("GET", "/api/phone/pending", undefined, session.json.token)
    expect(pending.json.map((x: { id: string }) => x.id)).toEqual(["req-1"])
    expect(JSON.stringify(store.db.prepare("select * from requests").all())).not.toContain(
      "secret-client-folder",
    )
    const answer = await sealJson({ any: "thing" }, p.phoneKeys.publicKey, "req-1")
    const waiting = call("GET", "/api/device/decisions?wait=5", undefined, dev)
    await new Promise((res) => setTimeout(res, 100))
    expect(
      (
        await call(
          "POST",
          "/api/phone/envelopes",
          { requestId: "req-1", sealed: answer },
          session.json.token,
        )
      ).status,
    ).toBe(200)
    const got = await waiting
    expect(got.json).toHaveLength(1)
    expect(got.json[0]).toMatchObject({ phoneId: p.phoneId, requestId: "req-1" })
    await call("DELETE", `/api/device/decisions/${got.json[0].id}`, undefined, dev)
    expect((await call("GET", "/api/device/decisions", undefined, dev)).json).toEqual([])
  })

  it("long-polls and returns an empty list when nothing arrives", async () => {
    const { r } = await enrol()
    const t0 = Date.now()
    const res = await call("GET", "/api/device/decisions?wait=1", undefined, r.json.token)
    expect(res.json).toEqual([])
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900)
  })

  it("marks a request resolved so the phone shows the outcome, and lets nobody else touch it", async () => {
    const a = await enrol("a")
    const b = await enrol("b")
    const p = await pair(a.r.json.token)
    const sealed = await sealJson({ x: 1 }, p.phoneKeys.publicKey, "req-2")
    await call(
      "POST",
      "/api/device/requests",
      {
        id: "req-2",
        phoneId: p.phoneId,
        sealed,
        expiresAt: new Date(clock + 600_000).toISOString(),
      },
      a.r.json.token,
    )
    expect(
      (
        await call(
          "POST",
          "/api/device/requests/req-2/resolved",
          { summary: "Denied on desktop at 14:02" },
          b.r.json.token,
        )
      ).status,
    ).toBe(404)
    expect(
      (
        await call(
          "POST",
          "/api/device/requests/req-2/resolved",
          { summary: "Denied on desktop at 14:02" },
          a.r.json.token,
        )
      ).status,
    ).toBe(200)
    const s = await login(p.phoneId, p.auth)
    const pending = await call("GET", "/api/phone/pending", undefined, s.json.token)
    expect(pending.json[0]).toMatchObject({ id: "req-2", summary: "Denied on desktop at 14:02" })
    expect(
      (
        await call(
          "POST",
          "/api/device/requests",
          {
            id: "req-2",
            phoneId: p.phoneId,
            sealed,
            expiresAt: new Date(clock + 600_000).toISOString(),
          },
          b.r.json.token,
        )
      ).status,
    ).toBe(404)
  })

  it("will not send a request to a phone that belongs to another device, or one already expired", async () => {
    const a = await enrol("a")
    const b = await enrol("b")
    const p = await pair(a.r.json.token)
    const sealed = await sealJson({ x: 1 }, p.phoneKeys.publicKey, "r3")
    expect(
      (
        await call(
          "POST",
          "/api/device/requests",
          {
            id: "r3",
            phoneId: p.phoneId,
            sealed,
            expiresAt: new Date(clock + 600_000).toISOString(),
          },
          b.r.json.token,
        )
      ).status,
    ).toBe(404)
    expect(
      (
        await call(
          "POST",
          "/api/device/requests",
          { id: "r3", phoneId: p.phoneId, sealed, expiresAt: new Date(clock - 1000).toISOString() },
          a.r.json.token,
        )
      ).status,
    ).toBe(400)
  })

  it("keeps a phone from reading or answering another phone's request", async () => {
    const { r } = await enrol()
    const p1 = await pair(r.json.token)
    const p2 = await pair(r.json.token)
    const sealed = await sealJson({ x: 1 }, p1.phoneKeys.publicKey, "r4")
    await call(
      "POST",
      "/api/device/requests",
      { id: "r4", phoneId: p1.phoneId, sealed, expiresAt: new Date(clock + 600_000).toISOString() },
      r.json.token,
    )
    const s2 = await login(p2.phoneId, p2.auth)
    expect((await call("GET", "/api/phone/requests/r4", undefined, s2.json.token)).status).toBe(404)
    expect(
      (await call("POST", "/api/phone/envelopes", { requestId: "r4", sealed }, s2.json.token))
        .status,
    ).toBe(404)
    expect((await call("GET", "/api/phone/pending", undefined, s2.json.token)).json).toEqual([])
  })

  it("revokes at once: the session, the pending requests and the phone are gone", async () => {
    const { r } = await enrol()
    const p = await pair(r.json.token)
    const sealed = await sealJson({ x: 1 }, p.phoneKeys.publicKey, "r5")
    await call(
      "POST",
      "/api/device/requests",
      { id: "r5", phoneId: p.phoneId, sealed, expiresAt: new Date(clock + 600_000).toISOString() },
      r.json.token,
    )
    const s = await login(p.phoneId, p.auth)
    expect(
      (await call("PUT", `/api/device/phones/${p.phoneId}`, { name: "Renamed" }, r.json.token))
        .status,
    ).toBe(200)
    expect((await call("GET", "/api/device/phones", undefined, r.json.token)).json[0].name).toBe(
      "Renamed",
    )
    expect(
      (await call("DELETE", `/api/device/phones/${p.phoneId}`, undefined, r.json.token)).status,
    ).toBe(200)
    expect((await call("GET", "/api/phone/pending", undefined, s.json.token)).status).toBe(401)
    expect(
      (await call("POST", "/api/phone/session/challenge", { phoneId: p.phoneId })).status,
    ).toBe(404)
    expect(store.requestById("r5")).toBeUndefined()
    expect(
      (await call("DELETE", `/api/device/phones/${p.phoneId}`, undefined, r.json.token)).status,
    ).toBe(404)
  })

  it("forgets a push address the push service says is gone", async () => {
    const { r } = await enrol()
    const p = await pair(r.json.token)
    store.setPushSub(p.phoneId, JSON.stringify({ endpoint: "https://gone.example/x" }))
    const sealed = await sealJson({ x: 1 }, p.phoneKeys.publicKey, "r6")
    await call(
      "POST",
      "/api/device/requests",
      { id: "r6", phoneId: p.phoneId, sealed, expiresAt: new Date(clock + 600_000).toISOString() },
      r.json.token,
    )
    await new Promise((res) => setTimeout(res, 50))
    expect((await call("GET", "/api/device/phones", undefined, r.json.token)).json[0].push).toBe(
      false,
    )
  })

  it("purges expired things and holds nothing in the clear", async () => {
    const { r } = await enrol()
    const p = await pair(r.json.token)
    const sealed = await sealJson({ command: "plaintext-marker" }, p.phoneKeys.publicKey, "r7")
    await call(
      "POST",
      "/api/device/requests",
      { id: "r7", phoneId: p.phoneId, sealed, expiresAt: new Date(clock + 1000).toISOString() },
      r.json.token,
    )
    clock += 5 * 60_000
    store.purge(clock)
    expect(store.requestById("r7")).toBeUndefined()
    clock -= 5 * 60_000
    const dump = JSON.stringify(
      [
        "kv",
        "devices",
        "pairings",
        "phones",
        "requests",
        "envelopes",
        "challenges",
        "sessions",
      ].flatMap((t) => store.db.prepare(`select * from ${t}`).all()),
    )
    expect(dump).not.toContain("plaintext-marker")
  })
})

describe("limits and headers", () => {
  it("rejects bodies over 64 KB and malformed JSON", async () => {
    const { r } = await enrol()
    const big = await call(
      "POST",
      "/api/device/requests",
      { pad: "x".repeat(70_000) },
      r.json.token,
    )
    expect(big.status).toBe(413)
    const bad = await fetch(base + "/api/device/requests", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${r.json.token}` },
      body: "{nope",
    })
    expect(bad.status).toBe(400)
  })

  it("answers with no-store on the API and a strict policy on pages", async () => {
    const res = await fetch(base + "/api/public/config")
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
    expect(await res.json()).toMatchObject({ vapidPublicKey: "BPUBLIC", rpId: RP })
    const page = await fetch(base + "/")
    expect(page.headers.get("content-security-policy")).toContain("default-src 'self'")
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'")
  })

  it("trusts a proxy only by address, never by hop count", () => {
    expect(trustProxy("127.0.0.1")).toBe(true)
    expect(trustProxy("10.1.2.3")).toBe(true)
    expect(trustProxy("172.20.0.5")).toBe(true)
    expect(trustProxy("172.32.0.5")).toBe(false)
    expect(trustProxy("203.0.113.9")).toBe(false)
  })
})

describe("rate limit on endpoints that need no login", () => {
  it("slows guessing of pairing codes", async () => {
    const limited = await buildRelay({
      publicUrl: PUBLIC,
      store: new Store(fs.mkdtempSync(path.join(os.tmpdir(), "gh-relay2-"))),
      push: sender,
      anonymousLimit: 5,
    })
    let last = 0
    for (let i = 0; i < 8; i++)
      last = (
        await limited.app.inject({ method: "GET", url: "/api/phone/pairing-info?code=AAAAAAAA" })
      ).statusCode
    expect(last).toBe(429)
    await limited.close()
  })
})
