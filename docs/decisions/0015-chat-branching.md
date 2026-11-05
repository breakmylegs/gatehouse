# ADR 0015: Branching on the Agent SDK

Status: **Decided, 4 Nov 2026**, with the Chat plan (`docs/plan/chat-build-plan.md` section 8). The tree is built in CH-02; the SDK side comes in CH-03.

## Context

Chat in Claude's desktop app keeps every version of a conversation: editing a message or asking again makes a sibling, and "2 of 3" arrows move between them. The Agent SDK 0.3.310 (`sdk.d.ts`) can resume a session, resume it at a message (`resumeSessionAt`) and fork it up to a message (`forkSession(sessionId, { upToMessageId })`), but `getSessionMessages` returns only the active chain, so it has no view of siblings.

## Decision

- **Codehouse keeps the tree.** Each message in Chat's store has a parent; siblings are ordered by when they were made; each conversation has an active leaf (`apps/host/src/chat/tree.ts`).
- **A branch is an SDK session.** Editing or asking again forks the SDK session at that message with `forkSession(upToMessageId)` and resumes the fork; the new message is stored as a sibling and becomes the active leaf.
- **Switching branches** moves the active leaf to the newest leaf under the chosen sibling, following the newest child each time, and resumes that branch's session when you write next.
- **Damage is survivable.** A message whose parent is missing (a damaged import) is shown as a root rather than lost, and a loop in the parent links cannot hang the walk.

## Consequences

Codehouse never writes into Claude Code's own session files to fake history (the prompt's prohibited list). The tree lives only in Chat's store, so it survives the SDK's transcript format changing.
