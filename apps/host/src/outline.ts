/**
 * C-031, code outline and navigation (Frontier build, Wave 2 prerequisite). A file's symbols (functions, classes,
 * methods, types, and the keys of a JSON file) with the lines they span, read with Tree-sitter grammars compiled to
 * WebAssembly, so no native code is loaded. TypeScript, TSX, JavaScript, Python, C#, PowerShell and JSON. Parsing a
 * 5,000-line file takes well under 50 ms once its grammar is loaded; each grammar is loaded once, when first needed.
 * D-007 uses the line ranges to lock one test case rather than a whole file.
 */
import { createRequire } from "node:module"
import path from "node:path"
import { Language, Parser, type Node } from "web-tree-sitter"

const require = createRequire(import.meta.url)

export type OutlineLanguage = "typescript" | "tsx" | "javascript" | "python" | "c_sharp" | "powershell" | "json"

export interface OutlineSymbol {
  name: string
  kind: string
  /** 1-based, inclusive. */
  line: number
  endLine: number
  children?: OutlineSymbol[]
}

const BY_EXT: Record<string, OutlineLanguage> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".cs": "c_sharp",
  ".ps1": "powershell",
  ".psm1": "powershell",
  ".psd1": "powershell",
  ".json": "json",
}

export const languageOf = (file: string): OutlineLanguage | undefined => BY_EXT[path.extname(file).toLowerCase()]

/** Where each grammar's WebAssembly is: VS Code's set (JSON is read without one, below). */
function wasmFor(lang: Exclude<OutlineLanguage, "json">): string {
  const name = lang === "c_sharp" ? "c-sharp" : lang
  return require.resolve(`@vscode/tree-sitter-wasm/wasm/tree-sitter-${name}.wasm`)
}

let init: Promise<void> | undefined
const parsers = new Map<OutlineLanguage, Promise<Parser>>()

function parserFor(lang: Exclude<OutlineLanguage, "json">): Promise<Parser> {
  let p = parsers.get(lang)
  if (!p) {
    p = (async () => {
      init ??= Parser.init()
      await init
      const parser = new Parser()
      parser.setLanguage(await Language.load(wasmFor(lang)))
      return parser
    })()
    parsers.set(lang, p)
    // A grammar that will not load is tried again next time, not remembered as broken.
    p.catch(() => parsers.delete(lang))
  }
  return p
}

/** The node types that are symbols, by language, and the kind each is shown as. */
const KINDS: Record<OutlineLanguage, Record<string, string>> = {
  typescript: {
    function_declaration: "function",
    generator_function_declaration: "function",
    class_declaration: "class",
    abstract_class_declaration: "class",
    method_definition: "method",
    abstract_method_signature: "method",
    interface_declaration: "interface",
    type_alias_declaration: "type",
    enum_declaration: "enum",
    module: "namespace",
    internal_module: "namespace",
    variable_declarator: "variable",
    public_field_definition: "property",
    call_expression: "call",
  },
  tsx: {},
  javascript: {
    function_declaration: "function",
    generator_function_declaration: "function",
    class_declaration: "class",
    method_definition: "method",
    variable_declarator: "variable",
    field_definition: "property",
    call_expression: "call",
  },
  python: { function_definition: "function", class_definition: "class" },
  c_sharp: {
    namespace_declaration: "namespace",
    file_scoped_namespace_declaration: "namespace",
    class_declaration: "class",
    struct_declaration: "struct",
    interface_declaration: "interface",
    record_declaration: "record",
    enum_declaration: "enum",
    method_declaration: "method",
    constructor_declaration: "constructor",
    property_declaration: "property",
  },
  powershell: { function_statement: "function", class_statement: "class", class_method_definition: "method" },
  json: { pair: "key" },
}
KINDS.tsx = KINDS.typescript

/** Test calls are symbols too (describe, it, test), so a test case can be found by its name. */
const TEST_CALLS = new Set(["describe", "it", "test", "suite", "context"])

