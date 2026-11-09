/**
 * D-001, the test integrity guard (Frontier build, Wave 1): a change that weakens the project's tests goes to a
 * person, with one line naming the weakening. It looks at Write, Edit and MultiEdit to test files and test config, and
 * at shell commands that delete or edit test files or hide a test run's failure.
 *
 * What counts as weakening (each has a pattern id, kept in the rule id and the audit record):
 *   assertion-removed     fewer assertions than before (expect, assert, Should, Assert.*)
 *   skip-added            a skip or only marker added (.skip, .only, xit, xdescribe, [Ignore], [Skip], -Skip, ...)
 *   expected-changed      an assertion kept but the value it expects changed
 *   test-deleted          a test file deleted, or written empty
 *   coverage-lowered      a coverage threshold lowered in test config
 *   failure-hidden        `|| true`, `--passWithNoTests`, `continue-on-error`, `--no-verify` added
 *   shell-edit            a shell command edits a test file in a way the guard cannot read (sed -i, a redirect)
 *
 * It only ever escalates: it never allows and never denies (the floor and your deny rules still apply first).
 */
import fs from "node:fs"
import path from "node:path"
import type { Segment } from "./segments.js"

export type IntegrityPattern =
  | "assertion-removed"
  | "skip-added"
  | "expected-changed"
  | "test-deleted"
  | "coverage-lowered"
  | "failure-hidden"
  | "shell-edit"

export const INTEGRITY_PATTERNS: readonly IntegrityPattern[] = [
  "assertion-removed",
  "skip-added",
  "expected-changed",
  "test-deleted",
  "coverage-lowered",
  "failure-hidden",
  "shell-edit",
]

export interface IntegrityFinding {
  pattern: IntegrityPattern
  /** One line naming the weakening. */
  reason: string
}

/** The rule id a finding gives: the pack's name and the pattern. */
export const integrityRuleId = (p: IntegrityPattern) => `${INTEGRITY_PREFIX}${p}`
/** High, so Auto and Accept edits ask too rather than leaving it to Claude Code. */
export const INTEGRITY_RISK = 70
export const INTEGRITY_PREFIX = "test-integrity-"

const TEST_FILE = [
  /(^|\/)(__tests__|tests?|spec|specs)\//i, // a test folder (tests/, test/, __tests__/, spec/)
  /\.(test|spec)\.[cm]?[jt]sx?$/i, // a.test.ts, a.spec.js
  /(^|\/)test_[^/]+\.py$/i, // test_a.py
  /_test\.py$/i, // a_test.py
  /(^|\/)conftest\.py$/i,
  /tests?\.cs$/i, // ATests.cs, ATest.cs
  /\.tests?\.ps1$/i, // A.Tests.ps1 (Pester)
  /_test\.go$/i,
]

const TEST_CONFIG = [
  /(^|\/)(vitest|jest|karma|playwright|cypress)\.config\.[cm]?[jt]s$/i,
  /(^|\/)(jest\.config\.json|\.mocharc(\.[a-z]+)?|pytest\.ini|tox\.ini|\.coveragerc|setup\.cfg|pyproject\.toml|codecov\.ya?ml|\.nycrc(\.json)?|coverlet\.runsettings)$/i,
  /\.runsettings$/i,
  /(^|\/)pesterconfiguration\.psd1$/i,
  /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/i,
  /(^|\/)package\.json$/i,
]

const slash = (p: string) => p.replace(/\\/g, "/")
export const isTestFile = (p: string) => TEST_FILE.some((r) => r.test(slash(p)))
export const isTestConfig = (p: string) => TEST_CONFIG.some((r) => r.test(slash(p)))

