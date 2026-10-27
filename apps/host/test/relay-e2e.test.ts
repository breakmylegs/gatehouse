import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  exportPublicKey,
  fingerprint,
  generateKeyPair,
  sealJson,
  type KeyPair,
  type Sealed,
} from "@gatehouse/shared/e2e"
import {
  newEnvelope,
  openRequest,
  signAndSeal,
  type Envelope,
  type OpenedRequest,
} from "@gatehouse/shared/phone-protocol"
import { FakeAuthenticator } from "../../../packages/shared/test/support/fake-authenticator.js"
import { Store } from "../../relay/src/db.js"
import type { PushMessage, PushSender } from "../../relay/src/push.js"
import { buildRelay, type Relay } from "../../relay/src/server.js"
import { Broker, type Resolution } from "../src/broker.js"
import { PhoneService } from "../src/relay/service.js"
import { PlainProtector } from "../src/relay/protector.js"
import { PhoneStore } from "../src/relay/store.js"
import { buildStack, type Stack } from "./stack.js"

let root: string
let relay: Relay
let relayStore: Store
let relayUrl: string
let stack: Stack
let broker: Broker
let service: PhoneService
let phoneStore: PhoneStore
let phone: FakePhone
const pushes: Array<{ msg: PushMessage; urgent: boolean }> = []
const sender: PushSender = {
  publicKey: () => "BPUBLIC",
  send: async (_s, msg, urgent) => (pushes.push({ msg, urgent }), "ok"),
}

/** The installed phone app, in Node: the same shared protocol code the PWA runs, a software passkey, and plain HTTP to the Relay. */
class FakePhone {
  keys!: KeyPair
  auth!: FakeAuthenticator
  phoneId = ""
  hostPub = ""
  rpId = ""
  origin = ""
  ecdhPub = ""
  token = ""

  static async create() {
    const p = new FakePhone()
    p.keys = await generateKeyPair(false)
    p.auth = await FakeAuthenticator.create()
    p.ecdhPub = await exportPublicKey(p.keys.publicKey)
    return p
  }

