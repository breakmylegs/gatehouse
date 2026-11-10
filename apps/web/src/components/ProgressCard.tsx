import { useState } from "react"
import type { Todo } from "../lib/transcript"

/** How many steps are done, out of how many. */
export const progressOf = (todos: Todo[]) => ({
  done: todos.filter((t) => t.status === "completed").length,
  total: todos.length,
})

const STATE_WORDS: Record<Todo["status"], string> = {
  completed: "done",
  in_progress: "in progress",
  pending: "not started",
}

/** A step's mark: a filled circle with a tick when done, a ring with a dot while in progress, an empty ring before. */
function Mark({ status }: { status: Todo["status"] }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="mt-0.5 shrink-0">
      {status === "completed" ? (
        <>
          <circle cx="8" cy="8" r="7" className="fill-acc" />
          <path
            d="M4.6 8.2 7 10.4 11.4 5.8"
            fill="none"
            stroke="white"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : status === "in_progress" ? (
        <>
          <circle cx="8" cy="8" r="6.3" fill="none" className="stroke-acc" strokeWidth="1.6" />
          <circle cx="8" cy="8" r="3" className="progress-dot fill-acc" />
        </>
      ) : (
        <circle cx="8" cy="8" r="6.3" fill="none" className="stroke-mut" strokeWidth="1.4" />
      )}
    </svg>
  )
}

/**
 * The steps, each with its mark and, for screen readers, its state in words; the commits made during it, and a word
 * when it was ticked while the last test run had failed (G17).
 */
export function StepList({ todos, limit }: { todos: Todo[]; limit?: number }) {
  const shown = limit !== undefined && todos.length > limit ? visible(todos, limit) : todos
  return (
    <ol className="m-0 grid list-none gap-1 p-0">
      {shown.map((t, i) => (
        <li key={`${i}-${t.content}`} className="flex items-start gap-2 text-[13.5px]">
          <Mark status={t.status} />
          <span
            className={
              t.status === "completed"
                ? "text-mut line-through"
                : t.status === "in_progress"
                  ? "font-medium"
                  : undefined
            }
          >
            {t.status === "in_progress" && t.activeForm ? t.activeForm : t.content}
            <span className="sr-only">{`, ${STATE_WORDS[t.status]}`}</span>
          </span>
          {t.afterFailedTests ? (
            <span className="text-[12px] font-semibold">Ticked while the tests were failing</span>
          ) : null}
          {t.commits?.length ? (
            <span className="mono ml-auto shrink-0 text-[12px] text-mut">
              <span className="sr-only">Commits: </span>
              {t.commits.join(", ")}
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  )
}

/** For a long plan: the step in progress, a done step before it, and those after, up to the limit. */
function visible(todos: Todo[], limit: number): Todo[] {
  const at = Math.max(
    0,
    todos.findIndex((t) => t.status !== "completed"),
  )
  const from = Math.max(0, Math.min(at - 1, todos.length - limit))
  return todos.slice(from, from + limit)
}

/**
 * The plan as a card above the prompt box (owner, 2 Nov: "showing progress on a card that has radio buttons that show
 * completed, in progress or not started"): how far Claude is, and each step. A long plan shows the steps around the
 * one in progress until you open it all.
 */
export function ProgressCard({ todos }: { todos: Todo[] }) {
  const [all, setAll] = useState(false)
  const { done, total } = progressOf(todos)
  if (!total) return null
  return (
    <section className="progress-card panel mb-2 grid gap-2 px-3 py-2" aria-label="Progress">
      <div className="flex items-center gap-3">
        <strong className="text-[13px]">Progress</strong>
        <span className="text-[12.5px] text-mut">
          {done} of {total} done
        </span>
        <span
          className="h-1 min-w-12 flex-1 overflow-hidden rounded bg-s2"
          role="progressbar"
          aria-label="Steps done"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
        >
          <span className="block h-full bg-acc" style={{ width: `${(done / total) * 100}%` }} />
        </span>
        {total > 5 ? (
          <button
            type="button"
            className="btn !min-h-6 !px-2 !text-[12px]"
            aria-expanded={all}
            onClick={() => setAll(!all)}
          >
            {all ? "Show fewer" : `Show all ${total}`}
          </button>
        ) : null}
      </div>
      <StepList todos={todos} {...(all ? {} : { limit: 5 })} />
    </section>
  )
}
