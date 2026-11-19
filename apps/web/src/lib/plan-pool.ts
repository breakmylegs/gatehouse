/**
 * T-129: the plan limits of all your accounts as one pool. Each limit (the 5-hour window, each weekly one) is one bar
 * of every account's share: with two accounts each is half the bar, filled as far as that account has used it. The next
 * reset says which account it is and how much of the pool it gives back.
 */
export interface AccountLimits {
  account: string
  label: string
  limits: Array<{ label: string; percent: number; resetsAt?: string }>
}

export interface PooledLimit {
  label: string
  /** Of the whole pool, 0 to 100. */
  used: number
  /** One for each account that has this limit, in the order given: its share of the bar and how much of it is used. */
  segments: Array<{ account: string; label: string; share: number; used: number }>
  /** The soonest reset still to come, and how much of the pool it gives back. */
  next?: { account: string; label: string; at: string; returns: number }
}

const clamp = (v: number) => Math.max(0, Math.min(100, v))

export function poolLimits(accounts: AccountLimits[], now: number): PooledLimit[] {
  const labels = [...new Set(accounts.flatMap((a) => a.limits.map((l) => l.label)))]
  return labels.map((label) => {
    const having = accounts.flatMap((a) => {
      const l = a.limits.find((x) => x.label === label)
      return l ? [{ a, l }] : []
    })
    const share = 100 / having.length
    const segments = having.map(({ a, l }) => ({ account: a.account, label: a.label, share, used: (clamp(l.percent) * share) / 100 }))
    const upcoming = having
      .filter(({ l }) => l.resetsAt && new Date(l.resetsAt).getTime() > now && l.percent > 0)
      .sort((x, y) => new Date(x.l.resetsAt!).getTime() - new Date(y.l.resetsAt!).getTime())[0]
    return {
      label,
      used: segments.reduce((n, s) => n + s.used, 0),
      segments,
      ...(upcoming ? { next: { account: upcoming.a.account, label: upcoming.a.label, at: upcoming.l.resetsAt!, returns: (clamp(upcoming.l.percent) * share) / 100 } } : {}),
    }
  })
}
