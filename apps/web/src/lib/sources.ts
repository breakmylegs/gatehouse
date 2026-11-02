import type { Item } from "./transcript"

/** A source a chat used: a search result it was shown, or a page it read. */
export interface Source {
  n: number
  title: string
  url: string
  /** Read in full with the web fetch tool, not only seen in search results. */
  read: boolean
}

/**
 * The chat's sources, numbered in the order they first appeared (W1-10): every search result and every page read,
 * each address once. The research instruction asks Claude to number its citations the same way.
 */
export function sourcesOf(items: Item[]): Source[] {
  const out: Source[] = []
  const at = new Map<string, Source>()
  const add = (title: string, url: string, read: boolean) => {
    if (!/^https?:\/\//i.test(url)) return
    const had = at.get(url)
    if (had) {
      if (read) had.read = true
      return
    }
    const s: Source = { n: out.length + 1, title: title || url, url, read }
    at.set(url, s)
    out.push(s)
  }
  for (const it of items) {
    if (it.kind !== "tool") continue
    if (it.name === "WebSearch") for (const f of it.result?.found ?? []) add(f.title, f.url, false)
    else if (
      it.name === "WebFetch" &&
      typeof it.input.url === "string" &&
      it.result &&
      !it.result.isError
    )
      add("", it.input.url, true)
  }
  return out
}

/** The site an address is on, for a line in the pane. */
export const siteOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}
