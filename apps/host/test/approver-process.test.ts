import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { verifyAudit } from "@gatehouse/shared/audit"
import { ApproverClient } from "../src/approver-client.js"
import { ApproverProcess, freePort, generateToken } from "../src/approver-process.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const MAIN = path.resolve(here, "../../approver/src/main.ts")
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href
const REPO = path.resolve(here, "../../..")

let tmp: string
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gh-supervisor-"))
})
// The Approver's PowerShell worker may take a moment to notice its parent is gone and release the folder.
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }))

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(cond: () => boolean, ms: number, step = 25): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (cond()) return true
    await wait(step)
  }
  return cond()
}

describe("tokens and ports", () => {
  it("makes a long, different token each time", () => {
    const a = generateToken()
    const b = generateToken()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(32)
  })
  it("finds a free port", async () => {
    expect(await freePort()).toBeGreaterThan(1023)
  })
})

describe("ApproverProcess back-off", () => {
  it("restarts a process that keeps dying with growing delays, and stops when told to", async () => {
    const flag = path.join(tmp, "launches.txt")
    fs.writeFileSync(flag, "")
    const script = `require('fs').appendFileSync(${JSON.stringify(flag)}, 'x'); console.log(JSON.stringify({event:'listening',port:1,pid:process.pid})); setTimeout(()=>process.exit(3), 20)`
    const sup = new ApproverProcess({
      command: process.execPath,
      args: ["-e", script],
      token: generateToken(),
      port: 1,
      backoff: { initialMs: 60, maxMs: 400, factor: 2, resetAfterMs: 60_000 },
    })
    const delays: number[] = []
    sup.on("restarting", (e) => delays.push(e.delayMs))
    await sup.start()
    expect(sup.state).toBe("up")
    expect(await until(() => delays.length >= 4, 30_000)).toBe(true)
    expect(delays.slice(0, 4)).toEqual([60, 120, 240, 400])
    await sup.stop()
    const launches = fs.readFileSync(flag, "utf8").length
    await wait(700)
    expect(fs.readFileSync(flag, "utf8").length).toBe(launches)
    expect(sup.state).toBe("stopped")
  }, 30000)

  it("rejects start() when the process never becomes ready", async () => {
    const quick = new ApproverProcess({
      command: process.execPath,
      args: ["-e", "process.exit(2)"],
      token: generateToken(),
      port: 1,
    })
    await expect(quick.start()).rejects.toThrow(/exited before it was ready/)
    expect(quick.state).toBe("stopped")
    const silent = new ApproverProcess({
      command: process.execPath,
      args: ["-e", "setTimeout(()=>{}, 30000)"],
      token: generateToken(),
      port: 1,
      readyTimeoutMs: 300,
    })
    await expect(silent.start()).rejects.toThrow(/did not become ready/)
    const missing = new ApproverProcess({
      command: "no-such-program-here",
      args: [],
      token: generateToken(),
      port: 1,
    })
    await expect(missing.start()).rejects.toThrow()
  }, 30000)

  it("will not start twice", async () => {
    const script = `console.log(JSON.stringify({event:'listening',port:1})); process.stdin.on('end', () => process.exit(0)); process.stdin.resume()`
    const sup = new ApproverProcess({
      command: process.execPath,
      args: ["-e", script],
      token: generateToken(),
      port: 1,
    })
    await sup.start()
    await expect(sup.start()).rejects.toThrow(/already started/)
    const t0 = Date.now()
    await sup.stop()
    expect(Date.now() - t0).toBeLessThan(3500) // it left when its stdin closed, it was not killed
  }, 30000)

  it("tells a well-behaved child to stop by closing its stdin, and an unresponsive one is killed", async () => {
    const stubborn = `console.log(JSON.stringify({event:'listening',port:1})); setInterval(()=>{}, 1000)`
    const sup = new ApproverProcess({
      command: process.execPath,
      args: ["-e", stubborn],
      token: generateToken(),
      port: 1,
    })
    await sup.start()
    const t0 = Date.now()
    await sup.stop()
    expect(Date.now() - t0).toBeGreaterThanOrEqual(3500)
    expect(sup.state).toBe("stopped")
  }, 30000)
})

describe("the real Approver, killed and restarted", () => {
  it("escalates everything while it is down, never allows, comes back, and keeps the audit chain intact", async () => {
    const port = await freePort()
    const auditDir = path.join(tmp, "audit")
    const dataDir = path.join(tmp, "data")
    fs.mkdirSync(dataDir)
    const logs: string[] = []
    const sup = new ApproverProcess({
      command: process.execPath,
      args: ["--import", TSX, MAIN],
      cwd: tmp,
      env: {
        GATEHOUSE_AUDIT_DIR: auditDir,
        GATEHOUSE_DATA_DIR: dataDir,
        GATEHOUSE_RULES_PATH: path.join(REPO, "policy", "rules.yaml"),
      },
      token: generateToken(),
      port,
      backoff: { initialMs: 300, maxMs: 2000, factor: 2, resetAfterMs: 60_000 },
      readyTimeoutMs: 60_000,
      onLog: (l) => logs.push(l),
    })
    const readyEvents: number[] = []
    sup.on("ready", (e) => readyEvents.push(e.pid))
    await sup.start()
    try {
      const client = new ApproverClient({ url: sup.url, token: sup.token, timeoutMs: 5000 })
      const call = { toolName: "Bash", input: { command: "git status" } }
      const ctx = { cwd: REPO, sessionId: "crash-test" }

      const before = await client.evaluate(call, ctx)
      expect(before).toMatchObject({ outcome: "allow", ruleId: "safe-shell" })
      const firstPid = readyEvents[0] as number
      expect((await client.status())?.audit).toMatchObject({ seq: 1 })

      // Kill it hard, with no chance to clean up.
      process.kill(firstPid, "SIGKILL")
      expect(await until(() => sup.state === "down", 10_000)).toBe(true)

      // While it is down, every question is escalated and nothing is allowed.
      for (let i = 0; i < 5; i++) {
        const v = await client.evaluate(call, ctx)
        expect(v).toMatchObject({
          outcome: "escalate",
          ruleId: "evaluator-unavailable",
          decidedBy: "evaluator-unavailable",
        })
        if (sup.state === "up") break
      }

      expect(await until(() => readyEvents.length === 2, 60_000, 100)).toBe(true)
      expect(readyEvents[1]).not.toBe(firstPid)
      const after = await client.evaluate(call, ctx)
      expect(after).toMatchObject({ outcome: "allow", ruleId: "safe-shell" })
      expect(after.policyHash).toBe(before.policyHash)

      const result = verifyAudit(auditDir)
      expect(result).toMatchObject({ ok: true, records: 2 })
      expect((await client.status())?.audit).toMatchObject({ seq: 2 })
    } finally {
      await sup.stop()
    }
    expect(sup.state).toBe("stopped")
    expect(logs.join("\n")).not.toContain("unhandled")
  }, 180_000)
})
