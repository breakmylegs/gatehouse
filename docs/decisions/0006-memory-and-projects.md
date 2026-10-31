# ADR 0006: Chat projects, instructions and memory

Status: Proposed, 31 Oct 2026. Waiting for the owner.

## Context

G3 asks for chat projects with knowledge files and instructions. G4 asks for memory you can edit by topic, per project and global. The owner asked on 31 Oct for one instruction shared by every session at its start, and one per session.

Facts from the code:

- A chat is a Claude Code session in Plan mode, in a folder of its own under `%LOCALAPPDATA%\Gatehouse\chats` (`apps/host/src/sessions.ts`). Claude can read there but cannot write.
- Sessions start with `systemPrompt: { type: "preset", preset: "claude_code", append }` and `settingSources: ["user", "project", "local"]`, so Claude Code loads `CLAUDE.md` from the folder.

## What was checked in the installed SDK (0.3.310)

- `Options.settings` takes a settings object per session (sdk.d.ts line 2264).
- Settings include `autoMemoryEnabled` and `autoMemoryDirectory` (lines 9472 to 9476). The directory defaults to `~/.claude/projects/<folder>/memory/`, and a project's checked-in settings cannot move it.
- Not checked yet: whether Claude Code's auto memory can write while a session is in Plan mode. Writing is what Plan mode forbids.

## Options for memory

1. **Claude Code's own auto memory**, pointed at a JCVC folder through `Options.settings`. Native, but its writes may be blocked in Plan mode, its files sit outside JCVC's audit, and the default place is under `.claude`, which the floor guards.
2. **JCVC memory through the Companion**: in-process tools `remember`, `recall` and `forget`. The Host keeps entries by topic in `%LOCALAPPDATA%\Gatehouse\memory\` (global and per project), redacted, written atomically and audited. The entries in scope are added to the system prompt `append` at each start, with a note of which ones went in.

## Proposed decision

- **Memory:** option 2. Turn Claude Code's auto memory off for chats (`autoMemoryEnabled: false`), so there is one memory to edit. Code sessions keep their own until the owner decides.
- **Projects:** a chat project is a folder `%LOCALAPPDATA%\Gatehouse\projects\<name>\` with `knowledge\` and `instructions.md`. A chat in a project starts in its own folder as now, with the project folder added through `additionalDirectories`, so Claude reads knowledge files on demand. Each Read of a knowledge file shows in the turn, which meets "each turn shows which files were included".
- **Instructions:** global instructions (Settings), project instructions and session instructions all go into `append`, in that order, with a size limit and a visible note at the top of the session.

## Found while building W1-01

`assertSafeOptions` (`apps/host/src/safety.ts`) refuses any inline `settings`, because settings can carry permission rules (invariant 5). Turning off auto memory through `Options.settings` needs a narrow allowance: an object holding `autoMemoryEnabled: false` and nothing else.

## Consequences

- Memory and instructions are the user's own data files, read tolerantly and changed only by adding, as the conventions require.
- Every memory write and every use at start is an audit entry. The user can export and import memory as Markdown.

## Constraint check

Fits. In-process MCP only. Redaction first. Nothing under `.claude` is read by JCVC.

## Verification

Automated: Host tests for the memory store (tolerant reads, atomic writes, redaction, audit), for the start options (append order and size limit, `additionalDirectories`, `autoMemoryEnabled: false` for chats), and a fake-SDK test that a `remember` call is audited. Named manual check: a project chat that reads a knowledge PDF and remembers a preference, which comes back in a new chat.
