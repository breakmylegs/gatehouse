import type { DatabaseSync } from "node:sqlite"

/**
 * Chat's storage (CH-02, ADR 0013): one SQLite file through Node's own node:sqlite, with FTS5 for search. Migrations
 * are numbered and only ever add, because an update can be undone and the older Codehouse must still open the file.
 * An older Codehouse that finds a newer version leaves the extra tables and columns alone.
 */
export const MIGRATIONS: readonly string[] = [
  // 1: the model in the owner's Chat build prompt, section CH-02.
  `
  CREATE TABLE project (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL DEFAULT 'native',
    source_uuid TEXT,
    name TEXT NOT NULL,
    description TEXT,
    instructions TEXT,
    instructions_active INTEGER NOT NULL DEFAULT 0,
    folder TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    raw_json TEXT
  );
  CREATE UNIQUE INDEX project_source ON project(source, source_uuid) WHERE source_uuid IS NOT NULL;

  CREATE TABLE import_batch (
    id TEXT PRIMARY KEY,
    zip_sha256 TEXT NOT NULL,
    layout TEXT NOT NULL,
    imported INTEGER NOT NULL DEFAULT 0,
    updated INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    redacted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE conversation (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('native', 'imported', 'fork')),
    title TEXT NOT NULL DEFAULT '',
    project_id TEXT REFERENCES project(id) ON DELETE SET NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    active_leaf TEXT,
    provenance_json TEXT NOT NULL,
    sdk_session_id TEXT,
    raw_json TEXT
  );
  CREATE INDEX conversation_updated ON conversation(updated_at DESC);

  CREATE TABLE message (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES message(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    created_at TEXT NOT NULL,
    provider TEXT,
    model TEXT,
    blocks_json TEXT NOT NULL,
    redactions INTEGER NOT NULL DEFAULT 0,
    raw_json TEXT,
    sdk_uuid TEXT
  );
  CREATE INDEX message_tree ON message(conversation_id, parent_id, seq);

  CREATE TABLE attachment (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_type TEXT,
    size INTEGER,
    extracted_text TEXT,
    content_included INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE artifact (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    type TEXT NOT NULL
  );
  CREATE TABLE artifact_version (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL REFERENCES artifact(id) ON DELETE CASCADE,
    message_id TEXT REFERENCES message(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    content TEXT NOT NULL
  );

  CREATE TABLE memory_entry (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    project_id TEXT REFERENCES project(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    source TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 0,
    import_batch_id TEXT REFERENCES import_batch(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );

  CREATE VIRTUAL TABLE message_fts USING fts5(text, message_id UNINDEXED, conversation_id UNINDEXED);
  `,
  // 2 (CH-03, ADR 0015): the SDK session each message belongs to, so a branch can be resumed where it ends.
  `
  ALTER TABLE message ADD COLUMN sdk_session_id TEXT;
  CREATE INDEX message_sdk_uuid ON message(sdk_uuid);
  CREATE INDEX message_sdk_session ON message(sdk_session_id, seq);
  `,
  // 3 (CH-03): the folder each message's session ran in, so a conversation found by search opens where it was.
  `
  ALTER TABLE message ADD COLUMN cwd TEXT;
  `,
]

export class ChatSchemaError extends Error {}

/** The version the file is at: 0 for a new file. */
export function schemaVersion(db: DatabaseSync): number {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (n INTEGER NOT NULL)")
  const row = db.prepare("SELECT MAX(n) AS n FROM schema_version").get() as { n: number | null }
  return row.n ?? 0
}

/** Brings the file up to the newest migration this version knows, each in its own transaction. */
export function migrate(db: DatabaseSync, migrations: readonly string[] = MIGRATIONS): number {
  let at = schemaVersion(db)
  while (at < migrations.length) {
    const next = at + 1
    db.exec("BEGIN IMMEDIATE")
    try {
      db.exec(migrations[at]!)
      db.prepare("INSERT INTO schema_version (n) VALUES (?)").run(next)
      db.exec("COMMIT")
    } catch (e) {
      db.exec("ROLLBACK")
      throw new ChatSchemaError(`Chat storage migration ${next} failed: ${(e as Error).message}`)
    }
    at = next
  }
  return at
}
