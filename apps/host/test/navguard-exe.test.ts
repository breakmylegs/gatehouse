// CH-01 (owner's Chat build, 4 Nov): Codehouse's windows show only Codehouse's own page. packaging/NavGuard.cs is built
// with the compiler that ships with Windows and run for real; the Host audits what the window reports.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Fastify from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { HostAudit } from "../src/hostaudit.js"
import { NavigationAudit, REPEAT_MS, registerShellRoutes } from "../src/shell-nav.js"

const REPO = path.resolve(import.meta.dirname, "../../..")
const csc = [
  `${process.env.windir}\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe`,
  `${process.env.windir}\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe`,
].find((p) => fs.existsSync(p))
let dir: string
let exe: string
const ORIGIN = "http://127.0.0.1:47123"
const decide = (uri: string, where = "window") => {
  const [action, report] = execFileSync(exe, ["--decide", uri, ORIGIN, where], {
    windowsHide: true,
  })
    .toString()
    .trim()
    .split(/\r?\n/)
  return { action, report: report ? (JSON.parse(report) as Record<string, unknown>) : undefined }
}

beforeAll(() => {
  if (!csc) return
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-navguard-"))
  exe = path.join(dir, "NavGuard.exe")
  execFileSync(csc, [
    "/nologo",
    "/target:exe",
    "/define:NAVGUARD_CLI",
    `/out:${exe}`,
    path.join(REPO, "packaging", "NavGuard.cs"),
  ])
}, 120_000)
afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(!csc)("the window's navigation guard", () => {
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
    expect(decide("http://127.0.0.1:471234/").action).toBe("refuse")
    expect(decide("http://127.0.0.1:47124/").action).toBe("external")
    expect(decide("http://127.0.0.1:47123@claude.ai/", "frame").action).toBe("refuse")
  })

  it("refuses addresses that are not web pages without opening them", () => {
    expect(decide("file:///C:/Users/someone/secret.txt")).toEqual({
      action: "refuse",
      report: { where: "window", target: "file:", opened: false },
    })
    expect(decide("ms-settings:privacy").action).toBe("refuse")
    expect(decide("javascript:alert(1)", "new-window").action).toBe("refuse")
  })
})

describe("the Host's record of a refused navigation", () => {
  const fake = () => {
    const entries: Array<Record<string, unknown>> = []
    const audit = {
      record: async (e: Record<string, unknown>) => {
        entries.push(e)
        return true
      },
    } as unknown as HostAudit
    return { entries, audit }
  }

  it("audits each one as a floor deny, and a repeat only after a pause", async () => {
    const { entries, audit } = fake()
    let now = 1_000
    const nav = new NavigationAudit(
      audit,
      () => "h1",
      () => now,
    )
    const n = { where: "window" as const, target: "https://claude.ai", opened: true }
    expect(await nav.note(n)).toBe(true)
    expect(await nav.note(n)).toBe(false)
    now += REPEAT_MS
    expect(await nav.note(n)).toBe(true)
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      event: "navigation_refused",
      tool: "webview",
      input: n,
      verdict: { outcome: "deny", ruleId: "webview-own-origin", decidedBy: "floor" },
    })
  })

  it("accepts only the scheme and host, so a path or query never reaches the log", async () => {
    const { entries, audit } = fake()
    const app = Fastify()
    registerShellRoutes(app, new NavigationAudit(audit, () => ""))
    const post = (payload: unknown) =>
      app.inject({ method: "POST", url: "/api/shell/navigation", payload: payload as object })
    expect(
      (await post({ where: "frame", target: "https://claude.ai", opened: false })).statusCode,
    ).toBe(200)
    expect(
      (await post({ where: "frame", target: "https://claude.ai/chat?q=Secret", opened: false }))
        .statusCode,
    ).toBe(400)
    expect((await post({ where: "elsewhere", target: "x", opened: false })).statusCode).toBe(400)
    expect(entries).toHaveLength(1)
    await app.close()
  })
})
