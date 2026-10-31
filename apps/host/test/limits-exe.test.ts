// JCVC-Limits.exe, built from packaging/Limits.cs and run for real: a child inside a job object with the session's
// resource limits (owner, 30 Oct), its streams and exit code passed through, and nothing left once it is killed.
import { execFileSync, spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { limiter } from "../src/limits.js"

const REPO = path.resolve(import.meta.dirname, "../../..")
const csc = [
  `${process.env.windir}\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe`,
  `${process.env.windir}\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe`,
].find((p) => fs.existsSync(p))
let dir: string
let exe: string
let n = 0
const job = () => `Local\\jcvc-test-${process.pid}-${++n}`
const query = (name: string) =>
  JSON.parse(execFileSync(exe, ["--query", name], { windowsHide: true }).toString()) as {
    cpu: number
    memoryMb: number
    priority: string
    processes: number
  }

beforeAll(() => {
  if (!csc) return
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-limits-"))
  exe = path.join(dir, "JCVC-Limits.exe")
  execFileSync(csc, [
    "/nologo",
    "/target:exe",
    `/out:${exe}`,
    path.join(REPO, "packaging", "Limits.cs"),
  ])
}, 120_000)
afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(!csc)("JCVC-Limits.exe", () => {
  it("runs the command inside a job with the session's limits, and changes them while it runs", async () => {
    const name = job()
    const child = limiter(exe).spawn(
      name,
      () => "low",
      () => undefined,
    )({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 15000)"],
      env: process.env,
    } as never) as unknown as ReturnType<typeof spawn>
    try {
      // The helper makes the job as it starts, which takes longer on a busy computer: wait for it, not a fixed time.
      await vi.waitFor(() => expect(query(name)).toBeTruthy(), { timeout: 10_000, interval: 250 })
      expect(query(name)).toMatchObject({ cpu: 20, memoryMb: 2048, priority: "below" })
      await limiter(exe).set(name, "high")
      expect(query(name)).toMatchObject({ cpu: 0, memoryMb: 0, priority: "normal" })
    } finally {
      child.kill()
    }
  })

  it("passes input, output, errors and the exit code through, so the SDK talks to Claude Code directly", async () => {
    const errors: string[] = []
    const child = limiter(exe).spawn(
      job(),
      () => "medium",
      (t) => errors.push(t),
    )({
      command: process.execPath,
      args: [
        "-e",
        "process.stdin.once('data', (d) => { process.stdout.write('got ' + d); process.stderr.write('a warning\\n'); setTimeout(() => process.exit(7), 200) })",
      ],
      env: process.env,
    } as never) as unknown as ReturnType<typeof spawn>
    let out = ""
    child.stdout?.on("data", (d: Buffer) => (out += d.toString()))
    child.stdin?.write("hello\n")
    const code = await new Promise((r) => child.on("exit", r))
    expect([code, out]).toEqual([7, "got hello\n"])
    expect(errors.join("")).toContain("a warning")
  })

  it("ends the command and everything it started when it is killed", async () => {
    const name = job()
    const child = limiter(exe).spawn(
      name,
      () => "high",
      () => undefined,
    )({
      command: process.execPath,
      args: [
        "-e",
        "const g = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); console.log(JSON.stringify({ me: process.pid, grand: g.pid })); setInterval(() => {}, 1000)",
      ],
      env: process.env,
    } as never) as unknown as ReturnType<typeof spawn>
    const line = await new Promise<string>((r) =>
      child.stdout?.once("data", (d: Buffer) => r(d.toString())),
    )
    const { me, grand } = JSON.parse(line) as { me: number; grand: number }
    expect(query(name).processes).toBeGreaterThanOrEqual(2)
    child.kill()
    await new Promise((r) => setTimeout(r, 1500))
    // The processes themselves, not the job's name: the name goes with the last handle even if they live on.
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    }
    expect([alive(me), alive(grand)]).toEqual([false, false])
  })

  it("refuses memory past the cap, to the command and what it starts", () => {
    const grab =
      "const a=[];try{for(let i=0;i<40;i++)a.push(Buffer.alloc(32*1024*1024,1));console.log('allocated')}catch{console.log('refused')}"
    const run = (mb: string) =>
      spawnSync(
        exe,
        [
          "--name",
          job(),
          "--cpu",
          "0",
          "--memory-mb",
          mb,
          "--priority",
          "normal",
          "--",
          process.execPath,
          "-e",
          grab,
        ],
        {
          encoding: "utf8",
          windowsHide: true,
        },
      ).stdout.trim()
    expect(run("400")).toBe("refused")
    expect(run("0")).toBe("allocated")
  })
})
