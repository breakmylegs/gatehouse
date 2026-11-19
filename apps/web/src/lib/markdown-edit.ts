/**
 * T-037: Markdown in the message box, as you type. The box stays a plain text box (everything it does with / and @,
 * pasting and recall is unchanged); these rules run on the key that makes a new line (Shift+Enter, or Enter when
 * Ctrl+Enter sends) and on Tab, and the backdrop behind the text colours what the Markdown is.
 *   - A list continues: a new line after an item starts the next one (numbers count up, a task box starts empty), and
 *     a new line after an empty item ends the list.
 *   - Tab and Shift+Tab indent and outdent a list item.
 *   - Opening a code block (```, with a language if you like) and making a new line closes it for you, with the caret
 *     inside; inside a block a new line keeps the line's indentation.
 */
export interface Edit {
  text: string
  caret: number
}

const LIST = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(\[[ xX]\]\s+)?(.*)$/
const FENCE = /^\s*(```|~~~)/

function lineAt(text: string, pos: number) {
  const start = text.lastIndexOf("\n", pos - 1) + 1
  const nl = text.indexOf("\n", pos)
  const end = nl < 0 ? text.length : nl
  return { start, end, line: text.slice(start, end) }
}

/** Whether `pos` is inside a fenced code block (after an opening fence with no closing one before it). */
export function inFence(text: string, pos: number): boolean {
  let open = false
  for (const l of text.slice(0, lineAt(text, pos).start).split("\n")) if (FENCE.test(l)) open = !open
  return open
}

/** The new line, or undefined to let the box make a plain one. Only with nothing selected. */
export function newLine(text: string, start: number, end: number): Edit | undefined {
  if (start !== end) return undefined
  const { start: ls, end: le, line } = lineAt(text, start)
  const before = line.slice(0, start - ls)
  const rest = text.slice(start)
  // An opening fence on this line, not yet closed: close it, with the caret on the line between.
  if (FENCE.test(line) && start === le && !inFence(text, start)) {
    const fence = /^(\s*)(```|~~~)/.exec(line)!
    const closed = text.slice(le).split("\n").some((l) => l.trim() === fence[2])
    if (!closed) {
      const inner = `\n${fence[1]}`
      return { text: `${text.slice(0, start)}${inner}\n${fence[1]}${fence[2]}${rest}`, caret: start + inner.length }
    }
  }
  if (inFence(text, start)) {
    const indent = /^\s*/.exec(before)![0]
    return indent ? { text: `${text.slice(0, start)}\n${indent}${rest}`, caret: start + 1 + indent.length } : undefined
  }
  const m = LIST.exec(line)
  if (!m || start !== le) return undefined
  const [, indent = "", marker = "-", gap = " ", task, body = ""] = m
  // An empty item ends the list: the marker goes and the line is left empty.
  if (!body.trim()) return { text: `${text.slice(0, ls)}${text.slice(le)}`, caret: ls }
  const num = /^(\d+)([.)])$/.exec(marker)
  const next = num ? `${Number(num[1]) + 1}${num[2]}` : marker
  const insert = `\n${indent}${next}${gap}${task ? "[ ] " : ""}`
  return { text: `${text.slice(0, start)}${insert}${rest}`, caret: start + insert.length }
}

/** Tab or Shift+Tab on a list item: two spaces in or out. Undefined for any other line. */
export function indent(text: string, start: number, end: number, out: boolean): Edit | undefined {
  if (start !== end) return undefined
  const { start: ls, line } = lineAt(text, start)
  if (!LIST.test(line)) return undefined
  if (out) {
    const cut = line.startsWith("  ") ? 2 : line.startsWith(" ") || line.startsWith("\t") ? 1 : 0
    if (!cut) return undefined
    return { text: text.slice(0, ls) + line.slice(cut) + text.slice(ls + line.length), caret: Math.max(ls, start - cut) }
  }
  return { text: `${text.slice(0, ls)}  ${text.slice(ls)}`, caret: start + 2 }
}

export type MarkKind = "plain" | "heading" | "fence" | "code" | "marker" | "quote" | "strong"
export interface Mark {
  text: string
  kind: MarkKind
}

/** The text in pieces by what the Markdown makes of them, for the backdrop. Joined, the pieces are the text exactly. */
export function marks(text: string): Mark[] {
  const out: Mark[] = []
  const push = (t: string, kind: MarkKind) => {
    if (!t) return
    const last = out.at(-1)
    if (last?.kind === kind) last.text += t
    else out.push({ text: t, kind })
  }
  let fenced = false
  const lines = text.split("\n")
  lines.forEach((line, i) => {
    const nl = i < lines.length - 1 ? "\n" : ""
    if (FENCE.test(line)) {
      fenced = !fenced
      return push(line + nl, "fence")
    }
    if (fenced) return push(line + nl, "fence")
    if (/^#{1,6}\s/.test(line)) return push(line + nl, "heading")
    if (/^\s*>/.test(line)) return push(line + nl, "quote")
    let rest = line
    const list = LIST.exec(line)
    if (list) {
      const head = `${list[1]}${list[2]}${list[3]}${list[4] ?? ""}`
      push(head, "marker")
      rest = line.slice(head.length)
    }
    // Inline code and strong text; anything not closed on the line stays plain.
    for (const m of rest.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__)/)) push(m, m.startsWith("`") ? "code" : m.startsWith("**") || m.startsWith("__") ? "strong" : "plain")
    push(nl, "plain")
  })
  return out
}
