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
 * the new chat is given what was said as its start. T-015: you choose the model and how much of the conversation it
 * is given, within a budget in tokens, and the button says what it will carry.
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

/** T-015: how much of the conversation the new model is given, in tokens (about four characters each). */
export const BUDGETS = [
  { tokens: 2_000, label: "Small (about 2,000 tokens)" },
  { tokens: 8_000, label: "Medium (about 8,000 tokens)" },
  { tokens: 25_000, label: "Large (about 25,000 tokens)" },
] as const
const tokensOf = (s: string) => Math.ceil(s.length / 4)

export interface Handoff {
  text: string
  kept: number
  of: number
  tokens: number
}

/**
 * T-015: what was said, within a budget: your first message (what the conversation is for) always, cut if it alone
 * would take more than half, then the newest messages that fit, with how many in between were left out. When not even
 * the newest message fits, its end is kept.
 */
export function handoff(lines: string[], budgetTokens: number): Handoff {
  if (!lines.length) return { text: "", kept: 0, of: 0, tokens: 0 }
  const first = lines[0]!
  const firstCut = tokensOf(first) > budgetTokens / 2 ? `${first.slice(0, budgetTokens * 2)}...` : first
  let room = budgetTokens - tokensOf(firstCut)
  const tail: string[] = []
  for (let i = lines.length - 1; i >= 1 && room > 0; i--) {
    const l = lines[i]!
    if (tokensOf(l) <= room) {
      tail.unshift(l)
      room -= tokensOf(l)
    } else {
      if (!tail.length) tail.unshift(`...${l.slice(-room * 4)}`)
      break
    }
  }
  const left = lines.length - 1 - tail.length
  const parts = [firstCut, ...(left > 0 ? [`[${left} earlier message${left === 1 ? "" : "s"} left out]`] : []), ...tail]
  const text = parts.join("\n\n")
  return { text, kept: 1 + tail.length, of: lines.length, tokens: tokensOf(text) }
}

/** What was said in a session, as lines for a hand-off: yours and Claude's words, not tools or subagents. */
export function saidLines(sessionId: string): string[] {
  const items = useStore.getState().transcripts[sessionId]?.items ?? []
  return items.flatMap((i) => (i.kind === "user" ? [`You: ${i.text}`] : i.kind === "text" && !i.subagent ? [`Claude: ${i.text}`] : []))
}

export function FallbackButton({ session }: { session: SessionInfo }) {
  const [view, setView] = useState<ProvidersView>()
  const [allowsLocal, setAllowsLocal] = useState(true)
  const [chosen, setChosen] = useState<string>()
  const [budget, setBudget] = useState<number>(BUDGETS[1].tokens)
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
  const model = chosen && models.includes(chosen) ? chosen : models[0]!
  const plan = handoff(saidLines(session.id), budget)
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
    const text = `This carries on a conversation with Claude. What was said so far:\n\n${handoff(saidLines(session.id), budget).text}\n\nPick up from where it stopped.`
    const st = useStore.getState()
    st.addUserText(id, text)
    void send({ type: "prompt", sessionId: id, text })
    st.openBeside(id)
    st.setRoute("workspace")
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {models.length > 1 ? (
        <select aria-label="Model to carry on with" className="field !min-h-7" value={model} onChange={(e) => setChosen(e.target.value)}>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      ) : null}
      <select aria-label="How much to carry" className="field !min-h-7" value={budget} onChange={(e) => setBudget(Number(e.target.value))}>
        {BUDGETS.map((b) => (
          <option key={b.tokens} value={b.tokens}>
            {b.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn !min-h-7"
        title={`Carries ${plan.kept} of ${plan.of} messages, about ${plan.tokens.toLocaleString("en-GB")} tokens`}
        onClick={() => void carryOn()}
      >
        Carry on with {model}
        {view?.label ? ` (${view.label})` : ""}
      </button>
    </span>
  )
}
