// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { isMac, keyLabel, markPlatform, systemName } from "../src/lib/platform-mac"

const SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)"
const EDGE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edg/140.0"

describe("the interface on a Mac", () => {
  it("knows a Mac from its browser, and names the system in copy", () => {
    expect(isMac(SAFARI)).toBe(true)
    expect(isMac(EDGE)).toBe(false)
    expect(systemName(true)).toBe("macOS")
    expect(systemName(false)).toBe("Windows")
  })

  it("shows every shortcut the way a Mac does, with modifiers in Apple's order", () => {
    expect(keyLabel("Ctrl K", true)).toBe("⌘K")
    expect(keyLabel("Ctrl Shift K", true)).toBe("⇧⌘K")
    expect(keyLabel("Ctrl Shift ;", true)).toBe("⇧⌘;")
    expect(keyLabel("Ctrl 1 to 9", true)).toBe("⌘1 to 9")
    expect(keyLabel("Alt Up, Alt Down", true)).toBe("⌥↑, ⌥↓")
    expect(keyLabel("Ctrl Enter", true)).toBe("⌘↩")
    expect(keyLabel("D, M, E, R, Shift S", true)).toBe("D, M, E, R, ⇧S")
    expect(keyLabel("Esc", true)).toBe("Esc")
    expect(keyLabel("F1", true)).toBe("F1")
  })

  it("leaves every shortcut as it was on Windows", () => {
    for (const k of ["Ctrl K", "Ctrl Shift K", "Alt Up, Alt Down", "F1"])
      expect(keyLabel(k, false)).toBe(k)
  })

  it("marks the page only on a Mac, so mac.css changes nothing on Windows", () => {
    const mac = document.createElement("html")
    markPlatform(mac, true)
    expect(mac.dataset.platform).toBe("mac")
    const win = document.createElement("html")
    markPlatform(win, false)
    expect(win.dataset.platform).toBeUndefined()
  })
})
