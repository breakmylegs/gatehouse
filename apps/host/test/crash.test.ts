import { describe, expect, it } from "vitest"
import {
  CRASH_WINDOW_MS,
  CrashRestarts,
  describeStop,
  exitCodeOf,
  isProcessCrash,
} from "../src/crash.js"

describe("a Claude Code process that stopped", () => {
  it("reads the exit code, including one reported as a negative 32-bit number", () => {
    expect(exitCodeOf("Claude Code process exited with code 3221226505")).toBe(0xc0000409)
    expect(exitCodeOf("Claude Code process exited with code -1073740791")).toBe(0xc0000409)
    expect(exitCodeOf("The session was closed")).toBeUndefined()
  })

  it("puts the crash in the owner's screenshot into words, with its Windows code", () => {
    const words = describeStop("Claude Code process exited with code 3221226505")
    expect(words).toContain("low on memory")
    expect(words).toContain("0xC0000409")
    expect(words).not.toContain("3221226505")
  })

  it("leaves a message it does not know as it was", () => {
    expect(describeStop("Claude Code process exited with code 1")).toBe(
      "Claude Code process exited with code 1",
    )
    expect(describeStop("Something else went wrong")).toBe("Something else went wrong")
  })

  it("counts only Windows crash codes as a crash, and not being stopped on purpose", () => {
    expect(isProcessCrash("Claude Code process exited with code 3221226505")).toBe(true)
    expect(isProcessCrash("Claude Code process exited with code 3221225477")).toBe(true)
    // A plain exit can be Claude Code refusing to go on.
    expect(isProcessCrash("Claude Code process exited with code 1")).toBe(false)
    expect(isProcessCrash("Claude Code process exited with code 0")).toBe(false)
    // Ctrl+C from outside, and Windows closing it at sign-out.
    expect(isProcessCrash("Claude Code process exited with code 3221225786")).toBe(false)
    expect(isProcessCrash("Claude Code process exited with code 1073807364")).toBe(false)
    expect(isProcessCrash("The SDK reported that canUseTool is shadowed")).toBe(false)
  })
})

describe("starting again after a crash", () => {
  it("allows two starts per session in 30 minutes, then none until the window moves on", () => {
    const r = new CrashRestarts()
    const t = 1_000_000
    expect(r.take("a", t)).toBe(true)
    expect(r.take("a", t + 1000)).toBe(true)
    expect(r.take("a", t + 2000)).toBe(false)
    // Another session has its own count.
    expect(r.take("b", t + 2000)).toBe(true)
    expect(r.take("a", t + CRASH_WINDOW_MS + 1)).toBe(true)
    expect(r.take("a", t + CRASH_WINDOW_MS + 2)).toBe(false)
  })
})
