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

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0
}

function add(into: UsageTotals, delta: UsageTotals): void {
  // Walk the delta's keys, not the target's: a session entry also holds its project name.
  for (const k of Object.keys(delta) as (keyof UsageTotals)[]) into[k] += delta[k]
}

/** What an SDK `result` message adds. Reads the fields defensively: a missing one counts as zero. */
export function usageFromResult(msg: Record<string, unknown>): { total: UsageTotals; byModel: Record<string, UsageTotals> } {
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
  for (const [model, u] of Object.entries((msg.modelUsage ?? {}) as Record<string, Record<string, unknown>>)) {
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
  #snap: UsageSnapshot = { total: zero(), bySession: {}, byProject: {}, byModel: {} }
  readonly #last = new Map<string, UsageTotals>()
  #timer: NodeJS.Timeout | undefined
  #writing: Promise<void> = Promise.resolve()
  onChange: ((snapshot: UsageSnapshot) => void) | undefined

  constructor(file?: string) {
    this.#file = file
    if (file && fs.existsSync(file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as UsageSnapshot
        if (parsed && typeof parsed === "object" && parsed.total) this.#snap = parsed
      } catch {
        // A damaged usage file is not worth stopping for. It starts again from zero.
      }
    }
  }

  snapshot(): UsageSnapshot {
    return structuredClone(this.#snap)
  }

  /** Adds one result message for a session. Cost and token counts in `usage` are for that turn. */
  record(sessionId: string, project: string, result: Record<string, unknown>): void {
    const { total, byModel } = usageFromResult(result)
    const session = (this.#snap.bySession[sessionId] ??= { ...zero(), project })
    add(session, total)
    add((this.#snap.byProject[project] ??= zero()), total)
    add(this.#snap.total, total)
    for (const [model, t] of Object.entries(byModel)) add((this.#snap.byModel[model] ??= zero()), t)
    this.#last.set(sessionId, total)
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
