/**
 * T-112: each session's terminal as it was, kept by the Host in memory (never written to disk), so a window that
 * reloads or reconnects shows it again: your commands and what they printed, the last SCROLLBACK_LINES lines.
 * Clear empties it; closing the session drops it.
 */
export const SCROLLBACK_LINES = 5000

export interface TermChunk {
  stream: "cmd" | "out" | "err" | "note"
  text: string
}

export class TerminalScrollback {
  readonly #by = new Map<string, { chunks: TermChunk[]; lines: number }>()

  add(sessionId: string, chunk: TermChunk): void {
    if (!chunk.text) return
    const t = this.#by.get(sessionId) ?? { chunks: [], lines: 0 }
    const last = t.chunks.at(-1)
    if (last && last.stream === chunk.stream) last.text += chunk.text
    else t.chunks.push({ ...chunk })
    t.lines += (chunk.text.match(/\n/g) ?? []).length
    // Too long: whole lines go from the start, a chunk at a time, then within the first chunk.
    while (t.lines > SCROLLBACK_LINES && t.chunks.length) {
      const first = t.chunks[0]!
      const extra = t.lines - SCROLLBACK_LINES
      const parts = first.text.split("\n")
      const inFirst = parts.length - 1
      if (inFirst <= extra && t.chunks.length > 1) {
        t.chunks.shift()
        t.lines -= inFirst
      } else {
        first.text = parts.slice(Math.min(extra, inFirst)).join("\n")
        t.lines -= Math.min(extra, inFirst)
        if (Math.min(extra, inFirst) === 0) break
      }
    }
    this.#by.set(sessionId, t)
  }

  get(sessionId: string): TermChunk[] {
    return (this.#by.get(sessionId)?.chunks ?? []).map((c) => ({ ...c }))
  }

  clear(sessionId: string): void {
    this.#by.delete(sessionId)
  }
}
