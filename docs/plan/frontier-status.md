# Frontier build status (D-001 to D-100, with C prerequisites)

The prompt is `docs/plan/frontier-build-prompt.md`; the paper behind it is `docs/research/feature-frontier-2026-11.md`. Read this file first after any compaction, restart or update, and carry on from the first item not done. Updated at the end of every slice and before every release.

Status values: todo, in progress, built, built safe variant, listed for decision, blocked, deferred.

## Conflicts recorded (CLAUDE.md wins; owner decisions are the owner's)

1. **Network connectors.** The prompt lists for IT anything that adds network access or trust in a registry (D-053 existence and age, D-057 snapshot source, D-063 npm provenance). The owner decided on 9 Nov, after IT was ruled out: "I am never going to ask IT ... it should be built to be able to connect to self hosted or online existing versions of these servers". Resolution: such lookups are built as connectors that are off until the owner switches them on and names the server, and that can only tighten (escalate or deny), never allow; with no connector the safe offline variant applies.
2. **Releases with --skip-tests.** Earlier releases in this build ran `npm run release -- --skip-tests` (the gate ran first). From now releases run the full tests, as section 8 says, until C-002 adds the signed override.
3. **Small releases and a short test period (owner, 12 Nov).** "Make sure you build releases frequently and commit them so we dont have super releases going on when people auto update. Also look to refine the testing period as it seems to have grown very large." Resolution: merge, push and release after every few slices, not once a wave; the gate no longer runs every test when memory is short, only the files the change reaches (scripts/related-tests.mjs), eight to a process (scripts/test-shards.mjs). A release still gates everything since the last release, which stays small when releases are frequent.
4. **Branches.** CLAUDE.md asks for one branch per phase fast-forwarded into main; the prompt asks for one per slice. Both hold: one branch per slice, fast-forwarded into main and pushed.
5. **Web fetches (owner, 12 and 13 Nov).** "Web fetch should just be allowed on extreme approval mode. Also I should be able to just approve all web fetches ... from the approval button." Built: an exact address from a page is not egress; a WebFetch carrying a read value is held as tainted-fetch, which Extreme approval answers; the card allows every WebFetch or WebSearch of a session in one click (audited, desktop only). After a prompt-injection flag (owner, 13 Nov: it blocked the session too) fetches are decided the same way, the injected parts taken out, and network commands such as curl still ask even in Extreme approval. BUILD_REPORT "Web fetches in Extreme approval".

## Owner's connector items (9 Nov), from the backlog

| Id | Title | Status | Branch | Note |
|---|---|---|---|---|
| G27 | Undo outside git | built | slice/G27-undo-outside-git | BUILD_REPORT "Backlog G27" |
| G28 | Install guard | todo | | Folds into D-053, D-054, D-057, D-063, D-064 (registry and OSV connectors per conflict 1) |
| G26 | Sandbox | todo | | Egress proxy on 127.0.0.1 with an allow-list, optional upstream proxy; relates to D-094 |
| G38 | Test explorer | todo | | Connectors to the project's own runners (Vitest, Jest, pytest, dotnet) |
| G7 | XLSX in chats | todo | | Node built-ins only, no library |
| G9 | Voice | built | feat/pkg1 | Whisper-compatible server through 127.0.0.1 (ADR 0010), Windows voice typing kept (T-136) |
| G34 | Language servers | todo | | Folds into C-032 (TypeScript language service) plus user-installed servers |
| G37 | Debugger | todo | | Debug adapters (debugpy, netcoredbg, js-debug); DAP only, never CDP |
| G40 | Public hosts and sharing | todo | | Host CLIs with their own sign-in; zip without secrets |

## Owner requests during the build

