import { beforeAll, describe, expect, it } from "vitest"
import type { SignedDecision } from "@gatehouse/shared/relay-protocol"
import { FakeAuthenticator } from "../../../packages/shared/test/support/fake-authenticator.js"
import {
  envelopeChallenge,
  verifyPhoneDecision,
  type PendingInfo,
  type PinnedPhone,
} from "../src/relay/verify.js"

const RP = "gh.example.test"
const ORIGIN = "https://gh.example.test"
const NOW = Date.parse("2026-10-27T12:00:00Z")
const iso = (ms: number) => new Date(ms).toISOString()

let auth: FakeAuthenticator
let phone: PinnedPhone

const pendingInfo: PendingInfo = {
  nonce: "nonce-of-request-1",
  payloadHash: "hash-of-request-1",
  expiresAtMs: NOW + 5 * 60_000,
  kind: "permission",
  oversize: false,
}
const lookup =
  (over: Partial<PendingInfo> = {}) =>
  (id: string) =>
    id === "req-1" ? { ...pendingInfo, ...over } : undefined

beforeAll(async () => {
  auth = await FakeAuthenticator.create()
  phone = {
    id: "phone-1",
    name: "iPhone",
    credentialId: auth.credentialId,
    credentialPublicKey: auth.coseKey.toString("base64url"),
    counter: 0,
    ecdhPublicKey: "x",
    pairedAt: iso(NOW),
  }
})

type Env = SignedDecision["envelope"]
const baseEnv = (over: Partial<Env> = {}): Env => ({
  v: 1,
  type: "decision",
  requestId: "req-1",
  nonce: pendingInfo.nonce,
  decision: "allow",
  payloadHash: pendingInfo.payloadHash,
  deviceId: "phone-1",
  issuedAt: iso(NOW - 1000),
  expiresAt: iso(NOW + 60_000),
  ...over,
})

async function sign(
  env: Env,
  opts: {
    who?: FakeAuthenticator
    origin?: string
    rpId?: string
    uv?: boolean
    counter?: number
  } = {},
): Promise<SignedDecision> {
  const who = opts.who ?? auth
  who.userVerified = opts.uv ?? true
  const assertion = await who.assert({
    challenge: await envelopeChallenge(env),
    rpId: opts.rpId ?? RP,
    origin: opts.origin ?? ORIGIN,
    ...(opts.counter !== undefined ? { counter: opts.counter } : {}),
  })
  who.userVerified = true
  return { envelope: env, assertion: assertion as unknown as Record<string, unknown> }
}

const check = (
  signed: SignedDecision,
  over: {
    pending?: ReturnType<typeof lookup>
    used?: Set<string>
    now?: number
    phone?: PinnedPhone
  } = {},
) =>
  verifyPhoneDecision({
    signed,
    phone: over.phone ?? phone,
    pending: over.pending ?? lookup(),
    nonceUsed: (n) => (over.used ?? new Set()).has(n),
    now: over.now ?? NOW,
    rpId: RP,
    origin: ORIGIN,
  })

