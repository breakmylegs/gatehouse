// E-032: mocks from a spec: MSW handlers that compile and cover every operation, WireMock mappings, and a Prism command
// that serves on this computer only.
import ts from "typescript"
import { describe, expect, it } from "vitest"
import { mocksFrom } from "../src/mock-gen.js"

const SPEC = `openapi: 3.0.3
info: { title: shop, version: "1" }
paths:
  /users/{id}:
    get:
      parameters: [{ name: id, in: path, required: true, schema: { type: integer } }]
      responses:
        "200": { $ref: "#/components/responses/User" }
    delete:
      parameters: [{ name: id, in: path, required: true, schema: { type: integer } }]
      responses: { "204": { description: gone } }
  /orders:
    post:
      requestBody: { content: { application/json: { schema: { type: object } } } }
      responses:
        "201": { description: made, content: { application/json: { schema: { type: object, properties: { id: { type: string, example: "o1" } } } } } }
        "400": { description: bad }
components:
  responses:
    User:
      description: a user
      content:
        application/json:
          schema: { type: object, required: [id, name], properties: { id: { type: integer }, name: { type: string } } }
`

/** A stand-in for msw's types, so the handlers are compiled against the API they use. */
const MSW_TYPES = `declare module "msw" {
  type Resolver = () => Response
  type Method = (path: string, resolver: Resolver) => { path: string }
  export const http: { get: Method; post: Method; put: Method; patch: Method; delete: Method; head: Method; options: Method; all: Method }
  export class HttpResponse extends Response {
    constructor(body: BodyInit | null, init?: ResponseInit)
    static json(body: unknown, init?: ResponseInit): HttpResponse
  }
}
`

function compile(code: string): string[] {
  const files: Record<string, string> = { "/handlers.ts": code, "/msw.d.ts": MSW_TYPES }
  const options: ts.CompilerOptions = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ["lib.es2022.d.ts", "lib.dom.d.ts"], types: [] }
  const host = ts.createCompilerHost(options)
  const read = host.readFile.bind(host)
  const exists = host.fileExists.bind(host)
  host.readFile = (f) => files[f] ?? read(f)
  host.fileExists = (f) => f in files || exists(f)
  host.getSourceFile = ((orig) => (f: string, v: ts.ScriptTarget) => (files[f] !== undefined ? ts.createSourceFile(f, files[f]!, v) : orig.call(host, f, v)))(host.getSourceFile)
  const program = ts.createProgram(["/handlers.ts", "/msw.d.ts"], options, host)
  return ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))
}

describe("mocks from a spec", () => {
  it("writes MSW handlers that compile and cover every operation", () => {
    const m = mocksFrom(SPEC, "openapi.yaml")!
    expect(m.operations).toBe(3)
    expect(compile(m.msw)).toEqual([])
    expect(m.msw).toContain('http.get("/users/:id", () => HttpResponse.json({"id":1,"name":"probe"}, { status: 200 })),')
    expect(m.msw).toContain('http.delete("/users/:id", () => new HttpResponse(null, { status: 204 })),')
    expect(m.msw).toContain('http.post("/orders", () => HttpResponse.json({"id":"o1"}, { status: 201 })),')
    expect(m.msw.match(/http\.\w+\(/g)).toHaveLength(3)
  })

  it("writes WireMock mappings that match each operation's path", () => {
    const w = JSON.parse(mocksFrom(SPEC, "openapi.yaml")!.wiremock) as { mappings: Array<{ request: { method: string; urlPathPattern: string }; response: { status: number } }> }
    expect(w.mappings.map((x) => [x.request.method, x.response.status])).toEqual([["GET", 200], ["DELETE", 204], ["POST", 201]])
    expect(new RegExp(w.mappings[0]!.request.urlPathPattern).test("/users/42")).toBe(true)
    expect(new RegExp(w.mappings[0]!.request.urlPathPattern).test("/users/42/x")).toBe(false)
  })

  it("gives a Prism command that serves on this computer only, and nothing for a file that is not OpenAPI 3", () => {
    expect(mocksFrom(SPEC, "api/openapi.yaml")!.prism).toBe('npx @stoplight/prism-cli mock "api/openapi.yaml" --host 127.0.0.1 --port 4010')
    expect(mocksFrom("swagger: '2.0'\npaths: {}\n", "x.yaml")).toBeUndefined()
  })
})
