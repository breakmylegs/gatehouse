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
| C-057 | Mermaid and Markdown artifacts | before E3 | built | | | From the Frontier status |
| D-094 | Egress helper (packaging/Egress.cs) | before E3 | built | | | From the Frontier status |
| C-004 | Memory governor | before E3 | built | | | From the Frontier status |
| C-010 | Audit-backed session timeline | before E4 | built | | | From the Frontier status |
| C-012 | Policy dry run | before E4 | built | | | From the Frontier status |
| D-030 | Lineage git notes under refs/notes/codehouse | before E4 | built | | | From the Frontier status |
| C-016 | Verified data-boundary cards per model | before E5 | built | | | From the Frontier status |
| C-059 | XLSX attachments | before E5 | done | feat/e5a | yes | Node zlib reader in a worker with limits; macros never read; chat project .xlsx gets a Markdown copy |
| D-033 | Requirement ledger | before E5 | built | | | From the Frontier status |
| D-051 | Personal data flow map | before E5 | built | | | From the Frontier status |
| D-055 | Licence policy | before E5 | built safe variant | | | From the Frontier status |
| C-055 | Signed shared rule packs | before E5 | built | | | From the Frontier status |
| D-080 | Signed knowledge packs | before E5 | built | | | From the Frontier status |
| D-100 | Estimates from history | before E5 | built | | | From the Frontier status |
| C-013 | Grant lifetimes | before E6 | built | | | From the Frontier status |
| C-054 | Signed session bundles | before E6 | see frontier-status | | | From the Frontier status |
| D-079 | Codebase tours | before E6 | built | | | From the Frontier status |
| D-083 | Ubiquitous language glossary | before E6 | built | | | From the Frontier status |
| C-022 | Audited editor | before E6 | see frontier-status | | | From the Frontier status |

## Expansion items

