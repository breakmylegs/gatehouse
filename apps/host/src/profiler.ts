/**
 * E-041, profiling on request (Expansion E4). A command of the project's is run once with Node's own CPU profiler
 * (`--cpu-prof`, which writes a .cpuprofile when the process ends) as a Codehouse action, and its profile is read into
 * the functions that took the most time and a flame graph. Following section 10, no inspector port is ever opened: the
 * profiler flag writes a file, and any --inspect flag the environment carries in NODE_OPTIONS is taken out first.
 * dotnet-trace, when it is on this computer, profiles a .NET command into speedscope JSON, read the same way.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

/** NODE_OPTIONS with every inspector flag taken out and the CPU profiler added, writing into a folder. */
export function profiledNodeOptions(existing: string | undefined, dir: string): string {
  const kept = (existing ?? "")
    .split(/\s+/)
    .filter((f) => f && !/^--(inspect|inspect-brk|inspect-port|inspect-publish-uid|debug|debug-brk|debug-port)(=|$)/.test(f) && !/^--cpu-prof/.test(f))
  return [...kept, "--cpu-prof", `--cpu-prof-dir=${JSON.stringify(dir)}`].join(" ")
}

export interface FnTime {
  fn: string
  where: string
  /** Time spent in the function itself, in ms. */
  selfMs: number
  /** Time with what it called, in ms. */
  totalMs: number
}

export interface FlameNode {
  name: string
  value: number
  children: FlameNode[]
}

interface CpuNode {
  id: number
  callFrame: { functionName: string; url: string; lineNumber: number }
  hitCount?: number
  children?: number[]
}

const label = (cf: CpuNode["callFrame"]) => cf.functionName || "(anonymous)"
const at = (cf: CpuNode["callFrame"]) => (cf.url ? `${cf.url.replace(/^file:\/\/\/?/, "")}:${cf.lineNumber + 1}` : "")
const HIDDEN = new Set(["(root)", "(program)", "(idle)", "(garbage collector)"])

/** A V8 .cpuprofile read into its functions by time and a flame graph (ms). */
export function readCpuProfile(json: { nodes: CpuNode[]; startTime: number; endTime: number; samples?: number[] }): { top: FnTime[]; flame: FlameNode; ms: number } {
  const byId = new Map(json.nodes.map((n) => [n.id, n]))
  const totalHits = json.nodes.reduce((s, n) => s + (n.hitCount ?? 0), 0) || 1
  const ms = (json.endTime - json.startTime) / 1000
  const per = ms / totalHits
  const self = new Map<string, FnTime>()
  const totals = new Map<number, number>()
  const total = (id: number): number => {
    const known = totals.get(id)
    if (known !== undefined) return known
    const n = byId.get(id)
    const t = (n?.hitCount ?? 0) + (n?.children ?? []).reduce((s, c) => s + total(c), 0)
    totals.set(id, t)
    return t
  }
  const root = json.nodes[0]!
  total(root.id)
  // Self time by function; total time counted once per function on each path (no double counting in recursion).
  const walk = (id: number, onPath: Set<string>) => {
    const n = byId.get(id)
    if (!n) return
    const key = `${label(n.callFrame)} ${at(n.callFrame)}`
    if (!HIDDEN.has(label(n.callFrame))) {
      const f = self.get(key) ?? { fn: label(n.callFrame), where: at(n.callFrame), selfMs: 0, totalMs: 0 }
      f.selfMs += (n.hitCount ?? 0) * per
      if (!onPath.has(key)) f.totalMs += total(id) * per
      self.set(key, f)
    }
    const next = new Set(onPath).add(key)
    for (const c of n.children ?? []) walk(c, next)
  }
  walk(root.id, new Set())
  const flame = (id: number): FlameNode => {
    const n = byId.get(id)!
    return { name: `${label(n.callFrame)}${at(n.callFrame) ? ` ${path.basename(at(n.callFrame))}` : ""}`, value: Math.round(total(id) * per * 10) / 10, children: (n.children ?? []).map(flame).filter((c) => c.value > 0).sort((a, b) => b.value - a.value) }
  }
  const round = (f: FnTime) => ({ ...f, selfMs: Math.round(f.selfMs * 10) / 10, totalMs: Math.round(f.totalMs * 10) / 10 })
  return { top: [...self.values()].sort((a, b) => b.selfMs - a.selfMs).slice(0, 30).map(round), flame: flame(root.id), ms: Math.round(ms) }
}

