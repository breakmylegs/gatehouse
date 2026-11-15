// T-125 (t3code review): triage gives a chat, and only a chat in its own folder, the end of host.log and the Doctor's
// report, redacted as a report to share, recorded first; nothing is written when it cannot be recorded.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Fastify from "fastify"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { HostAudit } from "../src/hostaudit.js"
import { chatFolderOf, logTail, registerTriageRoutes, TRIAGE_PROMPT } from "../src/triage.js"

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-"))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe("triage (T-125)", () => {
  it("takes the end of the log from a line start, redacted, with no email address", () => {
    const log = path.join(dir, "host.log")
    fs.writeFileSync(log, `${"x".repeat(50)}\nsecond line by ana@example.com\nkey sk-ant-api03-${"a".repeat(40)}\n`)
    const tail = logTail(log, 90)
    expect(tail.startsWith("second line")).toBe(true)
    expect(tail).toContain("[email address]")
    expect(tail).not.toContain("sk-ant-api03")
    expect(logTail(path.join(dir, "none.log"))).toBe("(host.log could not be read)")
  })

  it("only gives files to a chat in its own folder Codehouse made for chats", () => {
    const chats = path.join(dir, "chats")
    expect(chatFolderOf({ kind: "chat", state: "idle", cwd: path.join(chats, "triage") }, chats)).toBe(path.join(chats, "triage"))
    expect(chatFolderOf({ kind: "chat", state: "idle", cwd: path.join(chats, "a", "b") }, chats)).toBeUndefined()
    expect(chatFolderOf({ state: "idle", cwd: path.join(chats, "triage") }, chats)).toBeUndefined()
    expect(chatFolderOf({ kind: "chat", state: "idle", cwd: path.join(dir, "elsewhere") }, chats)).toBeUndefined()
    expect(chatFolderOf({ kind: "chat", state: "ended", cwd: path.join(chats, "triage") }, chats)).toBeUndefined()
  })

  it("records it, writes the two files, and writes nothing when it cannot record", async () => {
    const folder = path.join(dir, "chat-1")
    fs.mkdirSync(folder)
    fs.writeFileSync(path.join(dir, "host.log"), "started\n")
    const records: unknown[] = []
    let ok = true
    const app = Fastify()
    registerTriageRoutes(app, {
      chatFolder: (id) => (id === "c1" ? folder : undefined),
      logFile: path.join(dir, "host.log"),
      audit: { record: async (r: unknown) => (records.push(r), ok) } as unknown as HostAudit,
      policyHash: () => "h",
    })
    const ask = (session: string) =>
      app.inject({ method: "POST", url: "/api/triage/prepare", payload: { session, report: "Approver: up, by bo@example.com" } })
    expect((await ask("other")).statusCode).toBe(404)
    ok = false
    expect((await ask("c1")).statusCode).toBe(503)
    expect(fs.existsSync(path.join(folder, "host-log.txt"))).toBe(false)
    ok = true
    expect((await ask("c1")).json()).toEqual({ prompt: TRIAGE_PROMPT })
    expect(fs.readFileSync(path.join(folder, "doctor-report.md"), "utf8")).toBe("Approver: up, by [email address]")
    expect(fs.readFileSync(path.join(folder, "host-log.txt"), "utf8")).toBe("started\n")
    expect(records).toHaveLength(2)
  })
})
