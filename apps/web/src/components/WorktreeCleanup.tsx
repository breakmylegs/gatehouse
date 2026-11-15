import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"

interface Rules {
  unchanged: boolean
  merged: boolean
  inactiveDays: number | ""
}
interface Result {
  removed: Array<{ path: string; branch: string; why: string }>
  kept: Array<{ path: string; why: string }>
}

/**
 * T-089 (t3code review, O31): clean up worktrees by rules: now, with a list of what went and what stayed and why, or
 * by themselves every six hours. All off until you choose; a worktree with any uncommitted, untracked or ignored file,
 * or one a session works in, is never removed by a rule, and its branch always stays.
 */
export function WorktreeCleanup({ onDone }: { onDone: () => void }) {
  const [rules, setRules] = useState<Rules>({ unchanged: false, merged: false, inactiveDays: "" })
  const [auto, setAuto] = useState(false)
  const [result, setResult] = useState<Result>()
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void api<{ saved: Record<string, unknown> }>("GET", "/api/settings").then((r) => {
      const p = r.ok ? (r.data?.saved.worktreeCleanup as Partial<Rules> | undefined) : undefined
      if (!p) return
      setRules({ unchanged: p.unchanged === true, merged: p.merged === true, inactiveDays: typeof p.inactiveDays === "number" ? p.inactiveDays : "" })
      setAuto(true)
    })
  }, [])
  const chosen = rules.unchanged || rules.merged || rules.inactiveDays !== ""
  const body = () => ({
    ...(rules.unchanged ? { unchanged: true } : {}),
    ...(rules.merged ? { merged: true } : {}),
    ...(rules.inactiveDays !== "" ? { inactiveDays: rules.inactiveDays } : {}),
  })

  async function now() {
    setBusy(true)
    const r = await api<Result>("POST", "/api/worktrees/cleanup", body())
    setBusy(false)
    if (!r.ok || !r.data) return toast.error(r.error ?? "The clean-up did not run.", { id: "cleanup" })
    setResult(r.data)
    onDone()
  }

  /** Keeps the rules in Settings, so they run by themselves; anything else there is kept as it is. */
  async function keep(on: boolean) {
    const s = await api<{ saved: Record<string, unknown> }>("GET", "/api/settings")
    if (!s.ok || !s.data) return toast.error(s.error ?? "Settings could not be read.", { id: "cleanup" })
    const next = { ...s.data.saved }
    if (on && chosen) next.worktreeCleanup = body()
    else delete next.worktreeCleanup
    const r = await api("PUT", "/api/settings", next)
    if (!r.ok) return toast.error(r.error ?? "Not saved.", { id: "cleanup" })
    setAuto(on && chosen)
    toast(on && chosen ? "These rules now run by themselves every six hours." : "The rules no longer run by themselves.", { id: "cleanup" })
  }

  return (
    <section aria-label="Clean up worktrees" className="panel grid gap-2 p-3 text-[13.5px]">
      <strong>Clean up by rules</strong>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={rules.unchanged} onChange={(e) => setRules({ ...rules, unchanged: e.target.checked })} />
        Unchanged: no commits of its own
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={rules.merged} onChange={(e) => setRules({ ...rules, merged: e.target.checked })} />
        Merged: its branch is in the branch it came from
      </label>
      <label className="flex items-center gap-2">
        Inactive for more than
        <input
          type="number"
          min={1}
          max={365}
          className="field w-20 !min-h-7"
          aria-label="Days inactive"
          value={rules.inactiveDays}
          onChange={(e) => setRules({ ...rules, inactiveDays: e.target.value === "" ? "" : Math.min(365, Math.max(1, Number(e.target.value))) })}
        />
        days
      </label>
      <p className="m-0 text-xs text-mut">
        A worktree with any uncommitted, untracked or ignored file (an .env, a build) is never removed by a rule, nor one
        a session works in. Only the folder goes; its branch stays. Each removal is recorded first.
      </p>
      <span className="flex flex-wrap gap-2">
        <button type="button" className="btn" disabled={!chosen || busy} onClick={() => void now()}>
          Clean up now
        </button>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={auto} disabled={!chosen && !auto} onChange={(e) => void keep(e.target.checked)} />
          Run these by themselves every six hours
        </label>
      </span>
      {result ? (
        <div className="grid gap-1" aria-live="polite">
          <span>
            {result.removed.length === 1 ? "1 worktree removed" : `${result.removed.length} worktrees removed`}, {result.kept.length} kept.
          </span>
          <ul className="m-0 grid list-none gap-0.5 p-0 text-xs">
            {result.removed.map((r) => (
              <li key={r.path}>
                <span className="mono">{r.branch}</span>: removed, because {r.why}
              </li>
            ))}
            {result.kept.map((k) => (
              <li key={k.path} className="text-mut">
                <span className="mono">{k.path}</span>: kept, because {k.why}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
