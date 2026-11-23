/**
 * E-037, error contract consistency (Expansion E3). Error answers, in a spec and in what a contract probe got back, are
 * checked against RFC 9457 (problem details: a JSON object with type, title, status and detail, served as
 * application/problem+json), or against the project's own convention when its spec defines one: the schema most of its
 * error answers use. An error without a type field is flagged; so is an error that does not follow the convention.
 */
type Json = Record<string, unknown>
const rec = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {})

const METHODS = ["get", "put", "post", "delete", "patch", "head", "options"]
export const RFC9457_FIELDS = ["type", "title", "status", "detail"] as const

function deref(spec: Json, v: unknown): Json {
  let o = rec(v)
  for (let i = 0; typeof o.$ref === "string" && o.$ref.startsWith("#/") && i < 20; i++) o = rec(o.$ref.slice(2).split("/").reduce<unknown>((x, k) => rec(x)[k.replace(/~1/g, "/").replace(/~0/g, "~")], spec))
  return o
}

/** The fields an error schema has, all-of parts joined. */
function fieldsOf(spec: Json, schema: unknown, depth = 0): Set<string> {
  const s = deref(spec, schema)
  const out = new Set(Object.keys(rec(s.properties)))
  if (depth < 5) for (const part of (s.allOf as unknown[]) ?? []) for (const f of fieldsOf(spec, part, depth + 1)) out.add(f)
  return out
}

export interface ErrorFinding {
  where: string
  message: string
}

interface ErrorAnswer {
  where: string
  contentType?: string
  fields?: Set<string>
  ref?: string
}

/** Every 4xx and 5xx answer in a spec, with its content type, fields and the schema it names. */
function errorAnswers(spec: Json): ErrorAnswer[] {
  const out: ErrorAnswer[] = []
  for (const [p, itemRaw] of Object.entries(rec(spec.paths))) {
    const item = deref(spec, itemRaw)
    for (const m of METHODS) {
      if (!item[m]) continue
      for (const [code, r] of Object.entries(rec(deref(spec, item[m]).responses))) {
        if (!/^[45]/.test(code) && code !== "default") continue
        const content = rec(deref(spec, r).content)
        const [contentType, media] = Object.entries(content).find(([t]) => /json/i.test(t)) ?? []
        const schema = rec(media).schema
        out.push({ where: `${m.toUpperCase()} ${p} ${code}`, ...(contentType ? { contentType } : {}), ...(schema ? { fields: fieldsOf(spec, schema), ...(typeof rec(schema).$ref === "string" ? { ref: rec(schema).$ref as string } : {}) } : {}) })
      }
    }
  }
  return out
}

/** The project's own convention: the schema most of its error answers name, when that is not problem details. */
export function convention(spec: Json): { ref: string; fields: Set<string> } | undefined {
  const counts = new Map<string, number>()
  for (const a of errorAnswers(spec)) if (a.ref) counts.set(a.ref, (counts.get(a.ref) ?? 0) + 1)
  const [ref, n] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? []
  if (!ref || !n || n < 2) return undefined
  const fields = fieldsOf(spec, { $ref: ref })
  return fields.has("type") && fields.has("title") ? undefined : { ref, fields }
}

/** What in the spec's error answers breaks RFC 9457, or the project's convention when it has one. */
export function checkSpecErrors(spec: Json): ErrorFinding[] {
  const out: ErrorFinding[] = []
  const own = convention(spec)
  for (const a of errorAnswers(spec)) {
    if (!a.fields) {
      out.push({ where: a.where, message: "It describes no error body, so a client cannot tell what went wrong. Give it a problem details body (RFC 9457)." })
      continue
    }
    if (own) {
      const missing = [...own.fields].filter((f) => !a.fields!.has(f))
      if (a.ref !== own.ref && missing.length) out.push({ where: a.where, message: `It does not follow the project's error shape (${own.ref.split("/").pop()}): no ${missing.join(", ")}.` })
      continue
    }
    if (!a.fields.has("type")) out.push({ where: a.where, message: "Its error has no type field (RFC 9457 problem details: type, title, status, detail)." })
    else if (a.contentType && !/problem\+json/i.test(a.contentType)) out.push({ where: a.where, message: `It is served as ${a.contentType}; problem details are application/problem+json.` })
  }
  return out
}

/** What in an error answer a probe got back breaks RFC 9457, or the convention's fields. */
export function checkErrorBody(where: string, status: number, contentType: string, body: unknown, own?: { fields: Set<string> }): ErrorFinding[] {
  if (status < 400) return []
  const b = rec(body)
  if (!Object.keys(b).length) return [{ where, message: `It answered ${status} with no error body.` }]
  if (own) {
    const missing = [...own.fields].filter((f) => !(f in b))
    return missing.length ? [{ where, message: `Its ${status} answer does not follow the project's error shape: no ${missing.join(", ")}.` }] : []
  }
  const out: ErrorFinding[] = []
  if (!("type" in b)) out.push({ where, message: `Its ${status} answer has no type field (RFC 9457).` })
  if ("status" in b && b.status !== status) out.push({ where, message: `Its body says status ${String(b.status)} but it answered ${status}.` })
  if (!/problem\+json/i.test(contentType)) out.push({ where, message: `Its ${status} answer is served as ${contentType || "no content type"}, not application/problem+json.` })
  return out
}
