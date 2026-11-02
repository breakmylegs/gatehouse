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
| O-5 | The everyday features of the Claude and ChatGPT apps | partial: Retry and Edit done (Phase 91); find in a chat next | Retry a reply and edit-and-resend (fork at a message: SDK resume, resumeSessionAt, forkSession); find in a chat; more from the familiarity research prompt when its report comes |

## Wave 0: the safety seam

| Id | Item | Status | Notes and acceptance |
|---|---|---|---|
| B01 | Approver in a PreToolUse hook | done, and a gap closed | The floor hook sees every call (since Phase 0) and asks in Manual (Phase 72). Checking the permissions page found Plan mode was not covered; fixed in Phase 87 (T50) |
| B02 | Pin the permission mode and setting sources | done | Mode set on every session (invariant 3); confirmed a session otherwise starts in `default` from 2.1.302. Setting sources stay user, project, local for coding sessions: allow rules there cannot skip the Approver because the hook answers ask (deny > ask > allow) |
| B03 | Refuse plugin mods and plugin permission logic | partial | Hooks and outside servers refused (Phase 80). Add: refuse any plugin with a mods component; zip and URL installs covered by the same reader |
| B04 | Claude Code version range gate | todo | Sessions refuse a binary outside the range a signed Codehouse release names; a Doctor link |
| B05 | Fail-closed fuzz suite for the decision path, phone included | partial | Many fail-closed tests exist; add 10,000 fuzzed payloads (truncated, wrong signature, replayed, late) with zero allows |
| B06 | MCP 2026-07-28 readiness in in-process servers | todo | URL-mode elicitation becomes an Approver decision showing the full URL, never opens a browser by itself |
| B07 | Doctor page | todo | Binary version, organisation guard, listener tokens, relay, Ollama, disk; each with a fix; output redacted |

## Wave 1: the agent work surface

| Id | Item | Status | Notes and acceptance |
|---|---|---|---|
| B08 | Agents board | partial | Dashboard exists; make it the board: every session with state, model, spend, last action, time waiting; a waiting row opens its approval; updates within 1 s |
| B09 | More sessions than panes | partial | Sessions run beyond the 4 panes already; add a global cap (CPU, memory, number) on top of per-session limits; kill switch stops all within 2 s |
| B10 | A git worktree for each session, with a cleanup panel | todo | New session can start in a new worktree from a chosen base, in a sibling folder; cleanup shows disk use, removes after confirmation; merging back is the user's action |
| B11 | Monaco editor and diff component | todo | Pure JavaScript; files up to 5 MB in 500 ms; side by side and inline diff; keyboard and ARIA. Bundle size noted |
| B12 | Live diff panel with per-hunk accept and reject | partial | A changes pane exists; add per-hunk revert (recorded in the audit) and a live refresh within 1 s; Accept all asks first |
| B13 | Fork a session or hand off a side task | partial | Fork exists from Earlier sessions; add Fork from an open session, into a worktree when B10 lands; policy inherited, never loosened |
| B14 | Session recap on return | todo | After 10 minutes away: up to 5 bullets of files changed, approvals given, anything pending; redacted |
| B15 | Usage drivers breakdown | todo | Tokens and cost by model, subagent, skill and tool per session and day |
| B16 | Pop-out panes | todo | A pane in its own WebView2 window with the same token, Host and Origin checks; docks back with its state |

## Wave 2: multi-AI foundations

| Id | Item | Status | Notes and acceptance |
|---|---|---|---|
| B17 | Data-boundary card per provider, providers allowed per project | partial | A gateway records what its provider keeps (Phase 86); add the card (retention, training use, region, ZDR, date checked) and a per-project allow list |
| B18 | Normalise and cap effort across providers | todo | Low to Max mapped to each provider's parameter; policy can cap it |
| B19 | Local model profiles for corporate laptops | todo | Detect RAM and GPU, suggest a profile, show the licence before use, refuse models not on the IT allow list |
| B20 | Unified cost and limits meter | partial | Claude plan meter exists; add caps per provider and in total that pause and ask |
| B21 | Model registry with fallback chain | todo | Fallback only to an allowed provider with the same or a stricter data boundary, every switch recorded |
| B22 | Side-by-side answers from several providers (chat) | todo | Two to four allowed models, columns with cost and latency, the chosen one recorded |
| B23 | AGENTS.md read across providers | todo | Read through the floor and given to every provider |
| B24 | Memory freshness | todo | Each memory shows its age; over 90 days flagged |

