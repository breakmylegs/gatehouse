import { useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

/**
 * D-036, tests-first mode. Start: the acceptance criteria (the session's goal by default) go to Claude, which writes the
 * tests first; until you approve them, an edit to anything but a test file comes to you. Approve: the test files the
 * session changed are locked, and Claude implements.
 */
export function TestsFirstStart({ sessionId, goal, onClose }: { sessionId: string; goal?: string; onClose: () => void }) {
  const [criteria, setCriteria] = useState(goal ?? "")
  const [busy, setBusy] = useState(false)
  return (
    <section aria-label="Tests first" className="panel grid gap-2 p-4 text-[13px]">
      <h2 className="m-0 text-[17px]">Tests first</h2>
      <p className="m-0 text-mut">
        Claude writes tests for these criteria first. Until you approve them, a change to anything but a test file comes to
        you, even in Extreme approval. Approving locks the tests, and then Claude implements.
      </p>
      <label className="grid gap-1">
        <span>Acceptance criteria</span>
        <textarea className="field" rows={5} value={criteria} onChange={(e) => setCriteria(e.target.value)} />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !criteria.trim()}
          onClick={async () => {
            setBusy(true)
            const r = await send({ type: "tests_first", sessionId, criteria })
            setBusy(false)
            if (!r.ok) return void toast.error(r.error?.message ?? "Tests first could not start")
            onClose()
          }}
        >
          Start with the tests
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </section>
  )
}

export function TestsFirstBanner({ sessionId }: { sessionId: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <section aria-label="Tests first" className="panel mb-2 flex flex-wrap items-center gap-3 px-3 py-2 text-[13px]">
      <strong>Tests first</strong>
      <span className="min-w-0 flex-1 text-mut">Claude is writing the tests. Only test files change without asking you until you approve them.</span>
      <button
        type="button"
        className="btn !min-h-7"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          const r = await send({ type: "tests_first_approve", sessionId })
          setBusy(false)
          if (!r.ok) return void toast.error(r.error?.message ?? "The tests could not be approved")
          const locked = (r.data as { locked: string[] }).locked
          toast(`Approved and locked: ${locked.join(", ")}. Claude implements next.`)
        }}
      >
        Approve the tests
      </button>
    </section>
  )
}
