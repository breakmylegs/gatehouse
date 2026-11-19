import clsx from "clsx"
import { useEffect, useState } from "react"
import { poolLimits, type AccountLimits } from "../lib/plan-pool"
import { useNow } from "../lib/useNow"
import { PLAN_HIGH, readPlan, resets } from "./PlanMeter"

/** T-129: every signed-in account's limits as one pool, one segment of each bar per account. Shown for two or more. */
export function PlanPool({ accounts }: { accounts: Array<{ id: string; label: string }> }) {
  const [read, setRead] = useState<AccountLimits[]>()
  const now = useNow(30_000)
  const ids = accounts.map((a) => a.id).join(",")
  useEffect(() => {
    let live = true
    void Promise.all(accounts.map(async (a) => ({ account: a.id, label: a.label, limits: (await readPlan(a.id))?.limits ?? [] }))).then((r) => {
      if (live) setRead(r.filter((a) => a.limits.length))
    })
    return () => {
      live = false
    }
    // The accounts by id: a new array with the same accounts reads nothing again.
  }, [ids])
  if (accounts.length < 2 || !read || read.length < 2) return null
  const pooled = poolLimits(read, now)
  return (
    <section aria-label="All your accounts together" className="grid gap-2">
      <h3 className="m-0 text-sm">All your accounts together</h3>
      {pooled.map((p) => (
        <div key={p.label} className="grid gap-1">
          <span className="flex justify-between gap-3 text-sm">
            <span>{p.label}</span>
            <span className="text-mut">{Math.round(p.used)}% of the pool used</span>
          </span>
          <span className="plan-bar flex" role="img" aria-label={p.segments.map((s) => `${s.label}: ${Math.round((s.used / s.share) * 100)}% used`).join(", ")}>
            {p.segments.map((s, i) => (
              <span key={s.account} className={clsx("relative h-full", i > 0 && "border-l border-line")} style={{ width: `${s.share}%` }}>
                <span className={clsx("plan-bar-fill absolute inset-y-0 left-0", (s.used / s.share) * 100 >= PLAN_HIGH && "plan-ring-high")} style={{ width: `${(s.used / s.share) * 100}%` }} />
              </span>
            ))}
          </span>
          {p.next ? (
            <span className="text-xs text-mut">
              Next: {p.next.label}. {resets(p.next.at, now)}, giving back {Math.round(p.next.returns)}% of the pool.
            </span>
          ) : null}
        </div>
      ))}
    </section>
  )
}
