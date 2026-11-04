# Chat build: the plan (CH-01 to CH-08), approved 4 Nov 2026 (section 8)

Written 4 Nov 2026 in answer to the owner's Chat build prompt (`docs/plan/queue-2026-11-04.md`), which asks for this plan, section 11, before any code. Nothing here is built yet. Everything below was checked against the repository at commit 5b09de5 and the installed Agent SDK 0.3.310 (`sdk.d.ts`).

## 1. What Chat reuses (repo map)

| Part | Where | What Chat uses it for |
|---|---|---|
| Host (Fastify, 127.0.0.1, token, Host and Origin checks) | `apps/host/src/server.ts`, `server-guard.ts`, `api.ts` | New routes for conversations, import, hand-off and search, behind the same guard |
| Session runner | `apps/host/src/sessions.ts` (`kind: "chat"`, `CHAT_PROMPT`, `CHAT_TOOLS`, chats always in Plan mode in their own folder under `chats\`) | Every native chat and every fork is a normal session |
| Floor hook and the Approver | `apps/host/src/hooks.ts`, `canuse.ts`, `approver-client.ts`, `packages/policy` | Every Chat tool call, unchanged |
| Escalation (desktop, phone, push) | `apps/host/src/broker.ts` | Unchanged |
| Redaction | `packages/policy/src/redact.ts` | Imported content before it is stored, seeded history before it is sent |
| Organisation guard | `apps/host/src/account.ts`, `accounts.ts` | Unchanged for every Chat session |
| DPAPI | `scripts/dpapi.ps1`, `apps/host/src/relay/protector.ts` | Nothing new (see question 1) |
| Audit | `packages/shared/src/audit` | Import batches, forks, hand-offs, memory changes |
| C# shell, tray, quick prompt | `packaging/CodehouseApp.cs`, `Overlay.cs`, `apps/web/src/surfaces/Quick.tsx` | Navigation guard (CH-01), screenshots and quick prompt to Chat (CH-08) |
| Projects, instructions, knowledge files | `apps/host/src/projects.ts`, `apps/web/src/surfaces/Projects.tsx` | Kept; imported projects join them |
| Memory | `apps/host/src/memory.ts`, Companion `remember`, `recall`, `forget`, `apps/web/src/surfaces/Memory.tsx` | Kept; imported memory arrives inactive |
| Artifacts | `apps/host/src/artifacts.ts`, Companion `save_artifact`, ADR 0003 sandbox | Kept and extended (versions exist; Markdown and code views added) |
| Attachments | `apps/host/src/attach-api.ts`, the paste card (4 Nov) | Kept |
| Retry and Edit (fork at a message) | `apps/web/src/lib/redo.ts` with SDK `resume`, `forkSession`, `resumeSessionAt` | The basis of the branch navigator |
| Earlier sessions, export | `apps/host/src/history.ts`, `export-api.ts` | Search across native chats, Export as Markdown |
| Seeding a new chat with history | `apps/web/src/components/FallbackButton.tsx` (`carriedText`) | The pattern for Continue locally (CH-07) |

## 2. Agent SDK capability check (0.3.310, read in `sdk.d.ts`)

| Need | In the SDK | Notes |
|---|---|---|
| Resume a conversation | `options.resume` | Used today |
| Fork | `options.forkSession` and the standalone `forkSession(sessionId, { upToMessageId, title })` | The standalone call copies the transcript with fresh ids up to a message, inclusive |
| Resume at a message | `options.resumeSessionAt` | Used today by Retry and Edit |
| Read a transcript as a chain | `getSessionMessages(sessionId)`, built from `parentUuid` links | Gives the active chain only, not sibling branches; Codehouse keeps the tree itself (ADR 0015) |
| List, rename, delete sessions | `listSessions`, `getSessionInfo`, `renameSession`, `deleteSession` | |
| In-process MCP tools | `createSdkMcpServer` | The Companion already uses it |
| System prompt | a plain string for chats, or the `claude_code` preset with `append` | Chats use a string today |
| Usage | `result` messages carry `usage` and `total_cost_usd`; plan limits through the existing usage call | Used today |
| A pluggable session store | `sessionStore` (marked alpha) | Not relied on: the format is internal |

Nothing the prompt needs is missing. Branching (edit or regenerate makes a sibling) maps to `forkSession(upToMessageId)` plus resume; the only gap is that the SDK has no sibling view, so Codehouse records each fork point itself.

## 3. Storage and schema (ADR 0013)

SQLite through Node's built-in `node:sqlite`, with FTS5 for search. Checked on this laptop's Node 24.15.0: an FTS5 table creates and matches. No native addon and no new dependency (the Relay already uses `node:sqlite`). One file, `%LOCALAPPDATA%\Gatehouse\chat\chat.db`, written in transactions; older Codehouse versions ignore it, and the existing chat files stay where they are.

Tables:
- `schema_version(n)`; migrations are numbered and only ever add.
- `project(id, source, source_uuid, name, description, instructions, instructions_active, created_at, updated_at, raw_json)`, linked to the existing `projects\` folders for native projects.
- `conversation(id, kind native|imported|fork, title, project_id, pinned, created_at, updated_at, active_leaf, provenance_json, sdk_session_id, raw_json)`. Provenance: `native`; `imported` with source `claude.ai`, source uuid, export date and import batch id; `fork` with the source conversation and message.
- `message(id, conversation_id, parent_id, role, created_at, provider, model, blocks_json, redactions, raw_json, sdk_uuid)`. Native messages are written as they stream, so search and the tree do not depend on reading Claude Code's own files.
- `attachment(id, message_id, file_name, file_type, size, extracted_text, content_included)`.
- `artifact(id, conversation_id, title, type)` and `artifact_version(id, artifact_id, message_id, created_at, content)`.
- `memory_entry(id, scope, project_id, text, source, active, created_at)`. Native memory stays in today's store; imported memory lands here, inactive until you accept it.
- `import_batch(id, zip_sha256, layout, imported, updated, skipped, redacted, created_at)`.
- `message_fts` (FTS5 over the redacted text).

Imported records are snapshots, replaced only by a newer `updated_at` on re-import. A fork is always a new native conversation.

## 4. Slices

| Slice | Files | Tests | Estimate |
|---|---|---|---|
| CH-01 Guardrails | `packaging/CodehouseApp.cs` (re-check the existing own-origin navigation guard, add `FrameNavigationStarting` and `NewWindowRequested`, tell the Host so it audits a cancelled navigation), `scripts/forbidden.mjs` (the prohibited-pattern check, run by `npm run gate` and `npm run release`, not GitHub Actions) | A C# exe test that a claude.ai navigation is cancelled; the check fails on a seeded string and passes on the tree | 1 day |
| CH-02 Data model | `apps/host/src/chat/db.ts`, `migrations.ts`, `tree.ts` | Migrations on an empty and an existing data folder; active branch and siblings at every fork | 2 days |
| CH-03 Native chat parity | `sessions.ts` (outputs folder, branch per fork), `apps/web/src/surfaces/ChatList.tsx`, `Workspace.tsx` (branch navigator "2 of 3", collapsed thinking, citations, tool cards), artifact views, Companion `update_artifact` | Shell from Chat denied and audited; every Chat tool call audited with rule and risk; branch switching | 5 days |
| CH-04 Importer | `apps/host/src/chat/import/zip.ts` (reuse the updater's zip reader with the prompt's limits), `stream-json.ts` (a small streaming array parser, no dependency), `layouts.ts`, `map.ts`, fixture generator under `apps/host/test/fixtures/` | Every layout, malformed and attack fixtures with no partial writes, the synthetic 1 GB file within the memory ceiling, re-import changes nothing, imported instructions and memory stay inactive | 4 days |
| CH-05 Viewer and search | `apps/web/src/surfaces/ImportedChat.tsx`, search over `message_fts` | Fidelity with branches, artifacts and cloud steps; search with the source filter | 2 days |
| CH-06 Open in Claude | `apps/host/src/chat/handoff.ts` (App Paths lookup, exactly `--app=<url>` and `--profile-directory=<profile>`, detached) | The exact argument list; bad uuids and other hosts refused | 1 day |
| CH-07 Continue locally | Trust and continue dialog, seeding as a delimited history document, summary of older turns | Imported instructions and memory excluded unless ticked; redaction on the seed; fork, consent and size audited | 2 days |
| CH-08 Desktop features | Quick prompt to Chat (new or last), region and window capture in `Overlay.cs`, toasts through the existing path | Quick prompt both ways; capture attaches, warns and is audited; notices fire | 3 days |

About 20 working days in all, in this order, each passing the full suite before the next.

## 5. ADRs (next free numbers)

- **0012 Chat tool posture**: as Anthropic's own third-party Chat. Reads the chat's attachments and read-only project folders, writes only to the chat's `outputs` folder, no shell, MCP only where a project switches it on, Plan mode always.
- **0013 Chat storage**: `node:sqlite` with FTS5 in the data folder, additive migrations, raw source JSON kept.
- **0014 Import parser**: the app's own zip reader with limits, a streaming parser with bounded memory, layouts told apart by contents, unknown fields kept raw.
- **0015 Branching on the SDK**: a branch is an SDK session; edit and regenerate fork at the message with `forkSession(upToMessageId)`, and Codehouse records the tree.
- **0016 Fork seeding**: history goes in as a delimited document in the first turn, marked as data not instructions, never as made-up prior turns, with your consent for each fork.
- **0017 Hand-off**: Edge `--app` with a chosen profile, resolved through App Paths, detached, nothing read back; the `claude://` scheme behind a flag.
- **0018 Redaction of imported content**: the usual pipeline before storage, with counts per message shown in the viewer.
- **0019 Artifact views**: extends ADR 0003 with Markdown and code views; Mermaid only if its licence is cleared (question 3).

## 6. New Approver rules

| Rule id | Kind | Risk | What it does |
|---|---|---|---|
| `chat-outputs-write` | allow | 10 | Write and Edit inside the chat's own `outputs` folder only |
| `chat-knowledge-read` | allow | 5 | Read, Glob and Grep inside the chat's project knowledge and read-only project folders |
| `chat-no-shell` | deny | 100 | Bash and PowerShell in a chat, as a second wall behind the chat's tool list |
| `artifact-tools` (exists) | allow | 10 | `save_artifact` and the new `update_artifact` |
| `memory-tools` (exists) | allow | 20 | `remember`, `recall`, `forget` |
| `chat-memory-flagged` | escalate | 60 | A `remember` whose text the redaction pass changed |

Each has a fail-closed test: an Approver error, timeout or malformed verdict on each gives no allow.

## 7. Questions for the owner

1. The prompt allows an API key fallback in the DPAPI store. CLAUDE.md invariant 6 strips `ANTHROPIC_API_KEY` and ADR 0010 keeps Codehouse holding no key. Recommended: leave the fallback out and keep sign-in through Anthropic's flow only. Agree?
2. The prompt asks for a CI check. GitHub Actions are switched off, so the check runs in `npm run gate` and `npm run release` instead. Agree?
3. ADR 0003 dropped Mermaid because its licences were not cleared. Recommended: check them (the core is MIT) and bundle it only if they clear; until then diagrams stay SVG. Agree?
4. Today's chats are Claude Code sessions plus Codehouse's details. Recommended: index them into the new store in place, so the sidebar shows old and new together, without touching their files. Agree?
5. Which Edge profile should Open in Claude use: your normal work profile ("Default"), or a separate one you sign in to once?
6. The memory ceiling for importing a 1 GB `conversations.json`: recommended 512 MB for the Host during the import.
7. Region and window screenshots need new C# code in the quick prompt. Fine to add?
8. Chat is on today, so `chat.enabled` would be on by default; `chat.import.enabled` stays off until CH-04 passes. Agree?

## Progress

- CH-01 guardrails: done 4 Nov (commit ab7b882, released in 2.0.79).
- CH-02 data model: done 4 Nov (ADR 0013, ADR 0015).
- CH-03 native chat: in progress. Done 4 Nov: every chat recorded into the store, and the versions navigator (‹ 2 of 3 ›) for Retry and Edit.
- CH-03 tool posture: done 4 Nov (ADR 0012, rule `chat-no-shell`). The outputs folder is deferred (ADR 0012) until rules can be scoped to one session's folder.
- CH-03 finding chats: done 4 Nov (search in Ctrl+K, recency groups in the sidebar).
- Next in CH-03: artifact views (Markdown and code), memory shown as injected.

## 8. Owner decision (4 Nov 2026)

"On the chat features and anything else that requires my input I want you to choose the best/recommended option for everything and continue build." So the plan is approved with these answers, and the build goes ahead in slice order:

1. No API key fallback. Sign-in stays Anthropic's own flow only (invariant 6, ADR 0010).
2. The prohibited-pattern check runs in `npm run gate` and `npm run release`, not GitHub Actions.
3. Mermaid only after its licences are checked; until then diagrams stay SVG.
4. Today's chats are indexed into the new store in place; their files are not touched.
5. Open in Claude uses your normal Edge profile ("Default"), changeable in Settings. It is a separate, detached Edge window, and Codehouse reads nothing back.
6. The import memory ceiling is 512 MB.
7. Region and window screenshots in the quick prompt: yes.
8. `chat.enabled` on by default; `chat.import.enabled` off until CH-04 passes.
