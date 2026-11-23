import { useEffect, useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

interface Task {
  id: string
  prompt: string
  dependsOn: string
  budget: string
  extreme: boolean
}
interface Line {
  task: string
  status: string
  costUsd: number
  evidence: string
  openDecisions: number
  why?: string
}

const blank = (n: number): Task => ({ id: `task-${n}`, prompt: "", dependsOn: "", budget: "", extreme: false })

/** E-054: the night's tasks, run in dependency order within a budget, and the morning report. */
export function NightPanel({ folder, onClose }: { folder: string; onClose: () => void }) {
  const [tasks, setTasks] = useState<Task[]>([blank(1)])
  const [budget, setBudget] = useState("20")
  const [at, setAt] = useState("22:00")
  const [report, setReport] = useState<{ lines: Line[]; totalUsd: number; stopped?: string }>()
  useEffect(() => {
    void send({ type: "night", step: "report" }).then((x) => x.ok && setReport((x.data as { report?: typeof report }).report))
  }, [])
  const set = (i: number, patch: Partial<Task>) => setTasks((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)))
  async function queue() {
    const x = await send({
      type: "night",
      step: "start",
      budgetUsd: Number(budget),
      ...(at ? { at } : {}),
      tasks: tasks.filter((t) => t.prompt.trim()).map((t) => ({ id: t.id.trim(), prompt: t.prompt.trim(), folder, ...(t.dependsOn.trim() ? { dependsOn: t.dependsOn.split(",").map((d) => d.trim()).filter(Boolean) } : {}), ...(Number(t.budget) > 0 ? { budgetUsd: Number(t.budget) } : {}), ...(t.extreme ? { extreme: true } : {}) })),
    })
    if (!x.ok) return void toast.error(x.error?.message ?? "Not queued", { id: "night" })
    toast(`Queued: ${(x.data as { order: string[] }).order.join(", ")}`, { id: "night" })
  }
  return (
    <section aria-label="Night shift" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Night shift</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      {tasks.map((t, i) => (
        <div key={i} className="grid gap-1 border-b border-[color:var(--line)] pb-2">
          <div className="flex flex-wrap gap-2">
            <input className="field mono w-28" aria-label="Task name" value={t.id} onChange={(e) => set(i, { id: e.target.value.replace(/[^\w-]/g, "") })} />
            <input className="field w-40" aria-label="Depends on" placeholder="depends on (names)" value={t.dependsOn} onChange={(e) => set(i, { dependsOn: e.target.value })} />
            <input className="field w-24" aria-label="Its cap in dollars" placeholder="cap $" inputMode="decimal" value={t.budget} onChange={(e) => set(i, { budget: e.target.value })} />
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={t.extreme} onChange={(e) => set(i, { extreme: e.target.checked })} />
              Extreme approval
            </label>
          </div>
          <textarea className="field min-h-12" aria-label="The task" value={t.prompt} onChange={(e) => set(i, { prompt: e.target.value })} />
        </div>
      ))}
      <div className="flex flex-wrap items-end gap-2">
        <button type="button" className="btn !min-h-7" onClick={() => setTasks((ts) => [...ts, blank(ts.length + 1)])}>
          Add a task
        </button>
        <label className="grid gap-1">
          <span className="text-xs text-mut">The night&apos;s budget ($)</span>
          <input className="field w-24" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-mut">Start at (empty: now)</span>
          <input className="field w-24" value={at} onChange={(e) => setAt(e.target.value)} />
        </label>
        <button type="button" className="btn btn-primary !min-h-7" disabled={!tasks.some((t) => t.prompt.trim()) || !(Number(budget) > 0)} onClick={() => void queue()}>
          Queue for the night
        </button>
      </div>
      <p className="m-0 text-xs text-mut">
        Tasks run in this folder in dependency order, through the scheduler, each within its cap; none starts once the night&apos;s
        budget is reached. Extreme approval keeps its own limits and still stops for what it never answers.
      </p>
      {report ? (
        <div className="grid gap-1">
          <strong>Morning report</strong>
          {report.stopped ? <span className="text-mut">{report.stopped}</span> : null}
          {report.lines.map((l) => (
            <span key={l.task}>
              <span className="mono">{l.task}</span>: {l.status}, ${l.costUsd}, {l.evidence}
              {l.openDecisions ? `, ${l.openDecisions} decision(s) waiting` : ""}
              {l.why ? <span className="text-mut"> ({l.why})</span> : null}
            </span>
          ))}
          <span className="text-mut">${report.totalUsd} in all.</span>
        </div>
      ) : null}
    </section>
  )
}
