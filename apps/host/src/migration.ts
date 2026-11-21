/**
 * D-067, a migration planner with evidence (Frontier build). A migration (to ES modules, to TypeScript, a framework's
 * new version) is split into waves from the files' own imports, leaves first: a wave's files import only files of
 * earlier waves (an import cycle is one wave). Before a wave changes, each of its files that exports a function has its
 * behaviour captured (D-066); after, the same inputs are replayed against it (D-006). A wave counts as done only when
 * every such file has both, and what changed is shown in words. The plan and its evidence are kept in the data folder.
 * Claude can be asked to do one wave at a time, touching only that wave's files.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "@gatehouse/shared/node"
import type { BehaviourDelta, Capture } from "./characterise.js"

export interface WaveFile {
  file: string
  /** Whether it exports a function the capture can call; one that does not is covered by the project's tests only. */
  callable: boolean
  captured?: string
  compared?: string
  deltas?: BehaviourDelta[]
}

export interface Wave {
  n: number
  files: WaveFile[]
}

export interface MigrationPlan {
  v: 1
  id: string
  goal: string
  createdAt: string
  waves: Wave[]
}

const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/i
const EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]

/** The files of the set a file imports, by relative import or require. */
export function importsWithin(file: string, text: string, set: Set<string>): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(/(?:import|export)\s[^'"]*?from\s*["'](\.{1,2}\/[^"']+)["']|import\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)|require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)) {
    const spec = (m[1] ?? m[2] ?? m[3])!
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec))
    const stem = base.replace(/\.(?:[cm]?js|jsx)$/i, "")
    const hit = [base, ...EXTS.map((e) => stem + e), ...EXTS.map((e) => `${base}/index${e}`)].find((c) => set.has(c))
    if (hit && hit !== file) out.add(hit)
  }
  return [...out]
}

/** Waves, leaves first: each file comes after every file of the set it imports; files in a cycle share a wave. */
export function wavesOf(files: Array<{ file: string; text: string }>): string[][] {
  const set = new Set(files.map((f) => f.file))
  const deps = new Map(files.map((f) => [f.file, new Set(importsWithin(f.file, f.text, set))]))
  const done = new Set<string>()
  const waves: string[][] = []
  while (done.size < set.size) {
    const ready = [...set].filter((f) => !done.has(f) && [...deps.get(f)!].every((d) => done.has(d))).sort()
    if (ready.length) {
      waves.push(ready)
      ready.forEach((f) => done.add(f))
      continue
    }
    // A cycle: the smallest group of what is left that reaches only itself and what is done.
    const left = [...set].filter((f) => !done.has(f)).sort()
    const reach = (f: string) => {
      const seen = new Set([f])
      const stack = [f]
      while (stack.length) for (const d of deps.get(stack.pop()!)!) if (!done.has(d) && !seen.has(d)) (seen.add(d), stack.push(d))
      return seen
    }
    const groups = left.map((f) => [...reach(f)].sort())
    const smallest = groups.reduce((a, b) => (b.length < a.length ? b : a))
    waves.push(smallest)
    smallest.forEach((f) => done.add(f))
  }
  return waves
}

/** The source files of a folder in the project, at most 300, tests and build output left out. */
export function sourcesIn(root: string, folder: string): string[] {
  const out: string[] = []
  const stack = [path.join(root, folder)]
  while (stack.length && out.length < 300) {
    const dir = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (!["node_modules", ".git", "dist", "build", "coverage", "out"].includes(e.name)) stack.push(p)
      } else if (SOURCE.test(e.name) && !/\.(test|spec)\./i.test(e.name) && !e.name.endsWith(".d.ts")) out.push(path.relative(root, p).replace(/\\/g, "/"))
    }
  }
  return out.sort()
}

