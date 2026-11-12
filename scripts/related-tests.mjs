// The test files that import any of the given files, directly or through other files, found by reading the imports
// (no test runs). The gate uses it when memory is short (owner, 12 Nov: the test period had grown very large): the
// same narrow set vitest related would choose, each file then run in a process of its own (test-shards.mjs), instead
// of every test in the repository.
//
//   node scripts/related-tests.mjs apps/host/src/budgets.ts ...   prints the test files, one to a line
//
// It follows static imports, re-exports, dynamic import() and require() with a literal path, and vi.mock() paths;
// relative paths (.js written for .ts included) and the @gatehouse packages (scripts/workspace-aliases.mjs). An import
// it cannot resolve is a package from node_modules, which a change in the repository cannot affect.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { workspaceEntries } from "./workspace-aliases.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/
const TEST = /\.test\.(ts|tsx|mts|js|mjs)$/
const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bvi\.(?:mock|doMock|importActual)\s*\(\s*)["'`]([^"'`\n]+)["'`]/g

const rel = (abs) => path.relative(root, abs).split(path.sep).join("/")

/** Every code file in the workspaces (src and test) and scripts. */
export function codeFiles(base = root) {
  const out = []
  const walk = (d) => {
    let entries
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue
      const full = path.join(d, e.name)
      if (e.isDirectory()) walk(full)
      else if (CODE.test(e.name) && !e.name.endsWith(".d.ts")) out.push(full)
    }
  }
  for (const group of ["apps", "packages"]) {
    const dir = path.join(base, group)
    if (fs.existsSync(dir)) for (const ws of fs.readdirSync(dir)) for (const sub of ["src", "test"]) walk(path.join(dir, ws, sub))
  }
  walk(path.join(base, "scripts"))
  return out
}

const entries = workspaceEntries()

function tryFile(p) {
  const tries = [p, p.replace(/\.(m|c)?js$/, ".$1ts"), p.replace(/\.js$/, ".tsx"), `${p}.ts`, `${p}.tsx`, `${p}.mts`, `${p}.js`, `${p}.mjs`, path.join(p, "index.ts"), path.join(p, "index.tsx"), path.join(p, "index.js")]
  for (const t of tries)
    try {
      if (fs.statSync(t).isFile()) return path.resolve(t)
    } catch {
      // not this one
    }
  return undefined
}

/** The file an import names, or undefined for a package outside the repository. */
export function resolveImport(fromFile, spec) {
  if (spec.startsWith(".")) return tryFile(path.resolve(path.dirname(fromFile), spec))
  const hit = entries.find(([name]) => spec === name)
  if (hit) return tryFile(hit[1])
  // A subpath the package does not list (@gatehouse/shared/x): its src folder.
  const pkg = entries.find(([name]) => spec.startsWith(`${name}/`) && name.split("/").length === 2)
  if (pkg) return tryFile(path.join(path.dirname(pkg[1]), spec.slice(pkg[0].length + 1)))
  return undefined
}

/** The test files that reach any of `changed` (paths from the repository root) through their imports. */
export function relatedTests(changed, files = codeFiles()) {
  const importers = new Map()
  for (const f of files) {
    let text
    try {
      text = fs.readFileSync(f, "utf8")
    } catch {
      continue
    }
    for (const m of text.matchAll(SPEC)) {
      const to = resolveImport(f, m[1])
      if (!to) continue
      const key = rel(to)
      if (!importers.has(key)) importers.set(key, new Set())
      importers.get(key).add(rel(f))
    }
  }
  const seen = new Set()
  const queue = changed.map((c) => c.replace(/\\/g, "/"))
  while (queue.length) {
    const f = queue.shift()
    if (seen.has(f)) continue
    seen.add(f)
    for (const i of importers.get(f) ?? []) queue.push(i)
  }
  return [...seen].filter((f) => TEST.test(f) && /^(apps|packages)\/[^/]+\/test\//.test(f)).sort()
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const t of relatedTests(process.argv.slice(2))) console.log(t)
}
