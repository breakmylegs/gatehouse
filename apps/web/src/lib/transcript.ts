/**
 * Turns the SDK's message stream into a flat list of things to show. The SDK shapes are only read
 * defensively: anything unexpected becomes a plain "system" line rather than an exception.
 */
/**
 * A picture to show: one you attached, or one a tool gave back (a page Claude captured, a picture it read). One you
 * attached comes back after a restart by its place in the session folder, shown through the folder's preview address.
 */
export interface Picture {
  name: string
  /** Ready to show: a blob or data address. */
  url?: string
  /** Its place in the session folder, when it has no address yet. */
  path?: string
}

export type Item =
  | {
      id: string
      kind: "user"
      at?: number
      text: string
      images?: Picture[]
      /** Sent while Claude worked, and not yet taken in: Claude reads it at its next step. */
      queued?: boolean
    }
  | { id: string; kind: "text"; at?: number; text: string; subagent?: string }
  | { id: string; kind: "thinking"; at?: number; text: string }
  | {
      id: string
      kind: "tool"
      at?: number
      toolUseId: string
      name: string
      input: Record<string, unknown>
      result?: { text: string; isError: boolean; images?: Picture[] }
      subagent?: string
    }
  | {
      id: string
      kind: "result"
      at?: number
      text: string
      isError: boolean
      /** The turn was stopped on purpose, by you or the kill switch, so it is not an error. */
      stopped?: boolean
      costUsd?: number
      turns?: number
    }
  | { id: string; kind: "system"; at?: number; text: string }

export interface Todo {
  content: string
  status: "pending" | "in_progress" | "completed"
}

export interface Transcript {
  items: Item[]
  todos: Todo[]
  seq: number
  /** Who stopped the running turn, until its result arrives. */
  stopping?: "you" | "kill-switch"
  /** A tool result came back after a queued message was sent: Claude's next answer has seen it. */
  pickup?: boolean
}

export const MAX_ITEMS = 3000

export const emptyTranscript = (): Transcript => ({ items: [], todos: [], seq: 0 })

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const str = (v: unknown): string => (typeof v === "string" ? v : "")

/** Pictures a tool may give back, and the largest one kept (as base64), so a long session stays light enough. */
const PICTURE_TYPES = /^image\/(png|jpeg|gif|webp)$/
const MAX_PICTURE = 8_000_000
const MAX_PICTURES = 4

/** A picture block as a data address, in the API's shape or the MCP one, or nothing when it cannot be shown. */
function pictureOf(c: unknown): string | undefined {
  const b = obj(c)
  if (b.type !== "image") return undefined
  const src = obj(b.source)
  const type = str(src.media_type) || str(b.mimeType)
  const data = src.type === "base64" ? str(src.data) : str(b.data)
  if (!PICTURE_TYPES.test(type) || !data || data.length > MAX_PICTURE) return undefined
  return `data:${type};base64,${data}`
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content))
    return content
      .map((c) =>
        obj(c).type === "text"
          ? str(obj(c).text)
          : pictureOf(c)
            ? undefined
            : `[${str(obj(c).type) || "content"}]`,
      )
      .filter((x): x is string => x !== undefined)
      .join("\n")
  return ""
}

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).at(-1) ?? p

/** The pictures in a tool's result, named by the file it read or as a capture. */
function resultPictures(content: unknown, tool: { name: string; input: Record<string, unknown> }): Picture[] {
  if (!Array.isArray(content)) return []
  const file = str(tool.input.file_path)
  const name = tool.name === "Read" && file ? baseName(file) : "Picture Claude captured"
  return content
    .map(pictureOf)
    .filter((u): u is string => u !== undefined)
    .slice(0, MAX_PICTURES)
    .map((url) => ({ url, name }))
}

