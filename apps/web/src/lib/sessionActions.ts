import type { SessionInfo } from "@gatehouse/shared/ws-protocol"
import { toast } from "sonner"
import { send, useStore } from "../store"
import { download, exportName, toMarkdown } from "./exportMarkdown"
import { emptyTranscript, reduce } from "./transcript"

/** The name a session is shown by: your title, or its project. */
export const titleOf = (s: Pick<SessionInfo, "title" | "project">): string => s.title ?? s.project

/**
 * Sets your title, pin or archive on a session, by its Claude Code id, and says so. A session that has not told
 * JCVC its id yet (it is still starting) cannot be changed.
 */
export async function setSessionMeta(
  s: { sdkSessionId?: string; cwd?: string },
  change: { title?: string | null; pinned?: boolean; archived?: boolean },
  said: string,
): Promise<boolean> {
  if (!s.sdkSessionId) {
    toast.error("This session is still starting. Try again in a moment.", { id: "session" })
    return false
  }
  const r = await send({
    type: "session_meta",
    sdkSessionId: s.sdkSessionId,
    ...change,
    ...(s.cwd ? { cwd: s.cwd } : {}),
  })
  if (!r.ok) {
    toast.error(r.error?.message ?? "That did not change", { id: "session" })
    return false
  }
  toast(said, { id: "session" })
  return true
}

/** Archives an open session: it stops, and leaves the sidebar. Earlier sessions on Sessions can show it again. */
export async function archiveSession(s: SessionInfo): Promise<void> {
  if (s.state !== "ended" && s.state !== "error")
    await send({ type: "close_session", sessionId: s.id })
  await setSessionMeta(
    s,
    { archived: true },
    `Archived ${titleOf(s)}. Earlier sessions on Sessions can show it.`,
  )
}

/** Downloads an open session's conversation as Markdown. */
export function exportOpenSession(s: SessionInfo): void {
  const items = useStore.getState().transcripts[s.id]?.items ?? []
  const now = Date.now()
  download(
    exportName(titleOf(s), now),
    toMarkdown(items, { title: titleOf(s), cwd: s.cwd, at: now }),
  )
  toast(`Saved ${exportName(titleOf(s), now)} in your Downloads folder.`, { id: "session" })
}

/** Downloads a past session's conversation as Markdown, read from its transcript through the Host. */
export async function exportPastSession(p: {
  sessionId: string
  title: string
  cwd?: string
}): Promise<void> {
  const r = await send({
    type: "history_messages",
    sdkSessionId: p.sessionId,
    ...(p.cwd ? { cwd: p.cwd } : {}),
  })
  if (!r.ok) {
    toast.error(r.error?.message ?? "The conversation could not be read", { id: "session" })
    return
  }
  let t = emptyTranscript()
  for (const m of (r.data as unknown[]) ?? []) t = reduce(t, m)
  const now = Date.now()
  // Past messages carry no arrival time JCVC saw, so the export leaves times out.
  const items = t.items.map(({ at: _at, ...rest }) => rest)
  download(
    exportName(p.title, now),
    toMarkdown(items as typeof t.items, { title: p.title, cwd: p.cwd, at: now }),
  )
  toast(`Saved ${exportName(p.title, now)} in your Downloads folder.`, { id: "session" })
}
