export interface QuietHours {
  start: string
  end: string
  tz: string
  /** True means the phone is still told during quiet hours. The seed policy has false. */
  phone?: boolean
}

function minutesOfDay(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0")
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0")
  return h * 60 + m
}

function toMinutes(hhmm: string): number {
  const [h = "0", m = "0"] = hhmm.split(":")
  return Number(h) * 60 + Number(m)
}

/** True when the phone should not be told right now. The window may run across midnight. */
export function phoneHeld(now: Date, quiet: QuietHours | undefined): boolean {
  if (!quiet || quiet.phone === true) return false
  const start = toMinutes(quiet.start)
  const end = toMinutes(quiet.end)
  if (start === end) return false
  const t = minutesOfDay(now, quiet.tz)
  return start < end ? t >= start && t < end : t >= start || t < end
}

/** Milliseconds until quiet hours next end, or undefined if they are not in force. Looks up to 24 hours ahead. */
export function msUntilPhoneAllowed(now: Date, quiet: QuietHours | undefined): number | undefined {
  if (!phoneHeld(now, quiet)) return undefined
  for (let minutes = 1; minutes <= 24 * 60; minutes++) {
    if (!phoneHeld(new Date(now.getTime() + minutes * 60_000), quiet)) {
      // Round to the start of that minute, so the timer fires just after the window ends.
      const t = new Date(now.getTime() + minutes * 60_000)
      return t.getTime() - (t.getTime() % 60_000) - now.getTime() + 1000
    }
  }
  return undefined
}
