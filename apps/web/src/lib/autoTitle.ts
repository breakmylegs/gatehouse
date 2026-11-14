import { useEffect } from "react"
import type { SessionInfo } from "@gatehouse/shared/ws-protocol"
import { api } from "./api"
import type { Item } from "./transcript"
import { send, useStore } from "../store"

/**
 * T-018 and T-019 (t3code review, O31): a session you have not named is named by Claude once its first turn ends, from
 * what you first said and what Claude first replied. The Host does the asking (no tools, redacted, recorded, only
 * when the account passed the organisation check). A title you gave yourself is never replaced.
 */
const KEY = "gatehouse.autoTitled"

/** The first exchange: your first message and Claude's first reply, words only. */
export function firstExchange(items: readonly Item[]): Array<{ who: "you" | "claude"; text: string }> {
  const you = items.find((i) => i.kind === "user" && i.text.trim())
  const claude = items.find((i) => i.kind === "text" && !i.subagent && i.text.trim())
  return [
    ...(you?.kind === "user" ? [{ who: "you" as const, text: you.text.slice(0, 4000) }] : []),
    ...(claude?.kind === "text" ? [{ who: "claude" as const, text: claude.text.slice(0, 4000) }] : []),
  ]
}

function asked(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(-500) : [])
  } catch {
    return new Set()
  }
}

function remember(conversation: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...asked(), conversation].slice(-500)))
  } catch {
    // storage blocked: it may be named again after a reload, which changes nothing you chose
  }
}

/** Asks the Host for a title and gives it to the session. `again` is Name it again (T-019), even for a named one. */
export async function nameSession(s: SessionInfo, items: readonly Item[], again = false): Promise<string | undefined> {
  if (!s.sdkSessionId || (!again && s.title)) return undefined
  const lines = firstExchange(items)
  if (!lines.some((l) => l.who === "you")) return undefined
  remember(s.sdkSessionId)
  const r = await api<{ title?: string; skipped?: string }>("POST", "/api/title", { session: s.id, lines })
  const title = r.ok ? r.data?.title : undefined
  if (!title) return undefined
  // Named meanwhile by you: yours stays.
  if (!again && useStore.getState().sessions[s.id]?.title) return undefined
  const done = await send({ type: "session_meta", sdkSessionId: s.sdkSessionId, title, cwd: s.cwd })
  return done.ok ? title : undefined
}

/** Watches for a first turn that has ended in a session with no title, and names it once. */
export function useAutoTitles(): void {
  const sessions = useStore((st) => st.sessions)
  useEffect(() => {
    const done = asked()
    for (const s of Object.values(sessions)) {
      if (s.title || !s.sdkSessionId || s.state !== "idle" || done.has(s.sdkSessionId)) continue
      const items = useStore.getState().transcripts[s.id]?.items ?? []
      if (!items.some((i) => i.kind === "result")) continue
      void nameSession(s, items)
    }
  }, [sessions])
}
