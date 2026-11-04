import { randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { migrate } from "./migrations.js"
import { Tree, type BranchStep } from "./tree.js"

/**
 * Chat's own store (CH-02): conversations, their messages as a tree, projects, artifacts, memory and import batches,
 * in %LOCALAPPDATA%\Gatehouse\chat\chat.db. Everything is redacted before it is written (invariant 12). Imported
 * conversations are snapshots: nothing is added to them here, and a fork is always a new native conversation.
 */

/** Where a conversation came from (the owner's Chat build prompt, CH-02). */
export type Provenance =
  | { kind: "native" }
  | {
      kind: "imported"
      source: "claude.ai"
      sourceUuid: string
      exportDate: string
      importBatchId: string
    }
  | { kind: "fork"; fromConversation: string; fromMessage: string }

/** A message's content, kept as the parts it came in. Unknown kinds are kept as they are. */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_use"; name: string; input: unknown }
  | { type: "tool_result"; text: string }
  | { type: "attachment"; fileName: string }
  | { type: string; [key: string]: unknown }

export type Role = "user" | "assistant" | "system"

export interface Conversation {
  id: string
  kind: Provenance["kind"]
  title: string
  projectId: string | null
  pinned: boolean
  createdAt: string
  updatedAt: string
  activeLeaf: string | null
  provenance: Provenance
  sdkSessionId: string | null
}

export interface Message {
  id: string
  conversationId: string
  parentId: string | null
  seq: number
  role: Role
  createdAt: string
  provider: string | null
  model: string | null
  blocks: ContentBlock[]
  /** How many pieces of text redaction changed before this was stored. */
  redactions: number
  sdkUuid: string | null
  /** The SDK session (the branch) it belongs to. */
  sdkSessionId: string | null
}

export interface NewMessage {
  parentId: string | null
  role: Role
  blocks: ContentBlock[]
  provider?: string
  model?: string
  sdkUuid?: string
  sdkSessionId?: string
  raw?: unknown
  createdAt?: string
}

export interface SearchHit {
  conversationId: string
  messageId: string
  title: string
  kind: Provenance["kind"]
  snippet: string
}

export class ChatStoreError extends Error {}

export interface ChatStoreOptions {
  /** The database file. Its folder is made if it is missing. */
  file: string
  /** The same redaction as the audit log, with your own words (invariant 12). */
  redact: <T>(value: T) => T
  now?: () => string
  newId?: () => string
}

interface ConversationRow {
  id: string
  kind: Provenance["kind"]
  title: string
  project_id: string | null
  pinned: number
  created_at: string
  updated_at: string
  active_leaf: string | null
  provenance_json: string
  sdk_session_id: string | null
}

interface MessageRow {
  id: string
  conversation_id: string
  parent_id: string | null
  seq: number
  role: Role
  created_at: string
  provider: string | null
  model: string | null
  blocks_json: string
  redactions: number
  sdk_uuid: string | null
  sdk_session_id: string | null
}

/** How many strings differ between a value and its redacted copy. */
export function changedStrings(before: unknown, after: unknown): number {
  if (typeof before === "string") return before === after ? 0 : 1
  if (Array.isArray(before))
    return before.reduce<number>(
      (n, v, i) => n + changedStrings(v, Array.isArray(after) ? after[i] : undefined),
      0,
    )
  if (before && typeof before === "object") {
    const a = (after ?? {}) as Record<string, unknown>
    return Object.entries(before).reduce((n, [k, v]) => n + changedStrings(v, a[k]), 0)
  }
  return 0
}

/** The words a message can be found by: the text you and Claude wrote, not tool input or thinking. */
export function searchText(blocks: ContentBlock[]): string {
  return blocks
    .flatMap((b) => {
      const text = (b as { text?: unknown }).text
      return b.type === "text" && typeof text === "string" ? [text] : []
    })
    .join("\n")
}

/** Each word as a phrase, so what you type is never read as FTS5 syntax. */
export function ftsQuery(q: string): string {
  return q
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 16)
    .map((w) => `"${w.replace(/"/g, '""')}"`)
    .join(" ")
}

const toConversation = (r: ConversationRow): Conversation => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  projectId: r.project_id,
  pinned: r.pinned === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  activeLeaf: r.active_leaf,
  provenance: JSON.parse(r.provenance_json) as Provenance,
  sdkSessionId: r.sdk_session_id,
})

