import { useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"
import type { Opened } from "./FilesPanel"

interface Match {
  path: string
  line: number
  text: string
}

interface FilePreview {
  path: string
  hash: string
  lines: Array<{ line: number; before: string; after: string }>
  count: number
}

interface Preview {
  files: FilePreview[]
  skipped: Array<{ path: string; why: string }>
}

/** Matches grouped by file, in the order they came. */
export function byFile(matches: readonly Match[]): Array<{ path: string; matches: Match[] }> {
  const out: Array<{ path: string; matches: Match[] }> = []
  for (const m of matches) {
    const last = out.at(-1)
    if (last?.path === m.path) last.matches.push(m)
    else out.push({ path: m.path, matches: [m] })
  }
  return out
}

/**
 * Search the session's files, and replace across them (backlog G35). Each result opens its file in the viewer.
 * Replace first shows every line it would change, file by file; Replace in these files then changes only files still
 * as shown, after a checkpoint, so Undo in Changes puts them back. Secrets files are left alone.
 */
export function SearchPane({
  sessionId,
  onOpen,
}: {
  sessionId: string
  onOpen: (o: Opened) => void
}) {
  const [q, setQ] = useState("")
  const [regex, setRegex] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [matches, setMatches] = useState<{ list: Match[]; truncated: boolean }>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [replacement, setReplacement] = useState("")
  const [preview, setPreview] = useState<Preview>()
  const options = { session: sessionId, pattern: q, regex, caseSensitive }

  async function search(e?: React.FormEvent) {
    e?.preventDefault()
    if (!q.trim()) return
    setBusy(true)
    setError(undefined)
    setPreview(undefined)
    const p = new URLSearchParams({
      session: sessionId,
      q,
      ...(regex ? { regex: "1" } : {}),
      ...(caseSensitive ? { case: "1" } : {}),
    })
    const r = await api<{ matches: Match[]; truncated: boolean }>("GET", `/api/files/search?${p}`)
    setBusy(false)
    if (!r.ok || !r.data) {
      setMatches(undefined)
      setError(r.error ?? "The search did not run")
      return
    }
    setMatches({ list: r.data.matches, truncated: r.data.truncated })
  }

  async function showReplace() {
    if (!matches?.list.length) return
    setBusy(true)
    const r = await api<Preview>("POST", "/api/files/replace/preview", {
      ...options,
      replacement,
      paths: [...new Set(matches.list.map((m) => m.path))],
    })
    setBusy(false)
    if (!r.ok || !r.data) return setError(r.error ?? "What would change could not be worked out")
    setPreview(r.data)
  }

  async function replace() {
    if (!preview?.files.length) return
    setBusy(true)
    const r = await api<{
      changed: string[]
      skipped: Array<{ path: string; why: string }>
      count: number
    }>("POST", "/api/files/replace", {
      ...options,
      replacement,
      files: preview.files.map((f) => ({ path: f.path, hash: f.hash })),
    })
    setBusy(false)
    if (!r.ok || !r.data) return setError(r.error ?? "Nothing was replaced")
    const { changed, skipped, count } = r.data
    toast(
      `Replaced ${count === 1 ? "1 match" : `${count} matches`} in ${changed.length === 1 ? "1 file" : `${changed.length} files`}${
        skipped.length ? `; ${skipped.length} left as they were` : ""
      }. Undo in Changes puts them back.`,
    )
    setPreview(undefined)
    void search()
  }

  const groups = matches ? byFile(matches.list) : []
  return (
    <div className="grid content-start gap-3">
      <form className="grid gap-2" onSubmit={(e) => void search(e)} aria-label="Search the files">
        <input
          className="field"
          aria-label="Search for"
          placeholder="Search the files"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="flex flex-wrap items-center gap-3 text-[13px]">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} />
            Regular expression
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(e) => setCaseSensitive(e.target.checked)}
            />
            Match case
          </label>
          <button className="btn !min-h-7 ml-auto" disabled={busy || !q.trim()}>
            Search
          </button>
        </span>
      </form>
      {error ? (
        <p role="alert" className="m-0 text-[13.5px] text-sev">
          {error}
        </p>
      ) : null}
      {matches ? (
        <p className="m-0 text-[13px] text-mut" role="status">
          {matches.list.length === 0
            ? "Nothing found."
            : `${matches.list.length === 1 ? "1 match" : `${matches.list.length} matches`} in ${groups.length === 1 ? "1 file" : `${groups.length} files`}${matches.truncated ? ", and more not shown" : ""}.`}
        </p>
      ) : null}
      {matches?.list.length ? (
        <div className="grid gap-2">
          {replacing ? (
            <div className="grid gap-2">
              <input
                className="field"
                aria-label="Replace with"
                placeholder="Replace with"
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
              />
              <span className="flex gap-2">
                <button
                  type="button"
                  className="btn !min-h-7"
                  disabled={busy}
                  onClick={() => void showReplace()}
                >
                  Show what would change
                </button>
                <button
                  type="button"
                  className="btn !min-h-7"
                  onClick={() => {
                    setReplacing(false)
                    setPreview(undefined)
                  }}
                >
                  Cancel
                </button>
              </span>
            </div>
          ) : (
            <span>
              <button type="button" className="btn !min-h-7" onClick={() => setReplacing(true)}>
                Replace…
              </button>
            </span>
          )}
        </div>
      ) : null}
      {preview ? (
        <section aria-label="What would change" className="panel grid gap-2 p-2">
          {preview.files.map((f) => (
            <div key={f.path} className="grid gap-0.5">
              <strong className="mono text-[12.5px]">{f.path}</strong>
              {f.lines.slice(0, 50).map((l) => (
                <span key={l.line} className="mono grid text-[12px]">
                  <span className="text-sev">
                    -{l.line}: {l.before}
                  </span>
                  <span className="bg-hi">
                    +{l.line}: {l.after}
                  </span>
                </span>
              ))}
            </div>
          ))}
          {preview.skipped.map((s) => (
            <span key={s.path} className="text-[12.5px] text-mut">
              <span className="mono">{s.path}</span> is left alone: {s.why}
            </span>
          ))}
          {preview.files.length ? (
            <span>
              <button
                type="button"
                className="btn btn-primary !min-h-7"
                disabled={busy}
                onClick={() => void replace()}
              >
                Replace in{" "}
                {preview.files.length === 1 ? "this file" : `these ${preview.files.length} files`}
              </button>
            </span>
          ) : (
            <span className="text-[13px] text-mut">Nothing would change.</span>
          )}
        </section>
      ) : null}
      <ul className="m-0 grid list-none gap-2 p-0" aria-label="Search results">
        {groups.map((g) => (
          <li key={g.path} className="grid gap-0.5">
            <strong className="mono text-[12.5px]">{g.path}</strong>
            {g.matches.map((m) => (
              <button
                key={`${m.path}:${m.line}`}
                type="button"
                className="mono cursor-pointer truncate border-0 bg-transparent p-0 text-left text-[12px] hover:underline"
                aria-label={`Open ${m.path} at line ${m.line}`}
                onClick={() => onOpen({ kind: "file", rel: m.path })}
              >
                <span className="text-mut">{m.line}: </span>
                {m.text}
              </button>
            ))}
          </li>
        ))}
      </ul>
    </div>
  )
}
