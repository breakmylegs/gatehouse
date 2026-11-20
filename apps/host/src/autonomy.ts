import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "@gatehouse/shared/node"
import type { IndexEntry } from "./audit-index.js"

/**
 * C-015, adaptive autonomy that only lowers (Frontier build). Each project has a cap on how much a session there may
 * do on its own, from least to most: Plan, Manual, Accept edits, Auto, Extreme approval (a flag on Manual). There is
 * none until the record asks for one. Once a day, and when you ask, the last 30 days of the audit log are read for
 * each project: how often the floor had to deny a call, and how often you denied one. A poor record lowers the cap by
 * itself, recorded as `autonomy_lowered`; a session in that project then starts no higher than the cap (it starts
 * lowered, and says so) and cannot be raised past it. Nothing here ever raises a cap: only your click on the desktop
 * does (`autonomy_raised`). D-019 builds the proposals to raise on this.
 */
export const LEVELS = ["plan", "default", "acceptEdits", "auto", "extreme"] as const
export type Level = (typeof LEVELS)[number]
export const rank = (l: Level): number => LEVELS.indexOf(l)
export const isLevel = (v: unknown): v is Level => typeof v === "string" && (LEVELS as readonly string[]).includes(v)
export const LEVEL_NAMES: Record<Level, string> = { plan: "Plan", default: "Manual", acceptEdits: "Accept edits", auto: "Auto", extreme: "Extreme approval" }

export const WINDOW_MS = 30 * 86_400_000
/** What lowers a cap, in 30 days: so many floor denies, or so many of your own denies. */
export const LIMITS = { floorToAcceptEdits: 3, floorToManual: 10, deniedToAcceptEdits: 5, deniedToManual: 15 } as const

export interface Signals {
  /** Calls the floor denied (it never allows), a sign the session tried what it must not. */
  floor: number
  /** Calls you denied when asked. */
  denied: number
}

/** A project's signals from the audit entries of the last 30 days. */
export function signalsFor(entries: IndexEntry[], project: string, now: number): Signals {
  const from = now - WINDOW_MS
  const s: Signals = { floor: 0, denied: 0 }
  for (const e of entries) {
    if (e.project !== project || Date.parse(e.ts) < from || e.outcome !== "deny") continue
    if (e.decidedBy === "floor") s.floor++
    else if (e.event === "human_decision" && /^human-/.test(e.decidedBy)) s.denied++
  }
  return s
}

/** The highest level the record supports, and why, in words. */
export function recommend(s: Signals): { level: Level; reasons: string[] } {
  const reasons: string[] = []
  let level: Level = "extreme"
  const lower = (to: Level, why: string) => {
    if (rank(to) < rank(level)) level = to
    reasons.push(why)
  }
  if (s.floor >= LIMITS.floorToManual) lower("default", `the floor denied ${s.floor} calls in 30 days`)
  else if (s.floor >= LIMITS.floorToAcceptEdits) lower("acceptEdits", `the floor denied ${s.floor} calls in 30 days`)
  if (s.denied >= LIMITS.deniedToManual) lower("default", `you denied ${s.denied} calls in 30 days`)
  else if (s.denied >= LIMITS.deniedToAcceptEdits) lower("acceptEdits", `you denied ${s.denied} calls in 30 days`)
  return { level, reasons }
}

export interface Cap {
  level: Level
  at: string
  by: "record" | "you"
  reasons: string[]
}

/** A session's mode and Extreme approval within a cap: what it starts with, and whether that was lowered. */
export function clamp(mode: "default" | "plan" | "acceptEdits" | "auto", extreme: boolean, cap: Level): { mode: typeof mode; extreme: boolean; lowered: boolean } {
  const want: Level = extreme && mode === "default" ? "extreme" : mode
  if (rank(want) <= rank(cap)) return { mode, extreme, lowered: false }
  // Extreme approval goes first; then the mode comes down to the cap (Extreme is never a cap below Manual's flag).
  const to = cap === "extreme" ? "default" : cap
  return { mode: rank(mode) <= rank(to) ? mode : (to as typeof mode), extreme: false, lowered: true }
}

export class AutonomyStore {
  #caps: Record<string, Cap> = {}
  #extra: Record<string, unknown> = {}

  constructor(private readonly file: string) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>
      const { caps, ...rest } = raw
      this.#extra = rest
      for (const [p, c] of Object.entries((caps ?? {}) as Record<string, Partial<Cap>>))
        if (c && isLevel(c.level) && typeof c.at === "string")
          this.#caps[p] = { level: c.level, at: c.at, by: c.by === "you" ? "you" : "record", reasons: Array.isArray(c.reasons) ? c.reasons.filter((r): r is string => typeof r === "string") : [] }
    } catch {
      // none yet
    }
  }

  /** The cap for a project; Extreme approval (no cap) when there is none. */
  capFor(project: string): Level {
    return this.#caps[project]?.level ?? "extreme"
  }

  caps(): Record<string, Cap> {
    return { ...this.#caps }
  }

  async #save(): Promise<void> {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    await writeFileAtomic(this.file, JSON.stringify({ ...this.#extra, caps: this.#caps }, null, 2) + "\n")
  }

  /** Lowers a project's cap to `level` when that is lower than it is; never raises. True when it lowered it. */
  async lower(project: string, level: Level, reasons: string[], now = new Date()): Promise<boolean> {
    if (rank(level) >= rank(this.capFor(project))) return false
    this.#caps[project] = { level, at: now.toISOString(), by: "record", reasons }
    await this.#save()
    return true
  }

  /** Your click on the desktop: the cap goes up to `level` (or away, at Extreme approval). Never called by the record. */
  async raise(project: string, level: Level, now = new Date()): Promise<void> {
    if (rank(level) <= rank(this.capFor(project))) throw new Error(`${LEVEL_NAMES[level]} is not higher than ${project}'s cap.`)
    if (level === "extreme") delete this.#caps[project]
    else this.#caps[project] = { level, at: now.toISOString(), by: "you", reasons: [] }
    await this.#save()
  }
}

export interface AutonomyDeps {
  store: AutonomyStore
  /** The audit entries of the last 30 days, brought up to date first. */
  entries: (sinceMs: number) => Promise<IndexEntry[]>
  record: (event: "autonomy_lowered", input: Record<string, unknown>, reason: string) => Promise<boolean>
  now?: () => number
}

/**
 * Reads the record for every project in it and lowers the caps it asks for. Returns what it lowered. A cap you raised
 * yourself is lowered again only by a record worse than when you raised it: the signals since then.
 */
export async function reviewAutonomy(d: AutonomyDeps): Promise<Array<{ project: string; level: Level; reasons: string[] }>> {
  const now = (d.now ?? Date.now)()
  const entries = await d.entries(now - WINDOW_MS)
  const projects = [...new Set(entries.map((e) => e.project).filter((p): p is string => typeof p === "string" && p.length > 0))]
  const lowered: Array<{ project: string; level: Level; reasons: string[] }> = []
  for (const project of projects) {
    const cap = d.store.caps()[project]
    const since = cap?.by === "you" ? entries.filter((e) => e.ts > cap.at) : entries
    const rec = recommend(signalsFor(since, project, now))
    if (!(await d.store.lower(project, rec.level, rec.reasons, new Date(now)))) continue
    await d.record("autonomy_lowered", { project, level: rec.level }, `${project} now starts no higher than ${LEVEL_NAMES[rec.level]}: ${rec.reasons.join("; ")}.`)
    lowered.push({ project, level: rec.level, reasons: rec.reasons })
  }
  return lowered
}
