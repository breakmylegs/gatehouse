import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { send, useStore } from "../store"

/**
 * T-004: what the welcome found on this computer: the coding agents installed (shown only; Codehouse runs Claude
 * through its own copy), the model runtimes answering here (for chats, in Settings), and the projects of your recent
 * Claude Code conversations, to open again or carry on. Nothing is imported or changed until you choose.
 */
interface Found {
  agents: Array<{ id: string; name: string; where?: string }>
  runtimes: Array<{ kind: string; name: string; url: string; up: boolean }>
}
interface Past {
  sessionId: string
  title: string
  cwd?: string
  lastModified: number
  meta: { archived?: boolean }
}
export interface RecentProject {
  cwd: string
  name: string
  sessions: number
  lastUsed: number
  latest: { sessionId: string; title: string }
}

/** The projects of recent conversations, newest first, each with its latest conversation (archived ones left out). */
export function recentProjects(past: Past[], max = 6): RecentProject[] {
  const by = new Map<string, RecentProject>()
  for (const s of past) {
    if (!s.cwd || s.meta.archived) continue
    const key = s.cwd.replace(/[\\/]+$/, "").toLowerCase()
    const name = s.cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? s.cwd
    const p = by.get(key)
    if (!p) by.set(key, { cwd: s.cwd, name, sessions: 1, lastUsed: s.lastModified, latest: { sessionId: s.sessionId, title: s.title } })
    else {
      p.sessions++
      if (s.lastModified > p.lastUsed) Object.assign(p, { lastUsed: s.lastModified, latest: { sessionId: s.sessionId, title: s.title } })
    }
  }
  return [...by.values()].sort((a, b) => b.lastUsed - a.lastUsed).slice(0, max)
}

const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" })

export function WelcomeFound({ onLeave }: { onLeave: () => void }) {
  const [found, setFound] = useState<Found>()
  const [past, setPast] = useState<Past[]>()
  const [busy, setBusy] = useState<string>()
  useEffect(() => {
    void api<Found>("GET", "/api/welcome/found").then((r) => r.ok && r.data && setFound(r.data))
    void send({ type: "list_history" }).then((r) => r.ok && Array.isArray(r.data) && setPast(r.data as Past[]))
  }, [])
  const projects = useMemo(() => recentProjects(past ?? []), [past])
  const agents = found?.agents.filter((a) => a.where) ?? []
  const runtimes = found?.runtimes.filter((r) => r.up) ?? []

  const carryOn = async (p: RecentProject) => {
    setBusy(p.cwd)
    const r = await send({ type: "create_session", cwd: p.cwd, resume: p.latest.sessionId }, 120_000)
    setBusy(undefined)
    if (!r.ok) return void toast.error(r.error?.message ?? "It did not start", { id: "session" })
    onLeave()
    const s = useStore.getState()
    s.selectSession((r.data as { sessionId: string }).sessionId)
    s.setRoute("workspace")
  }
  const open = (p: RecentProject) => {
    onLeave()
    useStore.getState().openFolder(p.cwd)
  }

  return (
    <section aria-label="Found on this computer" className="grid gap-3">
      <div className="grid gap-1">
        <h2 className="m-0 text-[15px]">Found on this computer</h2>
        {found ? (
          <ul className="m-0 grid list-none gap-0.5 p-0 text-[13px]">
            {agents.length ? (
              agents.map((a) => (
                <li key={a.id}>
                  <span className="font-semibold">{a.name}</span> <span className="mono text-mut">{a.where}</span>
                </li>
              ))
            ) : (
              <li className="text-mut">No other coding agent is on the PATH.</li>
            )}
            {runtimes.map((r) => (
              <li key={r.url}>
                <span className="font-semibold">{r.name}</span> is answering at <span className="mono">{r.url}</span>; you can chat with its models from Settings, Other AI providers.
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-[13px] text-mut">Looking...</p>
        )}
        <p className="m-0 text-xs text-mut">Codehouse runs Claude through its own copy of Claude Code, whatever else is installed.</p>
      </div>
      {projects.length ? (
        <div className="grid gap-1">
          <h2 className="m-0 text-[15px]">Pick up where you left off</h2>
          <ul className="m-0 grid list-none gap-1 p-0 text-[13px]">
            {projects.map((p) => (
              <li key={p.cwd} className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{p.name}</span>
                <span className="text-mut">
                  {p.sessions} conversation{p.sessions === 1 ? "" : "s"}, last on {day(p.lastUsed)}: {p.latest.title}
                </span>
                <button type="button" className="btn !min-h-7" onClick={() => open(p)}>
                  Open
                </button>
                <button type="button" className="btn !min-h-7" disabled={busy === p.cwd} onClick={() => void carryOn(p)}>
                  {busy === p.cwd ? "Starting..." : "Carry on"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