| Id | Title | Wave | Status | Branch | BUILD_REPORT | Note |
|---|---|---|---|---|---|---|
| E-100 | Invariant canaries | E1 | done | feat/canaries | yes | 8 canaries at start and daily; failure blocks sessions and shows in Doctor; canary_run audited; safe mode waits for E-096 |
| E-096 | Safe mode | E1 | done | feat/canaries | yes | after 3 crash restarts in 10 min, a failed canary, Doctor or GATEHOUSE_SAFE_MODE=1; nothing restored or started; banner; leaving from the desktop; tray item to follow |
| E-097 | Crash bundle | E1 | done | feat/canaries | yes | Doctor, previewed file by file, saved exactly as previewed to Downloads; redacted; no inputs; crash_bundle_exported |
| E-099 | Health score | E1 | done | feat/health | yes | 7 factors with 30 days each and their source; overall is the worst factor; dashboard tile and Doctor |
| E-011 | Destructive migration guard | E1 | done | feat/guards-2 | yes | destructive-migration at 85; golden 29 (15 + 10); statement reader, no parser dependency |
| E-016 | Remote database connection guard | E1 | done | feat/guards | yes | remote-database; golden 24 |
| E-017 | Bulk data export guard | E1 | done | feat/guards | yes | bulk-export; golden 26 |
| E-021 | Production context guard for cloud CLIs | E1 | done | feat/guards | yes | production-context; golden 25 |
| E-023 | Kubernetes manifest guard | E1 | done | feat/guards-2 | yes | kubernetes-manifest at 85; golden 28; latest tags and limits noted only |
| E-028 | WSL command coverage | E1 | done | feat/guards-2 | yes | wsl and bash.exe -c unwrapped for both shells; floor adds .kube and .config/gcloud under \\wsl$; golden 30 |
| E-030 | Toolchain manager guard | E1 | done | feat/guards | yes | toolchain-change; golden 27; pip and Set-ExecutionPolicy left to their own rules |
| E-093 | Card data guard | E1 | done | feat/guards-2 | yes | commit scan refuses a staged card number; card-data on edits at 80; redaction masks card numbers |
| E-086 | Writing rules enforcement | E1 | done | feat/about-title | yes | exports corrected with a listed preview; agent commit messages flagged in the session; Settings, Privacy; project .codehouse/writing-rules.json |
| E-080 | Shared signed redaction lists | E1 | done | feat/health | yes | Ed25519-signed JSON lists, add-only, with source and date; trusted keys in Settings; redaction_list_imported |
| E-051 | Merge conflict pre-check | E1 | done | feat/about-title | yes | git merge-tree every 5 min while worktree sessions run; told in each session once; shown on Worktrees; committed work only |
| E-052 | Structured task results | E1 | done | feat/health | yes | start_session resultSchema; wait_for_session checks it (zod fromJSONSchema), sends back once, then fails; result says the side session's taint |
| E-089 | Battery-aware scheduling | E1 | done | feat/battery | yes | power.ts reads Win32_Battery or pmset every 2 min; on battery routines and timeline summaries wait (one of each), new sessions start low; Settings "Pause Extreme approval sessions on battery" (off) pauses them, mains starts them again; power_state_changed audited. Deviation: the Host reads the power state itself, no shell change |
| E-094 | Escalation ladder | E1 | done | feat/escalation-ladder | yes | broker, settings-ladder tests |
| E-095 | Phone pause per project | E1 | done | feat/escalation-ladder | yes | relay-e2e, limit-pause tests; T130 |
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
| E-025 | Environment manifest and drift | E3 | built | feat/e3 | yes | versions of node, npm, pnpm, dotnet, python, pwsh, git, java against .nvmrc, global.json, rust-toolchain and engines; .codehouse/environment.json with variable names only; drift listed |
| E-027 | Dev Drive and Defender awareness | E3 | built | feat/e3 | yes | Doctor: each project's volume (Dev Drive, ReFS, NTFS) and Defender's performance mode or not known; no elevation |
| E-029 | Port and process tracking | E3 | built | feat/e3 | yes | Ports and processes panel: the session's processes with ports and age; stop only after confirming; a server starting on a busy port asks first (port-clash) |
| E-026 | Container runs for Codehouse actions | E3 | done | feat/e3 | yes | Podman container, no network, project read-only; off by default |
| E-012 | Schema diff view | E3 | done | feat/e3 | yes | ER diff from Prisma, EF snapshot, migrations or DDL; HEAD against working folder |
| E-013 | Migration rehearsal | E3 | done | feat/e3b | yes | SQLite in the Host, Postgres in an E-026 container; irreversible steps reported; database deleted |
| E-014 | Query plan review | E3 | done | feat/e3b | yes | tree-sitter finds added queries; EXPLAIN QUERY PLAN in a throwaway SQLite database; scans get an index |
| E-015 | Synthetic fixtures with PII scan | E3 | done | feat/e3b | yes | own seeded generator checked by SQLite; scan for real emails, UK phones, NI numbers and Luhn cards |
| E-018 | IaC plan as policy | E3 | done | feat/e3c | yes | four plan shapes; stateful delete or replace Severe, new exposure High, unseen plan held; 23 golden; T161 |
| E-024 | Blast radius preview | E3 | done | feat/e3c | yes | dependents of a deleted or replaced resource from Terraform and Pulumi graphs, on the approval card |
| E-019 | Infrastructure cost delta | E3 | done | feat/e3d | yes | signed price sheet (managed key); apply card shows the monthly change as an interval, unknown SKUs not known |
| E-020 | Least-privilege IAM diff | E3 | done | feat/e3e | yes | broad-iam High: * actions or resources, Owner/Contributor at subscription, admin roles; edits and plans; 13 golden |
| E-022 | In-process IaC misconfiguration checks | E3 | done | feat/e3e | yes | public storage, open groups, encryption, TLS, diagnostics over HCL, Bicep, ARM, CFN; own block reader (no grammars bundled); 11 seeded |
| E-031 | Contract-first conformance probe | E3 | done | feat/e3f | yes | conformance probe: loopback only, each request judged, ajv; mismatches in evidence and contradict claims |
| E-032 | Mock definitions from specs | E3 | done | feat/e3f | yes | MSW handlers (compile), WireMock mappings, loopback Prism command, to copy |
| E-033 | Spec breaking-change detector | E3 | done | feat/e3f | yes | spec breaking changes without a major bump escalate (spec-breaking-change, 70) |
| E-034 | Contract snapshots | E3 | done | feat/e3f | yes | answer shapes kept per project (no values), changes reported next probe |
| E-035 | API security lint | E3 | done | feat/e3f | yes | API security lint: no security, 401/403, object ids, unbounded arrays, rate limit, sensitive query |
| E-036 | Generated client drift | E3 | done | feat/e3f | yes | generated clients made again in a scratch folder as a Codehouse action, drift reported |
| E-037 | Error contract consistency | E3 | done | feat/e3f | yes | error answers against RFC 9457 or the project's convention, in specs and probes |
| E-038 | Local log capture and viewer | E4 | done | feat/e4a | yes | log store per project from actions and listed files, parsed and redacted; reads judged by the rules; search, level, time, retention |
| E-039 | Error signature triage | E4 | done | feat/e4a | yes | errors grouped by signature, frames source-mapped inside the project, a fix task each |
| E-040 | Local trace receiver | E4 | done | feat/e4a | yes | OTLP JSON receiver on 127.0.0.1, per-project token, no Origin, Host checked, 4 MB cap; span trees; T162 |
| E-041 | Profiling on request | E4 | done | feat/e4a | yes | --cpu-prof as a Codehouse action, never an inspector; top functions and flame graph; dotnet-trace when present |
| E-042 | Memory leak detector | E4 | done | feat/e4a | yes | heap snapshots by a preload; constructors that keep growing reported |
| E-045 | Crash summary | E4 | done | feat/e4b | yes | Node reports, .NET unhandled exceptions and Windows crash codes, frames source-mapped; a run with report flags; dotnet-dump when present |
| E-043 | Verified reproduction recipes | E4 | done | feat/e4b | yes | reproduction accepted only if it fails before the fix, same test must pass after, then locked (D-007) |
| E-044 | Bisect assistant | E4 | done | feat/e4b | yes | git bisect in a scratch worktree as Codehouse actions; first bad commit with its session note; links removed first |
| E-049 | Resource-aware scheduler | E4 | done | feat/e4b | yes | heavy jobs wait for memory and CPU (only with the governor on), reasons shown; approvals, kill switch and Stop never delayed |
| E-050 | Cross-session locks | E4 | done | feat/e4b | yes | files and ports held per session; another session's edit or server escalates (cross-session-lock), released on end |
| E-055 | Agent handover notes | E4 | done | feat/e4b | yes | write_handover Companion tool (sdk only); named files checked against the change; next session in the folder receives it once |
| E-053 | Verified playbooks | E4 | done | feat/e4b | yes | playbooks in .codehouse/playbooks; checklist verified against the change (changed, exists, contains, run); unmet listed |
| E-048 | Evidence gates between steps | E4 | done | feat/e4b | yes | tests, sealed, mutation, a11y (project's axe report) and dod gates; unreadable fails closed; runGatedSteps stops with the reason |
| E-046 | Role-based agent teams | E4 | done | feat/e4b | yes | roles.yml roles as sessions in their own worktrees; overlay only restricts (role-scope holds, role-tool denies); widening roles refused |
| E-047 | Workflows as code | E4 | done | feat/e4b | yes | workflows of roles, outputs, gates and approval points; validated and dry-run first; saved per step, resumed after a restart |
| E-054 | Night shift planner and morning report | E4 | done | feat/e4b | yes | night tasks in dependency order through the scheduler, each capped; night budget stops it; morning report of status, evidence, cost, decisions |
| E-062 | Epic decomposition | E5 | done | feat/e5a | yes | stories from a brief as a checked result, written to docs/requirements with stable ids, dependencies by id, D-100 estimates |
| E-056 | Work item linkage | E5 | done | feat/e5a | yes | AB# and Jira ids from branch, commits, notes and ledger linked to session, commits, evidence and stories; local; CSV/JSON export |
| E-057 | Definition of done checklist | E5 | done | feat/e5a | yes | .codehouse/dod.yml checked automatically where possible, ticked by hand otherwise; every claim of done shows its status |
| E-058 | Release readiness report | E5 | done | feat/e5a | yes | escalations, sealed checks, evidence packs, vulnerabilities, licences, accessibility and DoD; a Severe escalation blocks with its reason |
| E-059 | Change record and CAB pack | E5 | done | feat/e5a | yes | fields from evidence or Needs your input; CAB pack |
| E-060 | Backout plan verification | E5 | done | feat/e5a | yes | scratch-worktree revert, tests and down migrations; conflict not reversible |
| E-061 | Environment promotion gate | E5 | done | feat/e5a | yes | promotion-gate 90 for production; production-promotion 80 even when passing; hook asks in Auto; T163 |
| E-063 | Effort and billing log | E5 | done | feat/e5a | yes | local effort.json; CSV with totals; deletable; no network |
| E-069 | AI system register | E5 | done | feat/e5a | yes | per project, model, purpose; classification; card or no card; first and last use |
| E-070 | Third-party notices generator | E5 | done | feat/e5a | yes | npm lockfile packages, licences and notice texts; missing listed; written by you |
| E-068 | Data residency evidence | E5 | done | feat/e5a | yes | endpoint and card region per session, or not known; local none; D-094 addresses; statement per project and period |
| E-067 | DPIA draft | E5 | done | feat/e5a | yes | every mapped flow in processing and risks; DRAFT FOR LEGAL REVIEW; needs-input sections |
| E-065 | DORA and NIS2 evidence mapping | E5 | done | feat/e5a | yes | 20 DORA and NIS2 areas; audit records, packs, policy, controls, register, residency; gaps named |
| E-066 | Retention and legal hold | E5 | done | feat/e5a | yes | safe variant: retention by classification for evidence and logs; legal hold; junction-safe; audit never deleted; audit retention listed |
| E-081 | Office files with redaction preview | E5 | done | feat/e5a | yes | docx, pptx, xlsx from the previewed text; AI mark first and in properties; no library (deviation); opened in Office |
| E-085 | Formula-first spreadsheets | E5 | done | feat/e5a | yes | totals as SUM/AVERAGE/MIN/MAX/COUNT formulas; built-in evaluator; not verified and mismatch marked; checked in Excel |
| E-082 | Meeting notes to backlog | E5 | done | feat/e5a | yes | decisions, actions, stories with criteria, each to its line; stories into the ledger as drafts; no overwrite |
| E-083 | Evidence-grounded documents | E5 | done | feat/e5a | yes | each sentence needs a link, file, citation or evidence pack; ungrounded listed and highlighted in the export preview |
| E-084 | Sequence diagrams from code paths | E5 | done | feat/e5a | yes | Tree-sitter call walk to a depth; Mermaid artifact; unresolved calls drawn and listed |
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