/** What the agent is told: the functions that took the most time, by their own time. */
export function profileSummary(command: string, p: { top: FnTime[]; ms: number }): string {
  const lines = p.top.slice(0, 10).map((f, i) => `${i + 1}. ${f.fn} (${f.where || "native"}): ${f.selfMs} ms itself, ${f.totalMs} ms with what it called`)
  return [`Codehouse profiled \`${command}\` (${p.ms} ms). The functions that took the most time themselves:`, ...lines, "Look at the top ones first; time in a function itself is where the CPU went."].join("\n")
}

export type ProfileRun = (command: string, cwd: string, env: Record<string, string>) => Promise<{ ran: boolean; exitCode: number | null; output: string; refused?: string }>

/** Runs a command once with the CPU profiler on, and reads the profile it left; the folder is deleted afterwards. */
export async function profileNode(command: string, cwd: string, run: ProfileRun, env: NodeJS.ProcessEnv = process.env): Promise<{ top: FnTime[]; flame: FlameNode; ms: number } | { notProfiled: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-profile-"))
  try {
    const r = await run(command, cwd, { NODE_OPTIONS: profiledNodeOptions(env.NODE_OPTIONS, dir) })
    if (!r.ran) return { notProfiled: `it was not run: ${r.refused ?? "refused"}` }
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".cpuprofile")).map((f) => path.join(dir, f))
    if (!files.length) return { notProfiled: "no profile was written (is it a Node program, and did it end?)" }
    // The largest profile is the program's own; others are its helper processes.
    const main = files.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0]!
    return readCpuProfile(JSON.parse(fs.readFileSync(main, "utf8")) as Parameters<typeof readCpuProfile>[0])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** The dotnet-trace command that profiles a .NET command into speedscope JSON in a folder. */
export const dotnetTraceCommand = (command: string, dir: string) => `dotnet-trace collect --format Speedscope -o ${JSON.stringify(path.join(dir, "trace.nettrace"))} -- ${command}`

/** Runs a .NET command once under dotnet-trace and reads its speedscope profile; the folder is deleted afterwards. */
export async function profileDotnet(command: string, cwd: string, run: ProfileRun): Promise<{ top: FnTime[]; flame: FlameNode; ms: number } | { notProfiled: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-profile-"))
  try {
    const r = await run(dotnetTraceCommand(command, dir), cwd, {})
    if (!r.ran) return { notProfiled: `it was not run: ${r.refused ?? "refused"}` }
    const file = fs.readdirSync(dir).find((f) => f.endsWith(".speedscope.json"))
    if (!file) return { notProfiled: "dotnet-trace wrote no speedscope profile" }
    const top = readSpeedscope(JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as Parameters<typeof readSpeedscope>[0])
    const total = top.reduce((m, f) => Math.max(m, f.totalMs), 0)
    return { top, ms: Math.round(total), flame: { name: command, value: total, children: top.slice(0, 20).map((f) => ({ name: f.fn, value: f.selfMs, children: [] })) } }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** A speedscope profile (dotnet-trace --format speedscope) read into functions by their own time. */
export function readSpeedscope(json: { shared?: { frames?: Array<{ name: string; file?: string; line?: number }> }; profiles?: Array<{ type?: string; samples?: number[][]; weights?: number[]; unit?: string }> }): FnTime[] {
  const frames = json.shared?.frames ?? []
  const p = json.profiles?.[0]
  if (!p?.samples) return []
  const scale = p.unit === "nanoseconds" ? 1e-6 : p.unit === "microseconds" ? 1e-3 : p.unit === "seconds" ? 1000 : 1
  const times = new Map<number, { self: number; total: number }>()
  p.samples.forEach((stack, i) => {
    const w = (p.weights?.[i] ?? 1) * scale
    const top = stack[stack.length - 1]
    for (const f of new Set(stack)) {
      const t = times.get(f) ?? { self: 0, total: 0 }
      t.total += w
      if (f === top) t.self += w
      times.set(f, t)
    }
  })
  return [...times.entries()]
    .map(([f, t]) => ({ fn: frames[f]?.name ?? `frame ${f}`, where: frames[f]?.file ? `${frames[f]!.file}:${frames[f]!.line ?? 0}` : "", selfMs: Math.round(t.self * 10) / 10, totalMs: Math.round(t.total * 10) / 10 }))
    .sort((a, b) => b.selfMs - a.selfMs)
    .slice(0, 30)
}
