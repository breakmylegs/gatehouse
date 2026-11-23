/**
 * E-076, pattern cards (Expansion E6). Cards showing how this repository handles errors, logging, configuration and
 * tests, each read from the code itself with real examples: the error classes it defines and how it throws and
 * catches, the logger it calls, where it reads its settings, and how its tests are written and where they live. Each
 * card names the pattern the code uses most, with at least two real examples (file, line and the line itself); a
 * topic with fewer than two is not carded, so a card never rests on one instance. The cards are saved as
 * .codehouse/patterns.md when you ask, for agents and people to read.
 */
import fs from "node:fs"
import path from "node:path"

export interface Example {
  file: string
  line: number
  text: string
}

export interface PatternCard {
  topic: "Errors" | "Logging" | "Configuration" | "Tests"
  summary: string
  examples: Example[]
}

interface Probe {
  topic: PatternCard["topic"]
  /** A named way of doing it, and the line that shows it. */
  ways: Array<{ name: string; re: RegExp; file?: RegExp }>
  summary: (best: string, count: number, files: number) => string
}

const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py|cs|go|java|kt|rb|php)$/
const TEST_FILE = /(^|\/)(__tests__|tests?|spec)\/|[._-](test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$|_test\.(py|go)$|Tests?\.cs$/i

const PROBES: Probe[] = [
  {
    topic: "Errors",
    ways: [
      { name: "its own error classes (extends Error)", re: /\bclass\s+\w+(?:Error|Exception)\s+extends\s+(?:\w+)?Error\b/ },
      { name: "its own exception classes", re: /\bclass\s+\w+Exception\s*(?::|extends)\s*\w*Exception\b/ },
      { name: "throwing new Error with a message", re: /\bthrow\s+new\s+Error\s*\(/ },
      { name: "results instead of throwing (ok and error objects)", re: /\{\s*ok:\s*(?:true|false)\b/ },
      { name: "raising exceptions", re: /^\s*raise\s+\w+(?:Error|Exception)\(/ },
    ],
    summary: (best, n, f) => `This repository handles errors with ${best}: ${n} place(s) in ${f} file(s).`,
  },
  {
    topic: "Logging",
    ways: [
      { name: "a log function of its own (log(...))", re: /(?<![.\w])log\s*\(\s*[`'"]/ },
      { name: "a logger object (logger.info, logger.error)", re: /\blogger\.(info|warn|error|debug)\s*\(/ },
      { name: "the console (console.log, console.error)", re: /\bconsole\.(log|warn|error|info)\s*\(/ },
      { name: "Python's logging module", re: /\blogging\.(getLogger|info|warning|error)\s*\(/ },
      { name: "ILogger (_logger.Log...)", re: /\b_?logger\.Log\w*\s*\(/ },
    ],
    summary: (best, n, f) => `This repository logs with ${best}: ${n} call(s) in ${f} file(s).`,
  },
  {
    topic: "Configuration",
    ways: [
      { name: "environment variables (process.env)", re: /\bprocess\.env\.[A-Z_][A-Z0-9_]*|\bprocess\.env\[/ },
      { name: "a config function or object (config(), config.)", re: /\bconfig\(\)\.\w+|\bconfig\.\w+\s*(\?\?|\|\||\)|,|;)/ },
      { name: "Python's os.environ", re: /\bos\.(environ|getenv)\b/ },
      { name: "IConfiguration", re: /\bIConfiguration\b|Configuration\["/ },
    ],
    summary: (best, n, f) => `This repository reads its settings through ${best}: ${n} place(s) in ${f} file(s).`,
  },
  {
    topic: "Tests",
    ways: [
      { name: "Vitest (describe, it, expect from vitest)", re: /from\s+["']vitest["']/, file: TEST_FILE },
      { name: "Jest (describe, it, expect)", re: /from\s+["']@jest\/globals["']|\bjest\.(fn|mock)\(/, file: TEST_FILE },
      { name: "pytest (def test_...)", re: /^\s*def\s+test_\w+\s*\(/, file: TEST_FILE },
      { name: "xUnit or NUnit ([Fact], [Test])", re: /^\s*\[(Fact|Theory|Test|TestMethod)\]/, file: TEST_FILE },
      { name: "Go's testing package (func TestX)", re: /^func\s+Test\w+\(t \*testing\.T\)/, file: TEST_FILE },
    ],
    summary: (best, n, f) => `This repository's tests use ${best}: ${n} file(s) or case(s) across ${f} file(s).`,
  },
]

/** The cards for a project, from its source files (dependencies and builds left out). */
export function patternCards(root: string, files: string[]): PatternCard[] {
  const code = files
    .map((f) => f.replace(/\\/g, "/"))
    .filter((f) => CODE.test(f) && !/(^|\/)(node_modules|dist|build|bin|obj|vendor|\.git)\//.test(f))
    .slice(0, 4000)
  const texts = new Map<string, string[]>()
  const linesOf = (f: string) => {
    let l = texts.get(f)
    if (!l) {
      try {
        const abs = path.join(root, f)
        l = fs.statSync(abs).size > 1_000_000 ? [] : fs.readFileSync(abs, "utf8").split(/\r?\n/)
      } catch {
        l = []
      }
      texts.set(f, l)
    }
    return l
  }
  const cards: PatternCard[] = []
  for (const p of PROBES) {
    let best: { name: string; hits: Example[] } | undefined
    for (const w of p.ways) {
      const hits: Example[] = []
      for (const f of code) {
        // Tests are read in test files only; the rest in source files only, so tests do not decide the code's patterns.
        if (w.file ? !w.file.test(f) : TEST_FILE.test(f)) continue
        linesOf(f).forEach((text, i) => {
          if (w.re.test(text)) hits.push({ file: f, line: i + 1, text: text.trim().slice(0, 160) })
        })
      }
      if (!best || hits.length > best.hits.length) best = { name: w.name, hits }
    }
    if (!best) continue
    // Examples from different files first, so two examples are two places.
    const byFile = new Map<string, Example>()
    for (const h of best.hits) if (!byFile.has(h.file)) byFile.set(h.file, h)
    const examples = [...byFile.values()].slice(0, 4)
    if (examples.length < 2) continue
    cards.push({ topic: p.topic, summary: p.summary(best.name, best.hits.length, byFile.size), examples })
  }
  return cards
}

export function cardsMarkdown(project: string, cards: PatternCard[]): string {
  return [
    `# How ${project} does things`,
    "",
    "Pattern cards read from the code by Codehouse. Follow these patterns in new code; each example is real.",
    "",
    ...cards.flatMap((c) => [`## ${c.topic}`, "", c.summary, "", ...c.examples.map((e) => `- \`${e.file}:${e.line}\`: \`${e.text.replace(/`/g, "'")}\``), ""]),
  ].join("\n")
}
