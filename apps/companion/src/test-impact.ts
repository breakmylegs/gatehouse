import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

/**
 * D-065 (frontier, Insight and evidence): test impact analysis for an agent's inner loop. The tests a change affects,
 * so a session can run those while it works, and the whole suite once before it says it is done:
 *   - imports: every test that reaches a changed file through relative imports (JavaScript and TypeScript, including
 *     re-exports, dynamic import(), require() and vi.mock(); Python's relative and module imports);
 *   - history: tests that changed in the same commits as a changed file, in the last 200 commits (not the first
 *     commit, merges or commits of more than 40 files).
 * Always a subset of the project's tests. Reads files and git log; runs nothing.
 */
export const TEST_FILE = /(\.(test|spec)\.(m|c)?[tj]sx?$)|(^|\/)(__tests__|tests?)\/.+\.(m|c)?[tj]sx?$|(^|\/)test_[^/]+\.py$|_test\.py$/
const CODE = /\.(m|c)?[tj]sx?$|\.py$/
const SKIP = /(^|\/)(node_modules|dist|build|\.git|\.venv|venv|coverage)(\/|$)/
const JS_SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bvi\.(?:mock|doMock)\s*\(\s*)["'`](\.{1,2}\/[^"'`\n]+)["'`]/g
const PY_SPEC = /^\s*(?:from\s+(\.+[\w.]*|[\w.]+)\s+import|import\s+([\w.]+))/gm

/** Every code file in the project, from its folder, skipping dependencies and builds. */
export function projectFiles(root: string, max = 20000): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (out.length >= max) return
      const abs = path.join(dir, e.name)
      const rel = path.relative(root, abs).split(path.sep).join("/")
      if (SKIP.test(rel)) continue
      if (e.isDirectory()) walk(abs)
      else if (CODE.test(e.name)) out.push(rel)
    }
  }
  walk(root)
  return out
}

/** The project files one file imports, by relative path. */
function importsOf(root: string, file: string, all: Set<string>): string[] {
  let text: string
  try {
    text = fs.readFileSync(path.join(root, file), "utf8")
  } catch {
    return []
  }
  const dir = path.posix.dirname(file)
  const found: string[] = []
  const tryPath = (base: string) => {
    const noExt = base.replace(/\.(m|c)?js$/, "")
    for (const c of [base, `${noExt}.ts`, `${noExt}.tsx`, `${noExt}.js`, `${noExt}.jsx`, `${noExt}.mjs`, `${base}/index.ts`, `${base}/index.js`, `${base}.py`, `${base}/__init__.py`])
      if (all.has(c)) return found.push(c)
  }
  if (file.endsWith(".py")) {
    for (const m of text.matchAll(PY_SPEC)) {
      const spec = m[1] ?? m[2] ?? ""
      const dots = /^\.+/.exec(spec)?.[0].length ?? 0
      const rest = spec.slice(dots).replace(/\./g, "/")
      const base = dots ? path.posix.join(dir, ...Array(dots - 1).fill(".."), rest) : rest
      tryPath(path.posix.normalize(base))
    }
  } else for (const m of text.matchAll(JS_SPEC)) tryPath(path.posix.normalize(path.posix.join(dir, m[1]!)))
  return found
}

/** The tests that reach any changed file through imports. */
export function byImports(root: string, changed: string[], files = projectFiles(root)): Set<string> {
  const all = new Set(files)
  // Who imports whom, turned round: for each file, the files that import it.
  const importers = new Map<string, string[]>()
  for (const f of files) for (const dep of importsOf(root, f, all)) importers.set(dep, [...(importers.get(dep) ?? []), f])
  const seen = new Set<string>()
  const queue = changed.filter((c) => all.has(c))
  for (const c of queue) seen.add(c)
  while (queue.length) {
    const f = queue.shift()!
    for (const i of importers.get(f) ?? [])
      if (!seen.has(i)) {
        seen.add(i)
        queue.push(i)
      }
  }
  return new Set([...seen].filter((f) => TEST_FILE.test(f)))
}

const MAX_COMMIT_FILES = 40

/** Tests that changed in the same commits as a changed file, in the last `commits` commits. */
export function byHistory(root: string, changed: string[], commits = 200): Set<string> {
  let out = ""
  try {
    out = execFileSync("git", ["-C", root, "log", `-n${commits}`, "--no-merges", "--name-only", "--format=%x00%P"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] })
  } catch {
    return new Set()
  }
  const want = new Set(changed)
  const tests = new Set<string>()
  for (const commit of out.split("\0")) {
    const [parents = "", ...rest] = commit.split(/\r?\n/)
    const files = rest.map((l) => l.trim()).filter(Boolean)
    // A first commit, or a bulk one (a rename, a format run), says nothing about which tests go with which file.
    if (!parents.trim() || files.length > MAX_COMMIT_FILES) continue
    if (files.some((f) => want.has(f))) for (const f of files) if (TEST_FILE.test(f) && fs.existsSync(path.join(root, f))) tests.add(f)
  }
  return tests
}

/** The affected tests, by imports and by history, and the project's whole set to compare with. */
export function affectedTests(root: string, changed: string[]): { tests: string[]; byImports: number; byHistory: number; all: number } {
  const files = projectFiles(root)
  const all = files.filter((f) => TEST_FILE.test(f))
  const norm = changed.map((c) => c.replace(/\\/g, "/"))
  const imp = byImports(root, norm, files)
  const hist = byHistory(root, norm)
  const allSet = new Set(all)
  // Never more than the project's own tests.
  const tests = [...new Set([...imp, ...hist])].filter((t) => allSet.has(t)).sort()
  return { tests, byImports: imp.size, byHistory: hist.size, all: all.length }
}
