/**
 * D-004, a diff-scoped mutation gate (Frontier build, Wave 2). Do the tests notice when the lines a change added are
 * wrong? Each mutant changes one thing on a changed line (=== to !==, < to >=, + to -, && to ||, true to false, ! taken
 * away) and the project's tests run against it; a mutant the tests still pass with has survived, so nothing tests that
 * line properly. The score is the share killed, against an optional threshold per project.
 *
 * StrykerJS or Stryker.NET is named when the project has it (D-004 detects both), and the run then uses Codehouse's own
 * mutator for JavaScript and TypeScript, which needs no network and nothing installed. Mutants are made in a sandbox
 * copy of the project (its dependency folders linked, never copied or changed), never in your working tree. Each test
 * run is a Codehouse action (section 6): judged by your rules, with no credential, inside the session's job, stopped by
 * the kill switch, recorded. A run that hits the memory cap stops cleanly and says so. Recorded as mutation_run.
 */
import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import type { Node } from "web-tree-sitter"
import { languageOf, parserFor } from "./outline.js"

export type MutationTool = "stryker-js" | "stryker-net" | "built-in"

export interface Mutant {
  file: string
  line: number
  original: string
  mutated: string
  /** Character offsets of the replaced text in the file. */
  start: number
  end: number
  replacement: string
}

export interface MutationReport {
  tool: MutationTool
  /** Stryker was found, but its own run is not what this used. */
  detected?: "stryker-js" | "stryker-net"
  command: string
  mutants: number
  killed: number
  survived: Array<Omit<Mutant, "start" | "end" | "replacement">>
  /** Killed share, 0 to 100, or undefined when there were no mutants. */
  score?: number
  threshold?: number
  passed?: boolean
  /** Set when the run stopped before the end: the memory cap, the kill switch, a refusal, or tests that fail anyway. */
  aborted?: string
  ms: number
}

export type MutationExec = (
  command: string,
  cwd: string,
  timeoutMs: number,
) => Promise<{ exitCode: number | null; output: string; timedOut: boolean; refused?: string; killed?: boolean }>

/** Which Stryker the project has, if any. */
export function detectStryker(root: string): "stryker-js" | "stryker-net" | undefined {
  const has = (f: string) => fs.existsSync(path.join(root, f))
  if (["stryker.conf.json", "stryker.conf.js", "stryker.conf.mjs", "stryker.config.json", "stryker.config.mjs"].some(has)) return "stryker-js"
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { devDependencies?: Record<string, string>; dependencies?: Record<string, string> }
    if ({ ...pkg.dependencies, ...pkg.devDependencies }["@stryker-mutator/core"]) return "stryker-js"
  } catch {
    // No package.json.
  }
  try {
    if (/dotnet-stryker/i.test(fs.readFileSync(path.join(root, ".config", "dotnet-tools.json"), "utf8"))) return "stryker-net"
  } catch {
    // No tool manifest.
  }
  return undefined
}

const SWAP: Record<string, string> = {
  "===": "!==",
  "!==": "===",
  "==": "!=",
  "!=": "==",
  "<": ">=",
  ">=": "<",
  ">": "<=",
  "<=": ">",
  "+": "-",
  "-": "+",
  "*": "/",
  "/": "*",
  "&&": "||",
  "||": "&&",
}

/** A test file: under test, tests, __tests__ or spec, or named .test or .spec. */
export const TEST_FILE = /(^|[\\/])(test|tests|__tests__|spec)[\\/]|\.(test|spec)\.[cm]?[jt]sx?$|(^|[\\/])test_[^\\/]+\.py$|_test\.(py|go)$|Tests?\.cs$/i

/** The mutants on the given lines of one JavaScript or TypeScript file. Test files are not mutated. */
export async function mutantsOf(file: string, text: string, lines: ReadonlySet<number>, max = 40): Promise<Mutant[]> {
  const lang = languageOf(file)
  if (!lang || !["typescript", "tsx", "javascript"].includes(lang) || TEST_FILE.test(file)) return []
  const parser = await parserFor(lang as "typescript")
  const tree = parser.parse(text)
  if (!tree) return []
  const out: Mutant[] = []
  const on = (n: Node) => lines.has(n.startPosition.row + 1)
  const lineText = (row: number) => text.split(/\r?\n/)[row] ?? ""
  const add = (n: Node, start: number, end: number, replacement: string) => {
    if (out.length >= max) return
    const row = n.startPosition.row
    const line = lineText(row)
    const col = start - (text.lastIndexOf("\n", start - 1) + 1)
    out.push({
      file,
      line: row + 1,
      original: line.trim(),
      mutated: (line.slice(0, col) + replacement + line.slice(col + (end - start))).trim(),
      start,
      end,
      replacement,
    })
  }
  const walk = (n: Node) => {
    if (on(n)) {
      if (n.type === "binary_expression") {
        const op = n.childForFieldName("operator")
        if (op && SWAP[op.type]) add(n, op.startIndex, op.endIndex, SWAP[op.type]!)
      } else if (n.type === "true" || n.type === "false") add(n, n.startIndex, n.endIndex, n.type === "true" ? "false" : "true")
      else if (n.type === "unary_expression" && n.childForFieldName("operator")?.type === "!") {
        const op = n.childForFieldName("operator")!
        add(n, op.startIndex, op.endIndex, "")
      }
    }
    for (const c of n.namedChildren) if (c) walk(c)
  }
  try {
    walk(tree.rootNode)
  } finally {
    tree.delete()
  }
  return out
}

