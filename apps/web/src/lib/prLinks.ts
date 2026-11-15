import type { Item } from "./transcript"

/**
 * T-078 (t3code review, O31): the pull requests a session opened, found in its own transcript: the address a
 * successful \`gh pr create\` printed. Read from what is on screen; nothing is fetched (status badges wait for T-061).
 */
export interface PrLink {
  url: string
  repo: string
  number: number
}

const PR_URL = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/g

export function prLinks(items: readonly Item[]): PrLink[] {
  const out: PrLink[] = []
  const seen = new Set<string>()
  for (const it of items) {
    if (it.kind !== "tool" || (it.name !== "Bash" && it.name !== "PowerShell") || !it.result || it.result.isError) continue
    const cmd = typeof it.input.command === "string" ? it.input.command : ""
    if (!/\bgh\s+pr\s+create\b/.test(cmd)) continue
    for (const m of it.result.text.matchAll(PR_URL)) {
      if (seen.has(m[0])) continue
      seen.add(m[0])
      out.push({ url: m[0], repo: m[1]!, number: Number(m[2]) })
    }
  }
  return out
}
