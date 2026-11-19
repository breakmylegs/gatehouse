/**
 * T-052: maths in messages. remark-math reads $$...$$ (inline, or a block on its own lines) and ```math blocks; its
 * single-dollar maths is off, so prose such as "costs $5 to $10" stays prose. Before it reads a message, the forms
 * Claude often writes are turned into those: \(...\) inline, \[...\] as a block, and a single-dollar span that is
 * plainly maths (no space just inside the dollars, and a command, ^, _ or = in it). Code, inline or fenced, is never
 * changed.
 */
const FENCE = /^\s*(```|~~~)/

/** A single-dollar span that is plainly maths, not money. */
const looksLikeMath = (inner: string) => !/^\s|\s$/.test(inner) && /\\[a-zA-Z]+|[\^_=]/.test(inner) && !/^\d+([.,]\d+)?$/.test(inner)

function convertLine(line: string): string {
  // Leave inline code alone: work on the parts between backticks.
  return line
    .split(/(`[^`]*`)/)
    .map((part) => {
      if (part.startsWith("`")) return part
      return part
        .replace(/\\\((.+?)\\\)/g, (_m, inner: string) => `$$${inner}$$`)
        .replace(/(^|[^$\\\w])\$([^$\n]{1,300}?)\$(?![$\w])/g, (m, pre: string, inner: string) => (looksLikeMath(inner) ? `${pre}$$${inner}$$` : m))
    })
    .join("")
}

export function mathText(markdown: string): string {
  if (!/[$\\]/.test(markdown)) return markdown
  const out: string[] = []
  let fenced = false
  for (const line of markdown.split("\n")) {
    if (FENCE.test(line)) {
      fenced = !fenced
      out.push(line)
      continue
    }
    if (fenced) {
      out.push(line)
      continue
    }
    // \[ ... \] on a line of their own, or the whole of one line, as a block.
    const block = /^\s*\\\[(.*)\\\]\s*$/.exec(line)
    if (block) {
      out.push("$$", block[1]!.trim(), "$$")
      continue
    }
    if (/^\s*\\[[\]]\s*$/.test(line)) {
      out.push("$$")
      continue
    }
    out.push(convertLine(line))
  }
  return out.join("\n")
}
