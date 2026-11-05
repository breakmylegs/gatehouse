import type { DatabaseSync } from "node:sqlite"
import { changedStrings, searchText, type ContentBlock } from "../db.js"
import type { ImportedConversation, ImportedMemory, ImportedProject } from "./map.js"

/** What one import did, record by record. */
export interface ImportCounts {
  imported: number
  updated: number
  skipped: number
  /** Pieces of text redaction changed. */
  redacted: number
  projects: number
  memories: number
}

export interface ImportBatch {
  id: string
  zipSha256: string
  layout: string
  exportDate: string
}

/**
 * CH-04: writes one export into Chat's store inside one transaction (begun by the store), so a failed import leaves
 * nothing behind. Every record is redacted before it is written (invariant 12). A record already imported is skipped
 * unless the export has a newer one, which replaces the snapshot; forks keep their link through the claude.ai ids.
 * A project's instructions and imported memory are kept inactive until you accept each one.
 */
export class ImportWriter {
  readonly counts: ImportCounts = {
    imported: 0,
    updated: 0,
    skipped: 0,
    redacted: 0,
    projects: 0,
    memories: 0,
  }
  readonly #projects = new Map<string, string>()
  #open = true

  constructor(
    private readonly db: DatabaseSync,
    private readonly redact: <T>(value: T) => T,
    private readonly newId: () => string,
    private readonly now: () => string,
    readonly batch: ImportBatch,
  ) {
    db.exec("BEGIN IMMEDIATE")
    db.prepare(
      "INSERT INTO import_batch (id, zip_sha256, layout, created_at) VALUES (?, ?, ?, ?)",
    ).run(batch.id, batch.zipSha256, batch.layout, now())
  }