  async http(method: string, url: string, body?: unknown, bearer?: string) {
    const res = await fetch(relayUrl + url, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    return { status: res.status, json: (await res.json().catch(() => undefined)) as any }
  }

  async register(code: string) {
    const info = await this.http("GET", `/api/phone/pairing-info?code=${code}`)
    if (info.status !== 200) return info
    this.hostPub = info.json.hostPublicKey
    this.rpId = info.json.rpId
    this.origin = info.json.origin
    const registration = this.auth.register({
      challenge: info.json.challenge,
      rpId: this.rpId,
      origin: this.origin,
    })
    const reg = await this.http("POST", `/api/phone/pairings/${info.json.pairingId}/register`, {
      code,
      phoneName: "Test iPhone",
      ecdhPublicKey: this.ecdhPub,
      registration,
      pushSubscription: {
        endpoint: "https://push.example.test/x",
        keys: { p256dh: "BBBB", auth: "CCCC" },
      },
    })
    return { ...reg, pairingId: info.json.pairingId as string }
  }

  async login() {
    const ch = await this.http("POST", "/api/phone/session/challenge", { phoneId: this.phoneId })
    const assertion = await this.auth.assert({
      challenge: ch.json.challenge,
      rpId: this.rpId,
      origin: this.origin,
    })
    const s = await this.http("POST", "/api/phone/session", { phoneId: this.phoneId, assertion })
    this.token = s.json.token
  }

  async fingerprint(credentialId = this.auth.credentialId) {
    return fingerprint({ hostPublicKey: this.hostPub, phonePublicKey: this.ecdhPub, credentialId })
  }

  async pendingOpened(): Promise<Array<{ relayId: string; opened: OpenedRequest }>> {
    const list = await this.http("GET", "/api/phone/pending", undefined, this.token)
    const out = []
    for (const r of list.json as Array<{ id: string; sealed: Sealed; summary?: string }>) {
      if (r.summary) continue
      out.push({ relayId: r.id, opened: await openRequest(r.sealed, this.keys.privateKey, r.id) })
    }
    return out
  }

  envelope(opened: OpenedRequest, over: Partial<Parameters<typeof newEnvelope>[0]> = {}): Envelope {
    return newEnvelope({
      type: "decision",
      deviceId: this.phoneId,
      now: Date.now(),
      ttlMs: 60_000,
      requestId: opened.payload.id,
      nonce: opened.payload.nonce,
      payloadHash: opened.payloadHash,
      ...over,
    })
  }

  async post(relayId: string | undefined, envelope: Envelope, aad = relayId ?? "kill") {
    const sealed = await signAndSeal(
      envelope,
      (c) =>
        this.auth.assert({ challenge: c, rpId: this.rpId, origin: this.origin }) as Promise<
          Record<string, unknown>
        >,
      this.hostPub,
      aad,
    )
    return this.http(
      "POST",
      "/api/phone/envelopes",
      { ...(relayId ? { requestId: relayId } : {}), sealed },
      this.token,
    )
  }
}

function escalate(
  over: {
    input?: Record<string, unknown>
    kind?: "permission" | "question" | "plan"
    toolName?: string
  } = {},
): { done: Promise<Resolution>; ctl: AbortController } {
  const ctl = new AbortController()
  const done = broker.request({
    kind: over.kind ?? "permission",
    sessionId: "s1",
    toolUseId: `tu-${Math.random()}`,
    toolName: over.toolName ?? "Bash",
    input: over.input ?? { command: "npm install left-pad" },
    cwd: "C:\\proj",
    project: "proj",
    verdict: {
      outcome: "escalate",
      ruleId: "package-install",
      reason: "Needs approval",
      risk: 70,
      decidedBy: "rules",
      policyHash: "h",
    },
    signal: ctl.signal,
  })
  return { done, ctl }
}

const until = async (cond: () => boolean | Promise<boolean>, ms = 15_000) => {
  const end = Date.now() + ms
  while (!(await cond())) {
    if (Date.now() > end) throw new Error("timed out waiting")
    await new Promise((r) => setTimeout(r, 25))
  }
}
async function onlyPending() {
  const l = await phone.pendingOpened()
  if (l.length !== 1) throw new Error(`expected one pending request on the phone, saw ${l.length}`)
  return l[0]!
}
const rejects = () => stack.records().filter((r) => r.event === "phone_decision_rejected")

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-e2e-"))
  relayStore = new Store(path.join(root, "relay"))
  relay = await buildRelay({
    publicUrl: "http://localhost",
    store: relayStore,
    push: sender,
    enrolFile: path.join(root, "enrol.txt"),
    anonymousLimit: 10_000,
  })
  await relay.app.listen({ host: "127.0.0.1", port: 0 })
  relayUrl = `http://127.0.0.1:${(relay.app.server.address() as { port: number }).port}`
  stack = await buildStack({ hardTimeoutMs: 60_000, phoneExpiryMs: 30_000 })
  phoneStore = new PhoneStore(path.join(root, "phone.json"), new PlainProtector())
  const holder: { svc?: PhoneService } = {}
  broker = new Broker({
    phoneExpiryMs: 30_000,
    hardTimeoutMs: 60_000,
    redact: (v) => v,
    phone: { deliver: (r) => holder.svc!.deliver(r), cancel: (id, s) => holder.svc!.cancel(id, s) },
  })
  service = holder.svc = new PhoneService({
    store: phoneStore,
    broker,
    kill: stack.kill,
    audit: stack.audit,
    log: () => undefined,
  })
  phone = await FakePhone.create()
}, 120_000)

afterAll(async () => {
  service.stop()
  await relay.close()
  relayStore.close()
  await stack.stop()
  fs.rmSync(root, { recursive: true, force: true })
})

