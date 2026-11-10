import { useCallback, useEffect, useState } from "react"
import { Virtuoso } from "react-virtuoso"
import { toast } from "sonner"
import { api } from "../lib/api"
import type { Opened } from "./FilesPanel"

interface HistoryLine {
  graph: string
  hash?: string
  subject?: string
  author?: string
  date?: string
  refs?: string
}
interface Hunk {
  index: number
  header: string
  lines: string[]
}
interface FileHunks {
  path: string
  staged: boolean
  hunks: Hunk[]
}
interface BlameLine {
  line: number
  hash: string
  author: string
  date: string
  summary: string
  text: string
}

type Tab = "history" | "changes" | "conflicts" | "blame"
const TABS: Array<[Tab, string]> = [
  ["history", "History"],
  ["changes", "Stage"],
  ["conflicts", "Conflicts"],
  ["blame", "Blame"],
]

/**
 * The git panel (backlog G36): the session's repository as git sees it. History and Blame only read. Stage puts one
 * shown change into git's index (or takes it out); Conflicts lists files a merge left in conflict, opens each in the
 * editor, and marks one resolved once its markers are gone. Nothing here commits, pushes or merges; each change to the
 * index is recorded.
 */
export function GitPane({ sessionId, onOpen }: { sessionId: string; onOpen: (o: Opened) => void }) {
  const [tab, setTab] = useState<Tab>("history")
  const q = `session=${encodeURIComponent(sessionId)}`
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_1fr] gap-2">
      <div role="tablist" aria-label="Git" className="flex gap-1">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className="pane-tool"
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="min-h-0">
        {tab === "history" ? (
          <History q={q} />
        ) : tab === "changes" ? (
          <Stage q={q} sessionId={sessionId} />
        ) : tab === "conflicts" ? (
          <Conflicts q={q} sessionId={sessionId} onOpen={onOpen} />
        ) : (
          <Blame q={q} />
        )}
      </div>
    </div>
  )
}

function History({ q }: { q: string }) {
  const [lines, setLines] = useState<HistoryLine[]>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    void api<{ lines: HistoryLine[] }>("GET", `/api/git/history?${q}`).then((r) =>
      r.ok && r.data
        ? setLines(r.data.lines)
        : setError(r.error ?? "The history could not be read"),
    )
  }, [q])
  if (error)
    return (
      <p role="alert" className="m-0 text-[13.5px] text-sev">
        {error}
      </p>
    )
  if (!lines) return <p className="m-0 text-mut">Reading the history…</p>
  if (!lines.length) return <p className="m-0 text-mut">No commits yet.</p>
  return (
    <Virtuoso
      style={{ height: "100%", minHeight: 240 }}
      data={lines}
      aria-label="History"
      itemContent={(_, l) => (
        <div className="mono flex gap-2 whitespace-pre text-[12px] leading-[1.6]">
          <span className="text-mut">{l.graph}</span>
          {l.hash ? (
            <>
              <span className="text-acc">{l.hash}</span>
              {l.refs ? <span className="font-semibold">({l.refs})</span> : null}
              <span className="truncate">{l.subject}</span>
              <span className="ml-auto shrink-0 text-mut">
                {l.author}, {l.date}
              </span>
            </>
          ) : null}
        </div>
      )}
    />
  )
}

