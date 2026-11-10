import type { ChatStore, ContentBlock } from "./db.js"

/** What the recorder needs to know about a session. */
export interface RecordedSession {
  kind?: "code" | "chat"
  /** The folder it runs in. */
  cwd?: string
  title?: string
  model?: string
  sdkSessionId?: string
  /** The SDK session it resumes: after a restart, or the branch a fork is taken from. */
  historyFrom?: string
  /** With a fork: the SDK message it carries on from (Retry and Edit). */
  historyUntil?: string
  /** The session it replaces in its pane (Retry and Edit), so the new branch stays in the same conversation. */
  replaces?: string
  /** CH-07: carried on from an imported chat: a new conversation that says where it came from. */
  forkOf?: { conversation: string; message: string }
  local?: boolean
  evaluation?: unknown
}

interface Live {
  conversationId: string
  leaf: string | null
  blocks: ContentBlock[]
  lastUuid?: string
  model?: string
}

/** How much of a tool's answer is kept: enough to see what it was, not whole pages. */
const RESULT_CHARS = 2000

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)

function resultText(content: unknown): string {
  if (typeof content === "string") return content.slice(0, RESULT_CHARS)
  if (Array.isArray(content))
    return content
      .map((c) => str((c as { text?: unknown }).text) ?? "")
      .join("\n")
      .slice(0, RESULT_CHARS)
  return ""
}

/**
 * CH-03 (ADR 0015): writes every native chat into Chat's own store as it happens, so search and the branch view never
 * depend on reading Claude Code's own files, and Codehouse never writes into them. Each of your messages is stored
 * when you send it; Claude's reply (its text, thinking, tool calls and a short part of each tool's answer) when the
 * turn ends. A Retry or Edit is a sibling in the same conversation, at the message the fork carries on from. The store
 * redacts everything before it is written. A failure here is logged and never stops the chat.
 */
export class ChatRecorder {
  readonly #live = new Map<string, Live>()

  constructor(
    private readonly store: ChatStore,
    private readonly info: (sessionId: string) => RecordedSession | undefined,
    private readonly log: (line: string) => void,
  ) {}

  /** Where this chat's next message goes: found once per session, then remembered. */
  #place(sessionId: string, firstText?: string): Live | undefined {
    const known = this.#live.get(sessionId)
    if (known) return known
    const info = this.info(sessionId)
    if (!info || info.kind !== "chat" || info.evaluation) return undefined
    let place: Live | undefined
    // A fork (Retry or Edit) carries on from the reply it was taken at.
    const at = info.historyUntil ? this.store.bySdkUuid(info.historyUntil) : undefined
    if (at) place = { conversationId: at.conversationId, leaf: at.id, blocks: [] }
    // Brought back after a restart, or a branch you switched to: it carries on where its SDK session ended.
    if (!place && info.historyFrom && !info.historyUntil) {
      const last = this.store.lastInSdkSession(info.historyFrom)
      if (last) place = { conversationId: last.conversationId, leaf: last.id, blocks: [] }
    }
    // Retry or Edit of the first message: a new first message in the same conversation.
    if (!place && info.replaces && !info.historyFrom) {
      const before = this.#live.get(info.replaces)
      if (before) place = { conversationId: before.conversationId, leaf: null, blocks: [] }
    }
    if (!place) {
      const c = this.store.createConversation({
        title: info.title ?? (firstText ?? "").slice(0, 120),
        provenance: info.forkOf
          ? {
              kind: "fork",
              fromConversation: info.forkOf.conversation,
              fromMessage: info.forkOf.message,
            }
          : { kind: "native" },
        ...(info.sdkSessionId ? { sdkSessionId: info.sdkSessionId } : {}),
      })
      place = { conversationId: c.id, leaf: null, blocks: [] }
    }
    this.#live.set(sessionId, place)
    return place
  }

  /** You sent a message in a chat. */
  prompted(sessionId: string, text: string): void {
    try {
      const place = this.#place(sessionId, text)
      if (!place) return
      const info = this.info(sessionId)
      const m = this.store.addMessage(place.conversationId, {
        parentId: place.leaf,
        role: "user",
        blocks: [{ type: "text", text }],
        ...(info?.sdkSessionId ? { sdkSessionId: info.sdkSessionId } : {}),
        ...(info?.cwd ? { cwd: info.cwd } : {}),
      })
      place.leaf = m.id
    } catch (e) {
      this.log(`chat store: your message was not recorded (${(e as Error).message})`)
    }
  }

  /** A message from the session's Claude Code. */
  message(sessionId: string, m: Record<string, unknown>): void {
    const place = this.#live.get(sessionId)
    if (!place) return
    try {
      const type = m.type
      // A subagent's own steps and replayed history are not part of this conversation's record.
      if (m.parent_tool_use_id || m.isReplay === true) return
      const inner = (m.message ?? {}) as { content?: unknown; model?: unknown }
      if (type === "assistant") {
        if (str(m.uuid)) place.lastUuid = str(m.uuid)
        if (str(inner.model)) place.model = str(inner.model)
        for (const b of Array.isArray(inner.content) ? inner.content : []) {
          const block = b as Record<string, unknown>
          if (block.type === "text" && str(block.text))
            place.blocks.push({ type: "text", text: str(block.text)! })
          else if (block.type === "thinking" && str(block.thinking))
            place.blocks.push({ type: "thinking", text: str(block.thinking)! })
          else if (block.type === "tool_use")
            place.blocks.push({
              type: "tool_use",
              name: str(block.name) ?? "",
              input: block.input ?? {},
            })
        }
      } else if (type === "user") {
        if (str(m.uuid)) place.lastUuid = str(m.uuid)
        for (const b of Array.isArray(inner.content) ? inner.content : []) {
          const block = b as Record<string, unknown>
          if (block.type === "tool_result")
            place.blocks.push({ type: "tool_result", text: resultText(block.content) })
        }
      } else if (type === "result") this.#flush(sessionId, place)
    } catch (e) {
      this.log(`chat store: a reply was not recorded (${(e as Error).message})`)
    }
  }

  #flush(sessionId: string, place: Live): void {
    if (!place.blocks.length) return
    const info = this.info(sessionId)
    const m = this.store.addMessage(place.conversationId, {
      parentId: place.leaf,
      role: "assistant",
      blocks: place.blocks,
      provider: info?.local ? "local" : "anthropic",
      ...((place.model ?? info?.model) ? { model: (place.model ?? info?.model)! } : {}),
      ...(place.lastUuid ? { sdkUuid: place.lastUuid } : {}),
      ...(info?.sdkSessionId ? { sdkSessionId: info.sdkSessionId } : {}),
      ...(info?.cwd ? { cwd: info.cwd } : {}),
    })
    place.leaf = m.id
    place.blocks = []
  }

  /** The conversation a session is recording into, if it has started one. */
  conversationOf(sessionId: string): string | undefined {
    return this.#live.get(sessionId)?.conversationId
  }

  /** A session closed: nothing more is recorded for it. */
  closed(sessionId: string): void {
    this.#live.delete(sessionId)
  }
}
