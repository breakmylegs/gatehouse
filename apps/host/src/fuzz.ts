/**
 * D-012, a time-boxed fuzz pass (Frontier build), the safe variant. The changed files' exported parsing functions
 * (parse, decode, tokenise, lex, deserialise) are called with many generated strings from a seed, by a small runner
 * Codehouse writes to its data folder, run as a Codehouse action: judged by the policy like the same command from the
 * session, without credentials, in a job at the session's level, within a time box and a heap cap. A parser's own
 * SyntaxError for bad input is expected; a TypeError, RangeError, ReferenceError, a thrown non-error, running out of
 * memory or a hang is a finding. Each finding's input is written to testdata/fuzz/<function>/<hash> in the project,
 * where D-008's pinning finds it. Native fuzzers (jazzer.js, SharpFuzz) are listed for IT and the owner, not built.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "@gatehouse/shared/node"

export const FUZZ_MEMORY_MB = 256
export const FUZZ_TOTAL_MS = 60_000

export interface FuzzTarget {
  /** The file, from the project's folder. */
  file: string
  fn: string
}

export interface FuzzFinding {
  file: string
  fn: string
  kind: "crash" | "memory" | "hang"
  /** The error's name and message, or what stopped it. */
  error: string
  input: string
  /** Where the input was written, from the project's folder. */
  written?: string
}

export interface FuzzReport {
  targets: FuzzTarget[]
  findings: FuzzFinding[]
  /** Calls made, over every target. */
  calls: number
  ms: number
  refused?: string
}

const NAME = String.raw`(parse\w*|decode\w*|tokeni[sz]e\w*|lex\w*|deserial[iz]e\w*)`
const EXPORTED = new RegExp(String.raw`export\s+(?:async\s+)?function\s+${NAME}\s*\(|export\s+const\s+${NAME}\s*=`, "g")

/** The exported parsing functions in changed JavaScript or TypeScript files, a few per file, at most twenty. */
export function fuzzTargets(changes: Array<{ path: string; text: string }>): FuzzTarget[] {
  const out: FuzzTarget[] = []
  for (const c of changes) {
    if (!/\.(?:[cm]?js|[cm]?ts)$/i.test(c.path) || /\.(test|spec)\./i.test(c.path) || /\.d\.ts$/i.test(c.path)) continue
    const names = [...new Set([...c.text.matchAll(EXPORTED)].map((m) => (m[1] ?? m[2])!))]
    for (const fn of names.slice(0, 5)) out.push({ file: c.path.replace(/\\/g, "/"), fn })
  }
  return out.slice(0, 20)
}

/**
 * The runner: node runner.mjs <file> <function> <seed> <ms> <last-input file>. It prints one JSON line at the end
 * ({calls, finding?}); before each call it writes the input to the last-input file, so a run that dies (out of memory)
 * or is stopped (a hang) still says what it was given.
 */
export const RUNNER = `import fs from "node:fs"
import { pathToFileURL } from "node:url"
const [file, fn, seedText, msText, lastFile] = process.argv.slice(2)
let seed = Number(seedText) >>> 0
const rand = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const pick = (s) => s[Math.floor(rand() * s.length)]
const ALPHABETS = ["abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ", "()[]{}<>\\"'\\\\,:;=+-*/#&|!?", "0123456789.-+eE", " \\t\\r\\n", "\\u00e9\\u4e2d\\u{1F600}\\u0000\\u202e\\ufeff"].map((a) => Array.from(a))
const gen = () => {
  const r = rand()
  if (r < 0.15) { const unit = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => pick(pick(ALPHABETS))).join(""); return unit.repeat(1 + Math.floor(rand() * 5000)) }
  const len = Math.floor(rand() * (r < 0.6 ? 16 : 256))
  let s = ""
  for (let i = 0; i < len; i++) s += pick(pick(ALPHABETS))
  return s
}
const mod = await import(pathToFileURL(file).href)
const f = mod[fn] ?? mod.default?.[fn]
if (typeof f !== "function") { console.log(JSON.stringify({ calls: 0, missing: true })); process.exit(0) }
const end = Date.now() + Number(msText)
let calls = 0
// One open file, overwritten in place: opening and closing it for every call is slow where files are scanned.
const fd = fs.openSync(lastFile, "w")
const note = (input) => { fs.ftruncateSync(fd, 0); fs.writeSync(fd, input, 0) }
for (const input of ["", " ", "{", "[", "(", "\\"", "\\\\", "0", "-", "\\u0000"]) { note(input); calls++; try { await f(input) } catch (e) { if (!(e instanceof Error) || /^(TypeError|RangeError|ReferenceError|InternalError)$/.test(e.name)) { console.log(JSON.stringify({ calls, finding: { kind: "crash", error: e instanceof Error ? e.name + ": " + e.message : "threw " + String(e), input } })); process.exit(0) } } }
while (Date.now() < end) {
  const input = gen()
  note(input)
  calls++
  try { await f(input) } catch (e) {
    if (!(e instanceof Error) || /^(TypeError|RangeError|ReferenceError|InternalError)$/.test(e.name)) {
      console.log(JSON.stringify({ calls, finding: { kind: "crash", error: e instanceof Error ? e.name + ": " + e.message.slice(0, 300) : "threw " + String(e).slice(0, 300), input } }))
      process.exit(0)
    }
  }
}
console.log(JSON.stringify({ calls }))
`

