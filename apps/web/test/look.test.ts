// @vitest-environment jsdom
// Owner, 25 Nov: "I want the apple style interface on the windows version." Apple style (the Mac's look,
// mac-standard.css) is the usual look on Windows, and Codehouse the other; a Mac always has its own; Windows high
// contrast takes over from either. The stylesheet applies its look under either mark, but what needs the Mac's own
// approval card or Codehouse.app's window stays Mac only.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applyLook, DEFAULT_LOOK, readLook, watchLook } from "../src/lib/look"

const root = () => document.documentElement
beforeEach(() => {
  localStorage.clear()
  delete root().dataset.look
})
afterEach(() => vi.unstubAllGlobals())

describe("the look (owner, 25 Nov)", () => {
  it("is always Apple style, setting aside a Codehouse look an earlier version kept (owner, 25 Nov: as little drift as possible)", () => {
    expect(DEFAULT_LOOK).toBe("apple")
    expect(readLook()).toBe("apple")
    localStorage.setItem("codeh:look", "codehouse")
    expect(readLook()).toBe("apple")
    localStorage.setItem("codeh:look", "something newer")
    expect(readLook()).toBe("apple")
  })

  it("marks Windows for Apple style, but not for Codehouse, not under high contrast, and not a Mac", () => {
    applyLook(root(), "apple", false, false)
    expect(root().dataset.look).toBe("apple")
    applyLook(root(), "codehouse", false, false)
    expect(root().dataset.look).toBeUndefined()
    applyLook(root(), "apple", true, false)
    expect(root().dataset.look).toBeUndefined()
    // A Mac has its own mark (data-platform="mac"), so the look's is not needed.
    applyLook(root(), "apple", false, true)
    expect(root().dataset.look).toBeUndefined()
  })

  it("follows high contrast while the window is open", () => {
    let forced = false
    const listeners: Array<() => void> = []
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("forced-colors") ? forced : false,
      addEventListener: (_: string, f: () => void) => listeners.push(f),
      removeEventListener: () => undefined,
    }))
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" })
    localStorage.setItem("codeh:look", "codehouse")
    const stop = watchLook(root())
    expect(root().dataset.look).toBe("apple")
    forced = true
    for (const f of listeners) f()
    expect(root().dataset.look).toBeUndefined()
    stop()
  })
})

describe("the Apple look's stylesheet (mac-standard.css)", () => {
  const css = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/mac-standard.css"), "utf8")
  const MAC = `:root[data-platform="mac"]`

  it("applies its look on Windows too, under the look's mark", () => {
    expect(css).toContain(`:root:is([data-platform="mac"], [data-look="apple"]) {`)
    expect(css).toContain(`:root:is([data-platform="mac"], [data-look="apple"])[data-theme="dark"] {`)
    expect(css).toContain(`:root:is([data-platform="mac"], [data-look="apple"]) .rail.shell {`)
  })

  it("keeps Mac only just Codehouse.app's window, and hides the card's header copies on every platform", () => {
    const macOnly = css
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith(MAC))
    expect(macOnly.filter((l) => !l.includes("data-mac-"))).toEqual([])
    expect(macOnly.length).toBeGreaterThan(0)
    // The card's grouped rows are drawn on every platform, so their header copies are hidden whatever the look.
    for (const rule of [`:root .pass-head > span:not(.ml-auto) {`, `:root .pass-head > .ml-auto {`, `:root .pass-alert-icon {`]) expect(css).toContain(rule)
  })
})
