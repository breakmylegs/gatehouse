# ADR 0013: Chat storage

Status: **Decided, 4 Nov 2026.** Approved with the Chat plan under the owner's standing decision ("choose the best/recommended option for everything and continue build"), `docs/plan/chat-build-plan.md` section 8. Built in CH-02.

## Context

The owner's Chat build prompt (CH-02) asks for conversations, messages as a tree, projects, attachments, artifacts and their versions, memory and import batches, under the Gatehouse data folder, in the repository's database if it has one, otherwise SQLite with FTS5. The Host had no database: settings, memory and artifacts are JSON files. The Relay already uses Node's own `node:sqlite`. CLAUDE.md forbids native addons and asks that data files be read by older and newer versions alike.

## Options

1. JSON files per conversation with a search index built in JavaScript.
2. SQLite through a native addon (better-sqlite3).
3. **SQLite through `node:sqlite`, built into Node 22.5 and later**, with FTS5 for search.

## Decision

Option 3. Checked on the Node Codehouse ships (24.15.0): FTS5 is compiled in. No dependency is added. One file, `%LOCALAPPDATA%\Gatehouse\chat\chat.db`, in WAL mode with foreign keys on.

- **Atomic writes.** Each change is one transaction (`BEGIN IMMEDIATE`), the database's answer to the temp-then-rename rule for files.
- **Migrations only add.** They are numbered in `apps/host/src/chat/migrations.ts`, each in its own transaction; a failed one leaves the file as it was. An older Codehouse that finds a newer file uses what it knows and leaves the rest alone, so an update can be undone.
- **Redaction first** (invariant 12). The store takes the Host's redactor and applies it to titles, message blocks and raw JSON before anything is written; each message records how many pieces of text were changed. Search indexes only the redacted text of text blocks, never thinking or tool input.
- **Provenance.** Every conversation is `native`, `imported` (source claude.ai, source uuid, export date, import batch) or `fork` (the conversation and message it came from). Imported conversations are read-only snapshots: the store refuses to add to or rename them. A fork is always a new conversation.
- **Raw source kept.** Imported records keep their source JSON in a column of their own, so they can be read again after a schema change.
- **Provider-agnostic.** Each message records its provider and model.
- **Search syntax.** What you type is split into words, each quoted as a phrase, so it is never read as FTS5 syntax.

## Consequences

The existing chat files (Claude Code sessions plus Codehouse's details) are not moved or rewritten; CH-03 indexes them into this store in place (plan question 4). Claude Code's own session store is never written to.
