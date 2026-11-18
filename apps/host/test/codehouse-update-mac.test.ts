// Mac fork (18 Nov): packaging/mac/codehouse-update.sh, the Mac's Codehouse-Update.exe, run for real in a temporary
// folder. It swaps the apps once Codehouse has quit, opens the new one, and puts the old one back when the new one does
// not say it started; it refuses a plan that names anything outside its own folder. A stand-in for open says the app
// started (it writes started.json with the app's version) or, for a version that would not start, says nothing.
import { execFile, spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { parseResult } from "../src/update/service.js"

const SCRIPT = path.resolve(import.meta.dirname, "../../../packaging/mac/codehouse-update.sh")
const run = promisify(execFile)
let root: string
let updates: string
let apps: string

const app = (where: string, version: string) => {
  fs.mkdirSync(path.join(where, "Contents/MacOS"), { recursive: true })
  fs.writeFileSync(path.join(where, "version"), version)
}
const versionOf = (where: string) => (fs.existsSync(where) ? fs.readFileSync(path.join(where, "version"), "utf8") : undefined)

/** A stand-in for open: writes started.json as the app's Host would, unless that version is one that does not start. */
function fakeOpen(broken: string[]) {
  const f = path.join(root, "open.sh")
  fs.writeFileSync(
    f,
    `#!/bin/sh\nv="$(cat "$1/version")"\necho "$1" >> "${root}/opened"\ncase " ${broken.join(" ")} " in *" $v "*) exit 0 ;; esac\nprintf '{"version":"%s","pid":1}\\n' "$v" > "${updates}/started.json"\n`,
    { mode: 0o755 },
  )
  return f
}

async function update(plan: Record<string, string>, o: { broken?: string[]; pid?: number } = {}) {
  const lines = { timeout: "3", health: `${updates}/started.json`, result: `${updates}/result.txt`, ...plan }
  const file = path.join(updates, "plan.txt")
  fs.writeFileSync(file, Object.entries(lines).map(([k, v]) => `${k}=${v}`).join("\n") + "\n")
  await run("/bin/sh", [SCRIPT, file, String(o.pid ?? 999_999)], {
    env: { PATH: "/usr/bin:/bin", CODEHOUSE_UPDATE_OPEN: fakeOpen(o.broken ?? []) },
  }).catch(() => undefined)
  return parseResult(fs.readFileSync(`${updates}/result.txt`, "utf8"))
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gh-mac-update-")))
  updates = path.join(root, "updates")
  apps = path.join(root, "Applications")
  fs.mkdirSync(updates)
  fs.mkdirSync(apps)
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe.skipIf(process.platform !== "darwin")("switching Codehouse.app to a new version", () => {
  const installed = () => path.join(apps, "Codehouse.app")
  const next = () => path.join(updates, "mac-next/Codehouse.app")
  const previous = () => path.join(updates, "mac-previous/Codehouse.app")
  const plan = (mode = "apply") => ({
    mode,
    app: installed(),
    candidate: mode === "apply" ? next() : previous(),
    previous: previous(),
    from: mode === "apply" ? "2.0.444+mac.3" : "2.0.444+mac.4",
    to: mode === "apply" ? "2.0.444+mac.4" : "2.0.444+mac.3",
  })

  it("puts the new version in place once Codehouse quits, opens it, and keeps the old one", async () => {
    app(installed(), "2.0.444+mac.3")
    app(next(), "2.0.444+mac.4")
    // Codehouse is still running for a moment: the updater waits for it.
    const running = spawn("/bin/sleep", ["1.5"])
    const r = await update(plan(), { pid: running.pid! })
    expect(r).toMatchObject({ ok: true, mode: "apply", from: "2.0.444+mac.3", to: "2.0.444+mac.4" })
    expect(versionOf(installed())).toBe("2.0.444+mac.4")
    expect(versionOf(previous())).toBe("2.0.444+mac.3")
    expect(fs.existsSync(next())).toBe(false)
  }, 20_000)

  it("goes back to the old version when the new one does not start, and does not keep the broken one", async () => {
    app(installed(), "2.0.444+mac.3")
    app(next(), "2.0.444+mac.4")
    const r = await update(plan(), { broken: ["2.0.444+mac.4"] })
    expect(r).toMatchObject({ ok: false, mode: "apply", reason: /did not start within 3 seconds, so Codehouse went back/ })
    expect(versionOf(installed())).toBe("2.0.444+mac.3")
    expect(fs.existsSync(previous())).toBe(false)
    // The old one was opened again after the new one.
    expect(fs.readFileSync(path.join(root, "opened"), "utf8").trim().split("\n")).toHaveLength(2)
  }, 20_000)

  it("goes back to the version kept from before, keeping the one it leaves", async () => {
    app(installed(), "2.0.444+mac.4")
    app(previous(), "2.0.444+mac.3")
    const r = await update(plan("rollback"))
    expect(r).toMatchObject({ ok: true, mode: "rollback", to: "2.0.444+mac.3" })
    expect(versionOf(installed())).toBe("2.0.444+mac.3")
    expect(versionOf(previous())).toBe("2.0.444+mac.4")
  }, 20_000)

  it("refuses a plan that names anything outside its own folder, or no mode, and changes nothing", async () => {
    app(installed(), "2.0.444+mac.3")
    const outside = path.join(root, "elsewhere/Codehouse.app")
    app(outside, "2.0.444+mac.9")
    for (const p of [
      { ...plan(), candidate: outside },
      { ...plan(), candidate: `${updates}/../elsewhere/Codehouse.app` },
      { ...plan(), previous: path.join(root, "kept/Codehouse.app") },
      { ...plan(), app: path.join(apps, "Codehouse") },
      { ...plan(), mode: "remove" },
    ]) {
      const r = await update(p)
      expect(r.ok, JSON.stringify(p)).toBe(false)
      expect(versionOf(installed())).toBe("2.0.444+mac.3")
      expect(versionOf(outside)).toBe("2.0.444+mac.9")
    }
  }, 30_000)
})
