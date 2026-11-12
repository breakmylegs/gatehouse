/**
 * D-046, a public API break guard (Frontier build, Wave 3). In a library (a package.json that is not private and names
 * an entry point: main, module, types or exports), an edit that removes an exported name from a TypeScript or
 * JavaScript module (a function, class, constant, interface, type or enum, or a name in an export list) breaks the
 * people who use it, so it goes to a person with the removed declarations shown. Exports are read with Tree-sitter; the
 * TypeScript language service named in the plan (C-032) is not built yet, and this reads the same declarations. A .NET
 * project with ApiCompat is named in the reason (detected, never installed).
 */
import fs from "node:fs"
import path from "node:path"
import type { Node } from "web-tree-sitter"
import { afterEdit } from "./architecture.js"
import { TEST_FILE } from "./mutation.js"
import { languageOf, parserFor } from "./outline.js"

export const API_RULE = "api-break"

/** The names a module exports, each with the line that declares it. */
export async function exportsOf(file: string, text: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const lang = languageOf(file)
  if (!lang || !["typescript", "tsx", "javascript"].includes(lang)) return out
  const tree = (await parserFor(lang as "typescript")).parse(text)
  if (!tree) return out
  const first = (n: Node) => n.text.split(/\r?\n/)[0]!.trim()
  try {
    for (const top of tree.rootNode.namedChildren) {
      if (!top || top.type !== "export_statement") continue
      if (/^export\s+default\b/.test(top.text)) out.set("default", first(top))
      const d = top.childForFieldName("declaration")
      if (d) {
        const name = d.childForFieldName("name")?.text
        if (name) out.set(name, first(top))
        else if (d.type === "lexical_declaration" || d.type === "variable_declaration")
          for (const v of d.namedChildren) {
            const n = v?.type === "variable_declarator" ? v.childForFieldName("name")?.text : undefined
            if (n) out.set(n, first(top))
          }
      }
      for (const clause of top.namedChildren.filter((c) => c?.type === "export_clause"))
        for (const s of clause!.namedChildren) {
          if (s?.type !== "export_specifier") continue
          const name = (s.childForFieldName("alias") ?? s.childForFieldName("name"))?.text
          if (name) out.set(name, `export { ${s.text} }`)
        }
    }
  } finally {
    tree.delete()
  }
  return out
}

/** Whether the project publishes an API: a package that is not private and names an entry point. */
export function isLibrary(root: string): boolean {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as Record<string, unknown>
    return pkg.private !== true && ["main", "module", "types", "typings", "exports"].some((k) => pkg[k] !== undefined)
  } catch {
    return false
  }
}

/** Whether a .NET project here has ApiCompat (in its tool manifest or a package reference). */
export function hasApiCompat(root: string): boolean {
  try {
    if (/apicompat/i.test(fs.readFileSync(path.join(root, ".config", "dotnet-tools.json"), "utf8"))) return true
  } catch {
    // no manifest
  }
  try {
    return fs.readdirSync(root).some((n) => /\.(cs|fs|vb)proj$/i.test(n) && /ApiCompat/i.test(fs.readFileSync(path.join(root, n), "utf8")))
  } catch {
    return false
  }
}

export interface ApiBreak {
  file: string
  removed: Array<{ name: string; declaration: string }>
}

/** What an edit removes from the public API, in a library. */
export async function apiBreak(root: string, tool: string, input: Record<string, unknown>): Promise<ApiBreak | undefined> {
  if (!["Write", "Edit", "MultiEdit"].includes(tool) || !isLibrary(root)) return undefined
  const abs = String(input.file_path ?? "")
  const rel = path.relative(root, abs).replace(/\\/g, "/")
  if (!rel || rel.startsWith("..") || TEST_FILE.test(rel)) return undefined
  let current: string
  try {
    current = fs.readFileSync(abs, "utf8")
  } catch {
    return undefined
  }
  const next = afterEdit(tool, input, current)
  if (next === undefined) return undefined
  const before = await exportsOf(rel, current)
  if (!before.size) return undefined
  const after = await exportsOf(rel, next)
  const removed = [...before].filter(([name]) => !after.has(name)).map(([name, declaration]) => ({ name, declaration }))
  return removed.length ? { file: rel, removed } : undefined
}

export const apiReason = (b: ApiBreak, dotnet = false) =>
  `This edit removes ${b.removed.length === 1 ? "an export" : `${b.removed.length} exports`} from ${b.file}, a public module of this library, which breaks whoever uses ${b.removed.length === 1 ? "it" : "them"}:\n${b.removed
    .slice(0, 8)
    .map((r) => `- ${r.declaration}`)
    .join("\n")}${dotnet ? "\nThis project also has ApiCompat; run it to check the .NET API." : ""}`