/** A picture you mentioned: @ and a place in the session folder, never one outside it. */
const MENTIONED = /(^|\s)@([^\s@"'<>|:*?\\]+\.(?:png|jpe?g|gif|webp))(?=\s|$)/gi

function pictureName(rel: string): string {
  const base = baseName(rel)
  if (!rel.startsWith(".jcvc/attachments/")) return base
  const named = base.replace(/^[0-9a-f]{6}-/i, "")
  return /^(image|pasted)\.\w+$/i.test(named) ? "Pasted picture" : named
}

/**
 * The pictures mentioned in what you sent, taken out of the words, so your message shows them as pictures (as it did
 * when you sent it) after a restart reads it back.
 */
export function splitPictures(text: string): { text: string; images: Picture[] } {
  const images: Picture[] = []
  const rest = text.replace(MENTIONED, (whole, lead: string, rel: string) => {
    if (rel.startsWith("/") || rel.split("/").includes("..")) return whole
    images.push({ path: rel, name: pictureName(rel) })
    return lead
  })
  if (!images.length) return { text, images }
  return {
    text: rest
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    images,
  }
}

export function addUser(
  t: Transcript,
  said: string,
  attached?: Picture[],
  queued = false,
): Transcript {
  // A message sent mid-turn leaves the turn as it was; one that starts a turn ends any stop that was under way.
  const { stopping: _done, ...rest } = t
  const { text, images: mentioned } = splitPictures(said)
  const images = [...(attached ?? []), ...mentioned]
  return push(queued ? t : rest, [
    {
      id: `u${t.seq}`,
      kind: "user",
      text,
      ...(images.length ? { images } : {}),
      ...(queued ? { queued: true } : {}),
    },
  ])
}

/**
 * Claude Code takes a queued message in between tool calls and says nothing when it does (probe, 30 Oct). So it
 * counts as taken in once a tool result has come back after it and Claude has answered again, or the turn ends.
 */
function delivered(t: Transcript): Transcript {
  if (!t.items.some((i) => i.kind === "user" && i.queued)) return t
  const { pickup: _p, ...rest } = t
  return {
    ...rest,
    items: t.items.map((i) => (i.kind === "user" && i.queued ? { ...i, queued: false } : i)),
  }
}
const hasQueued = (t: Transcript) => t.items.some((i) => i.kind === "user" && i.queued)

/** The Host stopped the running turn: its result says so, instead of reading as an error. */
export function markStopping(t: Transcript, by: "you" | "kill-switch"): Transcript {
  return { ...t, stopping: by }
}

/** Words for a turn that failed without saying why, by the SDK's subtype. */
const FAILED: Record<string, string> = {
  error_max_turns: "Claude reached the most steps a turn may take.",
  error_max_budget_usd: "Claude reached the spending limit for the turn.",
  error_max_structured_output_retries: "Claude could not give its answer in the shape asked for.",
}

/** Each item notes when it arrived, for the time shown beside it. */
function push(t: Transcript, add: Item[], todos?: Todo[], at: number = Date.now()): Transcript {
  let items = add.length ? [...t.items, ...add.map((i) => (i.at ? i : { ...i, at }))] : t.items
  if (items.length > MAX_ITEMS) items = items.slice(items.length - MAX_ITEMS)
  return { ...t, items, todos: todos ?? t.todos, seq: t.seq + 1 }
}

export function reduce(t: Transcript, message: unknown): Transcript {
  const m = obj(message)
  const type = str(m.type)
  const sub = typeof m.parent_tool_use_id === "string" ? m.parent_tool_use_id : undefined
  if (type === "assistant" && t.pickup && !sub) t = delivered(t)
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
      const images = resultPictures(b.content, it)
      items[idx] = {
        ...it,
        result: {
          text: resultText(b.content),
          isError: b.is_error === true,
          ...(images.length ? { images } : {}),
        },
      }
      changed = true
    }
    if (changed && !sub && hasQueued(t)) return { ...t, items, seq: t.seq + 1, pickup: true }
    return changed ? { ...t, items, seq: t.seq + 1 } : t
  }
  if (type === "system" && str(m.subtype) === "compact_boundary")
    return addSystem(t, "Claude Code summarised the earlier conversation to make room.")
  if (type === "result") {
    const { stopping, ...rest } = delivered(t)
    const failed = m.is_error === true || str(m.subtype).startsWith("error")
    const isError = failed && !stopping
    return push(rest, [
      {
        id: `r${t.seq}`,
        kind: "result",
        text: stopping
          ? stopping === "you"
            ? "You stopped this turn."
            : "The kill switch stopped this turn."
          : str(m.result) ||
            (isError ? (FAILED[str(m.subtype)] ?? "Claude Code did not say why.") : "Done"),
        isError,
        ...(stopping ? { stopped: true } : {}),
        ...(typeof m.total_cost_usd === "number" ? { costUsd: m.total_cost_usd } : {}),
        ...(typeof m.num_turns === "number" ? { turns: m.num_turns } : {}),
      },
    ])
  }
  return t
}

/**
 * One message of an earlier conversation, read back from Claude Code's transcript. What you typed comes back too
 * (the live stream only echoes tool results); Claude Code's own wrappers, which start with "<", are left out.
 */
export function reduceHistory(t: Transcript, message: unknown): Transcript {
  const m = obj(message)
  if (str(m.type) === "user" && !m.parent_tool_use_id) {
    const content = obj(m.message).content
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content) && !content.some((c) => obj(c).type === "tool_result")
          ? content
              .filter((c) => obj(c).type === "text")
              .map((c) => str(obj(c).text))
              .join("\n")
          : undefined
    if (text !== undefined) {
      const said = text.trim()
      if (!said || said.startsWith("<")) return t
      if (said.startsWith("[Request interrupted")) return addSystem(t, "You stopped this turn.")
      // Claude Code's summary after compacting is written as a message from you; it is not one.
      if (said.startsWith("This session is being continued from a previous conversation"))
        return addSystem(t, "Claude Code summarised the earlier conversation to make room.")
      return addUser(t, said)
    }
  }
  return reduce(t, message)
}

/**
 * An earlier conversation put before what this session has shown so far. Its items carry no time, because JCVC did
 * not see them arrive.
 */
export function withHistory(t: Transcript | undefined, past: Transcript): Transcript {
  const now = t ?? emptyTranscript()
  const earlier = past.items.map(({ at: _at, ...i }) => ({ ...i, id: "h" + i.id }) as Item)
  let items = [...earlier, ...now.items]
  if (items.length > MAX_ITEMS) items = items.slice(items.length - MAX_ITEMS)
  return { ...now, items, todos: now.todos.length ? now.todos : past.todos, seq: now.seq + 1 }
}

export function addSystem(t: Transcript, text: string): Transcript {
  return push(t, [{ id: `s${t.seq}`, kind: "system", text }])
}
