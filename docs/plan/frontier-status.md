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
| G9 | Voice | todo | | Whisper-compatible server through 127.0.0.1 (ADR 0010), Windows voice typing kept |
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
| C-032 | TypeScript language service worker | Wave 3 | todo | | | |
| C-057 | Mermaid and Markdown artifacts | Wave 3 | todo | | | Mermaid left out in G6 for want of a dependency; now asked for |
| C-015 | Adaptive autonomy that only lowers | Wave 4 | todo | | | |
| C-008 | Pin a newer Claude Code through conformance | Wave 5 | todo | | | |
| C-036 | Local codebase index | Wave 5 | todo | | | |
| C-043 | Cross-model review through the gateway | Wave 5 | todo | | | |
| C-044 | Best-of-N in worktrees, judged by tests | Wave 5 | todo | | | G25 built runs and comparison; not ranked, no memory cap |
| C-055 | Signed shared rule packs | Wave 6 | todo | | | |
| C-067 | Foundry Local profiles | Wave 6 | todo | | | |

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
| D-014 | Consequence preview | todo | | | Safe variant only |
| D-019 | Earned-autonomy proposals | todo | | | |
| D-020 | Explain why and what would change | todo | | | |
| D-022 | In-turn batch approvals | listed for decision | | | LIST: owner decides whether one approval may cover identical calls in one turn; never High |
| D-023 | Scope lease | todo | | | |
| D-024 | Second confirmation for loosening | todo | | | Safe variant |
| D-087 | Interruption budget | todo | | | |
| D-088 | Adaptive explanation depth | todo | | | |
| D-089 | Review load meter | todo | | | |
| D-091 | Narrated diffs and approvals | todo | | | |
| D-092 | Safe keyboard approvals | todo | | | U4 built typed confirmation for Severe |
| D-093 | Cognitive load presets | todo | | | |

## Wave 5: analytics, knowledge, multi-model and health

| Id | Title | Status | Branch | Phase | Note |
|---|---|---|---|---|---|
| D-072 | Failure taxonomy | todo | | | |
| D-069 | Hotspot map | todo | | | |
| D-032 | Agent-aware build provenance | todo | | | |
| D-047 | Capability map | todo | | | |
| D-049 | NFR budgets | todo | | | |
| D-051 | Personal data flow map | todo | | | |
| D-063 | Package provenance verification | todo | | | Safe variant |
| D-065 | Test impact analysis | todo | | | |
| D-068 | Dead code with evidence | todo | | | |
| D-073 | Undo-learning loop | todo | | | |
| D-074 | Behaviour regression for Claude Code upgrades | todo | | | |
| D-076 | Cost per outcome | todo | | | |
| D-100 | Estimates from history | todo | | | |
| D-077 | Context efficiency report | todo | | | |
| D-078 | Claim calibration score | todo | | | |
| D-079 | Codebase tours | todo | | | |
| D-081 | Why is this code like this | todo | | | |
| D-082 | Stale instruction detector | todo | | | |
| D-083 | Ubiquitous language glossary | todo | | | |
| D-084 | Adversarial pair | todo | | | |
| D-086 | Local judge for claims | todo | | | |
| D-090 | Measured time panel | todo | | | |
| D-099 | Evidence-backed stakeholder summary | todo | | | |

## Wave 6: enterprise and large items

| Id | Title | Status | Branch | Phase | Note |
|---|---|---|---|---|---|
| D-012 | Time-boxed fuzz pass | todo | | | Safe variant; native fuzzers listed |
| D-052 | Multi-repo contract check | todo | | | |
| D-067 | Migration planner with evidence | todo | | | |
| D-070 | PowerShell modernisation | todo | | | |
| D-071 | Dependency upgrade with evidence | todo | | | |
| D-080 | Signed knowledge packs | todo | | | |
| D-094 | Verifiable egress report | todo | | | Safe variant |
| D-095 | GPO and Intune templates | todo | | | Safe variant |
| D-097 | Constrained Language Mode awareness | todo | | | |
| D-098 | NPU judge profile | todo | | | |
