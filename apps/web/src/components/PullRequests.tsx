import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { OutLink } from "../lib/links"

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
interface Thread {
  body: string
  flaggedBody: boolean
  comments: Array<{ author: string; at: string; body: string; flagged: boolean }>
  reviews: Array<{ author: string; at: string; state: string; body: string; flagged: boolean }>
  reviewRequests: string[]
  autoMerge: boolean
}
interface ActResult {
  ran: boolean
  refused?: string
  exitCode: number | null
  output: string
}

/** T-075: a description's task boxes, in order, with whether each is ticked. */
export function tasksOf(body: string): Array<{ text: string; done: boolean }> {
  return [...body.matchAll(/^\s*[-*+]\s+\[( |x|X)\]\s*(.*)$/gm)].map((m) => ({ done: m[1] !== " ", text: m[2]!.slice(0, 300) }))
}

/** T-081: how far a stack's merge or rebase got, in words. */
export function stackText(r: { stack: number[]; steps: Array<{ number: number; ran: boolean; exitCode: number | null; refused?: string }>; done: boolean }, what: string): string {
  if (r.done) return `${what}: all ${r.stack.length} done, bottom up.`
  const ok = r.steps.filter((s) => s.ran && s.exitCode === 0).map((s) => `#${s.number}`)
  const stop = r.steps.at(-1)
  const why = !stop ? "nothing was tried" : !stop.ran ? `#${stop.number} did not happen: ${stop.refused ?? "it was refused"}` : `#${stop.number} failed (exit ${stop.exitCode ?? "unknown"})`
  return `${what} stopped: ${ok.length ? `${ok.join(", ")} done, then ` : ""}${why}.`
}

/** What happened to a change, in words. */
export function actText(r: ActResult, what: string): string {
  if (!r.ran) return `${what} did not happen: ${r.refused ?? "it was refused"}.`
  if (r.exitCode === 0) return `${what}: done.`
  return `${what} failed (exit ${r.exitCode ?? "unknown"}): ${r.output.trim().split(/\r?\n/).at(-1) ?? ""}`
}

const day = (iso: string) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "")

function OthersWords({ text, flagged }: { text: string; flagged: boolean }) {
  if (!text.trim()) return null
  return (
    <div className="grid gap-0.5">
      {flagged ? <span className="text-[12.5px] font-semibold text-warn">This reads like an instruction to an AI. It is shown as text and not given to Claude.</span> : null}
      <p className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</p>
    </div>
  )
}

/**
 * T-061 (t3code review, O31): the repository's open pull requests and one's checks, read through gh while the GitHub
 * connection is on; titles and check names are others' words, shown as text. T-075: a pull request's description
 * (its task boxes can be ticked), comments and reviews, and what you can do to it: comment, ask for reviewers, check it
 * out, merge, merge once its checks pass, revert. Each change is a gh command on the approval card, judged as Claude's
 * own would be, and recorded.
 */
