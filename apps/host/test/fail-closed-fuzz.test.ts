// B05: fail closed under fuzzing. Thousands of broken, hostile or late inputs on the two places where a decision comes
// from outside the Host (the Approver's reply, and a phone's signed decision) give no allow at all, and never throw.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import type { SignedDecision } from "@gatehouse/shared/relay-protocol"
import { FakeAuthenticator } from "../../../packages/shared/test/support/fake-authenticator.js"
import { ApproverClient } from "../src/approver-client.js"
import {
  envelopeChallenge,
  verifyPhoneDecision,
  type PendingInfo,
  type PinnedPhone,
} from "../src/relay/verify.js"

/** A small seeded generator, so a failure can be found again from its seed. */
function rng(seed: number) {
  let s = seed >>> 0 || 1
  const next = () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 0x1_0000_0000
  }
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!,
  }
}

const JUNK: unknown[] = [
  null,
  undefined,
  0,
  -1,
  1e309,
  Number.NaN,
  "",
  "allow",
  "ALLOW",
  " allow",
  true,
  false,
  [],
  ["allow"],
  {},
  { outcome: "allow" },
  "x".repeat(5000),
  "\u0000",
  "<script>",
  "__proto__",
  { __proto__: { outcome: "allow" } },
]

describe("the Approver's reply, fuzzed (invariant 1)", () => {
  const VALID_ALLOW = {
    outcome: "allow",
    ruleId: "read-in-project",
    reason: "Reading inside the project.",
    risk: 5,
    decidedBy: "rules",
    policyHash: "abc",
  }
  // Each makes the allow invalid: a required field gone, of the wrong kind, or out of range.
  const breakers: Array<(v: Record<string, unknown>, r: ReturnType<typeof rng>) => void> = [
    (v, r) => delete v[r.pick(["outcome", "ruleId", "reason", "risk", "decidedBy", "policyHash"])],
    (v, r) =>
      (v.outcome = r.pick(["Allow", "allowed", "yes", "", " allow", "allow ", 1, null, ["allow"]])),
    (v, r) => (v.risk = r.pick([-1, 101, 5.5, "5", null, Number.NaN, 1e9])),
    (v, r) => (v.decidedBy = r.pick(["me", "", "Rules", 7, null, "human"])),
    (v, r) => (v.ruleId = r.pick([1, null, [], {}, true])),
    (v, r) => (v.reason = r.pick([1, null, [], {}, false])),
    (v, r) => (v.policyHash = r.pick([1, null, [], {}])),
    (v, r) =>
      (v.segments = r.pick([
        "x",
        [{ text: 1 }],
        [{ text: "a", ruleId: "r", outcome: "maybe" }],
        3,
      ])),
  ]
  type Reply = { status: number; body: string }
  const replies = (r: ReturnType<typeof rng>): Reply => {
    const kind = r.int(8)
    if (kind === 0)
      return {
        status: r.pick([400, 401, 403, 404, 500, 502, 503]),
        body: JSON.stringify({ result: { structuredContent: VALID_ALLOW } }),
      }
    if (kind === 1) {
      const text = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { structuredContent: VALID_ALLOW },
      })
      return { status: 200, body: text.slice(0, r.int(text.length - 1)) }
    }
    if (kind === 2)
      return {
        status: 200,
        body: JSON.stringify({ result: { structuredContent: VALID_ALLOW, isError: true } }),
      }
    if (kind === 3)
      return {
        status: 200,
        body: JSON.stringify({ error: { code: -1 }, result: { structuredContent: VALID_ALLOW } }),
      }
    if (kind === 4)
      return { status: 200, body: JSON.stringify({ result: { structuredContent: r.pick(JUNK) } }) }
    if (kind === 5) return { status: 200, body: JSON.stringify(r.pick(JUNK) ?? null) }
    const v: Record<string, unknown> = { ...VALID_ALLOW }
    for (let k = 1 + r.int(3); k > 0; k--) r.pick(breakers)(v, r)
    return {
      status: 200,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { structuredContent: v } }),
    }
  }
  afterEach(() => vi.unstubAllGlobals())

  it("gives no allow for 5,000 malformed, refused, cut-short or contradictory replies, and never throws", async () => {
    const r = rng(20261103)
    let reply: Reply = { status: 200, body: "" }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(reply.body, { status: reply.status })),
    )
    const client = new ApproverClient({ url: "http://127.0.0.1:1/mcp", token: "t".repeat(32) })
    const allowed: string[] = []
    for (let i = 0; i < 5000; i++) {
      reply = replies(r)
      const v = await client.evaluate(
        { toolName: "Read", input: { file_path: "a" } },
        { cwd: "C:/x", sessionId: "s" },
      )
      if (v.outcome === "allow") allowed.push(reply.body.slice(0, 200))
      expect(v.outcome).toBe("escalate")
    }
    expect(allowed).toEqual([])
    // The control: the same client allows a well-formed allow, so the fuzz above tested something real.
    reply = { status: 200, body: JSON.stringify({ result: { structuredContent: VALID_ALLOW } }) }
    expect(
      (await client.evaluate({ toolName: "Read", input: {} }, { cwd: "C:/x", sessionId: "s" }))
        .outcome,
    ).toBe("allow")
  }, 120_000)
})