const toMessage = (r: MessageRow): Message => ({
  id: r.id,
  conversationId: r.conversation_id,
  parentId: r.parent_id,
  seq: r.seq,
  role: r.role,
  createdAt: r.created_at,
  provider: r.provider,
  model: r.model,
  blocks: JSON.parse(r.blocks_json) as ContentBlock[],
  redactions: r.redactions,
  sdkUuid: r.sdk_uuid,
  sdkSessionId: r.sdk_session_id,
})

export class ChatStore {
  readonly #db: DatabaseSync
  readonly #redact: ChatStoreOptions["redact"]
  readonly #now: () => string
  readonly #newId: () => string
  readonly version: number

  constructor(opts: ChatStoreOptions) {
    if (typeof opts.redact !== "function") throw new ChatStoreError("Chat storage needs redaction.")
    fs.mkdirSync(path.dirname(opts.file), { recursive: true })
    this.#db = new DatabaseSync(opts.file)
    this.#db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000")
    this.version = migrate(this.#db)
    this.#redact = opts.redact
    this.#now = opts.now ?? (() => new Date().toISOString())
    this.#newId = opts.newId ?? randomUUID
  }

  close(): void {
    this.#db.close()
  }

  #tx<T>(fn: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE")
    try {
      const out = fn()
      this.#db.exec("COMMIT")
      return out
    } catch (e) {
      this.#db.exec("ROLLBACK")
      throw e
    }
  }

  createConversation(input: {
    title?: string
    projectId?: string
    provenance: Provenance
    sdkSessionId?: string
    raw?: unknown
  }): Conversation {
    const id = this.#newId()
    const at = this.#now()
    this.#db
      .prepare(
        `INSERT INTO conversation (id, kind, title, project_id, created_at, updated_at, provenance_json, sdk_session_id, raw_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.provenance.kind,
        this.#redact(input.title ?? ""),
        input.projectId ?? null,
        at,
        at,
        JSON.stringify(input.provenance),
        input.sdkSessionId ?? null,
        input.raw === undefined ? null : JSON.stringify(this.#redact(input.raw)),
      )
    return this.conversation(id)!
  }

  conversation(id: string): Conversation | undefined {
    const r = this.#db.prepare("SELECT * FROM conversation WHERE id = ?").get(id) as
      ConversationRow | undefined
    return r ? toConversation(r) : undefined
  }

  /** Newest first, pinned ones on top. */
  listConversations(
    filter: { kind?: Provenance["kind"]; projectId?: string; limit?: number } = {},
  ) {
    const where: string[] = []
    const args: (string | number)[] = []
    if (filter.kind) {
      where.push("kind = ?")
      args.push(filter.kind)
    }
    if (filter.projectId) {
      where.push("project_id = ?")
      args.push(filter.projectId)
    }
    args.push(Math.min(Math.max(filter.limit ?? 200, 1), 1000))
    const rows = this.#db
      .prepare(
        `SELECT * FROM conversation ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY pinned DESC, updated_at DESC LIMIT ?`,
      )
      .all(...args) as unknown as ConversationRow[]
    return rows.map(toConversation)
  }

  /** Adds a message to a native or forked conversation and shows its branch. Imported ones are read only. */
  addMessage(conversationId: string, m: NewMessage): Message {
    return this.#tx(() => {
      const c = this.conversation(conversationId)
      if (!c) throw new ChatStoreError("No such conversation.")
      if (c.kind === "imported")
        throw new ChatStoreError(
          "An imported conversation is a read-only copy. Continue it as a new chat.",
        )
      if (m.parentId !== null) {
        const parent = this.#db
          .prepare("SELECT conversation_id FROM message WHERE id = ?")
          .get(m.parentId) as { conversation_id: string } | undefined
        if (parent?.conversation_id !== conversationId)
          throw new ChatStoreError("The message it follows is not in this conversation.")
      }
      const blocks = this.#redact(m.blocks)
      const id = this.#newId()
      const at = m.createdAt ?? this.#now()
      const seq = (
        this.#db
          .prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM message WHERE conversation_id = ?")
          .get(conversationId) as { n: number }
      ).n
      this.#db
        .prepare(
          `INSERT INTO message (id, conversation_id, parent_id, seq, role, created_at, provider, model, blocks_json, redactions, raw_json, sdk_uuid, sdk_session_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          conversationId,
          m.parentId,
          seq,
          m.role,
          at,
          m.provider ?? null,
          m.model ?? null,
          JSON.stringify(blocks),
          changedStrings(m.blocks, blocks),
          m.raw === undefined ? null : JSON.stringify(this.#redact(m.raw)),
          m.sdkUuid ?? null,
          m.sdkSessionId ?? null,
        )
      const text = searchText(blocks)
      if (text)
        this.#db
          .prepare("INSERT INTO message_fts (text, message_id, conversation_id) VALUES (?, ?, ?)")
          .run(text, id, conversationId)
      this.#db
        .prepare("UPDATE conversation SET active_leaf = ?, updated_at = ? WHERE id = ?")
        .run(id, at, conversationId)
      return this.#message(id)!
    })
  }