## Wave 3: deeper agent capability

| Id | Item | Status | Notes and acceptance |
|---|---|---|---|
| B25 | Goal mode (until a check passes) | partial | Extreme carry-on is close; add an explicit check command (an Approver-decided call) and stop on pass or limit |
| B26 | Auto-continue after the usage limit resets | partial | Pause at the plan limit and start again on reset exist (owner, 31 Oct); confirm opt-in and the spend cap |
| B27 | Review agent on a worktree diff | todo | Plan mode, read-only; findings linked to diff lines |
| B28 | Security scan agent | todo | Read-only; patches only through B12 |
| B29 | Test and build loop panel | todo | Test commands allow-listed per project in policy |
| B30 | Local codebase index | todo | ripgrep (needs IT) plus tree-sitter WASM; floor-excluded files never indexed; one-click delete |
| B31 | Allow-listed docs fetch | partial | WebFetch goes to the Approver and is marked untrusted; add a per-project domain allow list |
| B32 | Provenance labels against prompt injection | partial | Web content is marked untrusted (ADR 0007); add taint: calls whose arguments come from untrusted content get a higher risk |
| B33 | Read-only view of agent shell output | partial | Tool output shows in the tool tree; a live read-only terminal view is todo |

## Wave 4: automation, phone, governance

| Id | Item | Status | Notes and acceptance |
|---|---|---|---|
| B34 | Local routines (schedule, file and git triggers) | todo | Only while signed in; each run a normal session with Extreme limits; kill switch covers them |
| B35 | Phone starts a session from an approved template | no, safe variant later | Free text from the phone conflicts with rule 7 as amended; a signed template with fixed inputs is the safe variant |
| B36 | Local OpenTelemetry export | todo | To 127.0.0.1 or a file by default, no prompt text, redacted |
| B37 | Signed managed policy bundle from IT | todo | A policy file signed by an IT key, read-only location; tampering stops sessions starting |
| B38 | EU AI Act Article 50 labelling | todo | "AI-assisted" label and model metadata on every export and artifact |
| B39 | Plugin eval harness | todo | Pass rate with and without a plugin, under the Approver in Plan mode |
| B40 | Screen reader mode and keyboard-only audit | partial | Announcer and ARIA exist; add a linear screen-reader mode and an automated scan; a manual NVDA run stays with the owner |

## Wave 5: hosted and third-party agents

| Id | Item | Status | Notes and acceptance |
|---|---|---|---|
| B41 | Azure OpenAI through WAM in the C# host | no, replaced | ADR 0010 decided option 4 (2 Nov): hosted models through an organisation gateway, no credential in Codehouse. WAM stays on file if no gateway is possible (would need a rule 5 change and security) |
| B42 | GitHub Copilot SDK as a provider | later | Needs IT approval and a spike proving every tool call reaches the Approver (conformance suite) |
| B43 | Codex as a provider | later | Its hooks are documented as not a complete boundary (ADR 0008); not wrapped |
| B44 | ACP host adapter | later | Only an agent that passes the conformance suite, including hidden-tool tests |
| B45 | Artifact sharing without the cloud | partial | Export with a redaction preview exists; add a self-contained offline HTML artifact export |

## Order

The owner's requests (O-3 to O-5), then B03, B07, B04, B08, B10, B11, B12, B13, B14, B15, B17, B18, B22, B24, B38, B40, then the rest of the waves in order. Items marked later or no wait for their decision or stay as noted.