export type FuzzExec = (command: string, cwd: string, timeoutMs: number) => Promise<{ exitCode: number | null; output: string; timedOut: boolean; refused?: string }>

const quote = (s: string) => `"${s.replace(/"/g, '\\"')}"`

/** Writes the runner where Codehouse keeps its data, if it is not there as it should be. */
export async function ensureRunner(dataDir: string): Promise<string> {
  const file = path.join(dataDir, "fuzz", "runner.mjs")
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== RUNNER) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    await writeFileAtomic(file, RUNNER)
  }
  return file
}

/** Runs the pass: the time box shared between the targets, each with the heap cap; stops at the first finding of each. */
export async function runFuzz(o: {
  root: string
  targets: FuzzTarget[]
  exec: FuzzExec
  runner: string
  scratch: string
  seed?: number
  totalMs?: number
  memoryMb?: number
}): Promise<FuzzReport> {
  const started = Date.now()
  const seed = o.seed ?? 1
  const total = o.totalMs ?? FUZZ_TOTAL_MS
  const mb = o.memoryMb ?? FUZZ_MEMORY_MB
  const report: FuzzReport = { targets: o.targets, findings: [], calls: 0, ms: 0 }
  fs.mkdirSync(o.scratch, { recursive: true })
  for (const [i, t] of o.targets.entries()) {
    const share = Math.max(1000, Math.floor((total - (Date.now() - started)) / (o.targets.length - i)))
    if (Date.now() - started >= total) break
    const last = path.join(o.scratch, `last-${i}.txt`)
    fs.writeFileSync(last, "")
    const command = `node --max-old-space-size=${mb} ${quote(o.runner)} ${quote(path.join(o.root, t.file))} ${t.fn} ${seed} ${share} ${quote(last)}`
    const r = await o.exec(command, o.root, share + 15_000)
    if (r.refused) {
      report.refused = r.refused
      break
    }
    const line = r.output.trim().split(/\r?\n/).reverse().find((l) => l.startsWith("{"))
    let parsed: { calls?: number; finding?: { kind: "crash"; error: string; input: string } } = {}
    try {
      parsed = line ? (JSON.parse(line) as typeof parsed) : {}
    } catch {
      parsed = {}
    }
    report.calls += parsed.calls ?? 0
    const lastInput = () => (fs.existsSync(last) ? fs.readFileSync(last, "utf8") : "")
    const finding: Omit<FuzzFinding, "file" | "fn"> | undefined = parsed.finding
      ? parsed.finding
      : /heap out of memory|allocation failed|JavaScript heap/i.test(r.output)
        ? { kind: "memory", error: `ran out of the ${mb} MB heap cap`, input: lastInput() }
        : r.timedOut
          ? { kind: "hang", error: "did not return within the time box", input: lastInput() }
          : undefined
    if (finding) report.findings.push({ file: t.file, fn: t.fn, ...finding })
  }
  // Each finding's input, where D-008 pins it.
  for (const f of report.findings) {
    const hash = crypto.createHash("sha256").update(f.input).digest("hex").slice(0, 16)
    const rel = `testdata/fuzz/${f.fn}/${hash}`
    const abs = path.join(o.root, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    await writeFileAtomic(abs, f.input)
    f.written = rel
  }
  report.ms = Date.now() - started
  return report
}

/** The findings as the lines D-008 reads for counterexamples to pin. */
export const pinLines = (r: FuzzReport) => r.findings.filter((f) => f.written).map((f) => `Failing input written to ${f.written}`).join("\n")
