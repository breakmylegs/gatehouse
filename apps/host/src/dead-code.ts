import fs from "node:fs"
import path from "node:path"

/**
 * D-068 (frontier, Insight and evidence): dead code, with its evidence. In a project's JavaScript and TypeScript:
 *   - named exports no other file names, and their own file names only where they are declared;
 *   - named exports only tests name (kept apart: a test keeping code alive is not a use);
 *   - files nothing imports that are not an entry point (a package's main, bin, exports or scripts, a page's
 *     script tag, a config file, an index, a script or a test).
 * Each comes with the static evidence, and with the tests' coverage when the project has a report (Istanbul's
 * coverage-final.json or lcov.info under a coverage folder): never run, run, or not in the report, and how old the
 * report is. Removal is proposed in small slices, one file and at most five names at a time, to hand to a session.
 * It reads files only and changes nothing. A name used through a string, reflection or a framework's convention is
 * not seen, so every candidate says what it rests on and the slices ask for the tests to run after each.
 */
const CODE = /\.(m|c)?[tj]sx?$/
const SKIP = /(^|\/)(node_modules|dist|build|out|coverage|\.next|\.git|vendor)\//
const DECL = /\.d\.ts$/
const TEST = /(\.(test|spec)\.(m|c)?[tj]sx?$)|(^|\/)(__tests__|tests?|e2e)\//
const ENTRY_NAME = /(^|\/)(index|main|server|cli|app|bin|worker|preload)\.(m|c)?[tj]sx?$|\.config\.(m|c)?[tj]s$|(^|\/)(scripts|bin)\//
const EXPORT = /^\s*export\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm
const EXPORT_LIST = /^\s*export\s*\{([^}]*)\}\s*(?!\s*from)(?:;|$)/gm
const IMPORT_SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bvi\.(?:mock|doMock)\s*\(\s*)["'`](\.{1,2}\/[^"'`\n]+)["'`]/g
const WORD = /[A-Za-z_$][\w$]*/g

export type Coverage = "never run" | "run" | "not in the report"
export interface DeadName {
  name: string
  kind: string
  file: string
  line: number
  /** "unreferenced": nothing else names it; "tests-only": only tests do. */
  why: "unreferenced" | "tests-only"
  evidence: string
  coverage?: { state: Coverage; calls?: number }
}
export interface DeadFile {
  file: string
  evidence: string
  coverage?: { state: Coverage }
}
export interface Slice {
  title: string
  file: string
  names: string[]
  prompt: string
}
export interface DeadCodeReport {
  scope: { root: string; files: number; tests: number; leftOut: string[] }
  coverage?: { report: string; ageDays: number }
  names: DeadName[]
  files: DeadFile[]
  slices: Slice[]
}

interface FileCoverage {
  fns: Array<{ name: string; line: number; calls: number }>
  ran: boolean
}

/** The project's coverage, by file relative to the root, from the newest report found. */
export function readCoverage(root: string): { report: string; mtime: number; files: Map<string, FileCoverage> } | undefined {
  const found: Array<{ abs: string; mtime: number }> = []
  const look = (dir: string, depth: number) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name)
      if (e.isDirectory() && e.name === "coverage") {
        for (const n of ["coverage-final.json", "lcov.info"]) {
          const f = path.join(abs, n)
          if (fs.existsSync(f)) found.push({ abs: f, mtime: fs.statSync(f).mtimeMs })
        }
      } else if (e.isDirectory() && depth > 0 && !/^(node_modules|\.git|dist|build)$/.test(e.name)) look(abs, depth - 1)
    }
  }
  look(root, 2)
  const newest = found.sort((a, b) => b.mtime - a.mtime)[0]
  if (!newest) return undefined
  const rel = (p: string) => path.relative(root, path.resolve(path.dirname(path.dirname(newest.abs)), p)).split(path.sep).join("/")
  const files = new Map<string, FileCoverage>()
  try {
    const text = fs.readFileSync(newest.abs, "utf8")
    if (newest.abs.endsWith(".json")) {
      const json = JSON.parse(text) as Record<string, { path?: string; fnMap?: Record<string, { name: string; loc?: { start?: { line?: number } } }>; f?: Record<string, number>; s?: Record<string, number> }>
      for (const [key, v] of Object.entries(json)) {
        const fns = Object.entries(v.fnMap ?? {}).map(([id, fn]) => ({ name: fn.name, line: fn.loc?.start?.line ?? 0, calls: v.f?.[id] ?? 0 }))
        files.set(rel(v.path ?? key), { fns, ran: Object.values(v.s ?? {}).some((n) => n > 0) })
      }
    } else {
      let cur: (FileCoverage & { lines: Map<string, number> }) | undefined
      for (const line of text.split(/\r?\n/)) {
        if (line.startsWith("SF:")) {
          cur = { fns: [], ran: false, lines: new Map() }
          files.set(rel(line.slice(3)), cur)
        } else if (cur && line.startsWith("FN:")) {
          const [l, name] = line.slice(3).split(",")
          cur.lines.set(name ?? "", Number(l))
          cur.fns.push({ name: name ?? "", line: Number(l), calls: 0 })
        } else if (cur && line.startsWith("FNDA:")) {
          const [n, name] = line.slice(5).split(",")
          const fn = cur.fns.find((f) => f.name === name)
          if (fn) fn.calls = Number(n)
        } else if (cur && line.startsWith("DA:") && Number(line.split(",")[1]) > 0) cur.ran = true
      }
    }
  } catch {
    return undefined
  }
  return { report: path.relative(root, newest.abs).split(path.sep).join("/"), mtime: newest.mtime, files }
}

/** The strings a project names its entry points with: package.json main, bin, exports, scripts; html script tags. */
function entryText(root: string, files: string[]): string {
  const parts: string[] = []
  for (const f of files)
    if (/(^|\/)package\.json$/.test(f) || /\.html?$/.test(f))
      try {
        const text = fs.readFileSync(path.join(root, f), "utf8")
        if (f.endsWith(".json")) {
          const pkg = JSON.parse(text) as Record<string, unknown>
          const dir = path.posix.dirname(f)
          parts.push(JSON.stringify([pkg.main, pkg.module, pkg.bin, pkg.exports, pkg.scripts]).replace(/\.\//g, dir === "." ? "" : `${dir}/`), dir)
        } else for (const m of text.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/g)) parts.push(path.posix.join(path.posix.dirname(f), m[1]!.replace(/^\//, "")))
      } catch {
        // unreadable: no entries from it
      }
  return parts.join("\n")
}

function resolveImport(from: string, spec: string, all: Set<string>): string | undefined {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec))
  const noExt = base.replace(/\.(m|c)?js$/, "")
  for (const c of [base, `${noExt}.ts`, `${noExt}.tsx`, `${noExt}.mts`, `${noExt}.js`, `${noExt}.jsx`, `${noExt}.mjs`, `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`])
    if (all.has(c)) return c
  return undefined
}

const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length

/** The report for a project, from its file list (as git lists it). */
export function deadCode(root: string, listed: string[], now = Date.now()): DeadCodeReport {
  const files = listed.filter((f) => CODE.test(f) && !SKIP.test(f) && !DECL.test(f)).slice(0, 8000)
  const texts = new Map<string, string>()
  for (const f of files)
    try {
      const abs = path.join(root, f)
      if (fs.statSync(abs).size <= 1_000_000) texts.set(f, fs.readFileSync(abs, "utf8"))
    } catch {
      // gone since
    }
  const all = new Set(texts.keys())
  const tests = [...all].filter((f) => TEST.test(f))
  const entries = entryText(root, listed)
  const isEntry = (f: string) => ENTRY_NAME.test(f) || entries.includes(f) || entries.includes(f.replace(/\.(m|c)?[tj]sx?$/, ""))

  // Every named export (not default ones: a framework may call those by convention), and who imports whom.
  const exported: Array<{ name: string; kind: string; file: string; line: number }> = []
  const imported = new Set<string>()
  for (const [f, text] of texts) {
    for (const m of text.matchAll(IMPORT_SPEC)) {
      const to = resolveImport(f, m[1]!, all)
      if (to && to !== f) imported.add(to)
    }
    // A package's public entry keeps its exports for whoever installs it.
    if (TEST.test(f) || isEntry(f)) continue
    for (const m of text.matchAll(EXPORT)) exported.push({ name: m[2]!, kind: m[1]!.replace("*", ""), file: f, line: lineOf(text, m.index) })
    for (const m of text.matchAll(EXPORT_LIST))
      for (const part of m[1]!.split(",")) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim()
        if (name && /^[A-Za-z_$][\w$]*$/.test(name) && name !== "default") exported.push({ name, kind: "name", file: f, line: lineOf(text, m.index) })
      }
  }

  // How often each exported name appears as a word in each file.
  const wanted = new Set(exported.map((e) => e.name))
  const uses = new Map<string, Map<string, number>>()
  for (const [f, text] of texts)
    for (const m of text.matchAll(WORD)) {
      if (!wanted.has(m[0])) continue
      const byFile = uses.get(m[0]) ?? new Map<string, number>()
      byFile.set(f, (byFile.get(f) ?? 0) + 1)
      uses.set(m[0], byFile)
    }

  const cov = readCoverage(root)
  const covOf = (file: string, name: string, line: number): DeadName["coverage"] => {
    if (!cov) return undefined
    const fc = cov.files.get(file)
    if (!fc) return { state: "not in the report" }
    const fn = fc.fns.find((x) => x.name === name) ?? fc.fns.find((x) => x.line === line)
    if (!fn) return fc.ran ? undefined : { state: "never run" }
    return fn.calls > 0 ? { state: "run", calls: fn.calls } : { state: "never run", calls: 0 }
  }

  const deadFiles: DeadFile[] = []
  for (const f of all) {
    if (TEST.test(f) || isEntry(f) || imported.has(f)) continue
    const fc = cov?.files.get(f)
    const coverage = cov ? { state: (!fc ? "not in the report" : fc.ran ? "run" : "never run") as Coverage } : undefined
    deadFiles.push({ file: f, evidence: "No file imports it, and no package.json, page or script names it as an entry point.", ...(coverage ? { coverage } : {}) })
  }

  // A name in a file nothing imports goes with its file's slice.
  const deadSet = new Set(deadFiles.map((d) => d.file))
  const names: DeadName[] = []
  for (const e of exported) {
    if (deadSet.has(e.file)) continue
    const byFile = uses.get(e.name) ?? new Map<string, number>()
    const own = byFile.get(e.file) ?? 0
    const others = [...byFile.keys()].filter((f) => f !== e.file)
    // Used in its own file beyond the declaration: the export may be needless, but the code is alive.
    if (own > 1) continue
    const testOnly = others.length > 0 && others.every((f) => TEST.test(f))
    if (others.length && !testOnly) continue
    const coverage = covOf(e.file, e.name, e.line)
    names.push({
      ...e,
      why: testOnly ? "tests-only" : "unreferenced",
      evidence: testOnly
        ? `Only tests name it: ${others.slice(0, 3).join(", ")}${others.length > 3 ? ` and ${others.length - 3} more` : ""}.`
        : "No other file names it, and its own file names it only where it is declared.",
      ...(coverage ? { coverage } : {}),
    })
  }

  // Strongest first: nothing names it and the tests never run it; then unreferenced; then tests only.
  const weight = (n: DeadName) => (n.why === "unreferenced" ? 0 : 2) + (n.coverage?.state === "never run" ? 0 : 1)
  names.sort((a, b) => weight(a) - weight(b) || a.file.localeCompare(b.file) || a.line - b.line)
  deadFiles.sort((a, b) => a.file.localeCompare(b.file))

  const slices: Slice[] = []
  for (const d of deadFiles.slice(0, 10))
    slices.push({
      title: `Remove ${d.file}`,
      file: d.file,
      names: [],
      prompt: `Remove the file ${d.file}: no file imports it and nothing names it as an entry point${d.coverage?.state === "never run" || d.coverage?.state === "not in the report" ? ", and the tests never load it" : ""}. Check first that nothing loads it by a path built at run time. Remove only this file, then run the tests and the type-check.`,
    })
  const byFile = new Map<string, DeadName[]>()
  for (const n of names) if (n.why === "unreferenced") byFile.set(n.file, [...(byFile.get(n.file) ?? []), n])
  for (const [file, ns] of byFile)
    for (let i = 0; i < ns.length && slices.length < 30; i += 5) {
      const part = ns.slice(i, i + 5)
      const list = part.map((n) => n.name).join(", ")
      slices.push({
        title: `Remove ${list} from ${file}`,
        file,
        names: part.map((n) => n.name),
        prompt: `Remove the unused ${list} from ${file}: no other file names ${part.length === 1 ? "it" : "them"}${part.every((n) => n.coverage?.state === "never run") ? ", and the tests never run " + (part.length === 1 ? "it" : "them") : ""}. Check first that nothing reaches ${part.length === 1 ? "it" : "them"} by a string or a framework's convention. Remove only these, and anything that only they used, then run the tests for ${file} and the type-check.`,
    })
    }

  return {
    scope: { root: path.basename(root), files: all.size, tests: tests.length, leftOut: ["dependencies and builds", "declaration files", "default exports", "files over 1 MB", "languages other than JavaScript and TypeScript"] },
    ...(cov ? { coverage: { report: cov.report, ageDays: Math.floor((now - cov.mtime) / 86_400_000) } } : {}),
    names: names.slice(0, 300),
    files: deadFiles.slice(0, 100),
    slices,
  }
}
