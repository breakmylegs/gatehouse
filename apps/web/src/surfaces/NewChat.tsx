import { useState } from "react"
import { accountForNew, send, useStore } from "../store"
import { MODELS, START_WAIT_MS, StartProgress } from "./Sessions"

/**
 * A chat: a conversation with Claude that is not about a project (owner, 30 Oct). It starts from what you say, gets a
 * folder of its own outside your projects, and is told it is a chat. The Host keeps it in Plan mode, so it never
 * changes files or runs commands; the Approver and the audit apply as everywhere else.
 */
export function NewChat() {
  const [text, setText] = useState("")
  const [model, setModel] = useState("")
  const [busy, setBusy] = useState(false)
  const [startedAt, setStartedAt] = useState(0)
  const [error, setError] = useState<string>()

  async function start(e: React.FormEvent) {
    e.preventDefault()
    const said = text.trim()
    if (!said || busy) return
    setBusy(true)
    setStartedAt(Date.now())
    setError(undefined)
    const r = await send(
      {
        type: "create_session",
        // The Host gives a chat a folder of its own; this one is not used.
        cwd: "chat",
        kind: "chat",
        title: said,
        // The Host keeps a chat in Plan mode whatever is sent; saying so here too.
        mode: "plan",
        ...accountForNew(),
        ...(model ? { model } : {}),
      },
      START_WAIT_MS,
    )
    setBusy(false)
    if (!r.ok) {
      setError(
        r.error?.code === "timeout"
          ? "This is taking longer than usual. If the chat starts it appears under Chats in the sidebar."
          : (r.error?.message ?? "The chat did not start"),
      )
      return
    }
    const id = (r.data as { sessionId: string }).sessionId
    const s = useStore.getState()
    s.addUserText(id, said)
    void send({ type: "prompt", sessionId: id, text: said })
    s.selectSession(id)
    s.setRoute("workspace")
  }

  return (
    <div className="mx-auto grid max-w-[760px] gap-4 p-6">
      <div>
        <h1 className="m-0">Start a chat</h1>
        <p className="m-0 mt-1 max-w-[62ch] text-mut">
          A conversation with Claude rather than a coding session: questions, explanations, ideas
          and writing. It runs in Plan mode, so Claude can read and look things up on the web but
          never changes files or runs commands. Your chats are listed under Chats in the sidebar.
        </p>
      </div>
      <form onSubmit={start} className="panel grid gap-3 p-4" aria-label="Start a chat">
        <label className="grid gap-1">
          <span>What do you want to talk about?</span>
          <textarea
            className="field"
            rows={4}
            required
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void start(e)
            }}
          />
        </label>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid w-[200px] grid-cols-[minmax(0,1fr)] gap-1">
            <span>Model</span>
            <select className="field" value={model} onChange={(e) => setModel(e.target.value)}>
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-primary" disabled={busy || !text.trim()}>
            {busy ? "Starting…" : "Start the chat"}
          </button>
          <span className="text-[13px] text-mut">Ctrl+Enter starts it too.</span>
        </div>
        {busy ? <StartProgress since={startedAt} /> : null}
        {error ? (
          <p role="alert" className="m-0 font-semibold text-sev">
            {error}
          </p>
        ) : null}
      </form>
    </div>
  )
}