function Stage({ q, sessionId }: { q: string; sessionId: string }) {
  const [files, setFiles] = useState<FileHunks[]>()
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    const r = await api<{ files: FileHunks[] }>("GET", `/api/git/changes?${q}`)
    setFiles(r.ok && r.data ? r.data.files : [])
    if (!r.ok) toast.error(r.error ?? "The changes could not be read")
  }, [q])
  useEffect(() => void load(), [load])
  async function stage(f: FileHunks, h: Hunk) {
    setBusy(true)
    const r = await api("POST", "/api/git/stage", {
      session: sessionId,
      path: f.path,
      index: h.index,
      ...(f.staged ? { unstage: true } : {}),
    })
    setBusy(false)
    if (!r.ok) toast.error(r.error ?? "It was not staged")
    void load()
  }
  if (!files) return <p className="m-0 text-mut">Reading the changes…</p>
  if (!files.length) return <p className="m-0 text-mut">Nothing changed since the last commit.</p>
  return (
    <ul className="m-0 grid list-none gap-3 overflow-auto p-0" aria-label="Changes to stage">
      {files.map((f) => (
        <li key={`${f.staged}-${f.path}`} className="grid gap-1">
          <strong className="mono text-[12.5px]">
            {f.path}{" "}
            <span className="font-normal text-mut">{f.staged ? "staged" : "not staged"}</span>
          </strong>
          {f.hunks.map((h) => (
            <div key={h.index} className="panel grid gap-1 p-2">
              <span className="flex items-center gap-2">
                <span className="mono text-[12px] text-mut">{h.header}</span>
                <button
                  type="button"
                  className="btn ml-auto !min-h-6 !px-2 !text-[12px]"
                  disabled={busy}
                  aria-label={`${f.staged ? "Unstage" : "Stage"} ${h.header} in ${f.path}`}
                  onClick={() => void stage(f, h)}
                >
                  {f.staged ? "Unstage" : "Stage"}
                </button>
              </span>
              <pre className="mono m-0 overflow-x-auto text-[12px]">
                {h.lines.slice(0, 40).map((l, i) => (
                  <div
                    key={i}
                    className={
                      l.startsWith("+") ? "bg-hi" : l.startsWith("-") ? "text-sev" : undefined
                    }
                  >
                    {l || " "}
                  </div>
                ))}
                {h.lines.length > 40 ? (
                  <div className="text-mut">and {h.lines.length - 40} more lines</div>
                ) : null}
              </pre>
            </div>
          ))}
        </li>
      ))}
    </ul>
  )
}

function Conflicts({
  q,
  sessionId,
  onOpen,
}: {
  q: string
  sessionId: string
  onOpen: (o: Opened) => void
}) {
  const [files, setFiles] = useState<string[]>()
  const load = useCallback(async () => {
    const r = await api<{ files: string[] }>("GET", `/api/git/conflicts?${q}`)
    setFiles(r.ok && r.data ? r.data.files : [])
  }, [q])
  useEffect(() => void load(), [load])
  async function resolve(path: string) {
    const r = await api("POST", "/api/git/resolve", { session: sessionId, path })
    if (!r.ok) return toast.error(r.error ?? "It was not marked resolved")
    toast(`${path} is marked resolved.`)
    void load()
  }
  if (!files) return <p className="m-0 text-mut">Looking for conflicts…</p>
  if (!files.length) return <p className="m-0 text-mut">No merge conflicts.</p>
  return (
    <ul className="m-0 grid list-none gap-2 p-0" aria-label="Files in conflict">
      {files.map((p) => (
        <li key={p} className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="mono">{p}</span>
          <button
            type="button"
            className="btn !min-h-6 !px-2 !text-[12px]"
            aria-label={`Open ${p} to resolve it`}
            onClick={() => onOpen({ kind: "file", rel: p })}
          >
            Open
          </button>
          <button
            type="button"
            className="btn !min-h-6 !px-2 !text-[12px]"
            aria-label={`Mark ${p} resolved`}
            onClick={() => void resolve(p)}
          >
            Mark resolved
          </button>
        </li>
      ))}
    </ul>
  )
}

function Blame({ q }: { q: string }) {
  const [path, setPath] = useState("")
  const [lines, setLines] = useState<BlameLine[]>()
  const [error, setError] = useState<string>()
  async function show(e: React.FormEvent) {
    e.preventDefault()
    setError(undefined)
    const r = await api<{ lines: BlameLine[] }>(
      "GET",
      `/api/git/blame?${q}&path=${encodeURIComponent(path.trim())}`,
    )
    if (r.ok && r.data) setLines(r.data.lines)
    else {
      setLines(undefined)
      setError(r.error ?? "Blame could not be read")
    }
  }
  return (
    <div className="grid gap-2">
      <form className="flex gap-2" onSubmit={(e) => void show(e)}>
        <input
          className="field mono min-w-0 flex-1"
          aria-label="File to blame"
          placeholder="src/app.ts"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        <button className="btn !min-h-7" disabled={!path.trim()}>
          Show
        </button>
      </form>
      {error ? (
        <p role="alert" className="m-0 text-[13.5px] text-sev">
          {error}
        </p>
      ) : null}
      {lines ? (
        <ol
          className="mono m-0 grid list-none gap-0 p-0 text-[12px]"
          aria-label={`Blame of ${path}`}
        >
          {lines.map((l) => (
            <li key={l.line} className="flex gap-2 whitespace-pre">
              <span className="w-[16ch] shrink-0 truncate text-mut">
                {l.hash} {l.author}
              </span>
              <span className="w-[4ch] shrink-0 text-right text-mut">{l.line}</span>
              <span className="truncate">{l.text}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}
