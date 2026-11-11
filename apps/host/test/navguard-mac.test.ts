// Mac fork. CH-01 on a Mac: the Codehouse window (packaging/mac) shows only Codehouse's own page. NavGuard.swift is
// built with swiftc and run for real, against the same cases as packaging/NavGuard.cs in navguard-exe.test.ts.
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
const ORIGIN = "http://127.0.0.1:47123"
const decide = (uri: string, where = "window") => {
  const [action, report] = execFileSync(exe, ["--decide", uri, ORIGIN, where])
    .toString()
    .trim()
    .split(/\r?\n/)
  return { action, report: report ? (JSON.parse(report) as Record<string, unknown>) : undefined }
}

beforeAll(() => {
  if (!can) return
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-navguard-mac-"))
  exe = path.join(dir, "navguard")
  execFileSync(swiftc, [
    "-O",
    "-o",
    exe,
    path.join(REPO, "packaging", "mac", "NavGuard.swift"),
    path.join(REPO, "packaging", "mac", "test", "main.swift"),
  ])
}, 180_000)
afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(!can)("the Mac window's navigation guard", () => {
  it("cancels claude.ai in the window and opens it in your browser, reporting only the host", () => {
    expect(decide("https://claude.ai/chat/0b1e?draft=secret")).toEqual({
      action: "external",
      report: { where: "window", target: "https://claude.ai", opened: true },
    })
    expect(decide("https://claude.ai/login", "new-window").action).toBe("external")
  })

  it("never loads claude.ai or any other site in a frame, and opens nothing for one", () => {
    expect(decide("https://claude.ai/", "frame")).toEqual({
      action: "refuse",
      report: { where: "frame", target: "https://claude.ai", opened: false },
    })
    expect(decide("https://console.anthropic.com/login", "frame").action).toBe("refuse")
    expect(decide("http://localhost:5173/", "frame").action).toBe("allow")
    expect(decide(`${ORIGIN}/api/artifacts/a1/1`, "frame").action).toBe("allow")
    expect(decide("about:srcdoc", "frame").action).toBe("allow")
  })

  it("matches our own origin exactly, not as a prefix", () => {
    expect(decide(`${ORIGIN}/#token=abc`).action).toBe("allow")
    expect(decide("http://127.0.0.1:47123@claude.ai/").action).toBe("external")
    expect(decide("http://someone@127.0.0.1:47123/").action).toBe("external")
    expect(decide("http://127.0.0.1:471234/").action).toBe("refuse")
    expect(decide("http://127.0.0.1:47124/").action).toBe("external")
    expect(decide("http://127.0.0.1:47123@claude.ai/", "frame").action).toBe("refuse")
  })

  it("refuses addresses that are not web pages without opening them", () => {
    expect(decide("file:///Users/someone/secret.txt")).toEqual({
      action: "refuse",
      report: { where: "window", target: "file:", opened: false },
    })
    expect(decide("x-apple.systempreferences:com.apple.preference.security").action).toBe("refuse")
    expect(decide("javascript:alert(1)", "new-window").action).toBe("refuse")
  })

  it("keeps a port that is not the usual one in the report, and only plain address characters", () => {
    expect(decide("https://example.com:8443/a?b=c").report).toEqual({
      where: "window",
      target: "https://example.com:8443",
      opened: true,
    })
    expect(decide('https://ex"ample.com/').action).toBe("refuse")
  })
})
