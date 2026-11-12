import clsx from "clsx"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { clock } from "../lib/format"
import { structuredPatch } from "diff"
import { DiffView } from "./CodeViews"
import { MoreLines, shownLines } from "./MoreLines"
import { REVIEW_PROMPT } from "./ReviewCard"
import { composeIn } from "../lib/compose"
import { describeDecision } from "../lib/decision"
import { editsOn, linesOf, originOf } from "../lib/hunkOrigin"
import { commentKey, reviewMessage, type ReviewComment } from "../lib/reviewComments"

/** One change in a file (as packages/shared/src/node/checkpoint.ts counts them). */
interface Hunk {
  beforeStart: number
  beforeLines: number
  afterStart: number
  afterLines: number
}
import { send, useStore } from "../store"

/** D-056: the lockfiles Codehouse reads for an SBOM (as packages/policy/src/lockfiles.ts names them). */
const LOCKFILE =
  /(^|[\\/])(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|cargo\.lock|poetry\.lock|uv\.lock|go\.sum|composer\.lock|packages\.lock\.json|pipfile\.lock|gemfile\.lock)$/i

/** D-028: one hunk's origin, as apps/host/src/provenance-graph.ts gives it. */
interface Origin {
  file: string
  hunk: number
  call?: { seq: number; tool: string; file: string; sources: Array<{ seq: number; tool: string; what: string; injected?: true; outside?: true }> }
}

/** D-004: a mutation run's report, as apps/host/src/mutation.ts gives it. */
interface MutationReport {
  tool: string
  detected?: "stryker-js" | "stryker-net"
  mutants: number
  killed: number
  survived: Array<{ file: string; line: number; original: string; mutated: string }>
  score?: number
  threshold?: number
  passed?: boolean
  aborted?: string
}

/** D-062: one finding of the local analysis, as apps/host/src/sast.ts gives it. */
interface Finding {
  file: string
  line: number
  kind: string
  severity: "Severe" | "High"
  title: string
}

interface Checkpoint {
  ref: string
  createdAt: string
  label: string
}
interface FileChange {
  path: string
  change: "added" | "modified" | "deleted"
  added: number
  removed: number
  binary: boolean
  diff: string
}
interface Changes {
  checkpoints: Checkpoint[]
  since?: Checkpoint
  files?: FileChange[]
  truncated?: boolean
}

const KIND: Record<FileChange["change"], string> = {
  added: "Made",
  modified: "Changed",
  deleted: "Removed",
}

/** Comments on changes, kept while the pane is open, by commentKey. */
type Comments = Record<string, ReviewComment>

/**
 * What a session changed, file by file, since one of its checkpoints (its first unless you choose another), with
 * the diff of each and Undo. Undo puts a file back as it was then; a checkpoint is saved first, so an undo can
 * itself be undone from an earlier point in this list. Each change says which decision allowed the edit that made
 * it, and can take a comment; the comments from every file go to the prompt box together (G13).
 */
