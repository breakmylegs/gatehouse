/** What a session's prompt box listens for, to be given text to change and send (it never sends by itself). */
export const COMPOSE_EVENT = "codeh:compose"

/**
 * Puts text in a session's prompt box, below anything already typed there: Edit on a message you sent, and Ask about
 * this output in the terminal (backlog F22). You read it, add to it and send it yourself.
 */
export function composeIn(sessionId: string, text: string): void {
  window.dispatchEvent(new CustomEvent(COMPOSE_EVENT, { detail: { sessionId, text } }))
}

/** Terminal output quoted for a question: the selection, or the last command and what it printed. */
export function quoteOutput(output: string, max = 8000): string {
  const text = output.replace(/\s+$/, "")
  const cut =
    text.length > max ? `[the start was left out]\n${text.slice(text.length - max)}` : text
  const fence = cut.includes("```") ? "````" : "```"
  return `About this from my terminal:\n\n${fence}text\n${cut}\n${fence}\n\n`
}
