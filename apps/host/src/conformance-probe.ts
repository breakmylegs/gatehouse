/**
 * E-031, a contract-first conformance probe (Expansion E3). For each operation in an OpenAPI 3.x spec, a valid request
 * is made from its schemas (path and required query parameters, a JSON body when it takes one) and sent to the app on
 * this computer; the response is checked against the spec with ajv, the validator the Host already pins (OpenAPI 3.0's
 * `nullable` read as a type that allows null). A status the spec does not list, a body that does not match (a missing
 * required field, a wrong type) or no answer is a mismatch. Mismatches go into the session's evidence pack and make its
 * done-claims Contradicted until a probe passes.
 *
 * Only a server on this computer is probed (127.0.0.1, ::1 or localhost); any other is refused before anything is sent.
 * Each request is first judged by the rules as the same curl command from the session would be, so the probe never does
 * what the session could not; one the rules would not allow by themselves is not sent, and says so. Run when you start
 * it, and recorded.
 */
import { Ajv } from "ajv"
import { parseYaml } from "@gatehouse/policy"
import { checkErrorBody, convention } from "./error-contract.js"

type Json = Record<string, unknown>
const rec = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {})

export interface ProbeResult {
  method: string
  path: string
  status?: number
  ok: boolean
  mismatches: string[]
  /** Why it was not sent. */
  skipped?: string
  /** E-034: the answer's shape (keys and types, never values), for its snapshot. */
  shape?: unknown
}

export interface ProbeReport {
  base: string
  operations: ProbeResult[]
  mismatches: string[]
  /** E-037: error answers that break RFC 9457 or the project's convention (not counted against claims). */
  errors?: string[]
  refused?: string
}

/** A spec from its text, JSON or YAML; undefined when it is not OpenAPI 3. */
export function readSpec(text: string): Json | undefined {
  let v: unknown
  try {
    v = /^\s*\{/.test(text) ? JSON.parse(text) : parseYaml(text, { logLevel: "silent" })
  } catch {
    return undefined
  }
  const s = rec(v)
  return typeof s.openapi === "string" && /^3\./.test(s.openapi) && s.paths ? s : undefined
}

/** A local $ref resolved, to a depth. */
function deref(spec: Json, v: unknown, depth = 0): Json {
  let o = rec(v)
  while (typeof o.$ref === "string" && o.$ref.startsWith("#/") && depth++ < 20) o = rec(o.$ref.slice(2).split("/").reduce<unknown>((x, k) => rec(x)[k.replace(/~1/g, "/").replace(/~0/g, "~")], spec))
  return o
}

/** A schema with every local $ref put in place and OpenAPI 3.0's nullable made JSON Schema, for ajv. */
export function plainSchema(spec: Json, schema: unknown, depth = 0): unknown {
  if (depth > 30) return {}
  if (Array.isArray(schema)) return schema.map((x) => plainSchema(spec, x, depth + 1))
  if (!schema || typeof schema !== "object") return schema
  const s = deref(spec, schema)
  const out: Json = {}
  for (const [k, v] of Object.entries(s)) {
    if (k === "nullable" || k === "example" || k === "examples" || k === "xml" || k === "externalDocs" || k === "discriminator" || k === "readOnly" || k === "writeOnly" || k === "deprecated") continue
    out[k] = k === "properties" || k === "patternProperties" ? Object.fromEntries(Object.entries(rec(v)).map(([p, x]) => [p, plainSchema(spec, x, depth + 1)])) : plainSchema(spec, v, depth + 1)
  }
  if (s.nullable === true && typeof out.type === "string") out.type = [out.type, "null"]
  return out
}

/** A value that meets a schema: its example, enum or default first, else made from its type. */
export function sample(spec: Json, schema: unknown, depth = 0): unknown {
  const s = deref(spec, schema)
  if (depth > 8) return null
  if (s.example !== undefined) return s.example
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0]
  if (s.default !== undefined) return s.default
  if (Array.isArray(s.allOf)) return Object.assign({}, ...s.allOf.map((x) => rec(sample(spec, x, depth + 1))))
  if (Array.isArray(s.oneOf) || Array.isArray(s.anyOf)) return sample(spec, ((s.oneOf ?? s.anyOf) as unknown[])[0], depth + 1)
  const type = Array.isArray(s.type) ? s.type.find((t) => t !== "null") : s.type ?? (s.properties ? "object" : undefined)
  if (type === "object") {
    const out: Json = {}
    for (const [k, v] of Object.entries(rec(s.properties))) if (!rec(deref(spec, v)).readOnly) out[k] = sample(spec, v, depth + 1)
    return out
  }
  if (type === "array") return Array.from({ length: Math.max(1, Number(s.minItems) || 1) }, () => sample(spec, s.items, depth + 1))
  if (type === "integer" || type === "number") {
    const min = typeof s.minimum === "number" ? s.minimum : typeof s.exclusiveMinimum === "number" ? s.exclusiveMinimum + 1 : 1
    return typeof s.maximum === "number" ? Math.min(min, s.maximum) : min
  }
  if (type === "boolean") return true
  if (type === "string") {
    const f = s.format
    const v = f === "email" ? "probe@example.com" : f === "uuid" ? "00000000-0000-4000-8000-000000000001" : f === "date-time" ? "2026-01-01T00:00:00Z" : f === "date" ? "2026-01-01" : f === "uri" || f === "url" ? "https://example.com/" : "probe"
    const min = Number(s.minLength) || 0
    return v.length >= min ? (s.maxLength ? v.slice(0, Number(s.maxLength)) : v) : v.padEnd(min, "x")
  }
  return null
}

