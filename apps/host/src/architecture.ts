/**
 * D-041, architecture rules as policy (Frontier build, Wave 3). A project says how it is built in
 * .codehouse/architecture.yml: its layers (by file globs), which layers each may depend on, and imports that are
 * forbidden (by module name, from some files). When an agent's edit would add an import that breaks one, the call goes
 * to a person, with the rule named. Imports are read with the Tree-sitter grammars (TypeScript, TSX, JavaScript, Python),
 * so only real imports count, not words in comments or strings.
 *
 * The project's import graph is kept in .codehouse/arch/graph.json, read again only for files that changed since
 * (by size and time), for the diagrams (D-042), the drift alerts (D-043) and the fitness functions (D-045).
 *
 * The file is read tolerantly: one that does not parse, or names no layers, checks nothing, and says why.
 */
import fs from "node:fs"
import path from "node:path"
import { parse as parseYaml } from "yaml"
import { compileGlobs } from "@gatehouse/policy"
import { writeFileAtomic } from "@gatehouse/shared/node"
import type { Node } from "web-tree-sitter"
import { languageOf, parserFor } from "./outline.js"

export const ARCH_RULE = "architecture"
export const ARCH_FILE = path.join(".codehouse", "architecture.yml")

export interface ArchRules {
  layers: Array<{ name: string; match: (file: string) => boolean; globs: string[] }>
  /** Which layers each may depend on. A layer not listed may depend on any. */
  allow: Record<string, string[]>
  forbid: Array<{ from?: (file: string) => boolean; fromGlobs?: string[]; module: RegExp; text: string; reason?: string }>
}

const wildcard = (g: string) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`)

/** The project's rules, or why there are none. Never throws. */
export function readArchRules(root: string): { rules?: ArchRules; problem?: string } {
  let text: string
  try {
    text = fs.readFileSync(path.join(root, ARCH_FILE), "utf8")
  } catch {
    return {}
  }
  let y: unknown
  try {
    y = parseYaml(text)
  } catch {
    return { problem: ".codehouse/architecture.yml is not valid YAML, so no architecture rule is checked" }
  }
  const o = (y && typeof y === "object" ? y : {}) as Record<string, unknown>
  const layersIn = (o.layers && typeof o.layers === "object" ? o.layers : {}) as Record<string, unknown>
  const layers = Object.entries(layersIn)
    .map(([name, v]) => {
      const globs = (Array.isArray(v) ? v : typeof v === "string" ? [v] : []).filter((g): g is string => typeof g === "string")
      return { name, globs, match: compileGlobs(globs.map((g) => g.toLowerCase())) }
    })
    .filter((l) => l.globs.length)
  if (!layers.length) return { problem: ".codehouse/architecture.yml names no layers, so no architecture rule is checked" }
  const allow: Record<string, string[]> = {}
  for (const [k, v] of Object.entries((o.allow && typeof o.allow === "object" ? o.allow : {}) as Record<string, unknown>))
    allow[k] = (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string")
  const forbid: ArchRules["forbid"] = []
  for (const f of Array.isArray(o.forbid) ? o.forbid : []) {
    const r = (f && typeof f === "object" ? f : {}) as Record<string, unknown>
    if (typeof r.import !== "string") continue
    const fromGlobs = typeof r.from === "string" ? [r.from] : Array.isArray(r.from) ? r.from.filter((x): x is string => typeof x === "string") : undefined
    forbid.push({
      module: wildcard(r.import),
      text: r.import,
      ...(fromGlobs?.length ? { fromGlobs, from: compileGlobs(fromGlobs.map((g) => g.toLowerCase())) } : {}),
      ...(typeof r.reason === "string" ? { reason: r.reason } : {}),
    })
  }
  return { rules: { layers, allow, forbid } }
}

/** The module names a file imports: import and export from, require, dynamic import; Python import and from. */
export async function importsOf(file: string, text: string): Promise<string[]> {
  const lang = languageOf(file)
  if (!lang || !["typescript", "tsx", "javascript", "python"].includes(lang)) return []
  const tree = (await parserFor(lang as "typescript")).parse(text)
  if (!tree) return []
  const out = new Set<string>()
  const str = (n: Node | null | undefined) => (n && /string/.test(n.type) ? n.text.replace(/^['"`]|['"`]$/g, "") : undefined)
  const walk = (n: Node) => {
    if ((n.type === "import_statement" || n.type === "export_statement") && lang !== "python") {
      const s = str(n.childForFieldName("source"))
      if (s) out.add(s)
    } else if (n.type === "call_expression") {
      const fn = n.childForFieldName("function")
      if (fn && (fn.text === "require" || fn.type === "import")) {
        const s = str(n.childForFieldName("arguments")?.namedChildren[0])
        if (s) out.add(s)
      }
    } else if (n.type === "import_statement" && lang === "python") {
      for (const c of n.namedChildren) if (c && (c.type === "dotted_name" || c.type === "aliased_import")) out.add((c.childForFieldName("name") ?? c).text)
    } else if (n.type === "import_from_statement") {
      const m = n.childForFieldName("module_name")
      if (m) out.add(m.text)
    }
    for (const c of n.namedChildren) if (c) walk(c)
  }
  try {
    walk(tree.rootNode)
  } finally {
    tree.delete()
  }
  return [...out]
}

const EXTS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", "/index.ts", "/index.tsx", "/index.js"]

/** A relative import as a project path (forward slashes), or undefined for a package. */
export function resolveImport(root: string, from: string, spec: string): string | undefined {
  if (!spec.startsWith(".")) {
    // Python's relative form is dots; its absolute form is a dotted path from the root.
    return undefined
  }
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from.replace(/\\/g, "/")), spec))
  for (const e of EXTS) {
    const cand = `${base}${e}`
    if (fs.existsSync(path.join(root, cand))) return cand
  }
  // A .js import of a .ts file (TypeScript's ESM form).
  const ts = base.replace(/\.js$/, ".ts")
  if (ts !== base && fs.existsSync(path.join(root, ts))) return ts
  return base
}

