/**
 * A folder name for a new project, from the first thing you ask for: "Build me an HTML page that acts like a simple
 * version of excel" becomes "html-excel". Words that say how you ask (build, me, please) or how small it is
 * (simple, quick) are dropped; the first few that are left name it. When only one is left, the kind of thing
 * (app, website, game) is added back, so "Create a website for my bakery" becomes "bakery-website".
 *
 * Pure, so the screen can show the name while you type and the Host can check the same name.
 */

const ASKING = new Set(
  (
    "a an the me my mine i we us our you your please pls can could would will should shall must want wanted need " +
    "needs like likes love to for of and or but with without that which who whom whose what when where how in on " +
    "at by from into onto as is are was were be been being it its this these those there here some any every " +
    "just only also very really so then than too build builds building make makes making create creates creating " +
    "write writes writing code coding develop develops generate generates help set setup up put give get gets let " +
    "lets do does doing done have has had simple small basic tiny little quick easy nice good cool fancy new " +
    "version versions acts act works work looks look using use uses based called named kind sort something thing " +
    "stuff one two all each other another more most show shows showing display displays displaying"
  ).split(" "),
)

/** The kind of thing being built: dropped from the name unless the name would be one word long. */
const KINDS = new Set(
  "app apps application website site page webpage tool tools program script game dashboard api bot extension plugin service".split(
    " ",
  ),
)

export const MAX_NAME = 40

/** "html-excel", or "project" when nothing in the prompt can name it. */
export function projectName(prompt: string): string {
  const words = prompt
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 || /\d/.test(w))
  const kept: string[] = []
  let kind: string | undefined
  for (const w of words) {
    if (KINDS.has(w)) {
      kind ??= w
      continue
    }
    if (ASKING.has(w) || kept.includes(w)) continue
    kept.push(w)
    if (kept.length === 3) break
  }
  if (kept.length === 1 && kind) kept.push(kind === "webpage" ? "page" : kind)
  const name = kept.join("-").slice(0, MAX_NAME).replace(/-+$/, "")
  return name || "project"
}

/** A name you typed, made safe for a Windows folder: letters, digits and dashes. */
export function cleanName(typed: string): string {
  return typed
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_NAME)
}
