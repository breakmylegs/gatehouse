import clsx from "clsx"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { clock } from "../lib/format"
import { structuredPatch } from "diff"
import { DiffView } from "./CodeViews"

/** One change in a file (as packages/shared/src/node/checkpoint.ts counts them). */
interface Hunk {
  beforeStart: number
  beforeLines: number
  afterStart: number
  afterLines: number
}
import { send, useStore } from "../store"

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

/**
 * What a session changed, file by file, since one of its checkpoints (its first unless you choose another), with
 * the diff of each and Undo. Undo puts a file back as it was then; a checkpoint is saved first, so an undo can
 * itself be undone from an earlier point in this list.
 */
export function ChangesPane({ sessionId }: { sessionId: string; cwd: string }) {
  const seq = useStore((s) => s.transcripts[sessionId]?.seq ?? 0)
  const [data, setData] = useState<Changes>()
  const [ref, setRef] = useState<string>()
  const [error, setError] = useState<string>()
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [confirm, setConfirm] = useState<string[]>()
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const r = await send({ type: "changes", sessionId, ...(ref ? { ref } : {}) })
    if (!r.ok) {
      setError(r.error?.message ?? "The changes could not be read")
      return
    }
    setError(undefined)
    setData(r.data as Changes)
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
                </div>
                {open[f.path] ? (
                  f.binary ? (
                    <DiffText text={f.diff} />
                  ) : (
                    <FileDiff
                      sessionId={sessionId}
                      at={since.ref}
                      file={f}
                      onUndone={() => void load()}
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
          <div>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => setConfirm(files.map((f) => f.path))}
            >
              Undo all of these
            </button>
          </div>
        </>
      )}

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
  at,
  file,
  onUndone,
}: {
  sessionId: string
  at: string
  file: FileChange
  onUndone: () => void
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
          at={at}
          path={file.path}
          before={sides.before}
          after={sides.after}
          onUndone={onUndone}
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
 * Each change in a changed file, with Undo this change (B12). It asks first; the Host puts back only that change,
 * and only if the file is still as shown, after a safety checkpoint, and records it.
 */
function ChangeList({
  sessionId,
  at,
  path,
  before,
  after,
  onUndone,
}: {
  sessionId: string
  at: string
  path: string
  before: string
  after: string
  onUndone: () => void
}) {
  const hunks = changesIn(before, after)
  const [asking, setAsking] = useState<number>()
  const [busy, setBusy] = useState(false)
  if (hunks.length < 2) return null
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
        {hunks.map((h, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2 text-[13px]">
            <span>{changeWords(h)}</span>
            {asking === i ? (
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
                <button type="button" className="btn !min-h-7" onClick={() => setAsking(undefined)}>
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
          </li>
        ))}
      </ol>
    </section>
  )
}

function DiffText({ text }: { text: string }) {
  if (!text)
    return (
      <p className="m-0 border-t border-line px-2.5 py-2 text-[12.5px] text-mut">
        No text to show.
      </p>
    )
  const lines = text.split("\n").filter((l) => !/^(diff --git|index |--- |\+\+\+ )/.test(l))
  return (
    <pre className="m-0 max-h-80 overflow-auto border-t border-line bg-s2 py-1 text-[12px] leading-[1.5]">
      {lines.map((l, i) => (
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
    </pre>
  )
}