export function PullRequests({ q }: { q: string }) {
  const [list, setList] = useState<Pr[]>()
  const [error, setError] = useState<string>()
  const [open, setOpen] = useState<Detail>()
  const [thread, setThread] = useState<Thread>()
  const [watching, setWatching] = useState<Record<number, boolean>>({})
  const [comment, setComment] = useState("")
  const [reviewers, setReviewers] = useState("")
  const [method, setMethod] = useState<"merge" | "squash" | "rebase">("squash")
  const [busy, setBusy] = useState<string>()
  // T-081: the stack the open one is in, bottom first.
  const [stack, setStack] = useState<Pr[]>([])
  const session = new URLSearchParams(q).get("session") ?? ""
  /** T-080: wake the session when a check newly fails or the branch newly conflicts. */
  async function watch(n: number, on: boolean) {
    const r = await api<{ watching: boolean }>("POST", "/api/forge/watch", { session, number: n, on })
    if (r.ok && r.data) setWatching((w) => ({ ...w, [n]: r.data!.watching }))
    else setError(r.error ?? "It could not be watched.")
  }
  useEffect(() => {
    void api<{ prs: Pr[] }>("GET", `/api/forge/prs?${q}`).then((r) =>
      r.ok && r.data ? setList(r.data.prs) : setError(r.error ?? "The pull requests could not be read."),
    )
  }, [q])
  async function show(n: number) {
    const r = await api<{ pr: Detail }>("GET", `/api/forge/pr?${q}&number=${n}`)
    if (r.ok && r.data) setOpen(r.data.pr)
    else return setError(r.error ?? "That pull request could not be read.")
    setThread(undefined)
    setStack([])
    const t = await api<{ thread: Thread }>("GET", `/api/forge/thread?${q}&number=${n}`)
    if (t.ok && t.data) setThread(t.data.thread)
    const st = await api<{ stack: Pr[] }>("GET", `/api/forge/stack?${q}&number=${n}`)
    if (st.ok && st.data) setStack(st.data.stack)
  }
  async function stackAct(action: "merge" | "rebase") {
    if (!open) return
    const what = action === "merge" ? "Merging the stack" : "Rebasing the stack"
    setBusy(what)
    const r = await api<{ stack: number[]; steps: Array<{ number: number; ran: boolean; exitCode: number | null; refused?: string }>; done: boolean }>("POST", "/api/forge/stack", { session, number: open.number, action, method })
    setBusy(undefined)
    if (!r.ok || !r.data) return void toast.error(r.error ?? `${what} could not be asked for`, { id: "pr" })
    toast[r.data.done ? "success" : "error"](stackText(r.data, what), { id: "pr" })
    void show(open.number)
  }
  async function act(what: string, body: Record<string, unknown>) {
    if (!open) return
    setBusy(what)
    const r = await api<ActResult>("POST", "/api/forge/act", { session, number: open.number, ...body })
    setBusy(undefined)
    if (!r.ok || !r.data) return void toast.error(r.error ?? `${what} could not be asked for`, { id: "pr" })
    const said = actText(r.data, what)
    if (r.data.ran && r.data.exitCode === 0) toast.success(said, { id: "pr" })
    else toast.error(said, { id: "pr" })
    if (r.data.ran && r.data.exitCode === 0) void show(open.number)
    return r.data.ran && r.data.exitCode === 0
  }
  if (error)
    return (
      <p role="alert" className="m-0 p-2 text-[13px]">
        {error}
      </p>
    )
  if (!list) return <p className="m-0 p-2 text-[13px] text-mut">Reading GitHub...</p>
  if (!list.length) return <p className="m-0 p-2 text-[13px] text-mut">No open pull requests.</p>
  const tasks = thread ? tasksOf(thread.body) : []
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
        <section aria-label={`Pull request ${open.number}`} className="panel grid gap-2 p-2">
          <strong>
            #{open.number} {open.title}
          </strong>
          <span className="text-mut">
            {open.branch} into {open.base}
            {open.review ? `, review: ${open.review.toLowerCase().replace(/_/g, " ")}` : ""}
            {open.mergeable ? `, ${open.mergeable.toLowerCase()}` : ""}
            {thread?.autoMerge ? ", merges by itself once its checks pass" : ""}
          </span>
          {open.url ? <OutLink href={open.url}>Open on GitHub</OutLink> : null}
          {stack.length > 1 ? (
            <div className="flex flex-wrap items-center gap-1" aria-label="Its stack">
              <span className="text-mut">In a stack, bottom first:</span>
              {stack.map((p) => (
                <span key={p.number} className={p.number === open.number ? "mono font-semibold" : "mono"}>
                  #{p.number}
                </span>
              ))}
              <button type="button" className="btn !min-h-7" disabled={busy !== undefined} onClick={() => void stackAct("merge")}>
                Merge stack
              </button>
              <button type="button" className="btn !min-h-7" disabled={busy !== undefined} onClick={() => void stackAct("rebase")}>
                Rebase stack
              </button>
            </div>
          ) : null}
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={watching[open.number] === true} onChange={(e) => void watch(open.number, e.target.checked)} />
            Tell this session when a check fails or the branch conflicts
          </label>
          <ul className="m-0 grid list-none gap-0.5 p-0" aria-label="Checks">
            {open.checks.map((c, i) => (
              <li key={i} className="flex gap-2">
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="shrink-0 text-mut">{c.state.toLowerCase()}</span>
              </li>
            ))}
          </ul>
          {thread ? (
            <>
              {tasks.length ? (
                <fieldset className="m-0 grid gap-0.5 border-0 p-0">
                  <legend className="font-semibold">Tasks in the description</legend>
                  {tasks.map((t, i) => (
                    <label key={i} className="flex items-start gap-2">
                      <input type="checkbox" checked={t.done} disabled={busy !== undefined} onChange={(e) => void act(e.target.checked ? "Ticking the box" : "Unticking the box", { action: "tick", index: i, on: e.target.checked })} />
                      <span>{t.text}</span>
                    </label>
                  ))}
                </fieldset>
              ) : null}
              <details>
                <summary className="cursor-pointer">Description</summary>
                <OthersWords text={thread.body} flagged={thread.flaggedBody} />
              </details>
              {[...thread.reviews.map((r) => ({ ...r, kind: "review" as const })), ...thread.comments.map((c) => ({ ...c, kind: "comment" as const, state: "" }))]
                .sort((a, b) => a.at.localeCompare(b.at))
                .map((c, i) => (
                  <article key={i} className="grid gap-0.5 border-t border-line pt-1">
                    <span className="text-mut">
                      {c.author}
                      {c.kind === "review" && c.state ? `, ${c.state.toLowerCase().replace(/_/g, " ")}` : ""}, {day(c.at)}
                    </span>
                    <OthersWords text={c.body} flagged={c.flagged} />
                  </article>
                ))}
              {thread.reviewRequests.length ? <span className="text-mut">Asked to review: {thread.reviewRequests.join(", ")}</span> : null}
            </>
          ) : (
            <span className="text-mut">Reading the conversation...</span>
          )}
          <div className="grid gap-1 border-t border-line pt-2">
            <span className="text-[12.5px] text-mut">Each change goes to the approval card as a gh command, as Claude&apos;s would, and is recorded.</span>
            <label className="grid gap-1">
              <span>Comment</span>
              <textarea className="field" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
            </label>
            <span className="flex flex-wrap gap-1">
              <button type="button" className="btn !min-h-7" disabled={!comment.trim() || busy !== undefined} onClick={() => void act("Your comment", { action: "comment", text: comment }).then((ok) => ok && setComment(""))}>
                Comment
              </button>
            </span>
            <span className="flex flex-wrap items-end gap-1">
              <label className="grid gap-1">
                <span>Reviewers (GitHub logins)</span>
                <input className="field" value={reviewers} placeholder="alice, org/team" onChange={(e) => setReviewers(e.target.value)} />
              </label>
              <button type="button" className="btn !min-h-7" disabled={!reviewers.trim() || busy !== undefined} onClick={() => void act("Asking for review", { action: "request-reviewers", logins: reviewers }).then((ok) => ok && setReviewers(""))}>
                Ask to review
              </button>
            </span>
            <span className="flex flex-wrap items-center gap-1">
              <button type="button" className="btn !min-h-7" disabled={busy !== undefined} onClick={() => void act("Checking it out", { action: "checkout" })}>
                Check out
              </button>
              <select aria-label="How to merge" className="field !min-h-7" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                <option value="squash">Squash</option>
                <option value="merge">Merge commit</option>
                <option value="rebase">Rebase</option>
              </select>
              <button type="button" className="btn !min-h-7" disabled={busy !== undefined} onClick={() => void act("Merging", { action: "merge", method })}>
                Merge
              </button>
              <button type="button" className="btn !min-h-7" disabled={busy !== undefined} onClick={() => void act(thread?.autoMerge ? "Turning off merge by itself" : "Merging once its checks pass", { action: "auto-merge", on: !thread?.autoMerge, method })}>
                {thread?.autoMerge ? "Do not merge by itself" : "Merge when checks pass"}
              </button>
              <button type="button" className="btn !min-h-7" disabled={busy !== undefined} onClick={() => void act("Reverting", { action: "revert" })}>
                Revert
              </button>
            </span>
            {busy ? <span role="status">{busy}: waiting for the approval card...</span> : null}
          </div>
        </section>
      ) : null}
    </div>
  )
}
