// O60 (owner, 27 Nov): releasing with no terminal step. One heavy run at a time on the computer; a full gate recorded
// for its exact commit, resumed where it stopped and accepted by a release; a test process stopped with everything it
// started; leftover headless browsers of ours swept up, never another run's; the session's job memory read and a
// clear message naming the level a run needs; and the update routes file found from a worktree.
import { execFileSync, spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { gateRecord, noteComplete, notePassed, noteStep } from "../../../scripts/gate-record.mjs"
import { heavyLock, holder, lockFile } from "../../../scripts/heavy-lock.mjs"
import { fits, levelFor } from "../../../scripts/job-headroom.mjs"
import { ourBrowsers, sweepBrowsers } from "../../../scripts/leftovers.mjs"
import { findRoutesFile, routesFiles } from "../../../scripts/release-routes.js"
import { runShards } from "../../../scripts/test-shards.mjs"

let data: string
let env: NodeJS.ProcessEnv
beforeEach(() => {
  data = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-o60-")))
  env = { GATEHOUSE_DATA_DIR: data }
})
afterEach(() => fs.rmSync(data, { recursive: true, force: true }))

const SHA = "a".repeat(40)

describe("one heavy run at a time (O60)", () => {
  it("lets one run hold the lock, makes another wait with a message, and lets it in when the first ends", async () => {
    const said: string[] = []
    const release = await heavyLock("the full gate", { env, say: (l: string) => said.push(l) })
    expect(holder(env)).toMatchObject({ pid: process.pid, what: "the full gate" })
    // A second run in another process waits: here, one that would not wait is refused, naming the holder.
    const other = { ...env }
    delete other.GATEHOUSE_HEAVY_LOCK
    await expect(heavyLock("a release", { env: { ...other, GATEHOUSE_HEAVY_LOCK: "1" }, wait: false })).rejects.toThrow(/the full gate/)
    // What the holder starts inherits it.
    await expect(heavyLock("its tests", { env })).resolves.toBeTypeOf("function")
    release()
    expect(holder(env)).toBeUndefined()
  })

  it("waits its turn while another process has it, saying so, and takes it once that process has gone", async () => {
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 3000)"], { stdio: "ignore" })
    fs.mkdirSync(path.dirname(lockFile(env)), { recursive: true })
    fs.writeFileSync(lockFile(env), JSON.stringify({ pid: child.pid, what: "another session's whole suite", since: new Date().toISOString(), cwd: "C:/dev/gatehouse" }))
    const said: string[] = []
    const started = Date.now()
    const release = await heavyLock("a release", { env, say: (l: string) => said.push(l), pollMs: 200 })
    expect(Date.now() - started).toBeGreaterThan(1500)
    expect(said[0]).toMatch(/waiting for another session's whole suite .* before a release/)
    release()
  })

  it("takes over a lock whose process is gone, or that is hours old", async () => {
    fs.mkdirSync(path.dirname(lockFile(env)), { recursive: true })
    fs.writeFileSync(lockFile(env), JSON.stringify({ pid: 999_999_9, what: "a crashed run", since: new Date().toISOString() }))
    const r1 = await heavyLock("a release", { env: { ...env }, wait: false })
    r1()
    fs.writeFileSync(lockFile(env), JSON.stringify({ pid: process.pid, what: "an old run", since: new Date(Date.now() - 7 * 3600_000).toISOString() }))
    const r2 = await heavyLock("a release", { env: { ...env }, wait: false })
    r2()
  })
})

describe("the full gate recorded for its commit (O60)", () => {
  it("keeps each step and file that passed for a commit, and when it is complete", () => {
    expect(gateRecord(SHA, env)).toBeUndefined()
    noteStep(SHA, "lint", env)
    notePassed(SHA, "apps/host/test/a.test.ts", env)
    notePassed(SHA, "apps/host/test/a.test.ts", env)
    expect(gateRecord(SHA, env)).toMatchObject({ commit: SHA, steps: ["lint"], passed: ["apps/host/test/a.test.ts"], complete: false })
    noteComplete(SHA, env)
    expect(gateRecord(SHA, env)?.complete).toBe(true)
    // Another commit has nothing; a name that is not a commit is never read.
    expect(gateRecord("b".repeat(40), env)).toBeUndefined()
    expect(gateRecord("../x", env)).toBeUndefined()
  })

  it("stops starting files at the time budget, says how many are left, and records each that passed", async () => {
    let t = 0
    const passed: string[] = []
    const run = async () => {
      t += 10
      return { ok: true, out: "" }
    }
    const r = await runShards(["a", "b", "c", "d"], { freemem: () => 1, run, log: () => undefined, budgetMs: 15, now: () => t, onPassed: (f: string) => passed.push(f) })
    expect(r.notStarted).toBe(2)
    expect(passed).toEqual(["a", "b"])
  })

  it("records a file that passed on its retry, never one that failed twice", async () => {
    const tries: Record<string, number> = {}
    const passed: string[] = []
    const run = async (f: string | string[]) => {
      const k = String(f)
      tries[k] = (tries[k] ?? 0) + 1
      return { ok: k === "flaky" ? tries[k] > 1 : k !== "broken", out: "" }
    }
    const r = await runShards(["ok", "flaky", "broken"], { freemem: () => 1, run, log: () => undefined, onPassed: (f: string) => passed.push(f) })
    expect(r.failed).toEqual(["broken"])
    expect(passed.sort()).toEqual(["flaky", "ok"])
  })
})

describe("leftover headless browsers (O60)", () => {
  const list = [
    { pid: 10, parent: 1, command: "node vitest" },
    // A browser whose run (pid 2) is gone: stopped.
    { pid: 20, parent: 2, command: 'msedge.exe --headless=new --user-data-dir=C:\\T\\codeh-phone-AAA about:blank' },
    { pid: 21, parent: 20, command: "msedge.exe --type=renderer --user-data-dir=C:\\T\\codeh-phone-AAA" },
    // One whose run (pid 10) is still going, another session's say: left alone.
    { pid: 30, parent: 10, command: "msedge.exe --headless=new --user-data-dir=C:\\T\\codeh-phone-BBB about:blank" },
    // The owner's own Edge: never ours.
    { pid: 40, parent: 2, command: "msedge.exe --profile-directory=Default" },
  ]
  it("stops only ours whose run is gone, and removes profiles nothing uses", () => {
    expect(ourBrowsers(list)).toEqual([
      { pid: 20, profile: "C:\\T\\codeh-phone-AAA", orphaned: true },
      { pid: 30, profile: "C:\\T\\codeh-phone-BBB", orphaned: false },
    ])
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gh-o60-tmp-"))
    for (const n of ["codeh-phone-OLD", "codeh-phone-NEW", "keep-me"]) fs.mkdirSync(path.join(tmp, n))
    const old = new Date(Date.now() - 5 * 60_000)
    fs.utimesSync(path.join(tmp, "codeh-phone-OLD"), old, old)
    fs.utimesSync(path.join(tmp, "keep-me"), old, old)
    const killed: number[] = []
    const r = sweepBrowsers({ tmp, list, kill: (pid: number) => killed.push(pid) })
    expect(killed).toEqual([20])
    expect(r.stopped).toBe(1)
    // The old unused profile goes; one made a moment ago stays, and so does anything not ours.
    expect(fs.readdirSync(tmp).sort()).toEqual(["codeh-phone-NEW", "keep-me"])
    fs.rmSync(tmp, { recursive: true, force: true })
  })
})

describe("the memory a run has in its session's job (O60)", () => {
  it("fits outside a job or without a cap, and otherwise names the level it needs", () => {
    expect(fits(3072, undefined)).toEqual({ ok: true })
    expect(fits(3072, { job: "j", limitMb: 0, usedMb: 500 })).toEqual({ ok: true })
    expect(fits(3072, { job: "j", limitMb: 8192, usedMb: 500 })).toMatchObject({ ok: true })
    const low = fits(3072, { job: "j", limitMb: 2048, usedMb: 400 })
    expect(low.ok).toBe(false)
    expect(low.message).toMatch(/runs at Low \(2048 MB.*400 MB in use\).*needs about 3072 MB free.*Raise the session to Medium/)
    expect(levelFor(3072, 400)).toBe("medium")
    expect(levelFor(3072, 1200)).toBe("higher")
    expect(levelFor(20_000, 0)).toBe("high")
  })
})

describe("the update routes file, from a worktree (O60)", () => {
  it("finds it in the main worktree, after this checkout and before the release key's folder", () => {
    const main = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-o60-main-")))
    const g = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", windowsHide: true })
    g(main, "init", "--quiet", "-b", "main")
    g(main, "config", "user.email", "t@example.com")
    g(main, "config", "user.name", "T")
    fs.writeFileSync(path.join(main, "a.txt"), "a\n")
    g(main, "add", ".")
    g(main, "commit", "--quiet", "-m", "a")
    const wt = path.join(path.dirname(main), `${path.basename(main)}-wt`)
    g(main, "worktree", "add", "--quiet", "-b", "w", wt)
    try {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "gh-o60-home-"))
      const e = { USERPROFILE: home }
      expect(routesFiles(wt, e).map((f) => path.relative(path.dirname(main), f).split(path.sep).join("/"))).toEqual([
        `${path.basename(wt)}/release-channels.local.json`,
        `${path.basename(main)}/release-channels.local.json`,
        path.relative(path.dirname(main), path.join(home, ".codehouse-release", "channels.json")).split(path.sep).join("/"),
      ])
      expect(findRoutesFile(wt, e)).toBeUndefined()
      fs.writeFileSync(path.join(main, "release-channels.local.json"), '{"legacy":[]}')
      expect(findRoutesFile(wt, e)).toBe(path.join(main, "release-channels.local.json"))
      fs.rmSync(home, { recursive: true, force: true })
    } finally {
      g(main, "worktree", "remove", "--force", wt)
      fs.rmSync(main, { recursive: true, force: true })
    }
  }, 120_000)
})
