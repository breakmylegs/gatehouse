// G37: a debugger through the Debug Adapter Protocol, with adapters you name. A start is refused while the kill switch
// is engaged and for a program outside the folder; every action is audited with who took it (you or Claude); a stop
// shows the stack (places outside the folder without a path) and the top frame's variables, redacted; an adapter's
// request to run something else is refused; and an adapter reached on a port is reached on 127.0.0.1.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { debugClient, DebugError, Debugger, launchArgs, stateText, type DebugAdapterSetting } from "../src/dap-client.js"

let dir: string
let root: string
let adapter: string
beforeAll(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "g37-")))
  root = path.join(dir, "proj")
  fs.mkdirSync(root)
  fs.writeFileSync(path.join(root, "app.py"), "x = 1\ny = x + 1\nprint(y)\n")
  // A debug adapter in a few lines, over stdio, or on the port in its arguments. It writes what it was asked to log.json.
  adapter = path.join(dir, "fake-dap.cjs")
  fs.writeFileSync(
    adapter,
    `const fs = require("fs"), path = require("path"), net = require("net")
const log = []
const write = (m) => { log.push(m.command ?? m.event ?? m.type); fs.writeFileSync(path.join(process.cwd(), "log.json"), JSON.stringify({ log, got, key: process.env.ANTHROPIC_API_KEY ?? null })) }
const noStop = process.argv.includes("--no-stop")
const got = []
let out = (s) => process.stdout.write(s)
let seq = 1
const send = (m) => { const b = JSON.stringify({ seq: seq++, ...m }); out("Content-Length: " + Buffer.byteLength(b) + "\\r\\n\\r\\n" + b) }
const reply = (m, body = {}) => send({ type: "response", request_seq: m.seq, command: m.command, success: true, body })
let buf = Buffer.alloc(0)
const onData = (c) => {
  buf = Buffer.concat([buf, c])
  for (;;) {
    const end = buf.indexOf("\\r\\n\\r\\n"); if (end < 0) return
    const len = Number(/Content-Length: (\\d+)/i.exec(buf.subarray(0, end).toString())[1])
    if (buf.length < end + 4 + len) return
    const m = JSON.parse(buf.subarray(end + 4, end + 4 + len).toString()); buf = buf.subarray(end + 4 + len)
    got.push({ type: m.type, command: m.command, success: m.success, args: m.arguments })
    write(m)
    if (m.command === "initialize") { reply(m, { supportsConfigurationDoneRequest: true }); send({ type: "event", event: "initialized" }) }
    else if (m.command === "launch") { send({ type: "request", command: "runInTerminal", arguments: { args: ["calc.exe"] } }); reply(m) }
    else if (m.command === "setBreakpoints") reply(m, { breakpoints: m.arguments.breakpoints.map((b) => ({ verified: b.line !== 99, line: b.line })) })
    else if (m.command === "configurationDone") { reply(m); if (noStop) return; send({ type: "event", event: "output", body: { category: "stdout", output: "hello SECRET-VALUE\\n" } }); send({ type: "event", event: "stopped", body: { reason: "breakpoint", threadId: 7 } }) }
    else if (m.command === "stackTrace") reply(m, { stackFrames: [{ id: 1, name: "<module>", line: 2, source: { path: path.join(process.cwd(), "app.py") } }, { id: 2, name: "runner", line: 40, source: { path: path.join(process.cwd(), "..", "outside.py") } }] })
    else if (m.command === "scopes") reply(m, { scopes: [{ name: "Locals", variablesReference: 5 }] })
    else if (m.command === "variables") reply(m, { variables: [{ name: "x", value: "1", type: "int" }, { name: "token", value: "SECRET-VALUE" }, { name: "special variables", value: "" }] })
    else if (m.command === "next") { reply(m); send({ type: "event", event: "stopped", body: { reason: "step", threadId: 7 } }) }
    else if (m.command === "continue") { reply(m); send({ type: "event", event: "exited", body: { exitCode: 0 } }); send({ type: "event", event: "terminated" }) }
    else if (m.command === "disconnect") { reply(m); setTimeout(() => process.exit(0), 50) }
    else if (m.type === "request") reply(m)
  }
}
const portArg = process.argv.find((a) => a.startsWith("--port="))
if (portArg) {
  const srv = net.createServer((sock) => { out = (s) => sock.write(s); sock.on("data", onData) })
  srv.listen(Number(portArg.slice(7)), "127.0.0.1", () => fs.writeFileSync(path.join(process.cwd(), "listen.json"), JSON.stringify(srv.address())))
} else process.stdin.on("data", onData)
`,
  )
})
// A stopped adapter is ended half a second after its disconnect (and its tree on Windows): that has to happen before
// the folder can go, and rmSync's retries would block the timer.
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 4000))
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
})

