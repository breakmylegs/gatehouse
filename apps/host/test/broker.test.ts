import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { computePayloadHash, UUID_V7, type EscalationRequest, type Verdict } from "@gatehouse/shared"
import { redact } from "@gatehouse/policy"
import { Broker, type BrokerOptions, type PhoneChannel, type Resolution } from "../src/broker.js"
import type { QuietHours } from "../src/quiet-hours.js"

const verdict: Verdict = {
  outcome: "escalate",
  ruleId: "git-remote",
  reason: "Needs your approval",
  risk: 80,
  decidedBy: "rules",
  policyHash: "h".repeat(64),
}

function spec(over: Partial<Parameters<Broker["request"]>[0]> = {}) {
  return {
    kind: "permission" as const,
    sessionId: "s1",
    toolUseId: "tu1",
    toolName: "Bash",
    input: { command: "git push" },
    cwd: "C:/dev/app",
    project: "app",
    verdict,
    ...over,
  }
}

class FakePhone implements PhoneChannel {
  delivered: EscalationRequest[] = []
  cancelled: { id: string; summary: string }[] = []
  fail = false
  async deliver(r: EscalationRequest) {
    if (this.fail) throw new Error("push failed")
    this.delivered.push(r)
  }
  async cancel(id: string, summary: string) {
    this.cancelled.push({ id, summary })
  }
}

function make(over: Partial<BrokerOptions> = {}) {
  const phone = new FakePhone()
  const broker = new Broker({
    phoneExpiryMs: 10 * 60_000,
    hardTimeoutMs: 30 * 60_000,
    redact: (v) => redact(v, { terms: ["AcmeCorp"] }),
    phone,
    ...over,
  })
  return { broker, phone }
}

const firstId = (b: Broker) => b.list()[0]?.request.id as string

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-03-10T12:00:00.000Z"))
})
afterEach(() => vi.useRealTimers())

describe("creating a request", () => {
  it("builds a contract-shaped request: UUIDv7 id, nonce, redacted input, expiry, payload hash", async () => {
    const { broker } = make()
    const secret = "ghp_" + "Ab1Cd2Ef3G".repeat(4)
    void broker.request(spec({ input: { command: `echo ${secret} AcmeCorp` }, cwd: "C:/clients/AcmeCorp", project: "AcmeCorp" }))
    const view = broker.list()[0]
    expect(view).toBeDefined()
    const r = view?.request as EscalationRequest
    expect(r.id).toMatch(UUID_V7)
    expect(Buffer.from(r.nonce, "base64url")).toHaveLength(32)
    expect(r.createdAt).toBe("2026-03-10T12:00:00.000Z")
    expect(r.expiresAt).toBe("2026-03-10T12:10:00.000Z")
    expect(JSON.stringify(r)).not.toContain(secret)
    expect(JSON.stringify(r)).not.toContain("AcmeCorp")
    expect(view?.rawInput).toEqual({ command: `echo ${secret} AcmeCorp` })
    const { payloadHash, ...rest } = r
    expect(payloadHash).toBe(computePayloadHash(rest))
    expect(view?.hardDeadline).toBe("2026-03-10T12:30:00.000Z")
  })

  it("gives every request its own id and nonce, and lists them", () => {
    const { broker } = make()
    void broker.request(spec())
    void broker.request(spec({ sessionId: "s2" }))
    const [a, b] = broker.list().map((v) => v.request)
    expect(a?.id).not.toBe(b?.id)
    expect(a?.nonce).not.toBe(b?.nonce)
    expect(broker.countFor("s1")).toBe(1)
    expect(broker.countFor("s2")).toBe(1)
    expect(broker.get(a?.id as string)?.request).toBe(a)
    expect(broker.get("nope")).toBeUndefined()
  })
})

