/**
 * D-055, licence policy (Frontier build, Wave 1; offline). A dependency a change adds, that the project does not use
 * yet, has its SPDX licence read from what is already on this computer: the project's node_modules and lockfile, a
 * Python environment in the project, and the NuGet and Cargo package folders. A licence outside the allowed list goes
 * to a person and Extreme approval never approves it; one that cannot be read goes to a person too.
 *
 * The allowed list is the permissive default below, or the one in Settings, or, when the organisation's managed policy
 * sets one, that one. An entry such as "npm:left-pad" accepts that package whatever its licence. npm's own download
 * cache is not read: it keeps packages as compressed archives under hashes, so a package not yet installed counts as
 * unknown.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { AddedDependency } from "./dependencies.js"

export const LICENCE_NOT_ALLOWED = "licence-not-allowed"
export const LICENCE_UNKNOWN = "licence-unknown"

/** Permissive licences allowed by default (the Frontier build's list). */
export const DEFAULT_LICENCES: readonly string[] = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD", "Unlicense"]

export interface LicenceFinding {
  outcome: "escalate"
  ruleId: typeof LICENCE_NOT_ALLOWED | typeof LICENCE_UNKNOWN
  reason: string
  risk: number
  /** The dependency, as ecosystem:name. */
  dependency: string
  licence?: string
}

/**
 * Whether an SPDX expression is allowed: OR needs one side allowed, AND both. "X WITH exception" counts as X, since an
 * exception only adds permissions; "X+" counts as X. Undefined when it cannot be read as an expression.
 */
export function licenceAllowed(expr: string, allowed: readonly string[]): boolean | undefined {
  const ok = new Set(allowed.map((a) => a.toLowerCase()))
  const tokens = expr
    .replace(/\//g, " OR ")
    .replace(/([()])/g, " $1 ")
    .split(/\s+/)
    .filter(Boolean)
  let i = 0
  const peek = () => tokens[i]?.toUpperCase()
  const atom = (): boolean | undefined => {
    const t = tokens[i++]
    if (t === undefined) return undefined
    if (t === "(") {
      const v = or()
      if (tokens[i++] !== ")") return undefined
      return v
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9.+-]*$/.test(t) || ["AND", "OR", "WITH"].includes(t.toUpperCase())) return undefined
    if (peek() === "WITH") {
      i++
      if (!tokens[i++]) return undefined
    }
    return ok.has(t.toLowerCase()) || ok.has(t.replace(/\+$/, "").toLowerCase())
  }
  const and = (): boolean | undefined => {
    let v = atom()
    while (peek() === "AND") {
      i++
      const w = atom()
      if (v === undefined || w === undefined) return undefined
      v = v && w
    }
    return v
  }
  const or = (): boolean | undefined => {
    let v = and()
    while (peek() === "OR") {
      i++
      const w = and()
      if (v === undefined || w === undefined) return undefined
      v = v || w
    }
    return v
  }
  const v = or()
  return i === tokens.length ? v : undefined
}

const readJson = (f: string): Record<string, unknown> | undefined => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8")) as Record<string, unknown>
  } catch {
    return undefined
  }
}
const readText = (f: string): string | undefined => {
  try {
    return fs.readFileSync(f, "utf8")
  } catch {
    return undefined
  }
}
const list = (d: string): string[] => {
  try {
    return fs.readdirSync(d)
  } catch {
    return []
  }
}

/** A package.json's licence: "MIT", { type: "MIT" }, or the old licenses list, joined with OR. */
function npmLicence(j: Record<string, unknown> | undefined): string | undefined {
  if (!j) return undefined
  const one = (x: unknown) => (typeof x === "string" ? x : typeof (x as { type?: unknown })?.type === "string" ? String((x as { type: string }).type) : undefined)
  const l = one(j.license)
  if (l) return l
  if (Array.isArray(j.licenses)) {
    const all = j.licenses.map(one).filter((x): x is string => !!x)
    if (all.length) return all.join(" OR ")
  }
  return undefined
}

/** Python's trove classifiers for the common licences. */
const CLASSIFIERS: Array<[RegExp, string]> = [
  [/License :: OSI Approved :: MIT License/, "MIT"],
  [/License :: OSI Approved :: Apache Software License/, "Apache-2.0"],
  [/License :: OSI Approved :: BSD License/, "BSD-3-Clause"],
  [/License :: OSI Approved :: ISC License/, "ISC"],
  [/License :: OSI Approved :: GNU General Public License v3/, "GPL-3.0"],
  [/License :: OSI Approved :: GNU General Public License v2/, "GPL-2.0"],
  [/License :: OSI Approved :: GNU Lesser General Public License/, "LGPL-3.0"],
  [/License :: OSI Approved :: Mozilla Public License 2\.0/, "MPL-2.0"],
]

