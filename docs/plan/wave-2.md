# Wave 2: from the owner's research report (2 Nov 2026)

The owner pasted a deep-research report ("Codehouse (Gatehouse): research report and build plan to become the best safe multi-AI workbench, November 2026") and asked for it to be used to enhance the app. This file is that report's backlog, mapped against what Codehouse already has, with the owner's own requests from the same day first. The build session checks each item's key claim against the vendor's page before building it, as for the multi-provider report.

Status: **done** (already true or built), **partial**, **todo**, **later** (blocked on someone else), **no** (conflicts with a rule; the safe variant is noted).

## The owner's own requests, 2 Nov (first)

| Id | Item | Status | Notes |
|---|---|---|---|
| O-1 | A long first message refused a new chat ("under 2000 characters") | done | Phase 85 |
| O-2 | "Codehouse stopped unexpectedly" with nothing to say why | done | Phase 85: exit code logged, starts again by itself (3 in 10 min) |
| O-3 | Chat and Code switch at the top left, as in Claude Code | done (Phase 89) | Sidebar toggle: Chat shows chats and New chat, Code shows coding sessions and New session; follows what is open; remembered. Behaviour like Claude's, Codehouse's own look (invariant 16) |
| O-4 | Progress card: steps done, in progress, not started | done (Phase 90) | Live in the conversation and above the prompt box, from Claude's task list (TodoWrite), with "3 of 7 done" and a bar; screen-reader text for each state |
| O-5 | The everyday features of the Claude and ChatGPT apps | partial: Retry and Edit (Phase 91) and find in a chat (Phase 94) done | Retry a reply and edit-and-resend (fork at a message: SDK resume, resumeSessionAt, forkSession); find in a chat; more from the familiarity research prompt when its report comes |

## Wave 0: the safety seam

| Id | Item | Status | Notes and acceptance |
|---|---|---|---|
| B01 | Approver in a PreToolUse hook | done, and a gap closed | The floor hook sees every call (since Phase 0) and asks in Manual (Phase 72). Checking the permissions page found Plan mode was not covered; fixed in Phase 87 (T50) |
| B02 | Pin the permission mode and setting sources | done | Mode set on every session (invariant 3); confirmed a session otherwise starts in `default` from 2.1.302. Setting sources stay user, project, local for coding sessions: allow rules there cannot skip the Approver because the hook answers ask (deny > ask > allow) |
| B03 | Refuse plugin mods and plugin permission logic | done (Phase 96) | Hooks, outside servers, other plugins and anything not readable first refused (Phase 80); a mod is named in the refusal; a session that loaded a plugin with a mod from outside Codehouse stops before any tool runs; CLAUDE_CODE_PLUGIN_DIRS stripped |
| B04 | Claude Code version range gate | done (Phase 98) | The release names the Claude Code versions it was checked with (2.1.310); a session reporting another, or none, stops before any tool runs; the Doctor says so; a test fails when the SDK is upgraded until the new version is checked and written down |
| B05 | Fail-closed fuzz suite for the decision path, phone included | done (3 Nov) | Many fail-closed tests exist; add 10,000 fuzzed payloads (truncated, wrong signature, replayed, late) with zero allows |
| B06 | MCP 2026-07-28 readiness in in-process servers | done (3 Nov) | URL-mode elicitation becomes an Approver decision showing the full URL, never opens a browser by itself |
| B07 | Doctor page | done (Phase 97) | Claude Code and its version, sign-in, organisation guard, Approver and rule files, kill switch, listener on 127.0.0.1, PowerShell checker, phone and push channels, models on this computer, disk space, updates; each with what to do; a report to copy with secrets and email addresses taken out |

## Wave 1: the agent work surface

