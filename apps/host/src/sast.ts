/**
 * D-062, local static analysis of what an agent changed (Frontier build, Wave 2). The lines a change adds are read with
 * the Tree-sitter grammars C-031 loads (TypeScript, TSX, JavaScript, Python, C#, PowerShell), on this computer, for six
 * kinds of mistake that are easy to make and costly to ship: SQL built from strings, shell commands built from input,
 * eval of what is not a literal, TLS checks switched off, weak cryptography, and file paths taken from a request. Each
 * finding names the file, the line and the kind, and is shown in Changes; a Severe one escalates the session's next
 * commit, and Extreme approval does not approve it. Nothing runs: the code is only parsed.
 */
import fs from "node:fs"
import path from "node:path"
import type { Node } from "web-tree-sitter"
import { commitAdditions, git, makesCommit, type Git } from "./commit-scan.js"
import { languageOf, parserFor } from "./outline.js"

export const SAST_RULE = "sast-severe"

export type SastKind = "sql" | "shell" | "eval" | "tls" | "crypto" | "path"
export type SastSeverity = "Severe" | "High"

export interface SastFinding {
  file: string
  line: number
  kind: SastKind
  severity: SastSeverity
  title: string
}

const TITLES: Record<SastKind, string> = {
  sql: "SQL built from strings",
  shell: "A shell command built from input",
  eval: "Code run from a string",
  tls: "TLS certificate checks switched off",
  crypto: "Weak cryptography",
  path: "A file path taken from a request",
}