describe("pairing", () => {
  it("sets up the Relay, pairs a phone, shows the same six digits on both screens, and pins the passkey only after confirmation", async () => {
    const token = fs.readFileSync(path.join(root, "enrol.txt"), "utf8").trim()
    await expect(service.setup("http://example.com", token, "laptop")).rejects.toThrow(/https/)
    await service.setup(relayUrl, token, "laptop")
    expect(service.health().state).toBe("connected")
    const pairing = await service.startPairing()
    expect(pairing.code).toMatch(/^[A-HJKMNP-Z2-9]{8}$/)
    expect((await service.pairingStatus(pairing.id)).status).toBe("waiting")
    expect((await phone.register("AAAAAAAA")).status).toBe(404)
    const reg = await phone.register(pairing.code)
    expect(reg.status).toBe(200)
    const view = await service.pairingStatus(pairing.id)
    expect(view.status).toBe("awaiting-confirmation")
    expect(view.fingerprint).toMatch(/^\d{6}$/)
    expect(view.fingerprint).toBe(await phone.fingerprint())
    expect(service.listPhones()).toEqual([])
    const pinned = await service.confirmPairing(pairing.id)
    expect(service.listPhones()).toHaveLength(1)
    phone.phoneId = pinned.id
    expect(pinned.credentialId).toBe(phone.auth.credentialId)
    expect(service.health().devices).toBe(1)
    await phone.login()
    service.start()
  })

  it("refuses a registration whose passkey signed a different challenge", async () => {
    const p2 = await FakePhone.create()
    const pairing = await service.startPairing()
    const info = await p2.http("GET", `/api/phone/pairing-info?code=${pairing.code}`)
    const bad = p2.auth.register({
      challenge: "A".repeat(43),
      rpId: info.json.rpId,
      origin: info.json.origin,
    })
    await p2.http("POST", `/api/phone/pairings/${info.json.pairingId}/register`, {
      code: pairing.code,
      phoneName: "x",
      ecdhPublicKey: p2.ecdhPub,
      registration: bad,
    })
    const view = await service.pairingStatus(pairing.id)
    expect(view.status).toBe("failed")
    await expect(service.confirmPairing(pairing.id)).rejects.toThrow()
    expect(service.listPhones()).toHaveLength(1)
  })

  it("keeps the device token and the Host's private key protected on disk", async () => {
    const text = fs.readFileSync(path.join(root, "phone.json"), "utf8")
    const file = JSON.parse(text)
    expect(file.relay.tokenProtected).toBeTruthy()
    expect(file.hostKey.pkcs8Protected).toBeTruthy()
    const raw = Buffer.from(file.relay.tokenProtected, "base64url").toString("latin1")
    expect(raw.startsWith("plain:")).toBe(true)
    expect(await phoneStore.token()).toMatch(/^[A-Za-z0-9_-]{30,}$/)
    expect(text).not.toContain(String(await phoneStore.token()))
  })
})

