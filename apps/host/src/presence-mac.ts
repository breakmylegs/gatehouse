// Mac fork (owner, 25 Nov): what Codehouse.app tells the Host about the Mac, as it happens, so the Host need not wait
// for its next look. One JSON line on the Host's standard input, {"event":"locked"}, which only the window app that
// started the Host can write (packaging/mac/AppDelegate.swift):
//   locked, sleep     you have left: what the escalation ladder holds back only while you are here goes to the phone and
//                     the push channels now (broker.hurry), and away-mac.ts counts you away without waiting 2 minutes
//   unlocked          you are back
//   wake              the Relay tries again at once, the power is read, and updates are looked for (at most every 15
//                     minutes: the Host's timers stand still while the Mac sleeps)
//   power             the power source or the charge changed: read it now rather than at the next 2-minute look
// Each can only make Codehouse tell you sooner or look again. None allows or decides anything.

export type MacSignal = "locked" | "unlocked" | "sleep" | "wake" | "power"

const SIGNALS: ReadonlySet<string> = new Set<MacSignal>(["locked", "unlocked", "sleep", "wake", "power"])

/** The signal in a line from the window app, or undefined for anything else (ignored). */
export function parseSignal(line: string): MacSignal | undefined {
  if (line.length > 200) return undefined
  try {
    const j = JSON.parse(line) as { event?: unknown }
    return typeof j.event === "string" && SIGNALS.has(j.event) ? (j.event as MacSignal) : undefined
  } catch {
    return undefined
  }
}

/** Updates are looked for after a wake at most this often. */
export const UPDATES_AFTER_WAKE_MS = 15 * 60_000

export interface PresenceDeps {
  /** Tells the phone and the push channels now what waits only while you are here; returns how many. */
  hurry: () => number
  /** The Relay's poll tries again now. */
  nudgeRelay: () => void
  checkPower: () => Promise<unknown>
  checkUpdates: () => Promise<unknown>
  log: (line: string) => void
  now?: () => number
}

export class MacPresence {
  #locked = false
  #asleep = false
  #updatesAt = Number.NEGATIVE_INFINITY

  constructor(private readonly d: PresenceDeps) {}

  /** The screen is locked or the Mac is asleep. */
  get away(): boolean {
    return this.#locked || this.#asleep
  }

  /** Acts on a line from the window app. Resolves when what it started is done. */
  async take(line: string): Promise<MacSignal | undefined> {
    const s = parseSignal(line)
    if (!s) return undefined
    const now = (this.d.now ?? Date.now)()
    if (s === "locked" || s === "sleep") {
      if (s === "locked") this.#locked = true
      else this.#asleep = true
      const n = this.d.hurry()
      if (n) this.d.log(`presence: ${s === "locked" ? "the screen locked" : "the Mac is going to sleep"}, so ${n} held request telling${n === 1 ? "" : "s"} went to the phone now`)
    } else if (s === "unlocked") {
      this.#locked = false
    } else if (s === "wake") {
      this.#asleep = false
      this.d.nudgeRelay()
      const jobs: Promise<unknown>[] = [this.d.checkPower()]
      if (now - this.#updatesAt >= UPDATES_AFTER_WAKE_MS) {
        this.#updatesAt = now
        jobs.push(this.d.checkUpdates())
      }
      await Promise.allSettled(jobs)
    } else {
      await this.d.checkPower().catch(() => undefined)
    }
    return s
  }
}
