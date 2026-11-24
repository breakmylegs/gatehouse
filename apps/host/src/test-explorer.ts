/**
 * G38 (owner's connector items, 9 Nov): the test explorer. A project's tests, listed per file by reading the files (never
 * by running anything), for the runners it uses: Vitest, Jest, pytest and dotnet test. Run, for a file or one test,
 * starts the project's own runner as you would in the terminal: your action, so it does not pass the Approver, but it
 * is audited first, refused while the kill switch is engaged, run without a shell, and only from what the project
 * already has (its own node_modules; never an npx download). A failure carries its line, so it opens there, and
 * Fix this puts a scoped task in the session's prompt box for you to send.
 */
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { sanitiseEnv, type Verdict } from "@gatehouse/shared"
import type { HostAudit } from "./hostaudit.js"

export type Runner = "vitest" | "jest" | "pytest" | "dotnet"
export interface TestCase {
  name: string
  line: number
}
export interface TestFile {
  file: string
  runner: Runner
  tests: TestCase[]
}
export interface TestResult {
  file: string
  name: string
  status: "passed" | "failed" | "skipped"
  message?: string
  line?: number
}
export interface RunOutcome {
  runner: Runner
  results: TestResult[]
  exitCode: number | null
  timedOut: boolean
  /** The end of what the runner printed, for when it could not report (it did not start, or crashed). */
  tail: string
}

export class TestRunError extends Error {}

/** Longest a run may take before it is stopped. */
export const RUN_TIMEOUT_MS = 10 * 60_000
const MAX_FILES = 2000
const MAX_FILE_BYTES = 1_000_000
const MAX_MESSAGE = 4000

const JS_TEST = /\.(test|spec)\.[cm]?[jt]sx?$/
const PY_TEST = /(^|\/)(test_[^/]*|[^/]*_test)\.py$/
const CS_TEST = /\.cs$/

const readJson = (p: string): Record<string, unknown> | undefined => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>
  } catch {
    return undefined
  }
}

