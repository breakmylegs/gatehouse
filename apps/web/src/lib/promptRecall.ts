/**
 * T-041 (t3code review, O31): Up in an empty prompt box brings back the prompt you sent before, and Up again the one
 * before that; Down goes forward again, and past the newest gives back what you were writing. Kept in memory for each
 * session only, the newest 50, and never written to disk: a prompt can hold anything.
 */
const MAX = 50
const sent = new Map<string, string[]>()

/** Remembers a prompt you sent in a session (not a /command), newest last; the same prompt twice in a row once. */
export function rememberSent(sessionId: string, text: string): void {
  const t = text.trim()
  if (!t || t.startsWith("/")) return
  const list = sent.get(sessionId) ?? []
  if (list.at(-1) !== t) list.push(t)
  if (list.length > MAX) list.splice(0, list.length - MAX)
  sent.set(sessionId, list)
}

export function sentPrompts(sessionId: string): readonly string[] {
  return sent.get(sessionId) ?? []
}

/** Where the recall is: undefined while you write your own text; otherwise how far back, with your draft kept. */
export interface Recall {
  index: number
  draft: string
}

/**
 * The text and recall after Up or Down, or undefined when the key is not for recall: Up only from an empty box or
 * from a prompt brought back, with the caret at its start; Down only while a prompt is brought back.
 */
export function recallStep(
  sessionId: string,
  key: "ArrowUp" | "ArrowDown",
  text: string,
  caretAtStart: boolean,
  recall: Recall | undefined,
): { text: string; recall: Recall | undefined } | undefined {
  const list = sentPrompts(sessionId)
  if (!list.length) return undefined
  if (key === "ArrowUp") {
    if (recall === undefined) {
      if (text !== "") return undefined
      return { text: list.at(-1)!, recall: { index: list.length - 1, draft: text } }
    }
    if (!caretAtStart) return undefined
    const index = Math.max(0, recall.index - 1)
    return { text: list[index]!, recall: { ...recall, index } }
  }
  if (recall === undefined) return undefined
  const index = recall.index + 1
  if (index >= list.length) return { text: recall.draft, recall: undefined }
  return { text: list[index]!, recall: { ...recall, index } }
}

/** Tests only. */
export function forgetSent(): void {
  sent.clear()
}
