import { createRequire } from "node:module"
import { Language, Parser } from "web-tree-sitter"
import type { Node } from "web-tree-sitter"
import {
  baseCommandName,
  emptyAnalysis,
  mergeAnalysis,
  SHELL_NAMES,
  unwrapVariants,
  type Segment,
  type ShellAnalysis,
} from "./segments.js"
import { DYNAMIC_PLACEHOLDER } from "./paths.js"

const require = createRequire(import.meta.url)

let parserPromise: Promise<Parser> | undefined

async function getParser(): Promise<Parser> {
  parserPromise ??= (async () => {
    await Parser.init()
    const lang = await Language.load(require.resolve("tree-sitter-bash/tree-sitter-bash.wasm"))
    const parser = new Parser()
    parser.setLanguage(lang)
    return parser
  })()
  return parserPromise
}

interface StaticValue {
  /** Unquoted value with expansions replaced by a placeholder. */
  value: string
  /** Original source text, used when the token is dynamic. */
  display: string
  expansion: boolean
}

const EXPANSION_TYPES = new Set([
  "simple_expansion",
  "expansion",
  "command_substitution",
  "process_substitution",
  "arithmetic_expansion",
  "brace_expression",
])

function unescapeWord(text: string): string {
  return text.replace(/\\\r?\n/g, "").replace(/\\(.)/gs, "$1")
}

