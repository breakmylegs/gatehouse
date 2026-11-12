// Backlog G32, first part: the open sessions as the phone may see them, redacted, newest first, read only; shared
// soon after a change, not more often than the gap, and not at all without a paired phone.
import { describe, expect, it, vi } from "vitest"
import {
  buildPhoneSessions,
  MAX_PHONE_SESSIONS,
  PHONE_SNAPSHOT_BYTES,
  PhoneLive,
  PhoneSessionsSharer,
} from "../src/phone-sessions.js"

const session = (id: string, createdAt: string, extra: Record<string, unknown> = {}) => ({
  id,
  cwd: "C:/dev/shop",
  project: "shop",
  mode: "default" as const,
  state: "idle" as const,
  pendingApprovals: 0,
  createdAt,
  sdkSessionId: `sdk-${id}`,
  ...extra,
})

describe("the sessions the phone sees", () => {
  it("lists open sessions newest first, with a redacted excerpt of what was said, and leaves ended ones out", async () => {
    const snap = await buildPhoneSessions({
      list: () =>
        [
          session("a", "2026-11-09T08:00:00Z", { title: "Fix the key sk-ant-secret" }),
          session("b", "2026-11-09T09:00:00Z", { state: "waiting", pendingApprovals: 2 }),
          session("c", "2026-11-09T10:00:00Z", { state: "ended" }),
          session("d", "2026-11-09T07:00:00Z", { archived: true }),
        ] as never,
      messages: async (sdk) => [
        { type: "user", message: { content: `Please look at ${sdk}` } },
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "The token is sk-ant-secret" }] },
        },
      ],
      redact: (t) => t.replace(/sk-ant-\w+/g, "[redacted]"),
      now: () => new Date("2026-11-09T11:00:00Z"),
    })
    expect(snap.at).toBe("2026-11-09T11:00:00.000Z")
    expect(snap.sessions.map((s) => [s.id, s.state, s.waiting])).toEqual([
      ["b", "waiting", 2],
      ["a", "idle", 0],
    ])
    expect(snap.sessions[1]!.title).toBe("Fix the key [redacted]")
    expect(snap.sessions[1]!.latest).toBe(
      "You: Please look at sdk-a\nClaude: The token is [redacted]",
    )
    expect(JSON.stringify(snap)).not.toContain("sk-ant-secret")
  })

  it("shows at most the newest sessions, and a session that cannot be read with no excerpt", async () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      session(`s${i}`, `2026-11-09T${String(i).padStart(2, "0")}:00:00Z`),
    )
    const snap = await buildPhoneSessions({
      list: () => many as never,
      messages: async () => {
        throw new Error("gone")
      },
      redact: (t) => t,
    })
    expect(snap.sessions).toHaveLength(MAX_PHONE_SESSIONS)
    expect(snap.sessions[0]!.id).toBe("s19")
    expect(snap.sessions[0]!.latest).toBe("")
    expect(snap).not.toHaveProperty("templates")
  })

  it("lists the routines allowed for the phone by name only, redacted", async () => {
    const snap = await buildPhoneSessions({
      list: () => [],
      messages: async () => [],
      redact: (t) => t.replace("acme", "[redacted]"),
      templates: () => [{ id: "r1", name: "Nightly acme triage" }],
    })
    expect(snap.templates).toEqual([{ id: "r1", name: "Nightly [redacted] triage" }])
  })
})

