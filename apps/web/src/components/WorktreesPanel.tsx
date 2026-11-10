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

/** What merging a worktree back would bring (apps/host/src/worktree-merge.ts). */
export interface MergePreview {
  into: string
  branch: string
  tip: string
  commits: Array<{ hash: string; subject: string }>
  stat: string
  diff: string
  truncated: boolean
  uncommitted: number
  checkoutDirty: number
}

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`)

const size = (b: number) =>
  b >= 1024 ** 3
    ? `${(b / 1024 ** 3).toFixed(1)} GB`
    : `${Math.max(1, Math.round(b / 1024 ** 2))} MB`

/**
 * The worktrees Codehouse made for sessions (B10), with what each holds, Merge back and Remove. Merging back shows the
 * commits and the diff first and merges exactly those into the checkout's branch (G14). Removing takes the folder
 * away and keeps the branch, so nothing committed is lost. One with changes not committed asks again before it goes.
 */
export function WorktreesPanel() {
  const [rows, setRows] = useState<WorktreeRow[]>()
  const [asking, setAsking] = useState<string>()
  const [merging, setMerging] = useState<{ path: string; preview: MergePreview }>()
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

  const look = async (w: WorktreeRow) => {
    setBusy(true)
    const r = await api<MergePreview>(
      "GET",
      `/api/worktrees/merge-preview?path=${encodeURIComponent(w.path)}`,
    )
    setBusy(false)
    if (r.ok && r.data) {
      setAsking(undefined)
      setMerging({ path: w.path, preview: r.data })
    } else toast.error(r.error ?? "What it brings could not be read.")
  }

  const merge = async () => {
    if (!merging) return
    const { path, preview } = merging
    setBusy(true)
    const r = await api<{ into: string; commits: number }>("POST", "/api/worktrees/merge", {
      path,
      into: preview.into,
      tip: preview.tip,
    })
    setBusy(false)
    if (r.ok && r.data) {
      toast(
        `${plural(r.data.commits, "commit", "commits")} from ${preview.branch} merged into ${r.data.into}.`,
      )
      setMerging(undefined)
      void load()
    } else toast.error(r.error ?? "It could not be merged.")
  }

  if (!rows?.length) return null
  return (
    <section aria-labelledby="worktrees-title" className="grid gap-2">
      <h2 id="worktrees-title" className="m-0 text-[17px]">
        Worktrees
      </h2>
      <p className="m-0 text-[13.5px] text-mut">
        Folders Codehouse made for sessions, each a separate checkout on a branch of its own. Merge
        back shows what a branch brings before it merges. Removing one takes the folder away and
        keeps its branch.
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
            {merging?.path === w.path ? (
              <MergeLook
                preview={merging.preview}
                busy={busy}
                onMerge={() => void merge()}
                onCancel={() => setMerging(undefined)}
              />
            ) : asking === w.path ? (
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
              <span className="flex flex-wrap gap-2">
                {w.commits > 0 ? (
                  <button
                    type="button"
                    className="btn !min-h-7"
                    disabled={busy}
                    aria-label={`Merge ${w.branch} back`}
                    onClick={() => void look(w)}
                  >
                    Merge back…
                  </button>
                ) : null}
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

/** The commits and diff a merge would bring, read before choosing Merge. */
function MergeLook({
  preview: p,
  busy,
  onMerge,
  onCancel,
}: {
  preview: MergePreview
  busy: boolean
  onMerge: () => void
  onCancel: () => void
}) {
  const blocked = p.checkoutDirty > 0 || p.commits.length === 0
  return (
    <div className="grid gap-2" role="group" aria-label={`Merge ${p.branch} into ${p.into}?`}>
      <span>
        {p.commits.length
          ? `${plural(p.commits.length, "commit", "commits")} from ${p.branch} would be merged into ${p.into}:`
          : `${p.branch} has nothing that ${p.into} does not already have.`}
      </span>
      {p.commits.length ? (
        <ul className="m-0 grid list-none gap-0.5 p-0 text-[13px]">
          {p.commits.slice(0, 30).map((c) => (
            <li key={c.hash}>
              <span className="mono text-mut">{c.hash}</span> {c.subject}
            </li>
          ))}
          {p.commits.length > 30 ? (
            <li className="text-mut">and {p.commits.length - 30} more</li>
          ) : null}
        </ul>
      ) : null}
      {p.stat ? <pre className="mono m-0 overflow-x-auto text-[12px] text-mut">{p.stat}</pre> : null}
      {p.diff ? (
        <details>
          <summary className="cursor-pointer text-[13px]">The whole diff</summary>
          <pre
            className="mono m-0 max-h-80 overflow-auto text-[12px]"
            aria-label={`The diff of ${p.branch}`}
          >
            {p.diff}
          </pre>
          {p.truncated ? (
            <span className="text-[12.5px] text-mut">It is long, so only the start is shown.</span>
          ) : null}
        </details>
      ) : null}
      {p.uncommitted ? (
        <span className="text-[13px]">
          The worktree also has {plural(p.uncommitted, "change", "changes")} not committed. They are
          not part of the merge.
        </span>
      ) : null}
      {p.checkoutDirty ? (
        <span className="text-[13px] font-semibold">
          Your checkout has {plural(p.checkoutDirty, "change", "changes")} not committed. Commit or
          stash them first, so they are not mixed into the merge.
        </span>
      ) : null}
      <span className="text-[12.5px] text-mut">
        If the merge meets a conflict it is undone at once and nothing changes.
      </span>
      <span className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary !min-h-7"
          disabled={busy || blocked}
          onClick={onMerge}
        >
          Merge into {p.into}
        </button>
        <button type="button" className="btn !min-h-7" onClick={onCancel}>
          Cancel
        </button>
      </span>
    </div>
  )
}