export async function planMigration(o: {
  root: string
  goal: string
  files: string[]
  callable: (file: string, text: string) => Promise<boolean>
  now?: () => Date
}): Promise<MigrationPlan> {
  const read = o.files.map((file) => ({ file, text: fs.readFileSync(path.join(o.root, file), "utf8") }))
  const texts = new Map(read.map((r) => [r.file, r.text]))
  const waves: Wave[] = []
  for (const [i, files] of wavesOf(read).entries())
    waves.push({ n: i + 1, files: await Promise.all(files.map(async (file) => ({ file, callable: await o.callable(file, texts.get(file)!) }))) })
  return { v: 1, id: crypto.randomBytes(6).toString("hex"), goal: o.goal.trim().slice(0, 300), createdAt: (o.now ?? (() => new Date()))().toISOString(), waves }
}

/** Where a wave stands: its files still to capture, still to compare, and whether it is done (evidenced). */
export function waveState(w: Wave): { toCapture: string[]; toCompare: string[]; done: boolean; changed: number } {
  const callable = w.files.filter((f) => f.callable)
  const toCapture = callable.filter((f) => !f.captured).map((f) => f.file)
  const toCompare = callable.filter((f) => f.captured && !f.compared).map((f) => f.file)
  return { toCapture, toCompare, done: !toCapture.length && !toCompare.length, changed: callable.reduce((n, f) => n + (f.deltas?.length ?? 0), 0) }
}

/** The prompt that asks Claude to do one wave and nothing else. */
export function wavePrompt(plan: MigrationPlan, n: number): string {
  const w = plan.waves.find((x) => x.n === n)
  if (!w) throw new Error(`There is no wave ${n}.`)
  return [
    `Migration: ${plan.goal}`,
    `Do wave ${n} of ${plan.waves.length} only. Change these files and no others:`,
    ...w.files.map((f) => `- ${f.file}`),
    "Keep what each exported function returns the same unless the migration needs it to change, and say so where it does. Their behaviour was captured before this wave and is compared after it.",
  ].join("\n")
}

export class MigrationStore {
  constructor(private readonly dir: string) {}

  #file(id: string): string {
    if (!/^[0-9a-f]{12}$/.test(id)) throw new Error("That is not a migration plan.")
    return path.join(this.dir, `${id}.json`)
  }

  async save(plan: MigrationPlan): Promise<void> {
    fs.mkdirSync(this.dir, { recursive: true })
    await writeFileAtomic(this.#file(plan.id), JSON.stringify(plan, null, 1))
  }

  get(id: string): MigrationPlan {
    return JSON.parse(fs.readFileSync(this.#file(id), "utf8")) as MigrationPlan
  }

  captureFile(id: string, file: string): string {
    return path.join(this.dir, id, `${crypto.createHash("sha256").update(file).digest("hex").slice(0, 16)}.json`)
  }

  /** Keeps a file's capture before its wave changes. */
  async captured(plan: MigrationPlan, file: string, cap: Capture): Promise<void> {
    const f = plan.waves.flatMap((w) => w.files).find((x) => x.file === file)
    if (!f) throw new Error(`${file} is not in this plan.`)
    const at = this.captureFile(plan.id, file)
    fs.mkdirSync(path.dirname(at), { recursive: true })
    await writeFileAtomic(at, JSON.stringify(cap))
    f.captured = cap.createdAt
    delete f.compared
    delete f.deltas
    await this.save(plan)
  }

  capture(plan: MigrationPlan, file: string): Capture {
    return JSON.parse(fs.readFileSync(this.captureFile(plan.id, file), "utf8")) as Capture
  }

  /** Keeps what changed when the capture was replayed after the wave. */
  async compared(plan: MigrationPlan, file: string, deltas: BehaviourDelta[], at = new Date()): Promise<void> {
    const f = plan.waves.flatMap((w) => w.files).find((x) => x.file === file)
    if (!f?.captured) throw new Error(`Capture ${file} before its wave first.`)
    f.compared = at.toISOString()
    f.deltas = deltas.slice(0, 50)
    await this.save(plan)
  }
}
