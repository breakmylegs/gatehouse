import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { send, useSessionList } from "../store"

/**
 * D-073: what your undos and denials in a project suggest for its CLAUDE.md. Each proposal shows the records it rests
 * on; adding one writes the line Codehouse made from them (never text from this page), recorded and pinned (D-059).
 */
interface Lesson {
  key: string
  kind: string
  count: number
  line: string
  evidence: Array<{ seq: number; ts: string; session: string; what: string }>
}

const day = (ts: string) => new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short" })

export function Lessons() {
  const sessions = useSessionList()
  const folders = useMemo(() => {
    const seen = new Map<string, { cwd: string; project: string }>()
    for (const s of sessions) if (s.state !== "ended" && !seen.has(s.cwd)) seen.set(s.cwd, { cwd: s.cwd, project: s.project })
    return [...seen.values()]
  }, [sessions])
  const [chosen, setChosen] = useState<string>()
  const cwd = chosen ?? folders[0]?.cwd
  const [lessons, setLessons] = useState<Lesson[]>()
  const [busy, setBusy] = useState<string>()
  useEffect(() => {
    if (!cwd) return
    let live = true
    setLessons(undefined)
    void send({ type: "lessons_list", cwd }).then((r) => {
      const d = r.data as { lessons?: Lesson[] } | undefined
      if (live && r.ok && Array.isArray(d?.lessons)) setLessons(d.lessons)
    })
    return () => {
      live = false
    }
  }, [cwd])
  if (!folders.length || !cwd) return null
  const add = (key: string) => {
    setBusy(key)
    void send({ type: "lesson_add", cwd, key }).then((r) => {
      setBusy(undefined)
      if (!r.ok) return void toast.error(r.error?.message ?? "It was not added", { id: "lesson" })
      const d = r.data as { lessons?: Lesson[] } | undefined
      if (Array.isArray(d?.lessons)) setLessons(d.lessons)
      toast.success("Added to CLAUDE.md. New sessions here read it.", { id: "lesson" })
    })
  }
  return (
    <section aria-label="Lessons from your undos" className="grid gap-2">
      <h2 className="m-0 text-[18px]">Lessons from your undos and denials</h2>
      <p className="m-0 max-w-[720px] text-[13px] text-mut">
        When you undo the same kind of change, or say no to the same kind of call, three times in a project, a line for its CLAUDE.md is proposed here with the records behind it. Nothing changes until you add it.
      </p>
      {folders.length > 1 ? (
        <label className="grid w-fit gap-1">
          <span className="text-[13px] text-mut">Project</span>
          <select className="field" value={cwd} onChange={(e) => setChosen(e.target.value)}>
            {folders.map((f) => (
              <option key={f.cwd} value={f.cwd}>
                {f.project}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {lessons && !lessons.length ? <p className="m-0 text-[13px]">Nothing to suggest yet.</p> : null}
      {lessons?.length ? (
        <ul className="m-0 grid list-none gap-3 p-0">
          {lessons.map((l) => (
            <li key={l.key} className="grid gap-1 rounded-md border border-line p-2 text-[13px]">
              <span className="text-[14px]">{l.line}</span>
              <details>
                <summary className="cursor-pointer text-mut">The {l.evidence.length} records it rests on</summary>
                <ul className="m-0 grid list-none gap-0.5 p-0 pt-1">
                  {l.evidence.map((e) => (
                    <li key={e.seq}>
                      {day(e.ts)}: {e.what} (audit record {e.seq})
                    </li>
                  ))}
                </ul>
              </details>
              <button type="button" className="btn w-fit" disabled={busy === l.key} onClick={() => add(l.key)}>
                {busy === l.key ? "Adding..." : "Add to CLAUDE.md"}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