describe("sharing them", () => {
  it("shares once soon after changes, and nothing without a paired phone", async () => {
    vi.useFakeTimers()
    try {
      let paired = false
      const share = vi.fn(async () => undefined)
      const build = vi.fn(async () => ({ at: "x", sessions: [] }))
      const s = new PhoneSessionsSharer({
        build,
        share,
        log: () => undefined,
        minGapMs: 15_000,
        wanted: () => paired,
      })
      await s.shareNow()
      expect(build).not.toHaveBeenCalled()
      paired = true
      await s.shareNow()
      expect(share).toHaveBeenCalledTimes(1)
      // Three changes within the gap: one share, when the gap is over.
      s.poke()
      s.poke()
      s.poke()
      await vi.advanceTimersByTimeAsync(14_000)
      expect(share).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(2_000)
      expect(share).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

// Owner, 11 Nov: "a way to actually see the sessions remotely and be able to send prompts and see the ongoing status".
describe("what each session is doing, as it happens", () => {
  const toolCall = (id: string, command: string) => ({
    type: "assistant",
    uuid: id,
    message: {
      content: [
        { type: "text", text: "I will run the tests." },
        { type: "tool_use", id: `t-${id}`, name: "Bash", input: { command } },
      ],
    },
  })

  it("tells the phone what a working session is doing and its steps, redacted, reading the transcript once", async () => {
    let clock = 1_000_000
    const live = new PhoneLive(() => clock)
    const messages = vi.fn(async () => [
      { type: "user", uuid: "u1", message: { content: "Fix the basket" } },
      { type: "assistant", uuid: "a1", message: { content: [{ type: "text", text: "Looking now." }] } },
    ])
    const list = () => [session("a", "2026-11-11T08:00:00Z", { state: "running" })] as never
    const build = () =>
      buildPhoneSessions({ list, messages, live, redact: (t) => t.replace(/sk-ant-\w+/g, "[redacted]") })
    await build()
    // What the stream adds after the transcript was read.
    expect(live.message("a", toolCall("a2", "npm test -- --token sk-ant-abc"))).toBe(true)
    // A subagent's own steps stay out, as on the desktop.
    live.message("a", { ...toolCall("x1", "rm -rf build"), parent_tool_use_id: "t-a2" })
    clock += 12_000
    const snap = await build()
    expect(messages).toHaveBeenCalledTimes(1)
    const s = snap.sessions[0]!
    expect(s.activity).toEqual({
      phase: "running",
      since: new Date(1_000_000).toISOString(),
      tool: "Bash",
      target: "npm test -- --token [redacted]",
    })
    expect(s.recent).toEqual([
      { who: "you", text: "Fix the basket" },
      { who: "claude", text: "Looking now." },
      { who: "claude", text: "I will run the tests." },
      { who: "tool", text: "Bash: npm test -- --token [redacted]" },
    ])
    expect(JSON.stringify(snap)).not.toContain("sk-ant-abc")
    expect(JSON.stringify(snap)).not.toContain("rm -rf")
    // The result ends the turn: no activity is shown for an idle session.
    live.message("a", { type: "result", subtype: "success" })
    const idle = await buildPhoneSessions({ list: () => [session("a", "x")] as never, messages, live, redact: (t) => t })
    expect(idle.sessions[0]!.activity).toBeUndefined()
  })

  it("shows your message at once, once, and the session as waiting for Claude to start", async () => {
    const live = new PhoneLive(() => 5_000)
    live.seed("a", [])
    live.prompted("a", "Run the tests")
    expect(live.activity("a")).toEqual({ phase: "sent", since: 5_000 })
    // The SDK's own copy of it does not show it twice.
    live.message("a", { type: "user", uuid: "u9", message: { content: "Run the tests" } })
    expect(live.entries("a")).toEqual([{ who: "you", text: "Run the tests" }])
    // A message sent before the transcript was first read is not shown twice either.
    const fresh = new PhoneLive()
    fresh.prompted("b", "Hello")
    fresh.seed("b", [{ type: "user", uuid: "u1", message: { content: "Hello" } }] as never)
    expect(fresh.entries("b")).toEqual([{ who: "you", text: "Hello" }])
  })

  it("keeps the snapshot small enough for the Relay, keeping the newest steps", async () => {
    const live = new PhoneLive()
    const many = Array.from({ length: MAX_PHONE_SESSIONS }, (_, i) =>
      session(`s${i}`, `2026-11-11T${String(i).padStart(2, "0")}:00:00Z`, { state: "running" }),
    )
    const said = (i: number) => ({
      type: "assistant",
      uuid: `m${i}`,
      message: { content: [{ type: "text", text: `step ${i} ${"é".repeat(900)}` }] },
    })
    const snap = await buildPhoneSessions({
      list: () => many as never,
      messages: async () => Array.from({ length: 60 }, (_, i) => said(i)),
      live,
      redact: (t) => t,
    })
    expect(Buffer.byteLength(JSON.stringify(snap), "utf8")).toBeLessThanOrEqual(PHONE_SNAPSHOT_BYTES)
    const first = snap.sessions[0]!
    expect(first.recent?.at(-1)?.text).toMatch(/^step 59 /)
  })

  it("shares a change that came while a share was under way, after it", async () => {
    vi.useFakeTimers()
    try {
      let release: () => void = () => undefined
      const share = vi.fn(() => new Promise<void>((r) => (release = r)))
      const s = new PhoneSessionsSharer({ build: async () => ({ at: "x", sessions: [] }), share, log: () => undefined, minGapMs: 3_000 })
      const first = s.shareNow()
      await vi.advanceTimersByTimeAsync(0)
      s.poke()
      release()
      await first
      await vi.advanceTimersByTimeAsync(3_000)
      expect(share).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
