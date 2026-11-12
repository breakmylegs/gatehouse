/**
 * The loop guard (backlog G19), and D-075's thrash detector (Frontier build, Wave 2). A session that runs the same
 * command and gets the same failure three times in a row, with nothing changed in between, is going round in circles;
 * so is one that makes an edit and undoes it, twice. The first time, Claude is told what it repeated, with the
 * failure, so it can try something else; if it does it again, the turn stops, the phone is told, and the screen says
 * why. A fix cycle is not a loop: a file written or edited in between, a different call failing, or the command
 * passing starts the count again. Reads in between do not, since reading and trying again unchanged is the loop itself.
 */
export const LOOP_REPEATS = 3
/** An edit made and then undone this many times is thrashing. */
export const REVERSALS = 2

export type LoopAction = { act: "warn" | "stop"; what: string }

/** Tools whose success changes something, so the next failure is a new attempt. */
const CHANGES = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"])

const commandOf = (input: unknown): string =>
  input && typeof input === "object" && typeof (input as { command?: unknown }).command === "string"
    ? (input as { command: string }).command
    : JSON.stringify(input ?? null)

/** A failure as compared: digits and spacing smoothed, so timings and line counts do not hide a repeat. */
function sameness(tool: string, input: unknown, error: string): string {
  const err = error.slice(0, 4000).replace(/\d+/g, "#").replace(/\s+/g, " ").trim()
  return `${tool}\u0000${commandOf(input).trim()}\u0000${err}`
}

export class LoopGuard {
  #key: string | undefined
  #count = 0
  /** D-075: what Claude was told it repeated; doing the same again after that stops the turn. */
  readonly #warned = new Set<string>()
  /** D-075: each file's last edit, and how many times an edit there was undone. */
  readonly #lastEdit = new Map<string, { from: string; to: string }>()
  readonly #reversals = new Map<string, number>()

  /** A call failed. Warn the third time the same failure comes in a row; stop when it comes again after that. */
  failed(tool: string, input: unknown, error: string): LoopAction | undefined {
    const key = sameness(tool, input, error)
    this.#count = key === this.#key ? this.#count + 1 : 1
    this.#key = key
    if (this.#count < LOOP_REPEATS) return undefined
    const what = `${tool} ${commandOf(input).trim().slice(0, 200)}`
    if (this.#warned.has(key)) {
      this.reset()
      return { act: "stop", what }
    }
    this.#warned.add(key)
    return { act: "warn", what }
  }

  /** A call worked. A change, or the failing call now passing, starts the count again; an edit undone twice warns. */
  succeeded(tool: string, input: unknown): LoopAction | undefined {
    if (tool === "Edit") {
      const i = (input ?? {}) as { file_path?: unknown; old_string?: unknown; new_string?: unknown }
      if (typeof i.file_path === "string" && typeof i.old_string === "string" && typeof i.new_string === "string") {
        const file = i.file_path.replace(/\\/g, "/").toLowerCase()
        const last = this.#lastEdit.get(file)
        this.#lastEdit.set(file, { from: i.old_string, to: i.new_string })
        if (last && last.from === i.new_string && last.to === i.old_string && i.old_string !== i.new_string) {
          const n = (this.#reversals.get(file) ?? 0) + 1
          this.#reversals.set(file, n)
          this.reset()
          const what = `an edit of ${i.file_path} made and undone`
          if (n === REVERSALS) return { act: "warn", what }
          if (n > REVERSALS) {
            this.#reversals.set(file, 0)
            return { act: "stop", what }
          }
          return undefined
        }
      }
    }
    if (CHANGES.has(tool)) {
      this.reset()
      return undefined
    }
    if (this.#key?.startsWith(`${tool}\u0000${commandOf(input).trim()}\u0000`)) this.reset()
    return undefined
  }

  reset(): void {
    this.#key = undefined
    this.#count = 0
  }
}

/** What Claude is told the first time. */
export const warnText = (what: string) =>
  `Codehouse: this is the same thing again (${what}), with the same result, and nothing changed in between. Do not repeat it: look at why it fails and try a different approach, or say what is blocking you. If it happens again, the turn will stop.`
