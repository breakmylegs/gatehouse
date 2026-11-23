/**
 * E-084, sequence diagrams from code paths (Expansion E5). From an entry point you choose in a TypeScript or JavaScript
 * project (a function, or a class's method: file#name or file#Class.method), the calls it makes are followed with
 * Tree-sitter (C-031) to a set depth, and drawn as a Mermaid sequence diagram (C-057). A call is resolved when its
 * target can be read from the code itself: a function in the same file or imported from a project file, a method on
 * `this`, on a field whose class the constructor's typed parameters or a `new` give, on a local made with `new` or a
 * typed parameter, or a class's static method. Anything else (a library, a call through a value it cannot type) is
 * drawn to "Unresolved" and listed, never guessed.
 */
import fs from "node:fs"
import path from "node:path"
import type { Node } from "web-tree-sitter"
import { languageOf, parserFor } from "./outline.js"

interface Def {
  file: string
  name: string
  /** The class, for a method. */
  cls?: string
  body: Node
  /** For a method: its class's field types. */
  fields?: Map<string, string>
  /** Parameter types, by parameter name. */
  params: Map<string, string>
}

interface FileInfo {
  file: string
  functions: Map<string, Def>
  classes: Map<string, { methods: Map<string, Def>; fields: Map<string, string> }>
  /** Local name, to the project file and name it is imported from. */
  imports: Map<string, { file: string; name: string; namespace?: boolean }>
}

export interface Call {
  from: string
  to: string
  label: string
  resolved: boolean
  file: string
  line: number
}

export interface Sequence {
  entry: string
  participants: string[]
  calls: Call[]
  unresolved: Call[]
  mermaid: string
}

const typeName = (n: Node | null | undefined): string | undefined => {
  const t = n?.type === "type_annotation" ? n.namedChildren[0] : n
  if (!t) return undefined
  const id = t.type === "generic_type" ? t.childForFieldName("name") : t
  return id && /^(type_identifier|identifier)$/.test(id.type) ? id.text : undefined
}

function paramsOf(fn: Node): Map<string, string> {
  const out = new Map<string, string>()
  for (const p of fn.childForFieldName("parameters")?.namedChildren ?? []) {
    if (!p) continue
    const name = p.childForFieldName("pattern")?.text ?? p.childForFieldName("name")?.text
    const type = typeName(p.childForFieldName("type"))
    if (name && type) out.set(name, type)
  }
  return out
}

function resolveModule(from: string, spec: string, known: Set<string>): string | undefined {
  if (!spec.startsWith(".")) return undefined
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec)).replace(/\.(js|mjs|cjs|jsx)$/, "")
  for (const c of [base, ...["ts", "tsx", "mts", "js", "mjs", "jsx"].map((e) => `${base}.${e}`), ...["ts", "tsx", "js"].map((e) => `${base}/index.${e}`)]) if (known.has(c)) return c
  return undefined
}

