import fs from "node:fs"
import path from "node:path"

/**
 * D-051 (frontier, Insight and evidence): the personal data flow map, as a draft. It finds fields that look like
 * personal data by their names (an email, a phone number, a name, a date of birth, an address, an identity or account
 * number, an IP address) and follows each to where it goes on the same statement: a log, storage, or a network call.
 * It reads source code only, changes nothing, and says plainly that it is a draft: a name can mislead, and a flow
 * through another function or file is not followed. For legal review, it lists its scope and the fields it found.
 */
export const PERSONAL = [
  { category: "contact", re: /\b(e-?mail(Address)?|phone(Number)?|mobile|telephone|tel)\b/i },
  { category: "name", re: /\b(first_?Name|last_?Name|full_?Name|surname|given_?Name|family_?Name)\b/i },
  { category: "birth", re: /\b(date_?Of_?Birth|dob|birth_?Date|birthday)\b/i },
  { category: "address", re: /\b(street|address(Line\d?)?|post_?code|zip_?Code|postal_?Code)\b/i },
  { category: "identity", re: /\b(ssn|national_?Insurance(Number)?|nino|passport(Number)?|driving_?Licen[cs]e|tax_?Id)\b/i },
  { category: "financial", re: /\b(iban|card_?Number|account_?Number|sort_?Code|cvv)\b/i },
  { category: "online", re: /\b(ip_?Address|remote_?Addr|device_?Id|user_?Agent)\b/i },
] as const

export const SINKS = [
  { sink: "log", re: /\b(console\.(log|info|warn|error|debug)|logger\.\w+|log\.(info|warn|error|debug)|print|logging\.\w+|Console\.Write(Line)?|_logger\.Log\w*)\s*\(/ },
  { sink: "storage", re: /\b(localStorage|sessionStorage|\.insert\w*|\.save\w*|\.create|\.update\w*|\.upsert|writeFile\w*|\.put|INSERT\s+INTO|UPDATE\s+\w+\s+SET|SaveChanges\w*)\b/i },
  { sink: "network", re: /\b(fetch|axios\.\w+|http\.request|https\.request|\.post|\.send|requests\.(get|post|put)|HttpClient|PostAsync|PutAsync)\s*\(?/ },
] as const

export interface Field {
  name: string
  category: string
  file: string
  line: number
}
export interface Flow {
  field: string
  category: string
  sink: "log" | "storage" | "network"
  file: string
  line: number
  text: string
}

const SOURCE = /\.(m|c)?(t|j)sx?$|\.(py|cs|go|java|kt|rb|php)$/i

/** One file's fields and flows. Comments are not read. */
export function scanFile(file: string, text: string): { fields: Field[]; flows: Flow[] } {
  const fields: Field[] = []
  const flows: Flow[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    // A comment: // after a space or at the start (not the // of an address), or a line starting with #.
    const line = lines[i]!.replace(/(^|\s)\/\/.*$/, "").replace(/^\s*#.*$/, "").trim()
    if (!line || line.startsWith("*") || line.startsWith("/*")) continue
    for (const p of PERSONAL) {
      const m = p.re.exec(line)
      if (!m) continue
      fields.push({ name: m[0], category: p.category, file, line: i + 1 })
      for (const s of SINKS) if (s.re.test(line)) flows.push({ field: m[0], category: p.category, sink: s.sink, file, line: i + 1, text: line.slice(0, 200) })
    }
  }
  return { fields, flows }
}

export interface PersonalDataMap {
  draft: true
  scope: { root: string; files: number; skipped: string[] }
  fields: Array<{ name: string; category: string; places: number }>
  flows: Flow[]
}

/** The map for a project's source files, skipping dependencies, builds and tests. */
export function personalDataMap(root: string, files: string[]): PersonalDataMap {
  const skipped = ["node_modules", "dist and build folders", "tests", "files over 1 MB"]
  const seen = files.filter((f) => SOURCE.test(f) && !/(^|\/)(node_modules|dist|build|bin|obj|\.git)\//.test(f) && !/(\.test|\.spec)\.|(^|\/)tests?\//i.test(f)).slice(0, 5000)
  const all: Field[] = []
  const flows: Flow[] = []
  for (const f of seen) {
    try {
      const abs = path.join(root, f)
      if (fs.statSync(abs).size > 1_000_000) continue
      const r = scanFile(f, fs.readFileSync(abs, "utf8"))
      all.push(...r.fields)
      flows.push(...r.flows)
    } catch {
      // gone since
    }
  }
  const byName = new Map<string, { name: string; category: string; places: number }>()
  for (const x of all) {
    const k = `${x.category}:${x.name.toLowerCase()}`
    byName.set(k, { name: x.name, category: x.category, places: (byName.get(k)?.places ?? 0) + 1 })
  }
  return { draft: true, scope: { root: path.basename(root), files: seen.length, skipped }, fields: [...byName.values()].sort((a, b) => a.category.localeCompare(b.category) || b.places - a.places), flows: flows.slice(0, 500) }
}

/** The draft for legal review, as Markdown: the scope, the fields, and where they go. */
export function legalDraft(m: PersonalDataMap): string {
  const rows = (xs: string[][]) => xs.map((r) => `| ${r.join(" | ")} |`).join("\n")
  return [
    "# Personal data flow map (draft)",
    "",
    "This is a draft made from the code by name patterns. A name can mislead, and a flow through another function or file is not followed, so check it before relying on it.",
    "",
    "## Scope",
    "",
    `Project ${m.scope.root}: ${m.scope.files} source files read. Left out: ${m.scope.skipped.join(", ")}.`,
    "",
    "## Fields that look like personal data",
    "",
    "| Field | Kind | Places |",
    "|---|---|---|",
    rows(m.fields.map((f) => [f.name, f.category, String(f.places)])),
    "",
    "## Where they go",
    "",
    "| Field | To | File | Line |",
    "|---|---|---|---|",
    rows(m.flows.map((f) => [f.field, f.sink, f.file, String(f.line)])),
    "",
  ].join("\n")
}
