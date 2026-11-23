import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"

interface Step {
  id: string
  kind: "tour" | "term" | "drills" | "task"
  title: string
  detail: string
  link: { file: string; line?: number; panel?: "tours" }
}

/** E-075: the project's onboarding path, each step linked to its material, with your progress kept. */
export function OnboardingPanel({ sessionId, onOpen, onOpenTours, onClose }: { sessionId: string; onOpen: (file: string, line?: number) => void; onOpenTours: () => void; onClose: () => void }) {
  const [steps, setSteps] = useState<Step[]>()
  const [done, setDone] = useState<Record<string, string>>({})
  const [error, setError] = useState<string>()
  useEffect(() => {
    void api<{ steps: Step[]; done: Record<string, string> }>("GET", `/api/onboarding?session=${encodeURIComponent(sessionId)}`).then((r) => {
      if (r.ok && r.data) {
        setSteps(r.data.steps)
        setDone(r.data.done)
      } else setError(r.error ?? "The path could not be made")
    })
  }, [sessionId])
  async function mark(step: string, on: boolean) {
    const r = await api<{ done: Record<string, string> }>("POST", "/api/onboarding/progress", { session: sessionId, step, done: on })
    if (r.ok && r.data) setDone(r.data.done)
    else toast.error(r.error ?? "Not saved", { id: "onboarding" })
  }
  const count = steps?.filter((s) => done[s.id]).length ?? 0
  return (
    <section aria-label="Onboarding path" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Onboarding path</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      {error ? (
        <p role="alert" className="m-0 text-sev">
          {error}
        </p>
      ) : !steps ? (
        <p className="m-0 text-mut">Making the path…</p>
      ) : (
        <>
          <p className="m-0" role="status">
            {count} of {steps.length} steps done.
          </p>
          <ol className="m-0 grid gap-1.5 pl-5">
            {steps.map((s) => (
              <li key={s.id} className="grid gap-0.5">
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={!!done[s.id]} onChange={(e) => void mark(s.id, e.target.checked)} />
                  <span className={done[s.id] ? "text-mut line-through" : ""}>{s.title}</span>
                </label>
                <span className="text-mut">
                  {s.detail}{" "}
                  <button
                    type="button"
                    className="link"
                    onClick={() => {
                      onOpen(s.link.file, s.link.line)
                      if (s.link.panel === "tours") onOpenTours()
                    }}
                  >
                    {s.link.file}
                    {s.link.line ? `:${s.link.line}` : ""}
                  </button>
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  )
}
