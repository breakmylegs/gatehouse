/**
 * E-033 (expansion, Wave E3): a spec breaking-change detector. An edit to an OpenAPI 3 or AsyncAPI spec is compared with
 * the spec as it is on disk: a removed operation or channel, a removed response or message field, a narrowed type (a
 * different type, integer for number, a shorter maximum length, a higher minimum, a lower maximum), a new required
 * parameter or request field, and a changed enum are breaking changes. One made without raising the major part of
 * info.version goes to a person, naming each. An added optional field, a new operation or a looser type passes.
 *
 * The file on disk is the "before", so each change is judged once, as it is made (comparing with the last commit would
 * hold every later edit for the same change again). Pure apart from reading that file.
 */
import fs from "node:fs"
import { parse as parseYaml } from "yaml"

export const SPEC_BREAK_RULE = "spec-breaking-change"
export const SPEC_BREAK_RISK = 70

type Json = Record<string, unknown>
const rec = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {})

/** An OpenAPI 3 or AsyncAPI document from text; undefined otherwise. */
export function readApiSpec(text: string): Json | undefined {
  let v: unknown
  try {
    v = /^\s*\{/.test(text) ? JSON.parse(text) : parseYaml(text, { logLevel: "silent" })
  } catch {
    return undefined
  }
  const s = rec(v)
  return (typeof s.openapi === "string" && /^3\./.test(s.openapi)) || typeof s.asyncapi === "string" ? s : undefined
}

function deref(spec: Json, v: unknown): Json {
  let o = rec(v)
  for (let i = 0; typeof o.$ref === "string" && o.$ref.startsWith("#/") && i < 20; i++) o = rec(o.$ref.slice(2).split("/").reduce<unknown>((x, k) => rec(x)[k.replace(/~1/g, "/").replace(/~0/g, "~")], spec))
  return o
}

interface Surface {
  /** Operation or channel keys, such as "GET /users/{id}" or "channel orders (subscribe)". */
  ops: Set<string>
  /** What clients read: each operation's answer or message schema. */
  reads: Map<string, unknown>
  /** What clients send: each operation's parameters and request schema. */
  sends: Map<string, { params: Map<string, boolean>; body?: unknown }>
}

const METHODS = ["get", "put", "post", "delete", "patch", "head", "options"]

function surface(spec: Json): Surface {
  const s: Surface = { ops: new Set(), reads: new Map(), sends: new Map() }
  if (typeof spec.openapi === "string")
    for (const [p, itemRaw] of Object.entries(rec(spec.paths))) {
      const item = deref(spec, itemRaw)
      for (const m of METHODS) {
        if (!item[m]) continue
        const op = deref(spec, item[m])
        const key = `${m.toUpperCase()} ${p}`
        s.ops.add(key)
        for (const [code, r] of Object.entries(rec(op.responses)))
          if (/^2/.test(code)) {
            const schema = rec(rec(deref(spec, r).content)["application/json"]).schema
            if (schema) s.reads.set(`${key} answer ${code}`, schema)
          }
        const params = new Map<string, boolean>()
        for (const prm of [...((item.parameters as unknown[]) ?? []), ...((op.parameters as unknown[]) ?? [])].map((x) => deref(spec, x)))
          params.set(`${String(prm.in)} ${String(prm.name)}`, prm.required === true)
        const body = rec(rec(deref(spec, op.requestBody).content)["application/json"]).schema
        s.sends.set(key, { params, ...(body ? { body } : {}) })
      }
    }
  else {
    // AsyncAPI 2 (channels with publish and subscribe) and 3 (operations naming channels).
    for (const [name, chRaw] of Object.entries(rec(spec.channels))) {
      const ch = deref(spec, chRaw)
      for (const dir of ["publish", "subscribe"]) {
        if (!ch[dir]) continue
        const key = `channel ${name} (${dir})`
        s.ops.add(key)
        const payload = rec(deref(spec, rec(ch[dir]).message)).payload
        if (payload) s.reads.set(`${key} message`, payload)
      }
      for (const [mName, mRaw] of Object.entries(rec(ch.messages))) {
        const payload = deref(spec, mRaw).payload
        s.ops.add(`channel ${name}`)
        if (payload) s.reads.set(`channel ${name} message ${mName}`, payload)
      }
    }
    for (const [name, opRaw] of Object.entries(rec(spec.operations))) s.ops.add(`operation ${name} (${String(deref(spec, opRaw).action ?? "")})`)
  }
  return s
}

const typeOf = (s: Json): string | undefined => (Array.isArray(s.type) ? (s.type as string[]).filter((t) => t !== "null").join("|") : typeof s.type === "string" ? s.type : undefined)

/** What a schema change breaks for a client reading it (read) or sending it (send). */
function schemaBreaks(spec0: Json, spec1: Json, a: unknown, b: unknown, where: string, side: "read" | "send", out: string[], depth = 0): void {
  if (depth > 12 || out.length > 40) return
  const x = deref(spec0, a)
  const y = deref(spec1, b)
  const tx = typeOf(x)
  const ty = typeOf(y)
  if (tx && ty && tx !== ty && !(tx === "integer" && ty === "number")) out.push(`${where} changed type from ${tx} to ${ty}`)
  if (Array.isArray(x.enum) || Array.isArray(y.enum)) {
    const ex = JSON.stringify([...((x.enum as unknown[]) ?? [])].sort())
    const ey = JSON.stringify([...((y.enum as unknown[]) ?? [])].sort())
    if (ex !== ey) out.push(`${where} changed its enum from ${ex} to ${ey}`)
  }
  if (side === "send") {
    if (typeof y.maxLength === "number" && (typeof x.maxLength !== "number" || y.maxLength < x.maxLength)) out.push(`${where} has a shorter maximum length (${String(x.maxLength ?? "none")} to ${y.maxLength})`)
    if (typeof y.minimum === "number" && (typeof x.minimum !== "number" || y.minimum > x.minimum)) out.push(`${where} has a higher minimum (${String(x.minimum ?? "none")} to ${y.minimum})`)
    if (typeof y.maximum === "number" && (typeof x.maximum !== "number" || y.maximum < x.maximum)) out.push(`${where} has a lower maximum (${String(x.maximum ?? "none")} to ${y.maximum})`)
    const req0 = new Set(((x.required as string[]) ?? []))
    for (const r of (y.required as string[]) ?? []) if (!req0.has(r)) out.push(`${where}.${r} is now required`)
  }
  const px = rec(x.properties)
  const py = rec(y.properties)
  for (const [k, v] of Object.entries(px)) {
    if (!(k in py)) {
      if (side === "read") out.push(`${where}.${k} was removed`)
      continue
    }
    schemaBreaks(spec0, spec1, v, py[k], `${where}.${k}`, side, out, depth + 1)
  }
  if (x.items || y.items) schemaBreaks(spec0, spec1, x.items, y.items, `${where}[]`, side, out, depth + 1)
}

/** The breaking changes from one version of a spec to the next. */
export function breakingChanges(before: Json, after: Json): string[] {
  const a = surface(before)
  const b = surface(after)
  const out: string[] = []
  for (const op of a.ops) if (!b.ops.has(op)) out.push(`${op} was removed`)
  for (const [k, schema] of a.reads) if (b.reads.has(k)) schemaBreaks(before, after, schema, b.reads.get(k), k, "read", out)
  for (const [op, s0] of a.sends) {
    const s1 = b.sends.get(op)
    if (!s1) continue
    for (const [p, req] of s1.params) if (req && s0.params.get(p) !== true) out.push(`${op} has a new required ${p.replace(" ", " parameter ")}`)
    if (s0.body && s1.body) schemaBreaks(before, after, s0.body, s1.body, `${op} request`, "send", out)
  }
  return [...new Set(out)]
}

const major = (v: unknown) => Number(/^v?(\d+)/.exec(String(v ?? ""))?.[1] ?? NaN)

/** Whether the major part of info.version went up. */
export const majorBumped = (before: Json, after: Json) => major(rec(after.info).version) > major(rec(before.info).version)

const SPEC_FILE = /\.(ya?ml|json)$/i

/** What an edit to a spec breaks without a major version bump; undefined when it breaks nothing or is not a spec. */
export function specBreakFindings(tool: string, input: Record<string, unknown>, absPath: string | undefined): { ruleId: typeof SPEC_BREAK_RULE; reason: string; risk: number } | undefined {
  const file = typeof input.file_path === "string" ? input.file_path : ""
  if (!file || !SPEC_FILE.test(file) || !absPath) return undefined
  let current: string
  try {
    current = fs.readFileSync(absPath, "utf8")
  } catch {
    return undefined
  }
  let next = current
  if (tool === "Write") next = typeof input.content === "string" ? input.content : ""
  else if (tool === "Edit" && typeof input.old_string === "string" && typeof input.new_string === "string")
    next = input.replace_all === true ? current.split(input.old_string).join(input.new_string) : current.replace(input.old_string, input.new_string)
  else if (tool === "MultiEdit" && Array.isArray(input.edits))
    for (const e of input.edits as Array<{ old_string?: unknown; new_string?: unknown; replace_all?: unknown }>)
      if (typeof e.old_string === "string" && typeof e.new_string === "string") next = e.replace_all === true ? next.split(e.old_string).join(e.new_string) : next.replace(e.old_string, e.new_string)
  else return undefined
  const before = readApiSpec(current)
  if (!before) return undefined
  const after = readApiSpec(next)
  if (!after) return undefined
  if (majorBumped(before, after)) return undefined
  const found = breakingChanges(before, after)
  if (!found.length) return undefined
  return {
    ruleId: SPEC_BREAK_RULE,
    risk: SPEC_BREAK_RISK,
    reason: `This changes the API spec in a way that breaks its clients, without raising the major version (${String(rec(after.info).version ?? "none")}): ${found.slice(0, 5).join("; ")}${found.length > 5 ? `; and ${found.length - 5} more` : ""}. Raise the major version, or keep the old shape. It waits for you.`,
  }
}
