import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { stamp } from "../lib/format"
import { exportPastSession, setSessionMeta } from "../lib/sessionActions"
import { MAIN_ACCOUNT, send, useStore } from "../store"
import { START_WAIT_MS, StartProgress } from "../surfaces/Sessions"
import { Menu } from "./Menu"
import { RenameDialog } from "./RenameDialog"

interface PastSession {
  sessionId: string
  title: string
  cwd?: string
  lastModified: number
  meta: { title?: string; pinned?: boolean; archived?: boolean }
}
interface Found {
  hits: Array<{
    sessionId: string
    title: string
    cwd?: string
    lastModified: number
    snippets: string[]
  }>
  complete: boolean
}

/**
 * Sessions from before JCVC last started, and Claude Code sessions from elsewhere on this computer: resume one
 * where it stopped, fork a copy, rename, pin, archive, export, or search inside what was said.
 */
export function EarlierSessions() {
  const open = useStore((s) => s.sessions)
  const account = useStore((s) => s.activeAccount)
  const [list, setList] = useState<PastSession[]>()
  const [error, setError] = useState<string>()
  const [showArchived, setShowArchived] = useState(false)
  const [query, setQuery] = useState("")
  const [found, setFound] = useState<Found>()
  const [searching, setSearching] = useState(false)
  const [renaming, setRenaming] = useState<PastSession>()
  const [starting, setStarting] = useState<number>()

  const load = useCallback(async () => {
    const r = await send({ type: "list_history" })
    if (r.ok) {
      setList((r.data as PastSession[]) ?? [])
      setError(undefined)
    } else setError(r.error?.message ?? "Earlier sessions could not be read")
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  // Sessions open now are in the table above, not here.
  const openIds = useMemo(
    () =>
      new Set(
        Object.values(open)
          .map((s) => s.sdkSessionId)
          .filter(Boolean),
      ),
    [open],
  )
  const shown = (list ?? [])
    .filter((p) => !openIds.has(p.sessionId) && (showArchived || !p.meta.archived))
    .sort(
      (a, b) =>
        Number(b.meta.pinned === true) - Number(a.meta.pinned === true) ||
        b.lastModified - a.lastModified,
    )

  async function resume(p: { sessionId: string; cwd?: string; title: string }, fork: boolean) {
    if (!p.cwd) return
    setStarting(Date.now())
    const r = await send(
      { type: "create_session", cwd: p.cwd, resume: p.sessionId, ...(fork ? { fork: true } : {}) },
      START_WAIT_MS,
    )
    setStarting(undefined)
    if (!r.ok) {
      toast.error(r.error?.message ?? "It did not start", { id: "session" })
      return
    }
    const s = useStore.getState()
    s.selectSession((r.data as { sessionId: string }).sessionId)
    s.setRoute("workspace")
  }

  async function search(e: React.FormEvent) {
    e.preventDefault()
    if (query.trim().length < 2) return
    setSearching(true)
    const r = await send({ type: "search_history", query: query.trim() }, 60_000)
    setSearching(false)
    if (r.ok) setFound(r.data as Found)
    else toast.error(r.error?.message ?? "The search did not run", { id: "session" })
  }

  const change = async (p: PastSession, c: Parameters<typeof setSessionMeta>[1], said: string) => {
    if (
      await setSessionMeta({ sdkSessionId: p.sessionId, ...(p.cwd ? { cwd: p.cwd } : {}) }, c, said)
    )
      await load()
  }

  // Claude Code keeps each account's past sessions in that account's folder; JCVC lists the main one's so far.
  if (account !== MAIN_ACCOUNT)
    return (
      <section aria-label="Earlier sessions" className="grid gap-1">
        <h2 className="m-0 text-[18px]">Earlier sessions</h2>
        <p className="m-0 text-mut">
          Earlier sessions are listed for the main account only, for now. Show the main account to
          resume one.
        </p>
      </section>
    )
  return (
    <section aria-labelledby="earlier-h" className="grid gap-3">
      <div>
        <h2 id="earlier-h" className="m-0 text-[19px]">
          Earlier sessions
        </h2>
        <p className="m-0 text-mut">
          From before JCVC last started, and from Claude Code elsewhere on this computer. Resume
          carries on where it stopped; Fork starts a copy and leaves the original as it was.
        </p>
      </div>

      <form onSubmit={search} className="flex flex-wrap items-center gap-2" role="search">
        <input
          className="field min-w-[260px] flex-1"
          aria-label="Search inside past conversations"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            if (!e.target.value) setFound(undefined)
          }}
        />
        <button className="btn" disabled={searching || query.trim().length < 2}>
          {searching ? "Searching..." : "Search what was said"}
        </button>
        <label className="flex items-center gap-2 text-[13.5px]">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived
        </label>
      </form>

      {starting ? <StartProgress since={starting} /> : null}

      {found ? (
        <div className="grid gap-1" aria-live="polite">
          <h3 className="m-0 text-[15px]">
            {found.hits.length === 0
              ? `Nothing said matches "${query.trim()}".`
              : `${found.hits.length} session${found.hits.length === 1 ? "" : "s"} mention "${query.trim()}"`}
            {found.complete ? "" : " (the search stopped early; narrow it to find more)"}
          </h3>
          <ul className="m-0 list-none divide-y divide-line border-y border-line p-0">
            {found.hits.map((h) => (
              <li key={h.sessionId} className="grid gap-1 py-2">
                <span className="flex flex-wrap items-baseline gap-2">
                  <strong>{h.title}</strong>
                  <span className="mono text-xs text-mut">{h.cwd}</span>
                  <button
                    type="button"
                    className="btn ml-auto !min-h-7"
                    disabled={!h.cwd || Boolean(starting) || openIds.has(h.sessionId)}
                    onClick={() => void resume(h, false)}
                  >
                    Resume
                  </button>
                </span>
                {h.snippets.map((s, i) => (
                  <span key={i} className="text-[13.5px] text-mut">
                    {s}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="m-0 text-sev">
          {error}
        </p>
      ) : !list ? (
        <p className="m-0 text-mut">Reading earlier sessions…</p>
      ) : shown.length === 0 ? (
        <p className="m-0 text-mut">No earlier sessions.</p>
      ) : (
        <ul
          className="panel m-0 list-none divide-y divide-line overflow-hidden p-0"
          aria-label="Earlier sessions"
        >
          {shown.map((p) => (
            <li key={p.sessionId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <span className="grid min-w-0 flex-1">
                <span className="truncate font-semibold">
                  {p.meta.pinned ? (
                    <span className="sign mr-2 text-[12px] text-mut">Pinned</span>
                  ) : null}
                  {p.title}
                  {p.meta.archived ? (
                    <span className="sign ml-2 text-[12px] text-mut">Archived</span>
                  ) : null}
                </span>
                <span className="mono truncate text-xs text-mut">
                  {p.cwd ?? "Folder not known"}, {stamp(p.lastModified)}
                </span>
              </span>
              <button
                type="button"
                className="btn !min-h-8"
                disabled={!p.cwd || Boolean(starting)}
                onClick={() => void resume(p, false)}
              >
                Resume
              </button>
              <button
                type="button"
                className="btn !min-h-8"
                disabled={!p.cwd || Boolean(starting)}
                onClick={() => void resume(p, true)}
              >
                Fork
              </button>
              <Menu
                label={`More for ${p.title}`}
                className="btn !min-h-8"
                align="end"
                button={<span aria-hidden="true">&middot;&middot;&middot;</span>}
                items={[
                  { label: "Rename...", onSelect: () => setRenaming(p) },
                  {
                    label: p.meta.pinned ? "Unpin" : "Pin to the top",
                    onSelect: () =>
                      void change(
                        p,
                        { pinned: !p.meta.pinned },
                        p.meta.pinned ? "Unpinned." : "Pinned.",
                      ),
                  },
                  { label: "Export as Markdown", onSelect: () => void exportPastSession(p) },
                  {
                    label: p.meta.archived ? "Unarchive" : "Archive",
                    onSelect: () =>
                      void change(
                        p,
                        { archived: !p.meta.archived },
                        p.meta.archived
                          ? "Back in the list."
                          : "Archived. Show archived brings it back.",
                      ),
                  },
                ]}
              />
            </li>
          ))}
        </ul>
      )}
      {renaming ? (
        <RenameDialog
          current={renaming.meta.title ?? renaming.title}
          fallback="the title Claude Code gave it"
          onClose={() => setRenaming(undefined)}
          onSave={(title) =>
            void change(renaming, { title }, title ? `Renamed to ${title}.` : "Title removed.")
          }
        />
      ) : null}
    </section>
  )
}
