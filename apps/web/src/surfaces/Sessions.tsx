import { MemoryCard } from "../components/MemoryCard"
import type { SessionInfo } from "@gatehouse/shared/ws-protocol"
import NumberFlow from "@number-flow/react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { cleanName, projectName } from "@gatehouse/shared/project-name"
import { money } from "../lib/format"
import { systemName } from "../lib/platform-mac" // Mac fork
import { useNow } from "../lib/useNow"
import { api } from "../lib/api"
import {
  BYPASS_NOTE,
  EFFORTS,
  MODE_OPTIONS,
  wireOf,
  uiModeOf,
  type EffortId,
  type UiMode,
} from "../lib/modes"
import { accountForNew, send, useSessionList, useStore } from "../store"
import { EarlierSessions } from "../components/EarlierSessions"
import { titleOf } from "../lib/sessionActions"
import { SessionCode } from "../components/SessionCode"
import clsx from "clsx"
import { EmptyState } from "../components/EmptyState"
import { WorktreesPanel } from "../components/WorktreesPanel"

export const MODELS: Array<{ id: string; label: string }> = [
  { id: "", label: "Default model" },
  { id: "claude-opus-5-5", label: "Opus 5.5" },
  { id: "claude-opus-5", label: "Opus 5" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { id: "claude-sonnet-5", label: "Sonnet 5" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
  { id: "claude-fable-5-1", label: "Fable 5.1" },
]

const STATE: Record<SessionInfo["state"], { label: string; shape: string; rank: number }> = {
  waiting: { label: "Waiting on you", shape: "M5 1 9 9H1z", rank: 0 },
  error: { label: "Error", shape: "M1 1l8 8M9 1 1 9", rank: 1 },
  running: { label: "Running", shape: "M2 1l7 4-7 4z", rank: 2 },
  starting: { label: "Starting", shape: "M5 1v4l3 2", rank: 3 },
  idle: { label: "Idle", shape: "M3 1v8M7 1v8", rank: 4 },
  ended: { label: "Ended", shape: "M1 5h8", rank: 5 },
}

function StateMark({ state }: { state: SessionInfo["state"] }) {
  const s = STATE[state]
  const strong = state === "waiting" || state === "error"
  return (
    <span className={`inline-flex items-center gap-1.5 ${strong ? "font-semibold text-sev" : ""}`}>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path
          d={s.shape}
          fill={state === "waiting" || state === "running" ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {s.label}
    </span>
  )
}

function StartButton({ busy, ready, label }: { busy: boolean; ready: boolean; label: string }) {
  return (
    <button className="btn btn-primary" disabled={busy || !ready}>
      {busy ? "Starting…" : label}
    </button>
  )
}

/** How long the screen waits for a session to start. The first start after an install or update is the slow one. */
export const START_WAIT_MS = 180_000

/** What starting a session is doing, with the seconds so far, so a slow start never looks like a hang. */
export function StartProgress({
  since,
  what,
  note,
  chat = false,
}: {
  since: number
  what?: string
  /** Replaces the usual line about the first start being slow. */
  note?: string
  /** A chat is a conversation with Claude, so nothing here says Claude Code (owner, 31 Oct). */
  chat?: boolean
}) {
  const now = useNow(1000)
  const s = Math.max(0, Math.round((now - since) / 1000))
  // What it is doing now, so a wait reads as work: Claude Code first, then the account, then the conversation.
  const step =
    s < 4
      ? chat
        ? "getting ready"
        : "starting Claude Code"
      : s < 10
        ? "checking your account"
        : "reading the conversation back"
  return (
    <div className="activity !mb-0">
      <span className="activity-dot" aria-hidden="true" />
      <span role="status" className="font-semibold">
        {what ?? (chat ? "Starting your chat" : "Starting Claude Code and checking your account")}
        {what ? `: ${step}` : ""}
      </span>
      <span className="tabular-nums text-mut">{s} s</span>
      {s >= 15 ? (
        <span className="basis-full pl-[19px] text-[13px] text-mut">
          {note ??
            (chat
              ? `The first chat after Codehouse is installed or updated can take a minute or more while ${systemName()} checks the program.` // Mac fork: systemName
              : `Starting runs Claude Code itself. The first start after Codehouse is installed or updated can take a minute or more while ${systemName()} checks the program.`)}
        </span>
      ) : null}
    </div>
  )
}

export function Sessions() {
  const sessions = useSessionList()
  const usage = useStore((s) => s.usage)
  const setRoute = useStore((s) => s.setRoute)
  const selectSession = useStore((s) => s.selectSession)
  const openBeside = useStore((s) => s.openBeside)
  const [cwd, setCwd] = useState("")
  const [model, setModel] = useState("")
  const [mode, setMode] = useState<UiMode>("default")
  const [effort, setEffort] = useState<EffortId | "">("")
  const [busy, setBusy] = useState(false)
  const [startedAt, setStartedAt] = useState(0)
  // A new project: what you want to build names its folder, in the projects folder from Settings.
  const [projects, setProjects] = useState<string>()
  const [idea, setIdea] = useState("")
  const [typedName, setTypedName] = useState<string>()
  const [naming, setNaming] = useState(false)
  useEffect(() => {
    void api<{ saved: { projectsFolder?: string } }>("GET", "/api/settings").then((r) => {
      if (r.ok) setProjects(r.data?.saved.projectsFolder ?? "")
    })
  }, [])
  const fresh = !cwd.trim() && Boolean(projects)
  const name = (typedName !== undefined ? cleanName(typedName) : "") || projectName(idea)
  const freshPath = projects ? `${projects.replace(/[\\/]+$/, "")}\\${name}` : ""
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string>()
  // C-004: refused for want of memory; the card explains and offers idle sessions to suspend.
  const [shortOfMemory, setShortOfMemory] = useState(false)
  // D-007: locked tests changed outside Codehouse; accepting them lets the session start.
  const [lockedChanged, setLockedChanged] = useState(false)
  // B10: a session in a new worktree of the folder's repository, from a branch, tag or commit you name.
  const [inWorktree, setInWorktree] = useState(false)
  const [base, setBase] = useState("")
  // G25: best of several runs of one prompt, each in its own worktree, compared side by side.
  const [runs, setRuns] = useState(1)
  const [runPrompt, setRunPrompt] = useState("")
  const several = !fresh && inWorktree && runs > 1

  const sorted = [...sessions].sort(
    (a, b) => STATE[a.state].rank - STATE[b.state].rank || b.createdAt.localeCompare(a.createdAt),
  )

  async function browse() {
    setPicking(true)
    setError(undefined)
    const r = await api<{ path: string | null }>("POST", "/api/pick-folder", { start: cwd.trim() })
    setPicking(false)
    if (!r.ok) setError(r.error ?? "The folder window could not open. Type the folder instead.")
    else if (r.data?.path) setCwd(r.data.path)
  }

  /** G25: the runs, each in a worktree of its own, the same prompt to each, opened side by side to compare. */
  async function startRuns() {
    const ids: string[] = []
    const at = Date.now()
    for (let i = 0; i < runs; i++) {
      const r = await send(
        {
          type: "create_session",
          cwd: cwd.trim(),
          worktree: base.trim() ? { base: base.trim() } : {},
          ...(model ? { model } : {}),
          ...(effort ? { effort } : {}),
          ...wireOf(mode),
          ...accountForNew(),
        },
        START_WAIT_MS,
      )
      if (!r.ok) {
        setBusy(false)
        for (const id of ids) void send({ type: "close_session", sessionId: id })
        setError(
          `Run ${i + 1} did not start, so the others were closed: ${r.error?.message ?? "no reason given"}. Their worktrees are under Worktrees below.`,
        )
        return
      }
      ids.push((r.data as { sessionId: string }).sessionId)
    }
    setBusy(false)
    const s = useStore.getState()
    for (const id of ids) {
      s.addUserText(id, runPrompt.trim())
      void send({ type: "prompt", sessionId: id, text: runPrompt.trim() })
    }
    useStore.setState({ panes: ids, selectedSession: ids[0], compare: { ids, at } })
    toast(`${runs} runs started, each in its own worktree. Keep the best when they are done.`)
    setRunPrompt("")
    setRoute("workspace")
  }

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setStartedAt(Date.now())
    setError(undefined)
    setShortOfMemory(false)
    setLockedChanged(false)
    if (several) return void (await startRuns())
    const r = await send(
      {
        type: "create_session",
        cwd: fresh ? freshPath : cwd.trim(),
        ...(fresh ? { freshFolder: true } : {}),
        ...(!fresh && inWorktree ? { worktree: base.trim() ? { base: base.trim() } : {} } : {}),
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
        ...wireOf(mode),
        ...accountForNew(),
      },
      START_WAIT_MS,
    )
    setBusy(false)
    if (!r.ok) {
      // The Host carries on after the screen stops waiting, so a slow start usually still arrives.
      setError(
        r.error?.code === "timeout"
          ? "This is taking longer than usual. If the session starts it appears in the list below, and you can open it from there."
          : (r.error?.message ?? "The session did not start"),
      )
      setShortOfMemory(r.error?.code === "memory")
      setLockedChanged(r.error?.code === "locked-tests")
      return
    }
    const { sessionId: id, info } = r.data as {
      sessionId: string
      info: { cwd: string; worktree?: { branch: string } }
    }
    if (fresh) {
      // The first prompt goes straight to the new session, as if you had typed it there.
      useStore.getState().addUserText(id, idea.trim())
      void send({ type: "prompt", sessionId: id, text: idea.trim() })
      toast(`Your project is in ${info.cwd}`)
      setIdea("")
      setTypedName(undefined)
    } else
      toast(
        info.worktree
          ? `Session started in a new worktree, on the branch ${info.worktree.branch}`
          : "Session started",
      )
    selectSession(id)
    setRoute("workspace")
  }

  return (
    <div className="mx-auto grid max-w-[1100px] gap-6 p-6">
      <header className="flex items-baseline gap-4">
        <h1 className="m-0">Sessions</h1>
        <span className="text-mut">
          Spend so far: <strong>{money(usage?.total?.costUsd ?? 0)}</strong>
        </span>
      </header>

      <form onSubmit={create} className="panel grid gap-3 p-4" aria-label="Start a session">
        <h2 className="m-0 text-[17px]">Start a session</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid min-w-[240px] flex-[1_1_320px] gap-1">
            <span>Folder</span>
            <input
              className="field mono"
              required={!projects}
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              spellCheck={false}
            />
            {projects ? (
              <span className="text-[12.5px] text-mut">
                Leave it empty for a new project in {projects}.
              </span>
            ) : null}
            <button
              type="button"
              className="w-fit cursor-pointer border-0 bg-transparent p-0 text-left text-[13px] text-acc underline"
              disabled={picking}
              onClick={() => void browse()}
            >
              {picking ? "Waiting for the folder window..." : "Choose a folder..."}
            </button>
          </label>
          <label className="grid w-[170px] grid-cols-[minmax(0,1fr)] gap-1">
            <span>Model</span>
            <select className="field" value={model} onChange={(e) => setModel(e.target.value)}>
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid w-[170px] grid-cols-[minmax(0,1fr)] gap-1">
            <span>Effort</span>
            <select
              className="field"
              value={effort}
              onChange={(e) => setEffort(e.target.value as EffortId | "")}
            >
              <option value="">Model default</option>
              {EFFORTS.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid w-[170px] grid-cols-[minmax(0,1fr)] gap-1">
            <span>Mode</span>
            <select
              className="field"
              value={mode}
              onChange={(e) => setMode(e.target.value as UiMode)}
            >
              {MODE_OPTIONS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          {fresh ? null : (
            <StartButton
              busy={busy}
              ready={Boolean(cwd.trim()) && (!several || Boolean(runPrompt.trim()))}
              label={several ? `Start ${runs} runs` : "Start"}
            />
          )}
        </div>
        {fresh ? (
          <div className="grid gap-2">
            <label className="grid gap-1">
              <span>What do you want to build?</span>
              <textarea
                className="field"
                rows={3}
                required
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
              />
            </label>
            <p className="m-0 flex flex-wrap items-center gap-2 text-[13.5px]">
              Your project goes in <span className="mono">{freshPath}</span>
              {naming ? (
                <input
                  className="field mono w-56"
                  aria-label="Folder name"
                  autoFocus
                  value={typedName ?? name}
                  onChange={(e) => setTypedName(e.target.value)}
                  onBlur={() => setNaming(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      setNaming(false)
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="cursor-pointer border-0 bg-transparent p-0 text-acc underline"
                  onClick={() => setNaming(true)}
                >
                  Change the name
                </button>
              )}
            </p>
            {/* After what you want to build, so the form reads top to bottom. */}
            <div>
              <StartButton busy={busy} ready={Boolean(idea.trim())} label="Start the project" />
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3 text-[14px]">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={inWorktree}
                onChange={(e) => setInWorktree(e.target.checked)}
              />
              Work in a new worktree (a separate checkout beside the repository, on a branch of its
              own)
            </label>
            {inWorktree ? (
              <label className="flex items-center gap-2">
                From
                <input
                  className="field mono w-48"
                  value={base}
                  placeholder="the current commit"
                  spellCheck={false}
                  onChange={(e) => setBase(e.target.value)}
                />
              </label>
            ) : null}
            {inWorktree ? (
              <label className="flex items-center gap-2">
                Runs
                <select
                  className="field w-20"
                  value={runs}
                  onChange={(e) => setRuns(Number(e.target.value))}
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {several ? (
              <label className="grid w-full gap-1">
                <span>
                  What every run is asked to do (each works in its own worktree; compare them and
                  keep the best)
                </span>
                <textarea
                  className="field"
                  rows={3}
                  required
                  value={runPrompt}
                  onChange={(e) => setRunPrompt(e.target.value)}
                />
              </label>
            ) : null}
          </div>
        )}
        {fresh ? null : projects === undefined ? null : !projects && !cwd.trim() ? (
          <p className="m-0 text-[13.5px] text-mut">
            Tip: choose where new projects go in Settings, and you can start one from what you want
            to build, without choosing a folder.
          </p>
        ) : null}
        <p className="m-0 text-xs text-mut">
          {MODE_OPTIONS.find((m) => m.id === mode)?.help}. The floor and the audit apply in every
          mode. {BYPASS_NOTE} A missing folder is created.
        </p>
        {busy ? <StartProgress since={startedAt} /> : null}
        {shortOfMemory ? (
          <MemoryCard />
        ) : lockedChanged && error ? (
          <div role="alert" className="grid gap-2 rounded-md border border-warn bg-s1 p-3 text-[14px]">
            <strong>Not started: locked tests changed</strong>
            <p className="m-0">{error}</p>
            <div>
              <button
                type="button"
                className="btn btn-primary !min-h-7"
                onClick={() =>
                  void send({ type: "locks_accept", cwd: fresh ? freshPath : cwd.trim() }).then((r) => {
                    if (!r.ok) return void toast.error(r.error?.message ?? "They could not be accepted")
                    setLockedChanged(false)
                    setError(undefined)
                    toast("Locked tests accepted as they now are. Start the session again.")
                  })
                }
              >
                Accept them as they now are
              </button>
            </div>
          </div>
        ) : error ? (
          <p role="alert" className="m-0 font-semibold text-sev">
            {error}
          </p>
        ) : null}
      </form>

      <WorktreesPanel />

      {sorted.length === 0 ? (
        <EmptyState picture="empty-sessions">
          <p className="m-0 text-mut">No sessions yet. Start one above.</p>
        </EmptyState>
      ) : (
        <table className="panel w-full border-separate border-spacing-0 overflow-hidden text-left">
          <caption className="sr-only">Sessions, those waiting on you first</caption>
          <thead>
            <tr className="sign border-b border-line text-[12.5px] font-medium text-mut">
              <th className="py-2 pl-3 pr-3 font-medium">Code</th>
              <th className="py-2 pr-3 font-medium">State</th>
              <th className="py-2 pr-3 font-medium">Project</th>
              <th className="py-2 pr-3 font-medium">Model</th>
              <th className="py-2 pr-3 font-medium">Mode</th>
              <th className="py-2 pr-3 text-right font-medium">Waiting</th>
              <th className="py-2 font-medium">
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr
                key={s.id}
                className={clsx("border-b border-line", s.state === "waiting" && "bg-lit")}
              >
                <td className="py-2.5 pl-3 pr-3 align-top">
                  <SessionCode session={s} className="!text-[15px]" />
                </td>
                <td className="sign py-2.5 pr-3 align-top text-[14px] font-medium">
                  <StateMark state={s.state} />
                </td>
                <td className="py-2.5 pr-3 align-top">
                  <span className="sign block text-[15px] font-semibold">{titleOf(s)}</span>
                  <span className="mono block text-xs text-mut [overflow-wrap:anywhere]">
                    {s.cwd}
                  </span>
                  {s.error ? <span className="block text-xs text-sev">{s.error}</span> : null}
                </td>
                <td className="sign py-2.5 pr-3 align-top">
                  {MODELS.find((m) => m.id === s.model)?.label ?? s.model ?? "Default"}
                  {s.effort ? (
                    <span className="block text-[12.5px] text-mut">
                      {EFFORTS.find((x) => x.id === s.effort)?.label ?? s.effort} effort
                    </span>
                  ) : null}
                </td>
                <td className="sign py-2.5 pr-3 align-top">
                  {MODE_OPTIONS.find((m) => m.id === uiModeOf(s))?.label}
                </td>
                <td className="sign py-2.5 pr-3 text-right align-top text-[15px] font-semibold">
                  <NumberFlow value={s.pendingApprovals} />
                </td>
                <td className="py-2 pr-3 text-right align-top">
                  <button
                    className="btn"
                    onClick={() => {
                      selectSession(s.id)
                      setRoute("workspace")
                    }}
                  >
                    Open
                  </button>
                  <button
                    className="btn ml-2"
                    aria-label={`Open ${s.project} beside the sessions already open`}
                    onClick={() => {
                      openBeside(s.id)
                      setRoute("workspace")
                    }}
                  >
                    Beside
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <EarlierSessions />
      <p className="m-0 text-mut">
        What sessions spent, by day, project, model and session, is on{" "}
        <button
          type="button"
          className="cursor-pointer border-0 bg-transparent p-0 text-acc underline"
          onClick={() => useStore.getState().setRoute("usage")}
        >
          Usage
        </button>
        .
      </p>
    </div>
  )
}
