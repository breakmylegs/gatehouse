// T-024: a finished session not touched for a while is archived by itself, as Archive does; a pinned one, one still
// running, one already archived and one Claude Code never named are left alone; 0 days means never.
import { describe, expect, it } from "vitest"
import { DEFAULT_SETTLE_DAYS, SessionSettler, settleDue } from "../src/session-settle.js"

const DAY = 86_400_000
const now = Date.parse("2026-11-20T12:00:00Z")
const s = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  state: "ended" as const,
  createdAt: new Date(now - 10 * DAY).toISOString(),
  activeAt: new Date(now - 4 * DAY).toISOString(),
  sdkSessionId: `sdk-${id}`,
  cwd: "C:/dev/shop",
  ...o,
})

describe("settling finished sessions (T-024)", () => {
  it("archives only ended sessions quiet for long enough, never a pinned one", () => {
    const list = [
      s("old"),
      s("recent", { activeAt: new Date(now - 1 * DAY).toISOString() }),
      s("pinned", { pinned: true }),
      s("running", { state: "idle" }),
      s("archived", { archived: true }),
      s("unnamed", { sdkSessionId: undefined }),
      s("failed", { state: "error" }),
    ]
    expect(settleDue(list as never, now, 3).map((x) => x.id)).toEqual(["old", "failed"])
    expect(settleDue(list as never, now, 0)).toEqual([])
    expect(DEFAULT_SETTLE_DAYS).toBe(3)
  })

  it("archives what is due through the same path as Archive, and carries on past one that fails", async () => {
    const done: string[] = []
    const logs: string[] = []
    const settler = new SessionSettler({
      list: () => [s("a"), s("b"), s("c")] as never,
      archive: async (x) => {
        if (x.id === "b") throw new Error("disk full")
        done.push(x.sdkSessionId!)
      },
      days: () => undefined,
      log: (l) => void logs.push(l),
      now: () => now,
    })
    expect(await settler.tick()).toBe(2)
    expect(done).toEqual(["sdk-a", "sdk-c"])
    expect(logs.join("\n")).toMatch(/b could not be archived: disk full/)
  })
})