function make(o: { killed?: boolean; adapters?: DebugAdapterSetting[]; recordOk?: boolean; env?: NodeJS.ProcessEnv } = {}) {
  const records: Array<Record<string, unknown>> = []
  const d = new Debugger({
    adapters: () => o.adapters ?? [{ name: "fake", kind: "python", command: process.execPath, args: [adapter] }],
    audit: {
      record: async (r: Record<string, unknown>) => {
        records.push(r)
        return o.recordOk ?? true
      },
    } as never,
    killed: () => o.killed === true,
    policyHash: () => "h",
    redact: (s) => s.replace(/SECRET-VALUE/g, "[redacted]"),
    timeoutMs: 15_000,
    ...(o.env ? { env: o.env } : {}),
  })
  return { d, records }
}
const log = () => JSON.parse(fs.readFileSync(path.join(root, "log.json"), "utf8")) as { log: string[]; key: string | null; got: Array<{ type: string; command?: string; success?: boolean; args?: Record<string, unknown> }> }

describe("the debugger (G37)", () => {
  it("starts a program under the adapter, stops at a breakpoint with the stack and variables redacted, and steps", async () => {
    const { d, records } = make()
    try {
      await d.start("s1", root, "desktop", { adapter: "fake", program: "app.py", breakpoints: { "app.py": [2, 99] } })
      const st = await d.settle("s1", 5000)
      expect(st).toMatchObject({
        adapter: "fake",
        program: "app.py",
        state: "stopped",
        reason: "breakpoint",
        frames: [{ name: "<module>", file: "app.py", line: 2 }, { name: "runner", line: 40 }],
        variables: [{ name: "x", value: "1", type: "int" }, { name: "token", value: "[redacted]" }],
        breakpoints: { "app.py": [2, 99] },
      })
      expect(st.frames![1]).not.toHaveProperty("file")
      expect(st.output).toBe("hello [redacted]\n")
      // The launch it was given, and the order: breakpoints before configurationDone.
      const l = log()
      expect(l.log.indexOf("setBreakpoints")).toBeLessThan(l.log.indexOf("configurationDone"))
      expect(l.got.find((g) => g.command === "launch")!.args).toMatchObject({ program: path.join(root, "app.py"), cwd: root, type: "python" })
      // Its request to run something else was refused.
      expect(l.got.find((g) => g.type === "response" && g.command === "runInTerminal")).toMatchObject({ success: false })

      await d.step("s1", "companion", "next")
      expect((await d.settle("s1", 5000)).reason).toBe("step")
      await d.step("s1", "desktop", "continue")
      const end = await d.settle("s1", 5000)
      expect(end.state).toBe("ended")
      expect(end.reason).toMatch(/exited with 0/)
      await expect(d.step("s1", "desktop", "next")).rejects.toThrow(DebugError)
      // Every action audited first, with who took it.
      expect(records.map((r) => [r.event, (r.input as { action: string; by: string }).action, (r.input as { by: string }).by])).toEqual([
        ["debug_action", "start", "you"],
        ["debug_action", "next", "Claude"],
        ["debug_action", "continue", "you"],
        ["debug_action", "next", "you"],
      ])
      expect(records[1]).toMatchObject({ tool: "companion-debugger" })
    } finally {
      d.close()
    }
  })

  it("does not start while the kill switch is engaged, unrecorded, for an adapter not named, or outside the folder", async () => {
    await expect(make({ killed: true }).d.start("s1", root, "desktop", { adapter: "fake", program: "app.py" })).rejects.toThrow(/kill switch/)
    await expect(make({ recordOk: false }).d.start("s1", root, "desktop", { adapter: "fake", program: "app.py" })).rejects.toThrow(/audit log/)
    await expect(make({ adapters: [] }).d.start("s1", root, "desktop", { adapter: "fake", program: "app.py" })).rejects.toThrow(/No debug adapter/)
    const { d, records } = make()
    await expect(d.start("s1", root, "companion", { adapter: "fake", program: "../outside.py" })).rejects.toThrow(/session's folder/)
    await expect(d.start("s1", root, "companion", { adapter: "fake", program: "app.py", breakpoints: { "../x.py": [1] } })).rejects.toThrow(/not in the session's folder/)
    expect(records).toEqual([])
  })

  it("reaches an adapter that listens on the port it is given, on 127.0.0.1, and stops it", async () => {
    const { d } = make({ adapters: [{ name: "port", kind: "node", command: process.execPath, args: [adapter, "--port={port}"] }] })
    try {
      await d.start("s2", root, "desktop", { adapter: "port", program: "app.py", breakpoints: { "app.py": [1] } })
      expect((await d.settle("s2", 5000)).state).toBe("stopped")
      expect(JSON.parse(fs.readFileSync(path.join(root, "listen.json"), "utf8"))).toMatchObject({ address: "127.0.0.1" })
      expect(log().got.find((g) => g.command === "launch")!.args).toMatchObject({ type: "pwa-node" })
      await d.stop("s2", "desktop")
      expect(d.state("s2")).toBeUndefined()
      await new Promise((r) => setTimeout(r, 300))
      expect(log().log).toContain("disconnect")
    } finally {
      d.close()
    }
  })

  it("starts the adapter without a credential, and does not step a program that is running", async () => {
    const { d } = make({ adapters: [{ name: "running", kind: "python", command: process.execPath, args: [adapter, "--no-stop"] }], env: { ...process.env, ANTHROPIC_API_KEY: "must-not-pass" } })
    try {
      await d.start("s5", root, "desktop", { adapter: "running", program: "app.py" })
      expect(d.state("s5")!.state).toBe("running")
      expect(log().key).toBeNull()
      await expect(d.step("s5", "desktop", "next")).rejects.toThrow(/not stopped/)
    } finally {
      d.close()
    }
  })

  it("asks each kind of adapter to launch in its own words", () => {
    expect(launchArgs("dotnet", "C:/p/bin/app.dll", [], "C:/p")).toMatchObject({ request: "launch", type: "coreclr", program: "C:/p/bin/app.dll", stopAtEntry: false })
    expect(launchArgs("other", "p", ["a"], "c")).toEqual({ request: "launch", program: "p", args: ["a"], cwd: "c" })
  })
})


describe("Claude's debug tools (G37)", () => {
  it("act as Claude's, wait for the stop, and answer in plain text with the stack and variables", async () => {
    const { d, records } = make()
    try {
      const c = debugClient(d, "s4", () => root)
      const started = await c.start({ adapter: "fake", program: "app.py", breakpoints: { "app.py": [2] } })
      expect(started.text).toContain("app.py under fake: stopped (breakpoint).")
      expect(started.text).toContain("<module> app.py:2")
      expect(started.text).toContain("runner (outside the folder) line 40")
      expect(started.text).toContain("token = [redacted]")
      expect(started.text).not.toContain("SECRET-VALUE")
      expect((await c.breakpoints("app.py", [3])).text).toBe("Placed at 3 in app.py.")
      expect((await c.step("continue")).text).toMatch(/ended \(the program exited with 0\)/)
      expect((await c.breakpoints("../x.py", [1])).isError).toBe(true)
      expect(records.map((r) => [(r.input as { action: string }).action, (r.input as { by: string }).by, r.tool])).toEqual([
        ["start", "Claude", "companion-debugger"],
        ["breakpoints", "Claude", "companion-debugger"],
        ["continue", "Claude", "companion-debugger"],
      ])
      expect(stateText(undefined)).toBe("Nothing is being debugged.")
    } finally {
      d.close()
    }
  })
})
// A real breakpoint in Python, through the debugpy that VS Code's Python debugger brings, where it is installed.
const extDir = path.join(os.homedir(), ".vscode", "extensions")
const debugpyLibs = fs.existsSync(extDir)
  ? fs.readdirSync(extDir).filter((n) => n.startsWith("ms-python.debugpy-")).map((n) => path.join(extDir, n, "bundled", "libs")).find((p) => fs.existsSync(path.join(p, "debugpy")))
  : undefined
describe.skipIf(!debugpyLibs || process.platform !== "win32")("a real Python breakpoint through debugpy (G37)", () => {
  it("stops at the line, with the variables there", async () => {
    const { d } = make({
      adapters: [{ name: "debugpy", kind: "python", command: "python", args: ["-m", "debugpy.adapter"] }],
      env: { ...process.env, PYTHONPATH: debugpyLibs! },
    })
    try {
      await d.start("s3", root, "desktop", { adapter: "debugpy", program: "app.py", breakpoints: { "app.py": [3] } })
      const st = await d.settle("s3", 30_000)
      expect(st.state).toBe("stopped")
      expect(st.frames?.[0]).toMatchObject({ file: "app.py", line: 3 })
      expect(st.variables).toEqual(expect.arrayContaining([expect.objectContaining({ name: "y", value: "2" })]))
      await d.step("s3", "desktop", "continue")
      expect((await d.settle("s3", 30_000)).state).toBe("ended")
    } finally {
      d.close()
    }
  }, 90_000)
})
