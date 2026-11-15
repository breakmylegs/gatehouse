import { toast } from "sonner"
import { api } from "./api"
import { accountForNew, send, useStore } from "../store"

/**
 * T-125 (t3code review, O31): starts a chat (Plan mode, its own folder, every check a chat has) to triage Codehouse,
 * has the Host put the redacted log and the Doctor's report in its folder, then asks it to draft an issue.
 */
export async function startTriage(report: string): Promise<string | undefined> {
  const r = await send(
    { type: "create_session", cwd: "chat", kind: "chat", mode: "plan", title: "Triage Codehouse", ...accountForNew() },
    120_000,
  )
  if (!r.ok) {
    toast.error(r.error?.message ?? "The triage chat could not start.", { id: "triage" })
    return undefined
  }
  const id = (r.data as { sessionId: string }).sessionId
  const prep = await api<{ prompt: string }>("POST", "/api/triage/prepare", { session: id, report })
  if (!prep.ok || !prep.data) {
    toast.error(prep.error ?? "The log could not be given to the chat.", { id: "triage" })
    void send({ type: "close_session", sessionId: id })
    return undefined
  }
  const st = useStore.getState()
  st.addUserText(id, prep.data.prompt)
  void send({ type: "prompt", sessionId: id, text: prep.data.prompt })
  st.selectSession(id)
  st.setRoute("workspace")
  return id
}
