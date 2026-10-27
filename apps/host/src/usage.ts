import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "@gatehouse/shared/node"

export interface UsageTotals {
  costUsd: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  turns: number
  durationMs: number
  results: number
}

export interface UsageSnapshot {
  total: UsageTotals
  bySession: Record<string, UsageTotals & { project: string }>
  byProject: Record<string, UsageTotals>
  byModel: Record<string, UsageTotals>
  /** By local calendar day, YYYY-MM-DD. Files written before this existed load with none. */
  byDay: Record<string, UsageTotals>
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

/** The local calendar day, YYYY-MM-DD. */
export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0
}

/** The change from a cumulative figure. If it went down (a restarted counter), the new figure is the change. */
function increase(now: number, before: number | undefined): number {
  if (before === undefined) return now
  return now >= before ? now - before : now
}

function add(into: UsageTotals, delta: UsageTotals): void {
  // Walk the delta's keys, not the target's: a session entry also holds its project name.
  for (const k of Object.keys(delta) as (keyof UsageTotals)[]) into[k] += delta[k]
}

/**
 * What an SDK `result` message reports. Reads the fields defensively: a missing one counts as zero.
 * Verified against the real SDK (docs/sdk-notes.md): `total_cost_usd` and `modelUsage` are CUMULATIVE for the
 * session, while the top-level `usage` and `num_turns` are for that one result.
 */
export function usageFromResult(msg: Record<string, unknown>): {
  total: UsageTotals
  byModel: Record<string, UsageTotals>
} {
  const usage = (msg.usage ?? {}) as Record<string, unknown>
  const total: UsageTotals = {
    costUsd: num(msg.total_cost_usd),
    inputTokens: num(usage.input_tokens),
    outputTokens: num(usage.output_tokens),
    cacheReadTokens: num(usage.cache_read_input_tokens),
    cacheCreationTokens: num(usage.cache_creation_input_tokens),
    turns: num(msg.num_turns),
    durationMs: num(msg.duration_ms),
    results: 1,
  }
  const byModel: Record<string, UsageTotals> = {}
  for (const [model, u] of Object.entries(
    (msg.modelUsage ?? {}) as Record<string, Record<string, unknown>>,
  )) {
    byModel[model] = {
      costUsd: num(u.costUSD),
      inputTokens: num(u.inputTokens),
      outputTokens: num(u.outputTokens),
      cacheReadTokens: num(u.cacheReadInputTokens),
      cacheCreationTokens: num(u.cacheCreationInputTokens),
      turns: 0,
      durationMs: 0,
      results: 0,
    }
  }
  return { total, byModel }
}

/**
 * Token and cost totals per session and per project, kept in memory and saved to usage.json shortly after
 * each change (atomically). A SDK session reports cumulative cost, so each result is a delta from the
 * last one seen for that session.
 */
export class UsageStore {
  readonly #file: string | undefined
  #snap: UsageSnapshot = { total: zero(), bySession: {}, byProject: {}, byModel: {}, byDay: {} }
  readonly #now: () => Date
  /** The cumulative figures last seen for each session, to turn them into changes. */
  readonly #last = new Map<string, UsageTotals>()
  readonly #lastModels = new Map<string, Record<string, UsageTotals>>()
  #timer: NodeJS.Timeout | undefined
  #writing: Promise<void> = Promise.resolve()
  onChange: ((snapshot: UsageSnapshot) => void) | undefined

  constructor(file?: string, now: () => Date = () => new Date()) {
    this.#file = file
    this.#now = now
    if (file && fs.existsSync(file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as UsageSnapshot
        if (parsed && typeof parsed === "object" && parsed.total)
          this.#snap = { ...parsed, byDay: parsed.byDay ?? {} }
      } catch {
        // A damaged usage file is not worth stopping for. It starts again from zero.
      }
    }
  }

  snapshot(): UsageSnapshot {
    return structuredClone(this.#snap)
  }

  /**
   * Adds one result message for a session. Tokens come from the per-result `usage`. Cost and the per-model
   * figures are cumulative in the SDK, so only the change since the last result is added.
   */
  record(sessionId: string, project: string, result: Record<string, unknown>): void {
    const { total, byModel } = usageFromResult(result)
    const lastTotal = this.#last.get(sessionId)
    const lastModels = this.#lastModels.get(sessionId) ?? {}
    total.costUsd = increase(total.costUsd, lastTotal?.costUsd)
    const modelDeltas: Record<string, UsageTotals> = {}
    for (const [model, cumulative] of Object.entries(byModel)) {
      const before = lastModels[model]
      modelDeltas[model] = {
        ...cumulative,
        costUsd: increase(cumulative.costUsd, before?.costUsd),
        inputTokens: increase(cumulative.inputTokens, before?.inputTokens),
        outputTokens: increase(cumulative.outputTokens, before?.outputTokens),
        cacheReadTokens: increase(cumulative.cacheReadTokens, before?.cacheReadTokens),
        cacheCreationTokens: increase(cumulative.cacheCreationTokens, before?.cacheCreationTokens),
      }
    }
    const session = (this.#snap.bySession[sessionId] ??= { ...zero(), project })
    add(session, total)
    add((this.#snap.byProject[project] ??= zero()), total)
    add(this.#snap.total, total)
    add((this.#snap.byDay[localDay(this.#now())] ??= zero()), total)
    for (const [model, t] of Object.entries(modelDeltas))
      add((this.#snap.byModel[model] ??= zero()), t)
    this.#last.set(sessionId, { ...usageFromResult(result).total })
    this.#lastModels.set(sessionId, byModel)
    this.onChange?.(this.snapshot())
    this.#schedule()
  }

  #schedule(): void {
    if (!this.#file || this.#timer) return
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      void this.flush()
    }, 500)
    this.#timer.unref?.()
  }

  async flush(): Promise<void> {
    if (!this.#file) return
    clearTimeout(this.#timer)
    this.#timer = undefined
    const file = this.#file
    const text = JSON.stringify(this.#snap, null, 2) + "\n"
    this.#writing = this.#writing.then(async () => {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      await writeFileAtomic(file, text)
    })
    await this.#writing.catch(() => undefined)
  }
}
