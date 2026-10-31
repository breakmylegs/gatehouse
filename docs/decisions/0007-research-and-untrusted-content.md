# ADR 0007: Research mode and untrusted web content

Status: Proposed, 31 Oct 2026. Waiting for the owner.

## Context

G5 asks for web search and a research mode with a sources pane, with fetched pages tagged untrusted. G21 (Wave 2 in the paper) adds taint tracking. The paper warns that G5 needs G21 for safe fetching.

## What was checked (live probe, 31 Oct, $0.22)

- On this account and its managed policy, Claude Code offers `WebSearch` and `WebFetch`. `WebSearch` is a deferred tool: Claude first calls `ToolSearch` with `select:WebSearch`.
- The `WebSearch` call reaches `canUseTool` with its query (`{"query": "...", "mode": "standard"}`), so JCVC sees every query before it runs.
- The result comes back two ways: as text in the tool result, and as structured data in the message's `tool_use_result` (`results[].content[]` with `title` and `url`). A sources pane can use the structured data.
- Probe script: `C:\dev\.agentic-scratch\jcvc\research\websearch-probe.mts`.

## Proposed decision

- **Research** is a chat option, not a new kind of session. It adds a research instruction to `append` (plan the questions, search, read the best sources, cite each claim by number) and keeps Plan mode.
- **Sources pane:** built from `tool_use_result` for searches, and from `WebFetch` inputs for pages read. Each source is marked "from the web, untrusted".
- **Queries leave the computer**, so the Approver checks each `WebSearch` query and `WebFetch` address against the redaction list. A query that contains a listed term is refused with a message asking Claude to rephrase. It is never rewritten silently. This needs a policy rule and an audit entry like any other decision.
- **Untrusted content in Wave 1:** a chat is in Plan mode and cannot run commands or write files, so content it reads cannot lead to a dangerous call there. The full taint tracking of G21 stays in Wave 2, where code sessions read web content and can act on it.

## Consequences

- No new package. Research output can be saved as a Markdown artifact (ADR 0003).
- The owner can turn web access off for chats in Policy, as for any tool.

## Constraint check

Fits. The Approver stays the single decider. Nothing is bypassed. Queries are checked before they leave.

## Verification

Automated: a policy test (a query with a redaction term is refused with a rule id), a transcript test that builds sources from a recorded `tool_use_result`, and a fake-SDK test that research adds its instruction. Named manual check: a research question on a current topic shows numbered citations and the sources pane.
