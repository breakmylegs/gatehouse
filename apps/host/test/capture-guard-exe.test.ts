// E-091: through the window app's own code (packaging/Capture.cs, built with the compiler that ships with Windows and
// run for real), a window kept out of captures has WDA_EXCLUDEFROMCAPTURE set as Windows reports it, and loses it again.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const REPO = path.resolve(import.meta.dirname, "../../..")
const csc = [`${process.env.windir}\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe`, `${process.env.windir}\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe`].find((p) => fs.existsSync(p))
let dir: string
let exe: string

beforeAll(() => {
  if (!csc) return
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-capguard-"))
  exe = path.join(dir, "CaptureGuard.exe")
  execFileSync(csc, ["/nologo", "/target:exe", "/define:CAPTUREGUARD_CLI", "/r:System.Windows.Forms.dll", "/r:System.Drawing.dll", `/out:${exe}`, path.join(REPO, "packaging", "Capture.cs")])
}, 120_000)
afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(!csc)("screen-share safe mode in the window app", () => {
  it("sets WDA_EXCLUDEFROMCAPTURE on a window, as Windows reports it, and takes it off again", () => {
    expect(execFileSync(exe, { windowsHide: true }).toString().trim()).toBe("set 11 0")
  })

  it("applies it to the quick prompt and every pop-out window while the mode is on", () => {
    const app = fs.readFileSync(path.join(REPO, "packaging", "CodehouseApp.cs"), "utf8")
    expect(app).toMatch(/else if \(m == "screenshare:on" \|\| m == "screenshare:off"\) ScreenShare\(m == "screenshare:on"\);/)
    expect(app).toMatch(/if \(quick != null\) CaptureGuard\.Exclude\(quick\.Handle, on\);/)
    expect(app).toMatch(/foreach \(PopoutWindow p in popouts\.Values\) CaptureGuard\.Exclude\(p\.Handle, on\);/)
    // A pop-out or quick prompt opened while the mode is on starts out excluded.
    expect(app).toMatch(/if \(screenShare\) CaptureGuard\.Exclude\(w\.Handle, true\);/)
    expect(app).toMatch(/if \(screenShare\) CaptureGuard\.Exclude\(quick\.Handle, true\);/)
  })
})
