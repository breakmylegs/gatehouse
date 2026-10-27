/**
 * Turns the SDK's message stream into a flat list of things to show. The SDK shapes are only read
 * defensively: anything unexpected becomes a plain "system" line rather than an exception.
 */
export type Item =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "text"; text: string; subagent?: string }
  | { id: string; kind: "thinking"; text: string }
  | {
      id: string
      kind: "tool"
      toolUseId: string
      name: string
      input: Record<string, unknown>
      result?: { text: string; isError: boolean }
      subagent?: string
    }
  | { id: string; kind: "result"; text: string; isError: boolean; costUsd?: number; turns?: number }
  | { id: string; kind: "system"; text: string }

export interface Todo {
  content: string
  status: "pending" | "in_progress" | "completed"
}

export interface Transcript {
  items: Item[]
  todos: Todo[]
  seq: number
}

export const MAX_ITEMS = 3000

export const emptyTranscript = (): Transcript => ({ items: [], todos: [], seq: 0 })

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const str = (v: unknown): string => (typeof v === "string" ? v : "")

function resultText(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content))
    return content
      .map((c) =>
        obj(c).type === "text" ? str(obj(c).text) : `[${str(obj(c).type) || "content"}]`,
      )
      .join("\n")
  return ""
}

export function addUser(t: Transcript, text: string): Transcript {
  return push(t, [{ id: `u${t.seq}`, kind: "user", text }])
}

function push(t: Transcript, add: Item[], todos?: Todo[]): Transcript {
  let items = add.length ? [...t.items, ...add] : t.items
  if (items.length > MAX_ITEMS) items = items.slice(items.length - MAX_ITEMS)
  return { items, todos: todos ?? t.todos, seq: t.seq + 1 }
}

export function reduce(t: Transcript, message: unknown): Transcript {
  const m = obj(message)
  const type = str(m.type)
  const sub = typeof m.parent_tool_use_id === "string" ? m.parent_tool_use_id : undefined
  if (type === "assistant") {
    const content = obj(m.message).content
    if (!Array.isArray(content)) return t
    const add: Item[] = []
    let todos: Todo[] | undefined
    content.forEach((c, i) => {
      const b = obj(c)
      const id = `a${t.seq}.${i}`
      if (b.type === "text" && str(b.text))
        add.push({ id, kind: "text", text: str(b.text), ...(sub ? { subagent: sub } : {}) })
      else if (b.type === "thinking" && str(b.thinking))
        add.push({ id, kind: "thinking", text: str(b.thinking) })
      else if (b.type === "tool_use") {
        const input = obj(b.input)
        if (b.name === "TodoWrite" && Array.isArray(input.todos))
          todos = input.todos.map((x) => ({
            content: str(obj(x).content),
            status: (["pending", "in_progress", "completed"].includes(str(obj(x).status))
              ? str(obj(x).status)
              : "pending") as Todo["status"],
          }))
        add.push({
          id,
          kind: "tool",
          toolUseId: str(b.id),
          name: str(b.name) || "tool",
          input,
          ...(sub ? { subagent: sub } : {}),
        })
      }
    })
    return push(t, add, todos)
  }
  if (type === "user") {
    const content = obj(m.message).content
    if (!Array.isArray(content)) return t
    let items = t.items
    let changed = false
    for (const c of content) {
      const b = obj(c)
      if (b.type !== "tool_result") continue
      const idx = items.findLastIndex(
        (x) => x.kind === "tool" && x.toolUseId === str(b.tool_use_id),
      )
      if (idx < 0) continue
      const it = items[idx] as Extract<Item, { kind: "tool" }>
      if (items === t.items) items = [...items]
      items[idx] = { ...it, result: { text: resultText(b.content), isError: b.is_error === true } }
      changed = true
    }
    return changed ? { ...t, items, seq: t.seq + 1 } : t
  }
  if (type === "result") {
    const isError = m.is_error === true || str(m.subtype).startsWith("error")
    return push(t, [
      {
        id: `r${t.seq}`,
        kind: "result",
        text: str(m.result) || (isError ? "The turn ended with an error" : "Done"),
        isError,
        ...(typeof m.total_cost_usd === "number" ? { costUsd: m.total_cost_usd } : {}),
        ...(typeof m.num_turns === "number" ? { turns: m.num_turns } : {}),
      },
    ])
  }
  return t
}

export function addSystem(t: Transcript, text: string): Transcript {
  return push(t, [{ id: `s${t.seq}`, kind: "system", text }])
}
