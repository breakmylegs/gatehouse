/**
 * D-042 and D-043 (Frontier build, Wave 3): the project's architecture as it is, drawn from D-041's import graph, and
 * what changed since you last approved it. Modules are folders (src/domain, src/app...); the C4 diagrams are Mermaid:
 * context (the project and the packages it uses), containers (its layers, or its top folders when it has no rules) and
 * components (its modules), each new module since the approved version marked as drift. The drift alerts are a new
 * module, a new edge that crosses a layer boundary, and a new import cycle between modules.
 */
import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "@gatehouse/shared/node"
import type { ArchGraph } from "./architecture.js"

export interface ModuleGraph {
  v: 1
  modules: Record<string, { layer?: string; files: number }>
  /** "from -> to", between modules. */
  edges: string[]
  packages: string[]
}

/** A file's module: its folder, at most two deep (src/domain), or the file's own folder. */
export const moduleOf = (file: string) => {
  const parts = file.replace(/\\/g, "/").split("/").slice(0, -1)
  return parts.slice(0, 2).join("/") || "."
}

export function modulesOf(g: ArchGraph): ModuleGraph {
  const modules: ModuleGraph["modules"] = {}
  const edges = new Set<string>()
  const packages = new Set<string>()
  for (const [file, f] of Object.entries(g.files)) {
    const m = moduleOf(file)
    modules[m] ??= { files: 0, ...(f.layer ? { layer: f.layer } : {}) }
    modules[m]!.files++
    for (const to of f.internal) {
      const t = moduleOf(to)
      if (t !== m) edges.add(`${m} -> ${t}`)
    }
    for (const spec of f.imports) if (!spec.startsWith(".")) packages.add(spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!.replace(/^node:/, "node:"))
  }
  return { v: 1, modules, edges: [...edges].sort(), packages: [...packages].sort() }
}

/** The cycles between modules: each strongly connected set of two or more, sorted. */
export function cyclesOf(g: ModuleGraph): string[][] {
  const next = new Map<string, string[]>()
  for (const e of g.edges) {
    const [a, b] = e.split(" -> ") as [string, string]
    next.set(a, [...(next.get(a) ?? []), b])
  }
  let i = 0
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const stack: string[] = []
  const on = new Set<string>()
  const out: string[][] = []
  const visit = (v: string) => {
    index.set(v, i)
    low.set(v, i++)
    stack.push(v)
    on.add(v)
    for (const w of next.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w)
        low.set(v, Math.min(low.get(v)!, low.get(w)!))
      } else if (on.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!))
    }
    if (low.get(v) === index.get(v)) {
      const scc: string[] = []
      let w: string
      do {
        w = stack.pop()!
        on.delete(w)
        scc.push(w)
      } while (w !== v)
      if (scc.length > 1) out.push(scc.sort())
    }
  }
  for (const m of Object.keys(g.modules)) if (!index.has(m)) visit(m)
  return out.sort((a, b) => a.join().localeCompare(b.join()))
}

export interface Drift {
  newModules: string[]
  /** New edges between modules of different layers. */
  newCrossings: string[]
  newCycles: string[][]
}

export function driftOf(now: ModuleGraph, approved: ModuleGraph | undefined): Drift {
  if (!approved) return { newModules: [], newCrossings: [], newCycles: [] }
  const layer = (m: string) => now.modules[m]?.layer
  const had = new Set(approved.edges)
  const oldCycles = new Set(cyclesOf(approved).map((c) => c.join(",")))
  return {
    newModules: Object.keys(now.modules).filter((m) => !approved.modules[m]).sort(),
    newCrossings: now.edges.filter((e) => {
      if (had.has(e)) return false
      const [a, b] = e.split(" -> ") as [string, string]
      return layer(a) !== undefined && layer(b) !== undefined && layer(a) !== layer(b)
    }),
    newCycles: cyclesOf(now).filter((c) => !oldCycles.has(c.join(","))),
  }
}

const id = (s: string) => s.replace(/[^A-Za-z0-9]/g, "_") || "root"
const label = (s: string) => s.replace(/"/g, "'")

/** The three C4 diagrams, in Mermaid, new modules since the approved version marked as drift. */
export function c4Diagrams(project: string, g: ModuleGraph, drift: Drift): { context: string; container: string; component: string } {
  const pkgs = g.packages.filter((p) => !p.startsWith("node:")).slice(0, 25)
  const context = [
    "C4Context",
    `  title ${label(project)}: context`,
    `  System(sys, "${label(project)}", "The project")`,
    ...pkgs.map((p) => `  System_Ext(${id(`pkg_${p}`)}, "${label(p)}", "package")`),
    ...pkgs.map((p) => `  Rel(sys, ${id(`pkg_${p}`)}, "uses")`),
  ].join("\n")
  const groups = new Map<string, string[]>()
  for (const [m, info] of Object.entries(g.modules)) {
    const key = info.layer ?? m.split("/")[0] ?? m
    groups.set(key, [...(groups.get(key) ?? []), m])
  }
  const groupOf = (m: string) => g.modules[m]?.layer ?? m.split("/")[0] ?? m
  const crossing = new Set<string>()
  for (const e of g.edges) {
    const [a, b] = e.split(" -> ") as [string, string]
    if (groupOf(a) !== groupOf(b)) crossing.add(`${groupOf(a)} -> ${groupOf(b)}`)
  }
  const container = [
    "C4Container",
    `  title ${label(project)}: containers`,
    `  System_Boundary(sys, "${label(project)}") {`,
    ...[...groups.keys()].map((k) => `    Container(${id(`c_${k}`)}, "${label(k)}", "", "${groups.get(k)!.length} module(s)")`),
    "  }",
    ...[...crossing].map((e) => {
      const [a, b] = e.split(" -> ") as [string, string]
      return `  Rel(${id(`c_${a}`)}, ${id(`c_${b}`)}, "depends on")`
    }),
  ].join("\n")
  const isNew = new Set(drift.newModules)
  const component = [
    "C4Component",
    `  title ${label(project)}: components`,
    ...[...groups.entries()].flatMap(([k, ms]) => [
      `  Container_Boundary(${id(`b_${k}`)}, "${label(k)}") {`,
      ...ms.map((m) => `    Component(${id(`m_${m}`)}, "${label(m)}${isNew.has(m) ? " (new)" : ""}", "", "${g.modules[m]!.files} file(s)")`),
      "  }",
    ]),
    ...g.edges.map((e) => {
      const [a, b] = e.split(" -> ") as [string, string]
      return `  Rel(${id(`m_${a}`)}, ${id(`m_${b}`)}, "imports")`
    }),
    // Drift since the approved version, in the diagram's own styling.
    ...drift.newModules.map((m) => `  UpdateElementStyle(${id(`m_${m}`)}, $bgColor="#b91c1c", $fontColor="#ffffff", $borderColor="#7f1d1d")`),
  ].join("\n")
  return { context, container, component }
}

const approvedFile = (root: string) => path.join(root, ".codehouse", "arch", "approved.json")

export function readApproved(root: string): ModuleGraph | undefined {
  try {
    const g = JSON.parse(fs.readFileSync(approvedFile(root), "utf8")) as ModuleGraph
    return g.v === 1 && g.modules ? g : undefined
  } catch {
    return undefined
  }
}

/** You approved the architecture as it is now: drift is measured from here. */
export async function approve(root: string, g: ModuleGraph): Promise<void> {
  fs.mkdirSync(path.dirname(approvedFile(root)), { recursive: true })
  await writeFileAtomic(approvedFile(root), JSON.stringify(g, null, 1))
}
