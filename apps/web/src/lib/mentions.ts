/**
 * @ mentions in the prompt box (backlog F15): typing @ and part of a name lists matching files in the session's
 * folder, and choosing one puts @path in its place. A range after it, @src/a.ts:10-20, is written out when you send as
 * "@src/a.ts (lines 10 to 20)", so Claude reads those lines; Codehouse does not rely on a syntax Claude Code does not
 * document.
 */

/** The @ word the cursor is in: where it starts and what follows the @, or nothing. */
export function mentionAt(
  text: string,
  caret: number,
): { start: number; query: string } | undefined {
  const before = text.slice(0, caret)
  const m = /(^|\s)@([^\s@]*)$/.exec(before)
  if (!m) return undefined
  return { start: before.length - m[2]!.length - 1, query: m[2]! }
}

/** The text with that @ word replaced by @path and a space, and where the cursor goes after it. */
export function chooseMention(
  text: string,
  at: { start: number; query: string },
  rel: string,
): { text: string; caret: number } {
  const end = at.start + 1 + at.query.length
  const put = `@${rel} `
  return { text: text.slice(0, at.start) + put + text.slice(end), caret: at.start + put.length }
}

/** "@path:10-20" as "@path (lines 10 to 20)", and "@path:7" as "@path (line 7)". Anything else is left as it is. */
export function writeRanges(text: string): string {
  return text.replace(
    /(^|\s)@(\S+?):(\d{1,7})(?:-(\d{1,7}))?(?=\s|$|[.,;!?)])/g,
    (_m, pre, path, a, b) =>
      b ? `${pre}@${path} (lines ${a} to ${b})` : `${pre}@${path} (line ${a})`,
  )
}