/** E-034: a value's shape: an object's keys with their shapes, an array's first item, or a type name; never a value. */
export function shapeOf(v: unknown, depth = 0): unknown {
  if (depth > 10) return "..."
  if (v === null) return "null"
  if (Array.isArray(v)) return v.length ? [shapeOf(v[0], depth + 1)] : []
  if (typeof v === "object") return Object.fromEntries(Object.keys(v as object).sort().slice(0, 200).map((k) => [k, shapeOf((v as Record<string, unknown>)[k], depth + 1)]))
  return typeof v
}

/** Whether a URL points at this computer. */
export function isLoopback(url: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase()
    return h === "127.0.0.1" || h === "::1" || h === "localhost" || /^127\.\d+\.\d+\.\d+$/.test(h)
  } catch {
    return false
  }
}

export interface PlannedRequest {
  method: string
  path: string
  url: string
  body?: unknown
  responses: Json
}

const METHODS = ["get", "put", "post", "delete", "patch", "head", "options"]

/** The requests to send: one valid request for each operation. */
export function planRequests(spec: Json, base: string): PlannedRequest[] {
  const out: PlannedRequest[] = []
  for (const [p, itemRaw] of Object.entries(rec(spec.paths))) {
    const item = deref(spec, itemRaw)
    for (const m of METHODS) {
      if (!item[m]) continue
      const op = deref(spec, item[m])
      const params = [...((item.parameters as unknown[]) ?? []), ...((op.parameters as unknown[]) ?? [])].map((x) => deref(spec, x))
      let path = p
      const query = new URLSearchParams()
      for (const prm of params) {
        const value = String(prm.example ?? sample(spec, prm.schema))
        if (prm.in === "path") path = path.replace(`{${String(prm.name)}}`, encodeURIComponent(value))
        else if (prm.in === "query" && prm.required === true) query.set(String(prm.name), value)
      }
      const body = rec(deref(spec, op.requestBody).content)["application/json"]
      const q = query.toString()
      out.push({ method: m.toUpperCase(), path: p, url: `${base.replace(/\/$/, "")}${path}${q ? `?${q}` : ""}`, ...(body ? { body: sample(spec, rec(body).schema) } : {}), responses: rec(op.responses) })
    }
  }
  return out
}

