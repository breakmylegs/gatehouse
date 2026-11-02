import { toast } from "sonner"
import { chatName } from "./chatName"
import { send, useStore } from "../store"

/** How long starting the fork may take before it gives up waiting. */
const START_WAIT_MS = 120_000

/**
 * Retry and Edit (owner, 2 Nov: the everyday features of the Claude and ChatGPT apps): the conversation carries on from
 * just before one of your messages, with that message (Retry) or a changed one (Edit). It is a fork of the conversation
 * (the SDK's resume, forkSession and resumeSessionAt), so the version left behind stays under Earlier sessions; it
 * replaces the session in its pane. The first message starts a new conversation with the words. Files a coding
 * session changed after that point stay changed.
 */
export async function carryOnFrom(
  sessionId: string,
  point: { before?: string; first?: boolean },
  text: string,
): Promise<boolean> {
  const st = useStore.getState()
  const s = st.sessions[sessionId]
  if (!s) return false
  if (s.state === "running" || s.state === "waiting" || s.state === "starting") {
    toast("Claude is still working here. Stop it first, or wait for it to finish.", { id: "redo" })
    return false
  }
  const fork =
    point.before && s.sdkSessionId
      ? { resume: s.sdkSessionId, fork: true, resumeAt: point.before }
      : undefined
  if (!fork && !point.first) return false
  const chat = s.kind === "chat"
  const r = await send(
    {
      type: "create_session",
      cwd: chat && !fork ? "chat" : s.cwd,
      ...(s.kind ? { kind: s.kind } : {}),
      mode: s.mode,
      ...(s.local && s.model ? { localModel: s.model } : s.model ? { model: s.model } : {}),
      ...(s.chatProject ? { chatProject: s.chatProject } : {}),
      ...(s.research ? { research: true } : {}),
      ...(s.account ? { account: s.account } : {}),
      title: chatName(text),
      ...(fork ?? {}),
    },
    START_WAIT_MS,
  )
  if (!r.ok) {
    toast.error(r.error?.message ?? "It could not start again from there.", { id: "redo" })
    return false
  }
  const id = (r.data as { sessionId: string }).sessionId
  const at = st.panes.indexOf(sessionId)
  if (at >= 0) st.setPane(at, id)
  else st.selectSession(id)
  st.addUserText(id, text)
  void send({ type: "prompt", sessionId: id, text })
  void send({ type: "close_session", sessionId })
  toast("Carried on from that point. The earlier version is under Earlier sessions.", {
    id: "redo",
  })
  return true
}
