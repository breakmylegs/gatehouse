import type { ContentBlock } from "../db.js"

/**
 * CH-04: one claude.ai conversation, project or memory record, as the export has it (observed, not guaranteed: the
 * owner's report, sections 7.3 to 7.6), turned into what Chat's store keeps. Unknown fields stay in the raw JSON;
 * unknown content kinds are kept as a generic block; nothing in a block is ever run. A record missing what it must
 * have is skipped with the reason.
 */

export const ROOT = "00000000-0000-4000-8000-000000000000"

export interface ImportedMessage {
  sourceUuid: string
  parentSourceUuid: string | null
  role: "user" | "assistant"
  createdAt: string
  blocks: ContentBlock[]
  attachments: Array<{
    fileName: string
    fileType?: string
    size?: number
    text?: string
    included: boolean
  }>
  raw: unknown
}

export interface ImportedArtifact {
  key: string
  title: string
  type: string
  versions: Array<{ content: string; createdAt: string; messageSourceUuid: string }>
}

export interface ImportedConversation {
  sourceUuid: string
  title: string
  createdAt: string
  updatedAt: string
  messages: ImportedMessage[]
  /** Where the shown branch ends: the newest child at every fork, from the newest root. */
  activeLeaf: string | null
  artifacts: ImportedArtifact[]
  raw: unknown
}

export interface ImportedProject {
  sourceUuid: string
  name: string
  description: string
  /** Kept inactive until you accept it (the prompt's "untrusted instructions"). */
  instructions: string
  docs: Array<{ fileName: string; text: string }>
  createdAt: string
  updatedAt: string
  raw: unknown
}

export interface ImportedMemory {
  scope: "global" | { projectSourceUuid: string }
  text: string
}

export type Skipped = { what: string; why: string }

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)
const obj = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const when = (v: unknown): string | undefined => {
  const s = str(v)
  return s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : undefined
}

/** A tool result's words: a string, or the text parts of a list. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content
  return arr(content)
    .map((c) => str(obj(c)?.text) ?? "")
    .filter(Boolean)
    .join("\n")
}

/** One content block, by its kind. A kind not known is kept whole, to show collapsed. */
export function mapBlock(b: unknown): ContentBlock | undefined {
  const o = obj(b)
  if (!o) return undefined
  const type = str(o.type) ?? "unknown"
  switch (type) {
    case "text":
      return {
        type: "text",
        text: str(o.text) ?? "",
        ...(Array.isArray(o.citations) && o.citations.length ? { citations: o.citations } : {}),
      }
    case "thinking":
      return { type: "thinking", text: str(o.thinking) ?? str(o.text) ?? "" }
    case "tool_use":
      return {
        type: "tool_use",
        name: str(o.name) ?? "",
        input: o.input ?? {},
        ...(str(o.integration_name) ? { integration: str(o.integration_name) } : {}),
        // Claude in the cloud carried on this chat (report section 1.2): its steps are shown as cloud steps.
        ...(str(o.mcp_server_url) ? { cloud: true } : {}),
      }
    case "tool_result":
      return {
        type: "tool_result",
        text: resultText(o.content),
        ...(o.is_error === true ? { isError: true } : {}),
      }
    case "image":
    case "document":
      return {
        type: "file",
        kind: type,
        fileUuid: str(o.file_uuid) ?? "",
        note: "File content not included in the export",
      }
    // Claude's own markers, not words anyone wrote.
    case "token_budget":
    case "flag":
      return undefined
    case "injected_prompt_block":
      return { type: "injected", source: str(o.injection_source) ?? "" }
    default:
      return { type: "other", kind: type, raw: o }
  }
}

/** A claude.ai artifact, from the tool call that made or changed it. */
function artifactCall(
  b: ContentBlock,
): { key: string; title?: string; type?: string; content?: string } | undefined {
  if (b.type !== "tool_use" || (b as { name?: string }).name !== "artifacts") return undefined
  const input = obj((b as { input?: unknown }).input) ?? {}
  const key = str(input.id)
  if (!key) return undefined
  return {
    key,
    ...(str(input.title) ? { title: str(input.title) } : {}),
    ...(str(input.type) ? { type: str(input.type) } : {}),
    ...(str(input.content) ? { content: str(input.content) } : {}),
  }
}

