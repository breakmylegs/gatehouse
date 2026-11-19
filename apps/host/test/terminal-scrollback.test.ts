// T-112: the Host keeps each session's terminal, the last 5,000 lines, for a window that reconnects; Clear empties it.
import { describe, expect, it } from "vitest"
import { SCROLLBACK_LINES, TerminalScrollback } from "../src/terminal-scrollback.js"

describe("terminal scrollback (T-112)", () => {
  it("keeps commands and output in order, joining what runs on, by session", () => {
    const t = new TerminalScrollback()
    t.add("s1", { stream: "cmd", text: "> npm test\n" })
    t.add("s1", { stream: "out", text: "ok 1\n" })
    t.add("s1", { stream: "out", text: "ok 2\n" })
    t.add("s1", { stream: "err", text: "1 warning\n" })
    t.add("s2", { stream: "out", text: "other\n" })
    expect(t.get("s1")).toEqual([
      { stream: "cmd", text: "> npm test\n" },
      { stream: "out", text: "ok 1\nok 2\n" },
      { stream: "err", text: "1 warning\n" },
    ])
    t.clear("s1")
    expect(t.get("s1")).toEqual([])
    expect(t.get("s2")).toHaveLength(1)
  })

  it("keeps only the last 5,000 lines, dropping whole lines from the start", () => {
    const t = new TerminalScrollback()
    t.add("s1", { stream: "cmd", text: "> big\n" })
    for (let i = 0; i < 6000; i++) t.add("s1", { stream: "out", text: `line ${i}\n` })
    const all = t.get("s1").map((c) => c.text).join("")
    expect(all.split("\n").length - 1).toBe(SCROLLBACK_LINES)
    expect(all.startsWith("line 1000\n")).toBe(true)
    expect(all.endsWith("line 5999\n")).toBe(true)
  })
})