const ASSERTION = /\bexpect\s*\(|\bassert(?:[A-Z]\w*)?\s*[(.]|\bassert\s+\S|\bShould\b|\bAssert\.\w+|\bself\.assert\w*\s*\(/g
const SKIP = new RegExp(
  [
    String.raw`\.(?:skip|only|todo)\s*[(.]`,
    String.raw`\bx(?:it|describe|test)\s*\(`,
    String.raw`\bf(?:it|describe)\s*\(`,
    String.raw`\[\s*(?:Ignore|Skip)\b`,
    String.raw`\bSkip\s*=\s*"`,
    String.raw`@pytest\.mark\.(?:skip|skipif|xfail)\b`,
    String.raw`@unittest\.(?:skip|skipIf|expectedFailure)\b`,
    String.raw`\bpytest\.skip\s*\(`,
    String.raw`\s-Skip\b`,
  ].join("|"),
  "g",
)
const HIDING = /\|\|\s*true\b|--passWithNoTests\b|\bcontinue-on-error\s*:\s*true\b|--no-verify\b|\|\|\s*exit\s+0\b/g
const COVERAGE_KEY =
  /\b(lines|branches|functions|statements|fail[_-]under|threshold|thresholds|minimum|cov-fail-under|coverage)\b["']?\s*[:=]?\s*["']?(\d+(?:\.\d+)?)/gi

const count = (text: string, re: RegExp) => (text.match(re) ?? []).length

/** Literals (strings and numbers) taken out, so two lines that differ only in what they expect compare equal. */
const shape = (line: string) =>
  line
    .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "L")
    .replace(/\b\d+(?:\.\d+)?\b/g, "L")
    .replace(/\s+/g, "")

const lines = (t: string) => t.split(/\r?\n/)
const ONE_ASSERTION = new RegExp(ASSERTION.source)
const isAssertLine = (l: string) => ONE_ASSERTION.test(l)

/** Assertion lines removed and added with the same shape but other values: what they expect has changed. */
function expectedChanged(before: string, after: string): boolean {
  const old = new Set(lines(before).map((l) => l.trim()))
  const neu = new Set(lines(after).map((l) => l.trim()))
  const removed = [...old].filter((l) => !neu.has(l) && isAssertLine(l))
  const added = [...neu].filter((l) => !old.has(l) && isAssertLine(l))
  if (!removed.length || !added.length) return false
  const shapes = new Set(removed.map(shape))
  return added.some((l) => shapes.has(shape(l)))
}

/** Each coverage key and its number, the lowest seen for each key. */
function coverage(text: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const m of text.matchAll(COVERAGE_KEY)) {
    const k = m[1]!.toLowerCase().replace(/_/g, "-")
    const v = Number(m[2])
    if (Number.isFinite(v)) out.set(k, Math.min(out.get(k) ?? Infinity, v))
  }
  return out
}

/** What a change from one text to another weakens, for a test file or test config. */
export function compareTexts(file: string, before: string, after: string): IntegrityFinding[] {
  const out: IntegrityFinding[] = []
  const name = path.basename(slash(file))
  const test = isTestFile(file)
  const config = isTestConfig(file)
  if (!test && !config) return out
  if (test) {
    const a = count(before, ASSERTION)
    const b = count(after, ASSERTION)
    if (b < a)
      out.push({
        pattern: "assertion-removed",
        reason: `It removes ${a - b === 1 ? "an assertion" : `${a - b} assertions`} from ${name}.`,
      })
    if (count(after, SKIP) > count(before, SKIP))
      out.push({ pattern: "skip-added", reason: `It marks tests in ${name} to be skipped, or to run alone.` })
    if (expectedChanged(before, after))
      out.push({ pattern: "expected-changed", reason: `It changes the value a test in ${name} expects.` })
  }
  if (config) {
    const was = coverage(before)
    const now = coverage(after)
    const lowered = [...now].filter(([k, v]) => was.has(k) && v < was.get(k)!)
    // A threshold taken out lowers it to none.
    const dropped = [...was.keys()].filter((k) => !now.has(k))
    if (lowered.length || dropped.length)
      out.push({
        pattern: "coverage-lowered",
        reason: `It lowers the coverage threshold in ${name}${lowered[0] ? ` (${lowered[0][0]} ${was.get(lowered[0][0])} to ${lowered[0][1]})` : ""}.`,
      })
  }
  if (count(after, HIDING) > count(before, HIDING))
    out.push({
      pattern: "failure-hidden",
      reason: `It adds a flag that hides a failure (such as || true, --passWithNoTests or --no-verify) in ${name}.`,
    })
  if (test && !after.trim() && before.trim())
    out.push({ pattern: "test-deleted", reason: `It empties the test file ${name}.` })
  return dedupe(out)
}

function dedupe(list: IntegrityFinding[]): IntegrityFinding[] {
  const seen = new Set<string>()
  return list.filter((f) => !seen.has(f.pattern) && (seen.add(f.pattern), true))
}

/** The file as it is now, for comparing a Write with it; nothing when it is not there or too big to read. */
function current(file: string): string | undefined {
  try {
    const st = fs.statSync(file)
    if (!st.isFile() || st.size > 2_000_000) return undefined
    return fs.readFileSync(file, "utf8")
  } catch {
    return undefined
  }
}

const DELETERS = new Set(["rm", "rmdir", "unlink", "del", "erase", "rd", "remove-item"])
const SHELL_EDITORS = /^(sed|perl|awk|set-content|add-content|out-file|clear-content|tee|truncate)$/i
const TEST_RUN = /\b(npm|pnpm|yarn)\s+(run\s+)?test\b|\b(vitest|jest|mocha|pytest|dotnet\s+test|invoke-pester|go\s+test|cargo\s+test)\b/i

/** What a shell command weakens: test files deleted or edited unseen, and a test run or commit made to hide failure. */
export function shellFindings(segments: Segment[], targets: Array<{ raw: string; abs: string }>): IntegrityFinding[] {
  const out: IntegrityFinding[] = []
  const testTargets = targets.filter((t) => isTestFile(t.abs) || isTestFile(t.raw))
  const text = segments.map((s) => s.text).join(" ; ")
  for (const s of segments) {
    const name = s.name.toLowerCase()
    const tests = s.args.filter((a) => isTestFile(a))
    const gitRm = name === "git" && s.args[0] === "rm"
    if ((DELETERS.has(name) || gitRm) && tests.length)
      out.push({ pattern: "test-deleted", reason: `It deletes the test file ${path.basename(slash(tests[0]!))}.` })
    const inPlace =
      (name === "sed" && s.args.some((a) => /^-[a-z]*i/.test(a) || a === "--in-place")) ||
      (name === "perl" && s.args.some((a) => /^-[a-z]*i/.test(a))) ||
      (SHELL_EDITORS.test(name) && !/^(sed|perl)$/.test(name))
    if ((inPlace || s.writes) && tests.length)
      out.push({
        pattern: "shell-edit",
        reason: `It changes the test file ${path.basename(slash(tests[0]!))} from the shell, where the guard cannot see what changes.`,
      })
  }
  if (!out.some((f) => f.pattern === "shell-edit") && testTargets.length && segments.some((s) => s.writes))
    out.push({
      pattern: "shell-edit",
      reason: `It writes to the test file ${path.basename(slash(testTargets[0]!.raw))} from the shell, where the guard cannot see what changes.`,
    })
  if (
    (TEST_RUN.test(text) && /\|\|\s*(true|exit 0|:)\b|--passWithNoTests\b/.test(text)) ||
    /\bgit\s+(commit|push)\b[^;|&]*--no-verify\b/.test(text)
  )
    out.push({
      pattern: "failure-hidden",
      reason: "It runs the tests, or commits, in a way that hides a failure (|| true, --passWithNoTests or --no-verify).",
    })
  return dedupe(out)
}

/** What a file tool's call weakens: Write against the file as it is, Edit and MultiEdit against their own text. */
export function fileFindings(tool: string, input: Record<string, unknown>, absPath: string | undefined): IntegrityFinding[] {
  const file = typeof input.file_path === "string" ? input.file_path : ""
  if (!file || !(isTestFile(file) || isTestConfig(file))) return []
  if (tool === "Write") {
    const after = typeof input.content === "string" ? input.content : ""
    const before = absPath ? current(absPath) : undefined
    return before === undefined ? compareTexts(file, "", after) : compareTexts(file, before, after)
  }
  if (tool === "Edit") {
    const a = typeof input.old_string === "string" ? input.old_string : ""
    const b = typeof input.new_string === "string" ? input.new_string : ""
    return compareTexts(file, a, b)
  }
  if (tool === "MultiEdit" && Array.isArray(input.edits)) {
    const edits = input.edits as Array<{ old_string?: unknown; new_string?: unknown }>
    const a = edits.map((e) => (typeof e.old_string === "string" ? e.old_string : "")).join("\n")
    const b = edits.map((e) => (typeof e.new_string === "string" ? e.new_string : "")).join("\n")
    return compareTexts(file, a, b)
  }
  return []
}
