import type { SessionInfo } from "@gatehouse/shared/ws-protocol"
import { toast } from "sonner"
import { send, useStore } from "../store"
import { copyText } from "./copy"
import { toMarkdown } from "./exportMarkdown"

/** The name a session is shown by: your title, or its project. */
export const titleOf = (s: Pick<SessionInfo, "title" | "project">): string => s.title ?? s.project

/**
 * Sets your title, pin or archive on a session, by its Claude Code id, and says so. A session that has not told
 * Codehouse its id yet (it is still starting) cannot be changed.
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

/**
 * Archives every ended session at once, with one message. One that never told Codehouse its Claude Code id (it ended
 * while starting) has nothing to archive and stays; the count says how many were archived.
 */
export async function archiveEnded(list: SessionInfo[]): Promise<number> {
  const ended = list.filter((s) => s.state === "ended" && !s.archived && s.sdkSessionId)
  const done = await Promise.all(
    ended.map((s) =>
      send({
        type: "session_meta",
        sdkSessionId: s.sdkSessionId!,
        archived: true,
        cwd: s.cwd,
      }).then((r) => r.ok),
    ),
  )
  const n = done.filter(Boolean).length
  if (n < ended.length) toast.error(`${ended.length - n} could not be archived.`, { id: "session" })
  else
    toast(
      n === 1
        ? "Archived 1 ended session. Earlier sessions on Sessions can show it."
        : `Archived ${n} ended sessions. Earlier sessions on Sessions can show them.`,
      { id: "session" },
    )
  return n
}

/** Copies an open session's whole conversation as Markdown, as Export would save it. */
export async function copyConversation(s: SessionInfo): Promise<void> {
  const items = useStore.getState().transcripts[s.id]?.items ?? []
  const ok = await copyText(toMarkdown(items, { title: titleOf(s), cwd: s.cwd, at: Date.now() }))
  if (ok) toast(`Copied the conversation in ${titleOf(s)}.`, { id: "session" })
  else toast.error("The conversation could not be copied.", { id: "session" })
}

/** The last code block in what Claude said, newest first: the code inside the last fenced block. */
export function lastCodeBlock(texts: string[]): string | undefined {
  for (let i = texts.length - 1; i >= 0; i--) {
    const blocks = [
      ...(texts[i] ?? "").matchAll(/^ {0,3}(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^ {0,3}\1[ \t]*$/gm),
    ]
    const last = blocks.at(-1)?.[2]
    if (last !== undefined) return last.replace(/\n$/, "")
  }
  return undefined
}

/**
 * Ctrl+Shift+C copies Claude's last reply in the session on screen, and Ctrl+Shift+; its last code block, as in the
 * ChatGPT app (owner, 1 Nov).
 */
export async function copyLatest(what: "reply" | "code"): Promise<void> {
  const st = useStore.getState()
  const id = st.route === "workspace" ? st.selectedSession : undefined
  const texts = (id ? (st.transcripts[id]?.items ?? []) : [])
    .filter((i) => i.kind === "text" && !i.subagent)
    .map((i) => (i as { text: string }).text)
  const text = what === "reply" ? texts.at(-1) : lastCodeBlock(texts)
  if (text === undefined) {
    toast(
      what === "reply" ? "Claude has not replied here yet." : "There is no code block here yet.",
      {
        id: "copy",
      },
    )
    return
  }
  const ok = await copyText(text)
  if (ok)
    toast(what === "reply" ? "Copied Claude's last reply." : "Copied the last code block.", {
      id: "copy",
    })
  else toast.error("That could not be copied.", { id: "copy" })
}
