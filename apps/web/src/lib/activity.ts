/**
 * What a session is doing right now, read from the SDK's stream, so the workspace can say so while a turn runs.
 * Claude can spend minutes writing one large file before anything else arrives; without this the screen showed
 * nothing at all in that time (29 Oct).
 *
 * Only the main conversation counts. A subagent's messages carry parent_tool_use_id and are left out, so its
 * work shows as the Task call that started it.
 */
export type Activity =
  /** Your prompt is sent and nothing has come back yet. */
  | { phase: "sent"; since: number }
  | { phase: "thinking"; since: number }
  | { phase: "replying"; since: number }
  /** Claude is writing the input of a tool call: for Write, the whole file. */
  | {
      phase: "preparing"
      since: number
      tool: string
      chars: number
      target?: string
      head: string
    }
  /** The call is complete and is being checked, waiting for you, or running. */
  | { phase: "running"; since: number; tool: string; toolUseId: string; target?: string }

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const str = (v: unknown): string => (typeof v === "string" ? v : "")

/** The start of a tool's input is kept to find its target; the rest is only counted. */
const HEAD = 2000
const TARGET_KEYS = ["file_path", "notebook_path", "path", "command", "pattern", "url", "query"]

/** The file, command or address a call acts on, cut to one short line. */
export function targetOf(input: Record<string, unknown>): string | undefined {
  for (const k of TARGET_KEYS) {
    const v = input[k]
    if (typeof v === "string" && v.trim()) return shorten(v)
  }
  return undefined
}

function shorten(v: string): string {
  const line = v.trim().split("\n")[0] ?? ""
  return line.length > 80 ? `${line.slice(0, 79)}…` : line
}

/** The same from the start of a JSON text that is still arriving. */
function targetFromHead(head: string): string | undefined {
  for (const k of TARGET_KEYS) {
    const m = new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(head)
    if (m?.[1]) {
      try {
        return shorten(JSON.parse(`"${m[1]}"`) as string)
      } catch {
        return shorten(m[1])
      }
    }
  }
  return undefined
}

/** The next activity after one SDK message. The same object comes back when nothing changed. */
export function nextActivity(
  a: Activity | undefined,
  message: unknown,
  now: number,
): Activity | undefined {
  const m = obj(message)
  if (typeof m.parent_tool_use_id === "string") return a
  const type = str(m.type)
  if (type === "result") return undefined
  if (type === "stream_event") {
    const e = obj(m.event)
    const et = str(e.type)
    if (et === "message_start")
      return a?.phase === "thinking" ? a : { phase: "thinking", since: now }
    if (et === "content_block_start") {
      const b = obj(e.content_block)
      const bt = str(b.type)
      if (bt === "tool_use" || bt === "server_tool_use")
        return { phase: "preparing", since: now, tool: str(b.name) || "a tool", chars: 0, head: "" }
      if (bt === "text") return a?.phase === "replying" ? a : { phase: "replying", since: now }
      if (bt === "thinking" || bt === "redacted_thinking")
        return a?.phase === "thinking" ? a : { phase: "thinking", since: now }
      return a
    }
    if (et === "content_block_delta" && a?.phase === "preparing") {
      const d = obj(e.delta)
      if (str(d.type) !== "input_json_delta") return a
      const part = str(d.partial_json)
      if (!part) return a
      const head = a.head.length < HEAD ? (a.head + part).slice(0, HEAD) : a.head
      const target = a.target ?? (head !== a.head ? targetFromHead(head) : undefined)
      return { ...a, chars: a.chars + part.length, head, ...(target ? { target } : {}) }
    }
    return a
  }
  if (type === "assistant") {
    const content = obj(m.message).content
    if (!Array.isArray(content)) return a
    // The last tool call in the message is the one that runs next; text after it is rare.
    for (let i = content.length - 1; i >= 0; i--) {
      const b = obj(content[i])
      if (b.type === "tool_use") {
        const target = targetOf(obj(b.input))
        return {
          phase: "running",
          since: now,
          tool: str(b.name) || "a tool",
          toolUseId: str(b.id),
          ...(target ? { target } : {}),
        }
      }
    }
    return a
  }
  if (type === "user") {
    // A tool result: Claude reads it and carries on.
    const content = obj(m.message).content
    if (Array.isArray(content) && content.some((c) => obj(c).type === "tool_result"))
      return { phase: "thinking", since: now }
  }
  return a
}

