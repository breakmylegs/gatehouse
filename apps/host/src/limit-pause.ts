import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "@gatehouse/shared/node"
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
  /**
   * Owner, 5 Nov: limit protection turned off for this session until then (epoch ms). Neither the plan limit nor the
   * spending cap pauses it meanwhile; after it, both apply again by themselves.
   */
  protectionOffUntil?: number
  pause(percent: number, until?: string, reason?: "spend"): Promise<void>
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
  /**
   * B20: what was really spent today, and the cap on it (undefined for none). Owner, 6 Nov ("the sessions keep pausing
   * even though we are nowhere near the limit"): work inside a plan costs nothing more, so the API price a session
   * reports never counts. What counts is this, the sessions that pay as they go (a model through a gateway), plus the
   * extra usage each account spent today, which the pauser adds from its plan reading through extraToday.
   */
  spendToday?: () => number
  spendCap?: () => number | undefined
  /** How much of an account's extra usage was spent today, from the amount used so far this month. */
  extraToday?: (account: string, used: number) => number
  /** B26: whether a paused session starts again by itself when the limit resets. Absent: yes (owner, 31 Oct). */
  autoResume?: () => boolean
  log: (line: string) => void
}

/**
 * How much extra usage each account spent today. Claude Code reports only the amount used so far this month, so the
 * first amount seen each day is kept (in a file, so a restart does not forget it) and today's spending is what was used
 * since. When the month starts again the amount falls, and the new amount becomes the start. A Host that first opens
 * part way through a day counts from then.
 */
export class ExtraSpendToday {
  #state: { day: string; start: Record<string, number> }
  readonly #file: string | undefined
  readonly #today: () => string
  #writing: Promise<void> = Promise.resolve()

  constructor(o: { file?: string; today: () => string }) {
    this.#file = o.file
    this.#today = o.today
    this.#state = { day: o.today(), start: {} }
    try {
      const saved = o.file ? (JSON.parse(fs.readFileSync(o.file, "utf8")) as unknown) : undefined
      const s = saved as { day?: unknown; start?: unknown } | undefined
      if (s && typeof s.day === "string" && s.start && typeof s.start === "object")
        this.#state = { ...s, day: s.day, start: s.start as Record<string, number> }
    } catch {
      // None yet, or unreadable: counting starts now.
    }
  }

  spent(account: string, used: number): number {
    const day = this.#today()
    if (this.#state.day !== day) this.#state = { ...this.#state, day, start: {} }
    const start = this.#state.start[account]
    if (typeof start !== "number" || !Number.isFinite(start) || used < start) {
      this.#state.start[account] = used
      this.#save()
      return 0
    }
    return used - start
  }

  #save(): void {
    const file = this.#file
    if (!file) return
    const text = JSON.stringify(this.#state) + "\n"
    this.#writing = this.#writing
      .then(() => {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        return writeFileAtomic(file, text)
      })
      // Kept in memory; the file is written again with the next start.
      .catch(() => undefined)
  }

  /** Waits for the file to be written (tests). */
  flushed(): Promise<void> {
    return this.#writing
  }
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

/** Whether the organisation allows extra usage beyond the plan and some of it is left. */
export function extraLeft(u: PlanUsage | undefined): boolean {
  const x = u?.extra
  return x !== undefined && x.limit > 0 && x.used < x.limit
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
    // Owner, 5 Nov: a session with its protection turned off is left alone until the time it was turned off for, and
    // one a limit had paused carries on. When that time passes it is looked at again like any other.
    const unprotected = (s: PauseTarget) =>
      s.protectionOffUntil !== undefined && now < s.protectionOffUntil
    for (const s of this.#d.sessions())
      if (unprotected(s) && s.paused)
        await s
          .resume("limit-reset")
          .catch((e: Error) => this.#d.log(`session ${s.id} could not start again: ${e.message}`))
    const sessions = () => this.#d.sessions().filter((s) => !unprotected(s))
    const byAccount = new Map<string, PauseTarget[]>()
    for (const s of sessions()) byAccount.set(s.account, [...(byAccount.get(s.account) ?? []), s])
    const usageOf = new Map<string, PlanUsage | undefined>()
    for (const [account, list] of byAccount)
      // Fresh when something is paused for the plan limit, so the reset is seen as soon as it happens.
      usageOf.set(
        account,
        await this.#d.planUsage(
          account,
          list.some((s) => s.paused && s.paused.reason !== "spend"),
        ),
      )
    // B20: what was really spent today, against the cap in Settings: pay-as-you-go sessions and extra usage.
    const cap = this.#d.spendCap?.()
    let spent = this.#d.spendToday?.() ?? 0
    for (const [account, u] of usageOf)
      if (u?.extra && this.#d.extraToday) spent += this.#d.extraToday(account, u.extra.used)
    const overSpend = cap !== undefined && spent >= cap
    if (overSpend) {
      const midnight = new Date(now)
      midnight.setHours(24, 0, 0, 0)
      for (const s of sessions())
        if (!s.paused)
          await s
            .pause(Math.round((100 * spent) / cap), midnight.toISOString(), "spend")
            .catch(() => undefined)
    }
    // Off pauses nothing new; a session paused already still starts again at the reset.
    const at = this.#d.pauseAt ? this.#d.pauseAt() : PAUSE_AT_PERCENT
    for (const [account, list] of byAccount) {
      // A pause for spending is lifted at midnight or when the cap is raised or removed, not by the plan limit.
      const spendPaused = list.filter((s) => s.paused?.reason === "spend")
      for (const s of spendPaused) {
        const until = s.paused?.until ? Date.parse(s.paused.until) : NaN
        if (!(Number.isFinite(until) && now >= until) && overSpend) continue
        await s
          .resume("limit-reset")
          .catch((e: Error) => this.#d.log(`session ${s.id} could not start again: ${e.message}`))
      }
      const paused = list.filter((s) => s.paused && s.paused.reason !== "spend")
      const usage = usageOf.get(account)
      // Owner, 5 Nov: with extra usage on and room left, the plan limit stops nothing: work carries on into extra
      // usage, as Claude Code does. Only extra usage running out (or the spending cap) pauses.
      const limit = extraLeft(usage) ? { percent: 0 } : fiveHour(usage)
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
