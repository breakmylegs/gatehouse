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
 * does (`autonomy_raised`).
 *
 * D-019, earned-autonomy proposals: a capped project whose record since its cap was set is clean (your approvals
 * never undone, sealed held-out checks passing, done-claims Verified, not one floor deny) earns a proposal to raise
 * the cap by one step, recorded as `autonomy_raise_proposed`. A proposal never applies by itself: only your click on
 * the desktop does, and when a phone is paired, also its passkey (api.ts).
 */
/** D-019: the request that asks the paired phone to confirm a raise; the broker takes its allow from the phone only. */
export const AUTONOMY_RAISE_RULE = "autonomy-raise"
export const AUTONOMY_RAISE_TOOL = "AutonomyRaise"

export const LEVELS = ["plan", "default", "acceptEdits", "auto", "extreme"] as const
export type Level = (typeof LEVELS)[number]
export const rank = (l: Level): number => LEVELS.indexOf(l)
export const isLevel = (v: unknown): v is Level => typeof v === "string" && (LEVELS as readonly string[]).includes(v)
export const LEVEL_NAMES: Record<Level, string> = { plan: "Plan", default: "Manual", acceptEdits: "Accept edits", auto: "Auto", extreme: "Max approval" }

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

/** D-019: a project's record since its cap was set, for a proposal to raise it. */
export interface TrackRecord {
  /** Calls you allowed when asked. */
  approvals: number
  /** Changes you undid from a checkpoint. */
  undone: number
  sealedPassed: number
  sealedFailed: number
  verified: number
  contradicted: number
  /** Calls the floor denied. */
  floor: number
}

/** D-019: what earns a step up, at the least; any undo, floor deny, Contradicted claim or failed sealed check stops it. */
export const EARN = { approvals: 20, verified: 3 } as const

export function trackRecord(entries: IndexEntry[], project: string, sinceIso: string): TrackRecord {
  const r: TrackRecord = { approvals: 0, undone: 0, sealedPassed: 0, sealedFailed: 0, verified: 0, contradicted: 0, floor: 0 }
  for (const e of entries) {
    if (e.project !== project || e.ts <= sinceIso) continue
    if (e.decidedBy === "floor" && e.outcome === "deny") r.floor++
    else if (e.event === "human_decision" && e.outcome === "allow" && /^human-/.test(e.decidedBy)) r.approvals++
    else if (e.event === "files_undone" || e.event === "change_undone") r.undone++
    else if (e.event === "sealed_check_run") {
      if (e.good) r.sealedPassed++
      else r.sealedFailed++
    }
    else if (e.event === "claim_verified") {
      if (e.outcome === "deny") r.contradicted++
      else if (e.good) r.verified++
    }
  }
  return r
}

export interface Proposal {
  from: Level
  to: Level
  at: string
  reasons: string[]
}

