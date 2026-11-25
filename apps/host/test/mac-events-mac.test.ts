// Mac fork (owner, 25 Nov): packaging/mac/MacEvents.swift, built with swiftc and run for real. A request's
// notification says only how risky it is, has Deny for a permission and Allow once only where the Host offers it; and a
// folder from the Finder opens only when it is a real folder.
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
const line = (o: Record<string, unknown>) => JSON.parse(run("--host-line", JSON.stringify(o))) as Record<string, string>
const ID = "0195f0c2-7d1e-7abc-9def-0123456789ab"

beforeAll(() => {
  if (!can) return
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-mac-events-"))
  exe = path.join(dir, "events")
  execFileSync(swiftc, [
    "-O",
    "-o",
    exe,
    ...["NavGuard.swift", "Shortcut.swift", "Host.swift", "MacEvents.swift", "test/main.swift"].map((f) =>
      path.join(REPO, "packaging", "mac", f),
    ),
  ])
}, 180_000)
afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(!can)("a request's notification on a Mac", () => {
  it("has Deny and Allow once for a permission the Host may allow from it, and says only how risky", () => {
    expect(line({ event: "attention", id: ID, kind: "permission", band: "moderate", allow: true })).toEqual({
      event: "attention",
      id: ID,
      identifier: `request-${ID}`,
      category: "codehouse-request-allow",
      body: "A moderate risk request needs your decision",
      deny: `notify-deny:${ID}`,
      allow: `notify-allow:${ID}`,
    })
  })

  it("has Deny alone for a High one, and no buttons for a question or a plan, whatever the line says", () => {
    expect(line({ event: "attention", id: ID, kind: "permission", band: "high", allow: false })).toMatchObject({
      category: "codehouse-request-deny",
      allow: "none",
    })
    for (const kind of ["question", "plan"])
      expect(line({ event: "attention", id: ID, kind, band: "low", allow: true })).toMatchObject({
        category: "none",
        deny: "none",
        allow: "none",
      })
  })

  it("keeps the old notification for a line without a request, or with an id the Host does not make", () => {
    expect(line({ event: "attention" })).toEqual({ event: "attention" })
    expect(line({ event: "attention", id: "x:open-request:y", kind: "permission", allow: true })).toEqual({ event: "attention" })
    expect(line({ event: "settled", id: ID })).toEqual({ event: "settled", id: ID })
    expect(line({ event: "settled", id: "a\nb" })).toEqual({ event: "other" })
  })
})

describe.skipIf(!can)("a folder from the Finder", () => {
  it("opens the first real folder, never a file, a relative path or one with a line break", () => {
    const file = path.join(dir, "notes.txt")
    fs.writeFileSync(file, "x")
    expect(run("--folder", file, dir)).toBe(dir)
    expect(run("--folder", file)).toBe("none")
    expect(run("--folder", "dev/shop")).toBe("none")
    expect(run("--folder", `${dir}\nopen-request:x`)).toBe("none")
  })
})
