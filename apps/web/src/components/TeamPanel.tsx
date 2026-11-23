import { useEffect, useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

interface Role {
  name: string
  model?: string
  effort?: string
  paths?: string[]
  denyTools?: string[]
  readOnly?: boolean
}

/** E-046: the project's roles (.codehouse/roles.yml); each starts as its own session in its own worktree. */
export function TeamPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [roles, setRoles] = useState<Role[]>()
  const [error, setError] = useState<string>()
  const [task, setTask] = useState("")
  const [schema, setSchema] = useState("")
  useEffect(() => {
    void send({ type: "team", sessionId, step: "list" }).then((x) => (x.ok ? setRoles((x.data as { roles: Role[] }).roles) : setError(x.error?.message ?? "The roles could not be read")))
  }, [sessionId])
  const start = (role: string) =>
    void send({ type: "team", sessionId, step: "start", role, task: task.trim(), ...(schema.trim() ? { resultSchema: schema.trim() } : {}) }).then((x) =>
      x.ok ? toast(`The ${role} role started, in a worktree of its own`, { id: "team" }) : toast.error(x.error?.message ?? "Not started", { id: "team" }),
    )
  return (
    <section aria-label="Team" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Team</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      {error ? <p className="m-0">{error}</p> : null}
      {roles && !roles.length ? <p className="m-0 text-mut">This project has no roles. Define them in .codehouse/roles.yml: each a model, an effort, the paths it works in and the tools it may not use. Roles can only restrict.</p> : null}
      {roles?.length ? (
        <>
          <label className="grid gap-1">
            <span className="text-xs text-mut">The task</span>
            <textarea className="field min-h-14" value={task} onChange={(e) => setTask(e.target.value)} />
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-mut">Result schema for the hand-off (JSON Schema, optional)</span>
            <textarea className="field mono min-h-10" value={schema} onChange={(e) => setSchema(e.target.value)} />
          </label>
          <ul className="m-0 grid list-none gap-1 p-0">
            {roles.map((r) => (
              <li key={r.name} className="flex flex-wrap items-center gap-2">
                <strong>{r.name}</strong>
                <span className="text-mut">
                  {[r.model, r.effort, r.readOnly ? "read-only" : r.paths ? `in ${r.paths.join(", ")}` : "", r.denyTools ? `no ${r.denyTools.join(", ")}` : ""].filter(Boolean).join(", ")}
                </span>
                <button type="button" className="btn !min-h-7" disabled={!task.trim()} onClick={() => start(r.name)}>
                  Start
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}
