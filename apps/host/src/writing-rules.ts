/**
 * E-086 (expansion): writing rules. One list for this computer (Settings) and one per project (a
 * .codehouse/writing-rules.json in it, read tolerantly), added together: UK spelling, no em or en dashes, terms always
 * written one way (a product name, say) and banned terms. What Codehouse writes itself (an export) is corrected, and
 * the preview lists each change. What an agent writes (a commit message) is only checked: the problems are shown and
 * the text is never rewritten. Code (fenced and inline) and web addresses are never touched.
 */
import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

export interface WritingRules {
  ukSpelling: boolean
  noDashes: boolean
  /** Write `use`, never any of `not`. */
  terms: Array<{ use: string; not: string[] }>
  /** Never written; flagged, not replaced (there is no one right replacement). */
  banned: string[]
}

/** Codehouse's own house style: UK English, no em dashes. */
export const DEFAULT_WRITING_RULES: WritingRules = { ukSpelling: true, noDashes: true, terms: [], banned: [] }

export interface Change {
  from: string
  to: string
  count: number
}

/** US spellings and their UK forms; each word's -s, -d, -ing and -ation forms are listed where they differ. */
const US_UK: Record<string, string> = {
  color: "colour", colors: "colours", colored: "coloured", coloring: "colouring",
  behavior: "behaviour", behaviors: "behaviours", favorite: "favourite", favorites: "favourites",
  honor: "honour", flavor: "flavour", neighbor: "neighbour", rumor: "rumour",
  organize: "organise", organized: "organised", organizes: "organises", organizing: "organising",
  organization: "organisation", organizations: "organisations",
  recognize: "recognise", recognized: "recognised", analyze: "analyse", analyzed: "analysed", analyzing: "analysing",
  summarize: "summarise", summarized: "summarised", prioritize: "prioritise", prioritized: "prioritised",
  customize: "customise", customized: "customised", optimize: "optimise", optimized: "optimised",
  authorize: "authorise", authorized: "authorised", authorization: "authorisation", normalize: "normalise",
  normalized: "normalised", utilize: "utilise", realize: "realise", realized: "realised", apologize: "apologise",
  center: "centre", centers: "centres", centered: "centred", gray: "grey", catalog: "catalogue",
  canceled: "cancelled", canceling: "cancelling", traveled: "travelled", traveling: "travelling",
  modeling: "modelling", labeled: "labelled", labeling: "labelling", defense: "defence", offense: "offence",
  judgment: "judgement",
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** The word in the case of the one it replaces: Color to Colour, COLOR to COLOUR. */
function inCase(model: string, word: string): string {
  if (model === model.toUpperCase() && model.length > 1) return word.toUpperCase()
  if (model[0] === model[0]?.toUpperCase()) return word[0]!.toUpperCase() + word.slice(1)
  return word
}

/** The text cut into prose and what is never touched (code, web addresses), in order. */
function pieces(text: string): Array<{ prose: boolean; text: string }> {
  const out: Array<{ prose: boolean; text: string }> = []
  const re = /```[\s\S]*?(?:```|$)|`[^`\n]*`|https?:\/\/\S+/g
  let at = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > at) out.push({ prose: true, text: text.slice(at, m.index) })
    out.push({ prose: false, text: m[0] })
    at = m.index! + m[0].length
  }
  if (at < text.length) out.push({ prose: true, text: text.slice(at) })
  return out
}

type Fix = { re: RegExp; to: (m: string) => string; label: (m: string) => string }

function fixes(rules: WritingRules): Fix[] {
  const out: Fix[] = []
  if (rules.noDashes) {
    // A range of numbers keeps a hyphen; a dash between words becomes a comma.
    out.push({ re: /(?<=\d)[–—](?=\d)/g, to: () => "-", label: (m) => m })
    out.push({ re: /(?<=\S)[ \t]*[—–][ \t]*(?=\S)/g, to: () => ", ", label: (m) => m.trim() })
  }
  for (const t of rules.terms)
    for (const n of t.not.filter((n) => n.trim() && n !== t.use))
      out.push({ re: new RegExp(`(?<![\\w-])${escape(n)}(?![\\w-])`, "g"), to: () => t.use, label: (m) => m })
  if (rules.ukSpelling)
    out.push({
      re: new RegExp(`\\b(${Object.keys(US_UK).join("|")})\\b`, "gi"),
      to: (m) => inCase(m, US_UK[m.toLowerCase()] ?? m),
      label: (m) => m,
    })
  return out
}

/** Codehouse's own text, corrected: each change listed, and banned terms found (not replaced). */
export function correctText(text: string, rules: WritingRules): { text: string; changes: Change[]; banned: string[] } {
  const counts = new Map<string, Change>()
  const all = fixes(rules)
  const out = pieces(text)
    .map((p) => {
      if (!p.prose) return p.text
      let t = p.text
      for (const f of all)
        t = t.replace(f.re, (m) => {
          const to = f.to(m)
          const key = `${f.label(m)}\u0000${to.trim()}`
          const c = counts.get(key) ?? { from: f.label(m), to: to.trim() || to, count: 0 }
          c.count++
          counts.set(key, c)
          return to
        })
      return t
    })
    .join("")
  return { text: out, changes: [...counts.values()], banned: bannedIn(text, rules) }
}

function bannedIn(text: string, rules: WritingRules): string[] {
  const prose = pieces(text).filter((p) => p.prose).map((p) => p.text).join("\n")
  return rules.banned.filter((b) => b.trim() && new RegExp(`(?<![\\w-])${escape(b)}(?![\\w-])`, "i").test(prose))
}

/** An agent's text, checked and never rewritten: each problem as a short line. */
export function checkText(text: string, rules: WritingRules): string[] {
  const { changes, banned } = correctText(text, rules)
  return [
    ...banned.map((b) => `uses the banned term "${b}"`),
    ...changes.map((c) => (c.from === "—" || c.from === "–" || c.from === "" ? "has a dash (write a comma or a hyphen)" : `writes "${c.from}" for "${c.to}"`)),
  ].filter((v, i, a) => a.indexOf(v) === i)
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.length <= 200).slice(0, 500) : [])

/** Rules from a settings value or a project's file, keeping only what is well formed. */
export function readRules(v: unknown): Partial<WritingRules> {
  if (!v || typeof v !== "object") return {}
  const o = v as Record<string, unknown>
  return {
    ...(typeof o.ukSpelling === "boolean" ? { ukSpelling: o.ukSpelling } : {}),
    ...(typeof o.noDashes === "boolean" ? { noDashes: o.noDashes } : {}),
    ...(Array.isArray(o.terms)
      ? {
          terms: (o.terms as unknown[])
            .filter((t): t is { use: string; not: unknown } => !!t && typeof (t as { use?: unknown }).use === "string")
            .map((t) => ({ use: t.use, not: strings(t.not) }))
            .slice(0, 200),
        }
      : {}),
    ...(Array.isArray(o.banned) ? { banned: strings(o.banned) } : {}),
  }
}

/** A project's own rules, from .codehouse/writing-rules.json; nothing when there is none or it does not read. */
export function projectRules(cwd: string | undefined): Partial<WritingRules> {
  if (!cwd) return {}
  try {
    return readRules(JSON.parse(fs.readFileSync(path.join(cwd, ".codehouse", "writing-rules.json"), "utf8")))
  } catch {
    return {}
  }
}

/** The problems in the commit just made in `cwd`, under these rules plus the project's; [] when none or unreadable. */
export function checkLastCommit(cwd: string, rules: Partial<WritingRules>): Promise<string[]> {
  return new Promise((resolve) => {
    execFile("git", ["log", "-1", "--format=%B"], { cwd, windowsHide: true, timeout: 20_000 }, (e, stdout) =>
      resolve(e ? [] : checkText(String(stdout), mergeRules(rules, projectRules(cwd)))),
    )
  })
}

/** This computer's rules and a project's, added together: a project can add terms and checks, not take them away. */
export function mergeRules(...lists: Array<Partial<WritingRules>>): WritingRules {
  const out: WritingRules = { ...DEFAULT_WRITING_RULES, terms: [], banned: [] }
  let first = true
  for (const l of lists) {
    if (l.ukSpelling !== undefined) out.ukSpelling = first ? l.ukSpelling : out.ukSpelling || l.ukSpelling
    if (l.noDashes !== undefined) out.noDashes = first ? l.noDashes : out.noDashes || l.noDashes
    out.terms.push(...(l.terms ?? []))
    out.banned.push(...(l.banned ?? []))
    first = false
  }
  return out
}
