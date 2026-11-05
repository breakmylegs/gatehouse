# ADR 0012: Chat tool posture

Status: **Decided, 4 Nov 2026**, with the Chat plan (`docs/plan/chat-build-plan.md` section 8) under the owner's standing decision to take the recommended option. Built in CH-03.

## Context

The owner's Chat build prompt asks that Chat follow Anthropic's own third-party Chat model: it reads the conversation's attachments and read-only project folders, writes only to a per-conversation `outputs` folder, runs no shell, edits nothing else, and has MCP tools only where a project switches them on. Code sessions keep their posture. Done when a shell request from Chat is denied and audited with a rule id.

A chat today has only WebSearch, WebFetch, Read, Glob and Grep, plus the Companion's artifact and memory tools, and always runs in Plan mode in its own folder under `%LOCALAPPDATA%\Gatehouse\chats`.

## Decision

- **Two walls against a shell or a file change in a chat.** The first: the chat's tool list has no Bash, PowerShell, Write, Edit, MultiEdit or NotebookEdit at all. The second: the policy knows which kind of session a call comes from (`sessionKind` in the evaluation context, a rule's `sessionKinds`), and the deny rule `chat-no-shell` refuses those tools in a chat, audited with its rule id like every decision.
- **An unknown kind counts as a coding session.** A call the Host sends always says which it is; one that does not (an old audit record in a replay) is judged as before, so nothing is loosened and no coding session loses its tools.
- **No `outputs` folder yet: a chat writes nowhere.** That is within the posture the prompt sets (it may write only there) and stricter than it. Chat folders sit outside the workspace roots, where `outside-workspace-write` denies every write, and opening one folder per chat to writes needs roots scoped to a session, which the engine does not have. A chat's files still come out as artifacts, and a coding session can be started for anything to be built. The outputs folder is queued as its own item, with its rules designed first.
- **MCP:** unchanged. Outside servers are blocked on this laptop by the managed policy; the Companion is the only server a chat has.

## Consequences

Rules may now be scoped to a kind of session. `chat-no-shell` is a deny rule, so it wins over any allow, including one you remember.
