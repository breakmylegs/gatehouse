import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"

interface Task {
  prompt: string
  expect: string
}
interface Result {
  task: number
  with: boolean
  passed: boolean
  error?: string
}
interface Run {
  startedAt: string
  finishedAt?: string
  state: "running" | "done" | "stopped" | "failed"
  error?: string
  total: number
  results: Result[]
}
interface Suite {
  plugin: string
  folder: string
  tasks: Task[]
  last?: Run
}

const MAX_TASKS = 20
const blank = (): Task => ({ prompt: "", expect: "" })

/** "3 of 4 passed (75%)" for one side of a run. */
export function rate(results: Result[], withIt: boolean): string {
  const rs = results.filter((r) => r.with === withIt)
  if (!rs.length) return "not run yet"
  const passed = rs.filter((r) => r.passed).length
  return `${passed} of ${rs.length} passed (${Math.round((passed / rs.length) * 100)}%)`
}

/**
 * B39: a plugin's evaluation. Tasks for a folder, each with what a good answer says; each runs twice in Plan mode, with
 * the plugin and without it, and the pass rates show whether the plugin helps.
 */
export function PluginEval({ plugin, name }: { plugin: string; name: string }) {
  const [folder, setFolder] = useState("")
  const [tasks, setTasks] = useState<Task[]>([blank()])
  const [last, setLast] = useState<Run>()
  const [running, setRunning] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const r = await api<{ suites: Suite[]; running?: string }>("GET", "/api/plugin-evals")
    if (!r.ok || !r.data) return
    const s = r.data.suites.find((x) => x.plugin === plugin)
    setRunning(r.data.running === plugin)
    if (!s) return
    setLast(s.last)
    return s
  }, [plugin])

  useEffect(() => {
    void load().then((s) => {
      if (!s) return
      setFolder(s.folder)
      setTasks(s.tasks.length ? s.tasks : [blank()])
    })
  }, [load])

  // While it runs, the results come in one by one.
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => void load(), 3000)
    return () => clearInterval(t)
  }, [running, load])

  const setTask = (i: number, part: Partial<Task>) =>
    setTasks((ts) => ts.map((t, k) => (k === i ? { ...t, ...part } : t)))

  async function save(): Promise<boolean> {
    setSaving(true)
    const r = await api("PUT", "/api/plugin-evals", { plugin, folder, tasks })
    setSaving(false)
    if (!r.ok) toast.error(r.error ?? "The evaluation was not saved", { id: "plugin-eval" })
    return r.ok
  }

  async function run() {
    if (!(await save())) return
    const r = await api<{ run: Run }>("POST", `/api/plugin-evals/${encodeURIComponent(plugin)}/run`)
    if (!r.ok || !r.data) {
      toast.error(r.error ?? "The evaluation did not start", { id: "plugin-eval" })
      return
    }
    setLast(r.data.run)
    setRunning(true)
  }

  async function stop() {
    await api("POST", `/api/plugin-evals/${encodeURIComponent(plugin)}/stop`)
    toast("It stops after the task in hand.", { id: "plugin-eval" })
  }

  async function choose() {
    const r = await api<{ path: string | null }>("POST", "/api/pick-folder", { start: folder })
    if (r.ok && r.data?.path) setFolder(r.data.path)
  }

  return (
    <section className="grid gap-3 rounded border border-line p-3" aria-label={`Evaluate ${name}`}>
      <p className="m-0 max-w-[70ch] text-[13px] text-mut">
        Write a few tasks for a folder, and what a good answer says. Each task runs twice in Plan
        mode, with {name} and without it, so nothing in the folder changes and every tool call goes
        through your rules. It uses your plan twice for each task.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid min-w-[20rem] flex-1 gap-1 text-[13px]">
          Folder
          <input
            className="field mono"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="C:\dev\my-project"
          />
        </label>
        <button type="button" className="btn !min-h-8" onClick={() => void choose()}>
          Choose…
        </button>
      </div>
      <ol className="m-0 grid list-none gap-2 p-0" aria-label="Tasks">
        {tasks.map((t, i) => (
          <li key={i} className="grid gap-1.5 rounded bg-s2 p-2">
            <label className="grid gap-1 text-[13px]">
              Task {i + 1}
              <textarea
                className="field"
                rows={2}
                maxLength={8000}
                value={t.prompt}
                onChange={(e) => setTask(i, { prompt: e.target.value })}
              />
            </label>
            <label className="grid gap-1 text-[13px]">
              A good answer says
              <input
                className="field"
                maxLength={300}
                value={t.expect}
                onChange={(e) => setTask(i, { expect: e.target.value })}
                aria-describedby={`eval-expect-help-${plugin}`}
              />
            </label>
            {tasks.length > 1 ? (
              <span>
                <button
                  type="button"
                  className="btn !min-h-7"
                  onClick={() => setTasks((ts) => ts.filter((_, k) => k !== i))}
                >
                  Remove task {i + 1}
                </button>
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      <p id={`eval-expect-help-${plugin}`} className="m-0 text-[12px] text-mut">
        Words the answer must contain (capitals do not matter), or a pattern between slashes, such
        as /port \d+/i.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn !min-h-8"
          disabled={tasks.length >= MAX_TASKS}
          onClick={() => setTasks((ts) => [...ts, blank()])}
        >
          Add a task
        </button>
        <button
          type="button"
          className="btn !min-h-8"
          disabled={saving || running}
          onClick={() => void save().then((ok) => ok && toast("Saved.", { id: "plugin-eval" }))}
        >
          Save
        </button>
        {running ? (
          <button type="button" className="btn !min-h-8" onClick={() => void stop()}>
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary !min-h-8"
            disabled={saving}
            onClick={() => void run()}
          >
            Run the evaluation
          </button>
        )}
      </div>
      {last ? (
        <div className="grid gap-1 text-[13px]" aria-live="polite">
          <p className="m-0">
            <strong>With {name}:</strong> {rate(last.results, true)}. <strong>Without it:</strong>{" "}
            {rate(last.results, false)}.
          </p>
          <p className="m-0 text-[12px] text-mut">
            {last.state === "running"
              ? `Running: ${last.results.length} of ${last.total} runs done.`
              : last.state === "stopped"
                ? "Stopped before the end."
                : last.state === "failed"
                  ? `It failed: ${last.error ?? "no reason given"}.`
                  : `Finished ${new Date(last.finishedAt ?? last.startedAt).toLocaleString()}.`}
          </p>
          {last.results.some((r) => r.error) ? (
            <ul className="m-0 grid gap-0.5 pl-5 text-[12px] text-mut">
              {last.results
                .filter((r) => r.error)
                .map((r) => (
                  <li key={`${r.task}-${r.with}`}>
                    Task {r.task + 1}, {r.with ? "with it" : "without it"}: {r.error}
                  </li>
                ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
