export type RiskBand = "Low" | "Moderate" | "High" | "Severe"

export function riskBand(risk: number): RiskBand {
  if (risk >= 85) return "Severe"
  if (risk >= 70) return "High"
  if (risk >= 40) return "Moderate"
  return "Low"
}

export function age(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)} min`
  if (s < 86400) return `${Math.floor(s / 3600)} h`
  return `${Math.floor(s / 86400)} d`
}

/** "14:02" today, "29 Oct, 14:02" earlier this year, "29 Oct 2025, 14:02" before that. */
export function stamp(at: number, now: number = Date.now()): string {
  const d = new Date(at)
  const n = new Date(now)
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  if (d.toDateString() === n.toDateString()) return time
  const date = d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(d.getFullYear() === n.getFullYear() ? {} : { year: "numeric" }),
  })
  return `${date}, ${time}`
}

export function clock(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
}

/** Dollars: three places below a dollar, where most turns cost, two above; nothing spent is $0.00. */
export function money(usd: number): string {
  if (usd === 0) return "$0.00"
  return usd < 1 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(2)}`
}

/** The text of the thing being approved, exactly as the tool will receive it. */
export function commandText(toolName: string, raw: Record<string, unknown>): string {
  const s = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : undefined)
  if (toolName === "Bash" || toolName === "PowerShell")
    return s("command") ?? JSON.stringify(raw, null, 2)
  return JSON.stringify(raw, null, 2)
}

export function shortId(id: string): string {
  return id.length > 8 ? id.slice(-8) : id
}
