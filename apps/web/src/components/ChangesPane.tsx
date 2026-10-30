import clsx from "clsx"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { clock } from "../lib/format"
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
        No checkpoint yet. JCVC saves one before Claude&apos;s first edit, and what changed since
        shows here.
      </p>
    )

  const files = data.files ?? []
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
                {open[f.path] ? <DiffText text={f.diff} /> : null}
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
            ? JCVC saves a checkpoint first, so you can go back to now.
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
