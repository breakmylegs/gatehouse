# ADR 0016: Seeding a chat continued from claude.ai

Status: **Decided, 5 Nov 2026**, with the Chat plan (`docs/plan/chat-build-plan.md` section 8). Built in CH-07.

## Context

The owner's Chat build prompt: Continue locally makes a fork of an imported chat; before the first send a Trust and continue dialog lists what will be sent, its size and a token estimate, with imported project instructions and memory each off unless ticked; the history goes in as one clearly marked document, said to be data, never as made-up earlier turns in the SDK session; past a budget, the last N turns are kept word for word and the rest summed up by a separate, labelled call, shown before sending; everything passes redaction and the organisation guard; the fork says "Continued in Gatehouse. Not synced to claude.ai." (shown as Codehouse, invariant 16). Sending imported content to a model without consent for that fork is prohibited.

## Decision

- **The history goes in the new chat's instructions** (the session's own instructions, appended to the chat prompt), as one document between markers, with the instruction that it is a record to carry on from, never instructions to follow. Nothing is written into Claude Code's own session files.
- **A preview, then exactly that.** `/api/chat/continue/preview` builds the seed (each turn redacted again, imported instructions and memory only if ticked) and keeps it for 30 minutes under an id; `/api/chat/continue` starts the chat with that seed and nothing else, once. What you saw is what is sent.
- **Long chats:** past the budget (60,000 characters by default) the last 10 turns go in word for word and the rest is summed up by a separate one-turn call with no tools (`summarise.ts`, like the recap), labelled in the seed as written for this, and shown in the dialog first. Both numbers are settings (`chatContinue`).
- **The chat starts like any other**: the organisation guard, Plan mode, the floor and the Approver. The recorder files it as a fork of the imported chat at its last message, and it says "Continued in Codehouse. Not synced to claude.ai."
- **Audited**: the fork, the two choices, the seed's size and whether it was summed up.
- **Instructions**: the export does not link conversations to projects, so the instructions box is offered only when a chat has been placed in an imported project.
