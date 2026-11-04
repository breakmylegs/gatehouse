import { useEffect, useState } from "react"
import { toast } from "sonner"
import type { SessionInfo } from "@gatehouse/shared/ws-protocol"
import { api } from "../lib/api"
import { send, useStore } from "../store"
import { START_WAIT_MS } from "../surfaces/Sessions"

/**
 * B21: when a chat on Claude has to stop (the plan's limit, a spending cap, an error), carry it on with a model you
 * allow whose data boundary is the same or stricter: one on this computer, or a gateway whose provider keeps nothing.
 * Never by itself: you press the button, and the switch is recorded. A model cannot resume another's conversation, so
 * the new chat is given what was said as its start.
 */
type Keeps = "nothing" | "30-days" | "unknown"
interface ProvidersView {
  enabled: boolean
  local?: { kind: "ollama" | "openai-compatible" | "gateway"; keeps?: Keeps }
  check?: { ok: boolean; models?: string[] }
  label?: string
}

/** How much a provider keeps: lower is stricter. Claude through your organisation's account keeps it a while. */
export function boundaryRank(p: { kind: string; keeps?: Keeps } | "claude"): number {
  if (p === "claude") return 2
  if (p.kind !== "gateway") return 0
  return p.keeps === "nothing" ? 1 : p.keeps === "30-days" ? 2 : Number.POSITIVE_INFINITY
}

/** The models a chat may carry on with: ready, allowed by its project, and no looser than Claude. */
export function fallbackModels(view: ProvidersView | undefined, allowsLocal: boolean): string[] {
  if (!view?.enabled || !view.local || !view.check?.ok || !allowsLocal) return []
  if (boundaryRank(view.local) > boundaryRank("claude")) return []
  return view.check.models ?? []
}

/** What was said, newest kept when it is long, as the start of the new chat. */
export function carriedText(sessionId: string, max = 30_000): string {
  const items = useStore.getState().transcripts[sessionId]?.items ?? []
  const lines = items.flatMap((i) =>
    i.kind === "user"
      ? [`You: ${i.text}`]
      : i.kind === "text" && !i.subagent
        ? [`Claude: ${i.text}`]
        : [],
  )
  const all = lines.join("\n\n")
  return all.length > max ? `...\n${all.slice(-max)}` : all
}

export function FallbackButton({ session }: { session: SessionInfo }) {
  const [view, setView] = useState<ProvidersView>()
  const [allowsLocal, setAllowsLocal] = useState(true)
  useEffect(() => {
    void api<ProvidersView>("GET", "/api/providers").then((r) => r.ok && r.data && setView(r.data))
    if (session.chatProject)
      void api<{ project: { providers?: string[] } }>(
        "GET",
        `/api/projects/${encodeURIComponent(session.chatProject)}`,
      ).then((r) => {
        const p = r.ok ? r.data?.project.providers : undefined
        setAllowsLocal(!p || p.includes("local"))
      })
  }, [session.chatProject])
  if (session.kind !== "chat" || session.local) return null
  const models = fallbackModels(view, allowsLocal)
  if (!models.length) return null
  const model = models[0]!
  async function carryOn() {
    const recorded = await send({ type: "fallback_used", from: session.id, model })
    if (!recorded.ok) {
      toast.error(recorded.error?.message ?? "The switch could not be recorded, so it was not made")
      return
    }
    const r = await send(
      {
        type: "create_session",
        cwd: "chat",
        kind: "chat",
        title: `${session.title ?? session.project} (carried on)`,
        mode: "plan",
        localModel: model,
        ...(session.chatProject ? { chatProject: session.chatProject } : {}),
        ...(session.instructions ? { instructions: session.instructions } : {}),
      },
      START_WAIT_MS,
    )
    if (!r.ok) {
      toast.error(r.error?.message ?? "The chat did not start")
      return
    }
    const id = (r.data as { sessionId: string }).sessionId
    const text = `This carries on a conversation with Claude, which had to stop. What was said so far:\n\n${carriedText(session.id)}\n\nPick up from where it stopped.`
    const st = useStore.getState()
    st.addUserText(id, text)
    void send({ type: "prompt", sessionId: id, text })
    st.openBeside(id)
    st.setRoute("workspace")
  }
  return (
    <button type="button" className="btn !min-h-7" onClick={() => void carryOn()}>
      Carry on with {model}
      {view?.label ? ` (${view.label})` : ""}
    </button>
  )
}
