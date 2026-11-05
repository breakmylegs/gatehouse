import type { Item } from "./transcript"

/** A message as Chat's store keeps it (CH-02). */
export interface StoredMessage {
  id: string
  role: "user" | "assistant" | "system"
  createdAt: string
  blocks: Array<{ type: string; [key: string]: unknown }>
  redactions: number
}
export interface StoredStep {
  message: StoredMessage
  index: number
  siblings: string[]
}
export interface StoredAttachment {
  fileName: string
  fileType: string | null
  size: number | null
  text: string | null
  included: boolean
}

const str = (v: unknown) => (typeof v === "string" ? v : "")

/**
 * A stored conversation as the items a native chat is drawn from (CH-05: the same renderer as native chat), so an
 * imported chat reads the same: your messages, Claude's words, thinking folded away, and each tool call with its
 * result, Claude in the cloud's steps among them. A file the export did not carry says so; a part Codehouse does not
 * know is shown folded, by its kind, and never run.
 */
export function toItems(
  steps: StoredStep[],
  attachments: Record<string, StoredAttachment[]> = {},
): Item[] {
  const out: Item[] = []
  for (const { message: m } of steps) {
    const at = Date.parse(m.createdAt)
    const notes: string[] = []
    if (m.role === "user") {
      const text = m.blocks
        .filter((b) => b.type === "text")
        .map((b) => str(b.text))
        .join("\n\n")
      out.push({ id: m.id, kind: "user", at, text })
    }
    const open: Array<Extract<Item, { kind: "tool" }>> = []
    m.blocks.forEach((b, i) => {
      const id = `${m.id}-${i}`
      if (b.type === "text" && m.role !== "user")
        out.push({ id, kind: "text", at, text: str(b.text) })
      else if (b.type === "thinking") out.push({ id, kind: "thinking", at, text: str(b.text) })
      else if (b.type === "tool_use") {
        const tool: Extract<Item, { kind: "tool" }> = {
          id,
          kind: "tool",
          at,
          toolUseId: id,
          // Steps Claude took in the cloud carry their own label, so they are not taken for this computer's.
          name: b.cloud === true ? `Cloud: ${str(b.name)}` : str(b.name),
          input: (b.input && typeof b.input === "object" ? b.input : {}) as Record<string, unknown>,
        }
        out.push(tool)
        open.push(tool)
      } else if (b.type === "tool_result") {
        const tool = open.shift()
        if (tool) tool.result = { text: str(b.text), isError: b.isError === true }
      } else if (b.type === "file")
        notes.push(`A ${str(b.kind) || "file"}: File content not included in the export.`)
      else if (b.type === "other")
        out.push({
          id,
          kind: "thinking",
          at,
          text: `A part Codehouse does not show (${str(b.kind)}). It is kept as it came.`,
        })
    })
    for (const a of attachments[m.id] ?? [])
      notes.push(
        a.included
          ? `Attached ${a.fileName}: its text came with the export.`
          : `Attached ${a.fileName}: File content not included in the export.`,
      )
    if (m.redactions)
      notes.push(
        `${m.redactions} private ${m.redactions === 1 ? "word was" : "words were"} taken out of this message.`,
      )
    for (const [i, text] of notes.entries())
      out.push({ id: `${m.id}-note-${i}`, kind: "system", at, text })
  }
  return out
}

/** The shown branch as Markdown, to keep or send (CH-05). */
export function toMarkdown(title: string, steps: StoredStep[]): string {
  const parts = [`# ${title || "Untitled chat"}`, ""]
  for (const { message: m } of steps) {
    const words = m.blocks
      .filter((b) => b.type === "text")
      .map((b) => str(b.text))
      .join("\n\n")
    if (!words.trim()) continue
    parts.push(`## ${m.role === "user" ? "You" : "Claude"}`, "", words, "")
  }
  return parts.join("\n")
}
