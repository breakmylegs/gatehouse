// D-002, sealed held-out checks: kept sealed, run in a folder outside every worktree that is then removed without
// following links, denied at the floor to every tool in every mode, and only their counts ever reach a session.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { ToolCallResult } from "./fake-sdk.js"
import { countsOf, HeldOutChecks, HeldOutError, removeTreeNoFollow } from "../src/heldout.js"
import { runHeldOutFor } from "../src/heldout-session.js"
import { buildStack, type Stack } from "./stack.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-heldout-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

/** Stands in for DPAPI: reversible, and never the plain bytes. */
const sealer = () => ({
  protect: async (b: Uint8Array) => Buffer.from(Buffer.from(b).map((x) => x ^ 0x5a)),
  unprotect: async (b: Uint8Array) => Buffer.from(Buffer.from(b).map((x) => x ^ 0x5a)),
})

/** A test command that prints a vitest summary, the files it was given, and the secret line of each. */
const PRINTER = `node -e "const fs=require('fs'),p=require('path');const d=process.argv[1];for(const f of fs.readdirSync(d)){console.log(f);console.log(fs.readFileSync(p.join(d,f),'utf8'))}console.log('Tests  1 failed | 2 passed (3)');process.exit(1)" {dir}`

describe("sealed held-out checks (D-002)", () => {
  it("reads the counts of vitest, jest, pytest, mocha, dotnet test and Pester", () => {
    expect(countsOf("\u001b[2m Tests \u001b[22m 2 failed | 5 passed (7)")).toEqual({ failed: 2, passed: 5, total: 7 })
    expect(countsOf("Tests  5 passed (5)")).toEqual({ failed: 0, passed: 5, total: 5 })
    expect(countsOf("Tests:       1 failed, 3 passed, 4 total")).toEqual({ failed: 1, passed: 3, total: 4 })
    expect(countsOf("===== 1 failed, 3 passed in 0.12s =====")).toEqual({ failed: 1, passed: 3, total: 4 })
    expect(countsOf("  3 passing (10ms)\n  1 failing")).toEqual({ passed: 3, failed: 1, total: 4 })
    expect(countsOf("Failed!  - Failed:     1, Passed:     3, Skipped:     0, Total:     4")).toEqual({
      failed: 1,
      passed: 3,
      total: 4,
    })
    expect(countsOf("Tests Passed: 3, Failed: 1, Skipped: 0")).toEqual({ passed: 3, failed: 1, total: 4 })
    expect(countsOf("nothing here")).toBeUndefined()
  })

  it("keeps the checks and their names sealed, and refuses a bad name or a command without {dir}", async () => {
    const h = new HeldOutChecks({ dataDir: path.join(dir, "a"), sealer })
    await h.add("MyProj", "hidden_zebra.test.js", "expect(zebraMarker).toBe(1)")
    const files = fs.readdirSync(path.join(dir, "a", "sealed", "myproj"))
    expect(files.every((f) => f.endsWith(".sealed"))).toBe(true)
    for (const f of files) {
      const bytes = fs.readFileSync(path.join(dir, "a", "sealed", "myproj", f), "utf8")
      expect(bytes).not.toContain("zebra")
    }
    expect((await h.list("myproj")).names).toEqual(["hidden_zebra.test.js"])
    await expect(h.add("MyProj", "../x.js", "x")).rejects.toBeInstanceOf(HeldOutError)
    await expect(h.setCommand("MyProj", "npx vitest run")).rejects.toThrow(/\{dir\}/)
  })

  it("removes the run folder without following a junction out of it", () => {
    const outside = path.join(dir, "outside")
    fs.mkdirSync(outside, { recursive: true })
    fs.writeFileSync(path.join(outside, "keep.txt"), "keep")
    const run = path.join(dir, "run")
    fs.mkdirSync(run, { recursive: true })
    fs.writeFileSync(path.join(run, "a.test.js"), "x")
    fs.symlinkSync(outside, path.join(run, "link"), "junction")
    removeTreeNoFollow(run)
    expect(fs.existsSync(run)).toBe(false)
    expect(fs.readFileSync(path.join(outside, "keep.txt"), "utf8")).toBe("keep")
  })
})

describe("on a real session (D-002)", () => {
  let s: Stack
  beforeAll(async () => {
    s = await buildStack({ hardTimeoutMs: 1500, phoneExpiryMs: 800 })
  }, 60000)
  afterAll(() => s.stop())

  it("sealed_no_leak: the names and contents of held-out tests appear nowhere but the desktop's detail", async () => {
    s.sdk.turn = async (api) => api.say("ok")
    const session = await s.manager.start({ cwd: s.repo })
    const events: string[] = []
    session.on("event", (e) => events.push(JSON.stringify(e)))
    const h = new HeldOutChecks({ dataDir: path.join(dir, "b"), sealer })
    await h.add(session.project, "secret_zebra_case.test.js", "const zebraMarker = 'quagga-7731'")
    await h.setCommand(session.project, PRINTER)
    const detail = await runHeldOutFor(session, h, s.audit, "you")
    // The desktop's detail has them.
    expect(detail.names).toEqual(["secret_zebra_case.test.js"])
    expect(detail.output).toContain("quagga-7731")
    expect(detail.counts).toEqual({ failed: 1, passed: 2, total: 3 })
    // Nothing else does: not the audit, not the session's events, not what Claude was sent, not its transcript.
    const elsewhere = [
      JSON.stringify(s.records()),
      events.join("\n"),
      JSON.stringify(s.sdk.queries.map((q) => q.prompts)),
      JSON.stringify(session.info()),
    ].join("\n")
    for (const secret of ["zebra", "quagga", "secret_zebra_case"]) expect(elsewhere).not.toContain(secret)
    // What it was told: the counts.
    expect(events.join("\n")).toContain("Held-out checks: 2 passed, 1 failed, of 3.")
    expect(s.records().find((r) => r.event === "sealed_check_run")).toMatchObject({ event: "sealed_check_run" })
    expect(JSON.stringify(s.records().find((r) => r.event === "sealed_check_run"))).toContain('"failed":1')
    // And the run folder is gone.
    expect(fs.readdirSync(path.join(dir, "b", "heldout-runs"))).toEqual([])
  })

  it.each(["default", "plan", "acceptEdits", "auto", "extreme"] as const)(
    "denies a session any tool on the sealed folders, in %s",
    async (mode) => {
      const sealed = path.join(os.homedir(), "AppData", "Local", "Gatehouse", "sealed", "p", "x.sealed")
      const runs = path.join(os.homedir(), "AppData", "Local", "Gatehouse", "heldout-runs")
      const results: ToolCallResult[] = []
      s.sdk.turn = async (api) => {
        results.push(await api.callTool("Read", { file_path: sealed }, { selfApproved: true }))
        results.push(await api.callTool("Grep", { pattern: "test", path: runs }, { selfApproved: true }))
        results.push(await api.callTool("Bash", { command: `cat "${sealed}"` }, { selfApproved: true }))
        results.push(await api.callTool("Glob", { pattern: "**", path: runs }, { selfApproved: true }))
      }
      const session = await s.manager.start({
        cwd: s.repo,
        mode: mode === "extreme" ? "default" : mode,
        ...(mode === "extreme" ? { extreme: true } : {}),
      })
      const done = new Promise<void>((r) => session.on("message", (m) => m.type === "result" && r()))
      session.prompt("look")
      await done
      expect(results).toHaveLength(4)
      for (const r of results) {
        expect(r).toMatchObject({ executed: false, blockedBy: "hook" })
        expect(r.message).toContain("sealed-checks")
      }
    },
  )
})

