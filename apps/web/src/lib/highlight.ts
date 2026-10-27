export interface Part {
  text: string
  hit: boolean
}

/**
 * Splits a command into plain and highlighted parts. Each segment is matched at its first free
 * position in the command, so repeated segments mark separate places and overlaps are never doubled.
 * A segment that cannot be found is ignored: the full command still shows.
 */
export function splitByHighlights(command: string, segments: readonly string[]): Part[] {
  const spans: Array<[number, number]> = []
  for (const seg of segments) {
    if (!seg) continue
    let from = 0
    for (;;) {
      const i = command.indexOf(seg, from)
      if (i < 0) break
      const end = i + seg.length
      if (!spans.some(([s, e]) => i < e && end > s)) {
        spans.push([i, end])
        break
      }
      from = i + 1
    }
  }
  spans.sort((a, b) => a[0] - b[0])
  const parts: Part[] = []
  let at = 0
  for (const [s, e] of spans) {
    if (s > at) parts.push({ text: command.slice(at, s), hit: false })
    parts.push({ text: command.slice(s, e), hit: true })
    at = e
  }
  if (at < command.length) parts.push({ text: command.slice(at), hit: false })
  return parts.length ? parts : [{ text: command, hit: false }]
}
