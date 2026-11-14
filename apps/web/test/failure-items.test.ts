// @vitest-environment jsdom
// T-056 (t3code review): Failures only shows your messages, notices, failed or held tool calls and failed or stopped
// turns, and leaves out Claude's words, its thinking and the calls that worked.
import { describe, expect, it } from "vitest"
import { failureItems } from "../src/lib/groups"
import { readPaneView } from "../src/lib/paneView"
import type { Item } from "../src/lib/transcript"

const items = [
  { kind: "user", id: "u1", text: "fix the build" },
  { kind: "text", id: "t1", text: "Looking now." },
  { kind: "thinking", id: "th1", text: "hmm" },
  { kind: "tool", id: "a", toolUseId: "a", name: "Read", input: {}, result: { isError: false, text: "ok" } },
  { kind: "tool", id: "b", toolUseId: "b", name: "Bash", input: {}, result: { isError: true, text: "exit 1" } },
  { kind: "tool", id: "c", toolUseId: "c", name: "Bash", input: {} },
  { kind: "system", id: "s1", text: "Denied by the floor" },
  { kind: "result", id: "r1", isError: false },
  { kind: "result", id: "r2", isError: true },
  { kind: "result", id: "r3", isError: false, stopped: true },
] as unknown as Item[]

describe("Failures only (T-056)", () => {
  it("keeps what went wrong and what waits on you, and nothing that worked", () => {
    expect(failureItems(items, new Set(["c"])).map((i) => i.id)).toEqual(["u1", "b", "c", "s1", "r2", "r3"])
  })

  it("is remembered per pane, read tolerantly", () => {
    localStorage.setItem("gatehouse.pane.s1", JSON.stringify({ detail: "failures" }))
    expect(readPaneView("s1").detail).toBe("failures")
  })
})