| Id | Item | Status | Notes and acceptance |
|---|---|---|---|
| B08 | Agents board | done (Phase 99) | The Dashboard's live sessions are the board: those waiting first, each with state, model, spend, what it is doing, how long it has waited; Decide opens its request; kept up to the second |
| B09 | More sessions than panes | done (3 Nov): a limit on how many are open at once; processor and memory per session are capped by its level and shown in its bars | Sessions run beyond the 4 panes already; add a global cap (CPU, memory, number) on top of per-session limits; kill switch stops all within 2 s |
| B10 | A git worktree for each session, with a cleanup panel | done (Phase 100) | Start a session in a new worktree from a base you name, in <repo>.worktrees beside the repository, on codehouse/<date-id>; the Worktrees panel shows size, commits and work not committed, removes only worktrees Codehouse made, after confirming, keeping the branch; recorded in the audit log |
| B11 | Monaco editor and diff component | done (Phase 101), with CodeMirror 6 | Read-only code view and diff (side by side and inline, choice kept) on CodeMirror 6 rather than Monaco: 109 KB gzipped, no web workers, strong screen reader support; files up to 5 MB; keyboard and ARIA; editing stays with Claude (through the Approver) or your own editor |
| B12 | Live diff panel with per-hunk accept and reject | done (Phase 102) | Each change in a changed file listed in words with Undo, asked first, put back only against the version shown, after a safety checkpoint, and recorded (whole-file undo is now recorded too); the pane refreshes a second after each step. Accepting needs no action: a change stays unless undone |
| B13 | Fork a session or hand off a side task | done (Phase 103) | Fork from an open session's menu (beside it, same folder); Hand off a side task starts a new session, in a new worktree if you like, told the task and where it came from; both keep mode, approval, model, effort and account. A fork into a worktree waits: resuming a conversation from another folder is not recorded SDK behaviour |
| B14 | Session recap on return | done (Phase 104) | After 10 minutes or more away (the window hidden or not in front), each open session says in up to 5 lines: turns finished or still working, files changed, requests decided, requests waiting, whether it stopped; until Got it. Worked out in the window from what it already holds, so nothing new is kept or sent |
| B15 | Usage drivers breakdown | done (Phase 105) | Tokens and cost by model per session and day were there; added What drove it on Usage: tool calls by tool, subagents and skills for the same dates, project and session, counted from the audit log (Claude Code reports cost per model only, so these are counts) |
| B16 | Pop-out panes | done (3 Nov) | A pane in its own WebView2 window with the same token, Host and Origin checks; docks back with its state |

## Wave 2: multi-AI foundations

| Id | Item | Status | Notes and acceptance |
|---|---|---|---|
| B17 | Data-boundary card per provider, providers allowed per project | done (Phase 97b, 3 Nov) | A gateway records what its provider keeps (Phase 86); add the card (retention, training use, region, ZDR, date checked) and a per-project allow list |
| B18 | Normalise and cap effort across providers | done (3 Nov) | Low to Max mapped to each provider's parameter; policy can cap it |
| B19 | Local model profiles for corporate laptops | done (4 Nov): the profile, the licence, and IT's signed list of allowed models (models.json beside the managed policy) | Detect RAM and GPU, suggest a profile, show the licence before use, refuse models not on the IT allow list |
| B20 | Unified cost and limits meter | done (4 Nov): a daily spending cap over every session beside the plan meter; models on this computer cost nothing | Claude plan meter exists; add caps per provider and in total that pause and ask |
| B21 | Model registry with fallback chain | done (4 Nov): carry a chat on with an allowed model no looser than Claude, by your choice, recorded | Fallback only to an allowed provider with the same or a stricter data boundary, every switch recorded |
| B22 | Side-by-side answers from several providers (chat) | done (3 Nov) | Two to four allowed models, columns with cost and latency, the chosen one recorded |
| B23 | AGENTS.md read across providers | done (4 Nov) for coding sessions; chats on a model on this computer have no project folder | Read through the floor and given to every provider |
| B24 | Memory freshness | done (3 Nov) | Each memory shows its age; over 90 days flagged |

## Wave 3: deeper agent capability

