import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"

/** A worktree Codehouse made, as the Host lists it (apps/host/src/worktrees.ts). */
export interface WorktreeRow {
  path: string
  branch: string
  repo: string
  baseName: string
  createdAt: string
  exists: boolean
  bytes: number
  changed: number
  commits: number
  open: boolean
}

const size = (b: number) =>
  b >= 1024 ** 3
    ? `${(b / 1024 ** 3).toFixed(1)} GB`
    : `${Math.max(1, Math.round(b / 1024 ** 2))} MB`

/**
 * The worktrees Codehouse made for sessions (B10), with what each holds, and Remove. Removing takes the folder away
 * and keeps the branch, so nothing committed is lost; merging it back is yours to do. One with changes not committed
 * asks again before it goes.
 */
export function WorktreesPanel() {
  const [rows, setRows] = useState<WorktreeRow[]>()
  const [asking, setAsking] = useState<string>()
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    const r = await api<{ worktrees: WorktreeRow[] }>("GET", "/api/worktrees")
    if (r.ok && r.data) setRows(r.data.worktrees)
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const remove = async (w: WorktreeRow, force: boolean) => {
    setBusy(true)
    const r = await api<{ removed: string; branch: string }>("POST", "/api/worktrees/remove", {
      path: w.path,
      ...(force ? { force: true } : {}),
    })
    setBusy(false)
    if (r.ok) {
      toast(`The worktree is removed. Its branch ${w.branch} is kept.`)
      setAsking(undefined)
      void load()
    } else toast.error(r.error ?? "It could not be removed.")
  }

  if (!rows?.length) return null
  return (
    <section aria-labelledby="worktrees-title" className="grid gap-2">
      <h2 id="worktrees-title" className="m-0 text-[17px]">
        Worktrees
      </h2>
      <p className="m-0 text-[13.5px] text-mut">
        Folders Codehouse made for sessions, each a separate checkout on a branch of its own.
        Removing one takes the folder away and keeps its branch: merge the work back when you are
        ready.
      </p>
      <ul className="m-0 grid list-none gap-2 p-0">
        {rows.map((w) => (
          <li key={w.path} className="panel grid gap-1 p-3 text-[14px]">
            <span className="flex flex-wrap items-baseline gap-x-3">
              <strong className="mono">{w.branch}</strong>
              <span className="text-mut">from {w.baseName}</span>
              {w.open ? <span className="font-semibold">A session is working here</span> : null}
            </span>
            <span className="mono truncate text-[12.5px] text-mut">{w.path}</span>
            <span className="text-[13px]">
              {w.exists
                ? `${size(w.bytes)}, ${w.commits === 1 ? "1 commit" : `${w.commits} commits`} on its branch, ${
                    w.changed === 0
                      ? "nothing changed that is not committed"
                      : w.changed === 1
                        ? "1 file changed and not committed"
                        : `${w.changed} files changed and not committed`
                  }.`
                : "The folder has gone."}
            </span>
            {asking === w.path ? (
              <span
                className="flex flex-wrap items-center gap-2"
                role="group"
                aria-label={`Remove ${w.branch}?`}
              >
                <span>
                  {w.changed
                    ? `Its ${w.changed === 1 ? "change" : "changes"} not committed will be lost. The branch stays.`
                    : "The folder goes; the branch stays."}
                </span>
                <button
                  type="button"
                  className="btn btn-deny !min-h-7"
                  disabled={busy}
                  onClick={() => void remove(w, w.changed > 0)}
                >
                  {w.changed ? "Remove anyway" : "Remove"}
                </button>
                <button type="button" className="btn !min-h-7" onClick={() => setAsking(undefined)}>
                  Keep it
                </button>
              </span>
            ) : (
              <span>
                <button
                  type="button"
                  className="btn !min-h-7"
                  disabled={w.open}
                  title={w.open ? "Close the session first" : undefined}
                  aria-label={`Remove the worktree ${w.branch}`}
                  onClick={() => setAsking(w.path)}
                >
                  Remove…
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
