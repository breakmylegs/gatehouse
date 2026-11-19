import type { DoctorCheck } from "./doctor.js"

/**
 * T-132: when the Host stops answering for a while (its event loop held up) or a request takes long, so Doctor can say
 * so. A timer that should fire every TICK_MS notes how late it was; a request is timed from arrival to answer. Only the
 * route's pattern is kept (`/api/sessions/:id`), never its address, query or body. Requests that wait on purpose (the
 * command line waiting for a turn, the WebSocket) are not counted.
 */
export const TICK_MS = 500
export const STALL_MS = 1000
export const SLOW_MS = 5000
export const ASLEEP_MS = 120_000
const KEEP = 20
const HOUR = 3_600_000
const WAITS_ON_PURPOSE = new Set(["/ws", "/cli/sessions/:id/send"])

export interface Stall {
  at: number
  ms: number
}
export interface SlowRequest extends Stall {
  route: string
}

export class HostStalls {
  readonly stalls: Stall[] = []
  readonly slow: SlowRequest[] = []
  #expected: number | undefined
  #timer: NodeJS.Timeout | undefined

  constructor(private readonly now: () => number = Date.now) {}

  start(): void {
    if (this.#timer) return
    this.#expected = this.now() + TICK_MS
    this.#timer = setInterval(() => this.tick(), TICK_MS)
    this.#timer.unref()
  }

  stop(): void {
    clearInterval(this.#timer)
    this.#timer = undefined
  }

  /** The timer fired: how late it was, kept when it was a stall. */
  tick(): void {
    const at = this.now()
    const late = this.#expected === undefined ? 0 : at - this.#expected
    this.#expected = at + TICK_MS
    // Minutes late is the computer asleep, not the Host stuck.
    if (late >= STALL_MS && late < ASLEEP_MS) this.#keep(this.stalls, { at, ms: late })
  }

  /** A request was answered. */
  request(method: string, route: string | undefined, ms: number): void {
    if (ms < SLOW_MS || !route || WAITS_ON_PURPOSE.has(route)) return
    this.#keep(this.slow, { at: this.now(), ms, route: `${method} ${route}` })
  }

  #keep<T extends Stall>(list: T[], item: T): void {
    list.push(item)
    if (list.length > KEEP) list.shift()
  }

  /** Doctor's check: anything in the last hour, with the longest of each. */
  check(): DoctorCheck {
    const since = this.now() - HOUR
    const stalls = this.stalls.filter((s) => s.at >= since)
    const slow = this.slow.filter((s) => s.at >= since)
    const label = "Responsiveness"
    if (!stalls.length && !slow.length) return { id: "responsiveness", label, state: "ok", detail: "The Host has answered promptly in the last hour." }
    const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`
    const clock = (at: number) => new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    const parts: string[] = []
    if (stalls.length) {
      const worst = stalls.reduce((a, b) => (b.ms > a.ms ? b : a))
      parts.push(`The Host stopped answering ${stalls.length === 1 ? "once" : `${stalls.length} times`} in the last hour, the longest for ${secs(worst.ms)} at ${clock(worst.at)}.`)
    }
    if (slow.length) {
      const worst = slow.reduce((a, b) => (b.ms > a.ms ? b : a))
      parts.push(`${slow.length === 1 ? "A request was" : `${slow.length} requests were`} slow, the longest ${worst.route} at ${secs(worst.ms)}.`)
    }
    return {
      id: "responsiveness",
      label,
      state: "warn",
      detail: parts.join(" "),
      fix: "Usually the computer was busy or waking from sleep. If it keeps happening, copy this report and send it with what you were doing.",
    }
  }
}