export function mapConversation(raw: unknown): ImportedConversation | Skipped {
  const c = obj(raw)
  const sourceUuid = str(c?.uuid)
  if (!c || !sourceUuid) return { what: "a conversation", why: "it has no uuid" }
  const createdAt = when(c.created_at)
  const updatedAt = when(c.updated_at) ?? createdAt
  if (!createdAt || !updatedAt)
    return { what: `conversation ${sourceUuid}`, why: "it has no date it was made" }
  const messages: ImportedMessage[] = []
  const seen = new Set<string>()
  for (const m of arr(c.chat_messages)) {
    const o = obj(m)
    const id = str(o?.uuid)
    const sender = str(o?.sender)
    const at = when(o?.created_at) ?? createdAt
    if (!o || !id || seen.has(id) || (sender !== "human" && sender !== "assistant")) continue
    seen.add(id)
    const content = arr(o.content)
    const blocks = (content.length ? content : [{ type: "text", text: str(o.text) ?? "" }])
      .map(mapBlock)
      .filter((b): b is ContentBlock => b !== undefined)
    const attachments = [
      ...arr(o.attachments).flatMap((a) => {
        const x = obj(a)
        const name = str(x?.file_name)
        return x && name
          ? [
              {
                fileName: name,
                ...(str(x.file_type) ? { fileType: str(x.file_type) } : {}),
                ...(typeof x.file_size === "number" ? { size: x.file_size } : {}),
                ...(str(x.extracted_content) !== undefined
                  ? { text: str(x.extracted_content) }
                  : {}),
                included: str(x.extracted_content) !== undefined,
              },
            ]
          : []
      }),
      ...arr(o.files).flatMap((f) => {
        const x = obj(f)
        const name = str(x?.file_name)
        return name ? [{ fileName: name, included: false }] : []
      }),
    ]
    const parent = str(o.parent_message_uuid)
    messages.push({
      sourceUuid: id,
      parentSourceUuid: !parent || parent === ROOT ? null : parent,
      role: sender === "human" ? "user" : "assistant",
      createdAt: at,
      blocks,
      attachments,
      raw: o,
    })
  }
  // A parent that is not in the export makes the message a root, so nothing is lost.
  for (const m of messages)
    if (m.parentSourceUuid && !seen.has(m.parentSourceUuid)) m.parentSourceUuid = null
  messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  // The shown branch: from the newest root, the newest child at each fork (there is no marker in the export).
  const children = new Map<string | null, ImportedMessage[]>()
  for (const m of messages)
    children.set(m.parentSourceUuid, [...(children.get(m.parentSourceUuid) ?? []), m])
  let leaf: ImportedMessage | undefined = children.get(null)?.at(-1)
  for (let guard = 0; leaf && guard < messages.length; guard++) {
    const next = children.get(leaf.sourceUuid)?.at(-1)
    if (!next) break
    leaf = next
  }
  // Artifacts: each call that made or changed one is a version, in the order they were made.
  const artifacts = new Map<string, ImportedArtifact>()
  for (const m of messages)
    for (const b of m.blocks) {
      const a = artifactCall(b)
      if (!a) continue
      const entry = artifacts.get(a.key) ?? {
        key: a.key,
        title: a.title ?? a.key,
        type: a.type ?? "text/markdown",
        versions: [],
      }
      if (a.title) entry.title = a.title
      if (a.type) entry.type = a.type
      if (a.content !== undefined)
        entry.versions.push({
          content: a.content,
          createdAt: m.createdAt,
          messageSourceUuid: m.sourceUuid,
        })
      artifacts.set(a.key, entry)
    }
  return {
    sourceUuid,
    title: str(c.name) || str(c.summary) || "Untitled chat",
    createdAt,
    updatedAt,
    messages,
    activeLeaf: leaf?.sourceUuid ?? null,
    artifacts: [...artifacts.values()].filter((a) => a.versions.length),
    raw: c,
  }
}

export function mapProject(raw: unknown): ImportedProject | Skipped {
  const p = obj(raw)
  const sourceUuid = str(p?.uuid)
  if (!p || !sourceUuid) return { what: "a project", why: "it has no uuid" }
  const createdAt = when(p.created_at) ?? new Date(0).toISOString()
  return {
    sourceUuid,
    name: str(p.name) || "Untitled project",
    description: str(p.description) ?? "",
    instructions: str(p.prompt_template) ?? "",
    docs: arr(p.docs).flatMap((d) => {
      const x = obj(d)
      const name = str(x?.filename) ?? str(x?.file_name)
      return x && name ? [{ fileName: name, text: str(x.content) ?? "" }] : []
    }),
    createdAt,
    updatedAt: when(p.updated_at) ?? createdAt,
    raw: p,
  }
}

/** memories.json: one object (or a list of them) with the memory for all chats and for each project. */
export function mapMemories(raw: unknown): ImportedMemory[] {
  const out: ImportedMemory[] = []
  for (const m of Array.isArray(raw) ? raw : [raw]) {
    const o = obj(m)
    if (!o) continue
    const all = str(o.conversations_memory)
    if (all?.trim()) out.push({ scope: "global", text: all })
    for (const [uuid, text] of Object.entries(obj(o.project_memories) ?? {}))
      if (typeof text === "string" && text.trim())
        out.push({ scope: { projectSourceUuid: uuid }, text })
  }
  return out
}

/** What kind of record a JSON file holds, from its first item: conversations, projects or memories. */
export function kindOf(
  first: unknown,
): "conversations" | "project" | "projects" | "memories" | undefined {
  const o = obj(first)
  if (Array.isArray(first)) {
    const head = obj(first[0])
    if (head && "chat_messages" in head) return "conversations"
    if (head && ("prompt_template" in head || "docs" in head)) return "projects"
    if (head && "conversations_memory" in head) return "memories"
    return undefined
  }
  if (o && "chat_messages" in o) return "conversations"
  if (o && ("prompt_template" in o || ("docs" in o && "uuid" in o))) return "project"
  if (o && "conversations_memory" in o) return "memories"
  return undefined
}
