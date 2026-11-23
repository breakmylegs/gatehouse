/**
 * E-070, the third-party notices generator (Expansion E5). From the project's npm lockfile, every package it ships
 * (development-only ones are left out), with its version and licence (D-055's reading: the installed package.json, or
 * else the lockfile), and the text of its licence and notice files (LICENSE, LICENCE, NOTICE, COPYING, in the
 * installed package). The notices file lists every package with its licence; a package whose licence or notice text
 * could not be found is listed under what is missing, never left out or given a licence it does not state.
 */
import fs from "node:fs"
import path from "node:path"

export interface NoticeEntry {
  name: string
  version: string
  licence?: string
  /** The licence and notice files' text, by file name. */
  texts: Array<{ file: string; text: string }>
}

export interface Notices {
  entries: NoticeEntry[]
  /** What could not be found, one line a package. */
  missing: string[]
  /** Why there is nothing to list, when there is not. */
  none?: string
}

const NOTICE_FILE = /^(licen[cs]e|notice|copying|copyright)(\.(md|txt|markdown|rst))?$|^(licen[cs]e|notice)[-_.]/i
const MAX_TEXT = 64 * 1024

function readJson(p: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>
  } catch {
    return undefined
  }
}

/** npm's licence field in any of its shapes: "MIT", { type: "MIT" }, or a licenses list. */
function licenceField(pkg: Record<string, unknown> | undefined): string | undefined {
  if (!pkg) return undefined
  const one = pkg.license
  if (typeof one === "string" && one.trim()) return one.trim()
  if (one && typeof one === "object" && typeof (one as { type?: unknown }).type === "string") return (one as { type: string }).type
  if (Array.isArray(pkg.licenses)) {
    const ids = pkg.licenses.map((l: unknown) => (typeof l === "string" ? l : (l as { type?: string })?.type)).filter((x): x is string => typeof x === "string" && !!x)
    if (ids.length) return ids.length > 1 ? `(${ids.join(" OR ")})` : ids[0]
  }
  return undefined
}

export function collectNotices(root: string): Notices {
  const lock = readJson(path.join(root, "package-lock.json"))
  const packages = lock?.packages as Record<string, Record<string, unknown>> | undefined
  if (!packages) return { entries: [], missing: [], none: "The project has no package-lock.json with packages to read (lockfile version 2 or later)." }
  const entries: NoticeEntry[] = []
  const missing: string[] = []
  const seen = new Set<string>()
  for (const [where, meta] of Object.entries(packages)) {
    if (!where.startsWith("node_modules/") && !where.includes("/node_modules/")) continue
    if (meta.dev === true || meta.link === true) continue
    const name = typeof meta.name === "string" ? meta.name : where.slice(where.lastIndexOf("node_modules/") + "node_modules/".length)
    const version = typeof meta.version === "string" ? meta.version : "?"
    if (seen.has(`${name}@${version}`)) continue
    seen.add(`${name}@${version}`)
    const dir = path.join(root, ...where.split("/"))
    const licence = licenceField(readJson(path.join(dir, "package.json"))) ?? licenceField(meta)
    const texts: NoticeEntry["texts"] = []
    let files: string[] = []
    try {
      files = fs.readdirSync(dir).filter((f) => NOTICE_FILE.test(f)).sort()
    } catch {
      files = []
    }
    for (const file of files) {
      try {
        const text = fs.readFileSync(path.join(dir, file), "utf8")
        texts.push({ file, text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n[cut at 64 KB]` : text })
      } catch {
        // A folder or an unreadable file is not a notice.
      }
    }
    entries.push({ name, version, ...(licence ? { licence } : {}), texts })
    const lacks = [licence ? "" : "no licence stated", texts.length ? "" : fs.existsSync(dir) ? "no licence or notice file in the package" : "not installed, so its notice files could not be read"].filter(Boolean)
    if (lacks.length) missing.push(`${name}@${version}: ${lacks.join("; ")}`)
  }
  entries.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
  missing.sort()
  return { entries, missing }
}

/** The notices file: a summary list, what is missing, then each package's licence and notice texts. */
export function noticesText(project: string, n: Notices): string {
  const out = [`Third-party notices for ${project}`, "", `${n.entries.length} package(s).`, ""]
  for (const e of n.entries) out.push(`- ${e.name} ${e.version}: ${e.licence ?? "licence not stated"}`)
  if (n.missing.length) out.push("", "Missing (to resolve before this file is complete):", ...n.missing.map((m) => `- ${m}`))
  for (const e of n.entries) {
    out.push("", "-".repeat(72), `${e.name} ${e.version}`, `Licence: ${e.licence ?? "not stated"}`)
    for (const t of e.texts) out.push("", `${t.file}:`, "", t.text.trimEnd())
  }
  return out.join("\n") + "\n"
}
