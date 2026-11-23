import { useEffect, useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

interface Listed {
  id: string
  name?: string
  steps?: number
  problems?: string[]
}
interface Run {
  runId: string
  workflow: string
  task: string
  done: string[]
  status: "running" | "waiting-approval" | "stopped" | "done"
  reason?: string
}

const STATUS = { running: "running", "waiting-approval": "waiting for your approval", stopped: "stopped", done: "done" }

/** E-047: the project's workflows, validated and dry-run before they start; their runs, resumable after a restart. */
export function WorkflowsPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [list, setList] = useState<Listed[]>()
  const [runs, setRuns] = useState<Run[]>([])
  const [plan, setPlan] = useState<{ id: string; lines: string[] }>()
  const [task, setTask] = useState("")
  const load = () => {
    void send({ type: "workflow", sessionId, step: "list" }).then((x) => setList(x.ok ? (x.data as { workflows: Listed[] }).workflows : []))
    void send({ type: "workflow", sessionId, step: "runs" }).then((x) => x.ok && setRuns((x.data as { runs: Run[] }).runs))
  }
  useEffect(load, [sessionId])
  const dry = (id: string) => void send({ type: "workflow", sessionId, step: "dry", id }).then((x) => (x.ok ? setPlan({ id, lines: (x.data as { plan: string[] }).plan }) : toast.error(x.error?.message ?? "No dry run", { id: "wf" })))
  const start = (id: string) =>
    void send({ type: "workflow", sessionId, step: "start", id, task: task.trim() }).then((x) => {
      if (!x.ok) return void toast.error(x.error?.message ?? "Not started", { id: "wf" })
      toast("Workflow started", { id: "wf" })
      load()
    })
  const approve = (runId: string) => void send({ type: "workflow", sessionId, step: "approve", runId }).then((x) => (x.ok ? (toast("Approved; it goes on", { id: "wf" }), load()) : toast.error(x.error?.message ?? "Not approved", { id: "wf" })))
  return (
    <section aria-label="Workflows" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Workflows</h2>
        <span className="flex gap-2">
          <button type="button" className="btn !min-h-7" onClick={load}>
            Refresh
          </button>
          <button type="button" className="btn !min-h-7" onClick={onClose}>
            Close
          </button>
        </span>
      </div>
      {list && !list.length ? <p className="m-0 text-mut">This project has no workflows. Define them in .codehouse/workflows: steps, each with a role from roles.yml, a prompt, outputs, a gate and an approval point.</p> : null}
      {list?.length ? (
        <>
          <label className="grid gap-1">
            <span className="text-xs text-mut">The task ({"{{task}}"} in the prompts)</span>
            <input className="field" value={task} onChange={(e) => setTask(e.target.value)} />
          </label>
          <ul className="m-0 grid list-none gap-2 p-0">
            {list.map((w) => (
              <li key={w.id} className="grid gap-1">
                <strong>{w.name ?? w.id}</strong>
                {w.problems ? (
                  <span className="text-mut">Not valid, so it cannot start: {w.problems.join("; ")}.</span>
                ) : (
                  <span className="flex flex-wrap gap-2">
                    <span className="text-mut">{w.steps} step(s)</span>
                    <button type="button" className="btn !min-h-7" onClick={() => dry(w.id)}>
                      Dry run
                    </button>
                    <button type="button" className="btn btn-primary !min-h-7" disabled={!task.trim()} onClick={() => start(w.id)}>
                      Start
                    </button>
                  </span>
                )}
                {plan?.id === w.id ? <pre className="mono m-0 whitespace-pre-wrap">{plan.lines.join("\n")}</pre> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {runs.length ? (
        <div className="grid gap-1">
          <strong>Runs</strong>
          {runs.slice(0, 10).map((r) => (
            <span key={r.runId} className="flex flex-wrap items-center gap-2">
              <span>
                {r.workflow}: {STATUS[r.status]}
                {r.done.length ? ` (done: ${r.done.join(", ")})` : ""}
                {r.reason ? <span className="text-mut">, {r.reason}</span> : null}
              </span>
              {r.status === "waiting-approval" ? (
                <button type="button" className="btn btn-primary !min-h-7" onClick={() => approve(r.runId)}>
                  Approve
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  )
}
