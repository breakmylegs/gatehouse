// Mac fork. --install --when-quit (scripts/package-mac.mjs): once Codehouse has quit, packaging/mac/install-when-quit.sh
// puts the new Codehouse.app in place of the old one, and if it cannot, puts the old one back, so you are never left
// without one. Run for real against folders in a temporary folder, with a program name nothing is running.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const SCRIPT = path.resolve(import.meta.dirname, "../../../packaging/mac/install-when-quit.sh")
let dir: string

/** Runs the waiter as package-mac.mjs does; true when it says it installed. */
function waiter(staging: string, dest: string) {
  const log = path.join(dir, "install.log")
  const pid = path.join(dir, "install.pid")
  fs.writeFileSync(pid, "1\n")
  const args = [`${dir}/nothing-runs-this`, staging, dest, "/usr/bin/true", log, pid]
  let ok = true
  try {
    execFileSync("/bin/sh", ["-c", fs.readFileSync(SCRIPT, "utf8"), "codehouse-install", ...args], {
      env: { PATH: "/usr/bin:/bin", CODEHOUSE_INSTALL_OPEN: "/usr/bin/true" },
    })
  } catch {
    ok = false
  }
  return { ok, log: fs.readFileSync(log, "utf8"), pidLeft: fs.existsSync(pid) }
}

const app = (where: string, version: string) => {
  fs.mkdirSync(where, { recursive: true })
  fs.writeFileSync(path.join(where, "version"), version)
}
const version = (where: string) => fs.readFileSync(path.join(where, "version"), "utf8")

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-install-quit-mac-"))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe.skipIf(process.platform !== "darwin")("installing a new Codehouse.app when you quit", () => {
  it("puts the new copy in place of the old one and tidies up", () => {
    const staging = path.join(dir, ".codehouse-installing")
    const dest = path.join(dir, "Codehouse.app")
    app(path.join(staging, "Codehouse.app"), "new")
    app(dest, "old")
    const r = waiter(staging, dest)
    expect(r.ok).toBe(true)
    expect(version(dest)).toBe("new")
    expect(fs.existsSync(`${dest}.previous`) || fs.existsSync(staging) || r.pidLeft).toBe(false)
    expect(r.log).toMatch(/installed /)
  }, 20_000)

  it("puts the old copy back when the new one cannot be moved in", () => {
    const staging = path.join(dir, ".codehouse-installing")
    const dest = path.join(dir, "Codehouse.app")
    fs.mkdirSync(staging)
    app(dest, "old")
    const r = waiter(staging, dest)
    expect(r.ok).toBe(false)
    expect(version(dest)).toBe("old")
    expect(r.log).toMatch(/the old one is back/)
  }, 20_000)
})
