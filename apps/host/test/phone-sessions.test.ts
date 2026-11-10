// Backlog G32, first part: the open sessions as the phone may see them, redacted, newest first, read only; shared
// soon after a change, not more often than the gap, and not at all without a paired phone.
import { describe, expect, it, vi } from "vitest"
import {
  buildPhoneSessions,
  MAX_PHONE_SESSIONS,
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
