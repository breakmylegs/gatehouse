// U2: the sessions that need you, beside the requests waiting on you, worked out from the Host's session list.
import { describe, expect, it } from "vitest"
import { needsYou } from "../src/lib/needsYou"

const base = {
  cwd: "C:/dev/shop",
  project: "shop",
  mode: "default" as const,
  pendingApprovals: 0,
  createdAt: "2026-11-09T09:00:00Z",
}
const NOW = 1_000_000_000

describe("sessions that need you", () => {
  it("lists one stopped by an error, an Extreme run stopped short, and a turn that may be stuck", () => {
    const list = needsYou(
      {
        a: { ...base, id: "a", state: "error", error: "Claude Code stopped" },
        b: {
          ...base,
          id: "b",
          state: "idle",
          carryOn: { turns: 200, spentUsd: 3, ended: "turns" },
        },
        c: { ...base, id: "c", state: "running" },
        d: { ...base, id: "d", state: "running" },
        e: { ...base, id: "e", state: "idle", carryOn: { turns: 4, spentUsd: 1, ended: "done" } },
        f: { ...base, id: "f", state: "running", pendingApprovals: 1 },
        g: { ...base, id: "g", state: "error", archived: true },
      },
      {
        c: { last: NOW - 130_000, done: 10, now: 0 },
        d: { last: NOW - 5_000, done: 10, now: 0 },
        f: { last: NOW - 300_000, done: 0, now: 0 },
      },
      NOW,
    )
    expect(list.map((x) => [x.sessionId, x.kind])).toEqual([
      ["a", "failed"],
      ["b", "stopped"],
      ["c", "stuck"],
    ])
    expect(list[0]!.text).toContain("Claude Code stopped")
  })

  it("is empty when every session is fine", () => {
    expect(needsYou({ a: { ...base, id: "a", state: "idle" } }, {}, NOW)).toEqual([])
  })
})
