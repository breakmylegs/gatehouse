import fs from "node:fs"
import path from "node:path"
import { parse as parseYaml } from "yaml"

/**
 * D-083 (frontier, Insight and evidence): the ubiquitous language glossary. The words a project's code names things
 * with (identifiers split at their capitals and underscores, plurals folded), counted by how many distinct names use
 * each, so the project's own vocabulary can be read at a glance; and the clashes: two words for one thing used side by
 * side (customer and client, cart and basket, organisation and organization), each with examples, so one can be
 * chosen. The groups are a small built-in list of common synonyms plus any the project gives in
 * .codehouse/glossary.yml (synonyms: [[customer, client], ...], the first word the one to keep). It reads files only.
 */
export const BUILT_IN_GROUPS: string[][] = [
  ["customer", "client", "buyer", "purchaser"],
  ["user", "member"],
  ["order", "purchase"],
  ["product", "item", "article"],
  ["invoice", "bill"],
  ["shipment", "delivery", "consignment"],
  ["employee", "staff", "worker"],
  ["supplier", "vendor"],
  ["cart", "basket"],
  ["quantity", "qty"],
  ["settings", "preferences", "prefs"],
  ["organisation", "organization"],
  ["colour", "color"],
  ["behaviour", "behavior"],
  ["cancelled", "canceled"],
]

const CODE = /\.(m|c)?[tj]sx?$|\.(py|cs|go|java|kt|rb|php|rs|swift)$/i
const SKIP = /(^|\/)(node_modules|dist|build|out|coverage|\.git|vendor|test|tests|__tests__)\/|\.(test|spec)\./
const STOP = new Set(
  "get set is has to from of the a an and or in on at by for with id ids value values data type types list new old map key keys index name names count total item items get set add remove delete update create make build run start stop init load save read write find on off true false null props state ref refs fn cb err error result results options option args arg config ctx event events handler handlers util utils helper helpers test spec mock default export import const let var function class return async await this self string number boolean object array".split(
    " ",
  ),
)

/** The words of one identifier, lower-cased, plurals folded: "customerOrders" gives customer and order. */
export function wordsOf(identifier: string): string[] {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z]+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length > 2)
    .map(singular)
}

/** A plural folded to its singular, simply: orders to order, addresses to address, categories to category. */
export function singular(w: string): string {
  if (w.length <= 3 || w.endsWith("ss") || w === "settings" || w === "preferences" || w === "prefs") return w
  if (w.endsWith("ies")) return `${w.slice(0, -3)}y`
  if (/(ses|xes|zes|ches|shes)$/.test(w)) return w.slice(0, -2)
  return w.endsWith("s") ? w.slice(0, -1) : w
}

export interface Term {
  word: string
  names: number
  example: { name: string; file: string }
}
export interface Clash {
  words: Array<{ word: string; names: number; examples: Array<{ name: string; file: string }> }>
  /** The word to keep: the project's own choice, else the one most names use. */
  keep: string
  from: "built-in" | "project"
}
export interface Glossary {
  scope: { root: string; files: number; names: number }
  terms: Term[]
  clashes: Clash[]
}

/** The project's own synonym groups, from .codehouse/glossary.yml, read tolerantly. */
export function projectGroups(root: string): string[][] {
  try {
    const y = parseYaml(fs.readFileSync(path.join(root, ".codehouse", "glossary.yml"), "utf8")) as { synonyms?: unknown }
    if (!Array.isArray(y?.synonyms)) return []
    return y.synonyms
      .filter((g): g is unknown[] => Array.isArray(g))
      .map((g) => g.filter((w): w is string => typeof w === "string" && /^[a-z]{2,40}$/i.test(w)).map((w) => singular(w.toLowerCase())))
      .filter((g) => g.length >= 2)
  } catch {
    return []
  }
}

/** The glossary of a project from its file list (as git lists it). */
export function glossary(root: string, files: string[]): Glossary {
  const code = files.filter((f) => CODE.test(f) && !SKIP.test(f)).slice(0, 8000)
  // Each word: the distinct names it appears in, and where the first few are.
  const byWord = new Map<string, Map<string, string>>()
  const seenNames = new Set<string>()
  for (const f of code) {
    let text: string
    try {
      const abs = path.join(root, f)
      if (fs.statSync(abs).size > 1_000_000) continue
      text = fs.readFileSync(abs, "utf8")
    } catch {
      continue
    }
    // Names in code, not words in strings or comments.
    const noComments = /\.(py|rb)$/i.test(f) ? text.replace(/#.*$/gm, "") : text.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, "$1")
    const bare = noComments.replace(/(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g, "")
    for (const m of bare.matchAll(/[A-Za-z_$][\w$]{2,}/g)) {
      const name = m[0]
      seenNames.add(name)
      for (const w of new Set(wordsOf(name))) {
        const names = byWord.get(w) ?? new Map<string, string>()
        if (!names.has(name)) names.set(name, f)
        byWord.set(w, names)
      }
    }
  }
  const count = (w: string) => byWord.get(w)?.size ?? 0
  const terms: Term[] = [...byWord]
    .filter(([w]) => !STOP.has(w))
    .map(([word, names]) => {
      const [name, file] = [...names][0]!
      return { word, names: names.size, example: { name, file } }
    })
    .sort((a, b) => b.names - a.names || a.word.localeCompare(b.word))
    .slice(0, 40)

  const clashes: Clash[] = []
  const own = projectGroups(root)
  for (const [groups, from] of [
    [own, "project"],
    [BUILT_IN_GROUPS, "built-in"],
  ] as const) {
    for (const group of groups) {
      // A built-in group the project has its own word for is left to the project's.
      if (from === "built-in" && own.some((g) => g.some((w) => group.includes(w)))) continue
      const used = group.filter((w) => count(w) >= 2)
      if (used.length < 2) continue
      const words = used
        .map((word) => ({ word, names: count(word), examples: [...byWord.get(word)!].slice(0, 3).map(([name, file]) => ({ name, file })) }))
        .sort((a, b) => b.names - a.names)
      clashes.push({ words, keep: from === "project" ? group[0]! : words[0]!.word, from })
    }
  }
  return { scope: { root: path.basename(root), files: code.length, names: seenNames.size }, terms, clashes }
}
