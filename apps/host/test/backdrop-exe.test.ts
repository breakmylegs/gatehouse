// Backlog U16: Mica behind the title bar only where Windows draws it and you have not turned transparency off.
// packaging/Backdrop.cs is built with the compiler that ships with Windows and run for real.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const REPO = path.resolve(import.meta.dirname, "../../..")
const csc = [
  `${process.env.windir}\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe`,
  `${process.env.windir}\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe`,
].find((p) => fs.existsSync(p))
let dir: string
let exe: string
const choice = (build: number, highContrast: boolean, transparency: boolean) =>
  execFileSync(exe, [String(build), highContrast ? "1" : "0", transparency ? "1" : "0"], {
    windowsHide: true,
  })
    .toString()
    .trim()

beforeAll(() => {
  if (!csc) return
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-backdrop-"))
  exe = path.join(dir, "Backdrop.exe")
  execFileSync(csc, [
    "/nologo",
    "/target:exe",
    "/define:BACKDROP_CLI",
    "/r:System.Windows.Forms.dll",
    `/out:${exe}`,
    path.join(REPO, "packaging", "Backdrop.cs"),
  ])
}, 120_000)
afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(!csc)("the window's backdrop", () => {
  it("uses Mica on Windows 11 22H2 and later with transparency on, and stays opaque otherwise", () => {
    expect(choice(22631, false, true)).toBe("mica")
    expect(choice(22621, false, true)).toBe("mica")
    expect(choice(22000, false, true)).toBe("opaque")
    expect(choice(19045, false, true)).toBe("opaque")
    expect(choice(26100, true, true)).toBe("opaque")
    expect(choice(26100, false, false)).toBe("opaque")
  })
})
