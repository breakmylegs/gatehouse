/**
 * E-034, contract snapshots (Expansion E3). Each contract probe (E-031) keeps the shape of every answer it got, per
 * project, in the data folder: keys and types only, never a value (decided by me, stricter than keeping redacted
 * bodies: there is nothing to redact), and keys put through the redaction list anyway. The next probe reports how each
 * answer's shape changed since: a key gone or added, a type changed, a status changed.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

export type Shape = unknown

/** How one shape differs from the last, in words. */
export function shapeChanges(before: Shape, after: Shape, where = ""): string[] {
  const at = where || "the answer"
  if (Array.isArray(before) && Array.isArray(after)) return before.length && after.length ? shapeChanges(before[0], after[0], `${where}[]`) : []
  const isObj = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v)
  if (isObj(before) && isObj(after)) {
    const a = before as Record<string, Shape>
    const b = after as Record<string, Shape>
    const out: string[] = []
    for (const k of Object.keys(a)) if (!(k in b)) out.push(`${where}.${k} is gone`)
    for (const k of Object.keys(b)) if (!(k in a)) out.push(`${where}.${k} is new`)
    for (const k of Object.keys(a)) if (k in b) out.push(...shapeChanges(a[k], b[k], `${where}.${k}`))
    return out
  }
  const name = (v: Shape) => (Array.isArray(v) ? "array" : isObj(v) ? "object" : String(v))
  return name(before) === name(after) ? [] : [`${at} was ${name(before)} and is now ${name(after)}`]
}

interface Snapshot {
  at: string
  status?: number
  shape: Shape
}

export class ContractSnapshots {
  constructor(
    readonly dir: string,
    private readonly redactKey: (k: string) => string = (k) => k,
  ) {}

  #file(project: string) {
    return path.join(this.dir, `${crypto.createHash("sha256").update(project.toLowerCase()).digest("hex").slice(0, 16)}.json`)
  }

  #redact(s: Shape): Shape {
    if (Array.isArray(s)) return s.map((x) => this.#redact(x))
    if (s && typeof s === "object") return Object.fromEntries(Object.entries(s as Record<string, Shape>).map(([k, v]) => [this.redactKey(k), this.#redact(v)]))
    return s
  }

  read(project: string): Record<string, Snapshot> {
    try {
      const v = JSON.parse(fs.readFileSync(this.#file(project), "utf8")) as { v?: number; answers?: Record<string, Snapshot> }
      return v.answers && typeof v.answers === "object" ? v.answers : {}
    } catch {
      return {}
    }
  }

  /** Keeps this probe's shapes, and says how each answer changed since the last probe of this project. */
  record(project: string, results: Array<{ method: string; path: string; status?: number; shape?: Shape }>): string[] {
    const old = this.read(project)
    const next: Record<string, Snapshot> = { ...old }
    const changes: string[] = []
    const at = new Date().toISOString()
    for (const r of results) {
      if (r.shape === undefined || r.status === undefined) continue
      const key = `${r.method} ${r.path}`
      const shape = this.#redact(r.shape)
      const prev = old[key]
      if (prev) {
        if (prev.status !== undefined && prev.status !== r.status) changes.push(`${key}: answered ${r.status}, where it answered ${prev.status} on ${prev.at.slice(0, 10)}`)
        for (const c of shapeChanges(prev.shape, shape)) changes.push(`${key}: ${c} since ${prev.at.slice(0, 10)}`)
      }
      next[key] = { at, status: r.status, shape }
    }
    fs.mkdirSync(this.dir, { recursive: true })
    const file = this.#file(project)
    fs.writeFileSync(`${file}.tmp`, JSON.stringify({ v: 1, answers: next }, null, 1))
    fs.renameSync(`${file}.tmp`, file)
    return changes
  }
}
