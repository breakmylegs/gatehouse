// E-037: error answers are checked against RFC 9457 or the project's own convention; an error without a type field is
// flagged.
import { describe, expect, it } from "vitest"
import { readSpec } from "../src/conformance-probe.js"
import { checkErrorBody, checkSpecErrors, convention } from "../src/error-contract.js"

const RFC = readSpec(`openapi: 3.0.3
info: { title: shop, version: "1" }
paths:
  /orders:
    post:
      responses:
        "201": { description: made }
        "400": { description: bad, content: { application/problem+json: { schema: { $ref: "#/components/schemas/Problem" } } } }
        "409": { description: clash, content: { application/json: { schema: { type: object, properties: { message: { type: string } } } } } }
        "500": { description: broke }
components:
  schemas:
    Problem: { type: object, properties: { type: { type: string }, title: { type: string }, status: { type: integer }, detail: { type: string } } }
`)!

const OWN = readSpec(`openapi: 3.0.3
info: { title: shop, version: "1" }
paths:
  /a:
    get:
      responses:
        "404": { description: no, content: { application/json: { schema: { $ref: "#/components/schemas/Err" } } } }
        "500": { description: broke, content: { application/json: { schema: { $ref: "#/components/schemas/Err" } } } }
  /b:
    get:
      responses:
        "400": { description: bad, content: { application/json: { schema: { type: object, properties: { msg: { type: string } } } } } }
components:
  schemas:
    Err: { type: object, properties: { code: { type: string }, message: { type: string } } }
`)!

describe("error contract consistency", () => {
  it("flags an error without a type field, and one with no body", () => {
    expect(checkSpecErrors(RFC)).toEqual([
      { where: "POST /orders 409", message: expect.stringMatching(/no type field/) },
      { where: "POST /orders 500", message: expect.stringMatching(/describes no error body/) },
    ])
  })

  it("follows the project's own convention when it has one", () => {
    expect(convention(OWN)?.ref).toBe("#/components/schemas/Err")
    expect(checkSpecErrors(OWN)).toEqual([{ where: "GET /b 400", message: expect.stringMatching(/project's error shape \(Err\): no code, message/) }])
    expect(convention(RFC)).toBeUndefined()
  })

  it("checks what a probe got back", () => {
    expect(checkErrorBody("GET /x", 404, "application/json", { message: "nope" }).map((f) => f.message)).toEqual([
      "Its 404 answer has no type field (RFC 9457).",
      "Its 404 answer is served as application/json, not application/problem+json.",
    ])
    expect(checkErrorBody("GET /x", 404, "application/problem+json", { type: "about:blank", title: "Not Found", status: 404 })).toEqual([])
    expect(checkErrorBody("GET /x", 404, "application/problem+json", { type: "about:blank", status: 400 })[0]?.message).toMatch(/says status 400 but it answered 404/)
    expect(checkErrorBody("GET /x", 200, "application/json", {})).toEqual([])
    expect(checkErrorBody("GET /x", 500, "application/json", { code: "E1" }, { fields: new Set(["code", "message"]) })[0]?.message).toMatch(/no message/)
  })
})
