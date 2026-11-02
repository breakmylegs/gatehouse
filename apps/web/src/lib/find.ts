import type { Shown } from "./groups"
import type { Item } from "./transcript"

/** The words of a transcript line, as find in a chat reads them: what was said, and a tool's command, path and output. */
export function itemText(item: Shown | Item): string {
  if (item.kind === "group") return item.tools.map((t) => itemText(t)).join("\n")
  if (item.kind === "tool") {
    const input = item.input as Record<string, unknown>
    const main = ["command", "file_path", "path", "pattern", "url", "query"]
      .map((k) => input[k])
      .filter((v): v is string => typeof v === "string")
    return [item.name, ...main, item.result?.text ?? ""].join("\n")
  }
  return "text" in item && typeof item.text === "string" ? item.text : ""
}

/** The places in the list whose words hold the query, ignoring case; none for an empty query. */
export function findIn(items: Array<Shown | Item>, query: string): number[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const out: number[] = []
  items.forEach((it, i) => {
    if (itemText(it).toLowerCase().includes(q)) out.push(i)
  })
  return out
}
