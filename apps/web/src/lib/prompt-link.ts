/**
 * T-087 (safe variant): a prompt link, `codehouse://new?prompt=...`, opened from a browser or another program. It gives
 * a draft only: the prompt, put in the message box of the next session you start, unsent. Nothing else it says is used
 * (a mode, a folder, an account, a model, a repository), and nothing is sent. Characters you cannot see (G21) are taken
 * out, and you are told which.
 */
export const MAX_LINK_PROMPT = 100_000

// The ranges G21 counts as hidden (packages/policy/src/hidden.ts), built from code points so no editor shows them.
const RANGES: Array<[number, number]> = [
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0x200b, 0x200f],
  [0x2060, 0x2064],
  [0xfeff, 0xfeff],
  [0x00ad, 0x00ad],
  [0x180e, 0x180e],
  [0xe0000, 0xe007f],
]
const hidden = (cp: number) => RANGES.some(([a, b]) => cp >= a && cp <= b)

export type PromptLink = { prompt: string; removed: string[]; ignored: string[] } | { error: string }

export function readPromptLink(link: string): PromptLink {
  let u: URL
  try {
    u = new URL(link)
  } catch {
    return { error: "That is not a link Codehouse can read." }
  }
  if (u.protocol !== "codehouse:") return { error: "That is not a codehouse: link." }
  const what = (u.hostname || u.pathname.replace(/^\/+/, "")).replace(/\/+$/, "").toLowerCase()
  if (what !== "new") return { error: "Codehouse links only open a new draft (codehouse://new?prompt=...)." }
  const raw = u.searchParams.get("prompt") ?? ""
  const removed: string[] = []
  let prompt = ""
  for (const ch of raw) {
    const cp = ch.codePointAt(0) ?? 0
    if (hidden(cp)) {
      const code = `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`
      if (!removed.includes(code)) removed.push(code)
    } else prompt += ch
  }
  prompt = prompt.trim()
  if (!prompt) return { error: "The link has no prompt." }
  if (prompt.length > MAX_LINK_PROMPT) return { error: "The link's prompt is longer than 100,000 characters." }
  const ignored = [...new Set([...u.searchParams.keys()].filter((k) => k !== "prompt"))]
  return { prompt, removed, ignored }
}
