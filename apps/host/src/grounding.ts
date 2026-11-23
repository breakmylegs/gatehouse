/**
 * E-083, evidence-grounded documents (Expansion E5). Before a draft is exported, each sentence of its prose is checked
 * for a source: a link, a web address, a file in the project (a path, with or without a line), an evidence pack (D-003,
 * its 64-character id or "evidence pack"), or a numbered citation ([1], [^1]) that the draft's own sources list
 * resolves. A sentence with none is ungrounded: it is highlighted in the preview and listed before the export, with
 * its line. Headings, code, tables, questions, very short sentences and the sources list itself are not claims and
 * are not checked. It reads only the draft and whether the files it names are in the project.
 */
import fs from "node:fs"
import path from "node:path"

export interface Ungrounded {
  line: number
  sentence: string
}

export interface Grounding {
  checked: number
  grounded: number
  ungrounded: Ungrounded[]
}

const LINK = /\[[^\]]+\]\([^)]+\)|<https?:\/\/[^>]+>|\bhttps?:\/\/\S+/
const PACK = /\b[0-9a-f]{64}\b|\bevidence pack\b/i
const PATH = /(?:^|[\s(`'"])((?:[\w.-]+\/)*[\w.-]+\.[A-Za-z]{1,8})(?::\d+(?:-\d+)?)?(?=[\s).,;:`'"]|$)/g
const CITE = /\[\^?(\d{1,3})\]/g

/** Sentences of a line of prose, with their text as written. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function grounding(markdown: string, o: { root?: string } = {}): Grounding {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n")
  // The draft's own sources: [1]: ..., [^1]: ..., or a numbered list under a Sources or References heading.
  const cited = new Set<string>()
  let inSources = false
  for (const l of lines) {
    const def = /^\s*\[\^?(\d{1,3})\]:\s*\S/.exec(l)
    if (def) cited.add(def[1]!)
    if (/^#{1,6}\s+(sources|references|citations|bibliography)\b/i.test(l)) inSources = true
    else if (/^#{1,6}\s/.test(l)) inSources = false
    const item = inSources ? /^\s*(\d{1,3})[.)]\s+\S/.exec(l) : null
    if (item) cited.add(item[1]!)
  }
  const exists = (p: string) => {
    if (!o.root) return false
    const abs = path.resolve(o.root, p)
    const r = path.relative(o.root, abs)
    return !r.startsWith("..") && !path.isAbsolute(r) && fs.existsSync(abs)
  }
  const sourced = (s: string) => {
    if (LINK.test(s) || PACK.test(s)) return true
    for (const m of s.matchAll(CITE)) if (cited.has(m[1]!)) return true
    for (const m of s.matchAll(PATH)) if (/\//.test(m[1]!) || /\.(ts|tsx|js|mjs|cjs|py|cs|java|go|rs|md|json|ya?ml|sql|ps1|sh|toml)$/i.test(m[1]!)) if (exists(m[1]!)) return true
    return false
  }
  const out: Grounding = { checked: 0, grounded: 0, ungrounded: [] }
  let fence = false
  inSources = false
  lines.forEach((raw, i) => {
    if (/^\s*(```|~~~)/.test(raw)) {
      fence = !fence
      return
    }
    if (fence) return
    if (/^#{1,6}\s+(sources|references|citations|bibliography)\b/i.test(raw)) inSources = true
    else if (/^#{1,6}\s/.test(raw)) inSources = false
    const l = raw.trim()
    if (!l || inSources || /^#{1,6}\s/.test(l) || /^\|/.test(l) || /^\[\^?\d{1,3}\]:/.test(l) || /^(>\s*)?[-*_]{3,}$/.test(l) || /^ {4}|\t/.test(raw)) return
    const text = l.replace(/^>\s*/, "").replace(/^(?:[-*+]|\d+[.)])\s+/, "")
    for (const s of sentences(text)) {
      const words = s.replace(/[`*_]/g, "").split(/\s+/).filter((w) => /\w/.test(w))
      if (words.length < 5 || /\?$/.test(s)) continue
      out.checked++
      if (sourced(s)) out.grounded++
      else out.ungrounded.push({ line: i + 1, sentence: s })
    }
  })
  return out
}
