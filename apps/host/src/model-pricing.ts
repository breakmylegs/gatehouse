/**
 * T-128 (t3code review): prices of your own for a model, and one model counted as another, in the Usage report. A price
 * replaces the cost Claude Code reported for that model with one worked out from its tokens (a model through a gateway
 * often reports none, or the wrong one); "counted as" adds a model's figures to another's, so one model under two names
 * shows as one. Only the report changes: what was recorded stays as it was, so taking a price away brings it back.
 */
import type { UsageCell, UsageReport, UsageTotals } from "./usage.js"

export interface ModelPrice {
  model: string
  /** US dollars per million tokens. */
  inputPerM?: number
  outputPerM?: number
  cacheReadPerM?: number
  cacheWritePerM?: number
  /** Count this model's usage as this one's. */
  countAs?: string
}

const zero = (): UsageTotals => ({
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  turns: 0,
  durationMs: 0,
  results: 0,
})

/** The cost of these tokens at this price; undefined when the price sets nothing. */
export function priced(t: UsageTotals, p: ModelPrice): number | undefined {
  const rates = [p.inputPerM, p.outputPerM, p.cacheReadPerM, p.cacheWritePerM]
  if (rates.every((r) => r === undefined)) return undefined
  return (
    (t.inputTokens * (p.inputPerM ?? 0) +
      t.outputTokens * (p.outputPerM ?? 0) +
      t.cacheReadTokens * (p.cacheReadPerM ?? 0) +
      t.cacheCreationTokens * (p.cacheWritePerM ?? 0)) /
    1_000_000
  )
}

function cellWith(cell: UsageCell, prices: ReadonlyMap<string, ModelPrice>): UsageCell {
  const models: Record<string, UsageTotals> = {}
  let costChange = 0
  for (const [name, t] of Object.entries(cell.models)) {
    const p = prices.get(name)
    const cost = p ? priced(t, p) : undefined
    const next = cost === undefined ? { ...t } : { ...t, costUsd: cost }
    costChange += next.costUsd - t.costUsd
    // Counted as another: added to that one (once, never in a chain).
    const as = p?.countAs && p.countAs !== name ? p.countAs : name
    const into = models[as] ?? zero()
    for (const k of Object.keys(next) as (keyof UsageTotals)[]) into[k] += next[k]
    models[as] = into
  }
  return { ...cell, models, total: { ...cell.total, costUsd: Math.max(0, cell.total.costUsd + costChange) } }
}

/** The report with your prices and your counted-as applied; the same report when you have none. */
export function applyPricing(report: UsageReport, list: readonly ModelPrice[] | undefined): UsageReport {
  if (!list?.length) return report
  const prices = new Map(list.map((p) => [p.model, p]))
  const days: UsageReport["days"] = {}
  for (const [day, cells] of Object.entries(report.days)) {
    days[day] = {}
    for (const [session, cell] of Object.entries(cells)) days[day]![session] = cellWith(cell, prices)
  }
  return { ...report, days }
}
