// The Windows side of the Codehouse visual identity pack (owner, 2 Nov): the app icon is the pack's mark at every size
// in one .ico that the C# compiler takes, the tray marks are there in both states, and the installer names the pack's
// setup artwork.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
// @ts-expect-error a plain .mjs build script with no types
import { icoFromPngs, pngSize } from "../../../scripts/ico.mjs"

const REPO = path.resolve(import.meta.dirname, "../../..")
const brand = (f: string) => path.join(REPO, "packaging", "brand", f)
const SIZES = [16, 24, 32, 48, 64, 128, 256]
const csc = [
  `${process.env.windir}\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe`,
  `${process.env.windir}\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe`,
].find((p) => fs.existsSync(p))

describe("the app icon", () => {
  const pngs = SIZES.map((n) => fs.readFileSync(brand(`codehouse-icon-${n}.png`)))
  const ico: Buffer = icoFromPngs(pngs)

  it("holds the pack's mark at each size Windows asks for, unchanged", () => {
    expect(SIZES.map((_, i) => (pngSize(pngs[i]!) as { width: number }).width)).toEqual(SIZES)
    expect(ico.readUInt16LE(2)).toBe(1)
    expect(ico.readUInt16LE(4)).toBe(SIZES.length)
    SIZES.forEach((n, i) => {
      const e = 6 + 16 * i
      expect(ico[e], `width of ${n}`).toBe(n === 256 ? 0 : n)
      const len = ico.readUInt32LE(e + 8)
      const at = ico.readUInt32LE(e + 12)
      expect(ico.subarray(at, at + len).equals(pngs[i]!)).toBe(true)
    })
  })

  it.runIf(csc)("is taken by the C# compiler as an exe's icon", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-ico-"))
    try {
      fs.writeFileSync(path.join(dir, "app.ico"), ico)
      fs.writeFileSync(path.join(dir, "a.cs"), "class A { static void Main() {} }")
      execFileSync(csc!, [
        "/nologo",
        `/win32icon:${path.join(dir, "app.ico")}`,
        `/out:${path.join(dir, "a.exe")}`,
        path.join(dir, "a.cs"),
      ])
      expect(fs.existsSync(path.join(dir, "a.exe"))).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("the tray and the installer", () => {
  it("have the pack's tray marks, normal and waiting on you, at the sizes the tray uses", () => {
    for (const state of ["normal", "attention"])
      for (const n of [16, 32]) {
        const f = brand(`tray-${state}-${n}.png`)
        expect((pngSize(fs.readFileSync(f)) as { width: number }).width, f).toBe(n)
      }
  })

  it("names setup artwork from the pack that is there", () => {
    const iss = fs.readFileSync(path.join(REPO, "packaging", "installer.iss"), "utf8")
    const named = [...iss.matchAll(/^Wizard(?:Small)?ImageFile=(.+)$/gm)].map((m) => m[1]!.trim())
    expect(named).toEqual(["brand\\installer-side.png", "brand\\installer-small.png"])
    // Mac fork: the installer names them the Windows way; split on its backslashes so a Mac finds them too.
    for (const f of named) expect(fs.existsSync(path.join(REPO, "packaging", ...f.split("\\"))), f).toBe(true)
  })
})
