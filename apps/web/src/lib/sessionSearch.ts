import type { SessionInfo } from "@gatehouse/shared/ws-protocol"
import { prLinks } from "./prLinks"
import type { Item } from "./transcript"

/**
 * T-030 (t3code review): what the palette searches a session by, its title, project, folder, branch and the pull
 * requests it opened; and what was said in the sessions open here, your words and Claude's, from three letters.
 */
export function sessionKeywords(s: SessionInfo, items: readonly Item[] = []): string {
  const prs = prLinks(items).map((p) => `#${p.number} ${p.repo}`)
  return ["session", s.title ?? "", s.project, s.cwd, s.worktree?.branch ?? "", ...prs].filter(Boolean).join(" ")
}

export interface SaidHit {
  sessionId: string
  itemId: string
  who: "you" | "claude"
  snippet: string
}

/** Where the words were said in the open sessions, newest first, at most `max`; a snippet around each. */
export function searchSaid(transcripts: Readonly<Record<string, { items: readonly Item[] } | undefined>>, query: string, max = 20): SaidHit[] {
  const q = query.trim().toLowerCase()
  if (q.length < 3) return []
  const out: SaidHit[] = []
  for (const [sessionId, t] of Object.entries(transcripts)) {
    for (const it of [...(t?.items ?? [])].reverse()) {
      if (it.kind !== "user" && it.kind !== "text") continue
      const at = it.text.toLowerCase().indexOf(q)
      if (at < 0) continue
      const start = Math.max(0, at - 50)
      const end = Math.min(it.text.length, at + q.length + 70)
      out.push({
        sessionId,
        itemId: it.id,
        who: it.kind === "user" ? "you" : "claude",
        snippet: `${start > 0 ? "..." : ""}${it.text.slice(start, end).replace(/\s+/g, " ").trim()}${end < it.text.length ? "..." : ""}`,
      })
      if (out.length >= max) return out
    }
  }
  return out
}
