// E-038: log lines are parsed into fields and redacted before they are kept; a listed file the floor denies is not
// read; a Codehouse action's output reaches the store.
import { EventEmitter } from "node:events"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { redactString } from "@gatehouse/policy"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { runCodehouseAction, type ActionDeps } from "../src/codehouse-action.js"
import { LogStore, parseLine } from "../src/log-capture.js"
import { buildStack, type Stack } from "./stack.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-logs-test-"))
  dirs.push(d)
  return d
}
const store = () => new LogStore(tmp(), (t) => redactString(t))
/** A key-shaped secret, made here so none is written in the repository. */
const secret = () => ["AKIA", "IOSFODNN7", "EXAMPLE"].join("")

describe("log capture", () => {
  it("parses a JSON line into its fields", () => {
    expect(parseLine('{"time":"2026-11-23T01:02:03Z","level":"error","msg":"order failed","orderId":42,"user":{"id":7}}', "app.log")).toEqual({
      at: "2026-11-23T01:02:03.000Z",
      level: "error",
      message: "order failed",
      fields: { orderId: "42", user: '{"id":7}' },
      source: "app.log",
    })
    expect(parseLine('{"level":50,"time":1763859723000,"msg":"pino"}', "x")).toMatchObject({ level: "error", message: "pino", at: "2025-11-23T01:02:03.000Z" })
  })

  it("parses logfmt and the common text forms", () => {
    expect(parseLine('time=2026-11-23T01:02:03Z level=warn msg="disk low" free=2GB', "x")).toMatchObject({ level: "warn", message: "disk low", fields: { free: "2GB" } })
    expect(parseLine("2026-11-23 01:02:03,120 ERROR something broke", "x")).toMatchObject({ level: "error", message: "something broke", at: "2026-11-23T01:02:03.120Z" })
    expect(parseLine("[2026-11-23T01:02:03Z] [info] started", "x")).toMatchObject({ level: "info", message: "started" })
    expect(parseLine("WARN: retrying", "x")).toMatchObject({ level: "warn", message: "retrying" })
    expect(parseLine("plain words", "x")).toMatchObject({ message: "plain words" })
    expect(parseLine("   ", "x")).toBeUndefined()
  })

  it("masks a secret before it is kept, in messages and fields", () => {
    const s = store()
    s.append("C:/dev/shop", "app.log", `{"level":"info","msg":"using key ${secret()}","token":"${secret()}"}\nconnected with password=hunter2secret`)
    const raw = fs.readFileSync(path.join(s.dir, fs.readdirSync(s.dir)[0]!), "utf8")
    expect(raw).not.toContain(secret())
    expect(raw).not.toContain("hunter2secret")
    expect(s.query("C:/dev/shop")).toHaveLength(2)
  })

  it("searches by words, level and time, newest first, and drops lines past the retention", () => {
    const s = new LogStore(tmp(), (t) => t, () => 1)
    s.append("p", "a.log", ['{"time":"2020-01-01T00:00:00Z","level":"error","msg":"ancient"}', `{"time":"${new Date().toISOString()}","level":"info","msg":"order placed"}`, `{"time":"${new Date().toISOString()}","level":"error","msg":"order failed"}`].join("\n"))
    expect(s.query("p").map((e) => e.message)).toEqual(["order failed", "order placed"])
    expect(s.query("p", { level: "warn" }).map((e) => e.message)).toEqual(["order failed"])
    expect(s.query("p", { text: "placed order" }).map((e) => e.message)).toEqual(["order placed"])
    expect(s.query("p", { since: new Date(Date.now() + 60_000).toISOString() })).toEqual([])
    expect(s.query("other")).toEqual([])
  })

  it("reads only what each listed file has gained, and refuses one the rules do not allow", async () => {
    const root = tmp()
    fs.mkdirSync(path.join(root, ".codehouse"))
    fs.writeFileSync(path.join(root, ".codehouse", "logs.yml"), "files:\n  - logs/app.log\n  - logs/denied.log\n")
    fs.mkdirSync(path.join(root, "logs"))
    fs.writeFileSync(path.join(root, "logs", "app.log"), "INFO one\n")
    fs.writeFileSync(path.join(root, "logs", "denied.log"), "INFO secret\n")
    const s = store()
    const allow = async (abs: string) => !abs.endsWith("denied.log")
    expect(await s.tail(root, root, allow)).toEqual({ read: ["logs/app.log"], refused: ["logs/denied.log"] })
    fs.appendFileSync(path.join(root, "logs", "app.log"), "ERROR two\n")
    await s.tail(root, root, allow)
    expect(s.query(root).map((e) => e.message)).toEqual(["two", "one"])
  })

  it("keeps what a Codehouse action printed", async () => {
    const s = store()
    const deps: ActionDeps = {
      approver: { evaluate: async () => ({ outcome: "allow", ruleId: "safe-shell", reason: "r", risk: 0, decidedBy: "rules", policyHash: "h" }) },
      broker: {} as never,
      audit: { record: async () => true },
      kill: { isEngaged: () => false },
      extreme: () => false,
      start: () => {
        const c = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void }
        c.stdout = new EventEmitter()
        c.stderr = new EventEmitter()
        c.kill = () => undefined
        setTimeout(() => (c.stdout.emit("data", Buffer.from("WARN flaky test\n")), c.emit("close", 0)), 5)
        return c as never
      },
      onFinished: (r, output) => s.append(r.cwd, `action: ${r.command}`, output),
    }
    await runCodehouseAction({ sessionId: "s1", cwd: "C:/dev/shop", project: "shop", command: "npm test", why: "a check", level: "high" }, deps)
    expect(s.query("C:/dev/shop")).toEqual([expect.objectContaining({ level: "warn", message: "flaky test", source: "action: npm test" })])
  })
})

describe("with the real rules", () => {
  let st: Stack
  beforeAll(async () => {
    st = await buildStack({ hardTimeoutMs: 1500, phoneExpiryMs: 800 })
  }, 60000)
  afterAll(async () => {
    await st.stop()
  })

  it("refuses a listed path the floor denies", async () => {
    const root = st.repo
    fs.mkdirSync(path.join(root, ".codehouse"), { recursive: true })
    const denied = path.join(os.homedir(), ".ssh", "id_rsa")
    fs.writeFileSync(path.join(root, ".codehouse", "logs.yml"), `files:\n  - ${JSON.stringify(denied)}\n`)
    const verdict = await st.approver.evaluate({ toolName: "Read", input: { file_path: denied } }, { cwd: root, sessionId: "s1" })
    expect(verdict.outcome).toBe("deny")
    const s = store()
    const r = await s.tail(root, root, async (abs) => (await st.approver.evaluate({ toolName: "Read", input: { file_path: abs } }, { cwd: root, sessionId: "s1" })).outcome === "allow")
    expect(r).toEqual({ read: [], refused: [denied] })
  })
})