/** What is wrong with a response, by the spec: a status it does not list, or a body that does not match. */
export function checkResponse(spec: Json, responses: Json, status: number, contentType: string, body: unknown, ajv: Ajv): string[] {
  const r = responses[String(status)] ?? responses[`${String(status)[0]}XX`] ?? responses[`${String(status)[0]}xx`] ?? responses.default
  if (!r) return [`answered ${status}, which the spec does not list (it lists ${Object.keys(responses).join(", ") || "none"})`]
  const schema = rec(rec(rec(deref(spec, r).content)["application/json"]).schema)
  if (!Object.keys(schema).length) return []
  if (!/json/i.test(contentType)) return [`answered ${contentType || "no content type"} where the spec says application/json`]
  const validate = ajv.compile(plainSchema(spec, schema) as object)
  if (validate(body)) return []
  return (validate.errors ?? []).slice(0, 5).map((e) =>
    e.keyword === "required" ? `the response is missing the required field ${e.instancePath || "/"}${e.instancePath ? "/" : ""}${String((e.params as { missingProperty?: string }).missingProperty)}` : `${e.instancePath || "the response"} ${e.message ?? "does not match"}`,
  )
}

export interface ProbeDeps {
  /** Judges a request as the same curl command from the session would be; true when the rules allow it by themselves. */
  allowed: (command: string) => Promise<boolean>
  fetch?: typeof fetch
  timeoutMs?: number
}

const shellQuote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`

/** Sends each planned request to the app on this computer and checks each answer. */
export async function probe(spec: Json, baseUrl: string | undefined, d: ProbeDeps): Promise<ProbeReport> {
  const servers = (spec.servers as Array<{ url?: string }> | undefined) ?? []
  const base = baseUrl ?? servers.find((s) => typeof s.url === "string")?.url ?? ""
  if (!base || !isLoopback(base)) return { base, operations: [], mismatches: [], refused: `Only a server on this computer is probed (127.0.0.1, ::1 or localhost)${base ? `, not ${base}` : "; the spec names none, so give its address"}.` }
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false })
  const get = d.fetch ?? fetch
  const operations: ProbeResult[] = []
  const errors: string[] = []
  const own = convention(spec)
  for (const r of planRequests(spec, base)) {
    const command = `curl -s -X ${r.method} ${shellQuote(r.url)}${r.body !== undefined ? ` -H 'content-type: application/json' -d ${shellQuote(JSON.stringify(r.body))}` : ""}`
    if (!(await d.allowed(command).catch(() => false))) {
      operations.push({ method: r.method, path: r.path, ok: false, mismatches: [], skipped: "the rules would not let the session send it by itself" })
      continue
    }
    try {
      const res = await get(r.url, { method: r.method, ...(r.body !== undefined ? { body: JSON.stringify(r.body), headers: { "content-type": "application/json" } } : {}), signal: AbortSignal.timeout(d.timeoutMs ?? 15_000), redirect: "manual" })
      const text = await res.text()
      let body: unknown = text
      try {
        body = text ? JSON.parse(text) : undefined
      } catch {
        // Not JSON: checked as text.
      }
      const mismatches = checkResponse(spec, r.responses, res.status, res.headers.get("content-type") ?? "", body, ajv)
      operations.push({ method: r.method, path: r.path, status: res.status, ok: !mismatches.length, mismatches, shape: shapeOf(body) })
      for (const e of checkErrorBody(`${r.method} ${r.path}`, res.status, res.headers.get("content-type") ?? "", body, own)) errors.push(`${e.where}: ${e.message}`)
    } catch (e) {
      operations.push({ method: r.method, path: r.path, ok: false, mismatches: [`no answer: ${String((e as Error).message).slice(0, 120)}`] })
    }
  }
  return { base, operations, mismatches: operations.flatMap((o) => o.mismatches.map((m) => `${o.method} ${o.path}: ${m}`)), ...(errors.length ? { errors } : {}) }
}
