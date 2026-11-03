import { toast } from "sonner"
import type { SessionInfo } from "@gatehouse/shared/ws-protocol"
import { send, useStore } from "../store"

const START_WAIT_MS = 120_000

/** What a fork or a hand-off keeps from the session it comes from: its mode, approval, model, effort and account. */
function inherited(s: SessionInfo) {
  return {
    mode: s.mode,
    ...(s.extreme ? { extreme: true } : {}),
    ...(s.model && !s.local ? { model: s.model } : {}),
    ...(s.effort ? { effort: s.effort } : {}),
    ...(s.account ? { account: s.account } : {}),
  }
}

const busy = (s: SessionInfo) =>
  s.state === "running" || s.state === "waiting" || s.state === "starting"

/** A session can be forked once Claude Code has a conversation for it, it is not on a local model, and it is still. */
export const canFork = (s: SessionInfo): boolean =>
  Boolean(s.sdkSessionId) && !s.local && !busy(s) && s.state !== "error"

/**
 * Fork (B13): a copy of the conversation that carries on separately, beside the original, in the same folder (the
 * SDK's resume with forkSession). It keeps the original's mode, approval, model, effort and account: never looser.
 */
export async function forkSession(sessionId: string): Promise<string | undefined> {
  const st = useStore.getState()
  const s = st.sessions[sessionId]
  if (!s?.sdkSessionId) return undefined
  if (busy(s)) {
    toast("Claude is still working here. Fork it once it has finished, or stop it first.", {
      id: "fork",
    })
    return undefined
  }
  const r = await send(
    {
      type: "create_session",
      cwd: s.cwd,
      ...(s.kind ? { kind: s.kind } : {}),
      ...inherited(s),
      ...(s.chatProject ? { chatProject: s.chatProject } : {}),
      ...(s.research ? { research: true } : {}),
      resume: s.sdkSessionId,
      fork: true,
    },
    START_WAIT_MS,
  )
  if (!r.ok) {
    toast.error(r.error?.message ?? "It could not be forked.", { id: "fork" })
    return undefined
  }
  const id = (r.data as { sessionId: string }).sessionId
  st.openBeside(id)
  st.setRoute("workspace")
  toast("Forked: the copy is beside the original, and each carries on on its own.", { id: "fork" })
  return id
}

/**
 * Hand off a side task (B13): a new coding session for something that came up, told what to do and where it came
 * from, in a new worktree of the repository if you like, so it never touches the files of the session you are in. It
 * keeps the original's mode, approval, model, effort and account.
 */
export async function handOff(
  sessionId: string,
  task: string,
  o: { worktree: boolean },
): Promise<string | undefined> {
  const st = useStore.getState()
  const s = st.sessions[sessionId]
  const said = task.trim()
  if (!s || s.kind === "chat" || !said) return undefined
  const r = await send(
    {
      type: "create_session",
      cwd: s.worktree?.repo ?? s.cwd,
      ...inherited(s),
      ...(o.worktree ? { worktree: {} } : {}),
    },
    START_WAIT_MS,
  )
  if (!r.ok) {
    toast.error(r.error?.message ?? "The side task could not start.", { id: "fork" })
    return undefined
  }
  const id = (r.data as { sessionId: string }).sessionId
  const text = `${said}\n\n(Handed off from the session "${s.title ?? s.project}", which works in ${s.cwd}.)`
  st.addUserText(id, text)
  void send({ type: "prompt", sessionId: id, text })
  st.openBeside(id)
  st.setRoute("workspace")
  toast(
    o.worktree
      ? "The side task started in a new worktree, beside this session."
      : "The side task started beside this session.",
    { id: "fork" },
  )
  return id
}
