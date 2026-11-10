/**
 * D-008, pinned counterexamples (Frontier build, Wave 1). When a property-based test or a fuzz run fails, the shrunk
 * counterexample it prints becomes a proposed regression test with a name. Accepted, Codehouse writes it itself where
 * it can (fast-check and Hypothesis: the failing property, copied into a test of its own that runs only that example)
 * and locks it (D-007); otherwise it asks Claude to write it, and locks the file once written.
 */
import path from "node:path"

export type Framework = "fast-check" | "hypothesis" | "fscheck" | "fuzz"

export interface Counterexample {
  framework: Framework
  /** The failing test file, as the runner named it, and the test. */
  file?: string
  test?: string
  /** The counterexample as the tool printed it: "[0,1]" for fast-check, "a=0, b=1" for Hypothesis. */
  example: string
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim()

/** The counterexamples in a test run's output. */
export function findCounterexamples(output: string): Counterexample[] {
  const t = output.replace(/\u001b\[[0-9;]*m/g, "").replace(/\r\n/g, "\n")
  const out: Counterexample[] = []
  // fast-check under vitest or jest: "FAIL  tests/add.test.ts > add is commutative" ... "Counterexample: [0,1]"
  for (const m of t.matchAll(/Counterexample:\s*(\[[^\n]*\])/g)) {
    const before = t.slice(0, m.index)
    const fail = [...before.matchAll(/(?:FAIL|×|✕)\s+(\S+\.(?:test|spec)\.[cm]?[jt]sx?)\s*>\s*([^\n]+?)\s*(?:\d+ms)?$/gm)].at(-1)
    out.push({
      framework: "fast-check",
      ...(fail ? { file: fail[1]!, test: fail[2]!.split(" > ").at(-1)!.trim() } : {}),
      example: m[1]!.trim(),
    })
  }
  // Hypothesis under pytest: "Falsifying example: test_add(\n    a=0,\n    b=1,\n)"
  for (const m of t.matchAll(/Falsifying example:\s*(\w+)\(([\s\S]*?)\)\s*$/gm)) {
    const args = oneLine(m[2]!).replace(/,\s*$/, "")
    const file = new RegExp(String.raw`(?:FAILED\s+)?(\S+\.py)::${m[1]}\b`).exec(t)
    out.push({ framework: "hypothesis", test: m[1]!, ...(file ? { file: file[1]! } : {}), example: args })
  }
  // FsCheck: "Falsifiable, after 3 tests (1 shrink) ...:\nOriginal:\n...\nShrunk:\n(0, 1)"
  for (const m of t.matchAll(/Falsifiable, after[^\n]*\n(?:[\s\S]*?)Shrunk:\s*\n\s*([^\n]+)/g))
    out.push({ framework: "fscheck", example: m[1]!.trim() })
  // A fuzz run: Go's "Failing input written to testdata/fuzz/FuzzX/<hash>", libFuzzer's "crash-<hash>".
  for (const m of t.matchAll(/Failing input written to (\S+)|Test unit written to (\S*crash-[0-9a-f]+)/g))
    out.push({ framework: "fuzz", example: (m[1] ?? m[2])!.trim() })
  return out
}

/** A short safe part of a name, from the example. */
export function slugOf(example: string): string {
  const s = example.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  return (s || "case").slice(0, 32)
}

/** Where the bracket opened at `open` closes, skipping strings and comments; -1 when it does not. */
function closing(src: string, open: number): number {
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" }
  const stack: string[] = []
  for (let i = open; i < src.length; i++) {
    const c = src[i]!
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++
      continue
    }
    if (c === "/" && src[i + 1] === "/") {
      i = src.indexOf("\n", i)
      if (i < 0) return -1
      continue
    }
    if (c === "/" && src[i + 1] === "*") {
      i = src.indexOf("*/", i + 2)
      if (i < 0) return -1
      i++
      continue
    }
    if (pairs[c]) stack.push(pairs[c]!)
    else if (c === ")" || c === "]" || c === "}") {
      if (stack.pop() !== c) return -1
      if (!stack.length) return i
    }
  }
  return -1
}

/** The top-level commas of the bracket from `open` to `close`. */
function topCommas(src: string, open: number, close: number): number[] {
  const out: number[] = []
  for (let i = open + 1; i < close; i++) {
    const c = src[i]!
    if ("([{".includes(c)) {
      const end = closing(src, i)
      if (end < 0) return out
      i = end
    } else if (c === '"' || c === "'" || c === "`") {
      for (i++; i < close && src[i] !== c; i++) if (src[i] === "\\") i++
    } else if (c === ",") out.push(i)
  }
  return out
}

export interface Regression {
  /** Where it goes, relative to the folder the failing test is in. */
  file: string
  name: string
  content: string
}

/** The imports at the top of a JS or TS file: import statements and require lines, as written. */
function jsImports(src: string): string {
  // The header: everything before the first describe, it or test.
  const first = /^\s*(describe|it|test)\s*\(/m.exec(src)
  const header = first ? src.slice(0, first.index) : src
  const statements =
    header.match(
      /^(?:import\s[\s\S]*?from\s*["'][^"']+["'];?|import\s*["'][^"']+["'];?|(?:const|let|var)\s+[^=\n]+=\s*require\([^)]*\);?)/gm,
    ) ?? []
  return statements.join("\n")
}

/** fast-check: the failing test copied into its own, named, running only the counterexample. */
function fastCheck(c: Counterexample, src: string): Regression | undefined {
  if (!c.test || !c.file) return undefined
  const quoted = new RegExp(String.raw`\b(it|test)\s*\(\s*(["'\`])${c.test.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\2`)
  const m = quoted.exec(src)
  if (!m) return undefined
  const open = src.indexOf("(", m.index)
  const close = closing(src, open)
  if (close < 0) return undefined
  let block = src.slice(m.index, close + 1)
  const name = `regression: ${c.test} for ${c.example}`
  block = block.replace(quoted, `$1(${JSON.stringify(name)}`)
  const at = block.indexOf("fc.assert(")
  if (at < 0) return undefined
  const aOpen = at + "fc.assert".length
  const aClose = closing(block, aOpen)
  if (aClose < 0) return undefined
  const commas = topCommas(block, aOpen, aClose)
  const only = `examples: [${c.example}], numRuns: 0`
  if (commas.length === 0) block = `${block.slice(0, aClose)}, { ${only} }${block.slice(aClose)}`
  else if (commas.length === 1) {
    const second = block.slice(commas[0]! + 1, aClose).trim()
    block = `${block.slice(0, commas[0]! + 1)} { ...(${second}), ${only} }${block.slice(aClose)}`
  } else return undefined
  const ext = path.extname(c.file)
  const base = path.basename(c.file).replace(/\.(test|spec)\.[cm]?[jt]sx?$/, "")
  return {
    file: `${base}.regression-${slugOf(c.example)}.test${ext}`,
    name,
    content: `// A regression test pinned by Codehouse from a fast-check counterexample (D-008). Locked: change it only with the person.\n${jsImports(src)}\n\n${block}\n`,
  }
}

/** Hypothesis: the failing test copied into its own, named, running only the falsifying example. */
function hypothesis(c: Counterexample, src: string): Regression | undefined {
  if (!c.test || !c.file) return undefined
  const lines = src.split("\n")
  const def = lines.findIndex((l) => new RegExp(String.raw`^def ${c.test}\s*\(`).test(l))
  if (def < 0) return undefined
  let start = def
  while (start > 0 && /^@/.test(lines[start - 1]!)) start--
  let end = def + 1
  while (end < lines.length && (lines[end]!.trim() === "" || /^\s/.test(lines[end]!))) end++
  const decorators = lines.slice(start, def).filter((l) => !/^@settings\b/.test(l))
  const body = lines.slice(def, end).join("\n").replace(new RegExp(String.raw`^def ${c.test}\b`), `def ${c.test}_regression_${slugOf(c.example).replace(/-/g, "_")}`)
  const imports = lines.filter((l) => /^(import |from \S+ import )/.test(l)).join("\n")
  const name = `${c.test} regression for ${c.example}`
  return {
    file: `${path.basename(c.file).replace(/\.py$/, "")}_regression_${slugOf(c.example).replace(/-/g, "_")}.py`,
    name,
    content: `# A regression test pinned by Codehouse from a Hypothesis counterexample (D-008). Locked: change it only with the person.\n${imports}\nfrom hypothesis import Phase, example, settings\n\n\n@example(${c.example})\n@settings(phases=[Phase.explicit])\n${decorators.join("\n")}${decorators.length ? "\n" : ""}${body.trimEnd()}\n`,
  }
}

/** The regression test Codehouse can write itself, or undefined when Claude is to write it. */
export function regressionFor(c: Counterexample, source: string): Regression | undefined {
  if (c.framework === "fast-check") return fastCheck(c, source)
  if (c.framework === "hypothesis") return hypothesis(c, source)
  return undefined
}

/** What Claude is asked when Codehouse cannot write the regression itself. */
export function regressionPrompt(c: Counterexample, file: string): string {
  return `A ${c.framework} run found this counterexample: ${c.example}${c.test ? ` (in ${c.test})` : ""}. Write one regression test for it, and only that, in the new file ${file}: name it after what it checks, make it check exactly this counterexample, and change no other file. Codehouse locks the file once it is written.`
}
