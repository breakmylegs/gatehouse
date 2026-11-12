/**
 * D-066 and D-006, characterisation capture and the behaviour diff (Frontier build, Wave 3). Code nothing tests is
 * risky to change, because nothing says what it did before. For such a JavaScript or TypeScript file, Codehouse writes
 * a small harness that calls each exported function with generated inputs and records what comes back (a value, or the
 * error it throws), as the file was at the checkpoint before the change; the outputs are redacted before they are kept
 * and replayed at once, so a capture is only kept when it replays the same (green). After the change the same inputs are
 * replayed against the file as it is now, and each output that changed is said in plain English.
 *
 * The harness runs as a Codehouse action (section 6): judged by your rules, with no credential, inside the session's
 * job, stopped by the kill switch, recorded. It runs in a sandbox copy of the project, never in your working tree.
 */
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import type { Node } from "web-tree-sitter"
import { makeSandbox, removeSandbox, TEST_FILE, type MutationExec } from "./mutation.js"
import { languageOf, parserFor } from "./outline.js"

export interface CaptureCase {
  fn: string
  args: unknown[]
  /** What it gave back: a value as JSON, or the error's name and message. */
  out: { value: unknown } | { error: string }
}

export interface Capture {
  v: 1
  file: string
  createdAt: string
  from: string
  cases: CaptureCase[]
}

/** The values each parameter is tried with: small, ordinary and edge. */
const POOL: unknown[] = [0, 1, -1, 42, 2.5, "", "a", "hello world", true, false, null, [], [1, 2, 3], {}, { a: 1 }]
const MAX_CASES = 60
const MARK = "@@codehouse-characterise@@"

/** The exported functions of a JavaScript or TypeScript file, with how many parameters each takes. */
export async function exportedFunctions(file: string, text: string): Promise<Array<{ name: string; arity: number }>> {
  const lang = languageOf(file)
  if (!lang || !["typescript", "tsx", "javascript"].includes(lang)) return []
  const tree = (await parserFor(lang as "typescript")).parse(text)
  if (!tree) return []
  const out: Array<{ name: string; arity: number }> = []
  const params = (n: Node | null) => (n ? n.namedChildren.filter((c) => c && c.type !== "comment").length : 0)
  try {
    for (const top of tree.rootNode.namedChildren) {
      if (!top || top.type !== "export_statement") continue
      const d = top.childForFieldName("declaration") ?? top.namedChildren.find((c) => c?.type === "function_declaration" || c?.type === "lexical_declaration") ?? null
      if (!d) continue
      if (d.type === "function_declaration" || d.type === "generator_function_declaration") {
        const name = d.childForFieldName("name")?.text
        if (name) out.push({ name, arity: params(d.childForFieldName("parameters")) })
      } else if (d.type === "lexical_declaration") {
        for (const v of d.namedChildren) {
          const value = v?.childForFieldName("value")
          if (v?.type === "variable_declarator" && value && (value.type === "arrow_function" || value.type === "function_expression" || value.type === "function")) {
            const name = v.childForFieldName("name")?.text
            const p = value.childForFieldName("parameters") ?? value.childForFieldName("parameter")
            if (name) out.push({ name, arity: p?.type === "identifier" ? 1 : params(p) })
          }
        }
      }
    }
  } finally {
    tree.delete()
  }
  return out
}

/** Whether any test file in the project names the file (by its name without extension): a rough "is it tested". */
export function looksUntested(root: string, file: string, testFiles: string[]): boolean {
  const base = path.basename(file).replace(/\.[cm]?[jt]sx?$/, "")
  return !testFiles.some((t) => {
    try {
      return new RegExp(`["'\`][^"'\`]*\\b${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\.[cm]?[jt]sx?)?["'\`]`).test(fs.readFileSync(path.join(root, t), "utf8"))
    } catch {
      return false
    }
  })
}

/** The inputs: for each function, its parameters tried with the pool, a value at a time, up to MAX_CASES in all. */
export function inputsFor(fns: Array<{ name: string; arity: number }>): Array<{ fn: string; args: unknown[] }> {
  const out: Array<{ fn: string; args: unknown[] }> = []
  const each = Math.max(4, Math.floor(MAX_CASES / Math.max(1, fns.length)))
  for (const f of fns) {
    const cases: unknown[][] = []
    if (f.arity === 0) cases.push([])
    else
      for (let i = 0; i < POOL.length && cases.length < each; i++)
        cases.push(Array.from({ length: f.arity }, (_, j) => POOL[(i + j * 3) % POOL.length]))
    for (const args of cases) out.push({ fn: f.name, args })
  }
  return out.slice(0, MAX_CASES)
}

