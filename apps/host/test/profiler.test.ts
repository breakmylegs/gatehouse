// E-041: a command is profiled with Node's own --cpu-prof; a fixture's hot loop is the top frame, and no inspector port
// is opened, even when the environment asks for one.
import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { profileDotnet, profiledNodeOptions, profileNode, profileSummary, readSpeedscope, type ProfileRun } from "../src/profiler.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-prof-fixture-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

// A program whose time goes into hotLoop, and which says whether an inspector is open.
fs.writeFileSync(
  path.join(dir, "fixture.js"),
  `const inspector = require("node:inspector")
function hotLoop() { let x = 0; const end = Date.now() + 400; while (Date.now() < end) { for (let i = 0; i < 1e5; i++) x += Math.sqrt(i) } return x }
function idle() { return 1 }
hotLoop(); idle()
console.log("inspector:" + String(inspector.url()))
`,
)

/** Runs a command as the action runner would, with the environment it is given added. */
const run =
  (seen: string[]): ProfileRun =>
  (command, cwd, env) =>
    new Promise((resolve) =>
      execFile(process.execPath, command.split(" ").slice(1), { cwd, env: { ...process.env, ...env } }, (e, out) => {
        seen.push(String(out))
        resolve({ ran: true, exitCode: e ? 1 : 0, output: String(out) })
      }),
    )

describe("profiling on request", () => {
  it("finds the fixture's hot loop as the top frame", { timeout: 60_000 }, async () => {
    const r = await profileNode("node fixture.js", dir, run([]))
    if ("notProfiled" in r) throw new Error(r.notProfiled)
    expect(r.top[0]!.fn).toBe("hotLoop")
    expect(r.top[0]!.where).toMatch(/fixture\.js:2$/)
    expect(r.top[0]!.selfMs).toBeGreaterThan(200)
    expect(r.flame.children.length).toBeGreaterThan(0)
    expect(profileSummary("node fixture.js", r)).toMatch(/^Codehouse profiled `node fixture\.js`[\s\S]*1\. hotLoop/)
  })

  it("opens no inspector port, even when NODE_OPTIONS asks for one", { timeout: 60_000 }, async () => {
    const seen: string[] = []
    await profileNode("node fixture.js", dir, run(seen), { NODE_OPTIONS: "--inspect=127.0.0.1:9229 --max-old-space-size=512" })
    expect(seen[0]).toContain("inspector:undefined")
    expect(profiledNodeOptions("--inspect --inspect-brk=0 --inspect-port=9230 --debug --max-old-space-size=512", "C:/t")).toBe('--max-old-space-size=512 --cpu-prof --cpu-prof-dir="C:/t"')
  })

  it("says why there is no profile, and leaves no folder", async () => {
    const before = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith("codeh-profile-")).length
    expect(await profileNode("node x", dir, async () => ({ ran: false, exitCode: null, output: "", refused: "the rules denied it" }))).toEqual({ notProfiled: "it was not run: the rules denied it" })
    expect(await profileNode("node x", dir, async () => ({ ran: true, exitCode: 0, output: "" }))).toMatchObject({ notProfiled: expect.stringMatching(/no profile was written/) })
    expect(fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith("codeh-profile-")).length).toBe(before)
  })

  it("profiles a .NET command through dotnet-trace, reading its speedscope file", async () => {
    const commands: string[] = []
    const r = await profileDotnet("dotnet run", dir, async (command) => {
      commands.push(command)
      const out = /-o "([^"]+)"/.exec(command)![1]!
      fs.writeFileSync(out.replace(/\.nettrace$/, ".speedscope.json"), JSON.stringify({ shared: { frames: [{ name: "Main" }, { name: "Hot" }] }, profiles: [{ unit: "milliseconds", samples: [[0, 1], [0, 1]], weights: [50, 50] }] }))
      return { ran: true, exitCode: 0, output: "" }
    })
    expect(commands[0]).toMatch(/^dotnet-trace collect --format Speedscope -o ".+trace\.nettrace" -- dotnet run$/)
    if ("notProfiled" in r) throw new Error(r.notProfiled)
    expect(r.top[0]).toMatchObject({ fn: "Hot", selfMs: 100 })
  })

  it("reads a dotnet-trace speedscope profile", () => {
    const top = readSpeedscope({ shared: { frames: [{ name: "Main" }, { name: "Cart.Total", file: "Cart.cs", line: 9 }, { name: "Log" }] }, profiles: [{ type: "sampled", unit: "milliseconds", samples: [[0, 1], [0, 1], [0, 2], [0]], weights: [10, 10, 5, 1] }] })
    expect(top.map((f) => [f.fn, f.selfMs, f.totalMs])).toEqual([["Cart.Total", 20, 20], ["Log", 5, 5], ["Main", 1, 26]])
  })
})