export function ChangesPane({ sessionId, cwd }: { sessionId: string; cwd: string }) {
  const seq = useStore((s) => s.transcripts[sessionId]?.seq ?? 0)
  const [data, setData] = useState<Changes>()
  const [ref, setRef] = useState<string>()
  const [error, setError] = useState<string>()
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [confirm, setConfirm] = useState<string[]>()
  const [busy, setBusy] = useState(false)
  const [comments, setComments] = useState<Comments>({})
  const said = Object.values(comments).filter((c) => c.text.trim())

  const [findings, setFindings] = useState<Finding[]>([])
  // D-066 and D-006: changed files nothing tests, and what replaying their captured behaviour found.
  const [untested, setUntested] = useState<string[]>([])
  const [behaviour, setBehaviour] = useState<Record<string, { cases: number; deltas?: string[] }>>({})
  const [capturing, setCapturing] = useState<string>()
  // D-028: where each file's hunks came from, by file.
  const [origins, setOrigins] = useState<Record<string, Origin[]>>({})
  // D-004: the last mutation run's report, and whether one is running.
  const [mutation, setMutation] = useState<MutationReport>()
  const [mutating, setMutating] = useState(false)
  const load = useCallback(async () => {
    const r = await send({ type: "changes", sessionId, ...(ref ? { ref } : {}) })
    if (!r.ok) {
      setError(r.error?.message ?? "The changes could not be read")
      return
    }
    setError(undefined)
    setData(r.data as Changes)
    // D-062: what the local analysis finds on the changed lines. A failure only leaves the list empty.
    const f = await send({ type: "change_findings", sessionId, ...(ref ? { ref } : {}) })
    setFindings(f.ok ? ((f.data as { findings: Finding[] }).findings ?? []) : [])
    setUntested(f.ok ? ((f.data as { untested?: string[] }).untested ?? []) : [])
  }, [sessionId, ref])

  // Read again when Claude finishes something, a second after the transcript settles.
  useEffect(() => {
    const t = setTimeout(() => void load(), seq ? 1000 : 0)
    return () => clearTimeout(t)
  }, [load, seq])

  async function undo(paths: string[]) {
    if (!data?.since) return
    setBusy(true)
    const r = await send({
      type: "undo_files",
      sessionId,
      ref: data.since.ref,
      paths,
      confirm: true,
    })
    setBusy(false)
    setConfirm(undefined)
    if (!r.ok) {
      toast.error(r.error?.message ?? "Nothing was undone", { id: "changes" })
      return
    }
    toast(
      paths.length === 1
        ? `Put back ${paths[0]} as it was at ${clock(data.since.createdAt)}.`
        : `Put back ${paths.length} files as they were at ${clock(data.since.createdAt)}.`,
      { id: "changes" },
    )
    await load()
  }

  if (error)
    return (
      <p role="alert" className="m-0 text-[13.5px]">
        {error}
      </p>
    )
  if (!data) return <p className="m-0 text-mut">Reading the changes…</p>
  if (!data.since)
    return (
      <p className="m-0 text-[13.5px] text-mut">
        No checkpoint yet. Codehouse saves one before Claude&apos;s first edit, and what changed
        since shows here.
      </p>
    )

  const files = data.files ?? []
  const since = data.since
  return (
    <div className="grid content-start gap-3">
      <label className="grid gap-1 text-[13px]">
        <span className="text-mut">Changes since</span>
        <select className="field" value={data.since.ref} onChange={(e) => setRef(e.target.value)}>
          {data.checkpoints.map((c) => (
            <option key={c.ref} value={c.ref}>
              {clock(c.createdAt)}, {c.label}
            </option>
          ))}
        </select>
      </label>

      {files.length === 0 ? (
        <p className="m-0 text-[13.5px] text-mut">Nothing has changed since then.</p>
      ) : (
        <>
          {findings.length ? (
            <section aria-label="Findings" className="panel grid gap-1.5 p-2.5">
              <h3 className="m-0 text-[13.5px] font-semibold">
                {findings.length === 1 ? "1 thing to look at" : `${findings.length} things to look at`} in the changed lines
              </h3>
              <ul className="m-0 grid list-none gap-1 p-0 text-[13px]">
                {findings.map((x) => (
                  <li key={`${x.file}:${x.line}:${x.kind}`} className="grid grid-cols-[auto_1fr] gap-2">
                    <span className={clsx("sign font-semibold", x.severity === "Severe" ? "text-sev" : "text-warn")}>
                      {x.severity}
                    </span>
                    <span className="[overflow-wrap:anywhere]">
                      {x.title}, <span className="mono">{x.file}</span> line {x.line}
                    </span>
                  </li>
                ))}
              </ul>
              {findings.some((x) => x.severity === "Severe") ? (
                <p className="m-0 text-[12.5px] text-mut">A commit of a Severe one waits for you, even in Extreme approval.</p>
              ) : null}
            </section>
          ) : null}
          {untested.length ? (
            <section aria-label="Untested files" className="panel grid gap-1.5 p-2.5 text-[13px]">
              <h3 className="m-0 text-[13.5px] font-semibold">Nothing in the tests names {untested.length === 1 ? "this file" : "these files"}</h3>
              <p className="m-0 text-mut">
                Capture behaviour records what the file did before this change, with generated inputs, in a copy of the project. Compare with now replays them on the file as it is and says what changed.
              </p>
              <ul className="m-0 grid list-none gap-2 p-0">
                {untested.map((p) => (
                  <li key={p} className="grid gap-1">
                    <span className="mono [overflow-wrap:anywhere]">{p}</span>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn !min-h-7"
                        disabled={capturing !== undefined}
                        onClick={async () => {
                          setCapturing(p)
                          const r = await send({ type: "characterise", sessionId, file: p, ref: since.ref })
                          setCapturing(undefined)
                          if (!r.ok) return void toast.error(r.error?.message ?? "It could not be captured")
                          setBehaviour((b) => ({ ...b, [p]: { cases: (r.data as { cases: number }).cases } }))
                        }}
                      >
                        {capturing === p ? "Capturing…" : "Capture behaviour"}
                      </button>
                      {behaviour[p] ? (
                        <button
                          type="button"
                          className="btn !min-h-7"
                          disabled={capturing !== undefined}
                          onClick={async () => {
                            setCapturing(p)
                            const r = await send({ type: "behaviour_diff", sessionId, file: p })
                            setCapturing(undefined)
                            if (!r.ok) return void toast.error(r.error?.message ?? "It could not be replayed")
                            const d = r.data as { cases: number; deltas: Array<{ words: string }> }
                            setBehaviour((b) => ({ ...b, [p]: { cases: d.cases, deltas: d.deltas.map((x) => x.words) } }))
                          }}
                        >
                          Compare with now
                        </button>
                      ) : null}
                    </div>
                    {behaviour[p] ? (
                      <p className="m-0 text-mut">
                        {behaviour[p]!.deltas === undefined
                          ? `${behaviour[p]!.cases} cases captured, and they replay the same.`
                          : behaviour[p]!.deltas!.length === 0
                            ? `All ${behaviour[p]!.cases} cases behave as before.`
                            : `${behaviour[p]!.deltas!.length} of ${behaviour[p]!.cases} cases behave differently:`}
                      </p>
                    ) : null}
                    {behaviour[p]?.deltas?.length ? (
                      <ul className="m-0 grid list-none gap-1 p-0">
                        {behaviour[p]!.deltas!.map((w) => (
                          <li key={w} className="mono [overflow-wrap:anywhere]">
                            {w}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <ul className="m-0 grid list-none gap-1 p-0" aria-label="Changed files">
            {files.map((f) => (
              <li key={f.path} className="panel overflow-hidden">
                <div className="flex items-center gap-2 px-2.5 py-1.5">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-2 border-0 bg-transparent p-0 text-left"
                    aria-expanded={open[f.path] === true}
                    onClick={() => setOpen((o) => ({ ...o, [f.path]: !o[f.path] }))}
                  >
                    <span
                      className={clsx(
                        "sign shrink-0 text-[12px] font-semibold",
                        f.change === "deleted"
                          ? "text-sev"
                          : f.change === "added"
                            ? "text-ok"
                            : "text-mut",
                      )}
                    >
                      {KIND[f.change]}
                    </span>
                    <span className="mono min-w-0 truncate text-[13px]">{f.path}</span>
                    <span className="mono shrink-0 text-[12px] text-mut">
                      {f.binary ? "binary" : `+${f.added} -${f.removed}`}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn !min-h-7 !px-2 !text-[12.5px]"
                    disabled={busy}
                    onClick={() => setConfirm([f.path])}
                  >
                    Undo
                  </button>
                  {/* D-007: lock a test as it now is; a session then changes it only with you. */}
                  {f.change !== "deleted" ? (
                    <button
                      type="button"
                      className="btn !min-h-7 !px-2 !text-[12.5px]"
                      disabled={busy}
                      onClick={() =>
                        void send({ type: "lock_test", sessionId, path: f.path }).then((r) =>
                          r.ok
                            ? toast(`${f.path} is locked: a session changes it only with you`)
                            : toast.error(r.error?.message ?? "It could not be locked"),
                        )
                      }
                    >
                      Lock
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn !min-h-7 !px-2 !text-[12.5px]"
                    onClick={() =>
                      void send({ type: "provenance_graph", sessionId, file: f.path, ref: since.ref }).then((r) =>
                        r.ok
                          ? setOrigins((o) => ({ ...o, [f.path]: (r.data as { hunks: Origin[] }).hunks }))
                          : toast.error(r.error?.message ?? "It could not be traced"),
                      )
                    }
                  >
                    Where it came from
                  </button>
                </div>
                {origins[f.path] ? (
                  <ul aria-label={`Where ${f.path} came from`} className="m-0 grid list-none gap-1.5 border-t border-line p-2.5 text-[12.5px]">
                    {origins[f.path]!.map((h) => (
                      <li key={h.hunk} className="grid gap-0.5">
                        <span>
                          Change {h.hunk + 1}: {h.call ? `made by ${h.call.tool} at record ${h.call.seq}` : "not made by an edit the session recorded"}
                          {h.call?.sources.some((s) => s.injected) ? <strong className="text-sev">, after reading something that held what looks like prompt injection</strong> : null}
                        </span>
                        {h.call?.sources.length ? (
                          <span className="text-mut">
                            Read before it:{" "}
                            {h.call.sources.slice(0, 6).map((s, i) => (
                              <span key={s.seq} className={s.injected ? "font-semibold text-sev" : s.outside ? "text-warn" : ""}>
                                {i ? "; " : ""}
                                <span className="mono">{s.what}</span>
                                {s.injected ? " (held injected text)" : s.outside ? " (not the project's own words)" : ""}
                              </span>
                            ))}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {open[f.path] ? (
                  f.binary ? (
                    <DiffText text={f.diff} />
                  ) : (
                    <FileDiff
                      sessionId={sessionId}
                      cwd={cwd}
                      at={since.ref}
                      file={f}
                      onUndone={() => void load()}
                      comments={comments}
                      setComments={setComments}
                    />
                  )
                ) : null}
              </li>
            ))}
          </ul>
          {data.truncated ? (
            <p className="m-0 text-[12.5px] text-mut">
              Some diffs are cut short because they are long. The files themselves are complete.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {said.length ? (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    composeIn(sessionId, reviewMessage(said))
                    setComments({})
                    toast(
                      `${said.length === 1 ? "Your comment is" : `Your ${said.length} comments are`} in the prompt box. Read and send.`,
                      { id: "changes" },
                    )
                  }}
                >
                  {said.length === 1
                    ? "Put 1 comment in the prompt box"
                    : `Put ${said.length} comments in the prompt box`}
                </button>
                <button type="button" className="btn" onClick={() => setComments({})}>
                  Clear the comments
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="btn"
              onClick={() => {
                composeIn(sessionId, REVIEW_PROMPT)
                toast("A review request is in the prompt box. Send it when ready.", {
                  id: "changes",
                })
              }}
            >
              Ask for a review
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => setConfirm(files.map((f) => f.path))}
            >
              Undo all of these
            </button>
            <button
              type="button"
              className="btn"
              disabled={mutating}
              onClick={async () => {
                setMutating(true)
                const r = await send({ type: "mutation_run", sessionId, ref: since.ref })
                setMutating(false)
                if (!r.ok) return void toast.error(r.error?.message ?? "The tests could not be tested")
                setMutation(r.data as MutationReport)
              }}
            >
              {mutating ? "Testing the tests…" : "Test the tests"}
            </button>
            {files.some((f) => LOCKFILE.test(f.path)) ? (
              <button
                type="button"
                className="btn"
                onClick={() =>
                  void send({ type: "change_sbom", sessionId, ref: since.ref }).then((r) => {
                    if (!r.ok) return void toast.error(r.error?.message ?? "The SBOM could not be made")
                    const blob = new Blob([JSON.stringify((r.data as { bom: unknown }).bom, null, 2)], {
                      type: "application/vnd.cyclonedx+json",
                    })
                    const a = document.createElement("a")
                    a.href = URL.createObjectURL(blob)
                    a.download = "dependency-changes.cdx.json"
                    a.click()
                    setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
                  })
                }
              >
                Download the SBOM of these changes
              </button>
            ) : null}
          </div>
        </>
      )}

      {mutation ? (
        <section aria-label="Mutation run" className="panel grid gap-1.5 p-2.5 text-[13px]">
          <h3 className="m-0 text-[13.5px] font-semibold">
            {mutation.aborted
              ? `Stopped: ${mutation.aborted}.`
              : mutation.mutants === 0
                ? "Nothing to mutate in the changed lines."
                : `${mutation.killed} of ${mutation.mutants} small changes to the new lines were caught by the tests (${mutation.score}%)${mutation.threshold !== undefined ? (mutation.passed ? `, at or above this project's ${mutation.threshold}%` : `, below this project's ${mutation.threshold}%`) : ""}.`}
          </h3>
          {mutation.detected ? (
            <p className="m-0 text-mut">This project has {mutation.detected === "stryker-js" ? "StrykerJS" : "Stryker.NET"}; this run used Codehouse's own mutator on the changed lines only.</p>
          ) : null}
          {mutation.survived.length ? (
            <ul className="m-0 grid list-none gap-1.5 p-0">
              {mutation.survived.map((s) => (
                <li key={`${s.file}:${s.line}:${s.mutated}`} className="grid gap-1">
                  <span>
                    Not caught: <span className="mono">{s.file}</span> line {s.line}, <span className="mono">{s.original}</span> to <span className="mono">{s.mutated}</span>
                  </span>
                  <button
                    type="button"
                    className="btn justify-self-start !min-h-7"
                    onClick={async () => {
                      const r = await send({ type: "mutant_task", sessionId, survivor: s })
                      if (!r.ok) return void toast.error(r.error?.message ?? "The task could not be started")
                      toast("Claude is writing a test for it. Only test files may change without asking you.", { id: "changes" })
                    }}
                  >
                    Write a test that catches it
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      {confirm ? (
        <div role="group" aria-label="Confirm undo" className="panel grid gap-2 p-3">
          <p className="m-0 text-[13.5px]">
            Put{" "}
            {confirm.length === 1 ? (
              <span className="mono">{confirm[0]}</span>
            ) : (
              `${confirm.length} files`
            )}{" "}
            back as {confirm.length === 1 ? "it was" : "they were"} at {clock(data.since.createdAt)}
            ? Codehouse saves a checkpoint first, so you can go back to now.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void undo(confirm)}
            >
              {confirm.length === 1 ? "Undo this file" : "Undo them all"}
            </button>
            <button type="button" className="btn" onClick={() => setConfirm(undefined)} autoFocus>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * A changed file before and after in the diff view (B11), read from the checkpoint and from disk. The plain diff stays
 * when the two sides cannot be read (a very large file).
 */
function FileDiff({
  sessionId,
  cwd,
  at,
  file,
  onUndone,
  comments,
  setComments,
}: {
  sessionId: string
  cwd: string
  at: string
  file: FileChange
  onUndone: () => void
  comments: Comments
  setComments: (f: (c: Comments) => Comments) => void
}) {
  const [sides, setSides] = useState<{ before?: string; after?: string }>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let gone = false
    void send({ type: "change_versions", sessionId, ref: at, path: file.path }).then((r) => {
      if (gone) return
      if (r.ok && r.data) setSides(r.data as { before?: string; after?: string })
      else setFailed(true)
    })
    return () => {
      gone = true
    }
  }, [sessionId, at, file.path, file.diff])
  if (failed) return <DiffText text={file.diff} />
  if (!sides)
    return (
      <p className="m-0 border-t border-line px-2.5 py-2 text-[12.5px] text-mut">Reading it…</p>
    )
  return (
    <div className="border-t border-line p-2">
      <DiffView path={file.path} before={sides.before ?? ""} after={sides.after ?? ""} />
      {file.change === "modified" && sides.before !== undefined && sides.after !== undefined ? (
        <ChangeList
          sessionId={sessionId}
          cwd={cwd}
          at={at}
          path={file.path}
          before={sides.before}
          after={sides.after}
          onUndone={onUndone}
          comments={comments}
          setComments={setComments}
        />
      ) : null}
    </div>
  )
}

/** One change, in words: where it is in the file as it is now, and what kind. */
export function changeWords(h: Hunk): string {
  const lines = (n: number) => (n === 1 ? "1 line" : `${n} lines`)
  const at = (start: number, n: number) =>
    n === 1 ? `line ${start}` : `lines ${start} to ${start + n - 1}`
  if (h.beforeLines === 0)
    return `Added ${lines(h.afterLines)} at ${at(h.afterStart, h.afterLines)}`
  if (h.afterLines === 0) return `Removed ${lines(h.beforeLines)} before line ${h.afterStart}`
  return `Changed ${at(h.afterStart, h.afterLines)} (was ${lines(h.beforeLines)})`
}

/** The changes in a file, the same way the Host counts them (diff, no context lines). */
export function changesIn(before: string, after: string): Hunk[] {
  return structuredPatch("a", "b", before, after, "", "", { context: 0 }).hunks.map((h) => ({
    beforeStart: h.oldStart,
    beforeLines: h.oldLines,
    afterStart: h.newStart,
    afterLines: h.newLines,
  }))
}

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * Each change in a changed file: which decision allowed the edit that made it, a comment, and (when the file has more
 * than one) Undo this change (B12). Undo asks first; the Host puts back only that change, and only if the file is
 * still as shown, after a safety checkpoint, and records it.
 */
function ChangeList({
  sessionId,
  cwd,
  at,
  path,
  before,
  after,
  onUndone,
  comments,
  setComments,
}: {
  sessionId: string
  cwd: string
  at: string
  path: string
  before: string
  after: string
  onUndone: () => void
  comments: Comments
  setComments: (f: (c: Comments) => Comments) => void
}) {
  const hunks = changesIn(before, after)
  const [asking, setAsking] = useState<number>()
  const [writing, setWriting] = useState<number>()
  const [busy, setBusy] = useState(false)
  const items = useStore((s) => s.transcripts[sessionId]?.items)
  const decisions = useStore((s) => s.decisions)
  const edits = editsOn(items ?? [], path, cwd)
  const whose = (h: Hunk) => {
    const origin = originOf(
      edits,
      linesOf(after, h.afterStart, h.afterLines),
      linesOf(before, h.beforeStart, h.beforeLines),
    )
    if (!origin) return "Not from an edit Claude made in this session: a command, or you."
    const d = decisions[origin.toolUseId]
    return d ? `${origin.name}: ${describeDecision(d).line}` : `Made by Claude's ${origin.name}.`
  }
  const quoteOf = (h: Hunk) =>
    h.afterLines
      ? linesOf(after, h.afterStart, h.afterLines)
      : linesOf(before, h.beforeStart, h.beforeLines)
  const setText = (h: Hunk, text: string) =>
    setComments((c) => ({
      ...c,
      [commentKey(path, h.afterStart)]: { path, where: changeWords(h), quote: quoteOf(h), text },
    }))
  if (!hunks.length) return null
  const undo = async (i: number) => {
    setBusy(true)
    const r = await send({
      type: "undo_change",
      sessionId,
      ref: at,
      path,
      hunk: i,
      afterHash: await sha256(after),
      confirm: true,
    })
    setBusy(false)
    setAsking(undefined)
    if (!r.ok) {
      toast.error(r.error?.message ?? "Nothing was undone", { id: "changes" })
      return
    }
    toast(`Put back one change in ${path}.`, { id: "changes" })
    onUndone()
  }
  return (
    <section aria-label={`Changes in ${path}`} className="mt-2 grid gap-1">
      <ol className="m-0 grid list-none gap-1 p-0">
        {hunks.map((h, i) => {
          const comment = comments[commentKey(path, h.afterStart)]?.text ?? ""
          return (
            <li key={i} className="grid gap-1 text-[13px]">
              <span className="flex flex-wrap items-center gap-2">
                <span>{changeWords(h)}</span>
                {writing !== i ? (
                  <button
                    type="button"
                    className="btn !min-h-7 !px-2 !text-[12.5px]"
                    aria-label={`${comment ? "Change the comment on" : "Comment on"}: ${changeWords(h)}`}
                    onClick={() => setWriting(i)}
                  >
                    {comment ? "Comment (1)" : "Comment"}
                  </button>
                ) : null}
                {hunks.length < 2 ? null : asking === i ? (
                  <span
                    role="group"
                    aria-label="Confirm undoing this change"
                    className="flex items-center gap-2"
                  >
                    <span className="text-mut">
                      Put it back as it was? A checkpoint is saved first.
                    </span>
                    <button
                      type="button"
                      className="btn btn-primary !min-h-7"
                      disabled={busy}
                      onClick={() => void undo(i)}
                    >
                      Undo this change
                    </button>
                    <button
                      type="button"
                      className="btn !min-h-7"
                      onClick={() => setAsking(undefined)}
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn !min-h-7 !px-2 !text-[12.5px]"
                    aria-label={`Undo: ${changeWords(h)}`}
                    onClick={() => setAsking(i)}
                  >
                    Undo…
                  </button>
                )}
              </span>
              <span className="text-[12.5px] text-mut">{whose(h)}</span>
              {writing === i ? (
                <span className="grid gap-1">
                  <textarea
                    className="field min-h-14 text-[13px]"
                    aria-label={`Your comment on: ${changeWords(h)}`}
                    value={comment}
                    autoFocus
                    onChange={(e) => setText(h, e.target.value)}
                  />
                  <span>
                    <button
                      type="button"
                      className="btn !min-h-7"
                      onClick={() => setWriting(undefined)}
                    >
                      Done
                    </button>
                  </span>
                </span>
              ) : comment ? (
                <span className="text-[12.5px]">Your comment: {comment}</span>
              ) : null}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function DiffText({ text }: { text: string }) {
  const [all, setAll] = useState(false)
  if (!text)
    return (
      <p className="m-0 border-t border-line px-2.5 py-2 text-[12.5px] text-mut">
        No text to show.
      </p>
    )
  const lines = text.split("\n").filter((l) => !/^(diff --git|index |--- |\+\+\+ )/.test(l))
  return (
    <pre className="m-0 max-h-80 overflow-auto border-t border-line bg-s2 py-1 text-[12px] leading-[1.5]">
      {shownLines(lines, all).map((l, i) => (
        <div
          key={i}
          className={clsx(
            "mono whitespace-pre-wrap px-2.5 [overflow-wrap:anywhere]",
            l.startsWith("+") && "bg-hi",
            l.startsWith("-") && "text-sev",
            l.startsWith("@@") && "text-mut",
          )}
        >
          {l || " "}
        </div>
      ))}
      <MoreLines total={lines.length} all={all} onShow={() => setAll(true)} />
    </pre>
  )
}