const SQL = /\b(select\b[\s\S]+\bfrom|insert\s+into|update\s+[\w."[\]`]+\s+set|delete\s+from|drop\s+table|where\s+[\w."`]+\s*(=|like|in)\b)/i
const QUERY_CALLS = /^(query|execute|executemany|executescript|exec|raw|rawquery|prepare|executesql|executesqlraw|executesqlrawasync|fromsqlraw|sqlquery|unsafe|queryraw|queryrawunsafe|executerawunsafe)$/i
const SHELL_CALLS = /^(exec|execsync|system|popen|shell_exec|passthru|getoutput|getstatusoutput)$/i
const SUBPROCESS_CALLS = /^(run|call|popen|check_output|check_call|spawn|spawnsync|execfile|execfilesync|start)$/i
const FILE_CALLS = /^(join|resolve|readfile|readfilesync|createreadstream|createwritestream|sendfile|download|writefile|writefilesync|open|unlink|unlinksync|rm|rmsync|readalltext|readallbytes|writealltext|combine|openread|delete|send_file|send_from_directory)$/i
const FROM_REQUEST = /\b(req|request)\.(params|query|body|args|form|files|values|GET|POST|path_params|query_params)\b|\bRequest\.(Query|Form|RouteValues|Headers)\b/
const WEAK_ALGS = /^['"`](md4|md5|sha1|sha-1|des|des-ede|des-ede3|des-cbc|rc2|rc4|bf|blowfish)['"`]$/i
const WEAK_TYPES = /\b(MD5|SHA1|MD5CryptoServiceProvider|SHA1CryptoServiceProvider|SHA1Managed|DES|DESCryptoServiceProvider|TripleDESCryptoServiceProvider|RC2|RC2CryptoServiceProvider)\b/

const CALLS = new Set(["call_expression", "call", "invocation_expression", "new_expression", "object_creation_expression"])

function callee(n: Node): Node | null {
  return n.childForFieldName("function") ?? n.childForFieldName("constructor") ?? n.childForFieldName("type")
}

/** The last name of a callee: exec for child_process.exec, Combine for Path.Combine. */
const lastName = (t: string) => t.replace(/\?\./g, ".").split(/[.:]/).pop()!.replace(/\s|\(.*$/g, "")

function args(n: Node): Node[] {
  const a = n.childForFieldName("arguments")
  if (!a) return []
  // C#'s argument nodes hold the expression.
  return a.namedChildren.filter((c): c is Node => !!c).map((c) => (c.type === "argument" ? (c.namedChildren.at(-1) ?? c) : c))
}

const literal = (n: Node) => /^(string|string_literal|verbatim_string_literal|raw_string_literal|template_string)$/.test(n.type) && !built(n)

/** Whether an expression builds a string from pieces that are not all literals. */
function built(n: Node): boolean {
  switch (n.type) {
    case "template_string":
      return n.descendantsOfType("template_substitution").length > 0
    case "string":
      // A Python f-string.
      return n.descendantsOfType("interpolation").length > 0
    case "interpolated_string_expression":
      return n.descendantsOfType("interpolation").length > 0
    case "binary_expression":
    case "binary_operator": {
      const op = n.childForFieldName("operator")?.text ?? n.children.find((c) => c && /^[+%]$/.test(c.type))?.type
      if (op !== "+" && op !== "%") return false
      const parts = [n.childForFieldName("left"), n.childForFieldName("right")].filter((c): c is Node => !!c)
      const stringy = parts.some((p) => /string/.test(p.type) || built(p))
      return stringy && parts.some((p) => !literal(p) && !/^(number|integer|float)$/.test(p.type))
    }
    case "call": {
      // Python's "...".format(x)
      const f = n.childForFieldName("function")
      return !!f && f.type === "attribute" && /\.format$/.test(f.text) && /string/.test(f.namedChildren[0]?.type ?? "")
    }
    case "parenthesized_expression":
      return n.namedChildren.some((c) => !!c && built(c))
    default:
      return false
  }
}

function keyed(n: Node): { key: string; value: Node } | undefined {
  if (n.type === "pair") {
    const k = n.childForFieldName("key")
    const v = n.childForFieldName("value")
    return k && v ? { key: k.text.replace(/['"`]/g, ""), value: v } : undefined
  }
  if (n.type === "keyword_argument") {
    const k = n.childForFieldName("name")
    const v = n.childForFieldName("value")
    return k && v ? { key: k.text, value: v } : undefined
  }
  if (n.type === "assignment_expression" || n.type === "assignment") {
    const k = n.childForFieldName("left")
    const v = n.childForFieldName("right")
    return k && v ? { key: k.text, value: v } : undefined
  }
  return undefined
}

const falsy = (v: Node) => /^(false|False)$/.test(v.text) || v.text === "0" || /^['"]0['"]$/.test(v.text)

/** One node's findings. */
function check(n: Node, add: (kind: SastKind, severity: SastSeverity, at?: Node) => void): void {
  // TLS switched off: rejectUnauthorized: false, verify=False, NODE_TLS_REJECT_UNAUTHORIZED = "0", a validation
  // callback that answers true, and the names that say it outright.
  const kv = keyed(n)
  if (kv) {
    if (/(^|\.)rejectUnauthorized$/.test(kv.key) && falsy(kv.value)) add("tls", "Severe")
    else if (kv.key === "verify" && n.type === "keyword_argument" && falsy(kv.value)) add("tls", "Severe")
    else if (/NODE_TLS_REJECT_UNAUTHORIZED/.test(kv.key) && falsy(kv.value)) add("tls", "Severe")
    else if (/(ServerCertificateCustomValidationCallback|ServerCertificateValidationCallback|RemoteCertificateValidationCallback)$/.test(kv.key) && /=>\s*true\b|\breturn\s+true\b/.test(kv.value.text))
      add("tls", "Severe")
    else if (/(^|\.)check_hostname$/.test(kv.key) && /^(False|false)$/.test(kv.value.text)) add("tls", "Severe")
  }
  if ((n.type === "identifier" || n.type === "property_identifier" || n.type === "attribute") && /^(DangerousAcceptAnyServerCertificateValidator|_create_unverified_context|CERT_NONE)$/.test(n.text.split(".").pop() ?? ""))
    add("tls", "Severe")

  // PowerShell's Invoke-Expression.
  if (n.type === "command") {
    const name = n.childForFieldName("command_name")?.text ?? n.namedChildren[0]?.text ?? ""
    if (/^(invoke-expression|iex)$/i.test(name)) add("eval", n.text.includes("$") ? "Severe" : "High")
    return
  }

  if (!CALLS.has(n.type)) return
  const fn = callee(n)
  const name = fn ? lastName(fn.text) : ""
  const a = args(n)
  const first = a[0]

  // SQL built from strings, at once into a query call: Severe; built elsewhere it is found where it is built.
  if (QUERY_CALLS.test(name) && first && built(first) && SQL.test(first.text)) add("sql", "Severe", first)

  // A shell command built from input.
  const shellTrue = a.some((x) => {
    const k = keyed(x)
    if (k?.key === "shell" && /^(true|True)$/.test(k.value.text)) return true
    return x.type === "object" && x.namedChildren.some((p) => !!p && keyed(p)?.key === "shell" && /^true$/.test(keyed(p)!.value.text))
  })
  if (first && built(first) && (SHELL_CALLS.test(name) || (SUBPROCESS_CALLS.test(name) && shellTrue)) && !/^(re|regex|regexp)\b/i.test(fn?.text ?? ""))
    add("shell", "Severe", first)

  // eval of what is not a literal.
  // Python's exec runs code; JavaScript's exec is child_process's, a shell call, above.
  if ((fn?.text === "eval" || (fn?.text === "exec" && n.type === "call") || fn?.text === "Function") && first)
    add("eval", literal(first) ? "High" : "Severe")

  // Weak cryptography.
  if (/^(createHash|createHmac|createCipheriv|createDecipheriv|getHashes|new)$/.test(name) && first && WEAK_ALGS.test(first.text)) add("crypto", "High")
  else if (/^(createCipher|createDecipher)$/.test(name)) add("crypto", "High")
  else if (fn && /^hashlib\.(md5|sha1)$|^(Crypto\.Cipher\.)?(DES|ARC4|Blowfish)\.new$/.test(fn.text)) add("crypto", "High")
  else if (fn && /^(Create)$/.test(name) && WEAK_TYPES.test(fn.text)) add("crypto", "High")
  else if (n.type === "object_creation_expression" && fn && WEAK_TYPES.test(fn.text)) add("crypto", "High")

  // A file path taken from a request.
  if (FILE_CALLS.test(name) && a.some((x) => FROM_REQUEST.test(x.text))) add("path", "High")
}

/** The findings in a file's text, only on the lines given (1-based) when they are given. */
export async function scanSource(file: string, text: string, lines?: ReadonlySet<number>): Promise<SastFinding[]> {
  const lang = languageOf(file)
  if (!lang || lang === "json") return []
  const parser = await parserFor(lang)
  const tree = parser.parse(text)
  if (!tree) return []
  const out: SastFinding[] = []
  const seen = new Set<string>()
  const walk = (n: Node) => {
    check(n, (kind, severity, at) => {
      const line = (at ?? n).startPosition.row + 1
      const endLine = (at ?? n).endPosition.row + 1
      if (lines && ![...Array(endLine - line + 1).keys()].some((i) => lines.has(line + i))) return
      const key = `${kind}:${line}`
      if (seen.has(key)) return
      seen.add(key)
      out.push({ file, line, kind, severity, title: TITLES[kind] })
    })
    for (const c of n.namedChildren) if (c) walk(c)
  }
  try {
    walk(tree.rootNode)
  } finally {
    tree.delete()
  }
  return out.sort((x, y) => x.line - y.line)
}

/** The lines a unified diff adds, by file (+++ b/path), or for its one file when it names none. */
export function addedLines(diff: string): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>()
  let file = ""
  let at: number | undefined
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++ ")) {
      file = line.slice(4).replace(/^b\//, "")
      at = undefined
      continue
    }
    if (line.startsWith("--- ")) continue
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (h) {
      at = Number(h[1])
      continue
    }
    if (at === undefined || line.startsWith("-") || line.startsWith("\\")) continue
    if (line.startsWith("+")) {
      if (!out.has(file)) out.set(file, new Set())
      out.get(file)!.add(at)
    }
    at++
  }
  return out
}

/** Files larger than this are not read; a change rarely adds one, and parsing it would hold the commit up. */
const MAX_FILE = 1024 * 1024
const MAX_FILES = 200

/**
 * What a session's commit would add, analysed: the added lines of each changed file, and each new file `git add` in
 * the same command would pick up. Throws when the commit cannot be read, so the caller asks a person (fail closed).
 */
export async function scanCommitSast(cwd: string, command: string, run: Git = git): Promise<SastFinding[]> {
  if (!makesCommit("Bash", { command })) return []
  const { diff, untracked } = await commitAdditions(cwd, command, run)
  const top = (await run(cwd, ["rev-parse", "--show-toplevel"])).trim() || cwd
  const files: Array<{ rel: string; abs: string; lines?: Set<number> }> = [
    ...[...addedLines(diff)].map(([rel, lines]) => ({ rel, abs: path.join(top, rel), lines })),
    ...untracked.map((rel) => ({ rel, abs: path.join(cwd, rel) })),
  ].filter((f) => languageOf(f.rel) && languageOf(f.rel) !== "json")
  const out: SastFinding[] = []
  for (const f of files.slice(0, MAX_FILES)) {
    let text: string
    try {
      const st = fs.lstatSync(f.abs)
      if (!st.isFile() || st.size > MAX_FILE) continue
      text = fs.readFileSync(f.abs, "utf8")
    } catch {
      continue
    }
    out.push(...(await scanSource(f.rel, text, f.lines)))
  }
  return out
}

/** Why the commit waits for you, naming each Severe finding by file and line. */
export function sastReason(found: SastFinding[]): string {
  const list = found
    .slice(0, 5)
    .map((f) => `${f.title.toLowerCase()} in ${f.file}${f.line ? `, line ${f.line}` : ""}`)
    .join("; ")
  return `This commit adds code Codehouse's local analysis rates Severe (${list}${found.length > 5 ? `; and ${found.length - 5} more` : ""}). Look at it in Changes before it is committed.`
}

/**
 * Each session's commit checks, kept for ten seconds by command, so the floor hook and canUseTool read a commit once.
 */
export class SastCommitGuard {
  readonly #cache = new Map<string, { at: number; found: Promise<SastFinding[]> }>()
  readonly #run: Git
  readonly #now: () => number

  constructor(o: { run?: Git; now?: () => number } = {}) {
    this.#run = o.run ?? git
    this.#now = o.now ?? Date.now
  }

  /** The Severe findings in what the commit would add. Rejects when it cannot be read. */
  severe(cwd: string, command: string): Promise<SastFinding[]> {
    const key = `${cwd}\n${command}`
    const hit = this.#cache.get(key)
    if (hit && this.#now() - hit.at < 10_000) return hit.found
    const found = scanCommitSast(cwd, command, this.#run).then((f) => f.filter((x) => x.severity === "Severe"))
    this.#cache.set(key, { at: this.#now(), found })
    found.catch(() => this.#cache.delete(key))
    return found
  }
}