describe("a phone answers a request (invariants 8, 9, 11, 12)", () => {
  it("allows: sealed out, signed back, accepted, and the Relay learns the outcome only as a sentence", async () => {
    pushes.length = 0
    const { done } = escalate({ input: { command: "npm install super-secret-client-package" } })
    await until(async () => (await phone.pendingOpened()).length === 1)
    const { relayId, opened } = await onlyPending()
    expect(opened.payload.toolName).toBe("Bash")
    expect(JSON.stringify(opened.payload.input)).toContain("super-secret-client-package")
    expect(JSON.stringify(pushes)).not.toContain("super-secret")
    expect(
      (pushes.find((p) => p.msg.t === "request")?.msg as { sealed?: unknown }).sealed,
    ).toBeTruthy()
    expect(JSON.stringify(relayStore.db.prepare("select * from requests").all())).not.toContain(
      "super-secret",
    )
    expect((await phone.post(relayId, phone.envelope(opened, { decision: "allow" }))).status).toBe(
      200,
    )
    const r = await done
    expect(r).toMatchObject({ outcome: "allow", channel: "phone" })
    await until(() => relayStore.requestById(relayId)?.summary !== null)
    expect(relayStore.requestById(relayId)?.summary).toMatch(/Approved on phone/)
  })

  it("denies with a message that reaches the agent", async () => {
    const { done } = escalate()
    await until(async () => (await phone.pendingOpened()).length === 1)
    const { relayId, opened } = await onlyPending()
    await phone.post(relayId, phone.envelope(opened, { decision: "deny", message: "use a branch" }))
    expect(await done).toMatchObject({ outcome: "deny", channel: "phone", message: "use a branch" })
  })

  it("answers a question", async () => {
    const { done } = escalate({
      kind: "question",
      toolName: "AskUserQuestion",
      input: { questions: [{ question: "Which?", options: [{ label: "A" }, { label: "B" }] }] },
    })
    await until(async () => (await phone.pendingOpened()).length === 1)
    const { relayId, opened } = await onlyPending()
    await phone.post(
      relayId,
      phone.envelope(opened, { type: "answer", decision: undefined, answers: { "Which?": "B" } }),
    )
    expect(await done).toMatchObject({
      outcome: "allow",
      channel: "phone",
      answers: { "Which?": "B" },
    })
  })

  it("refuses an envelope that tries to edit input or remember a rule, because the passkey signed different bytes", async () => {
    const { done, ctl } = escalate()
    await until(async () => (await phone.pendingOpened()).length === 1)
    const { relayId, opened } = await onlyPending()
    const before = rejects().length
    const evil = {
      ...phone.envelope(opened, { decision: "allow" }),
      updatedInput: { command: "rm -rf /" },
      remember: true,
    } as unknown as Envelope
    await phone.post(relayId, evil)
    await until(() => rejects().length > before)
    expect(rejects().at(-1)?.verdict.reason).toMatch(/did not verify/)
    expect(broker.list()).toHaveLength(1)
    ctl.abort()
    await done.catch(() => undefined)
    await until(() => broker.list().length === 0)
  })

  it("will not apply the same signed decision twice, and a replay is audited as refused", async () => {
    const first = escalate()
    await until(async () => (await phone.pendingOpened()).length === 1)
    const { relayId, opened } = await onlyPending()
    const env = phone.envelope(opened, { decision: "deny" })
    await phone.post(relayId, env)
    expect((await first.done).outcome).toBe("deny")
    const before = rejects().length
    // Replaying the identical envelope later: the nonce is spent.
    const again = phone.post(relayId, env)
    await again
    await until(() => rejects().length > before)
    expect(rejects().at(-1)?.verdict.reason).toMatch(/already used|not waiting/)
  })

  it("refuses a decision signed for a request the Host never sent (a request the Relay made up)", async () => {
    const before = rejects().length
    const fake = await openFake()
    await phone.post(fake.relayId, phone.envelope(fake.opened, { decision: "allow" }))
    await until(() => rejects().length > before)
    expect(rejects().at(-1)?.verdict.reason).toMatch(/not waiting/)
  })

  it("refuses a sealed decision the Relay altered, and one sealed to the wrong key", async () => {
    const { done, ctl } = escalate()
    await until(async () => (await phone.pendingOpened()).length === 1)
    const { relayId, opened } = await onlyPending()
    const before = rejects().length
    const sign = (c: string) =>
      phone.auth.assert({ challenge: c, rpId: phone.rpId, origin: phone.origin }) as Promise<
        Record<string, unknown>
      >
    const sealed = await signAndSeal(
      phone.envelope(opened, { decision: "allow" }),
      sign,
      phone.hostPub,
      relayId,
    )
    const flipped = { ...sealed, ct: (sealed.ct[0] === "A" ? "B" : "A") + sealed.ct.slice(1) }
    const now = new Date().toISOString()
    await service.handleForTest({
      id: "t1",
      phoneId: phone.phoneId,
      requestId: relayId,
      sealed: flipped,
      createdAt: now,
    })
    expect(rejects().length).toBe(before + 1)
    expect(rejects().at(-1)?.verdict.reason).toMatch(/could not be opened/)
    // Sealed to some other key (the Relay's own), it cannot be opened by the Host either.
    const other = await generateKeyPair(false)
    const wrong = await signAndSeal(
      phone.envelope(opened, { decision: "allow" }),
      sign,
      await exportPublicKey(other.publicKey),
      relayId,
    )
    await service.handleForTest({
      id: "t2",
      phoneId: phone.phoneId,
      requestId: relayId,
      sealed: wrong,
      createdAt: now,
    })
    expect(rejects().length).toBe(before + 2)
    expect(broker.list()).toHaveLength(1)
    ctl.abort()
    await done.catch(() => undefined)
    await until(() => broker.list().length === 0)
  })

  it("lets the phone deny, but never allow, a request too big to show on it", async () => {
    const big = "x".repeat(20_000)
    const a = escalate({ input: { command: big } })
    await until(async () => (await phone.pendingOpened()).length === 1)
    let { relayId, opened } = await onlyPending()
    expect(opened.oversize?.characters).toBeGreaterThan(19_000)
    expect(JSON.stringify(opened.payload.input)).not.toContain("xxxx")
    const before = rejects().length
    await phone.post(relayId, phone.envelope(opened, { decision: "allow" }))
    await until(() => rejects().length > before)
    expect(rejects().at(-1)?.verdict.reason).toMatch(/only deny/)
    expect(broker.list()).toHaveLength(1)
    ;({ relayId, opened } = await onlyPending())
    await phone.post(relayId, phone.envelope(opened, { decision: "deny" }))
    expect(await a.done).toMatchObject({ outcome: "deny", channel: "phone" })
  })
})

