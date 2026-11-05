/**
 * Which Windows notifications you get, each on its own (owner, 4 Nov, after Claude's desktop app): a request that
 * needs you, a reply that finishes while you are elsewhere, and a build queue that is empty. All need notifications on
 * in Settings first. Kept in this window, read tolerantly.
 */
export interface NotifyKinds {
  requests: boolean
  completions: boolean
  queueEmpty: boolean
}

export const DEFAULT_KINDS: NotifyKinds = { requests: true, completions: true, queueEmpty: true }
const KEY = "gatehouse.notifyKinds"
/** A turn that took this long is worth telling you about; a quick answer is not. */
export const LONG_TURN_MS = 20_000

export function readKinds(): NotifyKinds {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<NotifyKinds> | null
    return {
      requests: v?.requests !== false,
      completions: v?.completions !== false,
      queueEmpty: v?.queueEmpty !== false,
    }
  } catch {
    return DEFAULT_KINDS
  }
}

export function saveKinds(k: NotifyKinds): void {
  try {
    if (k.requests && k.completions && k.queueEmpty) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, JSON.stringify(k))
  } catch {
    // storage blocked: the choice lasts until the window closes
  }
}

/** Whether a finished turn is worth a notification: it ran a while, and you are not looking at Codehouse. */
export function worthTelling(durationMs: unknown, focused: boolean): boolean {
  return !focused && typeof durationMs === "number" && durationMs >= LONG_TURN_MS
}
