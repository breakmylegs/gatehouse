import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { OutLink } from "../lib/links"

/**
 * T-091: a project's actions in the terminal pane. Yours (kept in Settings by project) run as if you typed them; the
 * repository's own, from its .codehouse/actions.json, are someone else's commands: each runs only through the
 * approval card, judged by your rules as Claude's would be, and never by itself.
 */
export interface Action {
  name: string
  command: string
  kind: "setup" | "run"
  preview?: string
}

/** One action from what you typed: "name: command", optionally "@ http://localhost:5173" at the end for its preview. */
export function parseAction(line: string): Action | undefined {
  const m = /^\s*([^:]{1,60}):\s*(.+?)\s*(?:@\s*(http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?\S*))?\s*$/.exec(line)
  if (!m || !m[2]!.trim()) return undefined
  const name = m[1]!.trim()
  return { name, command: m[2]!.trim(), kind: /^(setup|install)\b/i.test(name) ? "setup" : "run", ...(m[3] ? { preview: m[3] } : {}) }
}

export function ProjectActions({ sessionId, busy, onRun, onOutput }: { sessionId: string; busy: boolean; onRun: (command: string) => void; onOutput: (text: string, err: boolean) => void }) {
  const [own, setOwn] = useState<Action[]>([])
  const [repo, setRepo] = useState<Action[]>([])
  const [project, setProject] = useState("")
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [asking, setAsking] = useState<number>()
  useEffect(() => {
    void api<{ project: string; own: Action[]; repo: Action[] }>("GET", `/api/project-actions?session=${encodeURIComponent(sessionId)}`).then((r) => {
      if (!r.ok || !r.data) return
      setOwn(r.data.own)
      setRepo(r.data.repo)
      setProject(r.data.project)
    })
  }, [sessionId])
  const save = async () => {
    const lines = draft.split("\n").filter((l) => l.trim())
    const actions = lines.map(parseAction)
    if (actions.some((a) => !a)) return void toast.error('Write each action as "name: command", with "@ http://localhost:port" at the end for a preview.', { id: "actions" })
    const r = await api<{ own: Action[] }>("PUT", "/api/project-actions", { session: sessionId, actions })
    if (!r.ok || !r.data) return void toast.error(r.error ?? "Not saved", { id: "actions" })
    setOwn(r.data.own)
    setEditing(false)
    toast.success(`Actions for ${project} saved`, { id: "actions" })
  }
  const runRepo = async (i: number) => {
    setAsking(i)
    onOutput(`Asking to run the repository's "${repo[i]!.name}": ${repo[i]!.command}\n`, false)
    const r = await api<{ ran: boolean; refused?: string; exitCode: number | null; output: string }>("POST", "/api/project-actions/run", { session: sessionId, index: i })
    setAsking(undefined)
    if (!r.ok || !r.data) return onOutput(`${r.error ?? "It did not run."}\n`, true)
    if (!r.data.ran) return onOutput(`It did not run: ${r.data.refused ?? "refused"}.\n`, true)
    onOutput(r.data.output.endsWith("\n") ? r.data.output : `${r.data.output}\n`, r.data.exitCode !== 0)
  }
  if (!project) return null
  return (
    <div className="grid gap-1 text-[13px]" aria-label="Project actions">
      <div className="flex flex-wrap items-center gap-1">
        {own.map((a) => (
          <span key={a.name} className="inline-flex items-center gap-1">
            <button type="button" className="btn !min-h-7" disabled={busy} title={a.command} onClick={() => onRun(a.command)}>
              {a.name}
            </button>
            {a.preview ? <OutLink href={a.preview}>Preview</OutLink> : null}
          </span>
        ))}
        <button
          type="button"
          className="btn !min-h-7"
          onClick={() => {
            setDraft(own.map((a) => `${a.name}: ${a.command}${a.preview ? ` @ ${a.preview}` : ""}`).join("\n"))
            setEditing((v) => !v)
          }}
        >
          {own.length ? "Edit actions" : "Add actions"}
        </button>
      </div>
      {editing ? (
        <div className="grid gap-1">
          <label className="grid gap-1">
            <span className="text-mut">Your actions for {project}, one a line: name: command, and @ an address on this computer for its preview</span>
            <textarea className="field mono" rows={3} spellCheck={false} value={draft} placeholder="Dev server: npm run dev @ http://localhost:5173" onChange={(e) => setDraft(e.target.value)} />
          </label>
          <span>
            <button type="button" className="btn !min-h-7" onClick={() => void save()}>
              Save
            </button>
          </span>
        </div>
      ) : null}
      {repo.length ? (
        <div className="grid gap-1">
          <span className="text-mut">From this repository (.codehouse/actions.json): someone else&apos;s commands, each run only through the approval card.</span>
          <div className="flex flex-wrap gap-1">
            {repo.map((a, i) => (
              <button key={`${a.name}-${i}`} type="button" className="btn !min-h-7" disabled={busy || asking !== undefined} title={a.command} onClick={() => void runRepo(i)}>
                {asking === i ? "Waiting for the card..." : `${a.name} (asks)`}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
