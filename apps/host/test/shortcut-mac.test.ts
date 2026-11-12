// Mac fork. W1-15 on a Mac: the quick prompt's shortcut, as packaging/mac/Shortcut.swift reads it. Built with swiftc
// and run for real. A shortcut chosen on Windows (Ctrl+Alt+Space, the page's default) must still work on a Mac.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const REPO = path.resolve(import.meta.dirname, "../../..")
const swiftc = process.platform === "darwin" ? "/usr/bin/swiftc" : undefined
const can = swiftc !== undefined && fs.existsSync(swiftc)
let dir: string
let exe: string
const run = (...args: string[]) => execFileSync(exe, args).toString().trim()
const parse = (text: string) => JSON.parse(run("--parse", text)) as Record<string, unknown>
const alternatives = (text: string, taken: string[] = []) =>
  run("--alternatives", text, taken.join(",")).split("\n").filter(Boolean)

beforeAll(() => {
  if (!can) return
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-shortcut-mac-"))
  exe = path.join(dir, "shortcut")
  execFileSync(swiftc, [
    "-O",
    "-o",
    exe,
    ...["NavGuard.swift", "Shortcut.swift", "Host.swift", "test/main.swift"].map((f) =>
      path.join(REPO, "packaging", "mac", f),
    ),
  ])
}, 180_000)
afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(!can)("the quick prompt's shortcut on a Mac", () => {
  it("reads the page's Windows default as Control, Option and Space, written the Mac's way", () => {
    // controlKey | optionKey, and kVK_Space.
    expect(parse("Ctrl+Alt+Space")).toEqual({
      ok: true,
      text: "Control+Option+Space",
      mods: 0x1800,
      key: 0x31,
    })
    expect(parse("control+option+space").text).toBe("Control+Option+Space")
  })

  it("reads Win as Command and writes the modifiers in Apple's order", () => {
    expect(parse("Shift+Win+K")).toMatchObject({ ok: true, text: "Shift+Command+K", mods: 0x300 })
    expect(parse("Cmd+Shift+Option+Ctrl+F12").text).toBe("Control+Option+Shift+Command+F12")
    expect(parse("⌃⌥".split("").join("+") + "+J").text).toBe("Control+Option+J")
  })

  it("refuses a shortcut that would type in other apps, or that is not one shortcut", () => {
    expect(parse("Shift+K")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Control, Option or Command/),
    })
    expect(parse("K")).toMatchObject({ ok: false })
    expect(parse("Ctrl+Alt")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Add a key/),
    })
    expect(parse("Ctrl+K+J")).toMatchObject({ ok: false, error: expect.stringMatching(/one key/) })
    expect(parse("Ctrl+Ctrl+K")).toMatchObject({ ok: false, error: expect.stringMatching(/twice/) })
    expect(parse("Ctrl+Insert")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/not a key/),
    })
    expect(parse("Ctrl+F21")).toMatchObject({ ok: false })
    expect(parse("  ")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Type a shortcut/),
    })
  })

  it("offers three free alternatives near the one asked for, never one that is taken", () => {
    expect(alternatives("Ctrl+Alt+Space")).toEqual([
      "Control+Option+Shift+Space",
      "Control+Shift+Space",
      "Option+Shift+Space",
    ])
    const free = alternatives("Ctrl+Alt+Space", [
      "Control+Option+Shift+Space",
      "Control+Shift+Space",
    ])
    expect(free).toHaveLength(3)
    expect(free).not.toContain("Control+Shift+Space")
    expect(free[0]).toBe("Option+Shift+Space")
  })
})
