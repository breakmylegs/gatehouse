# Expansion build status (E-001 to E-100, with C and D prerequisites)

The prompt is `docs/plan/expansion-build-prompt.md` (owner, 14 Nov: "Also add these to the queue"). It comes after the Frontier build (`docs/plan/frontier-status.md`): finish that first, then build these wave by wave. Read this file first after any compaction, restart or update.

Status values: todo, in progress, built, built safe variant, listed for decision, blocked, deferred.

## Conflicts recorded (CLAUDE.md wins)

1. **Browser automation (E-001 to E-010, and E-064 through E-002).** The prompt drives Edge through `--remote-debugging-pipe`. Codehouse forbids browser automation and debugging connections (CLAUDE.md, and `scripts/forbidden.mjs` rejects them in the tree; owner decision after the claude.ai terms review). Listed for the owner: whether a pipe (no port) to a throwaway Edge profile on loopback pages only may be allowed for testing the user's own app. Until then they are not built.
2. **Testing (section 8).** The owner's testing standard (13 Nov, global CLAUDE.md) wins over "run npm run gate before every release" where they differ: the changed tests and their regression tests by name; full runs only for shared foundations.
3. **Two machines (13 Nov).** Shared code takes the platform as a parameter; Windows-only items (C# helpers, Dev Drive, WDA_EXCLUDEFROMCAPTURE, SystemInformation.PowerStatus) say what they do on a Mac or are marked Windows only.

## Prerequisites from the C and D backlogs

| Id | Title | Wave | Status | Branch | BUILD_REPORT | Note |
|---|---|---|---|---|---|---|
| D-003 | Change evidence pack | before E2 | built | | | From the Frontier status |
| D-007 | Locked acceptance tests | before E2 | built | | | From the Frontier status |
| D-009 | Done-claim verifier | before E2 | built | | | From the Frontier status |
| C-031 | Tree-sitter outline (WASM) | before E2 | built | | | From the Frontier status |
| C-057 | Mermaid and Markdown artifacts | before E3 | todo | | | From the Frontier status |
| D-094 | Egress helper (packaging/Egress.cs) | before E3 | todo | | | From the Frontier status |
| C-004 | Memory governor | before E3 | built | | | From the Frontier status |
| C-010 | Audit-backed session timeline | before E4 | built | | | From the Frontier status |
| C-012 | Policy dry run | before E4 | built | | | From the Frontier status |
| D-030 | Lineage git notes under refs/notes/codehouse | before E4 | built | | | From the Frontier status |
| C-016 | Verified data-boundary cards per model | before E5 | built | | | From the Frontier status |
| C-059 | XLSX attachments | before E5 | see frontier-status | | | From the Frontier status |
| D-033 | Requirement ledger | before E5 | built | | | From the Frontier status |
| D-051 | Personal data flow map | before E5 | todo | | | From the Frontier status |
| D-055 | Licence policy | before E5 | built safe variant | | | From the Frontier status |
| C-055 | Signed shared rule packs | before E5 | todo | | | From the Frontier status |
| D-080 | Signed knowledge packs | before E5 | todo | | | From the Frontier status |
| D-100 | Estimates from history | before E5 | todo | | | From the Frontier status |
| C-013 | Grant lifetimes | before E6 | built | | | From the Frontier status |
| C-054 | Signed session bundles | before E6 | see frontier-status | | | From the Frontier status |
| D-079 | Codebase tours | before E6 | todo | | | From the Frontier status |
| D-083 | Ubiquitous language glossary | before E6 | todo | | | From the Frontier status |
| C-022 | Audited editor | before E6 | see frontier-status | | | From the Frontier status |

## Expansion items

| Id | Title | Wave | Status | Branch | BUILD_REPORT | Note |
|---|---|---|---|---|---|---|
| E-100 | Invariant canaries | E1 | todo | | |  |
| E-096 | Safe mode | E1 | todo | | |  |
| E-097 | Crash bundle | E1 | todo | | |  |
| E-099 | Health score | E1 | todo | | |  |
| E-011 | Destructive migration guard | E1 | todo | | |  |
| E-016 | Remote database connection guard | E1 | todo | | |  |
| E-017 | Bulk data export guard | E1 | todo | | |  |
| E-021 | Production context guard for cloud CLIs | E1 | todo | | |  |
| E-023 | Kubernetes manifest guard | E1 | todo | | |  |
| E-028 | WSL command coverage | E1 | todo | | |  |
| E-030 | Toolchain manager guard | E1 | todo | | |  |
| E-093 | Card data guard | E1 | todo | | |  |
| E-086 | Writing rules enforcement | E1 | todo | | |  |
| E-080 | Shared signed redaction lists | E1 | todo | | |  |
| E-051 | Merge conflict pre-check | E1 | todo | | |  |
| E-052 | Structured task results | E1 | todo | | |  |
| E-089 | Battery-aware scheduling | E1 | todo | | |  |
| E-094 | Escalation ladder | E1 | todo | | |  |
| E-095 | Phone pause per project | E1 | todo | | |  |
| E-001 | Visual regression baselines | E2 | listed for decision | | | Needs browser automation through --remote-debugging-pipe, which CLAUDE.md and scripts/forbidden.mjs forbid (conflict 1); owner decision |
| E-007 | Console and network error watcher | E2 | listed for decision | | | Needs browser automation through --remote-debugging-pipe, which CLAUDE.md and scripts/forbidden.mjs forbid (conflict 1); owner decision |
| E-006 | Responsive and theme matrix | E2 | listed for decision | | | Needs browser automation through --remote-debugging-pipe, which CLAUDE.md and scripts/forbidden.mjs forbid (conflict 1); owner decision |
| E-002 | Accessibility audit of the app being built | E2 | listed for decision | | | Needs browser automation through --remote-debugging-pipe, which CLAUDE.md and scripts/forbidden.mjs forbid (conflict 1); owner decision |
| E-064 | European Accessibility Act mapping | E2 | listed for decision | | | Needs browser automation through --remote-debugging-pipe, which CLAUDE.md and scripts/forbidden.mjs forbid (conflict 1); owner decision |
| E-003 | Design conformance check | E2 | listed for decision | | | Needs browser automation through --remote-debugging-pipe, which CLAUDE.md and scripts/forbidden.mjs forbid (conflict 1); owner decision |
| E-004 | Web performance budgets | E2 | listed for decision | | | Needs browser automation through --remote-debugging-pipe, which CLAUDE.md and scripts/forbidden.mjs forbid (conflict 1); owner decision |
| E-009 | Smoke crawl | E2 | listed for decision | | | Needs browser automation through --remote-debugging-pipe, which CLAUDE.md and scripts/forbidden.mjs forbid (conflict 1); owner decision |
| E-008 | Pseudo-localisation and copy checks | E2 | listed for decision | | | Needs browser automation through --remote-debugging-pipe, which CLAUDE.md and scripts/forbidden.mjs forbid (conflict 1); owner decision |
| E-010 | Before and after UI previews on approval cards | E2 | listed for decision | | | Needs browser automation through --remote-debugging-pipe, which CLAUDE.md and scripts/forbidden.mjs forbid (conflict 1); owner decision |
| E-005 | Flow recorder to locked end-to-end test | E2 | listed for decision | | | Needs browser automation through --remote-debugging-pipe, which CLAUDE.md and scripts/forbidden.mjs forbid (conflict 1); owner decision |
| E-025 | Environment manifest and drift | E3 | todo | | |  |
| E-027 | Dev Drive and Defender awareness | E3 | todo | | |  |
| E-029 | Port and process tracking | E3 | todo | | |  |
| E-026 | Container runs for Codehouse actions | E3 | todo | | | Safe variant only; the List for part is listed |
| E-012 | Schema diff view | E3 | todo | | |  |
| E-013 | Migration rehearsal | E3 | todo | | |  |
| E-014 | Query plan review | E3 | todo | | |  |
| E-015 | Synthetic fixtures with PII scan | E3 | todo | | |  |
| E-018 | IaC plan as policy | E3 | todo | | |  |
| E-024 | Blast radius preview | E3 | todo | | |  |
| E-019 | Infrastructure cost delta | E3 | todo | | | Safe variant only; the List for part is listed |
| E-020 | Least-privilege IAM diff | E3 | todo | | |  |
| E-022 | In-process IaC misconfiguration checks | E3 | todo | | |  |
| E-031 | Contract-first conformance probe | E3 | todo | | |  |
| E-032 | Mock definitions from specs | E3 | todo | | | Safe variant only; the List for part is listed |
| E-033 | Spec breaking-change detector | E3 | todo | | |  |
| E-034 | Contract snapshots | E3 | todo | | |  |
| E-035 | API security lint | E3 | todo | | |  |
| E-036 | Generated client drift | E3 | todo | | |  |
| E-037 | Error contract consistency | E3 | todo | | |  |
| E-038 | Local log capture and viewer | E4 | todo | | |  |
| E-039 | Error signature triage | E4 | todo | | |  |
| E-040 | Local trace receiver | E4 | todo | | |  |
| E-041 | Profiling on request | E4 | todo | | |  |
| E-042 | Memory leak detector | E4 | todo | | |  |
| E-045 | Crash summary | E4 | todo | | |  |
| E-043 | Verified reproduction recipes | E4 | todo | | |  |
| E-044 | Bisect assistant | E4 | todo | | |  |
| E-049 | Resource-aware scheduler | E4 | todo | | |  |
| E-050 | Cross-session locks | E4 | todo | | |  |
| E-055 | Agent handover notes | E4 | todo | | |  |
| E-053 | Verified playbooks | E4 | todo | | |  |
| E-048 | Evidence gates between steps | E4 | todo | | |  |
| E-046 | Role-based agent teams | E4 | todo | | |  |
| E-047 | Workflows as code | E4 | todo | | |  |
| E-054 | Night shift planner and morning report | E4 | todo | | |  |
| E-062 | Epic decomposition | E5 | todo | | |  |
| E-056 | Work item linkage | E5 | todo | | | Safe variant only; the List for part is listed |
| E-057 | Definition of done checklist | E5 | todo | | |  |
| E-058 | Release readiness report | E5 | todo | | |  |
| E-059 | Change record and CAB pack | E5 | todo | | |  |
| E-060 | Backout plan verification | E5 | todo | | |  |
| E-061 | Environment promotion gate | E5 | todo | | |  |
| E-063 | Effort and billing log | E5 | todo | | |  |
| E-069 | AI system register | E5 | todo | | |  |
| E-070 | Third-party notices generator | E5 | todo | | |  |
| E-068 | Data residency evidence | E5 | todo | | |  |
| E-067 | DPIA draft | E5 | todo | | |  |
| E-065 | DORA and NIS2 evidence mapping | E5 | todo | | |  |
| E-066 | Retention and legal hold | E5 | todo | | | Safe variant only; the List for part is listed |
| E-081 | Office files with redaction preview | E5 | todo | | |  |
| E-085 | Formula-first spreadsheets | E5 | todo | | |  |
| E-082 | Meeting notes to backlog | E5 | todo | | |  |
| E-083 | Evidence-grounded documents | E5 | todo | | |  |
| E-084 | Sequence diagrams from code paths | E5 | todo | | |  |
| E-087 | Research to decision brief | E5 | todo | | |  |
| E-092 | Signed industry packs | E5 | todo | | | Safe variant only; the List for part is listed |
| E-073 | Skill growth tracker | E6 | todo | | |  |
| E-071 | Teach-back check | E6 | todo | | |  |
| E-072 | Tutor mode | E6 | todo | | |  |
| E-074 | Code reading drills | E6 | todo | | |  |
| E-075 | Onboarding curriculum | E6 | todo | | |  |
| E-076 | Pattern cards | E6 | todo | | |  |
| E-077 | Personal handover packs | E6 | todo | | |  |
| E-078 | Policy exceptions register | E6 | todo | | |  |
| E-079 | Reviewer suggestions | E6 | todo | | |  |
| E-088 | Daily plan | E6 | todo | | |  |
| E-090 | Energy and carbon estimate | E6 | todo | | |  |
| E-091 | Screen-share safe mode | E6 | todo | | |  |
| E-098 | Upgrade rehearsal | E6 | todo | | |  |
