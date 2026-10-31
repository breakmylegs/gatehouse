/**
 * The account's plan limits, as Claude Code's own /usage shows them: the 5-hour window, the weekly ones and extra
 * usage. Read through the SDK's experimental usage call on a session that is already running (docs/sdk-notes.md),
 * so nothing new is started and no token is touched (invariant 6). Any shape it does not expect is left out.
 */
export interface PlanLimit {
  /** "5-hour limit", "Weekly, all models", "Weekly, Fable". */
  label: string
  /** Share of the window used, 0 to 100. */
  percent: number
  resetsAt?: string
  group: "session" | "weekly"
}

export interface PlanUsage {
  /** The subscription, for example "enterprise". */
  plan?: string
  limits: PlanLimit[]
  /** Extra usage the organisation allows beyond the plan, in its currency. */
  extra?: { used: number; limit: number; currency: string; percent: number }
  at: string
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined)
const pct = (v: number) => Math.max(0, Math.min(100, v))

/** The usage call's answer as the meter wants it, or undefined when it has no plan limits. */
export function planLimits(answer: unknown, now = new Date()): PlanUsage | undefined {
  const a = obj(answer)
  const r = obj(a.rate_limits)
  if (a.rate_limits_available !== true || !a.rate_limits) return undefined
  const limits: PlanLimit[] = []
  if (Array.isArray(r.limits)) {
    // The server's own list: the session window and each weekly one, with the model it covers.
    for (const raw of r.limits) {
      const l = obj(raw)
      const percent = num(l.percent)
      const group = l.group === "session" ? "session" : l.group === "weekly" ? "weekly" : undefined
      if (percent === undefined || !group) continue
      const model = str(obj(obj(l.scope).model).display_name)
      limits.push({
        label: group === "session" ? "5-hour limit" : model ? `Weekly, ${model}` : "Weekly, all models",
        percent: pct(percent),
        ...(str(l.resets_at) ? { resetsAt: str(l.resets_at) } : {}),
        group,
      })
    }
  } else {
    const windows: Array<[string, string, "session" | "weekly"]> = [
      ["five_hour", "5-hour limit", "session"],
      ["seven_day", "Weekly, all models", "weekly"],
      ["seven_day_opus", "Weekly, Opus", "weekly"],
      ["seven_day_sonnet", "Weekly, Sonnet", "weekly"],
    ]
    for (const [key, label, group] of windows) {
      const w = obj(r[key])
      const percent = num(w.utilization)
      if (percent === undefined) continue
      limits.push({
        label,
        percent: pct(percent),
        ...(str(w.resets_at) ? { resetsAt: str(w.resets_at) } : {}),
        group,
      })
    }
    for (const raw of Array.isArray(r.model_scoped) ? r.model_scoped : []) {
      const m = obj(raw)
      const percent = num(m.utilization)
      const name = str(m.display_name)
      if (percent === undefined || !name) continue
      limits.push({
        label: `Weekly, ${name}`,
        percent: pct(percent),
        ...(str(m.resets_at) ? { resetsAt: str(m.resets_at) } : {}),
        group: "weekly",
      })
    }
  }
  const x = obj(r.extra_usage)
  const places = num(x.decimal_places) ?? 2
  const used = num(x.used_credits)
  const cap = num(x.monthly_limit)
  const extra =
    x.is_enabled === true && used !== undefined && cap !== undefined && cap > 0
      ? {
          used: used / 10 ** places,
          limit: cap / 10 ** places,
          currency: str(x.currency) ?? "USD",
          percent: pct(num(x.utilization) ?? (used / cap) * 100),
        }
      : undefined
  return {
    ...(str(a.subscription_type) ? { plan: str(a.subscription_type) } : {}),
    limits,
    ...(extra ? { extra } : {}),
    at: now.toISOString(),
  }
}