/** The runners a project uses, from its own files: package.json, pytest's settings, a test project. */
export function detectRunners(root: string, files: readonly string[] = []): Runner[] {
  const out = new Set<Runner>()
  const pkg = readJson(path.join(root, "package.json"))
  if (pkg) {
    const deps = { ...(pkg.dependencies as object), ...(pkg.devDependencies as object) } as Record<string, unknown>
    const scripts = Object.values((pkg.scripts as Record<string, unknown>) ?? {}).join(" ")
    if ("vitest" in deps || /\bvitest\b/.test(scripts)) out.add("vitest")
    if ("jest" in deps || /\bjest\b/.test(scripts)) out.add("jest")
  }
  const has = (f: string) => fs.existsSync(path.join(root, f))
  const pyproject = has("pyproject.toml") ? fs.readFileSync(path.join(root, "pyproject.toml"), "utf8") : ""
  if (has("pytest.ini") || has("conftest.py") || /\[tool\.pytest/.test(pyproject) || files.some((f) => PY_TEST.test(f))) out.add("pytest")
  for (const f of files) {
    if (!f.endsWith(".csproj")) continue
    const text = safeRead(path.join(root, f))
    if (/Microsoft\.NET\.Test\.Sdk|<IsTestProject>\s*true/i.test(text)) {
      out.add("dotnet")
      break
    }
  }
  return [...out]
}

function safeRead(p: string): string {
  try {
    const st = fs.statSync(p)
    return st.size > MAX_FILE_BYTES ? "" : fs.readFileSync(p, "utf8")
  } catch {
    return ""
  }
}

const lineAt = (text: string, index: number) => text.slice(0, index).split("\n").length

/** it("..."), test("..."), with .only, .skip, .each; describe names prefix them, as the runners show them. */
export function parseJsTests(text: string): TestCase[] {
  const out: TestCase[] = []
  const re = /\b(describe|it|test)(?:\.(?:only|skip|concurrent|todo|each\([^)]*\)))*\s*\(\s*(["'`])((?:\\.|(?!\2).)*)\2/g
  const suites: Array<{ name: string; depth: number }> = []
  let depth = 0
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    // Track nesting by braces between matches, so a describe's name prefixes only the tests inside it.
    for (const ch of text.slice(last, m.index)) {
      if (ch === "{") depth++
      else if (ch === "}") {
        depth--
        while (suites.length && suites.at(-1)!.depth > depth) suites.pop()
      }
    }
    last = m.index
    const name = m[3]!.replace(/\\(.)/g, "$1")
    if (m[1] === "describe") suites.push({ name, depth: depth + 1 })
    else out.push({ name: [...suites.map((s) => s.name), name].join(" > "), line: lineAt(text, m.index) })
  }
  return out
}

/** def test_x(...) at the top level or in a class Test...: pytest's own names. */
export function parsePyTests(text: string): TestCase[] {
  const out: TestCase[] = []
  let cls: { name: string; indent: number } | undefined
  const lines = text.split("\n")
  lines.forEach((l, i) => {
    const indent = /^\s*/.exec(l)![0].length
    const c = /^(\s*)class\s+(Test\w*)/.exec(l)
    if (c) return void (cls = { name: c[2]!, indent })
    if (cls && l.trim() && indent <= cls.indent) cls = undefined
    const d = /^\s*(?:async\s+)?def\s+(test\w*)\s*\(/.exec(l)
    if (d) out.push({ name: cls ? `${cls.name}::${d[1]}` : d[1]!, line: i + 1 })
  })
  return out
}

/** Methods marked [Fact], [Theory], [Test], [TestCase] or [TestMethod]: their names, as dotnet test filters them. */
export function parseCsTests(text: string): TestCase[] {
  const out: TestCase[] = []
  const re = /\[(?:Fact|Theory|Test|TestCase|TestMethod)\b[^\]]*\]\s*(?:\[[^\]]*\]\s*)*(?:public\s+|internal\s+)?(?:async\s+)?(?:static\s+)?[\w<>[\],\s]+?\s+(\w+)\s*\(/g
  for (let m = re.exec(text); m; m = re.exec(text)) out.push({ name: m[1]!, line: lineAt(text, m.index + m[0].lastIndexOf(m[1]!)) })
  return out
}

/** The project's tests, a file at a time, for the runners it uses. Files are relative, with forward slashes. */
export function discover(root: string, files: readonly string[]): TestFile[] {
  const runners = detectRunners(root, files)
  const js: Runner | undefined = runners.includes("vitest") ? "vitest" : runners.includes("jest") ? "jest" : undefined
  const out: TestFile[] = []
  for (const raw of files.slice(0, 50_000)) {
    if (out.length >= MAX_FILES) break
    const file = raw.replace(/\\/g, "/")
    if (/(^|\/)(node_modules|bin|obj|dist|\.git)\//.test(file)) continue
    let runner: Runner | undefined
    let parse: ((t: string) => TestCase[]) | undefined
    if (js && JS_TEST.test(file)) [runner, parse] = [js, parseJsTests]
    else if (runners.includes("pytest") && PY_TEST.test(file)) [runner, parse] = ["pytest", parsePyTests]
    else if (runners.includes("dotnet") && CS_TEST.test(file)) [runner, parse] = ["dotnet", parseCsTests]
    if (!runner || !parse) continue
    const tests = parse(safeRead(path.join(root, file)))
    if (tests.length || runner !== "dotnet") out.push({ file, runner, tests })
  }
  return out
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** The project's own copy of a Node runner's program: its package's bin, run with this Node. Never downloaded. */
function nodeBin(root: string, pkg: "vitest" | "jest"): string {
  const dir = path.join(root, "node_modules", pkg)
  const j = readJson(path.join(dir, "package.json"))
  const bin = typeof j?.bin === "string" ? j.bin : (j?.bin as Record<string, string> | undefined)?.[pkg]
  if (!bin) throw new TestRunError(`${pkg} is not installed in this project (node_modules/${pkg}). Install the project's packages first.`)
  const abs = path.resolve(dir, bin)
  if (!abs.startsWith(path.resolve(dir) + path.sep)) throw new TestRunError(`${pkg}'s program is outside its own folder.`)
  return abs
}

/** The program and arguments for a run, with where it writes its report. */
export function commandFor(
  runner: Runner,
  root: string,
  out: string,
  target: { file?: string; name?: string },
  o: { node?: string; python?: string; dotnet?: string } = {},
): { file: string; args: string[]; report: string } {
  const node = o.node ?? process.execPath
  if (runner === "vitest") {
    const report = path.join(out, "report.json")
    const args = [nodeBin(root, "vitest"), "run", ...(target.file ? [target.file] : []), ...(target.name ? ["-t", escapeRe(target.name.replace(/ > /g, " "))] : []), "--reporter=json", `--outputFile=${report}`]
    return { file: node, args, report }
  }
  if (runner === "jest") {
    const report = path.join(out, "report.json")
    const args = [nodeBin(root, "jest"), ...(target.file ? [target.file] : []), ...(target.name ? ["-t", escapeRe(target.name.replace(/ > /g, " "))] : []), "--json", `--outputFile=${report}`]
    return { file: node, args, report }
  }
  if (runner === "pytest") {
    const report = path.join(out, "report.xml")
    const id = target.file ? (target.name ? `${target.file}::${target.name}` : target.file) : undefined
    return { file: o.python ?? (process.platform === "win32" ? "python.exe" : "python3"), args: ["-m", "pytest", ...(id ? [id] : []), "-q", `--junitxml=${report}`], report }
  }
  const report = path.join(out, "report.trx")
  const args = ["test", "--logger", "trx;LogFileName=report.trx", "--results-directory", out, ...(target.name ? ["--filter", `Name=${target.name}`] : [])]
  return { file: o.dotnet ?? "dotnet", args, report }
}

const unxml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&")
const cut = (s: string) => (s.length > MAX_MESSAGE ? `${s.slice(0, MAX_MESSAGE)}\n[the rest was left out]` : s)
// Escape sequences a terminal colours with, which mean nothing here.
const plain = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "")

/** The line a failure names in its own file, from the stack in its message. */
export function failureLine(message: string, file: string): number | undefined {
  const base = escapeRe(path.basename(file))
  const m = new RegExp(`${base}(?::|\\(|:line )(\\d+)`).exec(message)
  return m ? Number(m[1]) : undefined
}

/** A runner's report as results, files relative to the project. */
export function parseReport(runner: Runner, text: string, root: string, files: readonly TestFile[] = []): TestResult[] {
  const rel = (p: string) => (path.isAbsolute(p) ? path.relative(root, p) : p).replace(/\\/g, "/")
  if (runner === "vitest" || runner === "jest") {
    let j: { testResults?: Array<{ name?: string; message?: string; assertionResults?: Array<{ fullName?: string; ancestorTitles?: string[]; title?: string; status?: string; failureMessages?: string[]; location?: { line?: number } }> }> }
    try {
      j = JSON.parse(text) as typeof j
    } catch {
      return []
    }
    const out: TestResult[] = []
    for (const f of j.testResults ?? []) {
      const file = rel(f.name ?? "")
      for (const a of f.assertionResults ?? []) {
        const status = a.status === "passed" ? "passed" : a.status === "failed" ? "failed" : "skipped"
        const message = a.failureMessages?.length ? cut(plain(a.failureMessages.join("\n"))) : undefined
        const name = [...(a.ancestorTitles ?? []), a.title ?? a.fullName ?? ""].filter(Boolean).join(" > ")
        const line = a.location?.line ?? (message ? failureLine(message, file) : undefined)
        out.push({ file, name, status, ...(message ? { message } : {}), ...(line ? { line } : {}) })
      }
      // A file that did not load at all (a syntax error): one failure for the file.
      if (!f.assertionResults?.length && f.message) out.push({ file, name: "(the file did not load)", status: "failed", message: cut(plain(f.message)) })
    }
    return out
  }
  if (runner === "pytest") {
    const out: TestResult[] = []
    for (const m of text.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
      const attr = (k: string) => {
        const a = new RegExp(`\\b${k}="([^"]*)"`).exec(m[1]!)
        return a ? unxml(a[1]!) : undefined
      }
      const body = m[3] ?? ""
      const cls = attr("classname") ?? ""
      const file = attr("file") ?? `${cls.split(".").filter((p) => !/^Test/.test(p)).join("/")}.py`
      const klass = cls.split(".").find((p) => /^Test/.test(p))
      const name = `${klass ? `${klass}::` : ""}${attr("name") ?? ""}`
      const fail = /<(failure|error)\b([^>]*)>([\s\S]*?)<\/\1>|<(failure|error)\b([^>]*)\/>/.exec(body)
      const status = fail ? "failed" : /<skipped\b/.test(body) ? "skipped" : "passed"
      const message = fail ? cut(unxml(`${/message="([^"]*)"/.exec(fail[2] ?? fail[5] ?? "")?.[1] ?? ""}\n${fail[3] ?? ""}`).trim()) : undefined
      const line = (message ? failureLine(message, file) : undefined) ?? (attr("line") ? Number(attr("line")) + 1 : undefined)
      out.push({ file: rel(file), name, status, ...(message ? { message } : {}), ...(line ? { line } : {}) })
    }
    return out
  }
  // dotnet: the trx file's results; the file is the one the method is found in.
  const out: TestResult[] = []
  for (const m of text.matchAll(/<UnitTestResult\b([^>]*?)(\/>|>([\s\S]*?)<\/UnitTestResult>)/g)) {
    const full = unxml(/\btestName="([^"]*)"/.exec(m[1]!)?.[1] ?? "")
    const outcome = /\boutcome="([^"]*)"/.exec(m[1]!)?.[1] ?? ""
    const method = full.replace(/\(.*$/, "").split(".").at(-1) ?? full
    const where = files.find((f) => f.runner === "dotnet" && f.tests.some((t) => t.name === method))
    const body = m[3] ?? ""
    const message = outcome === "Failed" ? cut(unxml(`${/<Message>([\s\S]*?)<\/Message>/.exec(body)?.[1] ?? ""}\n${/<StackTrace>([\s\S]*?)<\/StackTrace>/.exec(body)?.[1] ?? ""}`).trim()) : undefined
    const file = where?.file ?? ""
    const line = (message && file ? failureLine(message, file) : undefined) ?? where?.tests.find((t) => t.name === method)?.line
    out.push({ file, name: method, status: outcome === "Passed" ? "passed" : outcome === "Failed" ? "failed" : "skipped", ...(message ? { message } : {}), ...(line ? { line } : {}) })
  }
  return out
}

export interface TestExplorerDeps {
  audit: HostAudit
  killed: () => boolean
  policyHash: () => string
  log?: (line: string) => void
  env?: NodeJS.ProcessEnv
  /** Tests: other programs for the runners, and a shorter time limit. */
  programs?: { node?: string; python?: string; dotnet?: string }
  timeoutMs?: number
  /** Stops a run's process and what it started (taskkill /T on Windows). */
  stopTree?: (pid: number) => void
}

export class TestExplorer {
  readonly #d: TestExplorerDeps
  readonly #running = new Set<string>()

  constructor(d: TestExplorerDeps) {
    this.#d = d
  }

  async run(sessionId: string, root: string, runner: Runner, target: { file?: string; name?: string }, files: readonly TestFile[] = []): Promise<RunOutcome> {
    if (this.#d.killed()) throw new TestRunError("The kill switch is engaged. Re-arm it before running tests.")
    if (this.#running.has(root)) throw new TestRunError("Tests are already running in this project. Wait for them to finish.")
    if (target.file && (path.isAbsolute(target.file) || target.file.split(/[\\/]/).includes(".."))) throw new TestRunError("That file is not in the project.")
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "codehouse-tests-"))
    this.#running.add(root)
    try {
      const cmd = commandFor(runner, root, out, target, this.#d.programs)
      const verdict: Verdict = {
        outcome: "allow",
        ruleId: "test-explorer-run",
        reason: "You ran these tests yourself from the test explorer. Your own runs do not pass the Approver.",
        risk: 0,
        decidedBy: "rules",
        policyHash: this.#d.policyHash(),
      }
      const written = await this.#d.audit.record({
        session: sessionId,
        event: "tests_run",
        channel: "desktop",
        tool: "test-explorer",
        input: { runner, folder: root, ...(target.file ? { file: target.file } : {}), ...(target.name ? { test: target.name } : {}) },
        verdict,
        latencyMs: 0,
      })
      if (!written) throw new TestRunError("The run could not be recorded in the audit log, so it did not start.")
      const { exitCode, timedOut, tail } = await this.#spawn(cmd.file, cmd.args, root)
      const report = fs.existsSync(cmd.report) ? fs.readFileSync(cmd.report, "utf8") : ""
      const trx = runner === "dotnet" && !report ? findTrx(out) : undefined
      return { runner, results: parseReport(runner, trx ?? report, root, files), exitCode, timedOut, tail }
    } finally {
      this.#running.delete(root)
      fs.rmSync(out, { recursive: true, force: true })
    }
  }

  #spawn(file: string, args: string[], cwd: string): Promise<{ exitCode: number | null; timedOut: boolean; tail: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(file, args, { cwd, env: sanitiseEnv(this.#d.env ?? process.env) as NodeJS.ProcessEnv, windowsHide: true, shell: false })
      let tail = ""
      const keep = (b: Buffer) => {
        tail = (tail + b.toString("utf8")).slice(-8000)
      }
      child.stdout?.on("data", keep)
      child.stderr?.on("data", keep)
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        if (child.pid) (this.#d.stopTree ?? defaultStopTree)(child.pid)
      }, this.#d.timeoutMs ?? RUN_TIMEOUT_MS)
      child.on("error", (e) => {
        clearTimeout(timer)
        reject(new TestRunError(`The runner could not be started (${(e as NodeJS.ErrnoException).code ?? e.message}). Is it installed?`))
      })
      child.on("close", (code) => {
        clearTimeout(timer)
        resolve({ exitCode: code, timedOut, tail: plain(tail) })
      })
    })
  }
}

function findTrx(dir: string): string | undefined {
  for (const f of fs.readdirSync(dir, { recursive: true }) as string[]) if (f.endsWith(".trx")) return fs.readFileSync(path.join(dir, f), "utf8")
  return undefined
}

function defaultStopTree(pid: number): void {
  if (process.platform === "win32") spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true })
  else
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      /* already gone */
    }
}
