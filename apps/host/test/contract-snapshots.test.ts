// E-034: each probe keeps the shape of every answer (never a value), and the next probe reports a changed shape.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { shapeOf } from "../src/conformance-probe.js"
import { ContractSnapshots, shapeChanges } from "../src/contract-snapshots.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-snap-test-"))
  dirs.push(d)
  return d
}

describe("contract snapshots", () => {
  it("reports a changed shape on the next probe", () => {
    const snaps = new ContractSnapshots(tmp())
    const first = { id: 7, name: "Ada", tags: [{ label: "x" }] }
    const second = { id: "7", tags: [{ label: "x", colour: "red" }], email: "a@example.com" }
    expect(snaps.record("C:/dev/shop", [{ method: "GET", path: "/users/{id}", status: 200, shape: shapeOf(first) }])).toEqual([])
    const changes = snaps.record("C:/dev/shop", [{ method: "GET", path: "/users/{id}", status: 200, shape: shapeOf(second) }])
    expect(changes.map((c) => c.replace(/ since \d{4}-\d\d-\d\d$/, ""))).toEqual([
      "GET /users/{id}: .name is gone",
      "GET /users/{id}: .email is new",
      "GET /users/{id}: .id was number and is now string",
      "GET /users/{id}: .tags[].colour is new",
    ])
    // Unchanged: nothing to say; a status change is said.
    expect(snaps.record("C:/dev/shop", [{ method: "GET", path: "/users/{id}", status: 200, shape: shapeOf(second) }])).toEqual([])
    expect(snaps.record("C:/dev/shop", [{ method: "GET", path: "/users/{id}", status: 404, shape: shapeOf(second) }])[0]).toMatch(/answered 404, where it answered 200/)
  })

  it("keeps shapes only, never a value, with keys through the redaction list, and each project apart", () => {
    const dir = tmp()
    const snaps = new ContractSnapshots(dir, (k) => k.replace(/secret\w*/i, "[redacted]"))
    snaps.record("C:/dev/shop", [{ method: "GET", path: "/me", status: 200, shape: shapeOf({ email: "ada@real-company.co.uk", secretToken: "abc123", n: 4 }) }])
    const stored = fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]!), "utf8")
    expect(stored).not.toMatch(/ada@|abc123|real-company/)
    expect(stored).toContain('"[redacted]": "string"')
    expect(Object.keys(snaps.read("C:/dev/shop"))).toEqual(["GET /me"])
    expect(snaps.read("C:/dev/other")).toEqual({})
  })

  it("compares shapes of arrays, nulls and types", () => {
    expect(shapeOf({ a: [1, 2], b: null, c: [] })).toEqual({ a: ["number"], b: "null", c: [] })
    expect(shapeChanges({ a: "string" }, { a: ["string"] })).toEqual([".a was string and is now array"])
    expect(shapeChanges(["number"], [])).toEqual([])
  })
})
