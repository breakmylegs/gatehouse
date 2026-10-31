/**
 * Extreme approval carries on by itself until the build queue is empty (owner, 30 Oct; CLAUDE.md invariant 3). After
 * each turn the Host sends CARRY_ON_PROMPT, until Claude ends a reply with QUEUE EMPTY, a limit is reached, a turn
 * fails, or you stop it. Your own message starts a new run, with its own count and spend.
 */
export const CARRY_ON_PROMPT =
  "Carry on with the next item in your build queue, without asking me anything: where you would ask, choose the recommended option yourself. When nothing is left in the queue, end your reply with the line QUEUE EMPTY."

/** Sent to a session that was working when JCVC closed, restarted or updated, so it picks up by itself (owner, 31 Oct). */
export const RESUME_PROMPT =
  "JCVC restarted while you were working, which stopped your last turn part way. Carry on from where you were, without starting again."

const QUEUE_EMPTY = /\bQUEUE EMPTY\b/

/** Why carrying on stopped. Stalled: two turns in a row did no work, so nothing seems left to do. */
export type CarryOnEnd = "done" | "turns" | "spend" | "stopped" | "error" | "stalled"

export interface CarryOnLimits {
  /** Automatic turns after one message of yours. None: no limit. */
  turns?: number
  /** Dollars spent after one message of yours. None: no limit. */
  usd?: number
}

/** Owner, 31 Oct: a session should not stop while its queue has work, so the limits are high, and yours to set. */
export const CARRY_ON_DEFAULTS = { turns: 200, usd: 500 } as const

/** The limits as Settings has them: a number each, or No limit, which an older version reads as its highest. */
export function carryOnLimits(c?: {
  turns?: number
  usd?: number
  noTurnLimit?: boolean
  noSpendLimit?: boolean
}): CarryOnLimits {
  return {
    ...(c?.noTurnLimit ? {} : { turns: c?.turns ?? CARRY_ON_DEFAULTS.turns }),
    ...(c?.noSpendLimit ? {} : { usd: c?.usd ?? CARRY_ON_DEFAULTS.usd }),
  }
}

export interface CarryOnStatus {
  turns: number
  maxTurns?: number
  spentUsd: number
  maxUsd?: number
  ended?: CarryOnEnd
}

export type CarryOnStep =
  | { go: true; turn: number; of?: number }
  | { go: false; why: CarryOnEnd; turns: number; spentUsd: number }

/** The count and spend of one run, from your message to the end of the queue. */
export class CarryOn {
  readonly #limits: () => CarryOnLimits
  #turns = 0
  #costAtStart = 0
  #spent = 0
  /** Turns in a row that did no work: no tool call, only words. */
  #idle = 0
  #ended: CarryOnEnd | undefined

  constructor(limits: () => CarryOnLimits) {
    this.#limits = limits
  }

  /** You sent a message: a new run starts, counting what is spent from here (the session's total so far). */
  started(costSoFar = 0): void {
    this.#turns = 0
    this.#costAtStart = costSoFar
    this.#spent = 0
    this.#idle = 0
    this.#ended = undefined
  }

  /** You stopped the session: nothing carries on until you send a message. */
  stopped(): void {
    this.#ended ??= "stopped"
  }

  /**
   * After a turn: whether to send the carry-on prompt. `costUsd` is the session's total so far, as the result says;
   * `steps` is how many times Claude was called in the turn (1 means it only wrote, with no tool call). Once a run
   * has ended it says so only once, and stays ended until your next message.
   */
  next(r: {
    text: string
    isError: boolean
    costUsd?: number
    steps?: number
  }): CarryOnStep | undefined {
    if (this.#ended) return undefined
    if (typeof r.costUsd === "number") this.#spent = Math.max(0, r.costUsd - this.#costAtStart)
    const limits = this.#limits()
    const end = (why: CarryOnEnd): CarryOnStep => {
      this.#ended = why
      return { go: false, why, turns: this.#turns, spentUsd: this.#spent }
    }
    if (r.isError) return end("error")
    if (QUEUE_EMPTY.test(r.text)) return end("done")
    this.#idle = r.steps !== undefined && r.steps <= 1 ? this.#idle + 1 : 0
    if (this.#idle >= 2) return end("stalled")
    if (limits.turns !== undefined && this.#turns >= limits.turns) return end("turns")
    if (limits.usd !== undefined && this.#spent >= limits.usd) return end("spend")
    this.#turns++
    return {
      go: true,
      turn: this.#turns,
      ...(limits.turns !== undefined ? { of: limits.turns } : {}),
    }
  }

  status(): CarryOnStatus {
    const l = this.#limits()
    return {
      turns: this.#turns,
      ...(l.turns !== undefined ? { maxTurns: l.turns } : {}),
      spentUsd: this.#spent,
      ...(l.usd !== undefined ? { maxUsd: l.usd } : {}),
      ...(this.#ended ? { ended: this.#ended } : {}),
    }
  }
}

/**
 * Answers for AskUserQuestion when Extreme approval is on: the option marked Recommended, or else the first, for
 * each question (every recommended one for a question that takes several). Undefined when a question has no options
 * to choose from, so it goes to you instead.
 */
export function recommendedAnswers(
  input: Record<string, unknown>,
): Record<string, string> | undefined {
  const qs = Array.isArray(input.questions) ? input.questions : []
  if (qs.length === 0) return undefined
  const out: Record<string, string> = {}
  for (const raw of qs) {
    const q = (raw ?? {}) as { question?: unknown; options?: unknown; multiSelect?: unknown }
    const labels = Array.isArray(q.options)
      ? q.options
          .map((o) => (o as { label?: unknown } | null)?.label)
          .filter((l): l is string => typeof l === "string" && l.trim() !== "")
      : []
    if (typeof q.question !== "string" || labels.length === 0) return undefined
    const rec = labels.filter((l) => /\(recommended\)/i.test(l))
    out[q.question] = (
      rec.length ? (q.multiSelect === true ? rec : rec.slice(0, 1)) : labels.slice(0, 1)
    ).join(", ")
  }
  return out
}
