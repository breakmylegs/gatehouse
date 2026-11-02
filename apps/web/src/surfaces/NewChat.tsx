import { useEffect, useState } from "react"
import { chatName } from "../lib/chatName"
import { api } from "../lib/api"
import { keepChatWarm } from "../lib/warmChat"
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
  // The project it starts in, if any, and the instructions for this chat alone (owner's plan, W1-07).
  const [projects, setProjects] = useState<string[]>([])
  const [project, setProject] = useState(() => {
    const chosen = useStore.getState().newChatProject ?? ""
    useStore.setState({ newChatProject: undefined })
    return chosen
  })
  const [instructions, setInstructions] = useState("")
  // W1-10: plan, search, read and cite (ADR 0007).
  const [research, setResearch] = useState(false)
  useEffect(() => {
    void api<{ projects: Array<{ name: string }> }>("GET", "/api/projects").then((r) => {
      if (r.ok) setProjects((r.data?.projects ?? []).map((p) => p.name))
    })
  }, [])
  // Models on this computer, when other providers are on and the runtime passes its checks (ADR 0011).
  const [localModels, setLocalModels] = useState<string[]>([])
  const [localLabel, setLocalLabel] = useState("On this computer")
  useEffect(() => {
    void api<{ enabled: boolean; label?: string; check?: { ok: boolean; models?: string[] } }>(
      "GET",
      "/api/providers",
    ).then((r) => {
      if (r.ok && r.data?.enabled && r.data.check?.ok) {
        setLocalModels(r.data.check.models ?? [])
        if (r.data.label) setLocalLabel(r.data.label)
      }
    })
  }, [])
  const localModel = model.startsWith("local:") ? model.slice(6) : undefined
  // A chat ready for the first message while this page is open (the warm chat); the Host puts it away after a while.
  useEffect(() => keepChatWarm(), [])

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
        // Only the start names the chat; the whole message is sent as the prompt (up to 100,000 characters).
        title: chatName(said),
        // The Host keeps a chat in Plan mode whatever is sent; saying so here too.
        mode: "plan",
        ...accountForNew(),
        ...(localModel ? { localModel } : model ? { model } : {}),
        ...(project ? { chatProject: project } : {}),
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
        ...(research && !localModel ? { research: true } : {}),
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
        {projects.length > 0 ? (
          <label className="grid gap-1 sm:w-[300px]">
            <span>Project</span>
            <select className="field" value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <span className="text-xs text-mut">
              A project brings its instructions and the files Claude may read.
            </span>
          </label>
        ) : null}
        <label className="grid gap-1">
          <span>Instructions for this chat (optional)</span>
          <textarea
            className="field"
            rows={2}
            maxLength={8000}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </label>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={research && !localModel}
            disabled={localModel !== undefined}
            onChange={(e) => setResearch(e.target.checked)}
          />
          <span className="grid">
            <span>Research</span>
            <span className="text-xs text-mut">
              Claude plans the questions, searches the web, reads the best sources and cites each
              claim by number. Sources lists them beside the chat.
              {localModel ? " Not with a model on this computer: it has no web search." : ""}
            </span>
          </span>
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
              {localModels.length ? (
                <optgroup label={localLabel}>
                  {localModels.map((m) => (
                    <option key={m} value={`local:${m}`}>
                      {m}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </label>
          <button className="btn btn-primary" disabled={busy || !text.trim()}>
            {busy ? "Starting…" : "Start the chat"}
          </button>
          <span className="text-[13px] text-mut">Ctrl+Enter starts it too.</span>
        </div>
        {busy ? <StartProgress since={startedAt} chat /> : null}
        {error ? (
          <p role="alert" className="m-0 font-semibold text-sev">
            {error}
          </p>
        ) : null}
      </form>
    </div>
  )
}