describe("first valid answer wins", () => {
  it("resolves an allow from the desktop", async () => {
    const { broker } = make()
    const p = broker.request(spec())
    const r = broker.resolve(firstId(broker), { kind: "decision", decision: "allow" }, "desktop")
    expect(r.ok).toBe(true)
    await expect(p).resolves.toMatchObject({ outcome: "allow", channel: "desktop" })
    expect(broker.list()).toEqual([])
  })

  it("lets the desktop win and gives the phone nothing to answer, and tells the phone the outcome", async () => {
    const { broker, phone } = make()
    const p = broker.request(spec())
    const id = firstId(broker)
    expect(broker.resolve(id, { kind: "decision", decision: "allow" }, "desktop").ok).toBe(true)
    expect(broker.resolve(id, { kind: "decision", decision: "deny" }, "phone")).toEqual({ ok: false, reason: "not-pending" })
    expect((await p).outcome).toBe("allow")
    expect(phone.cancelled).toHaveLength(1)
    expect(phone.cancelled[0]?.summary).toMatch(/^Approved on desktop at \d\d:\d\d$/)
  })

  it("lets the phone win and says so on the desktop event", async () => {
    const { broker } = make()
    const resolved: Resolution[] = []
    broker.on("resolved", (e) => resolved.push(e.resolution))
    const p = broker.request(spec())
    broker.resolve(firstId(broker), { kind: "decision", decision: "deny", message: "not now" }, "phone")
    await expect(p).resolves.toMatchObject({ outcome: "deny", channel: "phone", message: "not now" })
    expect(resolved).toHaveLength(1)
  })

  it("lets exactly one of many racing answers win", async () => {
    const { broker } = make()
    const p = broker.request(spec())
    const id = firstId(broker)
    const results = [
      broker.resolve(id, { kind: "decision", decision: "allow" }, "desktop"),
      broker.resolve(id, { kind: "decision", decision: "deny" }, "phone"),
      broker.resolve(id, { kind: "decision", decision: "allow" }, "phone"),
      broker.resolve(id, { kind: "decision", decision: "deny" }, "desktop"),
    ]
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect((await p).outcome).toBe("allow")
  })

  it("does not accept an answer for an unknown request", () => {
    const { broker } = make()
    expect(broker.resolve("nope", { kind: "decision", decision: "allow" }, "desktop")).toEqual({ ok: false, reason: "not-pending" })
  })

  it("records how long the person took", async () => {
    const { broker } = make()
    const p = broker.request(spec())
    vi.advanceTimersByTime(7_000)
    broker.resolve(firstId(broker), { kind: "decision", decision: "allow" }, "desktop")
    expect((await p).waitedMs).toBe(7000)
  })
})

describe("answer validation (invariant 11: the phone cannot edit or create rules)", () => {
  it("lets the desktop edit the input and ask to remember, and the phone do neither", () => {
    const { broker } = make()
    void broker.request(spec())
    const id = firstId(broker)
    const edited = { command: "git push origin feature" }
    expect(broker.resolve(id, { kind: "decision", decision: "allow", updatedInput: edited }, "phone")).toMatchObject({
      ok: false,
      reason: "not-allowed-on-channel",
    })
    expect(broker.resolve(id, { kind: "decision", decision: "allow", remember: true }, "phone")).toMatchObject({
      ok: false,
      reason: "not-allowed-on-channel",
    })
    expect(broker.list()).toHaveLength(1) // a refused answer leaves the request open
    const r = broker.resolve(id, { kind: "decision", decision: "allow", updatedInput: edited, remember: true }, "desktop")
    expect(r).toMatchObject({ ok: true, resolution: { updatedInput: edited, remember: true } })
  })

  it("limits messages to 500 characters and rejects a denial that carries edits", () => {
    const { broker } = make()
    void broker.request(spec())
    const id = firstId(broker)
    expect(broker.resolve(id, { kind: "decision", decision: "deny", message: "x".repeat(501) }, "desktop")).toMatchObject({
      ok: false,
      reason: "invalid-answer",
    })
    expect(broker.resolve(id, { kind: "decision", decision: "deny", updatedInput: {} }, "desktop")).toMatchObject({
      ok: false,
      reason: "invalid-answer",
    })
    expect(broker.resolve(id, { kind: "decision", decision: "deny", remember: true }, "desktop")).toMatchObject({
      ok: false,
      reason: "invalid-answer",
    })
    expect(broker.resolve(id, { kind: "decision", decision: "maybe" as never }, "desktop")).toMatchObject({ ok: false, reason: "invalid-answer" })
    expect(broker.resolve(id, { kind: "decision", decision: "allow", updatedInput: "x" as never }, "desktop")).toMatchObject({
      ok: false,
      reason: "invalid-answer",
    })
    expect(broker.resolve(id, { kind: "decision", decision: "deny", message: "x".repeat(500) }, "desktop").ok).toBe(true)
  })

  const questionInput = {
    questions: [
      { question: "Which library?", header: "Library", options: [{ label: "a" }, { label: "b" }] },
      { question: "Which mode?", header: "Mode", options: [{ label: "x" }, { label: "y" }] },
    ],
  }

  it("takes answers keyed by the question text, all of them, from either channel", async () => {
    const { broker } = make()
    const p = broker.request(spec({ kind: "question", toolName: "AskUserQuestion", input: questionInput }))
    const id = firstId(broker)
    expect(broker.resolve(id, { kind: "answers", answers: { "Which library?": "a" } }, "phone")).toMatchObject({ ok: false, detail: "Every question needs an answer" })
    expect(broker.resolve(id, { kind: "answers", answers: { "Which library?": "a", "Which mode?": "x", "Extra?": "y" } }, "phone")).toMatchObject({ ok: false })
    expect(broker.resolve(id, { kind: "answers", answers: { "Which library?": "a", "Which mode?": "" } }, "phone")).toMatchObject({ ok: false })
    expect(broker.resolve(id, { kind: "answers", answers: {} }, "phone")).toMatchObject({ ok: false })
    expect(broker.resolve(id, { kind: "decision", decision: "allow" }, "desktop")).toMatchObject({ ok: false })
    const ok = broker.resolve(id, { kind: "answers", answers: { "Which library?": "a", "Which mode?": "x, y" } }, "phone")
    expect(ok.ok).toBe(true)
    await expect(p).resolves.toMatchObject({ outcome: "allow", channel: "phone", answers: { "Which library?": "a", "Which mode?": "x, y" } })
  })

  it("lets a question be declined, and refuses answers for a permission request", async () => {
    const { broker } = make()
    const q = broker.request(spec({ kind: "question", toolName: "AskUserQuestion", input: questionInput }))
    broker.resolve(firstId(broker), { kind: "decision", decision: "deny", message: "skip" }, "desktop")
    expect((await q).outcome).toBe("deny")
    void broker.request(spec())
    expect(broker.resolve(firstId(broker), { kind: "answers", answers: { x: "y" } }, "desktop")).toMatchObject({
      ok: false,
      detail: "This request is not a question",
    })
  })

  it("treats a plan like a permission request", async () => {
    const { broker } = make()
    const p = broker.request(spec({ kind: "plan", toolName: "ExitPlanMode", input: { plan: "do things" } }))
    broker.resolve(firstId(broker), { kind: "decision", decision: "deny", message: "add tests first" }, "desktop")
    await expect(p).resolves.toMatchObject({ outcome: "deny", message: "add tests first" })
  })
})

