import type { Item } from "./transcript"

type Tool = Extract<Item, { kind: "tool" }>
export type Shown = Exclude<Item, Tool> | { kind: "group"; id: string; tools: Tool[] }

/**
 * Folds each run of tool calls in a transcript into one group, so the work reads as "Ran 2 commands, read
 * schema.ts" and opens to each call. A subagent's calls stay in their own runs.
 */
export function groupItems(items: Item[]): Shown[] {
  const out: Shown[] = []
  for (const it of items) {
    if (it.kind !== "tool") {
      out.push(it)
      continue
    }
    const last = out.at(-1)
    if (last?.kind === "group" && last.tools[0]?.subagent === it.subagent) last.tools.push(it)
    else out.push({ kind: "group", id: `g-${it.id}`, tools: [it] })
  }
  return out
}

const base = (p: string) => p.split(/[\\/]/).filter(Boolean).at(-1) ?? p
const str = (v: unknown) => (typeof v === "string" ? v : undefined)

/** One part of a summary per kind of work, in the order it first happened. */
function part(t: Tool): { key: string; one: string; many: (n: number) => string } {
  const i = t.input
  const file = str(i.file_path) ?? str(i.notebook_path) ?? str(i.path)
  switch (t.name) {
    case "Bash":
    case "PowerShell":
      return {
        key: "run",
        one: str(i.description) ? `ran "${str(i.description)}"` : "ran a command",
        many: (n) => `ran ${n} commands`,
      }
    case "Read":
      return {
        key: "read",
        one: `read ${file ? base(file) : "a file"}`,
        many: (n) => `read ${n} files`,
      }
    case "Write":
      return {
        key: "write",
        one: `created ${file ? base(file) : "a file"}`,
        many: (n) => `created ${n} files`,
      }
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return {
        key: "edit",
        one: `edited ${file ? base(file) : "a file"}`,
        many: (n) => `edited ${n} files`,
      }
    case "Glob":
    case "Grep":
      return { key: "search", one: "searched the files", many: () => "searched the files" }
    case "WebSearch":
      return { key: "web", one: "searched the web", many: () => "searched the web" }
    case "WebFetch": {
      const url = str(i.url)
      let host = "a web page"
      try {
        if (url) host = new URL(url).hostname
      } catch {
        // not a full address
      }
      return { key: "fetch", one: `read ${host}`, many: (n) => `read ${n} web pages` }
    }
    case "TodoWrite":
      return { key: "plan", one: "updated the plan", many: () => "updated the plan" }
    case "Task":
    case "Agent":
      return { key: "agent", one: "started a helper", many: (n) => `started ${n} helpers` }
    default:
      return { key: t.name, one: `used ${t.name}`, many: (n) => `used ${t.name} ${n} times` }
  }
}

/** "Ran 2 commands, read schema.ts", with the failures counted. */
export function summarise(tools: Tool[]): string {
  const order: string[] = []
  const byKey = new Map<string, { p: ReturnType<typeof part>; n: number }>()
  for (const t of tools) {
    const p = part(t)
    const seen = byKey.get(p.key)
    if (seen) seen.n++
    else {
      byKey.set(p.key, { p, n: 1 })
      order.push(p.key)
    }
  }
  const text = order
    .map((k) => {
      const { p, n } = byKey.get(k) as { p: ReturnType<typeof part>; n: number }
      return n === 1 ? p.one : p.many(n)
    })
    .join(", ")
  const failed = tools.filter((t) => t.result?.isError).length
  const sentence = text.charAt(0).toUpperCase() + text.slice(1)
  return failed ? `${sentence} (${failed} failed)` : sentence
}