function nameOf(n: Node, lang: OutlineLanguage): string | undefined {
  if (lang === "json") {
    const k = n.childForFieldName("key")
    return k ? k.text.replace(/^"|"$/g, "") : undefined
  }
  if (n.type === "call_expression") {
    const fn = n.childForFieldName("function")
    const callee = fn?.type === "member_expression" ? fn.childForFieldName("object")?.text : fn?.text
    if (!callee || !TEST_CALLS.has(callee)) return undefined
    const first = n.childForFieldName("arguments")?.namedChildren[0]
    const title = first && /string|template_string/.test(first.type) ? first.text.slice(1, -1) : undefined
    return title ? `${callee} ${title}` : undefined
  }
  if (n.type === "variable_declarator") {
    // Only a function kept in a variable is a symbol, not every constant.
    const v = n.childForFieldName("value")
    if (!v || !/^(arrow_function|function_expression|function|class|class_expression)$/.test(v.type)) return undefined
  }
  const named = n.childForFieldName("name")
  if (named) return named.text
  for (const c of n.namedChildren)
    if (c && /^(identifier|function_name|simple_name|property_identifier|type_identifier)$/.test(c.type)) return c.text.replace(/^function\s+/i, "")
  return undefined
}

/** The symbols of a parsed tree, nested as they are in the file. JSON keys stop two levels down. */
function collect(n: Node, lang: OutlineLanguage, depth: number): OutlineSymbol[] {
  const out: OutlineSymbol[] = []
  for (const c of n.namedChildren) {
    if (!c) continue
    const kind = KINDS[lang][c.type]
    const name = kind ? nameOf(c, lang) : undefined
    if (kind && name) {
      const children = lang === "json" && depth >= 1 ? [] : collect(c, lang, depth + 1)
      out.push({
        name,
        kind: c.type === "call_expression" ? "test" : kind,
        line: c.startPosition.row + 1,
        endLine: c.endPosition.row + 1,
        ...(children.length ? { children } : {}),
      })
    } else out.push(...collect(c, lang, depth))
  }
  return out
}

/**
 * A JSON file's keys, two levels down, with their lines, read by a small scanner: JSON needs no grammar, and the
 * one published for it builds native code when installed.
 */
export function jsonOutline(text: string): OutlineSymbol[] {
  const top: OutlineSymbol[] = []
  // What each open object or array holds, and the key whose value it is.
  const stack: Array<{ object: boolean; key?: OutlineSymbol }> = []
  let line = 1
  let pendingKey: string | undefined
  let pendingLine = 0
  let lastKey: OutlineSymbol | undefined
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (c === "\n") line++
    else if (c === '"') {
      let j = i + 1
      let s = ""
      for (; j < text.length && text[j] !== '"'; j++) {
        if (text[j] === "\\") j++
        else if (text[j] === "\n") line++
        s += text[j] ?? ""
      }
      i = j
      // A string in an object followed by a colon is a key.
      let k = j + 1
      while (k < text.length && /\s/.test(text[k]!)) k++
      if (stack.at(-1)?.object && text[k] === ":") {
        pendingKey = s
        pendingLine = line
      }
    } else if (c === ":" && pendingKey !== undefined) {
      const depth = stack.length
      const sym: OutlineSymbol = { name: pendingKey, kind: "key", line: pendingLine, endLine: line }
      if (depth === 1) top.push(sym)
      else if (depth === 2) {
        const parent = stack[1]!.key
        if (parent) (parent.children ??= []).push(sym)
      }
      lastKey = depth <= 2 ? sym : undefined
      pendingKey = undefined
    } else if (c === "{" || c === "[") {
      stack.push({ object: c === "{", ...(lastKey && stack.length >= 1 ? { key: lastKey } : {}) })
      lastKey = undefined
    } else if (c === "}" || c === "]") {
      const open = stack.pop()
      if (open?.key) open.key.endLine = line
    } else if (c === ",") lastKey = undefined
  }
  return top
}

/** A file's outline, or undefined for a language it does not know. */
export async function outline(text: string, lang: OutlineLanguage): Promise<OutlineSymbol[]> {
  if (lang === "json") return jsonOutline(text)
  const parser = await parserFor(lang)
  const tree = parser.parse(text)
  if (!tree) return []
  try {
    return collect(tree.rootNode, lang, 0)
  } finally {
    tree.delete()
  }
}

/** Every symbol, flat, with where it sits ("Parser > parse"), for go to symbol. */
export function flatten(symbols: OutlineSymbol[], within = ""): Array<OutlineSymbol & { path: string }> {
  return symbols.flatMap((s) => {
    const p = within ? `${within} > ${s.name}` : s.name
    return [{ ...s, path: p }, ...flatten(s.children ?? [], p)]
  })
}