/** What to call a tool in a sentence. */
function toolWords(tool: string): string {
  if (tool === "Bash" || tool === "PowerShell") return "a shell command"
  if (tool.startsWith("mcp__")) return tool.split("__").slice(2).join(" ") || tool
  return tool
}

/** A path inside the session's folder, written from that folder: src\app.ts rather than the whole path. */
function inside(target: string, cwd: string | undefined): string {
  if (!cwd) return target
  const t = target.replaceAll("/", "\\")
  const b = cwd.replaceAll("/", "\\").replace(/\\+$/, "")
  return t.toLowerCase().startsWith(`${b.toLowerCase()}\\`) ? t.slice(b.length + 1) : target
}

const seconds = (since: number, now: number) => Math.max(0, Math.round((now - since) / 1000))
const n = (x: number) => x.toLocaleString("en-GB")

/**
 * The line the workspace shows. The label changes only when the phase does, so it can be announced; the detail
 * (seconds, characters) changes all the time and is not.
 */
export function describeActivity(
  a: Activity | undefined,
  now: number,
  cwd?: string,
): { label: string; detail: string; hint?: string } {
  if (!a) return { label: "Working", detail: "" }
  const s = seconds(a.since, now)
  const where =
    (a.phase === "preparing" || a.phase === "running") && a.target ? inside(a.target, cwd) : ""
  const target = where ? ` (${where})` : ""
  switch (a.phase) {
    case "sent":
      return {
        label: "Sent. Waiting for Claude to start",
        detail: `${s} s`,
        ...(s >= 20
          ? { hint: "The first answer in a session often takes longer than the rest." }
          : {}),
      }
    case "thinking":
      return { label: "Claude is thinking", detail: `${s} s` }
    case "replying":
      return { label: "Claude is writing a reply", detail: `${s} s` }
    case "preparing":
      return {
        label:
          a.tool === "Write" && where
            ? `Claude is writing ${where}`
            : `Claude is preparing ${toolWords(a.tool)}${target}`,
        detail: `${n(a.chars)} characters so far, ${s} s`,
        ...(s >= 30 && a.chars > 5000
          ? {
              hint: "Claude writes the whole file before JCVC can check it, so a large one takes a while.",
            }
          : {}),
      }
    case "running":
      return { label: `Running ${toolWords(a.tool)}${target}`, detail: `${s} s` }
  }
}

/** When anything last arrived in this turn, and the tokens Claude has written in it. */
export interface Pulse {
  last: number
  /** Output tokens of the messages finished in this turn. */
  done: number
  /** Output tokens of the message being written now. */
  now: number
}

/** The next pulse after one SDK message. A result ends the turn and its pulse. */
export function nextPulse(p: Pulse | undefined, message: unknown, at: number): Pulse | undefined {
  const m = obj(message)
  if (str(m.type) === "result") return undefined
  const base = p ?? { last: at, done: 0, now: 0 }
  if (str(m.type) !== "stream_event") return { ...base, last: at }
  const e = obj(m.event)
  if (str(e.type) === "message_start") return { last: at, done: base.done + base.now, now: 0 }
  const out = obj(e.usage).output_tokens
  if (str(e.type) === "message_delta" && typeof out === "number")
    return { ...base, last: at, now: out }
  return { ...base, last: at }
}

/** After this long with nothing arriving and nothing waiting on you, a turn is called possibly stuck. */
export const STALL_MS = 120_000

/** "2.5k tokens" and "last activity 40 s ago" for the live line, and whether it looks stuck. */
export function describePulse(
  p: Pulse | undefined,
  at: number,
): { tokens?: string; quiet?: string; stuck: boolean } {
  if (!p) return { stuck: false }
  const total = p.done + p.now
  const quietMs = at - p.last
  return {
    ...(total > 0
      ? { tokens: total < 1000 ? `${total} tokens` : `${(total / 1000).toFixed(1)}k tokens` }
      : {}),
    ...(quietMs >= 10_000 ? { quiet: `last activity ${Math.round(quietMs / 1000)} s ago` } : {}),
    stuck: quietMs >= STALL_MS,
  }
}
