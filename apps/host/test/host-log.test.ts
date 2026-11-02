import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { fileLog, MAX_LOG_BYTES } from "../src/host-log.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-log-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe("the Host's log file", () => {
  it("keeps each line with its time, redacted with the settings' list (invariant 12)", () => {
    const file = path.join(dir, "host.log")
    const log = fileLog(file)
    log.setTerms(() => ["Contoso"])
    log.write("session s1 (Contoso shop) stopped with an error: token sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789")
    const text = fs.readFileSync(file, "utf8")
    expect(text).toMatch(/^\d{4}-\d\d-\d\dT.* session s1 \(/)
    expect(text).not.toContain("Contoso")
    expect(text).not.toContain("sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789")
  })

  it("keeps the one before when it grows too big, and never throws", () => {
    const file = path.join(dir, "big.log")
    fs.writeFileSync(file, "x".repeat(MAX_LOG_BYTES + 1))
    fileLog(file).write("after the turn over")
    expect(fs.statSync(`${file}.1`).size).toBe(MAX_LOG_BYTES + 1)
    expect(fs.readFileSync(file, "utf8")).toContain("after the turn over")
    expect(() => fileLog(path.join(dir, "missing\0dir", "x.log")).write("x")).not.toThrow()
  })
})
