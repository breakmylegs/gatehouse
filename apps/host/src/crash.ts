/**
 * When Claude Code's process crashes (owner, 1 Nov, screenshot 118c19: a session stopped with "Claude Code process
 * exited with code 3221226505" after Windows ran out of paging file). Windows reports a crash as a large number, which
 * says nothing to a person: the common ones are named here with what usually causes them. A session that was working
 * when its process crashed is started again on the same conversation, a limited number of times.
 */
const KNOWN: Record<number, string> = {
  0xc0000409:
    "Claude Code stopped suddenly. This often happens when Windows is low on memory: closing other programs or sessions helps.",
  0xc0000005:
    "Claude Code stopped suddenly after reading memory it should not have. Starting it again usually works.",
  0xc0000017:
    "Windows ran out of memory for Claude Code. Closing other programs or sessions helps.",
  0xc000012d:
    "Windows ran out of memory for Claude Code (the paging file is full). Closing other programs or sessions helps.",
  0xc00000fd:
    "Claude Code stopped suddenly (it ran out of stack). Starting it again usually works.",
  0xc000013a: "Claude Code was stopped from outside, as if Ctrl+C was pressed in its window.",
  0x40010004: "Claude Code was closed by Windows, for example when signing out.",
}

/** Stopped on purpose by someone or by Windows, not crashed: never started again by itself. */
const DELIBERATE = new Set([0xc000013a, 0x40010004])

/** A process exit the SDK reported, as its code, or undefined when the message is not one. */
export function exitCodeOf(message: string): number | undefined {
  const m = /process exited with code (-?\d+)/i.exec(message)
  if (!m) return undefined
  const n = Number(m[1])
  if (!Number.isSafeInteger(n)) return undefined
  // Some report the same code as a negative 32-bit number.
  return n < 0 ? n >>> 0 : n
}

const hex = (code: number) => `0x${code.toString(16).toUpperCase().padStart(8, "0")}`

/** The message as a person can use it. A crash Windows names gets the usual cause and its code. */
export function describeStop(message: string): string {
  const code = exitCodeOf(message)
  if (code === undefined) return message
  const known = KNOWN[code]
  return known ? `${known} (Windows error ${hex(code)}.)` : message
}

/**
 * A crash of the process itself: a Windows error code (0xC0000000 and up), other than being stopped on purpose. A
 * plain exit code, such as 1, can be Claude Code refusing to go on (a sign-in problem, say), so it is not one.
 */
export function isProcessCrash(message: string): boolean {
  const code = exitCodeOf(message)
  return code !== undefined && code >= 0xc0000000 && !DELIBERATE.has(code)
}

/** At most this many starts after a crash, per session, in the window below. */
export const CRASH_RESTARTS = 2
export const CRASH_WINDOW_MS = 30 * 60_000

/** Counts the starts after a crash, so a process that keeps crashing stops being started again. */
export class CrashRestarts {
  readonly #at = new Map<string, number[]>()

  /** True, and counted, when the session may be started again now. */
  take(sessionId: string, now = Date.now()): boolean {
    const recent = (this.#at.get(sessionId) ?? []).filter((t) => now - t < CRASH_WINDOW_MS)
    if (recent.length >= CRASH_RESTARTS) {
      this.#at.set(sessionId, recent)
      return false
    }
    this.#at.set(sessionId, [...recent, now])
    return true
  }
}

/** Sent to a session started again after its process crashed while it was working. */
export const CRASH_RESUME_PROMPT =
  "Claude Code stopped suddenly while you were working (its process crashed), which cut your last turn short. Codehouse started it again on the same conversation. Carry on from where you were, without starting again."
