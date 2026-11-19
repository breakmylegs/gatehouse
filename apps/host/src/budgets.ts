import fs from "node:fs"
import path from "node:path"
import { parse as parseYaml } from "yaml"
import { compileGlobs } from "@gatehouse/policy"

/**
 * D-049 (frontier, Insight and evidence): performance budgets for hot paths. A project sets them in
 * .codehouse/budgets.yml, each with the paths it guards and the most a benchmark may take on average:
 *
 *   budgets:
 *     - name: parse a large file            (the benchmark's name, as its tool reports it)
 *       paths: [src/parser/**]
 *       maxMeanMs: 2
 *
 * When an agent's change touches a budget's paths, its evidence pack (D-003) runs the project's benchmarks with the
 * tool the project uses (tinybench through Vitest's bench, or BenchmarkDotNet), as a Codehouse action (judged by the
 * rules, in a job at the session's level, stopped by the kill switch), and says which budgets held and which did not.
 */
export const BUDGETS_FILE = path.join(".codehouse", "budgets.yml")
export const RESULTS_FILE = path.join(".codehouse", "bench-results.json")

export interface Budget {
  name: string
  maxMeanMs: number
  touched: (file: string) => boolean
}

export function loadBudgets(root: string): Budget[] | string | undefined {
  const file = path.join(root, BUDGETS_FILE)
  if (!fs.existsSync(file)) return undefined
  let doc: unknown
  try {
    doc = parseYaml(fs.readFileSync(file, "utf8"))
  } catch (e) {
    return `${BUDGETS_FILE} is not YAML: ${(e as Error).message.split("\n")[0]}`
  }
  const list = (doc as { budgets?: unknown })?.budgets
  if (!Array.isArray(list)) return `${BUDGETS_FILE} needs a budgets list.`
  const out: Budget[] = []
  for (const b of list.slice(0, 100)) {
    const o = (b && typeof b === "object" ? b : {}) as { name?: unknown; paths?: unknown; maxMeanMs?: unknown }
    const globs = Array.isArray(o.paths) ? o.paths.filter((p): p is string => typeof p === "string" && p.length > 0) : []
    if (typeof o.name !== "string" || !o.name.trim() || typeof o.maxMeanMs !== "number" || !(o.maxMeanMs > 0) || !globs.length)
      return `Each budget in ${BUDGETS_FILE} needs a name, its paths and maxMeanMs.`
    out.push({ name: o.name.trim(), maxMeanMs: o.maxMeanMs, touched: compileGlobs(globs.map((g) => g.replace(/\\/g, "/").toLowerCase())) })
  }
  return out
}

export type BenchTool = "tinybench" | "benchmarkdotnet"

/** The benchmark tool the project uses, from its package.json and project files; undefined for none. */
export function detectTool(root: string): { tool: BenchTool; command: string } | undefined {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    if (deps.tinybench || deps.vitest) return { tool: "tinybench", command: `npx vitest bench --run --outputJson ${RESULTS_FILE.replace(/\\/g, "/")}` }
  } catch {
    // Not a Node project.
  }
  const csproj = fs
    .readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((f) => !/node_modules|[\\/]bin[\\/]|[\\/]obj[\\/]/.test(f) && f.endsWith(".csproj"))
    .find((f) => /<PackageReference\s+Include="BenchmarkDotNet"/i.test(fs.readFileSync(path.join(root, f), "utf8")))
  if (csproj) return { tool: "benchmarkdotnet", command: `dotnet run -c Release --project "${csproj}" -- --exporters json --filter "*"` }
  return undefined
}

/** Mean times in milliseconds by benchmark name, from Vitest's bench JSON (tinybench) or BenchmarkDotNet's JSON. */
export function meansOf(tool: BenchTool, json: unknown): Map<string, number> {
  const m = new Map<string, number>()
  const o = (json && typeof json === "object" ? json : {}) as Record<string, unknown>
  if (tool === "tinybench") {
    for (const file of Array.isArray(o.files) ? o.files : [])
      for (const group of Array.isArray((file as { groups?: unknown }).groups) ? (file as { groups: unknown[] }).groups : [])
        for (const b of Array.isArray((group as { benchmarks?: unknown }).benchmarks) ? (group as { benchmarks: unknown[] }).benchmarks : []) {
          const x = b as { name?: unknown; mean?: unknown }
          if (typeof x.name === "string" && typeof x.mean === "number") m.set(x.name, x.mean)
        }
  } else
    for (const b of Array.isArray(o.Benchmarks) ? o.Benchmarks : []) {
      const x = b as { Method?: unknown; FullName?: unknown; Statistics?: { Mean?: unknown } }
      const name = typeof x.Method === "string" ? x.Method : typeof x.FullName === "string" ? x.FullName : undefined
      // BenchmarkDotNet reports nanoseconds.
      if (name && typeof x.Statistics?.Mean === "number") m.set(name, x.Statistics.Mean / 1e6)
    }
  return m
}

export interface BudgetResult {
  name: string
  maxMeanMs: number
  meanMs?: number
  ok: boolean
  detail: string
}

/** The budgets a change touches, against the means measured. A budget with no matching benchmark is said so. */
export function checkBudgets(budgets: Budget[], files: string[], means: Map<string, number>): BudgetResult[] {
  const norm = files.map((f) => f.replace(/\\/g, "/").toLowerCase())
  return budgets
    .filter((b) => norm.some((f) => b.touched(f)))
    .map((b) => {
      const mean = means.get(b.name)
      if (mean === undefined) return { name: b.name, maxMeanMs: b.maxMeanMs, ok: false, detail: `No benchmark named "${b.name}" ran, so the budget could not be checked.` }
      const ok = mean <= b.maxMeanMs
      return { name: b.name, maxMeanMs: b.maxMeanMs, meanMs: Math.round(mean * 1000) / 1000, ok, detail: ok ? `${mean.toFixed(3)} ms on average, within ${b.maxMeanMs} ms.` : `${mean.toFixed(3)} ms on average, over its ${b.maxMeanMs} ms budget.` }
    })
}