/** Folders a sandbox links to rather than copies: dependencies, which a mutant never touches. */
const LINKED = ["node_modules", ".venv", "venv", "packages/node_modules"]

/** Lists the project's files as git sees them (tracked and new, not ignored). */
function listFiles(root: string): Promise<string[]> {
  return new Promise((resolve, reject) =>
    execFile("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: root, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (e, out) =>
      e ? reject(e) : resolve(String(out).split("\0").filter(Boolean)),
    ),
  )
}

/** A copy of the project to mutate in, with its dependency folders linked. Removed with removeSandbox. */
export async function makeSandbox(root: string, dir: string): Promise<void> {
  fs.mkdirSync(dir, { recursive: true })
  for (const rel of await listFiles(root)) {
    const from = path.join(root, rel)
    const to = path.join(dir, rel)
    try {
      if (!fs.lstatSync(from).isFile()) continue
    } catch {
      continue
    }
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
  }
  for (const d of LINKED) {
    const from = path.join(root, d)
    if (fs.existsSync(from) && !fs.existsSync(path.join(dir, d))) fs.symlinkSync(from, path.join(dir, d), "junction")
  }
}

/** Removes a sandbox: its links first, by themselves, so nothing they point to is touched; then the copy. */
export function removeSandbox(dir: string): void {
  for (const d of LINKED) {
    const p = path.join(dir, d)
    try {
      if (fs.lstatSync(p).isSymbolicLink()) fs.unlinkSync(p)
    } catch {
      // not there
    }
  }
  fs.rmSync(dir, { recursive: true, force: true })
}

export async function runMutation(o: {
  root: string
  /** The changed files and their added lines, from the checkpoint. */
  changes: Array<{ path: string; text: string; lines: ReadonlySet<number> }>
  command: string
  exec: MutationExec
  sandbox: string
  threshold?: number
  timeoutMs?: number
  maxMutants?: number
  /** D-005: only the mutants this keeps (the one a task was asked to kill). */
  only?: (m: Mutant) => boolean
}): Promise<MutationReport> {
  const started = Date.now()
  const detected = detectStryker(o.root)
  const base = { tool: "built-in" as const, ...(detected ? { detected } : {}), command: o.command, ...(o.threshold !== undefined ? { threshold: o.threshold } : {}) }
  const mutants: Mutant[] = []
  for (const c of o.changes) mutants.push(...(await mutantsOf(c.path, c.text, c.lines, (o.maxMutants ?? 40) - mutants.length)))
  if (o.only) mutants.splice(0, mutants.length, ...mutants.filter(o.only))
  if (!mutants.length) return { ...base, mutants: 0, killed: 0, survived: [], ms: Date.now() - started }
  await makeSandbox(o.root, o.sandbox)
  const timeout = o.timeoutMs ?? 120_000
  const stop = (aborted: string, killed: number, survived: MutationReport["survived"], tried: number) => ({ ...base, mutants: tried, killed, survived, aborted, ms: Date.now() - started })
  try {
    // The tests must pass as the change stands, or a mutant proves nothing.
    const clean = await o.exec(o.command, o.sandbox, timeout)
    if (clean.refused) return stop(`the test command was refused: ${clean.refused}`, 0, [], 0)
    if (clean.killed) return stop("the run reached the session's memory cap, so it stopped", 0, [], 0)
    if (clean.exitCode !== 0) return stop("the tests fail without any mutant, so there is nothing to measure", 0, [], 0)
    let killed = 0
    const survived: MutationReport["survived"] = []
    for (const [i, m] of mutants.entries()) {
      const file = path.join(o.sandbox, m.file)
      const text = fs.readFileSync(file, "utf8")
      fs.writeFileSync(file, text.slice(0, m.start) + m.replacement + text.slice(m.end))
      try {
        const r = await o.exec(o.command, o.sandbox, timeout)
        if (r.refused) return stop(`a test run was refused: ${r.refused}`, killed, survived, i)
        if (r.killed) return stop("the run reached the session's memory cap, so it stopped", killed, survived, i)
        // A mutant that makes the tests time out has been noticed too.
        if (r.exitCode === 0 && !r.timedOut) survived.push({ file: m.file, line: m.line, original: m.original, mutated: m.mutated })
        else killed++
      } finally {
        fs.writeFileSync(file, text)
      }
    }
    const score = Math.round((killed / mutants.length) * 100)
    return {
      ...base,
      mutants: mutants.length,
      killed,
      survived,
      score,
      ...(o.threshold !== undefined ? { passed: score >= o.threshold } : {}),
      ms: Date.now() - started,
    }
  } finally {
    removeSandbox(o.sandbox)
  }
}

/** D-005: the task a survivor starts, and the rule that keeps it to test files. */
export const TEST_SCOPE_RULE = "test-scope"

export type Survivor = MutationReport["survived"][number]

export const mutantTaskPrompt = (s: Survivor) =>
  `Codehouse changed one thing in ${s.file} at line ${s.line} and every test still passed:\n\n  ${s.original}\nbecame\n  ${s.mutated}\n\nWrite a test that fails with that change and passes without it. Change only test files: an edit to any other file comes to the person first. When you have finished, Codehouse runs the tests against that change again.`

export const testScopeReason = (file: string, s: Survivor) =>
  `This session is writing a test for a surviving mutant (${s.file}, line ${s.line}), so it should change only test files. ${file} is not one, so this comes to you.`
