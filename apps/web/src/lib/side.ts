import { toast } from "sonner"
import type { Item } from "./transcript"
import { composeIn } from "./compose"
import { send, useStore } from "../store"

/**
 * T-034 (t3code review, O31): a side session, for something that came up, without disturbing the session you are in.
 * It starts beside it in the same folder, in Plan mode (it reads and plans, and changes no file), never in Extreme
 * approval, through the normal start; every call goes through the Approver as usual. Bring back puts its latest answer
 * in the first session's prompt box for you to read and send, then closes it. Which session it came from is kept in
 * the window's storage.
 */
const KEY = "gatehouse.sides"

function read(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown
    return v && typeof v === "object"
      ? Object.fromEntries(Object.entries(v).filter(([, p]) => typeof p === "string"))
      : {}
  } catch {
    return {}
  }
}

function write(all: Record<string, string>): void {
  try {
    if (Object.keys(all).length) localStorage.setItem(KEY, JSON.stringify(all))
    else localStorage.removeItem(KEY)
  } catch {
    // storage blocked: Bring back lasts until the window closes
  }
}

/** The session a side session came from, if it is one. */
export const sideOf = (sessionId: string): string | undefined => read()[sessionId]

export async function startSide(fromId: string, question: string): Promise<string | undefined> {
  const st = useStore.getState()
  const s = st.sessions[fromId]
  const said = question.trim()
  if (!s || s.kind === "chat" || !said) return undefined
  const r = await send(
    {
      type: "create_session",
      cwd: s.cwd,
      mode: "plan",
      ...(s.model && !s.local ? { model: s.model } : {}),
      ...(s.account ? { account: s.account } : {}),
      title: `Side: ${said.slice(0, 40)}`,
    },
    120_000,
  )
  if (!r.ok) {
    toast.error(r.error?.message ?? "The side session could not start.", { id: "side" })
    return undefined
  }
  const id = (r.data as { sessionId: string }).sessionId
  write({ ...read(), [id]: fromId })
  st.addUserText(id, said)
  void send({ type: "prompt", sessionId: id, text: said })
  st.openBeside(id)
  st.setRoute("workspace")
  return id
}

/** Claude's latest answer in a session: its last reply that was not a subagent's. */
export function latestAnswer(items: readonly Item[]): string | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!
    if (it.kind === "text" && !it.subagent && it.text.trim()) return it.text.trim()
  }
  return undefined
}

export function bringBack(sideId: string): boolean {
  const from = sideOf(sideId)
  const st = useStore.getState()
  if (!from || !st.sessions[from]) {
    toast("The session this came from is not open.", { id: "side" })
    return false
  }
  const answer = latestAnswer(st.transcripts[sideId]?.items ?? [])
  if (!answer) {
    toast("There is no answer to bring back yet.", { id: "side" })
    return false
  }
  composeIn(from, `From a side session:\n\n${answer}\n\n`, { kind: "note", label: "a side session's answer" })
  st.selectSession(from)
  const all = read()
  delete all[sideId]
  write(all)
  void send({ type: "close_session", sessionId: sideId })
  toast("The answer is in the prompt box, for you to read and send.", { id: "side" })
  return true
}
