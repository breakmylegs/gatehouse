import { useState } from "react"

/**
 * D-093, chunked plans: a plan to approve shown a step at a time, with where you are in it, so a long plan is read in
 * pieces. Steps are its numbered or bulleted items, or its paragraphs when it has none; the whole plan is one Copy away.
 */
export function planSteps(plan: string): string[] {
  const lines = plan.replace(/\r\n/g, "\n").split("\n")
  const steps: string[] = []
  let cur: string[] = []
  const flush = () => {
    const t = cur.join("\n").trim()
    if (t) steps.push(t)
    cur = []
  }
  const starts = (l: string) => /^\s{0,3}(\d+[.)]|[-*+]|#{1,6})\s/.test(l)
  const itemised = lines.some(starts)
  for (const l of lines) {
    if (itemised ? starts(l) : l.trim() === "") flush()
    cur.push(l)
  }
  flush()
  return steps.length ? steps : [plan.trim()]
}

export function ChunkedPlan({ plan }: { plan: string }) {
  const steps = planSteps(plan)
  const [at, setAt] = useState(0)
  const i = Math.min(at, steps.length - 1)
  return (
    <section aria-label="The plan, a step at a time" className="grid gap-2">
      <p className="m-0 text-[13px] text-mut" aria-live="polite">
        Step {i + 1} of {steps.length}
      </p>
      <pre className="cmd" tabIndex={0} aria-label={`Step ${i + 1} of ${steps.length}`}>
        {steps[i]}
      </pre>
      <div className="flex gap-2">
        <button type="button" className="btn !min-h-7" disabled={i === 0} onClick={() => setAt(i - 1)}>
          Previous step
        </button>
        <button type="button" className="btn !min-h-7" disabled={i === steps.length - 1} onClick={() => setAt(i + 1)}>
          Next step
        </button>
      </div>
    </section>
  )
}
