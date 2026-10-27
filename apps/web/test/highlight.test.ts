import { describe, expect, it } from "vitest"
import { splitByHighlights } from "../src/lib/highlight"

const join = (cmd: string, segs: string[]) =>
  splitByHighlights(cmd, segs)
    .map((p) => (p.hit ? `[${p.text}]` : p.text))
    .join("")

describe("splitByHighlights", () => {
  it("marks the escalating segment and keeps every character", () => {
    expect(join("git push --force origin main && npm publish", ["git push --force origin main"])).toBe(
      "[git push --force origin main] && npm publish",
    )
  })
  it("marks repeated segments in separate places", () => {
    expect(join("rm a; rm a", ["rm a", "rm a"])).toBe("[rm a]; [rm a]")
  })
  it("never doubles overlapping segments", () => {
    const out = splitByHighlights("abcdef", ["abcd", "cdef"])
    expect(out.map((p) => p.text).join("")).toBe("abcdef")
    // The first segment wins, the overlapping one is dropped rather than drawn twice.
    expect(out.filter((p) => p.hit).map((p) => p.text)).toEqual(["abcd"])
  })
  it("ignores a segment that is not in the command and shows the command whole", () => {
    expect(join("ls", ["not there", ""])).toBe("ls")
    expect(splitByHighlights("", [])).toEqual([{ text: "", hit: false }])
  })
  it("handles a 10,000 character command", () => {
    const big = "x".repeat(10_000) + " rm -rf /tmp/y"
    const parts = splitByHighlights(big, ["rm -rf /tmp/y"])
    expect(parts.map((p) => p.text).join("")).toBe(big)
    expect(parts.at(-1)).toEqual({ text: "rm -rf /tmp/y", hit: true })
  })
})