describe("kill switch from the phone", () => {
  it("engages with a signed kill envelope, once, and never re-arms", async () => {
    const hello = await phone.pendingOpened()
    expect(hello).toEqual([])
    const env = newEnvelope({
      type: "kill",
      deviceId: phone.phoneId,
      now: Date.now(),
      ttlMs: 60_000,
    })
    const { done, ctl } = escalate()
    await until(async () => (await phone.pendingOpened()).length === 1)
    await phone.post(undefined, env)
    await until(() => stack.kill.isEngaged())
    ctl.abort()
    await done.catch(() => undefined)
    await stack.kill.rearm("desktop")
    expect(stack.kill.isEngaged()).toBe(false)
    const before = rejects().length
    await phone.post(undefined, env)
    await until(() => rejects().length > before)
    expect(rejects().at(-1)?.verdict.reason).toMatch(/already used/)
    expect(stack.kill.isEngaged()).toBe(false)
  })
})

describe("notifications and revocation", () => {
  it("sends a note sealed to the phone, with a generic push", async () => {
    pushes.length = 0
    await service.notify("notify", {
      title: "Claude",
      body: "Tests are green in proj",
      project: "proj",
    })
    await until(() => pushes.length > 0)
    expect(pushes[0]?.msg.t).toBe("notify")
    expect(JSON.stringify(pushes)).not.toContain("green")
  })

  it("revokes at once: the Host refuses that phone's decisions even before the Relay hears of it", async () => {
    const { done, ctl } = escalate()
    await until(async () => (await phone.pendingOpened()).length === 1)
    const { relayId, opened } = await onlyPending()
    const env = phone.envelope(opened, { decision: "allow" })
    const gone = await service.revokePhone(phone.phoneId)
    expect(gone).toEqual({ removed: true, relayNotified: true })
    expect(service.listPhones()).toEqual([])
    const before = rejects().length
    // Even if the Relay still delivered it, the Host has no pinned key for this phone.
    const sealed = await signAndSeal(
      env,
      (c) =>
        phone.auth.assert({ challenge: c, rpId: phone.rpId, origin: phone.origin }) as Promise<
          Record<string, unknown>
        >,
      phone.hostPub,
      relayId,
    )
    await service.handleForTest({
      id: "x",
      phoneId: phone.phoneId,
      requestId: relayId,
      sealed,
      createdAt: new Date().toISOString(),
    })
    expect(rejects().length).toBe(before + 1)
    expect(rejects().at(-1)?.verdict.reason).toMatch(/not paired/)
    expect(broker.list()).toHaveLength(1)
    ctl.abort()
    await done.catch(() => undefined)
  })

  it("says so when there is no phone, so the broker shows the phone as not in use", async () => {
    const r = broker.request({
      kind: "permission",
      sessionId: "s",
      toolUseId: "t",
      toolName: "Bash",
      input: { command: "x" },
      cwd: "C:\\p",
      project: "p",
      verdict: {
        outcome: "escalate",
        ruleId: "r",
        reason: "r",
        risk: 10,
        decidedBy: "rules",
        policyHash: "h",
      },
    })
    await until(() => broker.list().length === 1)
    await until(() => broker.list()[0]?.phone === "none")
    broker.resolve(broker.list()[0]!.request.id, { kind: "decision", decision: "deny" }, "desktop")
    await r
  })
})

