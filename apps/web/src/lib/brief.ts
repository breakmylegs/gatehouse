import type { Source } from "./sources"
import type { Item } from "./transcript"

/**
 * E-087, research to decision brief (Expansion E5). A research chat's findings become a decision brief: context,
 * options, risks and a recommendation, each option citing the chat's own sources by their numbers in the Sources
 * pane. Codehouse asks the chat for it in a fixed shape, then checks the answer: every option must cite at least one
 * source the pane lists, and a citation the pane does not have is not a source. What fails is named, for Claude to
 * fix. Exporting the brief applies your writing rules (E-086) and the grounding check (E-083).
 */
export function briefPrompt(sources: Source[]): string {
  return [
    "Write a decision brief from this research, in Markdown, in exactly this shape:",
    "",
    "## Context",
    "## Options",
    "### Option 1: <name>  (one heading per option)",
    "## Risks",
    "## Recommendation",
    "",
    "Under each option, say what it is, its costs and benefits, and end with a line `Sources: [n], [n]` citing the sources below that support it. Every option must cite at least one; use only these numbers, as the Sources pane shows them:",
    "",
    ...sources.map((s) => `[${s.n}] ${s.title} (${s.url})`),
    "",
    "If an option has no source among these, say so in its section and research it before recommending it. Use plain UK English and no em dashes.",
  ].join("\n")
}

export interface BriefCheck {
  /** Whether the answer is a brief at all (it has an Options section). */
  isBrief: boolean
  missingSections: string[]
  options: Array<{ name: string; cites: number[]; ok: boolean; unknown: number[] }>
  ok: boolean
}

export function checkBrief(markdown: string, sources: Source[]): BriefCheck {
  const have = new Set(sources.map((s) => s.n))
  const sections = new Set([...markdown.matchAll(/^##\s+([^\n#]+?)\s*$/gm)].map((m) => m[1]!.trim().toLowerCase()))
  const missingSections = ["Context", "Options", "Risks", "Recommendation"].filter((s) => !sections.has(s.toLowerCase()))
  const optionsAt = markdown.search(/^##\s+Options\s*$/m)
  const options: BriefCheck["options"] = []
  if (optionsAt >= 0) {
    const rest = markdown.slice(optionsAt).replace(/^##\s+Options\s*$/m, "")
    const end = rest.search(/^##\s+(?!#)/m)
    const body = end >= 0 ? rest.slice(0, end) : rest
    const parts = body.split(/^###\s+/m).slice(1)
    for (const p of parts) {
      const name = p.split("\n")[0]!.trim()
      const nums = [...new Set([...p.matchAll(/\[(\d{1,3})\]/g)].map((m) => Number(m[1])))]
      const cites = nums.filter((n) => have.has(n))
      options.push({ name, cites, unknown: nums.filter((n) => !have.has(n)), ok: cites.length > 0 })
    }
  }
  return { isBrief: optionsAt >= 0, missingSections, options, ok: optionsAt >= 0 && options.length > 0 && missingSections.length === 0 && options.every((o) => o.ok) }
}

/** What to ask Claude to fix, from a check that failed. */
export function fixPrompt(c: BriefCheck): string {
  const lines = ["The brief needs fixing before it is used:"]
  for (const s of c.missingSections) lines.push(`- It has no "## ${s}" section.`)
  if (c.isBrief && !c.options.length) lines.push("- Its Options section has no options (### headings).")
  for (const o of c.options) {
    if (!o.ok) lines.push(`- Option "${o.name}" cites no source from the Sources pane${o.unknown.length ? ` (it cites ${o.unknown.map((n) => `[${n}]`).join(", ")}, which the pane does not have)` : ""}.`)
    else if (o.unknown.length) lines.push(`- Option "${o.name}" also cites ${o.unknown.map((n) => `[${n}]`).join(", ")}, which the pane does not have.`)
  }
  lines.push("", "Rewrite the brief in the same shape, citing only the numbered sources from the pane.")
  return lines.join("\n")
}

/** The latest answer in the chat that is a brief, if there is one. */
export function latestBrief(items: Item[]): string | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!
    if (it.kind === "text" && !it.subagent && /^##\s+Options\s*$/m.test(it.text)) return it.text
    if (it.kind === "user") return undefined
  }
  return undefined
}
