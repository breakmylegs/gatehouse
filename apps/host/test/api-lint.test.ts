// E-035: API security lint over a spec: an unauthenticated operation is flagged, as are the other OWASP-style gaps,
// and a spec that covers them is clean.
import { describe, expect, it } from "vitest"
import { lintApi } from "../src/api-lint.js"
import { readSpec } from "../src/conformance-probe.js"

const BAD = readSpec(`openapi: 3.0.3
info: { title: shop, version: "1" }
paths:
  /users/{userId}:
    get:
      summary: Get a user
      parameters: [{ name: userId, in: path, required: true, schema: { type: string } }]
      responses:
        "200": { description: ok, content: { application/json: { schema: { type: object, properties: { orders: { type: array, items: { type: string } } } } } } }
  /login:
    get:
      parameters: [{ name: password, in: query, schema: { type: string } }]
      security: []
      responses: { "200": { description: ok } }
  /admin:
    post:
      security: [{ bearer: [] }]
      responses: { "204": { description: done } }
components:
  securitySchemes: { bearer: { type: http, scheme: bearer } }
`)!

const GOOD = readSpec(`openapi: 3.0.3
info: { title: shop, version: "1" }
security: [{ bearer: [] }]
paths:
  /users/{userId}:
    get:
      summary: Get a user
      description: Callers may only read their own user; ownership is checked against the token's subject.
      parameters: [{ name: userId, in: path, required: true, schema: { type: string } }]
      responses:
        "200":
          description: ok
          headers: { RateLimit-Remaining: { schema: { type: integer } } }
          content: { application/json: { schema: { type: object, properties: { orders: { type: array, maxItems: 100, items: { type: string } } } } } }
        "401": { description: no token }
        "403": { description: not yours }
        "429": { description: slow down }
components:
  securitySchemes: { bearer: { type: http, scheme: bearer } }
`)!

describe("API security lint", () => {
  it("flags an unauthenticated operation, and one whose security is switched off", () => {
    const f = lintApi(BAD).filter((x) => x.rule === "no-security")
    expect(f.map((x) => x.where)).toEqual(["GET /users/{userId}", "GET /login"])
    expect(f[1]!.message).toMatch(/switched off/)
  })

  it("flags the other gaps, each where it is", () => {
    const f = lintApi(BAD).filter((x) => x.rule !== "no-security").map((x) => `${x.rule} ${x.where}`)
    expect(f).toEqual([
      "object-id-unguarded GET /users/{userId}",
      "unbounded-array GET /users/{userId}",
      "sensitive-query GET /login",
      "missing-401-403 POST /admin",
      "no-rate-limit the whole API",
    ])
    expect(lintApi(BAD).find((x) => x.rule === "unbounded-array")?.message).toMatch(/answer 200\.orders is an array with no maxItems/)
  })

  it("finds nothing in a spec that covers them", () => {
    expect(lintApi(GOOD)).toEqual([])
  })
})
