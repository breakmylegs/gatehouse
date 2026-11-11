// Mac fork. The resource limits per session on a Mac (owner, 30 Oct): packaging/mac/limits/main.swift, built with
// swiftc and run for real, through the Host's own limiter() as a session's Claude Code is.
import { execFileSync, spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { SpawnOptions } from "@anthropic-ai/claude-agent-sdk"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { findLimitsMac, macActionShell } from "../src/limits-mac.js"
import { limiter, type JobUsage } from "../src/limits.js"

const REPO = path.resolve(import.meta.dirname, "../../..")
const swiftc = process.platform === "darwin" ? "/usr/bin/swiftc" : undefined
const can = swiftc !== undefined && fs.existsSync(swiftc)
let dir: string
let exe: string

beforeAll(() => {
  if (!can) return
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-limits-mac-"))
  exe = path.join(dir, "codehouse-limits")
  execFileSync(swiftc, [
    "-O",
    "-o",
    exe,
    path.join(REPO, "packaging", "mac", "limits", "main.swift"),
  ])
}, 180_000)
afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
})

let jobs = 0
const helper = (args: string[], command: string[]) =>
  spawnSync(exe, ["--name", `t-run-${++jobs}`, ...args, "--", ...command], {
    encoding: "utf8",
    timeout: 30_000,
  })
const free = ["--cpu", "0", "--memory-mb", "0", "--priority", "normal"]

/** Runs a command the way a session's Claude Code is run, and collects what comes back. */
function asSession(job: string, level: "high" | "medium", script: string) {
  let out = ""
  let err = ""
  const usage: JobUsage[] = []
  const child = limiter(exe).spawn(
    job,
    () => level,
    (t) => (err += t),
    (u) => usage.push(u),
  )({
    command: "/bin/sh",
    args: ["-c", script],
    cwd: dir,
    env: process.env,
    signal: new AbortController().signal,
  } as SpawnOptions) as unknown as ReturnType<typeof spawn>
  child.stdout?.on("data", (d: Buffer) => (out += d.toString()))
  const done = new Promise<number | null>((r) => child.on("exit", (code) => r(code)))
  return { child, done, out: () => out, err: () => err, usage }
}

describe.skipIf(!can)("the resource limits per session on a Mac", () => {
  it("runs the command on its own streams and exits with its exit code", () => {
    const r = helper(free, ["/bin/sh", "-c", "echo out; echo err >&2; exit 7"])
    expect(r.status).toBe(7)
    expect(r.stdout).toBe("out\n")
    expect(r.stderr).toBe("err\n")
  })

  it("gives way to what you are doing from the first instruction, and reports what the job uses", async () => {
    const s = asSession("Local\\Codehouse-test-medium", "medium", "ps -o nice= -p $$; sleep 6")
    expect(await s.done).toBe(0)
    expect(s.out().trim()).toBe("10")
    expect(s.usage.length).toBeGreaterThanOrEqual(1)
    expect(s.usage[0]).toMatchObject({
      processes: expect.any(Number),
      memoryMb: expect.any(Number),
    })
    expect(s.err()).not.toContain("[codeh-usage]")
  }, 20_000)

  it("lowers a running session's priority when its level changes, found by the Host's job name", async () => {
    const job = "Local\\Codehouse-test-set"
    const s = asSession(job, "high", "sleep 2; ps -o nice= -p $$")
    await new Promise((r) => setTimeout(r, 700))
    await limiter(exe).set(job, "medium")
    expect(await s.done).toBe(0)
    expect(s.out().trim()).toBe("10")
    await expect(limiter(exe).set("Local\\Codehouse-gone", "low")).rejects.toThrow(/no running job/)
  }, 20_000)

  it("ends the largest process over the memory cap and says so, and the rest carry on", () => {
    const hog = `node -e "const a=[]; for (let i = 0; i < 40; i++) a.push(Buffer.alloc(10 << 20, 1)); setTimeout(() => {}, 4000)"`
    const r = helper(
      ["--cpu", "0", "--memory-mb", "100", "--priority", "normal"],
      ["/bin/sh", "-c", `${hog}; echo "after $?"`],
    )
    expect(r.stderr).toMatch(
      /\[codeh-limits\] ended process \d+, which used \d+ MB: the session's memory limit is 100 MB/,
    )
    expect(r.stdout).toBe("after 137\n")
  }, 20_000)

  it("holds the job to its share of the processor", () => {
    const loop = [
      "node",
      "-e",
      "const t = Date.now(); let i = 0; while (Date.now() - t < 2500) i++; console.log(i)",
    ]
    const free_ = Number(helper(free, loop).stdout)
    const capped = Number(
      helper(["--cpu", "2", "--memory-mb", "0", "--priority", "normal"], loop).stdout,
    )
    // One busy core is 100 / cores percent of the whole processor; held to 2% it does well under that share of work.
    const share = 2 / (100 / os.availableParallelism())
    expect(capped / free_).toBeLessThan(Math.min(0.8, share * 2.5))
  }, 30_000)

  it("ends everything the job started when it is stopped, as closing a Windows job does", async () => {
    const marker = `codehouse-limits-test-${process.pid}`
    const h = spawn(
      exe,
      [
        ...free,
        "--name",
        "t-stop",
        "--",
        "/bin/sh",
        "-c",
        `sleep 300 & exec -a ${marker} sleep 300`,
      ],
      {
        stdio: "ignore",
      },
    )
    await new Promise((r) => setTimeout(r, 800))
    const count = () =>
      spawnSync("/usr/bin/pgrep", ["-f", "sleep 300"])
        .stdout.toString()
        .trim()
        .split("\n")
        .filter(Boolean).length
    expect(count()).toBeGreaterThanOrEqual(2)
    h.kill("SIGTERM")
    const code = await new Promise<number | null>((r) => h.on("exit", (c) => r(c)))
    expect(code).toBe(143)
    await new Promise((r) => setTimeout(r, 300))
    expect(count()).toBe(0)
  }, 20_000)

  it("is found only where Codehouse.app says, and runs Codehouse's own commands through sh", () => {
    expect(findLimitsMac({ GATEHOUSE_MAC_LIMITS: exe })).toBe(exe)
    expect(findLimitsMac({ GATEHOUSE_MAC_LIMITS: "codehouse-limits" })).toBeUndefined()
    expect(findLimitsMac({ GATEHOUSE_MAC_LIMITS: path.join(dir, "missing") })).toBeUndefined()
    expect(findLimitsMac({})).toBeUndefined()
    expect(macActionShell("npm test", "darwin")).toEqual(["/bin/sh", "-c", "npm test"])
    expect(macActionShell("npm test", "win32")).toBeUndefined()
  })
})