function unescapeDouble(text: string): string {
  return text.replace(/\\([\\"$`])/g, "$1")
}

function staticValue(node: Node): StaticValue {
  switch (node.type) {
    case "word":
    case "number": {
      const braces = /\{[^{}]*(,|\.\.)[^{}]*\}/.test(node.text)
      return {
        value: braces ? DYNAMIC_PLACEHOLDER : unescapeWord(node.text),
        display: node.text,
        expansion: braces,
      }
    }
    case "raw_string":
      return { value: node.text.slice(1, -1), display: node.text, expansion: false }
    case "ansi_c_string":
      return { value: node.text.slice(2, -1), display: node.text, expansion: false }
    case "string":
    case "translated_string": {
      let value = ""
      let expansion = false
      for (const child of node.children) {
        if (child.type === '"' || child.text === "$") continue
        if (EXPANSION_TYPES.has(child.type)) {
          expansion = true
          value += DYNAMIC_PLACEHOLDER
        } else if (child.type === "string_content") {
          value += unescapeDouble(child.text)
        } else {
          value += child.text
        }
      }
      return { value, display: node.text, expansion }
    }
    case "concatenation": {
      let value = ""
      let expansion = false
      for (const child of node.children) {
        const part = staticValue(child)
        value += part.value
        expansion ||= part.expansion
      }
      // The parser splits {a,b} into several words, so look at the whole token for brace expansion.
      if (/\{[^{}]*(,|\.\.)[^{}]*\}/.test(node.text)) {
        expansion = true
        value = DYNAMIC_PLACEHOLDER
      }
      return { value, display: node.text, expansion }
    }
    case "command_name": {
      const inner = node.firstNamedChild
      return inner ? staticValue(inner) : { value: node.text, display: node.text, expansion: false }
    }
    default:
      return {
        value: DYNAMIC_PLACEHOLDER,
        display: node.text,
        expansion: EXPANSION_TYPES.has(node.type) || node.type === "subshell",
      }
  }
}

const TOKEN_TYPES = new Set([
  "word",
  "string",
  "raw_string",
  "ansi_c_string",
  "translated_string",
  "concatenation",
  "number",
])

const OUTPUT_REDIRECT = /^\d*(>>|>\||&>>|&>|>&|>|<>)/
const FD_DUP = /^\d*(>&|<&)/

function leafCommandName(node: Node): string | undefined {
  if (node.type === "command") {
    const name = node.childForFieldName("name")
    return name ? staticValue(name).value : undefined
  }
  if (node.type === "redirected_statement") {
    const body = node.childForFieldName("body")
    return body ? leafCommandName(body) : undefined
  }
  return undefined
}

function isNullDevice(value: string): boolean {
  const v = value.replace(/\\/g, "/").toLowerCase()
  return v === "/dev/null" || v === "nul" || v === "$null"
}

function collectTokens(node: Node, out: ShellAnalysis): void {
  if (TOKEN_TYPES.has(node.type)) {
    const v = staticValue(node)
    out.tokens.push({ value: v.value, dynamic: v.expansion })
    for (const child of node.namedChildren) {
      if (EXPANSION_TYPES.has(child.type)) collectTokens(child, out)
    }
    return
  }
  for (const child of node.namedChildren) collectTokens(child, out)
}

function redirectWrites(redirect: Node): boolean {
  if (redirect.type !== "file_redirect") return false
  if (!OUTPUT_REDIRECT.test(redirect.text)) return false
  const dest = redirect.childForFieldName("destination")
  if (!dest) return true
  const v = staticValue(dest)
  if (FD_DUP.test(redirect.text) && /^(\d+|-)$/.test(v.value)) return false
  return v.expansion || !isNullDevice(v.value)
}

function buildSegment(
  node: Node,
  inheritedWrites: boolean,
  out: InternalAnalysis,
  depth: number,
): void {
  const nameNode = node.childForFieldName("name")
  const argNodes = node.childrenForFieldName("argument")
  const assignments = node.namedChildren.filter((c) => c.type === "variable_assignment")
  const ownRedirects = node.namedChildren.filter((c) => c.type === "file_redirect")

  let dynamic = false
  const assignText: string[] = []
  for (const a of assignments) {
    const valueNode = a.childForFieldName("value")
    if (valueNode) {
      const v = staticValue(valueNode)
      dynamic ||= v.expansion
    }
    assignText.push(a.text)
  }
  const nameVal = nameNode ? staticValue(nameNode) : undefined
  dynamic ||= nameVal?.expansion ?? false
  const name = nameVal ? (nameVal.expansion ? nameVal.display : nameVal.value) : ""
  const args: string[] = []
  const argsDynamic: boolean[] = []
  for (const arg of argNodes) {
    const v = staticValue(arg)
    dynamic ||= v.expansion
    args.push(v.expansion ? v.display : v.value)
    argsDynamic.push(v.expansion)
  }
  const writes = inheritedWrites || ownRedirects.some(redirectWrites)
  const coreText = [name, ...args].filter((s) => s.length > 0).join(" ")
  const text = [...assignText, coreText].filter((s) => s.length > 0).join(" ")
  const segment: Segment = {
    kind: "bash",
    text,
    coreText,
    name,
    args,
    dynamic,
    writes,
    piped: out.pipedIds.has(node.id),
  }
  out.segments.push(segment)

  const base = baseCommandName(name)
  if (
    (SHELL_NAMES.has(base) || base === "source" || name === ".") &&
    argNodes.some((a) => a.type === "process_substitution")
  ) {
    out.flags.pipeToShell = true
  }
  if (base === "eval") {
    if (argsDynamic.some(Boolean) || nameVal?.expansion) out.flags.evalDynamic = true
    else out.flags.evalStatic = true
  }
  if (["bash", "sh", "zsh", "dash", "ksh", "ash"].includes(base)) {
    const idx = args.findIndex((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a))
    if (idx >= 0 && idx + 1 < args.length) {
      if (argsDynamic[idx + 1]) {
        out.flags.evalDynamic = true
      } else if (depth >= 3) {
        out.flags.evalDynamic = true
      } else {
        out.pendingPayloads.push({ text: args[idx + 1] ?? "", depth: depth + 1 })
      }
    }
  }
}

interface InternalAnalysis extends ShellAnalysis {
  pendingPayloads: { text: string; depth: number }[]
  pipedIds: Set<number>
}

function visit(node: Node, out: InternalAnalysis, depth: number, inheritedWrites: boolean): void {
  switch (node.type) {
    case "command":
      buildSegment(node, inheritedWrites, out, depth)
      break
    case "redirected_statement": {
      const redirects = node.namedChildren.filter(
        (c) => c.type === "file_redirect" || c.type === "heredoc_redirect" || c.type === "herestring_redirect",
      )
      const writes = inheritedWrites || redirects.some(redirectWrites)
      if (redirects.some((r) => r.type === "heredoc_redirect")) out.flags.heredoc = true
      const redirectIds = new Set(redirects.map((r) => r.id))
      for (const child of node.namedChildren) {
        if (redirectIds.has(child.id)) visitRedirectInner(child, out, depth)
        else visit(child, out, depth, writes)
      }
      return
    }
    case "heredoc_redirect":
      out.flags.heredoc = true
      break
    case "pipeline": {
      const parts = node.namedChildren
      for (let i = 1; i < parts.length; i++) {
        const part = parts[i]
        if (!part) continue
        const cmd = part.type === "redirected_statement" ? part.childForFieldName("body") : part
        if (cmd) out.pipedIds.add(cmd.id)
      }
      break
    }
    default:
      break
  }
  for (const child of node.namedChildren) visit(child, out, depth, inheritedWrites)
}

function visitRedirectInner(redirect: Node, out: InternalAnalysis, depth: number): void {
  for (const child of redirect.namedChildren) visit(child, out, depth, false)
}

/** Parses bash text and collects every simple command plus risk flags. Never throws on bad input. */
export async function analyseBash(source: string, depth = 0): Promise<ShellAnalysis> {
  const parser = await getParser()
  const tree = parser.parse(source)
  const result = emptyAnalysis() as InternalAnalysis
  result.pendingPayloads = []
  result.pipedIds = new Set<number>()
  if (!tree) {
    result.parseError = true
    return stripInternal(result)
  }
  try {
    const root = tree.rootNode
    if (root.hasError) result.parseError = true
    visit(root, result, depth, false)
    collectTokens(root, result)
  } finally {
    tree.delete()
  }
  for (const seg of result.segments) {
    if (!seg.piped) continue
    for (const variant of unwrapVariants(seg)) {
      const first = variant.split(" ")[0] ?? ""
      if (SHELL_NAMES.has(baseCommandName(first))) result.flags.pipeToShell = true
    }
  }
  const pending = result.pendingPayloads.splice(0)
  for (const payload of pending) {
    mergeAnalysis(result, await analyseBash(payload.text, payload.depth))
  }
  return stripInternal(result)
}

function stripInternal(result: InternalAnalysis): ShellAnalysis {
  const { segments, tokens, flags, parseError, pwshPayloads } = result
  return { segments, tokens, flags, parseError, pwshPayloads }
}
