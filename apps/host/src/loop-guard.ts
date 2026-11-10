/**
 * The loop guard (backlog G19): a session that runs the same command and gets the same failure three times in a row,
 * with nothing changed in between, is going round in circles, so Codehouse stops the turn and says why. A fix cycle is
 * not a loop: a file written or edited in between, a different call failing, or the command passing starts the count
 * again. Reads in between do not, since reading and trying again unchanged is the loop itself.
 */
export const LOOP_REPEATS = 3

/** Tools whose success changes something, so the next failure is a new attempt. */
const CHANGES = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"])

/** A failure as compared: digits and spacing smoothed, so timings and line counts do not hide a repeat. */
function sameness(tool: string, input: unknown, error: string): string {
  const what =
    input &&
    typeof input === "object" &&
    typeof (input as { command?: unknown }).command === "string"
      ? (input as { command: string }).command
      : JSON.stringify(input ?? null)
  const err = error.slice(0, 4000).replace(/\d+/g, "#").replace(/\s+/g, " ").trim()
  return `${tool}\u0000${what.trim()}\u0000${err}`
}

export class LoopGuard {
  #key: string | undefined
  #count = 0

  /** A call failed. True when this makes LOOP_REPEATS the same in a row: time to stop. */
  failed(tool: string, input: unknown, error: string): boolean {
    const key = sameness(tool, input, error)
    this.#count = key === this.#key ? this.#count + 1 : 1
    this.#key = key
    if (this.#count < LOOP_REPEATS) return false
    this.reset()
    return true
  }

  /** A call worked. A change, or the failing call now passing, starts the count again. */
  succeeded(tool: string, input: unknown): void {
    if (CHANGES.has(tool)) return this.reset()
    if (this.#key?.startsWith(`${tool}\u0000${sameness(tool, input, "").split("\u0000")[1]}\u0000`))
      this.reset()
  }

  reset(): void {
    this.#key = undefined
    this.#count = 0
  }
}