  #message(id: string): Message | undefined {
    const r = this.#db.prepare("SELECT * FROM message WHERE id = ?").get(id) as
      MessageRow | undefined
    return r ? toMessage(r) : undefined
  }

  /** The message an SDK message id belongs to: where a fork made at that point carries on from. */
  bySdkUuid(uuid: string): Message | undefined {
    const r = this.#db
      .prepare("SELECT * FROM message WHERE sdk_uuid = ? ORDER BY seq DESC LIMIT 1")
      .get(uuid) as MessageRow | undefined
    return r ? toMessage(r) : undefined
  }

  /** The newest message of an SDK session: where a session brought back after a restart carries on. */
  lastInSdkSession(sdkSessionId: string): Message | undefined {
    const r = this.#db
      .prepare("SELECT * FROM message WHERE sdk_session_id = ? ORDER BY seq DESC LIMIT 1")
      .get(sdkSessionId) as MessageRow | undefined
    return r ? toMessage(r) : undefined
  }

  /** One message by its id. */
  message(id: string): Message | undefined {
    return this.#message(id)
  }

  messages(conversationId: string): Message[] {
    const rows = this.#db
      .prepare("SELECT * FROM message WHERE conversation_id = ? ORDER BY seq")
      .all(conversationId) as unknown as MessageRow[]
    return rows.map(toMessage)
  }

  #tree(conversationId: string): Tree<Message> {
    return new Tree(this.messages(conversationId))
  }

  /** The branch shown, each step with its siblings. */
  branch(conversationId: string): BranchStep<Message>[] {
    const c = this.conversation(conversationId)
    if (!c) return []
    return this.#tree(conversationId).branch(c.activeLeaf)
  }

  /** Shows the branch through this message, down to its newest leaf. Returns that leaf. */
  switchTo(conversationId: string, messageId: string): string {
    const tree = this.#tree(conversationId)
    if (!tree.get(messageId)) throw new ChatStoreError("That message is not in this conversation.")
    const leaf = tree.leafFrom(messageId)
    this.#db
      .prepare("UPDATE conversation SET active_leaf = ? WHERE id = ?")
      .run(leaf, conversationId)
    return leaf
  }

  rename(conversationId: string, title: string): void {
    this.#db
      .prepare("UPDATE conversation SET title = ? WHERE id = ? AND kind != 'imported'")
      .run(this.#redact(title.slice(0, 200)), conversationId)
  }

  setPinned(conversationId: string, pinned: boolean): void {
    this.#db
      .prepare("UPDATE conversation SET pinned = ? WHERE id = ?")
      .run(pinned ? 1 : 0, conversationId)
  }

  /** Deletes a conversation with its messages, attachments and artifacts. */
  delete(conversationId: string): void {
    this.#tx(() => {
      this.#db.prepare("DELETE FROM message_fts WHERE conversation_id = ?").run(conversationId)
      this.#db.prepare("DELETE FROM conversation WHERE id = ?").run(conversationId)
    })
  }

  /** Finds messages by their words, newest conversations first. */
  search(q: string, filter: { kind?: Provenance["kind"]; limit?: number } = {}): SearchHit[] {
    const match = ftsQuery(q)
    if (!match) return []
    const rows = this.#db
      .prepare(
        `SELECT f.conversation_id AS conversationId, f.message_id AS messageId, c.title AS title, c.kind AS kind,
                snippet(message_fts, 0, '[', ']', '…', 12) AS snippet
         FROM message_fts f JOIN conversation c ON c.id = f.conversation_id
         WHERE message_fts MATCH ? ${filter.kind ? "AND c.kind = ?" : ""}
         ORDER BY c.updated_at DESC LIMIT ?`,
      )
      .all(
        match,
        ...(filter.kind ? [filter.kind] : []),
        Math.min(Math.max(filter.limit ?? 50, 1), 200),
      ) as unknown as SearchHit[]
    return rows
  }
}
