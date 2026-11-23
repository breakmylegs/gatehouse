// E-039: errors are grouped by signature and counted; two that differ only in ids are one; frames are mapped to their
// source; each signature offers a fix task.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { fixTask, normalise, parseFrame, triage } from "../src/error-triage.js"
import type { LogEntry } from "../src/log-capture.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

const e = (message: string, at: string, level?: LogEntry["level"], source = "app.log"): LogEntry => ({ at, message, source, ...(level ? { level } : {}) })

describe("error signature triage", () => {
  it("groups two errors that differ only in ids into one signature, and counts it", () => {
    const entries = [
      e("TypeError: Cannot read properties of undefined (reading 'total') for order 4411 user 9f1c2a3b-0000-4000-8000-000000000001", "2026-11-23T01:00:00Z", "error"),
      e("    at priceOf (C:\\dev\\shop\\dist\\cart.js:10:15)", "2026-11-23T01:00:00Z"),
      e("TypeError: Cannot read properties of undefined (reading 'total') for order 5520 user 0e2d4b5c-1111-4000-8000-000000000002", "2026-11-23T02:00:00Z", "error"),
      e("    at priceOf (C:\\dev\\shop\\dist\\cart.js:10:15)", "2026-11-23T02:00:00Z"),
      e("RangeError: Invalid time value", "2026-11-23T03:00:00Z", "error"),
      e("INFO all good", "2026-11-23T03:00:01Z", "info"),
    ]
    const s = triage("C:/nowhere", entries)
    expect(s.map((x) => [x.type, x.count])).toEqual([["TypeError", 2], ["RangeError", 1]])
    expect(s[0]).toMatchObject({ message: "Cannot read properties of undefined (reading <value>) for order <n> user <uuid>", first: "2026-11-23T01:00:00Z", last: "2026-11-23T02:00:00Z" })
    expect(s[0]!.frames[0]).toMatchObject({ fn: "priceOf", line: 10, column: 15 })
  })

  it("normalises what changes between occurrences", () => {
    expect(normalise('Timeout after 3000ms calling https://api.example.com/v1/orders/77 at 2026-11-23T01:02:03Z for a@b.co id 0xdeadbeef "Ada"')).toBe(
      "Timeout after <n>ms calling <url> at <time> for <email> id <hex> <value>",
    )
  })

  it("reads JavaScript, Python and .NET frames", () => {
    expect(parseFrame("    at Object.run (/app/src/x.js:3:9)")).toEqual({ fn: "Object.run", file: "/app/src/x.js", line: 3, column: 9 })
    expect(parseFrame('  File "/app/views.py", line 42, in checkout')).toEqual({ fn: "checkout", file: "/app/views.py", line: 42 })
    expect(parseFrame("   at Shop.Cart.Total() in C:\\src\\Cart.cs:line 17")).toEqual({ fn: "Shop.Cart.Total", file: "C:\\src\\Cart.cs", line: 17 })
    expect(parseFrame("just words")).toBeUndefined()
  })

  it("maps a frame through its source map, from inside the project only", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-triage-"))
    dirs.push(root)
    fs.mkdirSync(path.join(root, "dist"))
    fs.writeFileSync(path.join(root, "dist", "cart.js"), "function priceOf(o){return o.total}\n//# sourceMappingURL=cart.js.map\n")
    // Line 1, column 0 of cart.js comes from line 12, column 2 of src/cart.ts.
    fs.writeFileSync(path.join(root, "dist", "cart.js.map"), JSON.stringify({ version: 3, file: "cart.js", sources: ["../src/cart.ts"], names: [], mappings: "AAWE" }))
    const [s] = triage(root, [e("TypeError: boom", "2026-11-23T01:00:00Z", "error"), e(`    at priceOf (${path.join(root, "dist", "cart.js")}:1:1)`, "2026-11-23T01:00:00Z")])
    expect(s!.frames[0]!.source).toEqual({ file: "src/cart.ts", line: 12, column: 3 })
    // The same file and map outside the project: real, readable, and still not used.
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-triage-other-"))
    dirs.push(other)
    fs.copyFileSync(path.join(root, "dist", "cart.js"), path.join(other, "cart.js"))
    fs.copyFileSync(path.join(root, "dist", "cart.js.map"), path.join(other, "cart.js.map"))
    const [outside] = triage(root, [e("TypeError: boom", "2026-11-23T01:00:00Z", "error"), e(`    at priceOf (${path.join(other, "cart.js")}:1:1)`, "2026-11-23T01:00:00Z")])
    expect(outside!.frames[0]!.source).toBeUndefined()
  })

  it("offers a fix task naming the error, how often and where", () => {
    const frame = "    at priceOf (C:\\dev\\shop\\dist\\cart.js:10:15)"
    const [s] = triage("C:/nowhere", [e("TypeError: boom 1", "2026-11-23T01:00:00Z", "error"), e(frame, "2026-11-23T01:00:00Z"), e("TypeError: boom 2", "2026-11-23T01:05:00Z", "error"), e(frame, "2026-11-23T01:05:00Z")])
    const task = fixTask(s!)
    expect(task).toMatch(/appeared 2 times/)
    expect(task).toContain("TypeError: boom <n>")
    expect(task).toContain("cart.js:10 (priceOf)")
  })
})
