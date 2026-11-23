/**
 * E-032, mock definitions from specs (Expansion E3, the safe variant). From an OpenAPI 3.x spec in the project,
 * Codehouse writes mocks for the project's own tools: MSW handlers (TypeScript), WireMock mappings (JSON) and the Prism
 * command that serves the spec on this computer. Each operation answers its first success response, with a body made
 * from its schema as the conformance probe makes requests (E-031). The text is shown to copy; nothing is written into
 * the project, and Codehouse hosts no mock server itself (that would be a listener without a token, invariant 7; it is
 * on the list for SECURITY instead).
 */
import { planRequests, readSpec, sample } from "./conformance-probe.js"

type Json = Record<string, unknown>
const rec = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {})

export interface MockOperation {
  method: string
  path: string
  status: number
  body?: unknown
}

/** Each operation with the answer its mock gives: the first 2xx response (or default), and a body from its schema. */
export function mockOperations(spec: Json): MockOperation[] {
  return planRequests(spec, "http://127.0.0.1").map((r) => {
    const codes = Object.keys(r.responses)
    const code = codes.find((c) => /^2\d\d$/.test(c)) ?? codes.find((c) => /^2xx$/i.test(c)) ?? (codes.includes("default") ? "default" : codes[0])
    const status = code && /^\d{3}$/.test(code) ? Number(code) : 200
    let res = rec(code ? r.responses[code] : undefined)
    for (let i = 0; typeof res.$ref === "string" && i < 10; i++) res = rec(String(res.$ref).slice(2).split("/").reduce<unknown>((x, k) => rec(x)[k], spec))
    const schema = rec(rec(res.content)["application/json"]).schema
    return { method: r.method, path: r.path, status, ...(schema !== undefined && status !== 204 ? { body: sample(spec, schema) } : {}) }
  })
}

const mswPath = (p: string) => p.replace(/\{([^}]+)\}/g, ":$1")

/** MSW handlers (msw 2): one for each operation. */
export function mswHandlers(ops: MockOperation[]): string {
  const lines = [
    "// Mocks made by Codehouse from the project's OpenAPI spec (E-032). Each handler answers its operation's first",
    "// success response. Edit them as you like: Codehouse does not write them again.",
    'import { http, HttpResponse } from "msw"',
    "",
    "export const handlers = [",
  ]
  for (const o of ops) {
    const fn = o.method === "OPTIONS" ? "options" : o.method.toLowerCase()
    const answer = o.body !== undefined ? `HttpResponse.json(${JSON.stringify(o.body)}, { status: ${o.status} })` : `new HttpResponse(null, { status: ${o.status} })`
    lines.push(`  http.${fn}(${JSON.stringify(mswPath(o.path))}, () => ${answer}),`)
  }
  lines.push("]", "")
  return lines.join("\n")
}

const pathPattern = (p: string) => `^${p.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, "[^/]+")}$`

/** WireMock mappings: one for each operation, matched by method and path. */
export function wiremockMappings(ops: MockOperation[]): string {
  return `${JSON.stringify(
    {
      mappings: ops.map((o) => ({
        request: { method: o.method, urlPathPattern: pathPattern(o.path) },
        response: { status: o.status, ...(o.body !== undefined ? { jsonBody: o.body, headers: { "Content-Type": "application/json" } } : {}) },
      })),
    },
    null,
    2,
  )}\n`
}

/** The Prism command that serves the spec as a mock, on this computer only. */
export const prismCommand = (specPath: string) => `npx @stoplight/prism-cli mock ${JSON.stringify(specPath)} --host 127.0.0.1 --port 4010`

export interface Mocks {
  operations: number
  msw: string
  wiremock: string
  prism: string
}

/** All three from a spec's text; undefined when it is not OpenAPI 3. */
export function mocksFrom(specText: string, specPath: string): Mocks | undefined {
  const spec = readSpec(specText)
  if (!spec) return undefined
  const ops = mockOperations(spec)
  return { operations: ops.length, msw: mswHandlers(ops), wiremock: wiremockMappings(ops), prism: prismCommand(specPath) }
}
