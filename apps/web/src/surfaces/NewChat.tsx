import { MemoryCard } from "../components/MemoryCard"
import { useEffect, useState } from "react"
import { chatName } from "../lib/chatName"
import { api } from "../lib/api"
import { keepChatWarm } from "../lib/warmChat"
import { accountForNew, send, useSessionList, useStore } from "../store"
import { MODELS, START_WAIT_MS, StartProgress } from "./Sessions"
import { acceptLicence, licenceAccepted, useLicence } from "../lib/licence"

/**
 * Ask about code (owner, 6 Nov; a chat since 30 Oct): questions about one of your code sessions and its code, asked
 * from outside it, so the session carries on undisturbed. It gets a folder of its own, reads the session's files and
 * what was said in it, and the Host keeps it in Plan mode, so it never changes files or runs commands; the Approver
 * and the audit apply as everywhere else.
 */
export function NewChat() {
  const [text, setText] = useState("")
  // The code session it is about: one chosen from its menu, or chosen here. Only open coding sessions.
  const sessions = useSessionList()
  const codeSessions = sessions.filter(
    (s) => s.kind !== "chat" && !s.local && s.state !== "ended" && s.state !== "error",
  )
  const [about, setAbout] = useState(() => {
    const chosen = useStore.getState().newChatAbout ?? ""
    useStore.setState({ newChatAbout: undefined })
    return chosen
  })
  useEffect(() => {
    if (!about && codeSessions.length === 1) setAbout(codeSessions[0]!.id)
  }, [about, codeSessions])
  const aboutOpen = codeSessions.some((s) => s.id === about)
  const [model, setModel] = useState("")
  const [busy, setBusy] = useState(false)
  const [startedAt, setStartedAt] = useState(0)
  const [error, setError] = useState<string>()
  // C-004: refused for want of memory; the card explains and offers idle sessions to suspend.
  const [shortOfMemory, setShortOfMemory] = useState(false)
  // The project it starts in, if any, and the instructions for this chat alone (owner's plan, W1-07).
  const [projects, setProjects] = useState<string[]>([])
  // B17: what each project lets its chats use; a project not in here allows every provider.
  const [allows, setAllows] = useState<Record<string, Array<"claude" | "local">>>({})
  const [project, setProject] = useState(() => {
    const chosen = useStore.getState().newChatProject ?? ""
    useStore.setState({ newChatProject: undefined })
    return chosen
  })
  const [instructions, setInstructions] = useState("")
  // W1-10: plan, search, read and cite (ADR 0007).
  const [research, setResearch] = useState(false)
  useEffect(() => {
    void api<{ projects: Array<{ name: string; providers?: Array<"claude" | "local"> }> }>(
      "GET",
      "/api/projects",
    ).then((r) => {
      if (!r.ok) return
      const list = r.data?.projects ?? []
      setProjects(list.map((p) => p.name))
      setAllows(
        Object.fromEntries(list.flatMap((p) => (p.providers ? [[p.name, p.providers]] : []))),
      )
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
  const allowed = project ? allows[project] : undefined
  const offerClaude = !allowed || allowed.includes("claude")
  const offerLocal = !allowed || allowed.includes("local")
  const shownLocal = offerLocal ? localModels : []
  // A model the project does not allow is not kept: the first it does allow is chosen instead.
  useEffect(() => {
    const isLocal = model.startsWith("local:")
    if (isLocal && !offerLocal) setModel("")
    else if (!isLocal && !offerClaude && shownLocal[0]) setModel(`local:${shownLocal[0]}`)
  }, [model, offerClaude, offerLocal, shownLocal])
  const nothingAllowed = !offerClaude && shownLocal.length === 0
  const localModel = model.startsWith("local:") ? model.slice(6) : undefined
  // B19: a model on this computer is used only after you have seen its licence, once.
  const [accepted, setAccepted] = useState(false)
  useEffect(() => setAccepted(localModel ? licenceAccepted(localModel) : true), [localModel])
  const licence = useLicence(localModel && !accepted ? localModel : undefined)
  const licenceReady = !localModel || accepted
  // B22: the same first message to two to four models, side by side, to keep the best answer.
  const [comparing, setComparing] = useState(false)
  const [compareWith, setCompareWith] = useState<string[]>([])
  const compareChoices = [
    ...(offerClaude ? MODELS.filter((m) => m.id).map((m) => ({ id: m.id, label: m.label })) : []),
    ...shownLocal.map((m) => ({ id: `local:${m}`, label: `${m} (${localLabel})` })),
  ]
  const compareReady = !comparing || (compareWith.length >= 2 && compareWith.length <= 4)
  // A chat ready for the first message while this page is open (the warm chat); the Host puts it away after a while.
  useEffect(() => keepChatWarm(), [])

  async function start(e: React.FormEvent) {
    e.preventDefault()
    const said = text.trim()
    if (!said || busy || !aboutOpen) return
    setBusy(true)
    setStartedAt(Date.now())
    setError(undefined)
    setShortOfMemory(false)
    if (comparing) return void startCompare(said)
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
        about,
      },
      START_WAIT_MS,
    )
    setBusy(false)
    if (!r.ok) {
      setError(
        r.error?.code === "timeout"
          ? "This is taking longer than usual. If it starts it appears under Questions in the sidebar."
          : (r.error?.message ?? "The chat did not start"),
      )
      setShortOfMemory(r.error?.code === "memory")
      return
    }
    const id = (r.data as { sessionId: string }).sessionId
    const s = useStore.getState()
    s.addUserText(id, said)
    void send({ type: "prompt", sessionId: id, text: said })
    s.selectSession(id)
    s.setRoute("workspace")
  }

  /** One chat for each model chosen, the same message to each, opened side by side (B22). */
  async function startCompare(said: string) {
    const at = Date.now()
    const ids: string[] = []
    for (const m of compareWith) {
      const local = m.startsWith("local:") ? m.slice(6) : undefined
      const r = await send(
        {
          type: "create_session",
          cwd: "chat",
          kind: "chat",
          title: chatName(said),
          mode: "plan",
          ...accountForNew(),
          ...(local ? { localModel: local } : { model: m }),
          ...(project ? { chatProject: project } : {}),
          ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
          about,
        },
        START_WAIT_MS,
      )
      if (!r.ok) {
        setBusy(false)
        for (const id of ids) void send({ type: "close_session", sessionId: id })
        setError(r.error?.message ?? "One of the chats did not start, so none was kept")
        return
      }
      ids.push((r.data as { sessionId: string }).sessionId)
    }
    setBusy(false)
    const s = useStore.getState()
    for (const id of ids) {
      s.addUserText(id, said)
      void send({ type: "prompt", sessionId: id, text: said })
    }
    useStore.setState({ panes: ids, selectedSession: ids[0], compare: { ids, at } })
    s.setRoute("workspace")
  }

  return (
    <div className="mx-auto grid max-w-[760px] gap-4 p-6">
      <div>
        <h1 className="m-0">Ask about a code session</h1>
        <p className="m-0 mt-1 max-w-[62ch] text-mut">
          Ask about one of your code sessions and its code, from outside it, so the session carries
          on undisturbed: how far it has got, what it changed, how something works. Claude reads the
          session&apos;s files and what has been said in it, but never changes anything or runs
          commands; to change something, ask the session itself. Your questions are listed under
          Questions in the sidebar.
        </p>
      </div>
      <form onSubmit={start} className="panel grid gap-3 p-4" aria-label="Ask about a code session">
        <label className="grid gap-1 sm:w-[420px]">
          <span>Which session</span>
          <select
            className="field"
            required
            value={aboutOpen ? about : ""}
            onChange={(e) => setAbout(e.target.value)}
          >
            <option value="" disabled>
              Choose a code session
            </option>
            {codeSessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title ?? s.project} ({s.cwd})
              </option>
            ))}
          </select>
          {codeSessions.length === 0 ? (
            <span className="text-xs text-warn">
              No code session is open. Start or open one under Code first.
            </span>
          ) : null}
        </label>
        <label className="grid gap-1">
          <span>What do you want to know?</span>
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
              {offerClaude
                ? MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))
                : null}
              {shownLocal.length ? (
                <optgroup label={localLabel}>
                  {shownLocal.map((m) => (
                    <option key={m} value={`local:${m}`}>
                      {m}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={comparing}
              onChange={(e) => setComparing(e.target.checked)}
            />
            Compare answers from several models
          </label>
          <button
            className="btn btn-primary"
            disabled={
              busy ||
              !text.trim() ||
              !aboutOpen ||
              nothingAllowed ||
              !compareReady ||
              !licenceReady
            }
          >
            {busy ? "Starting…" : "Ask"}
          </button>
          <span className="text-[13px] text-mut">Ctrl+Enter starts it too.</span>
        </div>
        {localModel && !accepted ? (
          <div
            className="panel grid gap-2 p-3"
            role="group"
            aria-label={`The licence for ${localModel}`}
          >
            <strong className="text-[14px]">Before you use {localModel}: its licence</strong>
            {licence === undefined ? (
              <p className="m-0 text-mut">Reading it from the runtime…</p>
            ) : licence === null ? (
              <p className="m-0 text-mut">
                The runtime shows no licence for this model. Check its terms with whoever chose it
                for you before you use it for work.
              </p>
            ) : (
              <pre className="m-0 max-h-[30vh] overflow-auto whitespace-pre-wrap text-[12px]">
                {licence}
              </pre>
            )}
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => {
                  if (e.target.checked && localModel) acceptLicence(localModel)
                  setAccepted(e.target.checked)
                }}
              />
              I have read the licence and will use the model within it
            </label>
          </div>
        ) : null}
        {comparing ? (
          <fieldset className="m-0 grid gap-1 rounded-md border border-line p-3">
            <legend className="px-1 text-[13px] font-semibold">Compare two to four models</legend>
            {compareChoices.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={compareWith.includes(c.id)}
                  disabled={!compareWith.includes(c.id) && compareWith.length >= 4}
                  onChange={(e) =>
                    setCompareWith((w) =>
                      e.target.checked ? [...w, c.id] : w.filter((x) => x !== c.id),
                    )
                  }
                />
                {c.label}
              </label>
            ))}
            <span className="text-xs text-mut">
              Each gets your message as its own chat, side by side, with what it cost and how long
              it took. Keep the best one and the others close; your choice is recorded. Each one
              uses your plan.
            </span>
          </fieldset>
        ) : null}
        {nothingAllowed ? (
          <p role="alert" className="m-0 text-warn">
            The project {project} allows only models on this computer, and none is ready. Check
            Settings, Other AI providers, or choose another project.
          </p>
        ) : null}
        {busy ? <StartProgress since={startedAt} chat /> : null}
        {shortOfMemory ? (
          <MemoryCard />
        ) : error ? (
          <p role="alert" className="m-0 font-semibold text-sev">
            {error}
          </p>
        ) : null}
      </form>
    </div>
  )
}
