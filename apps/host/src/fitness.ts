/**
 * D-045, fitness functions (Frontier build, Wave 3): checks the owner sets for the project in .codehouse/fitness.yml,
 * each with its limit: the longest a source file may be (maxFileLines), how many other modules one module may import
 * (maxFanOut, coupling, from D-041's graph), how many packages package.json may name (maxDependencies), and APIs that
 * may not be used (forbiddenApis: a regular expression, optionally only in some files, with a reason). They are a gate:
 * a goal run that says it is done while one fails is not done (it stops as "fitness" and says which), and they are in
 * the change's evidence pack. A file that does not parse checks nothing, and says why.
 */
import fs from "node:fs"
import path from "node:path"
import { parse as parseYaml } from "yaml"
import { compileGlobs } from "@gatehouse/policy"
import { modulesOf } from "./arch-view.js"
import { updateGraph } from "./architecture.js"
import { languageOf } from "./outline.js"

export const FITNESS_FILE = path.join(".codehouse", "fitness.yml")

/** Whether the project sets fitness checks: read before anything else, so a project without them costs nothing. */
export const hasFitness = (root: string) => fs.existsSync(path.join(root, FITNESS_FILE))

export interface FitnessCheck {
  id: string
  title: string
  limit: number | string
  ok: boolean
  /** What breached it, in words. */
  detail?: string
}

export interface FitnessResult {
  checks: FitnessCheck[]
  failed: number
  problem?: string
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined)

/** The project's fitness checks against its files as they are. No fitness.yml: no checks. Never throws. */
export async function fitnessCheck(root: string, files: string[]): Promise<FitnessResult | undefined> {
  let text: string
  try {
    text = fs.readFileSync(path.join(root, FITNESS_FILE), "utf8")
  } catch {
    return undefined
  }
  let o: Record<string, unknown>
  try {
    const y = parseYaml(text) as unknown
    o = (y && typeof y === "object" ? y : {}) as Record<string, unknown>
  } catch {
    return { checks: [], failed: 0, problem: ".codehouse/fitness.yml is not valid YAML, so no fitness check ran" }
  }
  const checks: FitnessCheck[] = []
  const sources = files.filter((f) => languageOf(f) && languageOf(f) !== "json")
  const maxLines = num(o.maxFileLines)
  if (maxLines !== undefined) {
    const over: string[] = []
    for (const f of sources) {
      try {
        const n = fs.readFileSync(path.join(root, f), "utf8").split(/\r?\n/).length
        if (n > maxLines) over.push(`${f} (${n})`)
      } catch {
        // gone
      }
    }
    checks.push({ id: "maxFileLines", title: "Longest source file", limit: maxLines, ok: !over.length, ...(over.length ? { detail: `Longer: ${over.slice(0, 5).join(", ")}${over.length > 5 ? ` and ${over.length - 5} more` : ""}` } : {}) })
  }
  const maxFanOut = num(o.maxFanOut)
  if (maxFanOut !== undefined) {
    const g = modulesOf(await updateGraph(root, files))
    const fan = new Map<string, Set<string>>()
    for (const e of g.edges) {
      const [a, b] = e.split(" -> ") as [string, string]
      fan.set(a, (fan.get(a) ?? new Set()).add(b))
    }
    const over = [...fan].filter(([, s]) => s.size > maxFanOut).map(([m, s]) => `${m} (${s.size})`)
    checks.push({ id: "maxFanOut", title: "Modules one module imports", limit: maxFanOut, ok: !over.length, ...(over.length ? { detail: `More: ${over.join(", ")}` } : {}) })
  }
  const maxDeps = num(o.maxDependencies)
  if (maxDeps !== undefined) {
    let n = 0
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>
      n = Object.keys(pkg.dependencies ?? {}).length + Object.keys(pkg.devDependencies ?? {}).length
    } catch {
      // no package.json: none
    }
    checks.push({ id: "maxDependencies", title: "Packages package.json names", limit: maxDeps, ok: n <= maxDeps, ...(n > maxDeps ? { detail: `It names ${n}` } : {}) })
  }
  for (const [i, raw] of (Array.isArray(o.forbiddenApis) ? o.forbiddenApis : []).entries()) {
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
    if (typeof r.pattern !== "string") continue
    let re: RegExp
    try {
      re = new RegExp(r.pattern)
    } catch {
      checks.push({ id: `forbiddenApis.${i}`, title: `Forbidden: ${r.pattern}`, limit: "not used", ok: false, detail: "The pattern is not a valid regular expression" })
      continue
    }
    const only = typeof r.files === "string" ? compileGlobs([r.files.toLowerCase()]) : undefined
    const found: string[] = []
    for (const f of sources) {
      if (only && !only(f.toLowerCase())) continue
      try {
        const lines = fs.readFileSync(path.join(root, f), "utf8").split(/\r?\n/)
        const at = lines.findIndex((l) => re.test(l))
        if (at >= 0) found.push(`${f}:${at + 1}`)
      } catch {
        // gone
      }
    }
    checks.push({
      id: `forbiddenApis.${i}`,
      title: `Forbidden: ${r.pattern}${typeof r.reason === "string" ? ` (${r.reason})` : ""}`,
      limit: "not used",
      ok: !found.length,
      ...(found.length ? { detail: `Used at ${found.slice(0, 5).join(", ")}${found.length > 5 ? ` and ${found.length - 5} more` : ""}` } : {}),
    })
  }
  return { checks, failed: checks.filter((c) => !c.ok).length }
}

export const fitnessWords = (r: FitnessResult) =>
  r.checks
    .filter((c) => !c.ok)
    .map((c) => `${c.title}: limit ${c.limit}${c.detail ? `; ${c.detail}` : ""}`)
    .join(". ")