/** The harness: imports the file, calls each case, prints one marked JSON line of results. */
function harness(moduleFile: string, inputs: Array<{ fn: string; args: unknown[] }>): string {
  return `const inputs = ${JSON.stringify(inputs)}
const mod = await import(${JSON.stringify(pathToFileURL(moduleFile).href)})
const out = []
for (const c of inputs) {
  const f = mod[c.fn] ?? mod.default?.[c.fn]
  try {
    let v = f(...structuredClone(c.args))
    if (v && typeof v.then === "function") v = await Promise.race([v, new Promise((_, no) => setTimeout(() => no(new Error("timed out")), 2000))])
    out.push({ value: v === undefined ? null : JSON.parse(JSON.stringify(v, (k, x) => (typeof x === "bigint" ? x.toString() : typeof x === "function" ? "[function]" : x)) ?? "null") })
  } catch (e) {
    out.push({ error: (e && e.name ? e.name + ": " : "") + String(e && e.message !== undefined ? e.message : e).slice(0, 300) })
  }
}
console.log(${JSON.stringify(MARK)} + JSON.stringify(out))
`
}

async function runCases(o: {
  root: string
  file: string
  text: string
  inputs: Array<{ fn: string; args: unknown[] }>
  exec: MutationExec
  sandbox: string
}): Promise<Array<CaptureCase["out"]>> {
  await makeSandbox(o.root, o.sandbox)
  try {
    const target = path.join(o.sandbox, o.file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, o.text)
    const script = path.join(o.sandbox, `.codehouse-characterise-${Date.now().toString(36)}.mjs`)
    fs.writeFileSync(script, harness(target, o.inputs))
    const r = await o.exec(`node ${JSON.stringify(path.basename(script)).slice(1, -1)}`, o.sandbox, 60_000)
    if (r.refused) throw new Error(`the harness was refused: ${r.refused}`)
    if (r.killed) throw new Error("the harness reached the session's memory cap")
    const line = r.output.split(/\r?\n/).find((l) => l.startsWith(MARK))
    if (!line) throw new Error(`the harness did not finish (${r.output.trim().split(/\r?\n/).slice(-1)[0]?.slice(0, 200) ?? "no output"})`)
    return JSON.parse(line.slice(MARK.length)) as Array<CaptureCase["out"]>
  } finally {
    removeSandbox(o.sandbox)
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** D-066: captures the file's behaviour as it was (the checkpoint's text), redacted, kept only when it replays green. */
export async function capture(o: {
  root: string
  file: string
  /** The file's text as it was before the change. */
  before: string
  from: string
  exec: MutationExec
  sandbox: (n: number) => string
  redact: (text: string) => string
  now?: () => Date
}): Promise<Capture> {
  if (TEST_FILE.test(o.file)) throw new Error("That is a test file.")
  const fns = await exportedFunctions(o.file, o.before)
  if (!fns.length) throw new Error("It exports no function Codehouse can call.")
  const inputs = inputsFor(fns)
  const first = await runCases({ root: o.root, file: o.file, text: o.before, inputs, exec: o.exec, sandbox: o.sandbox(1) })
  const again = await runCases({ root: o.root, file: o.file, text: o.before, inputs, exec: o.exec, sandbox: o.sandbox(2) })
  // Only what gives the same answer twice is behaviour; the rest (time, randomness) is left out.
  const cases: CaptureCase[] = []
  inputs.forEach((c, i) => {
    if (first[i] !== undefined && same(first[i], again[i])) cases.push({ fn: c.fn, args: c.args, out: first[i]! })
  })
  if (!cases.length) throw new Error("Nothing it returned was the same twice, so there is no behaviour to keep.")
  const redacted = JSON.parse(o.redact(JSON.stringify(cases))) as CaptureCase[]
  return { v: 1, file: o.file, createdAt: (o.now ?? (() => new Date()))().toISOString(), from: o.from, cases: redacted }
}

export interface BehaviourDelta {
  fn: string
  args: unknown[]
  before: CaptureCase["out"]
  now: CaptureCase["out"]
  /** In plain English. */
  words: string
}

const show = (v: unknown) => {
  const s = JSON.stringify(v)
  return s.length > 80 ? `${s.slice(0, 79)}…` : s
}
const said = (o: CaptureCase["out"]) => ("error" in o ? `threw ${o.error}` : `returned ${show(o.value)}`)

/** D-006: the captured inputs replayed against the file as it is now; each output that changed, in words. */
export async function behaviourDiff(o: {
  root: string
  capture: Capture
  now: string
  exec: MutationExec
  sandbox: string
  redact: (text: string) => string
}): Promise<BehaviourDelta[]> {
  const fns = new Set((await exportedFunctions(o.capture.file, o.now)).map((f) => f.name))
  const inputs = o.capture.cases.map((c) => ({ fn: c.fn, args: c.args }))
  const outs = await runCases({ root: o.root, file: o.capture.file, text: o.now, inputs, exec: o.exec, sandbox: o.sandbox })
  const deltas: BehaviourDelta[] = []
  o.capture.cases.forEach((c, i) => {
    const raw = fns.has(c.fn) ? outs[i] : { error: `${c.fn} is no longer exported` }
    const now = raw === undefined ? { error: "no answer" } : (JSON.parse(o.redact(JSON.stringify(raw))) as CaptureCase["out"])
    if (same(now, c.out)) return
    const call = `${c.fn}(${c.args.map(show).join(", ")})`
    deltas.push({ fn: c.fn, args: c.args, before: c.out, now, words: `${call} ${said(c.out)} before the change, and now ${said(now)}.` })
  })
  return deltas
}
