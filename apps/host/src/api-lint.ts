/**
 * E-035, API security lint (Expansion E3). Rules over an OpenAPI 3 spec, after OWASP's API Security Top 10: an
 * operation with no security (none of its own and none for the whole spec, or an empty list that switches it off), a
 * secured operation without 401 and 403 answers, an object id in a path with no word about who may reach it, an array
 * with no maximum size, no documented rate limit anywhere, and sensitive data in a query string. Each finding names the
 * operation and what to do. Read only.
 */
type Json = Record<string, unknown>
const rec = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {})

export type ApiRule = "no-security" | "missing-401-403" | "object-id-unguarded" | "unbounded-array" | "no-rate-limit" | "sensitive-query"

export interface ApiFinding {
  rule: ApiRule
  where: string
  message: string
}

const METHODS = ["get", "put", "post", "delete", "patch", "head", "options"]
const AUTHZ_WORDS = /\b(authori[sz]|owner|owns|permission|access control|tenant|scope|role|belongs to|their own)\w*/i
const SENSITIVE = /(^|[_-])(pass(word)?|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|ssn|card|cvv|pin|auth(orization)?|session)($|[_-])/i

function deref(spec: Json, v: unknown): Json {
  let o = rec(v)
  for (let i = 0; typeof o.$ref === "string" && o.$ref.startsWith("#/") && i < 20; i++) o = rec(o.$ref.slice(2).split("/").reduce<unknown>((x, k) => rec(x)[k.replace(/~1/g, "/").replace(/~0/g, "~")], spec))
  return o
}

/** The arrays in a schema with no maximum size, by where they are. */
function unbounded(spec: Json, schema: unknown, where: string, out: string[], seen = new Set<unknown>(), depth = 0): void {
  if (depth > 10 || seen.has(schema)) return
  seen.add(schema)
  const s = deref(spec, schema)
  const type = Array.isArray(s.type) ? (s.type as string[]) : [s.type]
  if (type.includes("array") || s.items) {
    if (typeof s.maxItems !== "number") out.push(where || "the body")
    unbounded(spec, s.items, `${where}[]`, out, seen, depth + 1)
  }
  for (const [k, v] of Object.entries(rec(s.properties))) unbounded(spec, v, `${where}.${k}`, out, seen, depth + 1)
  for (const k of ["allOf", "oneOf", "anyOf"]) for (const v of (s[k] as unknown[]) ?? []) unbounded(spec, v, where, out, seen, depth + 1)
}

export function lintApi(spec: Json): ApiFinding[] {
  const out: ApiFinding[] = []
  const global = Array.isArray(spec.security) ? (spec.security as unknown[]) : undefined
  let rateLimited = false
  for (const [p, itemRaw] of Object.entries(rec(spec.paths))) {
    const item = deref(spec, itemRaw)
    for (const m of METHODS) {
      if (!item[m]) continue
      const op = deref(spec, item[m])
      const where = `${m.toUpperCase()} ${p}`
      const own = Array.isArray(op.security) ? (op.security as unknown[]) : undefined
      const security = own ?? global
      const secured = !!security?.length && !security.every((x) => !Object.keys(rec(x)).length)
      if (!secured) out.push({ rule: "no-security", where, message: own?.length === 0 ? "Its security is switched off (security: []), so anyone can call it." : "It has no security, so anyone can call it. Add a security requirement, or say why it is public." })
      const responses = rec(op.responses)
      const codes = Object.keys(responses)
      if (secured) {
        const missing = ["401", "403"].filter((c) => !codes.includes(c) && !codes.some((x) => /^4xx$/i.test(x)))
        if (missing.length) out.push({ rule: "missing-401-403", where, message: `It is secured but does not say what happens without access (no ${missing.join(" or ")} answer).` })
      }
      const params = [...((item.parameters as unknown[]) ?? []), ...((op.parameters as unknown[]) ?? [])].map((x) => deref(spec, x))
      const ids = params.filter((x) => x.in === "path" && /(^id$|Id$|_id$|^uuid$|Uuid$)/.test(String(x.name)))
      const notes = `${String(op.summary ?? "")} ${String(op.description ?? "")} ${ids.map((x) => String(x.description ?? "")).join(" ")}`
      if (ids.length && !AUTHZ_WORDS.test(notes) && !Object.keys(op).some((k) => /^x-(authori[sz]ation|owner|access)/i.test(k)))
        out.push({ rule: "object-id-unguarded", where, message: `It takes ${ids.map((x) => String(x.name)).join(", ")} in its path but says nothing about who may reach which one. Say how ownership is checked (or add x-authorization), so one caller cannot read another's.` })
      for (const prm of params)
        if (prm.in === "query" && SENSITIVE.test(String(prm.name))) out.push({ rule: "sensitive-query", where, message: `${String(prm.name)} is sent in the query string, where servers and proxies log it. Send it in a header or the body.` })
      const found: string[] = []
      for (const [code, r] of Object.entries(responses)) {
        if (code === "429") rateLimited = true
        const res = deref(spec, r)
        if (Object.keys(rec(res.headers)).some((h) => /ratelimit|retry-after/i.test(h))) rateLimited = true
        if (/^2/.test(code)) unbounded(spec, rec(rec(res.content)["application/json"]).schema, `answer ${code}`, found)
      }
      unbounded(spec, rec(rec(deref(spec, op.requestBody).content)["application/json"]).schema, "request", found)
      for (const f of [...new Set(found)]) out.push({ rule: "unbounded-array", where, message: `${f} is an array with no maxItems, so it can grow without limit. Page it, or set maxItems.` })
      if (Object.keys(op).some((k) => /^x-.*rate.?limit/i.test(k))) rateLimited = true
    }
  }
  if (Object.keys(spec).some((k) => /^x-.*rate.?limit/i.test(k))) rateLimited = true
  if (!rateLimited && Object.keys(rec(spec.paths)).length) out.push({ rule: "no-rate-limit", where: "the whole API", message: "No operation documents a rate limit (a 429 answer, RateLimit or Retry-After headers, or an x-rate-limit note)." })
  return out
}