export interface ArchViolation {
  file: string
  module: string
  rule: string
  reason: string
}

/** The layer a project file is in, if any. */
export const layerOf = (rules: ArchRules, file: string) => rules.layers.find((l) => l.match(file.replace(/\\/g, "/").toLowerCase()))?.name

/** What the imports of a file, as it would be, break. */
export function violations(rules: ArchRules, root: string, file: string, imports: string[]): ArchViolation[] {
  const rel = file.replace(/\\/g, "/")
  const lower = rel.toLowerCase()
  const out: ArchViolation[] = []
  const mine = layerOf(rules, rel)
  for (const spec of imports) {
    for (const f of rules.forbid)
      if ((!f.from || f.from(lower)) && f.module.test(spec))
        out.push({
          file: rel,
          module: spec,
          rule: `forbid ${f.text}`,
          reason: `${rel} may not import ${spec}${f.fromGlobs ? ` (forbidden from ${f.fromGlobs.join(", ")})` : ""}${f.reason ? `: ${f.reason}` : ""}`,
        })
    const target = resolveImport(root, rel, spec)
    const theirs = target ? layerOf(rules, target) : undefined
    if (mine && theirs && theirs !== mine && rules.allow[mine] && !rules.allow[mine]!.includes(theirs))
      out.push({
        file: rel,
        module: spec,
        rule: `layer ${mine}`,
        reason: `${rel} is in the ${mine} layer, which may depend on ${rules.allow[mine]!.length ? rules.allow[mine]!.join(", ") : "no other layer"}, but ${spec} is in ${theirs}`,
      })
  }
  return out
}

/** The text a file would have after an edit call, or undefined when it cannot be known. */
export function afterEdit(tool: string, input: Record<string, unknown>, current: string | undefined): string | undefined {
  if (tool === "Write") return typeof input.content === "string" ? input.content : undefined
  if (current === undefined) return undefined
  const edits = tool === "Edit" ? [input] : tool === "MultiEdit" && Array.isArray(input.edits) ? (input.edits as Array<Record<string, unknown>>) : []
  let text = current
  for (const e of edits) {
    const was = String(e.old_string ?? "")
    const now = String(e.new_string ?? "")
    if (!text.includes(was)) return undefined
    text = e.replace_all === true ? text.split(was).join(now) : text.replace(was, () => now)
  }
  return text
}

/**
 * What an edit call adds against the project's architecture rules: only imports the file does not already have count,
 * so a file that already broke a rule is not stopped for every other change to it.
 */
export async function archCheck(root: string, tool: string, input: Record<string, unknown>): Promise<ArchViolation[]> {
  const { rules } = readArchRules(root)
  if (!rules || !["Write", "Edit", "MultiEdit"].includes(tool)) return []
  const abs = String(input.file_path ?? "")
  const rel = path.relative(root, abs)
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return []
  let current: string | undefined
  try {
    current = fs.readFileSync(abs, "utf8")
  } catch {
    current = undefined
  }
  const next = afterEdit(tool, input, current)
  if (next === undefined) return []
  const before = new Set(current === undefined ? [] : await importsOf(rel, current))
  const added = (await importsOf(rel, next)).filter((m) => !before.has(m))
  return violations(rules, root, rel, added)
}

export const archReason = (v: ArchViolation[]) =>
  `This edit breaks the project's architecture rules (.codehouse/architecture.yml): ${v
    .slice(0, 3)
    .map((x) => `${x.reason} (rule ${x.rule})`)
    .join("; ")}.`

export interface ArchGraph {
  v: 1
  files: Record<string, { size: number; mtimeMs: number; layer?: string; imports: string[]; internal: string[] }>
}

/** The import graph, brought up to date: only files whose size or time changed are read again. */
export async function updateGraph(root: string, files: string[]): Promise<ArchGraph> {
  const dir = path.join(root, ".codehouse", "arch")
  const file = path.join(dir, "graph.json")
  let graph: ArchGraph = { v: 1, files: {} }
  try {
    const g = JSON.parse(fs.readFileSync(file, "utf8")) as ArchGraph
    if (g.v === 1 && g.files) graph = g
  } catch {
    // first time
  }
  const { rules } = readArchRules(root)
  const next: ArchGraph = { v: 1, files: {} }
  let changed = false
  for (const rel of files.filter((f) => ["typescript", "tsx", "javascript", "python"].includes(languageOf(f) ?? ""))) {
    let st: fs.Stats
    try {
      st = fs.statSync(path.join(root, rel))
    } catch {
      continue
    }
    const had = graph.files[rel]
    if (had && had.size === st.size && had.mtimeMs === st.mtimeMs) {
      next.files[rel] = { ...had, ...(rules ? { layer: layerOf(rules, rel) } : {}) }
      continue
    }
    changed = true
    const imports = await importsOf(rel, fs.readFileSync(path.join(root, rel), "utf8"))
    const internal = imports.map((m) => resolveImport(root, rel, m)).filter((x): x is string => x !== undefined)
    const layer = rules ? layerOf(rules, rel) : undefined
    next.files[rel] = { size: st.size, mtimeMs: st.mtimeMs, imports, internal, ...(layer ? { layer } : {}) }
  }
  if (changed || Object.keys(graph.files).length !== Object.keys(next.files).length) {
    fs.mkdirSync(dir, { recursive: true })
    await writeFileAtomic(file, JSON.stringify(next))
  }
  return next
}
