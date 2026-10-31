/** The Usage page's sums: one report from the Host, cut by the filters you chose (owner, 30 Oct). */

export interface Totals {
  costUsd: number
  inputTokens: number
  outputTokens: number
  turns: number
}

export interface Cell {
  project: string
  total: Totals
  models: Record<string, Totals>
}

export interface Report {
  from: string
  to: string
  splitSince?: string
  days: Record<string, Record<string, Cell>>
  daysWithoutCells: Record<string, Totals>
}

export interface Filter {
  project?: string
  session?: string
  model?: string
}

export interface Row extends Totals {
  key: string
  /** The project, for a session row. */
  project?: string
}

export interface Summary {
  total: Totals
  /** Every day in the range, oldest first, with nothing spent shown as nothing. */
  byDay: Row[]
  byProject: Row[]
  byModel: Row[]
  bySession: Row[]
  /** Days in the range kept only as daily totals (before JCVC kept them by session): counted only when nothing is filtered. */
  unsplitDays: number
  /** Turns are not kept by model, so a model filter cannot count them. */
  turnsKnown: boolean
}

const zero = (): Totals => ({ costUsd: 0, inputTokens: 0, outputTokens: 0, turns: 0 })
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0)

function add(into: Totals, t: Partial<Totals> | undefined, withTurns = true): void {
  if (!t) return
  into.costUsd += n(t.costUsd)
  into.inputTokens += n(t.inputTokens)
  into.outputTokens += n(t.outputTokens)
  if (withTurns) into.turns += n(t.turns)
}

/** YYYY-MM-DD for a local date. */
export function dayOf(d: Date): string {
  const p = (x: number) => String(x).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Each day from `from` to `to`, both included. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  const [y, m, d] = from.split("-").map(Number) as [number, number, number]
  const at = new Date(y, m - 1, d)
  for (let i = 0; i < 4000 && dayOf(at) <= to; i++) {
    out.push(dayOf(at))
    at.setDate(at.getDate() + 1)
  }
  return out
}

/** The range for a preset: today, or the last N days ending today. */
export function rangeFor(days: number, now: Date = new Date()): { from: string; to: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1))
  return { from: dayOf(start), to: dayOf(now) }
}

const sorted = (m: Map<string, Row>) => [...m.values()].sort((a, b) => b.costUsd - a.costUsd)

export function summarise(r: Report, f: Filter = {}): Summary {
  const filtered = Boolean(f.project || f.session || f.model)
  const total = zero()
  const day = new Map<string, Row>()
  const project = new Map<string, Row>()
  const model = new Map<string, Row>()
  const session = new Map<string, Row>()
  const row = (m: Map<string, Row>, key: string, extra: Partial<Row> = {}) => {
    let x = m.get(key)
    if (!x) m.set(key, (x = { key, ...zero(), ...extra }))
    return x
  }
  for (const d of daysBetween(r.from, r.to)) row(day, d)
  for (const [d, cells] of Object.entries(r.days)) {
    if (d < r.from || d > r.to) continue
    for (const [sid, c] of Object.entries(cells)) {
      if (f.project && c.project !== f.project) continue
      if (f.session && sid !== f.session) continue
      // With a model chosen, a session counts only what it spent on that model; turns are not kept by model.
      const part: Totals = f.model ? { ...zero(), ...c.models[f.model], turns: 0 } : c.total
      if (f.model && !c.models[f.model]) continue
      add(total, part)
      add(row(day, d), part)
      add(row(project, c.project), part)
      add(row(session, sid, { project: c.project }), part)
      for (const [name, t] of Object.entries(c.models))
        if (!f.model || name === f.model) add(row(model, name), t, false)
    }
  }
  let unsplitDays = 0
  for (const [d, t] of Object.entries(r.daysWithoutCells)) {
    if (d < r.from || d > r.to) continue
    unsplitDays++
    if (filtered) continue
    add(total, t)
    add(row(day, d), t)
  }
  return {
    total,
    byDay: [...day.values()].sort((a, b) => a.key.localeCompare(b.key)),
    byProject: sorted(project),
    byModel: sorted(model),
    bySession: sorted(session),
    unsplitDays,
    turnsKnown: !f.model,
  }
}

/** When a Host session started, from its id (a UUID version 7 starts with the time in milliseconds). */
export function startedAt(sessionId: string): Date | undefined {
  const hex = sessionId.replace(/-/g, "").slice(0, 12)
  if (!/^[0-9a-f]{12}$/i.test(hex) || sessionId.replace(/-/g, "")[12] !== "7") return undefined
  return new Date(parseInt(hex, 16))
}

/** Clean axis steps from zero to at least `max`: 0, and three more like 5, 10, 15 or 0.2, 0.4, 0.6. */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0]
  const raw = max / (count - 1)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = ([1, 2, 2.5, 5, 10].find((s) => s * mag >= raw) ?? 10) * mag
  return Array.from({ length: count }, (_, i) => Number((i * step).toPrecision(12)))
}