| Id | Title | Status | Branch | Note |
|---|---|---|---|---|
| O21 | Session details panel, like Claude Code's (owner, 9 Nov, two screenshots) | built | slice/O21-session-details | BUILD_REPORT "O21" | Details in each pane's side rail: Environment, Context with its parts, Connectors (names and states only), Changes (+/-), background tasks with how long each has run. No hover hints. |
| O22 | Limits in Settings always hold; a bypass per session with a time, a spending limit or both (owner, 9 Nov) | built | fix/plan-limit-extra | BUILD_REPORT "Fix, limits in Settings always hold" | Released in 2.0.148 |
| O23 | Extreme approval asked about a plain rmdir (owner, 9 Nov) | built | fix/rmdir-empty-only | BUILD_REPORT "Fix, Extreme approval asked about an rmdir" | |
| O24 | ntfy 429 while listening (a user's report, 9 Nov) | built | fix/ntfy-429 | BUILD_REPORT "Fix, ntfy 429 while listening" | Released in 2.0.147 |
| O25 | See sessions remotely, send prompts, see their status as it goes (owner, 11 Nov, the priority) | built | slice/G32-live-sessions | BUILD_REPORT "Sessions on the phone, live" | Through the passkey phone app (invariant 11 as amended 30 Oct); shared within 3 s of a change |
| O26 | The session's plan as a checklist, and the details panel's gaps against Claude Code's (owner, 13 Nov, two screenshots: "I love these features ... add them to later in the build queue") | todo | | | A checklist of Claude's steps in the transcript, each marked waiting, in progress or done as it goes (from TodoWrite). Against O21's panel: a Stop for each running background task and how many have finished; Context split as Messages, System tools (and deferred), System prompt, Memory files (expandable, with a count), Skills, Since last update, Autocompact buffer and Free space; Environment naming the computer, the folder, the project and the branch. Own design, not Claude Code's look (invariant 16) |
| O27 | The per-commit gate still follows every file that imports a changed file (13 Nov, after 2.0.269) | built | slice/O27-gate | BUILD_REPORT "O27" | One fix reached 237 test files. Narrow it to the owner's testing standard (13 Nov, global CLAUDE.md): the changed tests and the regression tests for what the change touches, named; the whole import graph only for shared foundations, with the reason said |
| O28 | The release upload fails part-way on large files (13 Nov, twice) | built | fix/O28-upload-retries | BUILD_REPORT "O28" | Upload release files one at a time with retries and a check that each matches, so a release finishes by itself; never publish with a file missing |
| O30 | The rules sometimes do not work: a plain cat and ls held as evaluator-unavailable, "the policy evaluator could not be reached (timed out)" (owner, 14 Nov, screenshot, tripboard) | built | | | Fail closed is right, but the timeout should be rare. Find why the Approver times out (memory pressure, the PowerShell AST worker, a cold start, the timeout value), measure its latency, retry once on a timeout before asking (still failing closed), and show evaluator timeouts in Doctor |
| O32 | Extreme approval should never ask about a risk, even at 100 (owner, 14 Nov, screenshot of a push held as tainted-egress) | built | fix/extreme-every-risk | BUILD_REPORT "Extreme approval answers every risk" | Only failures (invariant 1), locked tests and a strict project's tests still wait |
| O33 | Every Windows release includes every contributor's pushed work (owner, 14 Nov) | built | | CLAUDE.md "Two machines" | Fetch and rebase, list PRs and branches, merge what is finished and gated, gate the result, report who went in |
| O31 | Review t3code (pingdotgg/t3code) and build its features into Codehouse (owner, 14 Nov: "This is the priority task and top of queue") | in progress | | | Review in docs/research/t3code-review-2026-11.md; Build items queued from it, Conflicts listed for the owner |
| O34 | In Ask about code, when Claude thinks the codebase needs a change, offer to put the prompt into the coding session, and every time ask you, as a manual approval (owner, 14 Nov) | built | slice/O34-handoff | BUILD_REPORT "O34", threat T122 | Desktop only, never remembered, never Extreme approval; audited each time |
| O35 | The session buttons across the top: the session name rather than its code, smaller text, scrollable, most recently active first (owner, 14 Nov, screenshot) | built | slice/T1-changes | BUILD_REPORT "O35" | Host sends activeAt (optional; older Hosts fall back to the start time) |
| O36 | Two Extreme modes: Extreme max approval approves everything; Rules-based Extreme approval pauses at a risk limit (80, set in Settings). Also a git ls-files of a locked test was held (owner, 15 Nov, screenshot) | built | fix/extreme-modes | BUILD_REPORT "O36" | Max still waits for failures and the O34 hand-off, for the owner to confirm |
| O37 | Standing rule: a feature pushed to GitHub that is Mac only gets a Windows version too (owner, 15 Nov) | todo | | | First: the notch wing (PR #7) |
| O38 | Remove the session codes (DV 954) from the interface (owner, 15 Nov, screenshot) | todo | | | /tell and @session need names instead |
| O39 | MCP builder: its own menu item; build MCP servers in a session; start, stop, start with Codehouse, CPU and memory limits; /mcp <name> with completion in Code sessions; a builder session can call running servers (owner, 15 Nov) | todo | | | The laptop policy blocks stdio and http MCP in sessions: bridge through the in-process Companion. Priority 2 |
| O40 | A prompt an Ask about code chat sent shows in the code session (owner, 15 Nov, screenshot) | built | fix/extreme-modes | BUILD_REPORT "O40" | |
| O41 | Codehouse Neighbourhood Watch: a docker compose web front end on a home server for remote Codehouse sessions, Codehouse connecting out, full control, in-app updates, username and password with passkeys, an IP allow list, desktop, tablet and phone (owner, 15 Nov) | todo | | | Priority 1: research first. Changes invariants 7 to 9 and 11; design note before building |
| O29 | Review the fork david-mcclymont-acn/gatehouse (owner, 13 Nov) | todo | | | A more Apple-like layout and better ntfy handling; bring across what fits invariant 16 (Codehouse's own look) and the push-channel rules (invariants 8, 9, 11) |
| O44 | The changelog as a clickable timeline of releases: a point per release with version and date, its notes in a pop-up (never raw HTML), the running and newer releases and what is new since you read it marked, offline, keyboard and screen reader, reusing the session timeline (owner, 20 Nov) | todo | | | Queue 2026-11-18, section 7 item 6 |
| O45 | One approval option instead of two: "Max approval", exactly as Extreme max approval is now; the rules-based Extreme mode and its risk-limit setting removed; existing sessions, choices and settings moved over; managed policy cap, carry-on and never-remembered kept; help, guide, Audit template, CNW and the Mac app updated; floor and Approver always consulted (owner, 20 Nov) | todo | | | Queue 2026-11-18, section 7 item 7 |

## Prerequisites (C-backlog)

| Id | Title | Before | Status | Branch | Phase | Note |
|---|---|---|---|---|---|---|
| C-001 | Memory-aware test sharding by file | Wave 1 | built | slice/C-001-test-shards | BUILD_REPORT "Frontier C-001" | Three runs under 70% load owed |
| C-002 | Gate refuses --skip-tests | Wave 1 | built | slice/C-002-skip-tests-override | BUILD_REPORT "Frontier C-002" | Signed per-version override, audited |
| C-004 | Memory governor | Wave 1 | built | slice/C-004-memory-governor | BUILD_REPORT "Frontier C-004" | 85% commit by default; new sessions, chats and page looks refused with a card; idle sessions offered for suspension |
| C-013 | Grant lifetimes | Wave 1 | built | slice/C-013-grant-lifetimes | BUILD_REPORT "Frontier C-013" | Expiry (30 days by default), folder scope, use limits; a sidecar file so older versions still read the rules |
| C-010 | Audit-backed session timeline | Wave 2 | built | slice/C-010-timeline | BUILD_REPORT "Frontier C-010" | Timeline... in a session's menu; replay is Try a request with the call filled in |
| C-011 | Signed timeline export | Wave 2 | built | slice/C-011-signed-timeline | BUILD_REPORT "Frontier C-011" | ECDSA P-256 (Windows PowerShell 5.1 has no Ed25519); both verifiers check it |
| C-012 | Policy dry run | Wave 2 | built | slice/C-012-policy-dry-run | BUILD_REPORT "Frontier C-012" | On the plan's card and in its record; calls read from code blocks, backticks and named files |
| C-016 | Verified data-boundary card per model | Wave 2 | built | slice/C-016-boundary-cards | BUILD_REPORT "Frontier C-016" | Per model as well as per provider; stale after 180 days by default; no card is not refused (owner to confirm) |
| C-031 | Tree-sitter outline and navigation (WASM) | Wave 2 | built | (commit 6d2eb89) | apps/host/test/outline.test.ts | Outline and go to symbol for TS, JS, Python, C#, PowerShell, JSON; 5,000 lines under 50 ms; row was out of date |
| C-032 | TypeScript language service worker | Wave 3 | built | feat/c032 | apps/host/test/ts-service.test.ts | Diagnostics, what a name is (as text, never a tooltip), definition (F12) and references in the file view; a worker with a memory cap that ends and starts again; typescript 5.9.3 pinned in the Host's dependencies |
| C-057 | Mermaid and Markdown artifacts | Wave 3 | built | feat/c057 | apps/host/test/mermaid-artifact.test.ts | Markdown artifacts were there; Mermaid diagrams drawn offline in the artifact sandbox, its file inlined, strict and locked against directives; mermaid a development dependency, one file ships |
| C-015 | Adaptive autonomy that only lowers | Wave 4 | built | feat/c015 | BUILD_REPORT "Frontier C-015" | Each project's cap from 30 days of the audit (floor denies, your denies), lowered by itself, raised only by your click; sessions start no higher and cannot be raised past it |
| C-008 | Pin a newer Claude Code through conformance | Wave 5 | todo | | | |
| C-036 | Local codebase index | Wave 5 | built | feat/c036 | BUILD_REPORT "Frontier C-036" | SQLite FTS5 (Node's own, verified) for text, a symbol table, incremental, under the data folder, floor secret globs excluded; 50,000 files indexed in 138 s on this laptop, and again with nothing changed in 16 s |
| C-043 | Cross-model review through the gateway | Wave 5 | built | feat/c036 | BUILD_REPORT "Frontier C-043" | A model on the runtime or gateway on 127.0.0.1 reviews the session's change (secret files left out, redacted, no tools); findings in the session's Review row |
| C-044 | Best-of-N in worktrees, judged by tests | Wave 5 | built | feat/c036 | BUILD_REPORT "Frontier C-044" | G25's runs ranked on their bars by checks (passing, not run, failing), then change size, then calls that asked; the memory governor caps N, keeping two or more that started |
| C-055 | Signed shared rule packs | Wave 6 | built | feat/c036 | BUILD_REPORT "Frontier C-055" | Signed shared rule packs in rule-packs under the data folder, keys trusted in Settings; deny and escalate always, allows only where IT's policy does not forbid them (packAllows, removeAllow); a bad signature stops the policy loading |
| C-067 | Foundry Local profiles | Wave 6 | built | feat/c036 | BUILD_REPORT "Frontier C-067" | Foundry Local as an OpenAI-compatible runtime with profile foundry-local; Find it reads its address from foundry server status (127.0.0.1 only); licence from its catalogue before first use; IT's list applies |

## Wave 1: truth and guards

| Id | Title | Status | Branch | Phase | Note |
|---|---|---|---|---|---|
| D-001 | Test integrity guard | built | slice/D-001-test-integrity | BUILD_REPORT "Frontier D-001" | Golden 15-test-integrity (41 cases); High risk so Auto asks; Extreme approve-and-flag by default, strict per project; D-003/D-009 to read the records |
| D-002 | Sealed held-out checks | built | slice/D-002-sealed-checks | BUILD_REPORT "Frontier D-002" | Built-in floor rule sealed-checks; DPAPI-sealed names and contents; job object; counts only to the session; sealed_no_leak |
| D-007 | Locked acceptance tests | built | slice/D-007-locked-tests | BUILD_REPORT "Frontier D-007" | Whole files; single cases after C-031 (outline) |
| D-008 | Pinned counterexamples | built | slice/D-008-pinned-counterexamples | BUILD_REPORT "Frontier D-008" | fast-check and Hypothesis written by Codehouse; FsCheck by Claude; fuzz inputs locked |
| D-009 | Done-claim verifier | built | slice/D-009-done-claims | BUILD_REPORT "Frontier section 6 ... D-009" | Section 6 runner built with it, and D-002 moved onto it; recap stamp and evidence pack later |
| D-013 | Effect-complete approval cards | built | slice/D-013-effect-cards | BUILD_REPORT "Frontier D-013" | Decision for the owner to confirm: a line no rule speaks of does not by itself make the call ask |
| D-015 | Allow-rule provenance lock | built | slice/D-015-provenance-lock | BUILD_REPORT "Frontier D-015" | Untrusted files kept apart from B32's taint; the broadest rule a person can remember is a site, typed to confirm |
| D-018 | Risk budget per session | built | slice/D-018-risk-budget | BUILD_REPORT "Frontier D-018" | Opt-in, off by default; a person's own approvals spend nothing |
| D-021 | Rubber-stamp detector | built | slice/D-021-rubber-stamp | BUILD_REPORT "Frontier D-021" | Per desktop connection; the deliberate approval checked by the Host too |
| D-025 | Dead-man timer for Extreme | built | slice/D-025-dead-man | BUILD_REPORT "Frontier D-025" | Opt-in per session, off by default; a new signed phone envelope, heartbeat |
| D-030 | Approval lineage on commits | built | slice/D-030-commit-lineage | BUILD_REPORT "Frontier D-030" | Evidence-pack hash with D-003 (Wave 2) |
| D-053 | Dependency admission control | built safe variant | slice/D-053-dependency-admission | BUILD_REPORT "Frontier D-053" | Offline; hallucination list has one documented name, owner to add; registry connector later per conflict 1 |
| D-054 | Lockfile diff guard | built | slice/D-054-lockfile-guard | BUILD_REPORT "Frontier D-054" | Every hand edit of a lockfile asks; install scripts and off-registry sources named |
| D-055 | Licence policy | built safe variant | slice/D-055-licences | BUILD_REPORT "Frontier D-055" | Offline: npm's download cache is not read, so a package not installed yet is unknown; Extreme never approves a licence outside the list; legal list owed |
| D-058 | Secret commit block | built | slice/D-058-secret-commit | BUILD_REPORT "Frontier D-058" | Extends G22: pushes are read too, findings name the line; golden lines in apps/host/test/golden |
| D-059 | Instruction integrity pinning | built | slice/D-059-instruction-pins | BUILD_REPORT "Frontier D-059" | Pins per project, sealed; outside changes block start, messages and Extreme turns until approved with a diff |
| D-060 | Agent-config tamper floor | built | slice/D-060-config-tamper | BUILD_REPORT "Frontier D-060" | Built into the floor; content-aware for Claude and VS Code settings |
| D-064 | Install-script default deny | built | slice/D-064-install-scripts | BUILD_REPORT "Frontier D-064" | npm, pnpm, yarn and bun; Run without scripts is an edited input, re-checked; never approved by Extreme |
| D-096 | WinGet and installer admission | built | slice/D-096-installer-admission | BUILD_REPORT "Frontier D-096" | Offline: publisher from the WinGet id, unchecked |

## Wave 2: evidence

| Id | Title | Status | Branch | Phase | Note |
|---|---|---|---|---|---|
| D-003 | Change evidence pack | built | slice/D-003-evidence-pack | BUILD_REPORT "Frontier D-003" | Per commit and on demand; hash in the D-030 note; inside the signed timeline export; coverage and mutation deltas only once a run records them |
| D-004 | Diff-scoped mutation gate | built | slice/D-004-mutation | BUILD_REPORT "Frontier D-004 and D-005" | Codehouse's own mutator on the changed lines (Stryker detected and named, a recorded deviation); sandbox copy; per-project threshold; memory cap stops cleanly |
| D-005 | Surviving-mutant tasks | built | slice/D-004-mutation | BUILD_REPORT "Frontier D-004 and D-005" | Task scoped to test files (test-scope, never auto-approved); mutant run again when its turn ends |
| D-010 | Randomised check seeds | built | slice/D-010-check-seeds | BUILD_REPORT "Frontier D-010" | CODEHOUSE_SEED, and Vitest's and Jest's own seed flags; recorded with the claim |
| D-011 | Flake quarantine | built | slice/D-011-flake-quarantine | BUILD_REPORT "Frontier D-011" | Five runs with their seeds; flaky is a mark on a contradicted claim (older screens read it); skipping goes through D-001 |
| D-016 | Taint-tracked egress guard | built | slice/D-016-taint-egress | BUILD_REPORT "Frontier D-016" | Addresses, hosts, emails and long tokens from pages, servers and untrusted files; network calls and writes outside the project; never approved by Extreme |
| D-017 | Subagent boundary labels | built | slice/D-017-subagent-labels | BUILD_REPORT "Frontier D-017" | A subagent's report carries the taint of what it read; one that read nothing untrusted taints nothing |
| D-026 | Policy regression from real history | built | slice/D-026-policy-regression | BUILD_REPORT "Frontier D-026" | Every save of the rules (file, Library, Your choices); typed phrase names the count; compared with the rules in force |
| D-027 | Step-exact reconstruction | built | slice/D-027-rebuild | BUILD_REPORT "Frontier D-027" | Rebuild here on a timeline call; checkpoint plus recorded edits; tree hash given; redacted edits, mismatches and shell commands marked |
| D-029 | Audit anchoring | built | slice/D-029-audit-anchors | BUILD_REPORT "Frontier D-029" | Local anchors (ECDSA P-256 for PowerShell 5.1, a recorded deviation), both verifiers, Anchor now; phone passkey anchors in D-029b |
| D-029b | Audit anchors signed with the phone's passkey | built | slice/D-029b-phone-anchors | BUILD_REPORT "Frontier D-029b" | Anchor with Face ID in the phone's Sessions; WebAuthn assertion kept and checked by both verifiers; the daily local anchor stays |
| D-056 | SBOM per change | built | slice/D-056-sbom | BUILD_REPORT "Frontier D-056" | Made by Codehouse from the lockfiles' text, no tool; ten lockfile kinds; ajv only to test it against the schema; D-003 will carry it |
| D-057 | Offline vulnerability snapshot | built | slice/D-057-vuln-snapshot | BUILD_REPORT "Frontier D-057" | Safe variant: signed OSV file in the managed folder, signed by whoever looks after the computer (no IT); commit escalates as vulnerable-dependency; refused snapshot matches nothing, Doctor reports it |
| D-061 | Untrusted content scanner | built | slice/D-061-injection-scan | BUILD_REPORT "Frontier D-061" | updatedToolOutput, which the SDK's types give for every tool (recorded in sdk-notes); fewer than 2 of 20 benign fixtures flagged, to be run |
| D-062 | Local SAST on agent diffs | built | slice/D-062-sast | BUILD_REPORT "Frontier D-062" | Six kinds across six grammars; Severe escalates the next commit (sast-severe, never auto-approved); unreadable commit counts as Severe |
| D-075 | Loop and thrash detector | built | slice/D-075-thrash | BUILD_REPORT "Frontier D-075" | Told first, in the failed call's result; stopped and the phone told on a repeat; no progress for N turns is Extreme's two idle turns |
| D-085 | Data-boundary hand-off check | built | slice/D-085-handoff-boundary | BUILD_REPORT "Frontier D-085" | Carrying a chat on with another model; internal by default goes anywhere it went before; confidential needs a card in date that allows it |

## Wave 3: intent and architecture

| Id | Title | Status | Branch | Phase | Note |
|---|---|---|---|---|---|
| D-066 | Characterisation capture | built | slice/D-066-characterise | BUILD_REPORT "Frontier D-066 and D-006" | Exported JS/TS functions, generated inputs, captured from the checkpoint's copy, kept only if stable; redacted; sandbox |
| D-006 | Behaviour diff | built | slice/D-066-characterise | BUILD_REPORT "Frontier D-066 and D-006" | Compare with now: each changed output in plain English |
| D-028 | Causal provenance graph | built | slice/D-028-provenance-graph | BUILD_REPORT "Frontier D-028" | Where it came from in Changes: hunk to edit to what was read before, injected and outside sources marked |
| D-031 | Evidence queries | built | slice/D-031-evidence-queries | BUILD_REPORT "Frontier D-031" | Four saved questions on the Audit page; incremental JSONL index per month; redacted; under 2 s at 100,000 records |
| D-033 | Requirement ledger | built | slice/D-033-requirements | BUILD_REPORT "Frontier D-033, D-034 and D-035" | docs/requirements Markdown with front matter, read tolerantly; trace matrix and gaps in Requirements... |
| D-034 | Unrequested behaviour detector | built | slice/D-033-requirements | BUILD_REPORT "Frontier D-033, D-034 and D-035" | Hunks the approved plan and the requirements do not account for, with the reason, in Changes |
| D-035 | Scope creep meter | built | slice/D-033-requirements | BUILD_REPORT "Frontier D-033, D-034 and D-035" | Files changed outside the plan, on the progress card |
| D-036 | Tests-first contract mode | built | slice/D-036-tests-first | BUILD_REPORT "Frontier D-036" | Tests first... in the session menu; implementation edits ask (tests-first, never auto-approved) until Approve the tests locks them |
| D-037 | Assumption register | built | slice/D-037-assumptions | BUILD_REPORT "Frontier D-037" | declare_assumption, sdk source only (rule assumption-tools); progress card with It holds; in the pack until verified |
| D-038 | ADR capture | built | slice/D-038-adr | BUILD_REPORT "Frontier D-038 and D-044" | Decisions... drafts MADR from answered questions and approved plans; written to docs/adr only when accepted |
| D-039 | Requirement change impact | built | slice/D-039-requirement-impact | BUILD_REPORT "Frontier D-039" | An edited requirement lists its code, tests and ADRs in Changes |
| D-040 | Intent drift alarm | built | slice/D-040-intent-drift | BUILD_REPORT "Frontier D-040" | Local runtime only (never a gateway), redacted; at turn ends (a recorded deviation); unavailable without one |
| D-041 | Architecture rules as policy | built | slice/D-041-architecture | BUILD_REPORT "Frontier D-041" | .codehouse/architecture.yml layers, allow, forbid; Tree-sitter imports; architecture rule, never auto-approved; graph in .codehouse/arch; 11 golden cases |
| D-042 | Living C4 diagrams | built | slice/D-042-c4-drift | BUILD_REPORT "Frontier D-042 and D-043" | Context, container and component in Mermaid, new modules marked; shown as text with Copy (no drawing library, a recorded deviation) |
| D-043 | Architecture drift alerts | built | slice/D-042-c4-drift | BUILD_REPORT "Frontier D-042 and D-043" | New modules, new cross-layer edges, new cycles since Approve as it is |
| D-044 | ADR-aware context | built | slice/D-038-adr | BUILD_REPORT "Frontier D-038 and D-044" | Accepted ADRs in each session's instructions; forbids in front matter flag a contradicting edit (adr-contradiction) |
| D-045 | Fitness functions | built | slice/D-045-fitness | BUILD_REPORT "Frontier D-045" | .codehouse/fitness.yml; a failing check stops a done goal run as fitness, and is in the evidence pack |
| D-046 | Public API break guard | built | slice/D-046-api-break | BUILD_REPORT "Frontier D-046" | Tree-sitter exports (C-032 not built, a recorded deviation); removed export in a library escalates as api-break; ApiCompat detected, never run |
| D-048 | Architecture review pack | built | slice/D-048-arc42 | BUILD_REPORT "Frontier D-048" | arc42 Markdown from requirements, rules, C4, ADRs, fitness, drift; gaps marked |
| D-050 | Threat model delta | built | slice/D-050-threat-delta | BUILD_REPORT "Frontier D-050" | Routes, data stores, outbound connections, listeners, new dependencies; STRIDE drafts in Changes with Copy |

## Wave 4: approvals and human factors

| Id | Title | Status | Branch | Phase | Note |
|---|---|---|---|---|---|
| D-014 | Consequence preview | built | feat/c036 | BUILD_REPORT "Frontier D-014" | Safe variant: moves and overwrites read from the words beside G20's deletes; nothing run. Shadow execution (Windows Sandbox, AppContainer) listed for IT and security |
| D-019 | Earned-autonomy proposals | built | feat/d019 | BUILD_REPORT "Frontier D-019" | Clean record since the cap (20 approvals none undone, 3 Verified claims, no failed sealed check, no floor deny) proposes one step; applies only on your desktop click, and with a phone paired only when its passkey confirms |
| D-020 | Explain why and what would change | built | feat/d020 | BUILD_REPORT "Frontier D-020" | PolicyEngine.explain: stage-by-stage trace and the smallest change; floor fixed with no change; IT's rules named; How it was decided on the card, explain on the policy tester |
| D-022 | In-turn batch approvals | listed for decision | | | LIST: owner decides whether one approval may cover identical calls in one turn; never High |
| D-023 | Scope lease | built | feat/d020 | BUILD_REPORT "Frontier D-023" | Lease of path globs and command families from the approved plan or the desktop; in Auto and Accept edits a write or command outside it asks (hook and canUseTool, rule scope-lease) |
| D-024 | Second confirmation for loosening | built | feat/d024 | BUILD_REPORT "Frontier D-024" | Safe variant: removing a deny or ask rule, a project no longer strict about tests, or raising an autonomy cap needs a typed phrase and applies after 10 minutes; phone and push told; cancel on the desktop. Passkey in place of the wait listed for security |
| D-087 | Interruption budget | built | feat/d087 | BUILD_REPORT "Frontier D-087" | Settings, Fewer interruptions: sessions finishing, notes from Claude and the digest gathered into one summary every 15 to 120 minutes; approvals and warnings at once; off by default |
| D-088 | Adaptive explanation depth | built | feat/d088 | BUILD_REPORT "Frontier D-088" | Short, Normal or Full per area (approvals, policy tester), kept on this computer; floor decisions always in full |
| D-089 | Review load meter | built | feat/d089 | BUILD_REPORT "Frontier D-089" | Review minutes on every pending change (5 lines a minute, a minute a file, x1.5 High, x2 Severe); Approvals warns when the last hour's allowed changes need more than your capacity (Settings, Review load) |
| D-091 | Narrated diffs and approvals | built | feat/d089 | BUILD_REPORT "Frontier D-091" | Each change in the Changes pane narrated (file, change N of M, kind, where and lines, risk) and reached with the arrow keys, Home and End. Owed by the owner: an NVDA run |
| D-092 | Safe keyboard approvals | built | feat/d089 | BUILD_REPORT "Frontier D-092" | High and Severe by keyboard: Ctrl+Enter, or Enter or Space on Allow, only arms; a second press within 2 s allows. Below High, Ctrl+Enter as before; pointer clicks unchanged |
| D-093 | Cognitive load presets | built | feat/d093 | BUILD_REPORT "Frontier D-093" | Settings, Appearance, Lighter load: Chunked plans, Calm, Fewer panels, Focus on one task; each passes the axe-core scan |

## Wave 5: analytics, knowledge, multi-model and health

| Id | Title | Status | Branch | Phase | Note |
|---|---|---|---|---|---|
| D-072 | Failure taxonomy | built | feat/c057 | apps/host/test/failure-taxonomy.test.ts | Loops, tool errors, failing tests, undos, contradicted claims and denials from the audit, per project and per model (learnt per session); a new tool_failed record (tool, test or not, model; never the error); on Insights |
| D-069 | Hotspot map | built | feat/c057 | apps/host/test/hotspots.test.ts | Files ranked by git churn (90 days), decision points and agent failures per file (tool_failed now names the file; edits put back); on Insights, by project |
| D-032 | Agent-aware build provenance | built | feat/c057 | apps/host/test/slsa.test.ts | provenance.intoto.json with each release: in-toto Statement v1, SLSA provenance v1; subjects by SHA-256, the commit, and the sessions since the last release from their git notes (audit link, evidence) |
| D-047 | Capability map | built | feat/c057 | apps/host/test/evidence.test.ts | .codehouse/capabilities.yml names capabilities by paths (and an owner); each evidence pack names the capabilities its change touches, or says there is no map |
| D-049 | NFR budgets | built | feat/c057 | apps/host/test/evidence.test.ts | .codehouse/budgets.yml (paths, maxMeanMs); tinybench (Vitest bench) or BenchmarkDotNet found and run as a Codehouse action when a change touches a budget; results in the evidence pack |
| D-051 | Personal data flow map | built | feat/c057 | apps/host/test/personal-data.test.ts | A draft: fields by name pattern followed to logs, storage and network calls on the same statement; scope and fields as Markdown for legal review; on Insights |
| D-063 | Package provenance verification | built safe variant | feat/c057 | packages/policy/test/nuget-signature.test.ts | A new NuGet package whose .nupkg here has no .signature.p7s escalates as nuget-unsigned (risk 76), offline; validity by dotnet nuget verify and npm provenance listed |
| D-065 | Test impact analysis | built | feat/d065 | apps/companion/test/test-impact.test.ts | affected_tests in coding sessions (rule test-impact-tools): imports plus shared history, a subset; release runs the invariant tests per owner 13 Nov (deviation recorded) |
| D-068 | Dead code with evidence | built | feat/d068 | apps/host/test/dead-code.test.ts | Insights, Dead code: unreferenced and tests-only exports, unimported files, coverage evidence; removal in slices of a file or five names |
| D-073 | Undo-learning loop | built | feat/d068 | apps/host/test/lessons.test.ts | Three similar undos or person's denials propose a CLAUDE.md line with its records; added through D-059 (recorded, refused over outside change, repinned); T157 |
| D-074 | Behaviour regression for Claude Code upgrades | todo | | | Needs C-008 (todo); built after C-008 in queue section 7 |
| D-076 | Cost per outcome | built | feat/d068 | apps/host/test/outcomes.test.ts | Insights, Cost per change: all project spend over noted commits, so undos, failed test runs and changeless sessions are in it |
| D-100 | Estimates from history | built | feat/d068 | apps/host/test/outcomes.test.ts, apps/web/test/outcomes.test.ts | 10th to 90th percentile and median per change, with the sample size; under 5 sessions says not enough history |
| D-077 | Context efficiency report | built | feat/d068 | apps/host/test/context-efficiency.test.ts | Insights: CLAUDE.md and AGENTS.md blocks a session's tool calls never named, with tokens and recent sessions' use |
| D-078 | Claim calibration score | built | feat/d068 | apps/host/test/failure-taxonomy.test.ts, apps/web/test/calibration.test.ts | Per model: Verified over Verified and Contradicted; unchecked and flaky counted apart; under 5 marked too few |
| D-079 | Codebase tours | todo | | | Needs C-036 (todo); built after C-036 in queue section 7 |
| D-081 | Why is this code like this | built | feat/d068 | apps/host/test/why.test.ts | File view: Why is line N like this? cites the blamed commit, its Codehouse note and evidence, and ADRs (same session, naming the commit, covering the file) |
| D-082 | Stale instruction detector | built | feat/d068 | apps/host/test/stale-instructions.test.ts | Insights, Instructions: backticked code names no code file has, missing paths and npm scripts, with the commit that removed a name |
| D-083 | Ubiquitous language glossary | built | feat/d068 | apps/host/test/glossary.test.ts, apps/web/test/glossary.test.tsx | Insights, The project's words: name vocabulary and synonym clashes (built-in groups plus .codehouse/glossary.yml) |
| D-084 | Adversarial pair | todo | | | Needs C-043 and C-044 (todo); built after them in queue section 7 |
| D-086 | Local judge for claims | built | feat/d068 | apps/host/test/claim-judge.test.ts | Built-in hard-coded-answer check, optional model on this computer (never a gateway); flag or escalate only, lowers Verified to Unverified; T158 |
| D-090 | Measured time panel | built | feat/d068 | apps/host/test/outcomes.test.ts, apps/web/test/measured-time.test.ts | Insights: Claude's measured minutes per change as an interval against the period before; faster or slower only with enough of both |
| D-099 | Evidence-backed stakeholder summary | built | feat/d068 | apps/host/test/stakeholder-summary.test.ts | Evidence, Copy a summary: sentences only from the pack, each with its evidence; unconfirmed claims and assumptions withheld and listed; redacted |

## Wave 6: enterprise and large items

| Id | Title | Status | Branch | Phase | Note |
|---|---|---|---|---|---|
| D-012 | Time-boxed fuzz pass | built | feat/d012 | BUILD_REPORT "Frontier D-012" | Safe variant: Codehouse's own seeded property runner (no new dependency) on changed exported parsers, as a Codehouse action, 60 s and a 256 MB heap cap; findings written to testdata/fuzz for D-008. Native fuzzers listed for IT and the owner |
| D-052 | Multi-repo contract check | built | feat/d052 | BUILD_REPORT "Frontier D-052" | A removed library export names the repositories beside it that depend on the package and import the name, with file and line, in the api-break reason |
| D-067 | Migration planner with evidence | built | feat/d067 | BUILD_REPORT "Frontier D-067" | Waves from a folder's imports, leaves first (a cycle one wave); each wave's callable files captured before (D-066) and compared after (D-006); done only with both; Claude asked one wave at a time |
| D-070 | PowerShell modernisation | built | feat/d067 | BUILD_REPORT "Frontier D-070" | PowerShell 7 check per script: the AST worker's commands against what 7 removed (cmdlets, aliases, -Encoding Byte, workflows), PSScriptAnalyzer added where installed; nothing runs |
| D-071 | Dependency upgrade with evidence | built | feat/d067 | BUILD_REPORT "Frontier D-071" | Upgrade evidence: upgrades from and to, tests after the change (from the D-003 pack), the SBOM delta, and admission checks (new names, licences, vulnerability snapshot); complete only with passing tests and no refusal |
| D-080 | Signed knowledge packs | todo | | | |
| D-094 | Verifiable egress report | todo | | | Safe variant |
| D-095 | GPO and Intune templates | todo | | | Safe variant |
| D-097 | Constrained Language Mode awareness | todo | | | |
| D-098 | NPU judge profile | todo | | | |