describe("timeouts", () => {
  it("expires delivery to the phone after 10 minutes but keeps waiting on the desktop, then times out at 30", async () => {
    const { broker, phone } = make()
    const phoneStates: string[] = []
    broker.on("phone", (e) => phoneStates.push(e.status))
    const p = broker.request(spec())
    expect(broker.list()[0]?.phone).toBe("delivered")
    expect(phone.delivered).toHaveLength(1)

    vi.advanceTimersByTime(10 * 60_000 + 1)
    expect(broker.list()[0]?.phone).toBe("expired")
    expect(phone.cancelled.at(-1)?.summary).toContain("Expired on the phone")
    expect(broker.list()).toHaveLength(1)
    expect(broker.resolve(firstId(broker), { kind: "decision", decision: "allow" }, "desktop").ok).toBe(true)
    expect((await p).outcome).toBe("allow")
    expect(phoneStates).toEqual(["delivered", "expired"])
  })

  it("denies as timed out after the hard timeout, with the spec's words", async () => {
    const { broker } = make()
    const p = broker.request(spec())
    vi.advanceTimersByTime(30 * 60_000 + 1)
    await expect(p).resolves.toMatchObject({ outcome: "timeout", channel: "timeout", message: "Timed out waiting for approval" })
    expect(broker.list()).toEqual([])
  })

  it("uses configurable timeouts", async () => {
    const { broker } = make({ hardTimeoutMs: 5000, phoneExpiryMs: 2000 })
    const p = broker.request(spec())
    vi.advanceTimersByTime(5001)
    expect((await p).outcome).toBe("timeout")
  })

  it("ignores an answer that arrives after the timeout", async () => {
    const { broker } = make()
    const p = broker.request(spec())
    const id = firstId(broker)
    vi.advanceTimersByTime(30 * 60_000 + 1)
    await p
    expect(broker.resolve(id, { kind: "decision", decision: "allow" }, "desktop")).toEqual({ ok: false, reason: "not-pending" })
  })
})