function pythonLicence(dirs: string[], name: string): string | undefined {
  const want = name.toLowerCase().replace(/[-_.]+/g, "_")
  for (const dir of dirs)
    for (const env of [".venv", "venv", "env"]) {
      const base = path.join(dir, env)
      const sites = [path.join(base, "Lib", "site-packages"), ...list(path.join(base, "lib")).map((p) => path.join(base, "lib", p, "site-packages"))]
      for (const site of sites)
        for (const d of list(site)) {
          const m = /^(.+)-[^-]+\.dist-info$/.exec(d)
          if (!m || m[1]!.toLowerCase().replace(/[-_.]+/g, "_") !== want) continue
          const meta = readText(path.join(site, d, "METADATA")) ?? ""
          const expr = /^License-Expression:\s*(.+)$/m.exec(meta)?.[1]?.trim()
          if (expr) return expr
          const short = /^License:\s*(\S+)\s*$/m.exec(meta)?.[1]
          if (short && licenceAllowed(short, [short]) !== undefined) return short
          for (const [re, id] of CLASSIFIERS) if (re.test(meta)) return id
          return undefined
        }
    }
  return undefined
}

/** The newest version folder's file, for package folders laid out as name/version. */
function newest(dir: string): string | undefined {
  const v = list(dir).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  return v.length ? path.join(dir, v[v.length - 1]!) : undefined
}

/** The licence of a dependency as this computer already has it, or undefined when it cannot be read. */
export function licenceOf(dep: AddedDependency, dirs: string[], home = process.env.USERPROFILE ?? os.homedir()): string | undefined {
  if (dep.ecosystem === "npm") {
    for (const dir of dirs) {
      const l = npmLicence(readJson(path.join(dir, "node_modules", ...dep.name.split("/"), "package.json")))
      if (l) return l
      const lock = readJson(path.join(dir, "package-lock.json"))
      const entry = (lock?.packages as Record<string, unknown> | undefined)?.[`node_modules/${dep.name}`]
      const fromLock = npmLicence(entry as Record<string, unknown> | undefined)
      if (fromLock) return fromLock
    }
    return undefined
  }
  if (dep.ecosystem === "pypi") return pythonLicence(dirs, dep.name)
  if (dep.ecosystem === "nuget") {
    const id = dep.name.toLowerCase()
    const v = newest(path.join(home, ".nuget", "packages", id))
    const spec = v ? readText(path.join(v, `${id}.nuspec`)) : undefined
    return spec ? /<license\s+type="expression"\s*>([^<]+)<\/license>/i.exec(spec)?.[1]?.trim() : undefined
  }
  if (dep.ecosystem === "cargo") {
    const src = path.join(home, ".cargo", "registry", "src")
    const found = list(src)
      .flatMap((reg) => list(path.join(src, reg)).filter((d) => d.startsWith(`${dep.name}-`) && /^\d/.test(d.slice(dep.name.length + 1))).map((d) => path.join(src, reg, d)))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    const toml = found.length ? readText(path.join(found[found.length - 1]!, "Cargo.toml")) : undefined
    return toml ? /^\s*license\s*=\s*"([^"]+)"/m.exec(toml)?.[1] : undefined
  }
  return undefined
}

/** What to do about each added dependency's licence. Nothing for ones allowed, or accepted by name. */
export function licenceFindings(added: AddedDependency[], dirs: string[], allowed: readonly string[], home?: string): LicenceFinding[] {
  const out: LicenceFinding[] = []
  const byName = new Set(allowed.filter((a) => a.includes(":")).map((a) => a.toLowerCase()))
  for (const d of added) {
    const key = `${d.ecosystem}:${d.name}`
    if (byName.has(key.toLowerCase())) continue
    const licence = licenceOf(d, dirs, home)
    const ok = licence === undefined ? undefined : licenceAllowed(licence, allowed)
    if (ok === true) continue
    if (licence !== undefined && ok === false)
      out.push({
        outcome: "escalate",
        ruleId: LICENCE_NOT_ALLOWED,
        reason: `It adds ${d.name} (${d.ecosystem}), whose licence is ${licence}, which is not on the list of licences allowed without asking (Settings, Policy, Licences). Check this project may use it.`,
        risk: 82,
        dependency: key,
        licence,
      })
    else
      out.push({
        outcome: "escalate",
        ruleId: LICENCE_UNKNOWN,
        reason: `It adds ${d.name} (${d.ecosystem}), whose licence Codehouse cannot read on this computer${licence ? ` ("${licence.slice(0, 60)}" is not an SPDX licence)` : ""}. Check its licence before you allow it.`,
        risk: 74,
        dependency: key,
        ...(licence ? { licence } : {}),
      })
  }
  return out
}
