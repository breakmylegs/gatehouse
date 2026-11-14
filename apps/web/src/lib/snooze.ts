/**
 * T-025 (t3code review, O31): snooze a session. It leaves the sidebar's list for a folded Snoozed group until its
 * time, and wakes at once when it needs you: a request or a question waiting, or an error. Requests are never hidden
 * (they stay on Needs you). Kept in this browser's local storage by session id, read tolerantly.
 */
const KEY = "gatehouse.snooze"

type Map = Record<string, string>

function read(): Map {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown
    if (!v || typeof v !== "object" || Array.isArray(v)) return {}
    return Object.fromEntries(Object.entries(v).filter(([, t]) => typeof t === "string")) as Map
  } catch {
    return {}
  }
}

function write(m: Map): void {
  localStorage.setItem(KEY, JSON.stringify(m))
  window.dispatchEvent(new Event("codeh:snooze"))
}

export function snoozeSession(id: string, until: Date): void {
  write({ ...read(), [id]: until.toISOString() })
}

export function wakeSession(id: string): void {
  const m = read()
  delete m[id]
  write(m)
}

export function snoozedUntil(id: string): Date | undefined {
  const t = read()[id]
  const d = t ? new Date(t) : undefined
  return d && !Number.isNaN(d.getTime()) ? d : undefined
}

/** Whether a session stays in the Snoozed group now: before its time, and nothing of it needs you. */
export function isSnoozed(id: string, needsYou: boolean, now = new Date()): boolean {
  if (needsYou) return false
  const until = snoozedUntil(id)
  return !!until && until.getTime() > now.getTime()
}

/** An hour from now. */
export const inAnHour = (now = new Date()) => new Date(now.getTime() + 60 * 60_000)

/** Nine tomorrow morning, local time. */
export function tomorrowMorning(now = new Date()): Date {
  const d = new Date(now)
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  return d
}
