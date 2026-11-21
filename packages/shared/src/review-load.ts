/**
 * D-089, the review load meter (Frontier build, Wave 4): about how long a change takes a person to review, from its
 * lines, its files and its risk. Read at about five changed lines a minute (300 an hour, a common pace for careful
 * review), a minute for each file to find your bearings, half as long again for High risk and twice as long for
 * Severe. Shared by the Host, which adds up the last hour's changes, and the desktop, which shows each pending one.
 */
export const LINES_PER_MINUTE = 5

export function reviewMinutes(o: { lines: number; files: number; risk?: number }): number {
  if (o.lines <= 0 && o.files <= 0) return 0
  const base = o.lines / LINES_PER_MINUTE + o.files
  const factor = (o.risk ?? 0) >= 85 ? 2 : (o.risk ?? 0) >= 70 ? 1.5 : 1
  return Math.max(1, Math.ceil(base * factor))
}

const countLines = (s: unknown) => (typeof s === "string" && s.length ? s.split(/\r?\n/).length : 0)

/** The lines and files a Write, Edit, MultiEdit or NotebookEdit call changes; none for any other call. */
export function changeSize(toolName: string, input: unknown): { lines: number; files: number } {
  const i = (input ?? {}) as Record<string, unknown>
  if (toolName === "Write") return { lines: countLines(i.content), files: 1 }
  if (toolName === "Edit") return { lines: Math.max(countLines(i.old_string), countLines(i.new_string)), files: 1 }
  if (toolName === "MultiEdit" && Array.isArray(i.edits))
    return {
      lines: (i.edits as Array<Record<string, unknown>>).reduce((n, e) => n + Math.max(countLines(e.old_string), countLines(e.new_string)), 0),
      files: 1,
    }
  if (toolName === "NotebookEdit") return { lines: countLines(i.new_source), files: 1 }
  return { lines: 0, files: 0 }
}
