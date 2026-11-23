/**
 * E-042, a memory leak detector (Expansion E4). A command of the project's is run once as a Codehouse action with a
 * small preload script (`--require`, written to a temporary folder) that takes heap snapshots with
 * v8.writeHeapSnapshot at intervals while the program works (not at exit, where its objects may already be gone). Each snapshot is read into the size and
 * count of the objects of each constructor; the constructors whose size grows from snapshot to snapshot, by enough to
 * matter, are reported, the largest growth first. Following section 10, no inspector port is opened (the preload only
 * writes files, and any --inspect in NODE_OPTIONS is taken out).
 *
 * Sizes are each object's own size summed by constructor (what a snapshot gives without building its dominator tree):
 * growth there is what a leak looks like from outside.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export const PRELOAD = `// Codehouse's heap snapshot preload (E-042): writes snapshots, opens nothing.
const v8 = require("node:v8"), path = require("node:path")
const dir = process.env.CODEH_HEAP_DIR, every = Number(process.env.CODEH_HEAP_EVERY_MS) || 1000, max = Number(process.env.CODEH_HEAP_COUNT) || 6
let n = 0
const take = () => {
  if (!dir || n >= max) return
  n++
  try { v8.writeHeapSnapshot(path.join(dir, "heap-" + process.pid + "-" + String(n).padStart(2, "0") + ".heapsnapshot")) } catch {}
}
const timer = setInterval(take, every)
timer.unref()
`

/** NODE_OPTIONS with every inspector flag taken out and the preload added. */
export function leakNodeOptions(existing: string | undefined, preload: string): string {
  const kept = (existing ?? "").split(/\s+/).filter((f) => f && !/^--(inspect|inspect-brk|inspect-port|inspect-publish-uid|debug|debug-brk|debug-port)(=|$)/.test(f))
  return [...kept, "--require", JSON.stringify(preload)].join(" ")
}

export interface ConstructorSize {
  name: string
  count: number
  bytes: number
}

/** A heap snapshot read into object size and count by constructor. */
export function readHeapSnapshot(json: { snapshot: { meta: { node_fields: string[]; node_types: unknown[] } }; nodes: number[]; strings: string[] }): Map<string, ConstructorSize> {
  const fields = json.snapshot.meta.node_fields
  const width = fields.length
  const iType = fields.indexOf("type")
  const iName = fields.indexOf("name")
  const iSize = fields.indexOf("self_size")
  const types = json.snapshot.meta.node_types[0] as string[]
  const out = new Map<string, ConstructorSize>()
  for (let i = 0; i < json.nodes.length; i += width) {
    const type = types[json.nodes[i + iType]!]
    if (type !== "object" && type !== "closure" && type !== "regexp" && type !== "native") continue
    const name = json.strings[json.nodes[i + iName]!] ?? "?"
    if (!name || name.startsWith("(") || name === "system / Context") continue
    const c = out.get(name) ?? { name, count: 0, bytes: 0 }
    c.count++
    c.bytes += json.nodes[i + iSize]!
    out.set(name, c)
  }
  return out
}

export interface Growth {
  name: string
  /** Size at each snapshot, in bytes. */
  bytes: number[]
  counts: number[]
  grewBy: number
}

/**
 * The constructors that grew at every step (or all but one), by at least 64 KB and a tenth of where they started, with no
 * drop larger than a quarter of their growth (a sawtooth is a cache filling and emptying, not a leak); largest first.
 */
export function growing(snapshots: Array<Map<string, ConstructorSize>>, minBytes = 64 * 1024): Growth[] {
  if (snapshots.length < 3) return []
  const names = new Set(snapshots.flatMap((s) => [...s.keys()]))
  const out: Growth[] = []
  for (const name of names) {
    const bytes = snapshots.map((s) => s.get(name)?.bytes ?? 0)
    const counts = snapshots.map((s) => s.get(name)?.count ?? 0)
    let rises = 0
    for (let i = 1; i < bytes.length; i++) if (bytes[i]! > bytes[i - 1]!) rises++
    const grewBy = bytes[bytes.length - 1]! - bytes[0]!
    let drop = 0
    for (let i = 1; i < bytes.length; i++) drop = Math.max(drop, bytes[i - 1]! - bytes[i]!)
    if (rises >= bytes.length - 2 && rises >= 2 && grewBy >= minBytes && grewBy >= bytes[0]! * 0.1 && drop <= grewBy / 4) out.push({ name, bytes, counts, grewBy })
  }
  return out.sort((a, b) => b.grewBy - a.grewBy).slice(0, 20)
}

export type LeakRun = (command: string, cwd: string, env: Record<string, string>) => Promise<{ ran: boolean; exitCode: number | null; output: string; refused?: string }>

/** Runs a command once with the preload, reads its snapshots, and reports what kept growing; the folder is deleted. */
export async function findLeaks(command: string, cwd: string, run: LeakRun, o: { everyMs?: number; count?: number; env?: NodeJS.ProcessEnv } = {}): Promise<{ snapshots: number; growth: Growth[] } | { notChecked: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-heap-"))
  try {
    const preload = path.join(dir, "codehouse-heap-preload.cjs")
    fs.writeFileSync(preload, PRELOAD)
    const r = await run(command, cwd, { NODE_OPTIONS: leakNodeOptions((o.env ?? process.env).NODE_OPTIONS, preload), CODEH_HEAP_DIR: dir, CODEH_HEAP_EVERY_MS: String(o.everyMs ?? 1000), CODEH_HEAP_COUNT: String(o.count ?? 6) })
    if (!r.ran) return { notChecked: `it was not run: ${r.refused ?? "refused"}` }
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".heapsnapshot")).sort()
    // The process with the most snapshots is the program; its snapshots in order.
    const byPid = new Map<string, string[]>()
    for (const f of files) {
      const pid = /^heap-(\d+)-/.exec(f)?.[1] ?? ""
      byPid.set(pid, [...(byPid.get(pid) ?? []), f])
    }
    const mine = [...byPid.values()].sort((a, b) => b.length - a.length)[0] ?? []
    if (mine.length < 3) return { notChecked: `only ${mine.length} snapshot(s) were taken; let it run longer, or take them more often` }
    const snaps = mine.map((f) => {
      const p = path.join(dir, f)
      if (fs.statSync(p).size > 400 * 1024 * 1024) throw new Error("a snapshot is over 400 MB")
      return readHeapSnapshot(JSON.parse(fs.readFileSync(p, "utf8")) as Parameters<typeof readHeapSnapshot>[0])
    })
    return { snapshots: snaps.length, growth: growing(snaps) }
  } catch (e) {
    return { notChecked: (e as Error).message }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** What the agent is told. */
export function leakSummary(command: string, r: { snapshots: number; growth: Growth[] }): string {
  if (!r.growth.length) return `Codehouse took ${r.snapshots} heap snapshots of \`${command}\` and found nothing that kept growing.`
  const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`
  return [
    `Codehouse took ${r.snapshots} heap snapshots of \`${command}\`. These kept growing, which looks like a leak:`,
    ...r.growth.slice(0, 8).map((g) => `- ${g.name}: ${g.counts[0]} to ${g.counts[g.counts.length - 1]} objects, ${mb(g.bytes[0]!)} to ${mb(g.bytes[g.bytes.length - 1]!)}`),
    "Find what holds on to them (a list, a cache or a listener that is never cleared) and fix it.",
  ].join("\n")
}