  #clean<T>(value: T): T {
    const out = this.redact(value)
    this.counts.redacted += changedStrings(value, out)
    return out
  }

  project(p: ImportedProject): void {
    const found = this.db
      .prepare("SELECT id, updated_at FROM project WHERE source = 'claude.ai' AND source_uuid = ?")
      .get(p.sourceUuid) as { id: string; updated_at: string } | undefined
    if (found && found.updated_at >= p.updatedAt) {
      this.#projects.set(p.sourceUuid, found.id)
      this.counts.skipped++
      return
    }
    const fields = [
      this.#clean(p.name),
      this.#clean(p.description),
      this.#clean(p.instructions),
      JSON.stringify(this.#clean(p.raw)),
    ] as const
    if (found) {
      // Newer instructions are new words: they wait to be accepted again.
      this.db
        .prepare(
          `UPDATE project SET name = ?, description = ?, instructions = ?, instructions_active = 0, raw_json = ?,
           updated_at = ? WHERE id = ?`,
        )
        .run(...fields, p.updatedAt, found.id)
      this.#projects.set(p.sourceUuid, found.id)
      this.counts.updated++
    } else {
      const id = this.newId()
      this.db
        .prepare(
          `INSERT INTO project (id, source, source_uuid, name, description, instructions, instructions_active, raw_json,
           created_at, updated_at) VALUES (?, 'claude.ai', ?, ?, ?, ?, 0, ?, ?, ?)`,
        )
        .run(id, p.sourceUuid, ...fields, p.createdAt, p.updatedAt)
      this.#projects.set(p.sourceUuid, id)
      this.counts.imported++
    }
    this.counts.projects++
  }

  conversation(c: ImportedConversation): void {
    const found = this.db
      .prepare("SELECT id, updated_at FROM conversation WHERE source_uuid = ?")
      .get(c.sourceUuid) as { id: string; updated_at: string } | undefined
    if (found && found.updated_at >= c.updatedAt) {
      this.counts.skipped++
      return
    }
    const provenance = {
      kind: "imported",
      source: "claude.ai",
      sourceUuid: c.sourceUuid,
      exportDate: this.batch.exportDate,
      importBatchId: this.batch.id,
    }
    let id: string
    if (found) {
      id = found.id
      this.db.prepare("DELETE FROM message_fts WHERE conversation_id = ?").run(id)
      this.db.prepare("DELETE FROM artifact WHERE conversation_id = ?").run(id)
      // Children before parents, so the links between messages never point at nothing.
      this.db.prepare("UPDATE message SET parent_id = NULL WHERE conversation_id = ?").run(id)
      this.db.prepare("DELETE FROM message WHERE conversation_id = ?").run(id)
      this.db
        .prepare(
          "UPDATE conversation SET title = ?, updated_at = ?, provenance_json = ?, raw_json = ?, active_leaf = NULL WHERE id = ?",
        )
        .run(
          this.#clean(c.title),
          c.updatedAt,
          JSON.stringify(provenance),
          JSON.stringify(this.#clean(c.raw)),
          id,
        )
      this.counts.updated++
    } else {
      id = this.newId()
      this.db
        .prepare(
          `INSERT INTO conversation (id, kind, title, created_at, updated_at, provenance_json, raw_json, source_uuid)
           VALUES (?, 'imported', ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          this.#clean(c.title),
          c.createdAt,
          c.updatedAt,
          JSON.stringify(provenance),
          JSON.stringify(this.#clean(c.raw)),
          c.sourceUuid,
        )
      this.counts.imported++
    }
    // Parents first: roots, then each one's children, in the order they were made.
    const children = new Map<string | null, typeof c.messages>()
    for (const m of c.messages)
      children.set(m.parentSourceUuid, [...(children.get(m.parentSourceUuid) ?? []), m])
    const ids = new Map<string, string>()
    const queue = [...(children.get(null) ?? [])]
    let seq = 0
    const insert = this.db.prepare(
      `INSERT INTO message (id, conversation_id, parent_id, seq, role, created_at, provider, model, blocks_json, redactions, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, 'anthropic', NULL, ?, ?, ?)`,
    )
    const fts = this.db.prepare(
      "INSERT INTO message_fts (text, message_id, conversation_id) VALUES (?, ?, ?)",
    )
    const attach = this.db.prepare(
      `INSERT INTO attachment (id, message_id, file_name, file_type, size, extracted_text, content_included)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    while (queue.length) {
      const m = queue.shift()!
      const mid = this.newId()
      ids.set(m.sourceUuid, mid)
      const blocks = this.redact(m.blocks) as ContentBlock[]
      const changed = changedStrings(m.blocks, blocks)
      this.counts.redacted += changed
      insert.run(
        mid,
        id,
        m.parentSourceUuid ? (ids.get(m.parentSourceUuid) ?? null) : null,
        ++seq,
        m.role,
        m.createdAt,
        JSON.stringify(blocks),
        changed,
        JSON.stringify(this.#clean(m.raw)),
      )
      const words = searchText(blocks)
      if (words) fts.run(words, mid, id)
      for (const a of m.attachments)
        attach.run(
          this.newId(),
          mid,
          this.#clean(a.fileName),
          a.fileType ?? null,
          a.size ?? null,
          a.text === undefined ? null : this.#clean(a.text),
          a.included ? 1 : 0,
        )
      queue.push(...(children.get(m.sourceUuid) ?? []))
    }
    this.db
      .prepare("UPDATE conversation SET active_leaf = ? WHERE id = ?")
      .run(c.activeLeaf ? (ids.get(c.activeLeaf) ?? null) : null, id)
    for (const a of c.artifacts) {
      const aid = this.newId()
      this.db
        .prepare("INSERT INTO artifact (id, conversation_id, title, type) VALUES (?, ?, ?, ?)")
        .run(aid, id, this.#clean(a.title), a.type)
      for (const v of a.versions)
        this.db
          .prepare(
            "INSERT INTO artifact_version (id, artifact_id, message_id, created_at, content) VALUES (?, ?, ?, ?, ?)",
          )
          .run(
            this.newId(),
            aid,
            ids.get(v.messageSourceUuid) ?? null,
            v.createdAt,
            this.#clean(v.content),
          )
    }
  }

  /** Imported memory, inactive until you accept it. The same words imported again are not added twice. */
  memory(m: ImportedMemory): boolean {
    const project =
      m.scope === "global" ? null : (this.#projects.get(m.scope.projectSourceUuid) ?? null)
    if (m.scope !== "global" && !project) return false
    const scope = m.scope === "global" ? "global" : "project"
    const text = this.#clean(m.text)
    const dup = this.db
      .prepare(
        "SELECT 1 FROM memory_entry WHERE source = 'claude.ai' AND scope = ? AND project_id IS ? AND text = ?",
      )
      .get(scope, project, text)
    if (dup) return false
    this.db
      .prepare(
        `INSERT INTO memory_entry (id, scope, project_id, text, source, active, import_batch_id, created_at)
         VALUES (?, ?, ?, ?, 'claude.ai', 0, ?, ?)`,
      )
      .run(this.newId(), scope, project, text, this.batch.id, this.now())
    this.counts.memories++
    return true
  }

  commit(): ImportCounts {
    this.db
      .prepare(
        "UPDATE import_batch SET imported = ?, updated = ?, skipped = ?, redacted = ? WHERE id = ?",
      )
      .run(
        this.counts.imported,
        this.counts.updated,
        this.counts.skipped,
        this.counts.redacted,
        this.batch.id,
      )
    this.db.exec("COMMIT")
    this.#open = false
    return this.counts
  }

  /** A failed import leaves nothing behind. */
  rollback(): void {
    if (!this.#open) return
    this.#open = false
    this.db.exec("ROLLBACK")
  }
}