async function readFileInfo(root: string, file: string, known: Set<string>): Promise<FileInfo | undefined> {
  const lang = languageOf(file)
  if (lang !== "typescript" && lang !== "tsx" && lang !== "javascript") return undefined
  let text: string
  try {
    text = fs.readFileSync(path.join(root, file), "utf8")
  } catch {
    return undefined
  }
  const tree = (await parserFor(lang)).parse(text)
  if (!tree) return undefined
  const info: FileInfo = { file, functions: new Map(), classes: new Map(), imports: new Map() }
  const visit = (n: Node) => {
    for (const c of n.namedChildren) {
      if (!c) continue
      const node = c.type === "export_statement" ? (c.childForFieldName("declaration") ?? c) : c
      if (node.type === "import_statement") {
        const spec = node.childForFieldName("source")?.text.slice(1, -1)
        const target = spec ? resolveModule(file, spec, known) : undefined
        if (target)
          for (const s of node.descendantsOfType(["import_specifier", "namespace_import", "identifier"])) {
            if (!s) continue
            if (s.type === "import_specifier") {
              const name = s.childForFieldName("name")!.text
              info.imports.set(s.childForFieldName("alias")?.text ?? name, { file: target, name })
            } else if (s.type === "namespace_import") {
              const local = s.namedChildren.find((x) => x?.type === "identifier")?.text
              if (local) info.imports.set(local, { file: target, name: "*", namespace: true })
            } else if (s.parent?.type === "import_clause") info.imports.set(s.text, { file: target, name: "default" })
          }
      } else if (node.type === "function_declaration") {
        const name = node.childForFieldName("name")?.text
        const body = node.childForFieldName("body")
        if (name && body) info.functions.set(name, { file, name, body, params: paramsOf(node) })
      } else if (node.type === "lexical_declaration" || node.type === "variable_declaration") {
        for (const d of node.namedChildren) {
          const v = d?.childForFieldName("value")
          const name = d?.childForFieldName("name")?.text
          if (d && name && v && /^(arrow_function|function_expression|function)$/.test(v.type)) {
            const body = v.childForFieldName("body")
            if (body) info.functions.set(name, { file, name, body, params: paramsOf(v) })
          }
        }
      } else if (node.type === "class_declaration" || node.type === "abstract_class_declaration") {
        const cls = node.childForFieldName("name")?.text
        const body = node.childForFieldName("body")
        if (!cls || !body) continue
        const fields = new Map<string, string>()
        const methods = new Map<string, Def>()
        for (const m of body.namedChildren) {
          if (!m) continue
          if (m.type === "public_field_definition" || m.type === "field_definition") {
            const name = (m.childForFieldName("name") ?? m.childForFieldName("property"))?.text
            const type = typeName(m.childForFieldName("type")) ?? (m.childForFieldName("value")?.type === "new_expression" ? m.childForFieldName("value")!.childForFieldName("constructor")?.text : undefined)
            if (name && type) fields.set(name.replace(/^#/, ""), type)
          }
          if (m.type === "method_definition") {
            const name = m.childForFieldName("name")?.text
            const mb = m.childForFieldName("body")
            if (!name || !mb) continue
            if (name === "constructor") {
              // Parameter properties (private readonly repo: Repo) and this.x = new X() in the constructor.
              for (const p of m.childForFieldName("parameters")?.namedChildren ?? []) {
                if (!p || !p.namedChildren.some((x) => x?.type === "accessibility_modifier" || x?.type === "readonly")) continue
                const pn = p.childForFieldName("pattern")?.text
                const pt = typeName(p.childForFieldName("type"))
                if (pn && pt) fields.set(pn, pt)
              }
              for (const a of mb.descendantsOfType("assignment_expression")) {
                const left = a?.childForFieldName("left")
                const right = a?.childForFieldName("right")
                if (left?.type === "member_expression" && left.childForFieldName("object")?.type === "this" && right?.type === "new_expression") {
                  const t = right.childForFieldName("constructor")?.text
                  const prop = left.childForFieldName("property")?.text
                  if (t && prop) fields.set(prop, t)
                }
              }
            }
            methods.set(name, { file, name, cls, body: mb, fields, params: paramsOf(m) })
          }
        }
        info.classes.set(cls, { methods, fields })
      }
    }
  }
  visit(tree.rootNode)
  return info
}

/** Draws the calls from `entry` (file#function or file#Class.method) to `depth` levels. */
export async function sequenceFrom(root: string, files: string[], entry: string, depth = 3): Promise<Sequence> {
  const [entryFile, entryName] = entry.split("#") as [string, string | undefined]
  if (!entryName) throw new Error("Name the entry point as file#function or file#Class.method.")
  const code = files.map((f) => f.replace(/\\/g, "/")).filter((f) => /\.(ts|tsx|mts|js|mjs|jsx)$/.test(f) && !/(^|\/)(node_modules|dist|build)\//.test(f) && !/\.d\.ts$/.test(f)).slice(0, 3000)
  const known = new Set(code)
  const infos = new Map<string, FileInfo>()
  const info = async (f: string) => {
    if (!infos.has(f)) {
      const i = await readFileInfo(root, f, known)
      if (i) infos.set(f, i)
    }
    return infos.get(f)
  }
  // Classes by name across the project, read as needed.
  let allRead = false
  const classByName = async (name: string, from: FileInfo): Promise<{ file: string; cls: string } | undefined> => {
    if (from.classes.has(name)) return { file: from.file, cls: name }
    const imp = from.imports.get(name)
    if (imp && !imp.namespace) {
      const target = await info(imp.file)
      const real = imp.name === "default" ? name : imp.name
      if (target?.classes.has(real)) return { file: imp.file, cls: real }
    }
    if (!allRead) {
      for (const f of code) await info(f)
      allRead = true
    }
    const hits = [...infos.values()].filter((i) => i.classes.has(name))
    return hits.length === 1 ? { file: hits[0]!.file, cls: name } : undefined
  }
  const start = await info(entryFile.replace(/\\/g, "/"))
  if (!start) throw new Error(`${entryFile} is not a TypeScript or JavaScript file in the project.`)
  const [a, b] = entryName.split(".")
  const first = b ? start.classes.get(a!)?.methods.get(b) : start.functions.get(a!)
  if (!first) throw new Error(`There is no ${entryName} in ${entryFile}.`)
  const who = (d: Def) => d.cls ?? path.posix.basename(d.file).replace(/\.[^.]+$/, "")
  const calls: Call[] = []
  const participants: string[] = ["Caller"]
  const add = (p: string) => {
    if (!participants.includes(p)) participants.push(p)
  }
  const seen = new Set<string>()
  const walk = async (d: Def, level: number, from: string) => {
    const self = who(d)
    add(self)
    const fileInfo = infos.get(d.file)!
    const locals = new Map<string, string>(d.params)
    // Locals made with new, in the body.
    for (const v of d.body.descendantsOfType("variable_declarator")) {
      const val = v?.childForFieldName("value")
      const n = v?.childForFieldName("name")?.text
      const t = typeName(v?.childForFieldName("type")) ?? (val?.type === "new_expression" ? val.childForFieldName("constructor")?.text : undefined)
      if (n && t) locals.set(n, t)
    }
    for (const c of d.body.descendantsOfType("call_expression")) {
      if (!c) continue
      const fn = c.childForFieldName("function")
      if (!fn) continue
      const line = c.startPosition.row + 1
      const label = `${fn.text.replace(/\s+/g, "")}()`
      let target: Def | undefined
      if (fn.type === "identifier") {
        target = fileInfo.functions.get(fn.text)
        const imp = fileInfo.imports.get(fn.text)
        if (!target && imp && !imp.namespace) target = (await info(imp.file))?.functions.get(imp.name === "default" ? fn.text : imp.name)
      } else if (fn.type === "member_expression") {
        const obj = fn.childForFieldName("object")
        const prop = fn.childForFieldName("property")?.text
        if (obj && prop) {
          let cls: { file: string; cls: string } | undefined
          if (obj.type === "this" && d.cls) cls = { file: d.file, cls: d.cls }
          else if (obj.type === "member_expression" && obj.childForFieldName("object")?.type === "this" && d.fields) {
            const t = d.fields.get(obj.childForFieldName("property")!.text.replace(/^#/, ""))
            if (t) cls = await classByName(t, fileInfo)
          } else if (obj.type === "identifier") {
            const imp = fileInfo.imports.get(obj.text)
            if (imp?.namespace) target = (await info(imp.file))?.functions.get(prop)
            else {
              const t = locals.get(obj.text) ?? obj.text
              cls = await classByName(t, fileInfo)
            }
          }
          if (cls) target = infos.get(cls.file)?.classes.get(cls.cls)?.methods.get(prop)
        }
      }
      if (target) {
        const to = who(target)
        add(to)
        calls.push({ from: self, to, label, resolved: true, file: d.file, line })
        const key = `${target.file}#${target.cls ?? ""}.${target.name}`
        if (level < depth && !seen.has(key)) {
          seen.add(key)
          await walk(target, level + 1, self)
          if (to !== self) calls.push({ from: to, to: self, label: "return", resolved: true, file: target.file, line })
          seen.delete(key)
        }
      } else if (!/^(console|Math|JSON|Object|Array|Promise|String|Number|Date)\./.test(fn.text)) {
        // The language's own built-ins are left out; anything else that cannot be read is drawn and listed.
        add("Unresolved")
        calls.push({ from: self, to: "Unresolved", label, resolved: false, file: d.file, line })
      }
    }
    void from
  }
  seen.add(`${first.file}#${first.cls ?? ""}.${first.name}`)
  calls.push({ from: "Caller", to: who(first), label: `${entryName}()`, resolved: true, file: first.file, line: first.body.startPosition.row + 1 })
  await walk(first, 1, "Caller")
  const id = (p: string) => p.replace(/[^\w]/g, "_")
  const esc = (s: string) => s.replace(/[;#]/g, " ").replace(/[<>]/g, "")
  const mermaid = [
    "sequenceDiagram",
    ...participants.map((p) => `  participant ${id(p)} as ${esc(p)}`),
    ...calls.map((c) => (c.label === "return" ? `  ${id(c.from)}-->>${id(c.to)}: return` : `  ${id(c.from)}${c.resolved ? "->>" : "-x"}${id(c.to)}: ${esc(c.label)}${c.resolved ? "" : " (not resolved)"}`)),
  ].join("\n")
  return { entry, participants, calls, unresolved: calls.filter((c) => !c.resolved), mermaid }
}
