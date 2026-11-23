// E-033: an edit to an API spec that breaks its clients without a major version bump waits for you; an added optional
// field passes.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { breakingChanges, majorBumped, readApiSpec, SPEC_BREAK_RULE, specBreakFindings } from "../src/spec-diff.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-spec-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const SPEC = `openapi: 3.0.3
info: { title: shop, version: "1.4.0" }
paths:
  /users/{id}:
    get:
      parameters: [{ name: id, in: path, required: true, schema: { type: integer } }]
      responses:
        "200":
          description: a user
          content:
            application/json:
              schema: { $ref: "#/components/schemas/User" }
  /orders:
    post:
      parameters: [{ name: dryRun, in: query, schema: { type: boolean } }]
      requestBody:
        content:
          application/json:
            schema: { type: object, required: [sku], properties: { sku: { type: string, maxLength: 40 }, qty: { type: integer, minimum: 1 } } }
      responses:
        "201": { description: made, content: { application/json: { schema: { type: object, properties: { id: { type: string } } } } } }
components:
  schemas:
    User:
      type: object
      properties:
        id: { type: integer }
        name: { type: string }
        tier: { type: string, enum: [free, pro] }
`

function edit(name: string, oldText: string, newText: string) {
  const abs = path.join(dir, name)
  fs.writeFileSync(abs, SPEC)
  return specBreakFindings("Edit", { file_path: abs, old_string: oldText, new_string: newText }, abs)
}

describe("the spec breaking-change detector", () => {
  it("escalates a removed response field, naming it", () => {
    const f = edit("a.yaml", "        name: { type: string }\n", "")
    expect(f).toMatchObject({ ruleId: SPEC_BREAK_RULE })
    expect(f?.reason).toMatch(/GET \/users\/\{id\} answer 200\.name was removed/)
  })

  it("passes an added optional field, and a new operation", () => {
    expect(edit("b.yaml", "        name: { type: string }\n", "        name: { type: string }\n        email: { type: string }\n")).toBeUndefined()
    expect(edit("c.yaml", "components:\n", "  /health:\n    get:\n      responses: { \"200\": { description: ok } }\ncomponents:\n")).toBeUndefined()
  })

  it("names each kind of breaking change", () => {
    const before = readApiSpec(SPEC)!
    const change = (from: string, to: string) => breakingChanges(before, readApiSpec(SPEC.replace(from, to))!)
    expect(change("  /orders:\n    post:", "  /orders:\n    put:")).toEqual(["POST /orders was removed"])
    expect(change("id: { type: integer }\n        name", "id: { type: string }\n        name")).toEqual(["GET /users/{id} answer 200.id changed type from integer to string"])
    expect(change("enum: [free, pro]", "enum: [free, pro, team]")).toEqual(['GET /users/{id} answer 200.tier changed its enum from ["free","pro"] to ["free","pro","team"]'])
    expect(change("{ name: dryRun, in: query, schema", "{ name: dryRun, in: query, required: true, schema")).toEqual(["POST /orders has a new required query parameter dryRun"])
    expect(change("required: [sku]", "required: [sku, qty]")).toEqual(["POST /orders request.qty is now required"])
    expect(change("maxLength: 40", "maxLength: 20")).toEqual(["POST /orders request.sku has a shorter maximum length (40 to 20)"])
    expect(change("minimum: 1", "minimum: 5")).toEqual(["POST /orders request.qty has a higher minimum (1 to 5)"])
    // Looser is fine: a longer maximum, a lower minimum, a request field dropped (the server ignores it).
    expect(change("maxLength: 40", "maxLength: 80")).toEqual([])
    expect(change(", qty: { type: integer, minimum: 1 }", "")).toEqual([])
  })

  it("lets a breaking change through with a major version bump", () => {
    const abs = path.join(dir, "d.yaml")
    fs.writeFileSync(abs, SPEC)
    const next = SPEC.replace("        name: { type: string }\n", "").replace('version: "1.4.0"', 'version: "2.0.0"')
    expect(specBreakFindings("Write", { file_path: abs, content: next }, abs)).toBeUndefined()
    expect(majorBumped(readApiSpec(SPEC)!, readApiSpec(SPEC.replace('"1.4.0"', '"1.5.0"'))!)).toBe(false)
  })

  it("reads AsyncAPI channels and messages", () => {
    const a = readApiSpec(`asyncapi: 2.6.0\ninfo: { title: t, version: "1.0.0" }\nchannels:\n  orders:\n    subscribe:\n      message:\n        payload: { type: object, properties: { id: { type: string }, total: { type: number } } }\n  refunds:\n    publish:\n      message: { payload: { type: object } }\n`)!
    const b = readApiSpec(`asyncapi: 2.6.0\ninfo: { title: t, version: "1.1.0" }\nchannels:\n  orders:\n    subscribe:\n      message:\n        payload: { type: object, properties: { id: { type: string } } }\n`)!
    expect(breakingChanges(a, b)).toEqual(["channel refunds (publish) was removed", "channel orders (subscribe) message.total was removed"])
  })

  it("leaves alone files that are not specs", () => {
    const abs = path.join(dir, "package.json")
    fs.writeFileSync(abs, '{"name":"x","version":"1.0.0"}')
    expect(specBreakFindings("Write", { file_path: abs, content: '{"name":"y"}' }, abs)).toBeUndefined()
  })
})
