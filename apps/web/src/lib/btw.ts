import { useEffect, useState } from "react"
import { api } from "./api"
import type { Item } from "./transcript"

/**
 * /btw (owner, 4 Nov, for a colleague): a side question about a session, answered from what has been said in it while
 * the session carries on. The answer shows in a card above the prompt box until you put it away; it never joins the
 * conversation, so Claude in the session never sees it.
 */
export interface SideAnswer {
  question: string
  asking: boolean
  answer?: string
  error?: string
}

const answers = new Map<string, SideAnswer>()
const listeners = new Set<() => void>()
const tell = () => listeners.forEach((l) => l())

/** The most of the session sent with a question: its latest lines (the Host keeps to its own limit too). */
const MOST_LINES = 400

/** What was said in the session: your messages and Claude's own words, without subagents' words or tool calls. */
export function sideLines(items: Item[]): Array<{ who: "you" | "claude"; text: string }> {
  const out: Array<{ who: "you" | "claude"; text: string }> = []
  for (const i of items) {
    if (i.kind === "user" && i.text.trim()) out.push({ who: "you", text: i.text.slice(0, 20_000) })
    else if (i.kind === "text" && !i.subagent && i.text.trim())
      out.push({ who: "claude", text: i.text.slice(0, 20_000) })
  }
  return out
}

export async function askSideQuestion(
  sessionId: string,
  question: string,
  items: Item[],
): Promise<void> {
  answers.set(sessionId, { question, asking: true })
  tell()
  const r = await api<{ answer: string }>("POST", "/api/btw", {
    session: sessionId,
    question,
    lines: sideLines(items).slice(-MOST_LINES),
  })
  // Put away, or asked again, meanwhile: this answer is not wanted.
  if (answers.get(sessionId)?.question !== question) return
  answers.set(
    sessionId,
    r.ok && r.data?.answer
      ? { question, asking: false, answer: r.data.answer }
      : { question, asking: false, error: r.error ?? "The side question could not be answered." },
  )
  tell()
}

export function dismissSideAnswer(sessionId: string): void {
  answers.delete(sessionId)
  tell()
}

export function useSideAnswer(sessionId: string): SideAnswer | undefined {
  const [, bump] = useState(0)
  useEffect(() => {
    const l = () => bump((n) => n + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return answers.get(sessionId)
}
