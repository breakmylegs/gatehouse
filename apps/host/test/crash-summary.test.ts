// E-045: a crash summary: a fixture's fatal error yields its top frame through Node's own report; .NET unhandled
// exceptions and Windows crash codes are read too.
import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { crashReportOptions, crashText, dotnetDumpCommand, readCrashCodes, readDotnetCrashes, runWithCrashReports, summariseCrashes, type CrashRun } from "../src/crash-summary.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-crash-fixture-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))
fs.writeFileSync(path.join(dir, "crash.js"), "function loadConfig() { throw new Error('config missing') }\nfunction start() { loadConfig() }\nstart()\n")

const run: CrashRun = (command, cwd, env) =>
  new Promise((resolve) => execFile(process.execPath, command.split(" ").slice(1), { cwd, env: { ...process.env, ...env } }, (e, out, err) => resolve({ ran: true, exitCode: e ? ((e as { code?: number }).code ?? 1) : 0, output: `${String(out)}${String(err)}` })))

describe("the crash summary", () => {
  it("yields a fixture's fatal error with its top frame, from Node's report", { timeout: 60_000 }, async () => {
    const r = await runWithCrashReports(dir, "node crash.js", run)
    if ("notRun" in r) throw new Error(r.notRun)
    expect(r.exitCode).not.toBe(0)
    const report = r.crashes.find((c) => c.kind === "node-report")!
    expect(report.message).toMatch(/config missing/)
    expect(report.frames[0]).toMatchObject({ fn: "loadConfig", line: 1 })
    expect(report.frames[0]!.file).toMatch(/crash\.js$/)
    expect(crashText(report)).toMatch(/Top frames:\n {2}.*crash\.js:1 \(loadConfig\)/)
  })

  it("reads a report the project left in its folder", () => {
    fs.writeFileSync(path.join(dir, "report.20261123.010203.4242.0.001.json"), JSON.stringify({ header: { event: "Allocation failed - JavaScript heap out of memory", trigger: "FatalError", dumpEventTime: "2026-11-23T01:02:03Z" }, javascriptStack: { message: "No stack.", stack: ["Unavailable."] }, nativeStack: [{ symbol: "node::OOMErrorHandler" }] }))
    const [s] = summariseCrashes(dir, "")
    expect(s).toMatchObject({ kind: "node-report", what: "Node stopped: Allocation failed - JavaScript heap out of memory (FatalError)", frames: [{ fn: "node::OOMErrorHandler", file: "(native)" }] })
    expect(s!.message).toBeUndefined()
  })

  it("reads a .NET unhandled exception with its frames, and Windows crash codes", () => {
    const text = "info: starting\nUnhandled exception. System.NullReferenceException: Object reference not set to an instance of an object.\n   at Shop.Cart.Total() in C:\\src\\Cart.cs:line 17\n   at Shop.Program.Main(String[] args) in C:\\src\\Program.cs:line 9\n\nprocess exited with code -1073740791\nexited with code 1\n"
    expect(readDotnetCrashes("C:/src", text, "log")).toEqual([
      { kind: "dotnet", what: ".NET stopped on an unhandled System.NullReferenceException", message: "Object reference not set to an instance of an object.", frames: [{ fn: "Shop.Cart.Total", file: "C:\\src\\Cart.cs", line: 17 }, { fn: "Shop.Program.Main", file: "C:\\src\\Program.cs", line: 9 }], from: "log" },
    ])
    const codes = readCrashCodes(text, "log")
    expect(codes).toHaveLength(1)
    expect(codes[0]!.what).toMatch(/0xC0000409/)
  })

  it("opens nothing, and runs dotnet-dump only as a command", () => {
    expect(crashReportOptions("--inspect --report-compact --max-old-space-size=512", "C:/t")).toBe('--max-old-space-size=512 --report-on-fatalerror --report-uncaught-exception --report-directory="C:/t"')
    expect(dotnetDumpCommand("C:/dumps/app.dmp")).toBe('dotnet-dump analyze "C:/dumps/app.dmp" -c "clrstack -all" -c exit')
  })
})
