import type { SessionInfo } from "@gatehouse/shared/ws-protocol"
import { sessionCode } from "./codes"

/**
 * T-049 (t3code review, O31): another session as context. You write @session(GT 407), or choose it from the + menu;
 * what Claude is sent names it with its title and the mark [[session:id]], which lets the session's
 * read_linked_session tool read it, redacted and as untrusted. Only your own message can name one.
 */
const MENTION = /@session\(\s*([A-Za-z]{2,3})\s*(\d{3})\s*\)/g

export function linkSessions(
  text: string,
  sessions: readonly Pick<SessionInfo, "id" | "project" | "title" | "state">[],
  self: string,
): string {
  return text.replace(MENTION, (whole, l: string, d: string) => {
    const code = `${l.toUpperCase()} ${d}`
    const s = sessions.find((x) => x.id !== self && x.state !== "ended" && sessionCode(x) === code)
    return s ? `the session "${s.title ?? s.project}" (${code}) [[session:${s.id}]]` : whole
  })
}

/** How the + menu writes one into the prompt box. */
export const mentionOf = (s: Pick<SessionInfo, "id" | "project">): string => `@session(${sessionCode(s)}) `