async function openFake() {
  // A request the Relay invents, sealed to the phone's public key (which anyone can do).
  const payload = {
    id: "invented",
    nonce: "invented-nonce-123456",
    kind: "permission" as const,
    toolName: "Bash",
    input: { command: "rm -rf /" },
    cwd: "C:\\",
    project: "p",
    verdict: { outcome: "escalate", ruleId: "r", reason: "r", risk: 10 },
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }
  const { canonicalize } = await import("@gatehouse/shared/canonical-json")
  const { sha256 } = await import("@gatehouse/shared/e2e")
  const hash = Array.from(await sha256(canonicalize(payload)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("")
  const sealed = await sealJson({ payload, payloadHash: hash }, phone.keys.publicKey, "invented")
  return {
    relayId: undefined as string | undefined,
    opened: { payload, payloadHash: hash } as unknown as OpenedRequest,
    sealed,
  }
}

describe("the Devices endpoints the desktop page uses", () => {
  it("pairs, renames and revokes through the API, and audits each step", async () => {
    const { default: Fastify } = await import("fastify")
    const { registerApi } = await import("../src/api.js")
    const app = Fastify()
    registerApi(app, {
      engine: stack.deps.engine,
      store: stack.store,
      pwsh: undefined,
      audit: stack.audit,
      auditDir: stack.auditDir,
      loadOptions: { rulesPath: path.join(stack.dir, "rules.yaml") },
      env: {},
      config: () => ({}) as never,
      log: () => undefined,
      phone: service,
    })
    await app.ready()
    const call = async (method: "GET" | "POST" | "PUT" | "DELETE", url: string, body?: unknown) => {
      const r = await app.inject({
        method,
        url,
        ...(body !== undefined ? { payload: body as object } : {}),
      })
      return { status: r.statusCode, json: r.json() as any }
    }
    expect((await call("GET", "/api/relay")).json).toMatchObject({
      health: { state: "connected", devices: 0 },
      phones: [],
    })
    expect((await call("POST", "/api/relay/setup", { url: "x" })).status).toBe(400)
    expect(
      (
        await call("POST", "/api/relay/setup", {
          url: "http://example.com",
          enrolToken: "t",
          name: "n",
        })
      ).status,
    ).toBe(502)
    const p2 = await FakePhone.create()
    const started = await call("POST", "/api/relay/pairing")
    expect(started.status).toBe(200)
    expect((await p2.register(started.json.code)).status).toBe(200)
    const status = await call("GET", `/api/relay/pairing/${started.json.id}`)
    expect(status.json).toMatchObject({
      status: "awaiting-confirmation",
      fingerprint: await p2.fingerprint(),
    })
    const confirmed = await call("POST", `/api/relay/pairing/${started.json.id}/confirm`)
    expect(confirmed.status).toBe(200)
    const id = confirmed.json.phone.id as string
    expect((await call("PUT", `/api/relay/phones/${id}`, { name: "Peter's iPhone" })).status).toBe(
      200,
    )
    expect((await call("GET", "/api/relay")).json.phones[0].name).toBe("Peter's iPhone")
    expect((await call("PUT", `/api/relay/phones/${id}`, { name: "" })).status).toBe(400)
    // A refused request must have no side effect: the name is unchanged.
    expect((await call("GET", "/api/relay")).json.phones[0].name).toBe("Peter's iPhone")
    expect((await call("DELETE", `/api/relay/phones/${id}`)).json).toMatchObject({
      ok: true,
      removed: true,
    })
    expect((await call("DELETE", `/api/relay/phones/${id}`)).status).toBe(404)
    expect((await call("GET", "/api/relay/pairing/nope")).status).toBe(502)
    const events = stack.records().map((r) => r.event)
    for (const e of ["pairing_started", "phone_paired", "phone_revoked"])
      expect(events).toContain(e)
    await app.close()
  })
})
