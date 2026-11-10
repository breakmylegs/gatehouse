/**
 * Comments on a session's changes, gathered across files in the Changes pane and sent as one message (backlog G13):
 * they go into the prompt box, where you read them and send them yourself.
 */
export interface ReviewComment {
  path: string
  /** Where the change is, in words ("lines 4 to 6"). */
  where: string
  /** The change's text now, quoted so Claude knows which lines are meant. */
  quote: string
  text: string
}

/** A key for one change's comment: its file and where it starts. */
export const commentKey = (path: string, start: number) => `${path}\n${start}`

const MAX_QUOTE = 12

/** The message the comments make, in file order, each with the lines it is about. */
export function reviewMessage(comments: readonly ReviewComment[]): string {
  const list = comments.filter((c) => c.text.trim())
  if (!list.length) return ""
  const parts = [...list]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((c) => {
      const q = c.quote.split("\n")
      const shown = q.length > MAX_QUOTE ? [...q.slice(0, MAX_QUOTE), "..."] : q
      const fence = c.quote.includes("```") ? "````" : "```"
      return `${c.path}, ${c.where}:\n${fence}\n${shown.join("\n")}\n${fence}\n${c.text.trim()}`
    })
  return `My comments on your changes. Please deal with each one:\n\n${parts.join("\n\n")}\n`
}
