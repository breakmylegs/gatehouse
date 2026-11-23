import { useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

interface Result {
  decisions: Array<{ text: string; source: { line: number } }>
  actions: Array<{ text: string; owner?: string; source: { line: number } }>
  stories: Array<{ title: string; criteria: unknown[]; source: { line: number } }>
  files: Array<{ file: string; exists: boolean }>
  written?: string[]
  skipped?: string[]
}

/** E-082: a meeting transcript's decisions, actions and stories, each with its line, into the backlog. */
export function MeetingNotesPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [file, setFile] = useState("")
  const [r, setR] = useState<Result>()
  const [busy, setBusy] = useState(false)
  async function run(write: boolean) {
    if (!file.trim()) return
    setBusy(true)
    const x = await send({ type: "meeting_notes", sessionId, file: file.trim(), ...(write ? { write: true } : {}) })
    setBusy(false)
    if (!x.ok) return void toast.error(x.error?.message ?? "Not read", { id: "meeting" })
    const d = x.data as Result
    setR(d)
    if (write) toast(`${d.written?.length ?? 0} file(s) written${d.skipped?.length ? `, ${d.skipped.length} already there and left as they were` : ""}`, { id: "meeting" })
  }
  return (
    <section aria-label="Meeting notes to backlog" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Meeting notes to backlog</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid flex-1 gap-1">
          <span className="text-xs text-mut">Transcript in the project (.txt, .vtt, .srt or .md)</span>
          <input className="field" value={file} placeholder="docs/meetings/standup.vtt" onChange={(e) => setFile(e.target.value)} />
        </label>
        <button type="button" className="btn btn-primary !min-h-7" disabled={busy || !file.trim()} onClick={() => void run(false)}>
          {busy ? "Reading…" : "Read"}
        </button>
        <button type="button" className="btn !min-h-7" disabled={busy || !r} onClick={() => void run(true)}>
          Add to the backlog
        </button>
      </div>
      {r ? (
        <div className="grid gap-1">
          <strong>Stories, as draft requirements ({r.stories.length})</strong>
          {r.stories.map((s) => (
            <span key={s.source.line}>
              Line {s.source.line}: {s.title} ({s.criteria.length} criteria)
            </span>
          ))}
          <strong>Decisions ({r.decisions.length})</strong>
          {r.decisions.map((d) => (
            <span key={d.source.line}>
              Line {d.source.line}: {d.text}
            </span>
          ))}
          <strong>Actions ({r.actions.length})</strong>
          {r.actions.map((a) => (
            <span key={a.source.line}>
              Line {a.source.line}: {a.owner ? `${a.owner}: ` : ""}
              {a.text}
            </span>
          ))}
          <span className="text-mut">
            Files: {r.files.map((f) => `${f.file}${f.exists ? " (already there, left as it is)" : ""}`).join(", ")}
          </span>
        </div>
      ) : null}
    </section>
  )
}
