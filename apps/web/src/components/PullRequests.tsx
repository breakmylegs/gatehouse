import { useEffect, useState } from "react"
import { api } from "../lib/api"

interface Pr {
  number: number
  title: string
  state: string
  url: string
  branch: string
  draft: boolean
}
interface Detail extends Pr {
  base: string
  review?: string
  mergeable?: string
  checks: Array<{ name: string; state: string }>
}

/**
 * T-061 (t3code review, O31): the repository's open pull requests and one's checks, read through gh while the GitHub
 * connection is on. Read only; titles and check names are others' words, shown as text.
 */
export function PullRequests({ q }: { q: string }) {
  const [list, setList] = useState<Pr[]>()
  const [error, setError] = useState<string>()
  const [open, setOpen] = useState<Detail>()
  useEffect(() => {
    void api<{ prs: Pr[] }>("GET", `/api/forge/prs?${q}`).then((r) =>
      r.ok && r.data ? setList(r.data.prs) : setError(r.error ?? "The pull requests could not be read."),
    )
  }, [q])
  async function show(n: number) {
    const r = await api<{ pr: Detail }>("GET", `/api/forge/pr?${q}&number=${n}`)
    if (r.ok && r.data) setOpen(r.data.pr)
    else setError(r.error ?? "That pull request could not be read.")
  }
  if (error)
    return (
      <p role="alert" className="m-0 p-2 text-[13px]">
        {error}
      </p>
    )
  if (!list) return <p className="m-0 p-2 text-[13px] text-mut">Reading GitHub...</p>
  if (!list.length) return <p className="m-0 p-2 text-[13px] text-mut">No open pull requests.</p>
  return (
    <div className="grid gap-2 overflow-auto p-1 text-[13px]">
      <ul className="m-0 grid list-none gap-1 p-0" aria-label="Open pull requests">
        {list.map((p) => (
          <li key={p.number}>
            <button type="button" className="flex w-full cursor-pointer gap-2 border-0 bg-transparent p-1 text-left hover:bg-s2" onClick={() => void show(p.number)}>
              <span className="mono shrink-0">#{p.number}</span>
              <span className="min-w-0 flex-1 truncate">{p.title}</span>
              <span className="shrink-0 text-mut">{p.draft ? "draft" : p.branch}</span>
            </button>
          </li>
        ))}
      </ul>
      {open ? (
        <section aria-label={`Pull request ${open.number}`} className="panel grid gap-1 p-2">
          <strong>
            #{open.number} {open.title}
          </strong>
          <span className="text-mut">
            {open.branch} into {open.base}
            {open.review ? `, review: ${open.review.toLowerCase().replace(/_/g, " ")}` : ""}
            {open.mergeable ? `, ${open.mergeable.toLowerCase()}` : ""}
          </span>
          {open.url ? (
            <a href={open.url} target="_blank" rel="noreferrer">
              Open on GitHub
            </a>
          ) : null}
          <ul className="m-0 grid list-none gap-0.5 p-0" aria-label="Checks">
            {open.checks.map((c, i) => (
              <li key={i} className="flex gap-2">
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="shrink-0 text-mut">{c.state.toLowerCase()}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