describe("invariant 8: a phone decision is accepted only when every check holds", () => {
  it("accepts a valid allow, a valid deny with a message, valid answers and a valid kill", async () => {
    const allow = await check(await sign(baseEnv()))
    expect(allow).toMatchObject({
      ok: true,
      action: { type: "decision", requestId: "req-1", decision: "allow" },
      nonce: pendingInfo.nonce,
    })
    const deny = await check(await sign(baseEnv({ decision: "deny", message: "use a branch" })))
    expect(deny).toMatchObject({ ok: true, action: { decision: "deny", message: "use a branch" } })
    const answers = await check(
      await sign(baseEnv({ type: "answer", decision: undefined, answers: { "Which?": "A" } })),
      { pending: lookup({ kind: "question" }) },
    )
    expect(answers).toMatchObject({
      ok: true,
      action: { type: "answers", answers: { "Which?": "A" } },
    })
    const kill = await check(
      await sign(
        baseEnv({
          type: "kill",
          requestId: undefined,
          decision: undefined,
          payloadHash: undefined,
          nonce: "kill-nonce-12345",
        }),
      ),
    )
    expect(kill).toMatchObject({ ok: true, action: { type: "kill" } })
  })

  it("refuses an assertion made over a different envelope (any field changed after signing)", async () => {
    const signed = await sign(baseEnv({ decision: "deny" }))
    const flipped = { ...signed, envelope: { ...signed.envelope, decision: "allow" as const } }
    expect(await check(flipped)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("did not verify"),
    })
    const retimed = { ...signed, envelope: { ...signed.envelope, expiresAt: iso(NOW + 120_000) } }
    expect(await check(retimed)).toMatchObject({ ok: false })
  })

  it("refuses a different passkey, a wrong origin, a wrong RP id and a missing user verification", async () => {
    const other = await FakeAuthenticator.create()
    expect((await check(await sign(baseEnv(), { who: other }))).ok).toBe(false)
    expect((await check(await sign(baseEnv(), { origin: "https://evil.example.test" }))).ok).toBe(
      false,
    )
    expect((await check(await sign(baseEnv(), { rpId: "evil.example.test" }))).ok).toBe(false)
    expect((await check(await sign(baseEnv(), { uv: false }))).ok).toBe(false)
  })

  it("refuses a nonce that was used, a nonce that is not the request's, and a hash that does not match", async () => {
    expect(
      await check(await sign(baseEnv()), { used: new Set([pendingInfo.nonce]) }),
    ).toMatchObject({ ok: false, reason: expect.stringContaining("already used") })
    expect(await check(await sign(baseEnv({ nonce: "some-other-nonce-12" })))).toMatchObject({
      ok: false,
      reason: expect.stringContaining("nonce"),
    })
    expect(
      await check(await sign(baseEnv({ payloadHash: "hash-of-another-request" }))),
    ).toMatchObject({ ok: false, reason: expect.stringContaining("hash") })
    expect(await check(await sign(baseEnv({ payloadHash: undefined })))).toMatchObject({
      ok: false,
    })
  })

  it("refuses an expired envelope, one dated in the future, and one that lives too long", async () => {
    expect(await check(await sign(baseEnv({ expiresAt: iso(NOW - 1) })))).toMatchObject({
      ok: false,
      reason: expect.stringContaining("expired"),
    })
    expect(
      await check(
        await sign(baseEnv({ issuedAt: iso(NOW + 5 * 60_000), expiresAt: iso(NOW + 6 * 60_000) })),
      ),
    ).toMatchObject({ ok: false, reason: expect.stringContaining("future") })
    expect(await check(await sign(baseEnv({ expiresAt: iso(NOW + 30 * 60_000) })))).toMatchObject({
      ok: false,
      reason: expect.stringContaining("too long"),
    })
    expect(await check(await sign(baseEnv({ issuedAt: "nonsense" })))).toMatchObject({ ok: false })
  })

  it("refuses a decision for a request that is not waiting, or that expired on the phone", async () => {
    expect(await check(await sign(baseEnv({ requestId: "req-gone" })))).toMatchObject({
      ok: false,
      reason: expect.stringContaining("not waiting"),
    })
    expect(
      await check(await sign(baseEnv()), { pending: lookup({ expiresAtMs: NOW - 1 }) }),
    ).toMatchObject({ ok: false, reason: expect.stringContaining("expired") })
    expect(await check(await sign(baseEnv({ requestId: undefined })))).toMatchObject({ ok: false })
  })

  it("refuses an envelope that names another device, even if it is signed correctly", async () => {
    expect(await check(await sign(baseEnv({ deviceId: "phone-2" })))).toMatchObject({
      ok: false,
      reason: expect.stringContaining("different device"),
    })
  })

  it("lets the phone deny, but never allow, a request it saw only part of", async () => {
    const o = { pending: lookup({ oversize: true }) }
    expect(await check(await sign(baseEnv({ decision: "allow" })), o)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("only deny"),
    })
    expect((await check(await sign(baseEnv({ decision: "deny" })), o)).ok).toBe(true)
  })

  it("keeps decisions and answers to their own kinds of request", async () => {
    expect(
      await check(await sign(baseEnv()), { pending: lookup({ kind: "question" }) }),
    ).toMatchObject({ ok: false })
    expect(
      await check(
        await sign(baseEnv({ type: "answer", decision: undefined, answers: { q: "a" } })),
      ),
    ).toMatchObject({ ok: false })
    expect(
      await check(await sign(baseEnv({ type: "answer", decision: undefined, answers: {} })), {
        pending: lookup({ kind: "question" }),
      }),
    ).toMatchObject({ ok: false })
    expect(await check(await sign(baseEnv({ decision: undefined })))).toMatchObject({ ok: false })
  })

  it("holds kill envelopes to a short life and no request id, and still demands a fresh nonce", async () => {
    const kill = (over: Partial<Env> = {}) =>
      baseEnv({
        type: "kill",
        requestId: undefined,
        decision: undefined,
        payloadHash: undefined,
        nonce: "kill-nonce-12345",
        ...over,
      })
    expect((await check(await sign(kill({ expiresAt: iso(NOW + 5 * 60_000) })))).ok).toBe(false)
    expect((await check(await sign(kill({ requestId: "req-1" })))).ok).toBe(false)
    expect((await check(await sign(kill()), { used: new Set(["kill-nonce-12345"]) })).ok).toBe(
      false,
    )
    expect((await check(await sign(kill()))).ok).toBe(true)
  })

  it("refuses a counter that goes backwards, and accepts one that stays at zero", async () => {
    const pinned = { ...phone, counter: 10 }
    expect((await check(await sign(baseEnv(), { counter: 5 }), { phone: pinned })).ok).toBe(false)
    const up = await check(await sign(baseEnv(), { counter: 11 }), { phone: pinned })
    expect(up).toMatchObject({ ok: true, newCounter: 11 })
    expect((await check(await sign(baseEnv(), { counter: 0 }))).ok).toBe(true)
  })

  it("never throws on a garbage assertion", async () => {
    const signed: SignedDecision = {
      envelope: baseEnv(),
      assertion: {
        id: auth.credentialId,
        response: { clientDataJSON: "x", authenticatorData: "y", signature: "z" },
      },
    }
    expect(await check(signed)).toMatchObject({ ok: false })
    expect(await check({ envelope: baseEnv(), assertion: {} })).toMatchObject({ ok: false })
  })
})
