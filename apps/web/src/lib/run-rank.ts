import { useSyncExternalStore } from "react"

/**
 * C-044, best of N judged by tests (on G25's runs in worktrees): each run's standing, ranked by its checks first
 * (passing, then not yet run, then failing), then by the size of its change (smaller first), then by the calls that
 * asked you or were stopped (fewer first). Each run's bar reports what it knows; the ranks follow from all of them.
 */
export interface RunStanding {
  testsFailing?: boolean
  /** Lines added and removed. Unknown until its changes are read. */
  lines?: number
  hits: number
}

const checkRank = (s: RunStanding) => (s.testsFailing === false ? 0 : s.testsFailing === undefined ? 1 : 2)

/** The order of runs, best first. Ties keep the order given. */
export function rankRuns(runs: Array<{ id: string } & RunStanding>): string[] {
  return runs
    .map((r, i) => ({ r, i }))
    .sort((a, b) => checkRank(a.r) - checkRank(b.r) || (a.r.lines ?? Infinity) - (b.r.lines ?? Infinity) || a.r.hits - b.r.hits || a.i - b.i)
    .map(({ r }) => r.id)
}

const standings = new Map<string, RunStanding>()
const subs = new Set<() => void>()
let version = 0

export function reportStanding(id: string, s: RunStanding): void {
  const was = standings.get(id)
  if (was && was.testsFailing === s.testsFailing && was.lines === s.lines && was.hits === s.hits) return
  standings.set(id, s)
  version++
  subs.forEach((f) => f())
}

const subscribe = (f: () => void) => {
  subs.add(f)
  return () => {
    subs.delete(f)
  }
}

/** This run's place among `ids` (1 is best), or undefined until every run has said something. */
export function useRank(id: string, ids: string[]): number | undefined {
  useSyncExternalStore(subscribe, () => version)
  if (!ids.every((x) => standings.has(x))) return undefined
  return rankRuns(ids.map((x) => ({ id: x, ...standings.get(x)! }))).indexOf(id) + 1
}
