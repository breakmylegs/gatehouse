/**
 * T-040 (t3code review, O31): part of Claude's reply quoted into the prompt box, so you can comment on exactly that.
 * The quote is plain text in your message ("> " before each line); nothing new is stored.
 */
const MAX_QUOTE = 4000

/** The selected text as a quote: each line after "> ", at most 4,000 characters. */
export function quoteBlock(selected: string): string {
  let t = selected.replace(/\r\n?/g, "\n").trim()
  if (!t) return ""
  if (t.length > MAX_QUOTE) t = `${t.slice(0, MAX_QUOTE - 1)}…`
  return t
    .split("\n")
    .map((l) => (l.trim() ? `> ${l}` : ">"))
    .join("\n")
}

/** What the prompt box holds after the quote: what you had written, the quote, then a blank line for your comment. */
export function withQuote(current: string, selected: string): string {
  const q = quoteBlock(selected)
  if (!q) return current
  const before = current.trimEnd()
  return `${before ? `${before}\n\n` : ""}${q}\n\n`
}
