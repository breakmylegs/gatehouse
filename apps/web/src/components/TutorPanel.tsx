import { useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

/** E-072: a tutor session on this project: the agent gives hints and may change only tests. */
export function TutorPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [topic, setTopic] = useState("")
  const [busy, setBusy] = useState(false)
  async function start() {
    setBusy(true)
    const x = await send({ type: "tutor_start", sessionId, topic: topic.trim() })
    setBusy(false)
    if (!x.ok) return void toast.error(x.error?.message ?? "Not started", { id: "tutor" })
    toast("Tutor session started", { id: "tutor" })
    onClose()
  }
  return (
    <section aria-label="Tutor mode" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Start a tutor session</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="m-0 text-mut">
        A new session on this project, in Manual mode. The agent reads the code, runs the tests and gives you hints; Codehouse refuses its edits to anything but tests, in every mode, and other commands come to you.
      </p>
      <label className="grid gap-1">
        <span className="text-xs text-mut">What you want to learn</span>
        <input className="field" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="How the invoice totals are worked out" />
      </label>
      <button type="button" className="btn btn-primary !min-h-7 justify-self-start" disabled={busy} onClick={() => void start()}>
        {busy ? "Starting…" : "Start"}
      </button>
    </section>
  )
}
