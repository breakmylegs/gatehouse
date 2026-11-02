import clsx from "clsx"
import { useCallback, useEffect, useMemo, useState } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { toast } from "sonner"
import { api } from "../lib/api"
import type { Item } from "../lib/transcript"

export type Opened = { kind: "file"; rel: string } | { kind: "browser"; url: string }

interface Entry {
  name: string
  rel: string
  kind: "dir" | "file"
  size: number
  mtime: string
}

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"])
const IMAGE = /\.(png|jpe?g|gif|webp|svg|ico)$/i
const HTML = /\.html?$/i
const MARKDOWN = /\.(md|markdown)$/i

const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "")

/** A path from the transcript, relative to the session folder, or undefined when it is outside it. */
export function relativeTo(cwd: string, p: string): string | undefined {
  const a = norm(p)
  const b = norm(cwd)
  if (!/^[a-zA-Z]:\//.test(a) && !a.startsWith("/")) return a.replace(/^\.\//, "")
  if (a.toLowerCase() === b.toLowerCase()) return ""
  return a.toLowerCase().startsWith(b.toLowerCase() + "/") ? a.slice(b.length + 1) : undefined
}

/** The files Claude made or changed in this session, newest last, from the transcript. */
export function changedFiles(items: Item[], cwd: string): Array<{ rel: string; tool: string }> {
  const seen = new Map<string, string>()
  for (const it of items) {
    if (it.kind !== "tool" || !EDIT_TOOLS.has(it.name)) continue
    const p = it.input.file_path ?? it.input.notebook_path
    if (typeof p !== "string") continue
    const rel = relativeTo(cwd, p)
    if (rel === undefined || rel === "") continue
    seen.delete(rel)
    seen.set(rel, it.name)
  }
  return [...seen].map(([rel, tool]) => ({ rel, tool }))
}

function size(n: number): string {
  return n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`
}

function Folder({
  sessionId,
  dir,
  onOpen,
  depth,
}: {
  sessionId: string
  dir: string
  onOpen: (rel: string) => void
  depth: number
}) {
  const [entries, setEntries] = useState<Entry[]>()
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string>()
  useEffect(() => {
    let gone = false
    void api<{ entries: Entry[]; more: number }>(
      "GET",
      `/api/files/list?session=${encodeURIComponent(sessionId)}&dir=${encodeURIComponent(dir)}`,
    ).then((r) => {
      if (gone) return
      if (r.ok && r.data) setEntries(r.data.entries)
      else setError(r.error ?? "This folder cannot be read")
    })
    return () => {
      gone = true
    }
  }, [sessionId, dir])
  if (error) return <p className="m-0 py-1 text-[13px] text-sev">{error}</p>
  if (!entries) return <p className="m-0 py-1 text-[13px] text-mut">Loading…</p>
  if (entries.length === 0) return <p className="m-0 py-1 text-[13px] text-mut">Empty</p>
  return (
    <ul
      className="m-0 list-none p-0"
      role={depth === 0 ? "tree" : "group"}
      aria-label={depth === 0 ? "Folder" : undefined}
    >
      {entries.map((e) => (
        <li
          key={e.rel}
          role="treeitem"
          aria-expanded={e.kind === "dir" ? Boolean(open[e.rel]) : undefined}
        >
          <button
            type="button"
            className="flex w-full items-center gap-1.5 rounded border-0 bg-transparent py-0.5 text-left text-[13px] hover:bg-s2"
            style={{ paddingLeft: depth * 12 + 4 }}
            onClick={() =>
              e.kind === "dir" ? setOpen((o) => ({ ...o, [e.rel]: !o[e.rel] })) : onOpen(e.rel)
            }
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              aria-hidden="true"
              className="shrink-0 text-mut"
            >
              {e.kind === "dir" ? (
                <path d={open[e.rel] ? "M2 4h8L6 9z" : "M4 2v8l5-4z"} fill="currentColor" />
              ) : (
                <path d="M3 1.5h4l2 2v7H3z" fill="none" stroke="currentColor" strokeWidth="1.1" />
              )}
            </svg>
            <span className="truncate">{e.name}</span>
            {e.kind === "file" ? (
              <span className="ml-auto shrink-0 pr-1 text-[11px] text-mut">{size(e.size)}</span>
            ) : null}
          </button>
          {e.kind === "dir" && open[e.rel] ? (
            <Folder sessionId={sessionId} dir={e.rel} onOpen={onOpen} depth={depth + 1} />
          ) : null}
        </li>
      ))}
    </ul>
  )
}

/** The Files tab: what this session made or changed, the whole folder, and a page from a local dev server. */
export function FilesPanel({
  sessionId,
  cwd,
  items,
  onOpen,
}: {
  sessionId: string
  cwd: string
  items: Item[]
  onOpen: (o: Opened) => void
}) {
  const changed = useMemo(() => changedFiles(items, cwd), [items, cwd])
  return (
    <div className="grid gap-4">
      <section aria-label="Made or changed">
        <h2 className="m-0 mb-1.5 text-[15px]">Made or changed</h2>
        {changed.length === 0 ? (
          <p className="m-0 text-[13px] text-mut">
            Nothing yet. Files Claude writes or edits appear here.
          </p>
        ) : (
          <ul className="m-0 grid list-none gap-0.5 p-0">
            {[...changed].reverse().map((f) => (
              <li key={f.rel}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded border-0 bg-transparent px-1 py-0.5 text-left text-[13px] hover:bg-s2"
                  onClick={() => onOpen({ kind: "file", rel: f.rel })}
                >
                  <span className="mono truncate">{f.rel}</span>
                  <span className="sign ml-auto shrink-0 text-[11.5px] text-mut">
                    {f.tool === "Write" ? "Made" : "Changed"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="The session folder">
        <h2 className="m-0 mb-1.5 text-[15px]">Folder</h2>
        <Folder
          sessionId={sessionId}
          dir=""
          depth={0}
          onOpen={(rel) => onOpen({ kind: "file", rel })}
        />
      </section>
      <section aria-label="Local page">
        <button
          type="button"
          className="btn w-full justify-center"
          onClick={() => onOpen({ kind: "browser", url: "http://localhost:5173/" })}
        >
          Open a local page
        </button>
        <p className="m-0 mt-1 text-xs text-mut">For a dev server running on this computer.</p>
      </section>
    </div>
  )
}

type Read =
  | { kind: "text"; text: string; size: number; truncated: boolean }
  | { kind: "binary"; size: number }
  | { kind: "blocked"; reason: string; size: number }

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?(\/|$)/i

/** The viewer pane: a file shown the right way for its type, or a local page in a small browser. */
export function Viewer({
  sessionId,
  opened,
  onClose,
  onNavigate,
}: {
  sessionId: string
  opened: Opened
  onClose: () => void
  onNavigate: (o: Opened) => void
}) {
  const [read, setRead] = useState<Read>()
  const [error, setError] = useState<string>()
  const [base, setBase] = useState<string>()
  const [source, setSource] = useState(false)
  const [address, setAddress] = useState(opened.kind === "browser" ? opened.url : "")
  const [frameKey, setFrameKey] = useState(0)

  const rel = opened.kind === "file" ? opened.rel : ""
  const loadBase = useCallback(async () => {
    const r = await api<{ base: string }>("POST", "/api/files/preview", { session: sessionId })
    if (r.ok && r.data) setBase(r.data.base)
  }, [sessionId])

  useEffect(() => {
    setRead(undefined)
    setError(undefined)
    setSource(false)
    if (opened.kind !== "file") return
    void loadBase()
    if (IMAGE.test(rel)) return
    void api<Read>(
      "GET",
      `/api/files/read?session=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(rel)}`,
    ).then((r) => {
      if (r.ok && r.data) setRead(r.data)
      else setError(r.error ?? "This file cannot be opened")
    })
  }, [opened, rel, sessionId, loadBase])

  async function reveal() {
    const r = await api("POST", "/api/files/reveal", { session: sessionId, path: rel })
    if (!r.ok) toast.error(r.error ?? "Explorer could not open")
  }

  const previewUrl = base ? `${base}${rel.split("/").map(encodeURIComponent).join("/")}` : undefined

  return (
    <section
      aria-label="Viewer"
      className="grid min-h-0 grid-rows-[auto_1fr] border-l border-line bg-s1"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        {opened.kind === "file" ? (
          <>
            <span className="mono min-w-0 flex-1 truncate text-[13px]">{rel}</span>
            {HTML.test(rel) ? (
              <button
                type="button"
                className="btn !min-h-7 !px-2 text-[13px]"
                aria-pressed={source}
                onClick={() => setSource((v) => !v)}
              >
                {source ? "Show the page" : "Show the source"}
              </button>
            ) : null}
            <button
              type="button"
              className="btn !min-h-7 !px-2 text-[13px]"
              onClick={() => void reveal()}
            >
              Show in Explorer
            </button>
          </>
        ) : (
          <form
            className="flex min-w-0 flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (!LOCAL.test(address.trim())) {
                setError("Only pages on this computer can open here (localhost or 127.0.0.1).")
                return
              }
              setError(undefined)
              onNavigate({ kind: "browser", url: address.trim() })
              setFrameKey((k) => k + 1)
            }}
          >
            <label className="sr-only" htmlFor="viewer-address">
              Address
            </label>
            <input
              id="viewer-address"
              className="field mono min-w-0 flex-1 !min-h-7 text-[13px]"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
            <button className="btn !min-h-7 !px-2 text-[13px]">Go</button>
            <button
              type="button"
              className="btn !min-h-7 !px-2 text-[13px]"
              onClick={() => setFrameKey((k) => k + 1)}
            >
              Reload
            </button>
          </form>
        )}
        <button type="button" className="btn !min-h-7 !px-2 text-[13px]" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="min-h-0 overflow-auto">
        {error ? (
          <p role="alert" className="m-0 p-4 font-semibold text-sev">
            {error}
          </p>
        ) : opened.kind === "browser" ? (
          LOCAL.test(opened.url) ? (
            <iframe
              key={frameKey}
              title="Local page"
              src={opened.url}
              sandbox="allow-scripts allow-same-origin allow-forms"
              className="h-full min-h-[480px] w-full border-0 bg-white"
            />
          ) : null
        ) : IMAGE.test(rel) ? (
          previewUrl ? (
            <div className="grid place-items-center p-4">
              <img src={previewUrl} alt={rel} className="max-h-[80vh] max-w-full" />
            </div>
          ) : null
        ) : !read ? (
          <p className="m-0 p-4 text-mut">Loading…</p>
        ) : read.kind === "blocked" ? (
          <p className="m-0 p-4">
            <strong>Not shown.</strong> {read.reason}
          </p>
        ) : read.kind === "binary" ? (
          <p className="m-0 p-4 text-mut">
            This file is not text ({size(read.size)}). Use Show in Explorer to open it.
          </p>
        ) : HTML.test(rel) && !source && previewUrl ? (
          <iframe
            title={`Page ${rel}`}
            src={previewUrl}
            sandbox="allow-scripts"
            className="h-full min-h-[480px] w-full border-0 bg-white"
          />
        ) : MARKDOWN.test(rel) && !source ? (
          <div className="help-body px-5 py-4">
            <Markdown remarkPlugins={[remarkGfm]}>{read.text}</Markdown>
          </div>
        ) : (
          <pre className="m-0 grid grid-cols-[auto_1fr] text-[13px] leading-[1.55]">
            <code
              aria-hidden="true"
              className="mono select-none border-r border-line bg-s2 px-2 py-2 text-right text-mut"
            >
              {read.text.split("\n").map((_, i) => (
                <span key={i} className="block">
                  {i + 1}
                </span>
              ))}
            </code>
            <code className={clsx("mono overflow-x-auto px-3 py-2 whitespace-pre")}>
              {read.text}
            </code>
          </pre>
        )}
        {read?.kind === "text" && read.truncated ? (
          <p className="m-0 px-4 pb-3 text-xs text-mut">Only the first 1 MB is shown.</p>
        ) : null}
      </div>
    </section>
  )
}
