// Mac fork (16 Nov): the wing beside the notch goes right of another notch app's shape when one covers the notch's
// right side, as Vorssaint's did, so neither hides the other. packaging/mac/NotchPlace.swift, built and run for real.
// The numbers are the ones read off David's Mac: the laptop screen from x -1512 to 0, the notch's right edge at -664,
// Vorssaint's window from -910 to -603 at level 26, above the menu bar's icons at 25.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const REPO = path.resolve(import.meta.dirname, "../../..")
const can = process.platform === "darwin" && fs.existsSync("/usr/bin/swiftc")
let dir: string
let exe: string
const SCREEN = ["-664", "0", "-1512", "0", "52"]
const wingX = (...windows: string[]) => Number(execFileSync(exe, [...SCREEN, ...windows]).toString().trim())
const startOn = (screen: string[], ...windows: string[]) => execFileSync(exe, ["start", ...screen, ...windows]).toString().trim()

beforeAll(() => {
  if (!can) return
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-notch-place-"))
  exe = path.join(dir, "notch-place")
  const mac = (f: string) => path.join(REPO, "packaging", "mac", f)
  execFileSync("/usr/bin/swiftc", ["-O", "-o", exe, mac("NotchPlace.swift"), mac("test/notch/main.swift")])
}, 240_000)
afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(!can)("where the wing beside the notch goes", () => {
  it("against the notch's right edge when nothing covers it", () => {
    expect(wingX()).toBe(-664)
    // The menu bar's own windows and its icons, at their levels and below, are not stepped round.
    expect(wingX("-1512,0,1512,24,0", "-437,0,34,25,0")).toBe(-664)
  })

  it("right of another notch app's shape over the notch, and of one beside it", () => {
    expect(wingX("-910,0,307,26,0")).toBe(-599)
    expect(wingX("-910,0,307,26,0", "-600,0,40,30,0")).toBe(-556)
  })

  it("never over its own window, a full-width overlay, a window lower down, or off the screen", () => {
    expect(wingX("-664,0,60,26,1")).toBe(-664)
    expect(wingX("-1512,0,1512,1000,0")).toBe(-664)
    expect(wingX("-910,300,307,26,0")).toBe(-664)
    expect(wingX("-700,0,700,26,0")).toBe(-52)
  })
})

// 19 Nov: on an external display Vorssaint draws its shape in the middle of the menu bar, and the wing went under the menu
// bar instead of beside it. The numbers are David's two displays: 0 to 1920 and 1920 to 3840, both with their top at 0.
describe.skipIf(!can)("where the wing goes on a screen without a notch", () => {
  const menuBar = ["0,0,1920,30,24", "0,0,1920,35,24", "1612,0,33,30,25", "1780,0,140,30,25"].map((w) => `${w},0`)
  it("beside another app's shape at the top, stepping right of it", () => {
    expect(startOn(["0", "0", "1920"], "825,0,269,26,0", ...menuBar)).toBe("825")
    const x = Number(execFileSync(exe, ["825", "0", "0", "1920", "52", "825,0,269,26,0", ...menuBar]).toString().trim())
    expect(x).toBe(1098)
    // The other display: only the shape on that screen counts.
    expect(startOn(["0", "1920", "3840"], "825,0,269,26,0", "2746,0,268,26,0", ...menuBar)).toBe("2746")
  })

  it("under the menu bar when nothing but the menu bar is there, or only its own window", () => {
    expect(startOn(["0", "0", "1920"], ...menuBar)).toBe("none")
    expect(startOn(["0", "0", "1920"], "900,0,60,26,1", ...menuBar)).toBe("none")
    // A shape lower down the screen is not at the top.
    expect(startOn(["0", "0", "1920"], "825,400,269,26,0")).toBe("none")
  })
})