/** D-019: the next step up from a cap, when the record has earned it; undefined otherwise. Never applied here. */
export function propose(rec: TrackRecord, cap: Level): Omit<Proposal, "at"> | undefined {
  if (cap === "extreme") return undefined
  if (rec.floor || rec.undone || rec.contradicted || rec.sealedFailed) return undefined
  if (rec.approvals < EARN.approvals || rec.verified < EARN.verified) return undefined
  const to = LEVELS[rank(cap) + 1]!
  const reasons = [
    `you allowed ${rec.approvals} calls and undid none`,
    `${rec.verified} done-claims were Verified and none Contradicted`,
    rec.sealedPassed ? `the sealed checks passed ${rec.sealedPassed} times and never failed` : "no sealed check failed",
    "the floor denied nothing",
  ]
  return { from: cap, to, reasons }
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
  #proposals: Record<string, Proposal> = {}
  #declined: Record<string, string> = {}
  #extra: Record<string, unknown> = {}

  constructor(
    private readonly file: string,
    /** D-095: the most Group Policy allows, a ceiling over every project's cap. */
    private readonly ceiling: () => Level | undefined = () => undefined,
  ) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>
      const { caps, proposals, declined, ...rest } = raw
      this.#extra = rest
      for (const [p, v] of Object.entries((declined ?? {}) as Record<string, unknown>)) if (typeof v === "string") this.#declined[p] = v
      for (const [p, v] of Object.entries((proposals ?? {}) as Record<string, Partial<Proposal>>))
        if (v && isLevel(v.from) && isLevel(v.to) && typeof v.at === "string")
          this.#proposals[p] = { from: v.from, to: v.to, at: v.at, reasons: Array.isArray(v.reasons) ? v.reasons.filter((r): r is string => typeof r === "string") : [] }
      for (const [p, c] of Object.entries((caps ?? {}) as Record<string, Partial<Cap>>))
        if (c && isLevel(c.level) && typeof c.at === "string")
          this.#caps[p] = { level: c.level, at: c.at, by: c.by === "you" ? "you" : "record", reasons: Array.isArray(c.reasons) ? c.reasons.filter((r): r is string => typeof r === "string") : [] }
    } catch {
      // none yet
    }
  }

  /** The cap for a project; Extreme approval (no cap) when there is none. */
  capFor(project: string): Level {
    const own = this.#caps[project]?.level ?? "extreme"
    const top = this.ceiling()
    return top && rank(top) < rank(own) ? top : own
  }

  caps(): Record<string, Cap> {
    return { ...this.#caps }
  }

  async #save(): Promise<void> {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    await writeFileAtomic(this.file, JSON.stringify({ ...this.#extra, caps: this.#caps, proposals: this.#proposals, declined: this.#declined }, null, 2) + "\n")
  }

  /** D-019: the proposals waiting for you, by project. */
  proposals(): Record<string, Proposal> {
    return { ...this.#proposals }
  }

  /** D-019: keeps a proposal for you to decide; it changes no cap. True when it is new. */
  async propose(project: string, p: Omit<Proposal, "at">, now = new Date()): Promise<boolean> {
    const was = this.#proposals[project]
    if (was && was.from === p.from && was.to === p.to) return false
    this.#proposals[project] = { ...p, at: now.toISOString() }
    await this.#save()
    return true
  }

  /** D-019: forgets a proposal (the cap moved, or the record went bad). */
  async dropProposal(project: string): Promise<void> {
    if (!this.#proposals[project]) return
    delete this.#proposals[project]
    await this.#save()
  }

  /** D-019: you said no; the record must be earned again from now before another proposal. */
  async decline(project: string, now = new Date()): Promise<void> {
    delete this.#proposals[project]
    this.#declined[project] = now.toISOString()
    await this.#save()
  }

  /** D-019: where a project's record for a proposal starts: when its cap was set, or when you last said no. */
  recordFrom(project: string): string {
    const at = this.#caps[project]?.at ?? ""
    const no = this.#declined[project] ?? ""
    return no > at ? no : at
  }

  /** Lowers a project's cap to `level` when that is lower than it is; never raises. True when it lowered it. */
  async lower(project: string, level: Level, reasons: string[], now = new Date()): Promise<boolean> {
    if (rank(level) >= rank(this.capFor(project))) return false
    this.#caps[project] = { level, at: now.toISOString(), by: "record", reasons }
    delete this.#proposals[project]
    await this.#save()
    return true
  }

  /** Your click on the desktop: the cap goes up to `level` (or away, at Extreme approval). Never called by the record. */
  async raise(project: string, level: Level, now = new Date()): Promise<void> {
    if (rank(level) <= rank(this.capFor(project))) throw new Error(`${LEVEL_NAMES[level]} is not higher than ${project}'s cap.`)
    if (level === "extreme") delete this.#caps[project]
    else this.#caps[project] = { level, at: now.toISOString(), by: "you", reasons: [] }
    delete this.#proposals[project]
    await this.#save()
  }
}

export interface AutonomyDeps {
  store: AutonomyStore
  /** The audit entries of the last 30 days, brought up to date first. */
  entries: (sinceMs: number) => Promise<IndexEntry[]>
  record: (event: "autonomy_lowered" | "autonomy_raise_proposed", input: Record<string, unknown>, reason: string) => Promise<boolean>
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
  // D-019: a capped project with a clean record since its cap was set earns a proposal; it is only kept and told.
  for (const [project, cap] of Object.entries(d.store.caps())) {
    const p = propose(trackRecord(entries, project, d.store.recordFrom(project)), cap.level)
    if (!p) {
      await d.store.dropProposal(project)
      continue
    }
    if (!(await d.store.propose(project, p, new Date(now)))) continue
    await d.record(
      "autonomy_raise_proposed",
      { project, from: p.from, to: p.to },
      `${project} has earned a step up, from ${LEVEL_NAMES[p.from]} to ${LEVEL_NAMES[p.to]}: ${p.reasons.join("; ")}. It waits for you.`,
    )
  }
  return lowered
}
