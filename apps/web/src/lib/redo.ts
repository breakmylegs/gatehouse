import { toast } from "sonner"
import { chatName } from "./chatName"
import { send, useStore } from "../store"
import { api } from "./api"

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
      // A chat keeps both versions as branches of one conversation (CH-03): the Host records which this replaces.
      ...(chat ? { replaces: sessionId } : {}),
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
  toast(
    chat
      ? "Carried on from that point. Use the arrows on the message to go back to the earlier version."
      : "Carried on from that point. The earlier version is under Earlier sessions.",
    { id: "redo" },
  )
  return true
}

/**
 * Shows another version of a chat message (CH-03, the "2 of 3" arrows): the Host moves the chat to that branch and
 * says which conversation it ends in, and that conversation is opened in this pane in place of the one shown.
 */
export async function switchBranch(sessionId: string, messageId: string): Promise<boolean> {
  const st = useStore.getState()
  const s = st.sessions[sessionId]
  if (!s) return false
  if (s.state === "running" || s.state === "waiting" || s.state === "starting") {
    toast("Claude is still working here. Stop it first, or wait for it to finish.", { id: "redo" })
    return false
  }
  const to = await api<{ sdkSessionId: string }>("POST", "/api/chat/switch", {
    session: sessionId,
    messageId,
  })
  if (!to.ok || !to.data) {
    toast.error(to.error ?? "That version could not be shown.", { id: "redo" })
    return false
  }
  if (to.data.sdkSessionId === s.sdkSessionId) return true
  const r = await send(
    {
      type: "create_session",
      cwd: s.cwd,
      kind: "chat",
      mode: s.mode,
      ...(s.local && s.model ? { localModel: s.model } : s.model ? { model: s.model } : {}),
      ...(s.chatProject ? { chatProject: s.chatProject } : {}),
      ...(s.research ? { research: true } : {}),
      ...(s.account ? { account: s.account } : {}),
      ...(s.title ? { title: s.title } : {}),
      resume: to.data.sdkSessionId,
      replaces: sessionId,
    },
    START_WAIT_MS,
  )
  if (!r.ok) {
    toast.error(r.error?.message ?? "That version could not be opened.", { id: "redo" })
    return false
  }
  const id = (r.data as { sessionId: string }).sessionId
  const at = st.panes.indexOf(sessionId)
  if (at >= 0) st.setPane(at, id)
  else st.selectSession(id)
  void send({ type: "close_session", sessionId })
  return true
}
