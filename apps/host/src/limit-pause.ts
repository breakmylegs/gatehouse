import type { SessionInfo } from "@gatehouse/shared/ws-protocol"
import type { PlanUsage } from "./plan-usage.js"

/**
 * Owner, 31 Oct: every session pauses when the plan's 5-hour limit reaches 95%, and the ones still paused start
 * again by themselves when it resets. Reaching the limit stops everything at once and wastes the turn in hand, so the
 * Host stops a little short of it, on purpose and on the record.
 */
export const PAUSE_AT_PERCENT = 95

/** How often the limit is looked at while a session is open. */
export const CHECK_EVERY_MS = 60_000

/** After starting an account's sessions again, how long before the same limit may pause them once more. */
const QUIET_AFTER_RESUME_MS = 120_000

/** What the pauser needs of a session. */
export interface PauseTarget {
  id: string
  account: string
  paused?: SessionInfo["paused"]
  pause(percent: number, until?: string): Promise<void>
  resume(by: "limit-reset"): Promise<boolean>
}

export interface LimitPauserDeps {
  /** The sessions that are open and able to answer. */
  sessions: () => PauseTarget[]
  /** The account's plan limits, read fresh when asked. Nothing when they cannot be read. */
  planUsage: (account: string, fresh: boolean) => Promise<PlanUsage | undefined>
  now?: () => number
  /** Where to pause, read at each look (Settings): a percentage, or undefined for never. Absent: PAUSE_AT_PERCENT. */
  pauseAt?: () => number | undefined
  /** B26: whether a paused session starts again by itself when the limit resets. Absent: yes (owner, 31 Oct). */
  autoResume?: () => boolean
  log: (line: string) => void
}

/** The pause point from the settings: off, a percentage, or the default. */
export function pausePoint(s: { percent: number; off?: boolean } | undefined): number | undefined {
  if (s?.off) return undefined
  return s && Number.isInteger(s.percent) && s.percent >= 50 && s.percent <= 99
    ? s.percent
    : PAUSE_AT_PERCENT
}

/** The 5-hour window as the plan meter shows it: the fullest of the session limits. */
export function fiveHour(
  u: PlanUsage | undefined,
): { percent: number; resetsAt?: string } | undefined {
  const l = u?.limits.filter((x) => x.group === "session").sort((a, b) => b.percent - a.percent)[0]
  return l ? { percent: l.percent, ...(l.resetsAt ? { resetsAt: l.resetsAt } : {}) } : undefined
}

/**
 * Pauses an account's sessions at the pause point and starts them again at the reset. When the limit cannot be read
 * it does nothing: a pause needs a number, and an unknown one never pauses or resumes by itself, except that the
 * reset time passing starts a paused session again.
 */
export class LimitPauser {
  readonly #d: LimitPauserDeps
  readonly #quiet = new Map<string, number>()
  #timer: NodeJS.Timeout | undefined
  #busy: Promise<void> | undefined

  constructor(deps: LimitPauserDeps) {
    this.#d = deps
  }

  start(everyMs = CHECK_EVERY_MS): void {
    if (this.#timer) return
    this.#timer = setInterval(() => void this.check(), everyMs)
    this.#timer.unref()
  }

  stop(): void {
    clearInterval(this.#timer)
    this.#timer = undefined
  }

  /** One look at every account with a session open. Looks do not overlap. */
  check(): Promise<void> {
    this.#busy ??= this.#check()
      .catch((e: Error) => this.#d.log(`limit check failed: ${e.message}`))
      .finally(() => {
        this.#busy = undefined
      })
    return this.#busy
  }

  async #check(): Promise<void> {
    const now = (this.#d.now ?? Date.now)()
    // Off pauses nothing new; a session paused already still starts again at the reset.
    const at = this.#d.pauseAt ? this.#d.pauseAt() : PAUSE_AT_PERCENT
    const byAccount = new Map<string, PauseTarget[]>()
    for (const s of this.#d.sessions())
      byAccount.set(s.account, [...(byAccount.get(s.account) ?? []), s])
    for (const [account, list] of byAccount) {
      const paused = list.filter((s) => s.paused)
      // Fresh when something is paused, so the reset is seen as soon as it happens.
      const limit = fiveHour(await this.#d.planUsage(account, paused.length > 0))
      // B26: off, a paused session waits for you to start it, even after the reset. Pausing goes on as before.
      const resumeByItself = !this.#d.autoResume || this.#d.autoResume()
      for (const s of resumeByItself ? paused : []) {
        const until = s.paused?.until ? Date.parse(s.paused.until) : NaN
        const reset = Number.isFinite(until) && now >= until
        const below = limit !== undefined && (at === undefined || limit.percent < at)
        if (!reset && !below) continue
        try {
          if (await s.resume("limit-reset")) this.#quiet.set(account, now + QUIET_AFTER_RESUME_MS)
        } catch (e) {
          // The kill switch, or a session that closed: it stays paused and is looked at again.
          this.#d.log(`session ${s.id} could not start again: ${(e as Error).message}`)
        }
      }
      if (at === undefined || !limit || limit.percent < at) continue
      if (now < (this.#quiet.get(account) ?? 0)) continue
      for (const s of list)
        if (!s.paused) await s.pause(limit.percent, limit.resetsAt).catch(() => undefined)
    }
  }
}
