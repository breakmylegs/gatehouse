// Why Codehouse stopped: the launcher's note of the Host's last error lines is redacted into host.log and deleted.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { redactString } from "@gatehouse/policy"
import { LAST_STOP, memoryLine, reportLastStop } from "../src/last-stop.js"

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-last-stop-"))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

const redact = (t: string) => redactString(t, { terms: ["AcmeCorp"] })

describe("the last stop", () => {
  it("logs the Host's last error lines, redacted, then deletes the note", () => {
    fs.writeFileSync(
      path.join(dir, LAST_STOP),
      [
        "code -1073740791 (0xC0000409)",
        "[host] session for AcmeCorp started",
        "<--- Last few GCs --->",
        "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory",
        // Built at run time, so the key-shaped text is not in the file.
        "token " + ["sk", "ant", "api03", "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH"].join("-"),
        "",
      ].join("\n"),
    )
    const lines: string[] = []
    expect(reportLastStop(dir, redact, (l) => lines.push(l))).toBe(true)
    expect(lines[0]).toBe("the Host's last error output before it stopped with code -1073740791 (0xC0000409):")
    expect(lines).toContain("  | FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory")
    expect(lines.join("\n")).not.toContain("AcmeCorp")
    expect(lines.join("\n")).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789")
    expect(fs.existsSync(path.join(dir, LAST_STOP))).toBe(false)
  })

  it("does nothing when there is no note, and says so when the Host said nothing", () => {
    const lines: string[] = []
    expect(reportLastStop(dir, redact, (l) => lines.push(l))).toBe(false)
    fs.writeFileSync(path.join(dir, LAST_STOP), "code 1 (0x00000001)\n")
    reportLastStop(dir, redact, (l) => lines.push(l))
    expect(lines).toEqual(["the Host's last error output before it stopped with code 1 (0x00000001): nothing"])
  })

  it("says how much memory the Host uses against its heap limit", () => {
    expect(memoryLine()).toMatch(/^memory: heap \d+ MB used of a \d+ MB limit, \d+ MB in all, \d+ MB outside the heap$/)
  })
})