describe("a phone's signed decision, fuzzed (invariant 8)", () => {
  const RP = "gh.example.test"
  const ORIGIN = "https://gh.example.test"
  const NOW = Date.parse("2026-11-03T12:00:00Z")
  const iso = (ms: number) => new Date(ms).toISOString()
  const pending: PendingInfo = {
    nonce: "nonce-of-request-1",
    payloadHash: "hash-of-request-1",
    expiresAtMs: NOW + 5 * 60_000,
    kind: "permission",
    oversize: false,
  }
  let phone: PinnedPhone
  let valid: SignedDecision
  /** The same envelope signed by another passkey, presented as the pinned one: well formed, wrong key. */
  let forged: SignedDecision
  beforeAll(async () => {
    const auth = await FakeAuthenticator.create()
    phone = {
      id: "phone-1",
      name: "iPhone",
      credentialId: auth.credentialId,
      credentialPublicKey: auth.coseKey.toString("base64url"),
      counter: 0,
      ecdhPublicKey: "x",
      pairedAt: iso(NOW),
    }
    const envelope: SignedDecision["envelope"] = {
      v: 1,
      type: "decision",
      requestId: "req-1",
      nonce: pending.nonce,
      decision: "allow",
      payloadHash: pending.payloadHash,
      deviceId: "phone-1",
      issuedAt: iso(NOW - 1000),
      expiresAt: iso(NOW + 60_000),
    }
    const assertion = await auth.assert({
      challenge: await envelopeChallenge(envelope),
      rpId: RP,
      origin: ORIGIN,
    })
    valid = { envelope, assertion: assertion as unknown as Record<string, unknown> }
    const other = await FakeAuthenticator.create()
    const wrong = (await other.assert({
      challenge: await envelopeChallenge(envelope),
      rpId: RP,
      origin: ORIGIN,
    })) as unknown as Record<string, unknown>
    forged = { envelope, assertion: { ...wrong, id: auth.credentialId, rawId: auth.credentialId } }
  })

  const check = (
    signed: SignedDecision,
    o: { used?: boolean; now?: number; pending?: PendingInfo | undefined } = {},
  ) =>
    verifyPhoneDecision({
      signed,
      phone,
      pending: (id) => (id === "req-1" ? ("pending" in o ? o.pending : pending) : undefined),
      nonceUsed: () => o.used === true,
      now: o.now ?? NOW,
      rpId: RP,
      origin: ORIGIN,
    })

  /** One of many ways to break a good allow: a field changed after signing, the signature damaged, or a replay. */
  let lastWhat = ""
  function broken(r: ReturnType<typeof rng>): {
    signed: SignedDecision
    o: Parameters<typeof check>[1]
  } {
    const signed = structuredClone(valid)
    const env = signed.envelope as Record<string, unknown>
    const a = signed.assertion as Record<string, unknown>
    const response = (a.response ?? {}) as Record<string, unknown>
    lastWhat = ""
    const kind = r.int(10)
    if (kind === 0) {
      // Any envelope field changed after it was signed.
      const key = r.pick([
        "requestId",
        "nonce",
        "decision",
        "payloadHash",
        "deviceId",
        "issuedAt",
        "expiresAt",
        "type",
        "v",
      ])
      env[key] = r.pick(
        JUNK.concat(["req-2", "deny", "allow", iso(NOW), "phone-2", 2, "answer", "kill"]),
      )
      if (env[key] === valid.envelope[key as keyof typeof valid.envelope])
        env[key] = `${String(env[key])}x`
      return { signed, o: {} }
    }
    if (kind === 1 || kind === 2) {
      // A part of the passkey's answer cut short, a byte flipped, or replaced with junk.
      // Not userHandle: the signature does not cover it and the Host never uses it, so changing it breaks nothing.
      const part = r.pick(["clientDataJSON", "authenticatorData", "signature"])
      const was = typeof response[part] === "string" ? (response[part] as string) : ""
      response[part] =
        kind === 1 && was
          ? was.slice(0, r.int(Math.max(1, was.length - 1)))
          : was
            ? `${was.slice(0, 5)}${was[5] === "A" ? "B" : "A"}${was.slice(6)}`
            : r.pick(JUNK)
      if (response[part] === was) response[part] = `${was}A`
      a.response = response
      lastWhat = `${part}: ${String(response[part]).slice(0, 40)}`
      return { signed, o: {} }
    }
    if (kind === 3) {
      // The answer's own fields junked.
      const key = r.pick(["id", "rawId", "type", "response"])
      a[key] = r.pick(JUNK)
      lastWhat = `${key}: ${JSON.stringify(a[key])?.slice(0, 40)}`
      return { signed, o: {} }
    }
    if (kind === 4) return { signed, o: { used: true } } // replayed: its nonce was used
    if (kind === 5) return { signed, o: { now: NOW + 61_000 + r.int(10 ** 9) } } // late: the envelope expired
    if (kind === 6) return { signed, o: { now: NOW - 61_000 - r.int(10 ** 9) } } // dated too far in the future
    if (kind === 8) return { signed: structuredClone(forged), o: {} }
    if (kind === 7)
      return {
        signed,
        o: {
          pending: r.pick([
            undefined,
            { ...pending, expiresAtMs: NOW - 1 },
            { ...pending, payloadHash: "other" },
            { ...pending, nonce: "other" },
          ]),
        },
      }
    return {
      signed: r.pick(JUNK.map((j) => ({ envelope: j, assertion: j }))) as SignedDecision,
      o: {},
    }
  }

  it("accepts no allow from 5,000 tampered, damaged, replayed, late or junk decisions, and never throws", async () => {
    const r = rng(8)
    const accepted: string[] = []
    for (let i = 0; i < 5000; i++) {
      const { signed, o } = broken(r)
      let result
      try {
        result = await check(signed, o)
      } catch (e) {
        throw new Error(`case ${i} threw: ${(e as Error).message}`)
      }
      if (result.ok && result.action.type === "decision" && result.action.decision === "allow")
        accepted.push(lastWhat || JSON.stringify(signed.envelope).slice(0, 200))
    }
    expect(accepted).toEqual([])
    // The control: the same signed allow, untouched, is accepted, so the cases above were refused for a reason.
    expect(await check(valid)).toMatchObject({ ok: true, action: { decision: "allow" } })
  }, 300_000)
})