describe("cancellation", () => {
  it("cancels when the SDK aborts the call", async () => {
    const { broker } = make()
    const ac = new AbortController()
    const p = broker.request(spec({ signal: ac.signal }))
    ac.abort()
    await expect(p).resolves.toMatchObject({ outcome: "cancelled", channel: "host" })
    expect(broker.list()).toEqual([])
  })

  it("cancels at once when the signal is already aborted", async () => {
    const { broker } = make()
    const ac = new AbortController()
    ac.abort()
    await expect(broker.request(spec({ signal: ac.signal }))).resolves.toMatchObject({ outcome: "cancelled" })
    expect(broker.list()).toEqual([])
  })

  it("cancels one session's requests and leaves the others", async () => {
    const { broker } = make()
    const a = broker.request(spec({ sessionId: "a" }))
    const b = broker.request(spec({ sessionId: "b" }))
    expect(broker.cancelSession("a")).toBe(1)
    expect((await a).outcome).toBe("cancelled")
    expect(broker.list()).toHaveLength(1)
    broker.cancelSession("b", "gone")
    await expect(b).resolves.toMatchObject({ outcome: "cancelled", message: "gone" })
  })

  it("cancels everything for the kill switch", async () => {
    const { broker } = make()
    const all = [broker.request(spec({ sessionId: "a" })), broker.request(spec({ sessionId: "b" })), broker.request(spec({ sessionId: "c" }))]
    expect(broker.cancelAll()).toBe(3)
    const results = await Promise.all(all)
    expect(results.every((r) => r.outcome === "cancelled" && r.message === "The kill switch was engaged")).toBe(true)
    expect(broker.cancelAll()).toBe(0)
  })

  it("stops listening to the signal once answered", async () => {
    const { broker } = make()
    const ac = new AbortController()
    const p = broker.request(spec({ signal: ac.signal }))
    broker.resolve(firstId(broker), { kind: "decision", decision: "allow" }, "desktop")
    await p
    ac.abort()
    expect((await p).outcome).toBe("allow")
  })
})

describe("quiet hours and the phone", () => {
  const quiet: QuietHours = { start: "22:00", end: "07:00", tz: "Europe/London", phone: false }

  it("holds phone delivery in quiet hours, still shows the request, and delivers when they end", async () => {
    vi.setSystemTime(new Date("2026-01-15T23:00:00Z"))
    const { broker, phone } = make({ quietHours: () => quiet, phoneExpiryMs: 12 * 3600_000, hardTimeoutMs: 24 * 3600_000 })
    const p = broker.request(spec())
    expect(broker.list()[0]?.phone).toBe("held")
    expect(phone.delivered).toHaveLength(0)
    expect(broker.resolve(firstId(broker), { kind: "decision", decision: "allow" }, "desktop").ok).toBe(true) // the desktop still works
    await p

    const again = broker.request(spec())
    vi.advanceTimersByTime(8 * 3600_000 + 5000)
    expect(phone.delivered).toHaveLength(1)
    expect(broker.list()[0]?.phone).toBe("delivered")
    broker.cancelAll()
    await again
  })

  it("never delivers a held request whose phone expiry has passed", async () => {
    vi.setSystemTime(new Date("2026-01-15T23:00:00Z"))
    const { broker, phone } = make({ quietHours: () => quiet, phoneExpiryMs: 60_000, hardTimeoutMs: 24 * 3600_000 })
    const p = broker.request(spec())
    vi.advanceTimersByTime(9 * 3600_000)
    expect(phone.delivered).toHaveLength(0)
    expect(broker.list()[0]?.phone).toBe("expired")
    broker.cancelAll()
    await p
  })

  it("tells the phone straight away when quiet hours allow it, or when none are set", () => {
    vi.setSystemTime(new Date("2026-01-15T23:00:00Z"))
    const a = make({ quietHours: () => ({ ...quiet, phone: true }) })
    void a.broker.request(spec())
    expect(a.phone.delivered).toHaveLength(1)
    const b = make()
    void b.broker.request(spec())
    expect(b.phone.delivered).toHaveLength(1)
  })

  it("works without a phone channel at all", async () => {
    const broker = new Broker({ phoneExpiryMs: 1000, hardTimeoutMs: 5000, redact: (v) => v })
    const p = broker.request(spec())
    expect(broker.list()[0]?.phone).toBe("none")
    vi.advanceTimersByTime(1500)
    expect(broker.list()[0]?.phone).toBe("none")
    broker.resolve(firstId(broker), { kind: "decision", decision: "allow" }, "desktop")
    expect((await p).outcome).toBe("allow")
  })

  it("reports a failed push as not delivered", async () => {
    const { broker, phone } = make()
    phone.fail = true
    const states: string[] = []
    broker.on("phone", (e) => states.push(e.status))
    void broker.request(spec())
    await vi.advanceTimersByTimeAsync(1)
    expect(states).toEqual(["delivered", "none"])
    expect(broker.list()[0]?.phone).toBe("none")
  })
})

describe("events and defaults", () => {
  it("emits created and resolved, and carries defaultToNo", async () => {
    const { broker } = make()
    const events: string[] = []
    broker.on("created", (v) => events.push(`created:${v.defaultToNo}`))
    broker.on("resolved", (e) => events.push(`resolved:${e.resolution.outcome}`))
    const p = broker.request(spec({ defaultToNo: true }))
    broker.resolve(firstId(broker), { kind: "decision", decision: "deny" }, "desktop")
    await p
    expect(events).toEqual(["created:true", "resolved:deny"])
  })
})
