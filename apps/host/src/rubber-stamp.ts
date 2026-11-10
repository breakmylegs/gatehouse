/**
 * D-021, the rubber-stamp detector (Frontier build, Wave 1). Approvals given faster than anyone could read them are a
 * sign of approving without looking. After three High or Severe approvals in a row, each within 800 ms of the card
 * appearing, or ten approvals in a row where the card was never opened, the next High approval on the desktop is
 * slowed: the card shows what the call would do, wants a second deliberate click after two seconds, and offers a
 * limited grant instead. A deny is never slowed, and a deny or a slow approval ends a run.
 */

export const FAST_MS = 800
export const FAST_RUN = 3
export const UNOPENED_RUN = 10
export const HIGH = 70

export interface Approval {
  risk: number
  /** How long the card had been on the screen when it was approved. Absent: not known (another channel). */
  shownMs?: number
  /** Whether the full card was opened (not approved from a row of the queue). */
  opened?: boolean
}

export class RubberStamp {
  #fast = 0
  #unopened = 0
  #armed = false

  /** Whether the next High approval is to be slowed. */
  get armed(): boolean {
    return this.#armed
  }

  /** A desktop approval. Returns true when it arms the friction. */
  approved(a: Approval): boolean {
    const fast = a.risk >= HIGH && a.shownMs !== undefined && a.shownMs < FAST_MS
    this.#fast = fast ? this.#fast + 1 : 0
    this.#unopened = a.opened === false ? this.#unopened + 1 : 0
    if (!this.#armed && (this.#fast >= FAST_RUN || this.#unopened >= UNOPENED_RUN)) {
      this.#armed = true
      return true
    }
    return false
  }

  /** A deny ends a run, and is never slowed. */
  denied(): void {
    this.#fast = 0
    this.#unopened = 0
  }

  /** Whether this approval must be the second, deliberate one. */
  needsDeliberate(risk: number): boolean {
    return this.#armed && risk >= HIGH
  }

  /** The deliberate approval was given: the friction is lifted and counting starts again. */
  deliberate(): void {
    this.#armed = false
    this.#fast = 0
    this.#unopened = 0
  }
}