| Id | Item | Status | Notes and acceptance |
|---|---|---|---|
| B25 | Goal mode (until a check passes) | done (4 Nov) | Extreme carry-on is close; add an explicit check command (an Approver-decided call) and stop on pass or limit |
| B26 | Auto-continue after the usage limit resets | done (3 Nov): a setting, on by default; Extreme limits still apply | Pause at the plan limit and start again on reset exist (owner, 31 Oct); confirm opt-in and the spend cap |
| B27 | Review agent on a worktree diff | done (4 Nov) | Plan mode, read-only; findings linked to diff lines |
| B28 | Security scan agent | done (4 Nov) | Read-only; patches only through B12 |
| B29 | Test and build loop panel | done (4 Nov), through goal mode | Test commands allow-listed per project in policy |
| B30 | Local codebase index | todo | ripgrep (needs IT) plus tree-sitter WASM; floor-excluded files never indexed; one-click delete |
| B31 | Allow-listed docs fetch | done (3 Nov): remembered sites, per project | WebFetch goes to the Approver and is marked untrusted; add a per-project domain allow list |
| B32 | Provenance labels against prompt injection | done (4 Nov) | Web content is marked untrusted (ADR 0007); add taint: calls whose arguments come from untrusted content get a higher risk |
| B33 | Read-only view of agent shell output | waiting on the SDK (4 Nov) | Checked against SDK 0.3.310: a running tool reports only elapsed time (tool_progress), which the activity line shows; output arrives when the call finishes (the tool tree) and a background task names its output file only when it ends (task_notification). A live view needs an SDK that streams output; no undocumented path is used |

## Wave 4: automation, phone, governance

| Id | Item | Status | Notes and acceptance |
|---|---|---|---|
| B34 | Local routines (schedule, file and git triggers) | done for schedules (4 Nov); file and git triggers later | Only while signed in; each run a normal session with Extreme limits; kill switch covers them |
| B35 | Phone starts a session from an approved template | no, safe variant later | Free text from the phone conflicts with rule 7 as amended; a signed template with fixed inputs is the safe variant |
| B36 | Local OpenTelemetry export | done (4 Nov) | To 127.0.0.1 or a file by default, no prompt text, redacted |
| B37 | Signed managed policy bundle from IT | done (4 Nov), docs/managed-policy.md | A policy file signed by an IT key, read-only location; tampering stops sessions starting |
| B38 | EU AI Act Article 50 labelling | done (3 Nov) | "AI-assisted" label and model metadata on every export and artifact |
| B39 | Plugin eval harness | done (4 Nov): Marketplace, Evaluate; each task with and without the plugin in Plan mode, pass rates both ways | Pass rate with and without a plugin, under the Approver in Plan mode |
| B40 | Screen reader mode and keyboard-only audit | done (3 Nov), manual NVDA run with the owner | Announcer and ARIA exist; add a linear screen-reader mode and an automated scan; a manual NVDA run stays with the owner |

## Wave 5: hosted and third-party agents

| Id | Item | Status | Notes and acceptance |
|---|---|---|---|
| B41 | Azure OpenAI through WAM in the C# host | no, replaced | ADR 0010 decided option 4 (2 Nov): hosted models through an organisation gateway, no credential in Codehouse. WAM stays on file if no gateway is possible (would need a rule 5 change and security) |
| B42 | GitHub Copilot SDK as a provider | later | Needs IT approval and a spike proving every tool call reaches the Approver (conformance suite) |
| B43 | Codex as a provider | later | Its hooks are documented as not a complete boundary (ADR 0008); not wrapped |
| B44 | ACP host adapter | later | Only an agent that passes the conformance suite, including hidden-tool tests |
| B45 | Artifact sharing without the cloud | done (3 Nov) | Export with a redaction preview exists; add a self-contained offline HTML artifact export |

## Order

The owner's requests (O-3 to O-5), then B03, B07, B04, B08, B10, B11, B12, B13, B14, B15, B17, B18, B22, B24, B38, B40, then the rest of the waves in order. Items marked later or no wait for their decision or stay as noted.
