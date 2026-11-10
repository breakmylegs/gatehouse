/**
 * Possibly stuck, on the Host (backlog O16: it was worked out only in the window, so a phone never heard). While a turn
 * runs, a session that has had nothing from Claude for STUCK_MS, and is not waiting for you, is said to be possibly
 * stuck, once a turn. It only tells; Interrupt and Stop stay yours.
 */
export const STUCK_MS = 120_000
const LOOK_EVERY_MS = 15_000

export class StuckWatch {
  readonly #onStuck: () => void
  readonly #waiting: () => boolean
  readonly #now: () => number
  #timer: NodeJS.Timeout | undefined
  #last = 0
  #told = false

  constructor(o: { onStuck: () => void; waiting: () => boolean; now?: () => number }) {
    this.#onStuck = o.onStuck
    this.#waiting = o.waiting
    this.#now = o.now ?? Date.now
  }

  /** A turn began. */
  start(): void {
    this.#last = this.#now()
    this.#told = false
    if (this.#timer) return
    this.#timer = setInterval(() => this.look(), LOOK_EVERY_MS)
    this.#timer.unref()
  }

  /** Something came from Claude: the turn is alive. */
  seen(): void {
    this.#last = this.#now()
    this.#told = false
  }

  /** The turn ended, or the session closed. */
  stop(): void {
    clearInterval(this.#timer)
    this.#timer = undefined
  }

  /** One look (the timer's, or a test's). */
  look(): void {
    if (!this.#timer || this.#told) return
    // Waiting for you is not stuck, and the time waiting does not count.
    if (this.#waiting()) {
      this.#last = this.#now()
      return
    }
    if (this.#now() - this.#last < STUCK_MS) return
    this.#told = true
    this.#onStuck()
  }
}
