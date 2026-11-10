# Frontier build status (D-001 to D-100, with C prerequisites)

The prompt is `docs/plan/frontier-build-prompt.md`; the paper behind it is `docs/research/feature-frontier-2026-11.md`. Read this file first after any compaction, restart or update, and carry on from the first item not done. Updated at the end of every slice and before every release.

Status values: todo, in progress, built, built safe variant, listed for decision, blocked, deferred.

## Conflicts recorded (CLAUDE.md wins; owner decisions are the owner's)

1. **Network connectors.** The prompt lists for IT anything that adds network access or trust in a registry (D-053 existence and age, D-057 snapshot source, D-063 npm provenance). The owner decided on 9 Nov, after IT was ruled out: "I am never going to ask IT ... it should be built to be able to connect to self hosted or online existing versions of these servers". Resolution: such lookups are built as connectors that are off until the owner switches them on and names the server, and that can only tighten (escalate or deny), never allow; with no connector the safe offline variant applies.
2. **Releases with --skip-tests.** Earlier releases in this build ran `npm run release -- --skip-tests` (the gate ran first). From now releases run the full tests, as section 8 says, until C-002 adds the signed override.
3. **Branches.** CLAUDE.md asks for one branch per phase fast-forwarded into main; the prompt asks for one per slice. Both hold: one branch per slice, fast-forwarded into main and pushed.

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

## Prerequisites (C-backlog)

| Id | Title | Before | Status | Branch | Phase | Note |
|---|---|---|---|---|---|---|
| C-001 | Memory-aware test sharding by file | Wave 1 | built | slice/C-001-test-shards | BUILD_REPORT "Frontier C-001" | Three runs under 70% load owed |
| C-002 | Gate refuses --skip-tests | Wave 1 | built | slice/C-002-skip-tests-override | BUILD_REPORT "Frontier C-002" | Signed per-version override, audited |
| C-004 | Memory governor | Wave 1 | built | slice/C-004-memory-governor | BUILD_REPORT "Frontier C-004" | 85% commit by default; new sessions, chats and page looks refused with a card; idle sessions offered for suspension |
| C-013 | Grant lifetimes | Wave 1 | built | slice/C-013-grant-lifetimes | BUILD_REPORT "Frontier C-013" | Expiry (30 days by default), folder scope, use limits; a sidecar file so older versions still read the rules |
| C-010 | Audit-backed session timeline | Wave 2 | todo | | | Walkthrough (G31) and audit by session exist |
| C-011 | Signed timeline export | Wave 2 | todo | | | Audit bundle (G30) exists, not signed |
| C-012 | Policy dry run | Wave 2 | todo | | | policy:replay exists |
| C-016 | Verified data-boundary card per model | Wave 2 | todo | | | "Where your words go" cards exist; no stale refusal |
| C-031 | Tree-sitter outline and navigation (WASM) | Wave 2 | todo | | | |
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
| D-025 | Dead-man timer for Extreme | todo | | | Opt-in, off by default |
| D-030 | Approval lineage on commits | todo | | | |
| D-053 | Dependency admission control | todo | | | Safe variant offline; connectors per conflict 1 |
| D-054 | Lockfile diff guard | todo | | | |
| D-055 | Licence policy | todo | | | Safe variant; legal list owed |
| D-058 | Secret commit block | todo | | | G22 built a commit-scan floor deny; check against the acceptance |
| D-059 | Instruction integrity pinning | todo | | | |
| D-060 | Agent-config tamper floor | todo | | | |
| D-064 | Install-script default deny | todo | | | |
| D-096 | WinGet and installer admission | todo | | | |

## Wave 2: evidence

| Id | Title | Status | Branch | Phase | Note |
|---|---|---|---|---|---|
| D-003 | Change evidence pack | todo | | | |
| D-004 | Diff-scoped mutation gate | todo | | | |
| D-005 | Surviving-mutant tasks | todo | | | |
| D-010 | Randomised check seeds | todo | | | |
| D-011 | Flake quarantine | todo | | | |
| D-016 | Taint-tracked egress guard | todo | | | Provenance labels (B32) exist |
| D-017 | Subagent boundary labels | todo | | | |
| D-026 | Policy regression from real history | todo | | | |
| D-027 | Step-exact reconstruction | todo | | | |
| D-029 | Audit anchoring | todo | | | |
| D-056 | SBOM per change | todo | | | |
| D-057 | Offline vulnerability snapshot | todo | | | Safe variant; connector per conflict 1 |
| D-061 | Untrusted content scanner | todo | | | |
| D-062 | Local SAST on agent diffs | todo | | | |
| D-075 | Loop and thrash detector | todo | | | G19 loop guard stops the turn; needs tell-first |
| D-085 | Data-boundary hand-off check | todo | | | |

## Wave 3: intent and architecture

| Id | Title | Status | Branch | Phase | Note |
|---|---|---|---|---|---|
| D-066 | Characterisation capture | todo | | | |
| D-006 | Behaviour diff | todo | | | |
| D-028 | Causal provenance graph | todo | | | |
| D-031 | Evidence queries | todo | | | |
| D-033 | Requirement ledger | todo | | | |
| D-034 | Unrequested behaviour detector | todo | | | |
| D-035 | Scope creep meter | todo | | | |
| D-036 | Tests-first contract mode | todo | | | |
| D-037 | Assumption register | todo | | | |
| D-038 | ADR capture | todo | | | |
| D-039 | Requirement change impact | todo | | | |
| D-040 | Intent drift alarm | todo | | | Needs a local model |
| D-041 | Architecture rules as policy | todo | | | |
| D-042 | Living C4 diagrams | todo | | | |
| D-043 | Architecture drift alerts | todo | | | |
| D-044 | ADR-aware context | todo | | | |
| D-045 | Fitness functions | todo | | | |
| D-046 | Public API break guard | todo | | | |
| D-048 | Architecture review pack | todo | | | |
| D-050 | Threat model delta | todo | | | |

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
