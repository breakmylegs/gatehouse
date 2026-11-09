# Codehouse frontier build: D-001 to D-100

You are building Codehouse, a Windows desktop workbench for AI chat and AI coding, in this repository. Your job is to build the 100 frontier features D-001 to D-100 in six waves, plus any prerequisite items from the earlier C-backlog that are not built yet, without weakening any safety rule.

Write in plain UK English with British spelling. Never use em dashes or en dashes anywhere: code comments, docs, UI text, commit messages and reports. Use hyphens, commas or full stops instead.

## 1. Read first

1. CLAUDE.md, which holds the invariants, owner decisions and conventions. It is authoritative. Where this prompt and CLAUDE.md disagree, CLAUDE.md wins, and you record the conflict in the status file.
2. BUILD_REPORT.md, which says what is built, how phase entries are written and what is still owed.
3. docs/sdk-notes.md, docs/threat-model.md, docs/policy-guide.md and DESIGN.md.
4. If present, docs/research/gap-analysis-2026-11.md (the C-backlog) and docs/research/feature-frontier-2026-11.md (the paper behind this prompt).
5. If this prompt is saved as docs/plan/frontier-build-prompt.md, re-read it after any compaction, restart or update.

## 2. Keep a status file that survives compaction and restarts

- Before writing any code, create docs/plan/frontier-status.md.
- List every prerequisite C-item from section 11 and every D-item from sections 12 to 17. For each give the id, title, wave, status, branch, BUILD_REPORT phase and a one-line note.
- Status values are: todo, in progress, built, built safe variant, listed for decision, blocked, deferred.
- Update the file at the end of every slice and before every release.
- After a compaction, restart or update, read the status file first and carry on from the first unfinished item.
- This session may be running inside Codehouse itself. A release updates Codehouse and restarts this session, which comes back on the same conversation. Commit everything and update the status file before you release.

## 3. Safety rules you must keep

This is a summary. CLAUDE.md is authoritative.

- **Fail closed.** Any error, timeout, malformed input or missing data denies or asks a person. Never allow.
- **The floor of hard denies is never overridden.** That includes Extreme approval, rules, plugins and the phone.
- **Modes.** Manual, Plan, Accept edits and Auto are allowed, plus per-session Extreme approval. Never use bypassPermissions or dontAsk.
- **Every tool call reaches Codehouse's policy engine.** The floor hook never answers allow, and canUseTool is never shadowed.
- **No inline SDK settings** beyond the narrow allowances already recorded.
- **Credentials.** Codehouse never reads, stores, logs or sends a credential or token. Hosted models are reached only through the organisation's gateway on 127.0.0.1.
- **Listeners.** All listeners are on 127.0.0.1, with token, Host and Origin checks.
- **Phone.** The phone relay sees only ciphertext. The phone cannot edit inputs or change policy. Push channels use single-use codes.
- **Redaction.** The user's term list and secret patterns are applied before anything is stored or sent.
- **Audit.** Every decision and significant action has a hash-chained audit record, written before the action. If the record cannot be written, the action is refused.
- **Organisation guard** is applied per account.
- **MCP.** Only in-process MCP servers. A new Companion tool must be in-process and allowed by a policy rule with source sdk only.
- **Branding.** No vendor branding or imitation. Fixed update ids never change.
- **Native code.** No native Node addons. Native Windows capability comes from small C# helpers compiled with the Windows csc, as Codehouse-Limits.exe does.
- **Platform and builds.** Windows first. Local signed builds. No cloud CI.

## 4. What you may decide, and what you must list

**You may build and decide yourself.** Record each one as an owner-delegated decision in CLAUDE.md and list it in the final report for confirmation.
- Changes that only make Codehouse stricter: new escalations, new floor denies, new exclusions from Extreme auto-approval, and new pauses that are opt-in or off by default.
- Implementation choices made inside the rules.

**You must not build these.** List each one with the decision needed, who decides and the invariant affected.
- Anything that loosens a rule: fewer prompts, one approval covering more calls, broader allows, new trust in a channel, vendor, registry or device, new network access, a new credential path, an out-of-process server, or native code in Codehouse.
- Items tagged LIST.
- The "List for" part of items tagged BUILD-SAFE. Build only the safe variant.

## 5. Definition of done for every slice

- **Branch.** One slice per branch, named slice/D-NNN-short-name or slice/C-NNN-short-name. Fast-forward it into main when green.
- **Tests and break checks.**
  - Write tests for every acceptance criterion.
  - Add break checks: deliberate mutations of the new code that must make named tests fail.
  - Run each break check against the single test that guards it, with a control run of the unbroken code, as BUILD_REPORT describes.
- **Policy changes.** Add golden cases in packages/policy/test/golden. Policy line coverage stays at or above the 95% gate.
- **Safety.** Anything touching safety gets a threat model entry in docs/threat-model.md, continuing the numbering, with named tests that threat-model.test.ts checks.
- **Audit records.**
  - Use snake_case names, for example test_integrity_escalated.
  - Records never hold secrets or prompt text.
  - Write the record before the action, and refuse the action if the record fails.
- **Settings.** Add settings tolerantly.
  - An absent value means the safe default.
  - Unknown keys are kept, and an older version still reads the file.
  - A test loads a settings file from before the change.
- **UI.**
  - Follow DESIGN.md, the Codehouse tokens and the existing components.
  - Every new surface must be keyboard reachable, have screen reader labels and use the announcer for new events.
  - Respect high contrast and reduced motion, and extend the axe-core scan to every new surface.
  - Show "not known" rather than inventing a number.
- **Phone and push.** Anything shown on the phone or sent to push channels is redacted and sealed as today. The phone gains no new powers except those stated here.
- **Heavy work** (test reruns, mutation, fuzzing, benchmarks, index builds):
  - Run it off the Host's main thread, in a separate analysis worker process launched through Codehouse-Limits.exe.
  - Run one heavy job at a time, honouring the memory governor and the kill switch.
- **Docs.**
  - A user guide article for every user-facing feature.
  - docs/policy-guide.md for every rule.
  - docs/sdk-notes.md for anything learnt about the SDK.
- **BUILD_REPORT.** A phase entry in the existing style: what it does, how, safety, tests, break checks and what is still owed.

## 6. Actions Codehouse runs itself

Some features make Codehouse run commands itself, such as test reruns, sealed checks, mutation runs, fuzzing, benchmarks and git reads. Each such action:
- is judged by the policy engine exactly as the command it runs would be. A deny stays a deny, an escalation asks a person, and Extreme rules apply as they do for the session,
- runs with no credential in its environment,
- runs inside the session's job object or the analysis worker's, at the session's resource level,
- stops on the kill switch,
- is recorded in the audit with its outcome.

## 7. Dependencies and project tools

- **Codehouse dependencies.**
  - Add one only with a stated reason and an exact version, recorded in BUILD_REPORT.
  - Licence must be checked. No AGPL, GPL, SSPL, BUSL, LGPL or unknown licences.
  - npm audit must show no new findings.
  - Prefer what is already installed and Node built-ins such as node:sqlite and node:crypto.
- **Project tools.**
  - This covers StrykerJS, Stryker.NET, fast-check, Hypothesis, BenchmarkDotNet, tinybench, ApiCompat, PSScriptAnalyzer and CycloneDX tools.
  - Detect them in the user's project. Never install them silently.
  - Offering to add one is an ordinary dependency change that goes through the policy engine and D-053.
- **Native code.** Before using any tool, check whether it loads native code.
  - A tool that would need native code inside Codehouse is not used.
  - A project tool that ships native binaries is listed for IT and the owner.
- **Missing runtimes.** If the organisation's gateway or a local model runtime is not installed:
  - Build and test against stand-ins on 127.0.0.1, as earlier phases did.
  - Record that a real run is still owed.
  - Features that need another model must say they are unavailable rather than fail.

## 8. Memory and tests

- The laptop has about 16 GB of memory and suffers memory pressure.
- Run heavy test files one at a time, for example `npx vitest run path/to/file.test.ts`, with other sessions closed or at a low resource level.
- Never skip a flaky test. Record flaky files and memory incidents in BUILD_REPORT.
- Run `npm run gate` before every release.
- Release at the end of each wave with `npm run release`. Never use --skip-tests unless the owner has agreed in writing for that release.

## 9. Stop and escalate to the owner

Stop and escalate when:
- a slice would weaken any rule in section 3,
- a test cannot pass without weakening a check or removing a break check,
- two gate runs on the same commit disagree after a one-file-at-a-time retry,
- the SDK does not support what a slice needs. Record what you found in docs/sdk-notes.md, build what you safely can, and mark the rest blocked.

If a dependency is missing and it is a C-item in section 11, build it first. Otherwise mark the D-item blocked and move on.

## 10. Corrections to the research paper

These override the paper.

- **"C frame goal".** Where the paper says this, it means the built goal mode and the session's plan or task list, not the C-backlog frame-rate item.
- **D-018 and D-025** (risk budget and dead-man timer) are opt-in and off by default, because the owner deliberately runs unattended Extreme builds.
- **D-001 in Extreme** follows a per-project setting.
  - The default approves and flags. The transcript, recap, dashboard and evidence pack all say tests were weakened, and done-claims become Unverified.
  - The strict option waits for a person.
  - Locked tests (D-007) always wait for a person.
- **D-030** uses git notes under refs/notes/codehouse, so it needs no hooks and never rewrites the agent's commands.
- **D-059 and D-007** update their pins automatically when the change was approved through Codehouse. Only changes made outside Codehouse (pulls, other editors, other tools) block the next session start until reviewed. This keeps building Codehouse inside Codehouse working.
- **D-061** replaces tool output only if the SDK supports that for the tool in question. Check this and record the result first. Otherwise it flags the content and raises taint.
- **D-064** never rewrites input silently. "Run without scripts" is an edited input and is re-checked.
- **D-075** first tells the agent what it repeated, and pauses only if it repeats again.
- **D-094** is an egress report against an allow-list, because Claude sessions must reach the Anthropic API. A local-model session has an empty allow-list, which makes its report a true no-egress proof.
- **D-012** uses pure JavaScript property fuzzing (fast-check) first. jazzer.js and SharpFuzz carry native code, so they are listed for IT and the owner.
- **D-027** marks steps that cannot be rebuilt exactly because the audit holds redacted input, and falls back to the nearest checkpoint for those steps.
- **Mutation score and coverage** are evidence, not proof. Label them that way in the UI and in evidence packs.

## 11. Prerequisites from the C-backlog

Build each item just before the wave that needs it, and only if BUILD_REPORT shows it is not already built.

**Before Wave 1**
- **C-001 Memory-aware test sharding by file.**
  - Accept: concurrency is capped by free memory. Each file gets one logged retry.
  - Accept: three full runs go green under 70% synthetic memory load. An injected failing test fails the run.
- **C-002 Gate refuses --skip-tests.**
  - Accept: `npm run release --skip-tests` exits non-zero unless a signed owner override file exists. Use of the override is audited. Add a break check.
- **C-004 Memory governor.**
  - Accept: above a configurable commit threshold (default 85%), new sessions and Codehouse-run heavy jobs are refused with an explanatory card. Idle sessions are offered for suspension.
  - Accept: a simulated-pressure test asserts the refusal and an audit record.
- **C-013 Grant lifetimes.**
  - Accept: remember rules carry an expiry, a use count and a worktree scope.
  - Accept: expired grants escalate. Each property has a test.

**Before Wave 2**
- **C-010 Audit-backed session timeline.**
  - Accept: every call appears in audit order with its decision, rule, risk, approver, and links to the diff and checkpoint. The timeline opens replay.
  - Accept: a 1,000-entry test passes. A break check covers ordering.
- **C-011 Signed timeline export.**
  - Accept: the export holds the redacted timeline, the chain head and both verifier results.
  - Accept: a tampered export fails both verifiers.
- **C-012 Policy dry run.**
  - Accept: predicted allow, escalate and deny counts are produced from a Plan-mode plan, labelled as estimates.
  - Accept: a test proves nothing executes.
- **C-016 Verified data-boundary card per model.**
  - Accept: each card is dated and records source, retention, training use, zero data retention status and region.
  - Accept: a send is refused when the card is stale.
- **C-031 Tree-sitter outline and navigation (WASM).**
  - Accept: outline and go-to-symbol work for TS, JS, Python, C#, PowerShell and JSON, in under 50 ms on 5,000 lines.

**Before Wave 3**
- **C-032 TypeScript language service worker.**
  - Accept: diagnostics, hover, definition and references work. A memory cap restarts the worker.
  - Accept: typescript is pinned with a stated reason.
- **C-057 Mermaid and Markdown artifacts.**
  - Accept: rendering works offline. Hostile Mermaid tests pass under the sandbox CSP.

**Before Wave 4**
- **C-015 Adaptive autonomy that only lowers.**
  - Accept: the recommendation comes from 30 days of audit. It may lower the level automatically.
  - Accept: it never raises the level without an owner click, proved by a test.

**Before Wave 5**
- **C-008 Pin a newer Claude Code through conformance.**
  - Accept: the signed range gate is updated and every conformance category passes.
  - Accept: sdk-notes is updated.
- **C-036 Local codebase index.**
  - Accept: symbols and text are indexed incrementally under the data folder, with floor paths excluded.
  - Accept: 50,000 files are indexed in under 3 minutes. FTS5 is verified, or an inverted-index fallback is used.
- **C-043 Cross-model review through the gateway.**
  - Accept: the reviewer receives a redacted diff and its findings appear in a Review pane.
  - Accept: a test proves the reviewer has no tools.
- **C-044 Best-of-N in worktrees, judged by tests.**
  - Accept: 2 to 4 sessions run in separate worktrees, ranked by check result and then by diff size.
  - Accept: N is capped by the memory governor.

**Before Wave 6**
- **C-055 Signed shared rule packs.**
  - Accept: a trusted signature is required. A pack may add deny and escalate rules.
  - Accept: a pack may add allows only where no IT overlay forbids them.
- **C-067 Foundry Local profiles.**
  - Accept: the loopback endpoint is detected and the licence is shown before first use.
  - Accept: the IT allow-list is respected.

## 12. Wave 1: truth and guards

Build in this order.

**D-001 Test integrity guard** [BUILD, S]
- Deps: none.
- Build:
  - Add a policy rule pack, test-integrity, in packages/policy. It is evaluated on Write, Edit, MultiEdit and shell edits to test files and test config.
  - It escalates, with a one-line reason naming the weakening, for:
    - removed assertions (expect, assert, Should, Assert.\*)
    - added skip or only markers (.skip, .only, xit, xdescribe, [Ignore], [Skip], Pester -Skip)
    - changed expected literals and deleted test files
    - lowered coverage thresholds
    - failure-hiding flags: `|| true`, `--passWithNoTests`, `continue-on-error`, `--no-verify`
  - Detect test files by language path conventions plus project config.
  - Add a per-project setting for Extreme, following section 10. The default is approve-and-flag, and strict waits for a person.
- Accept:
  - 40 new golden cases (20 weakening, 20 legitimate) decide as written, across TS/JS, Python, C# and PowerShell Pester.
  - Break check: removing the assertion-count comparison fails at least 5 named cases.
  - Audit test_integrity_escalated records the pattern id.
  - In the strict setting, an Extreme session waits for a person.
  - Add a threat model entry.

**D-002 Sealed held-out checks** [BUILD, M]
- Deps: the job-object helper, DPAPI (scripts/dpapi.ps1), C-004.
- Build:
  - The owner adds held-out tests for a project from the desktop only.
  - They are sealed with DPAPI under %LOCALAPPDATA%\Gatehouse\sealed\<project>\.
  - Add floor denies on that folder and on the run folder, for every agent tool in every mode.
  - When the agent reports done, or on demand, Codehouse unseals the tests into a run folder outside every worktree. It runs the project's test command against them under a job object.
  - Only counts (passed, failed, total) reach the session. Test names and output never reach the model, the transcript, the phone or push channels. The owner sees the detail on the desktop only.
  - The run folder is removed after each run, using junction-safe deletion.
- Accept:
  - Read, Glob, Grep and shell access to both folders are denied at the floor in Manual, Plan, Accept edits, Auto and Extreme. Golden cases cover this.
  - The test sealed_no_leak fails if any held-out test name appears anywhere outside the desktop detail view.
  - Audit sealed_check_run records the counts.
  - Add a threat model entry.

**D-007 Locked acceptance tests** [BUILD, S]
- Deps: none.
- Build:
  - The owner locks test files or individual cases from Changes or Files, on the desktop only.
  - Their hashes are kept in a per-project lock file under the data folder, not in the repo.
  - Any agent edit, rename or delete of a locked test escalates as locked-test. Extreme never approves it.
  - Approved changes made through Codehouse update the pin, as section 10 says.
  - Unlocking is a desktop action and is audited.
- Accept:
  - A test, extreme_locked_tests, proves an Extreme session cannot change a locked test without a person.
  - If the lock file is edited outside Codehouse, the hash mismatch is detected and every test is treated as locked (fail closed).
  - Audit test_locked, test_unlocked and locked_test_escalated.

**D-008 Pinned counterexamples** [BUILD, S]
- Deps: D-007.
- Build:
  - A shrunk counterexample from fast-check, Hypothesis, FsCheck or a fuzz run becomes a proposed named regression test.
  - Accepting it writes the test through the audited edit path and locks it.
- Accept:
  - In a fixture, a failing fast-check property produces a regression test that fails before the fix and passes after it.
  - The new test is locked. Audit counterexample_pinned.

**D-009 Done-claim verifier** [BUILD, S]
- Deps: the resource levels.
- Build:
  - Detect completion claims in replies, such as "tests pass", "build succeeds", "fixed" and "all green".
  - Find the command each claim refers to, from the turn's tool calls or the project's test command.
  - Rerun that command independently as a Codehouse-run action (section 6).
  - Stamp the claim Verified, Contradicted or Unverified in the transcript, the recap and the dashboard. From Wave 2, also stamp it in the evidence pack.
- Accept:
  - A fixture claiming "tests pass" after a failing run shows Contradicted.
  - A claim with no runnable command shows Unverified.
  - The rerun obeys the resource level and the kill switch.
  - Audit claim_verified records the outcome.

**D-013 Effect-complete approval cards** [BUILD, M]
- Deps: the Bash parser and the PowerShell AST worker.
- Build:
  - Before deciding a shell call, expand its transitive effects:
    - package.json scripts, including pre and post scripts and npm lifecycle scripts
    - Makefile targets
    - git hooks, in .git/hooks and core.hooksPath
    - the PowerShell profile, for pwsh calls
    - .cmd and .bat wrappers
    - local npx and dotnet tool resolution
  - Evaluate policy on the original command and on every expanded line. The strictest result wins.
  - Show the expanded lines on the desktop card, the inline card and the sealed phone card.
  - Effects that cannot be resolved show as "unknown effects" and escalate.
- Accept:
  - `npm test` whose script runs curl escalates, and the expanded line is shown on desktop and phone.
  - A git commit whose pre-commit hook runs a denied command is denied.
  - Add 30 golden cases and a break check, effects_expand.
  - Add a threat model entry for approval laundering.

**D-015 Allow-rule provenance lock** [BUILD, S]
- Deps: C-013 and the built provenance labels.
- Build:
  - Refuse Remember and rule suggestions when the session's recent untrusted content (web, MCP, files marked untrusted) mentions the rule's command, host or path.
  - A broad wildcard rule needs the owner to type its scope to confirm it.
- Accept:
  - A fixture in which a README asks the agent to request a broad allow cannot create a rule, and the card says why.
  - Add a break check, remember_provenance. Audit remember_refused_provenance.

**D-018 Risk budget per session** [BUILD, S]
- Deps: none.
- Build:
  - Opt-in, off by default.
  - When set, a Moderate allow spends 1 point and a High allow spends 3.
  - At zero, a Manual-family session drops to Manual. An Extreme session pauses, like the plan-limit pause.
  - The phone and push channels are told.
- Accept:
  - With a budget of 3, after exhaustion the next Moderate call escalates, or the Extreme session pauses.
  - Audit risk_budget_exhausted. The setting is tolerant.

**D-021 Rubber-stamp detector** [BUILD, S]
- Deps: none.
- Build:
  - Trigger on three High or Severe approvals in a row, each made within 800 ms. Also trigger on ten approvals in a row where the card was never opened.
  - When triggered, the next High approval on the desktop shows the diff or the expanded effects. It needs a second deliberate click after 2 s, and offers a scoped grant (C-013) instead.
  - Denies are never slowed.
- Accept:
  - A test proves the friction triggers, and that denies are unaffected.
  - Audit approval_friction_shown.

**D-025 Dead-man timer for Extreme** [BUILD, S]
- Deps: none.
- Build:
  - Opt-in per session, off by default.
  - When on, Extreme needs a heartbeat every N minutes. Any desktop or phone interaction counts, as does a "still here" tap on the phone.
  - Without a heartbeat, the session pauses with a reason.
- Accept:
  - With N = 1, the session pauses within 70 s, and a phone heartbeat resets the timer.
  - Audit extreme_heartbeat_missed.

**D-030 Approval lineage on commits** [BUILD, S]
- Deps: D-003, only for the evidence-pack hash, added in Wave 2.
- Build:
  - After a commit in a session, attach a git note under refs/notes/codehouse with the session id and the audit chain head.
  - From Wave 2, the note also carries the evidence-pack hash.
  - Never push notes. Commits made by Codehouse's own git panel may also carry trailers.
- Accept:
  - The note of a session commit resolves to an audit record and verifies against the chain.
  - Audit commit_lineage_noted.

**D-053 Dependency admission control** [BUILD-SAFE, M]
- Deps: D-013.
- Build safe variant, with no network:
  - Escalate any agent change that adds a dependency whose exact name is not already in the lockfile or an approved list. This covers manifests, lockfiles and add or install commands.
  - The card shows the edit distance to a bundled list of popular names per ecosystem.
  - Flag names on a bundled list of known shared hallucinations from the research, with its source and date.
  - Deny a name that is on the known-hallucination list and absent from the lockfile.
- List for IT: existence, age and publisher checks through the gateway or a signed offline registry snapshot.
- Accept:
  - A known hallucinated name is denied.
  - A name one edit away from a popular package escalates, and the card shows the similar name.
  - An existing lockfile dependency passes.
  - Add golden cases and a threat model entry.

**D-054 Lockfile diff guard** [BUILD, S]
- Deps: none.
- Build: on a lockfile change, escalate any of these:
  - new install scripts
  - new git or URL sources
  - transitive changes not explained by a manifest change
- Accept:
  - Adding a package with a postinstall script escalates, and the script is shown.
  - A lockfile change with no manifest change escalates.

**D-055 Licence policy** [BUILD-SAFE, S]
- Deps: none.
- Build:
  - Read the SPDX licences of added dependencies from local manifests or the package cache.
  - Escalate anything outside a permissive default list: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD and Unlicense.
  - The list is editable on the desktop and through managed policy.
- List for LEGAL: the organisation's allow-list.
- Accept:
  - A GPL-3.0 dependency escalates, and so does an unknown licence.
  - Audit licence_escalated.

**D-058 Secret commit block** [BUILD, S]
- Deps: none.
- Build:
  - Floor extension.
  - Before any git commit or push, Codehouse reads the staged diff with `git diff --cached` (read-only, run by Codehouse).
  - It denies the commit if a high-confidence secret pattern matches.
  - Records hold the rule id, file and line only, never the value.
- Accept:
  - A commit that stages a test AWS key is denied in every mode.
  - The audit, host.log and transcript hold no part of the value, proved by a test.
  - Add golden cases.

**D-059 Instruction integrity pinning** [BUILD, S]
- Deps: none.
- Build:
  - Hash CLAUDE.md, AGENTS.md, .claude settings, skills, commands and agent files in each project.
  - Agent edits to them escalate with a diff.
  - Changes approved through Codehouse update the pin.
  - A change made outside Codehouse blocks the next session start or turn until the owner reviews and approves the diff on the desktop. This is checked at session start and after any pull, merge, checkout or rebase.
  - An unreadable pin file means review is required.
- Accept:
  - A pulled change to CLAUDE.md blocks the next session start until it is approved.
  - An agent edit to a skill escalates.
  - Audit instructions_changed and instructions_approved.

**D-060 Agent-config tamper floor** [BUILD, S]
- Deps: none.
- Build:
  - Floor extension.
  - Deny agent writes that change any AI tool's approval or permission settings. This covers:
    - permissions and hooks in .claude/settings\*.json
    - keys containing autoApprove or chat.tools in .vscode/settings.json
    - Cursor and Codex configuration files
    - Codehouse's own data folder and managed folder
  - The owner edits these by hand.
- Accept:
  - An agent write of chat.tools.autoApprove is denied in every mode, including Extreme.
  - Adding an allow rule to .claude/settings.local.json is denied.
  - Add golden cases and a threat model entry.

**D-064 Install-script default deny** [BUILD, S]
- Deps: D-013.
- Build:
  - An agent install whose packages declare install scripts escalates, and the card shows the scripts.
  - The card offers "Run without scripts". This is an edited input that adds --ignore-scripts and is re-checked as edited inputs are today.
- Accept:
  - `npm install` of a package with a postinstall script escalates, showing the script text.
  - A test proves the "Run without scripts" path is re-checked and runs with --ignore-scripts.

**D-096 WinGet and installer admission** [BUILD, S]
- Deps: none.
- Build:
  - winget install and upgrade, choco, scoop and msiexec calls escalate as High, showing the package id, publisher and source.
  - Extreme never approves them.
- Accept: winget install escalates in every mode, and Extreme waits for a person.

## 13. Wave 2: evidence

**D-003 Change evidence pack** [BUILD, M]
- Deps: C-010, C-011, D-009.
- Build:
  - Store evidence under %LOCALAPPDATA%\Gatehouse\evidence, with files named by sha256.
  - Build one pack per change, either a turn range or a commit. It holds:
    - the commands run, with exit codes
    - done-claim results and sealed-check counts
    - coverage and mutation deltas where available
    - the decisions and approvals involved
    - the SBOM delta
    - checkpoint links
  - Hash-link every item to the audit chain.
  - Add a pack viewer in the session and a signed export that reuses C-011.
  - Add a retention setting, default 90 days, using junction-safe deletion. Redact before storing.
  - Add the pack hash to D-030 notes.
- Accept:
  - Changing one byte of an export fails both the Node and PowerShell verifiers.
  - A 50-file pack builds in under 5 s.
  - Add a break check, evidence_chain.

**D-004 Diff-scoped mutation gate** [BUILD, M]
- Deps: C-004 and the analysis worker.
- Build:
  - Detect StrykerJS or Stryker.NET in the project.
  - Mutate only changed lines, with no network.
  - Report the score and surviving mutants, with an optional per-project threshold.
- Accept:
  - A fixture with a weak test reports at least one survivor.
  - A run that hits the memory cap aborts cleanly with a reason.
  - Audit mutation_run.

**D-005 Surviving-mutant tasks** [BUILD, S]
- Deps: D-004.
- Build:
  - From a survivor, start a task to write a test that kills it.
  - The task is scoped to test files: edits to other files escalate.
  - The mutant is rechecked afterwards.
- Accept:
  - The killed count rises on the fixture.
  - A source edit during the task escalates.

**D-010 Randomised check seeds** [BUILD, S]
- Deps: D-009.
- Build: verification reruns pass a fresh seed to property and data-driven tests, and the seed is recorded.
- Accept:
  - A hard-coded fixture passes with a fixed seed and fails a randomised rerun.
  - The audit records the seed.

**D-011 Flake quarantine** [BUILD, S]
- Deps: D-001.
- Build:
  - Rerun failures up to 5 times with recorded seeds, and label mixed results as flaky, with the evidence.
  - Any skip or delete of a flaky test goes through D-001.
- Accept:
  - A flaky fixture is labelled after 5 reruns.
  - Skipping it escalates.

**D-016 Taint-tracked egress guard** [BUILD, M]
- Deps: the built provenance labels.
- Build:
  - Extend taint from commands to hosts, URLs, email addresses and long strings taken from untrusted sources.
  - These escalate at risk 70 or more, showing the taint chain:
    - network-capable calls whose arguments carry tainted values (curl, Invoke-WebRequest, a push to a new remote, WebFetch, publish, upload)
    - writes outside the project that carry tainted values
  - Taint labels can only escalate, never allow. Extreme never approves a taint escalation.
- Accept:
  - A URL injected through a README and then used in curl escalates, showing its source.
  - Add golden cases for propagation and a threat model entry.

**D-017 Subagent boundary labels** [BUILD, S]
- Deps: D-016.
- Build: a subagent's result inherits the taint of everything the subagent read.
- Accept: a subagent reads an injected file, and the main agent's resulting push escalates.

**D-026 Policy regression from real history** [BUILD, M]
- Deps: C-012 and the built replay.
- Build:
  - On any rule save, replay the last 90 days of real decisions.
  - A change that turns a past deny or escalation into an allow blocks the save and lists the affected records.
  - The owner can override only with a typed confirmation on the desktop.
- Accept:
  - A flipping rule blocks the save with the list of affected records.
  - A tightening change saves at once.
  - Audit policy_regression_blocked and policy_regression_accepted.

**D-027 Step-exact reconstruction** [BUILD, M]
- Deps: C-010.
- Build:
  - Rebuild the working tree at any audited step in a scratch worktree, from the recorded edits and checkpoint commits, with no model call and no shell.
  - Steps that held redacted input fall back to the nearest checkpoint and are marked.
- Accept:
  - The reconstructed tree hash equals the recorded checkpoint hash at a sampled step.
  - A test proves nothing executes.

**D-029 Audit anchoring** [BUILD, S]
- Deps: the passkey relay.
- Build:
  - Sign the audit chain head daily and on demand.
  - If a phone is paired, the phone signs with its passkey (Face ID). Otherwise a local DPAPI-sealed Ed25519 key signs, and that anchor is marked weaker.
  - Keep anchors as signed tags in a separate local git repository under the data folder.
- Accept:
  - Rewriting an old record fails verification against an anchor.
  - Both verifiers check anchors. Audit anchor_signed.

**D-056 SBOM per change** [BUILD, S]
- Deps: D-003.
- Build:
  - Generate a CycloneDX 1.6 JSON diff from the lockfiles before and after the change.
  - Codehouse generates it itself where feasible, otherwise use a tool pinned with a stated reason.
- Accept: a test validates the document against the schema.

**D-057 Offline vulnerability snapshot** [BUILD-SAFE, M]
- Deps: D-053.
- Build:
  - Import an OSV snapshot file signed with the IT key from the managed folder.
  - Match added or changed dependency versions against it, and escalate matches with the advisory id.
  - No snapshot ships with Codehouse.
- List for IT: the snapshot source and refresh cadence.
- Accept:
  - With a test snapshot, a known vulnerable version escalates.
  - An unsigned or tampered snapshot is refused, nothing matches against it (fail closed), and Doctor reports it.

**D-061 Untrusted content scanner** [BUILD, M]
- Deps: D-016.
- Build:
  - Scan tool results from the web, MCP and untrusted files for injection markers: instructions aimed at the agent, tool-call syntax, hidden text and encoded payloads.
  - Flag them in the transcript with a quarantine view, and raise the session's taint.
  - Replace the output only where the SDK supports it for that tool, as section 10 says.
- Accept:
  - A seeded injection in a fetched page is flagged, and the next network call escalates.
  - Fewer than 2 of 20 benign fixtures are flagged.

**D-062 Local SAST on agent diffs** [BUILD, M]
- Deps: C-031.
- Build:
  - Run tree-sitter queries on changed lines for:
    - string-built SQL
    - shell commands with interpolated input
    - eval
    - disabled TLS checks
    - weak crypto
    - path traversal
  - Show findings in Changes and in the evidence pack.
  - A Severe finding escalates the next commit.
- Accept:
  - 5 seeded patterns are found with file and line.
  - Benign fixtures are clean.

**D-075 Loop and thrash detector** [BUILD, S]
- Deps: none.
- Build:
  - Detect the same failing command three times, an edit and its reversal twice, or no progress for N turns.
  - First tell the agent what it repeated. Pause and notify the phone if it repeats again.
- Accept:
  - The fixture gets the message after the third repeat and pauses after the next one.
  - Audit thrash_warned and thrash_paused.

**D-085 Data-boundary hand-off check** [BUILD, S]
- Deps: C-016.
- Build:
  - Content carries a classification from the project setting. The default is internal.
  - Any hand-off to another model (carry on, cross-model review, comparison) is denied when the target model's verified card does not permit that classification.
- Accept:
  - Confidential content sent to a model with an unverified card is denied, with the reason shown.
  - Audit handoff_denied.

## 14. Wave 3: intent and architecture

Build in this order.

**D-066 Characterisation capture** [BUILD, M]
- Deps: none.
- Build:
  - Before an agent edits untested code, offer to capture its behaviour.
  - Codehouse generates a harness with recorded or generated inputs and saves the redacted outputs as characterisation tests.
  - The capture is a Codehouse-run action (section 6).
- Accept:
  - The captured cases replay green before the change.
  - The recorded data passes redaction.

**D-006 Behaviour diff** [BUILD, M]
- Deps: D-066.
- Build: after a change, replay the captured inputs and list the changed outputs in plain English.
- Accept: a fixture with one intentional change shows exactly one behaviour delta.

**D-028 Causal provenance graph** [BUILD, M]
- Deps: D-016, C-010.
- Build: a graph from sources (files read, pages fetched, messages) to tool calls to hunks, built from the audit and the taint labels.
- Accept: selecting a hunk shows the injected file that preceded it.

**D-031 Evidence queries** [BUILD, M]
- Deps: none.
- Build:
  - Saved query templates over incremental JSONL index files, with no native database.
  - Templates include: who approved what, every deny for a project, every network call and every Extreme approval.
- Accept:
  - A query over 100,000 records returns in under 2 s on this laptop.
  - Results are redacted.

**D-033 Requirement ledger** [BUILD, M]
- Deps: D-030.
- Build:
  - Store requirements in docs/requirements as Markdown with front matter and stable ids. EARS wording is optional.
  - Link them to commits through D-030 notes, to tests and to evidence packs.
  - Show a trace matrix and a gaps list in the app.
- Accept:
  - A requirement with no test is flagged.
  - Every link resolves.
  - Malformed files are parsed tolerantly.

**D-034 Unrequested behaviour detector** [BUILD, M]
- Deps: D-033.
- Build: flag hunks that cannot be traced to a requirement or a plan step, with the reason.
- Accept: an extra feature in the fixture is flagged.

**D-035 Scope creep meter** [BUILD, S]
- Deps: the built goal mode and task list.
- Build: a live meter on the progress card counting files touched outside the plan's expected files.
- Accept: editing an unplanned file raises the meter.

**D-036 Tests-first contract mode** [BUILD, M]
- Deps: D-007, D-033.
- Build:
  - In this mode, the agent first writes tests from acceptance criteria.
  - A person approves them and they are locked.
  - Edits to non-test files escalate until the tests are approved.
- Accept:
  - Implementation edits before approval escalate.
  - After approval, the tests are locked.

**D-037 Assumption register** [BUILD, S]
- Deps: the Companion.
- Build:
  - Add an in-process Companion tool, declare_assumption, allowed by a policy rule with source sdk only.
  - Assumptions show on the progress card and in the evidence pack until verified.
- Accept:
  - An unverified assumption appears in the pack.
  - A tool of the same name from any other server still asks.

**D-038 ADR capture** [BUILD, S]
- Deps: none.
- Build:
  - Draft an ADR in MADR format in docs/adr from decisions made in a session, linking back to the session.
  - Write it through the audited path after the owner accepts it.
- Accept: a decision in the fixture produces a draft ADR that links to the session.

**D-039 Requirement change impact** [BUILD, S]
- Deps: D-033.
- Accept: editing a requirement lists the linked code, tests and ADRs.

**D-040 Intent drift alarm** [BUILD, S]
- Deps: the built goal mode and a local model.
- Build: at checkpoints, a local model compares the agent's restated goal with the goal that was set. This runs locally only.
- Accept:
  - A divergent fixture raises an alert.
  - With no local model, the feature says it is unavailable.

**D-041 Architecture rules as policy** [BUILD, M]
- Deps: C-031.
- Build:
  - .codehouse/architecture.yml defines layers, allowed dependencies and forbidden imports.
  - Imports in changed files are parsed with tree-sitter and checked. Violations escalate with the rule named.
  - The graph persists in .codehouse/arch as JSON and is rebuilt incrementally.
- Accept:
  - A Domain-to-Infrastructure import escalates.
  - Add a break check and golden cases.

**D-042 Living C4 diagrams** [BUILD, M]
- Deps: C-057, D-041.
- Build: generate C4 context, container and component diagrams in Mermaid from the graph, with drift shown since the last approved version.
- Accept: a new module appears in the diagram marked as drift.

**D-043 Architecture drift alerts** [BUILD, S]
- Deps: D-041.
- Accept: a new cycle or a new cross-boundary edge raises a dashboard alert.

**D-044 ADR-aware context** [BUILD, S]
- Deps: D-038.
- Build:
  - Inject relevant ADRs, chosen by touched paths and keywords, into session instructions.
  - Flag edits that contradict an ADR.
- Accept: a contradicting edit is flagged, with the ADR named.

**D-045 Fitness functions** [BUILD, M]
- Deps: D-041.
- Build:
  - Owner-defined checks: coupling, module size, forbidden APIs and dependency counts.
  - They act as a gate in the evidence pack and in goal mode.
- Accept: a breached threshold fails the gate.

**D-046 Public API break guard** [BUILD, M]
- Deps: C-032.
- Build:
  - Diff the public API surface: TypeScript declarations through the language service, and .NET through ApiCompat if it is present (detected, never installed).
  - Breaking changes escalate.
- Accept: removing an exported function escalates, with the diff shown.

**D-048 Architecture review pack** [BUILD, S]
- Deps: D-042, D-038.
- Accept: an arc42 pack is generated with every section present, and sections with no source are marked as gaps.

**D-050 Threat model delta** [BUILD, S]
- Deps: D-041.
- Build: a new endpoint, dependency, data store or trust boundary proposes draft STRIDE entries.
- Accept: a new HTTP route produces a draft entry.

## 15. Wave 4: approvals and human factors

**D-014 Consequence preview** [BUILD-SAFE, M]
- Deps: D-013.
- Build safe variant only:
  - Static effect prediction from D-013, plus a list of the paths a command is likely to touch, parsed from rm, mv, Remove-Item, git clean and similar commands.
  - Nothing executes before approval.
- List for IT and SECURITY: shadow execution in an isolated environment (Windows Sandbox, or a restricted job with AppContainer).
- Accept:
  - A test proves nothing runs before approval.
  - Predicted paths are shown for the listed commands.

**D-019 Earned-autonomy proposals** [BUILD, M]
- Deps: C-015.
- Build:
  - Keep a per-project track record: approvals never undone, sealed-check passes, Verified claims and no floor hits.
  - Propose raising the default level by one step.
  - The proposal never applies by itself. Applying it is the owner's explicit desktop action, with a passkey co-signature when a phone is paired.
- Accept:
  - A test proves a proposal never applies without the owner.
  - Audit autonomy_raise_proposed and autonomy_raised.

**D-020 Explain why and what would change** [BUILD, S]
- Deps: none.
- Build:
  - Every decision expands to a deterministic rule trace (stages and rules matched) plus the smallest change that would alter the outcome.
  - Floor decisions say "cannot be changed".
- Accept:
  - Every escalation in a test run has a trace.
  - Floor decisions never offer a counterfactual.

**D-022 In-turn batch approvals** [LIST]
- Do not build.
- Owner decision needed: whether one approval may cover identical calls in one turn. The proposal is never for High.

**D-023 Scope lease** [BUILD, M]
- Deps: the built goal mode and task list.
- Build: in Auto and Accept edits, the goal or plan defines a lease of paths and command families. Anything outside it escalates.
- Accept: a write outside the lease escalates in Auto.

**D-024 Second confirmation for loosening** [BUILD-SAFE, S]
- Deps: none.
- Build safe variant:
  - Removing a deny, switching off a built-in ask or raising a level needs a typed confirmation on the desktop, then a 10-minute cooling-off before it applies.
  - The phone and push channels are told, for information only.
- List for SECURITY: a phone passkey co-signature in place of the cooling-off.
- Accept:
  - Loosening does not apply until the cooling-off passes and the confirmation is typed.
  - Tightening applies at once.

**D-087 Interruption budget** [BUILD, S]
- Deps: none.
- Build:
  - Batch non-urgent notices into a summary every N minutes: turns finished, the digest and notes from Claude.
  - Approvals and errors stay immediate.
- Accept: a test proves approvals bypass batching.

**D-088 Adaptive explanation depth** [BUILD, S]
- Deps: D-020.
- Accept:
  - The depth setting (short, normal, full) persists per area.
  - Floor details are always shown in full.

**D-089 Review load meter** [BUILD, S]
- Deps: none.
- Build:
  - Estimate review minutes for each pending diff from lines, files and risk.
  - Warn when output exceeds the owner's set capacity per hour.
- Accept:
  - An estimate is shown for every pending diff.
  - The warning shows when output is above capacity.

**D-091 Narrated diffs and approvals** [BUILD, M]
- Deps: the screen reader mode.
- Build:
  - Structured narration of hunks and risk: file, change type, lines and risk.
  - Keyboard movement between hunks.
- Accept:
  - An automated test checks the order of the accessible text.
  - An NVDA run is recorded as owed by the owner.

**D-092 Safe keyboard approvals** [BUILD, S]
- Deps: none.
- Build: allowing High or Severe by keyboard needs a two-key chord, for example Ctrl+Enter then Enter within 2 s.
- Accept: a test proves a single key cannot allow High.

**D-093 Cognitive load presets** [BUILD, S]
- Deps: none.
- Build: presets for chunked plans, reduced motion, fewer panels and a single-task focus mode.
- Accept: each preset passes the axe-core scan.

## 16. Wave 5: analytics, knowledge, multi-model and health

Build D-072 before D-069, D-076 before D-100, and D-047 before D-099.

**D-072 Failure taxonomy** [BUILD, M]
- Deps: the audit.
- Build: classify loops, tool errors, failing tests, undos, contradicted claims and denials, per model and per project.
- Accept: fixture events are classified correctly.

**D-069 Hotspot map** [BUILD, S]
- Deps: D-072.
- Accept: the top hotspot, ranked by churn, complexity and agent failure rate, matches the fixture.

**D-032 Agent-aware build provenance** [BUILD, M]
- Deps: D-003.
- Build: for each release, emit a SLSA provenance v1 statement listing sessions, approvals and evidence packs.
- Accept: the statement validates against the schema, and its hashes verify.

**D-047 Capability map** [BUILD, M]
- Deps: D-042.
- Accept: a change report names the affected business capability.

**D-049 NFR budgets** [BUILD, M]
- Deps: the analysis worker.
- Build: detect BenchmarkDotNet or tinybench, and benchmark agent-changed hot paths against budgets under a job object.
- Accept: a seeded slowdown fails its budget.

**D-051 Personal data flow map** [BUILD, M]
- Deps: D-041.
- Build:
  - Detect personal data fields by name and type patterns.
  - Trace them to logs, storage and network calls.
  - Mark the output as a draft.
- List for LEGAL: the scope and the field list.
- Accept: an email field is traced to the logger.

**D-063 Package provenance verification** [BUILD-SAFE, M]
- Deps: D-053.
- Build safe variant: where dotnet is present, verify NuGet signatures offline with `dotnet nuget verify`. Unsigned packages escalate.
- List for IT: npm provenance attestation checks, which need network access.
- Accept: an unsigned NuGet package escalates.

**D-065 Test impact analysis** [BUILD, M]
- Deps: C-001 and C-031.
- Build:
  - Use a static import graph plus history to choose affected tests for inner loops.
  - Releases still run everything.
- Accept:
  - The affected set is a subset of the full set.
  - A test proves `npm run release` still runs the full gate.

**D-068 Dead code with evidence** [BUILD, S]
- Deps: C-031.
- Accept:
  - Unreferenced fixture code is listed, with static and coverage evidence.
  - Removal is proposed in small slices.

**D-073 Undo-learning loop** [BUILD, S]
- Deps: D-059.
- Build:
  - Repeated undos or denials of the same kind produce a proposed instruction edit, with the evidence.
  - Applying it goes through D-059.
- Accept: three similar undos produce a proposal.

**D-074 Behaviour regression for Claude Code upgrades** [BUILD, M]
- Deps: C-008.
- Build:
  - Replay owner-chosen tasks in scratch folders before the pinned Claude Code range is widened.
  - Compare decisions, tool use and outcomes.
  - The owner starts it explicitly, within a spend cap.
- Accept: a seeded behaviour regression blocks the range change.

**D-076 Cost per outcome** [BUILD, S]
- Deps: the usage page.
- Accept: cost per accepted change includes rework (undone hunks and reruns).

**D-100 Estimates from history** [BUILD, S]
- Deps: D-076.
- Accept:
  - An estimate shows an interval and its sample size.
  - With fewer than 5 samples, it says there is not enough history.

**D-077 Context efficiency report** [BUILD, S]
- Deps: the context meter.
- Accept: instruction blocks never referenced in a session are listed.

**D-078 Claim calibration score** [BUILD, S]
- Deps: D-009.
- Accept: a score per model is computed from Verified against Contradicted claims.

**D-079 Codebase tours** [BUILD, M]
- Deps: C-036.
- Accept:
  - Each tour step links to a real symbol.
  - Steps broken by later code changes are flagged.

**D-081 Why is this code like this** [BUILD, S]
- Deps: D-030, D-038.
- Accept: the answer cites the commit, its session note and any ADR.

**D-082 Stale instruction detector** [BUILD, S]
- Deps: C-031.
- Accept: a deleted symbol that CLAUDE.md still mentions is flagged.

**D-083 Ubiquitous language glossary** [BUILD, S]
- Deps: none.
- Accept: a synonym clash in names is flagged.

**D-084 Adversarial pair** [BUILD, M]
- Deps: C-043, C-044, D-085.
- Build:
  - One model implements. A second model, through the gateway and within the data-boundary cards, tries to break the result in a separate worktree, using read and test-run tools only.
  - Its findings go into the evidence pack.
- Accept:
  - The breaker's findings land in the pack.
  - A breaker edit to source escalates.

**D-086 Local judge for claims** [BUILD, S]
- Deps: D-009 and a local model.
- Accept:
  - A seeded reward hack is flagged.
  - A test proves the judge can only flag or escalate, never allow.

**D-090 Measured time panel** [BUILD, S]
- Deps: the usage data.
- Accept: measured time per task is shown as an interval against the owner's own baseline. This runs locally only.

**D-099 Evidence-backed stakeholder summary** [BUILD, S]
- Deps: D-003, D-047.
- Accept:
  - Every sentence links to evidence.
  - A test proves claims without evidence are withheld and listed.
  - The output is redacted.

## 17. Wave 6: enterprise and large items

**D-012 Time-boxed fuzz pass** [BUILD-SAFE, L]
- Deps: D-008, C-004.
- Build safe variant:
  - Property-based fuzzing with fast-check, or the project's own property framework, on changed parsing functions.
  - It is time- and memory-boxed, and its findings are pinned through D-008.
- List for IT and the owner: native fuzzers (jazzer.js, SharpFuzz).
- Accept:
  - A seeded crash is found within 60 s.
  - Memory stays under the cap.

**D-052 Multi-repo contract check** [BUILD, L]
- Deps: D-046, C-036.
- Accept: a breaking change in a provider repo reports the affected local consumer repos.

**D-067 Migration planner with evidence** [BUILD, L]
- Deps: D-006, D-066.
- Accept: every migration wave has characterisation tests and a behaviour diff.

**D-070 PowerShell modernisation** [BUILD, M]
- Deps: the PowerShell AST worker.
- Build: use PSScriptAnalyzer if it is present. Otherwise run a basic 5.1-to-7 compatibility check on the built AST worker.
- Accept: findings are reported per script on a fixture.

**D-071 Dependency upgrade with evidence** [BUILD, M]
- Deps: D-003, D-053.
- Accept: every upgrade has a pack with tests, an SBOM delta and admission checks.

**D-080 Signed knowledge packs** [BUILD, M]
- Deps: C-055.
- Accept:
  - ADRs, the glossary and instructions export and import as a signed pack.
  - An altered pack is refused.

**D-094 Verifiable egress report** [BUILD-SAFE, M]
- Deps: a new C# helper, packaging/Egress.cs.
- Build safe variant:
  - Sample the TCP and UDP endpoints owned by session processes with GetExtendedTcpTable and GetExtendedUdpTable. No admin rights are needed.
  - Produce a signed report per session, listing every remote endpoint against an allow-list:
    - Anthropic API endpoints for Claude sessions
    - the loopback gateway
    - none for local-model sessions
  - An endpoint outside the list is flagged. In strict mode it also stops the session (fail closed).
- List for IT: ETW-based capture, which needs admin rights.
- Accept:
  - A seeded outbound connection from a session child process is reported.
  - A local-model session's report shows no remote endpoints.

**D-095 GPO and Intune templates** [BUILD-SAFE, M]
- Deps: the IT-signed managed policy.
- Build:
  - ADMX and ADML templates.
  - A stricter-only reader for HKLM\Software\Policies\Codehouse (deny, escalate, remove allow and caps), merged like the managed overlay and shown in Doctor.
- List for IT: the rollout.
- Accept:
  - A registry value appears in Doctor and tightens a decision.
  - A value that tries to allow is ignored, with a Doctor finding.

**D-097 Constrained Language Mode awareness** [BUILD, S]
- Deps: the PowerShell AST worker.
- Accept:
  - Doctor shows the PowerShell language mode and any AppLocker or WDAC hints.
  - Failing commands explain the likely cause.

**D-098 NPU judge profile** [BUILD, M]
- Deps: C-067, D-086.
- Accept:
  - When an NPU-capable Foundry Local model is present, the judge runs on it.
  - Otherwise it falls back and says so.

## 18. Final report

When every item is resolved, write docs/reports/frontier-build-YYYY-MM-DD.md. It must contain:

1. What was built in each wave, with test counts, break-check counts and BUILD_REPORT phase references.
2. The safe variants that were built, and what remains for a decision.
3. Every listed item, with the decision needed, who decides (owner, IT, security or legal) and the invariant affected.
4. Every owner-delegated stricter decision you made, for the owner to confirm.
5. Blocked and deferred items, with reasons.
6. Gate and release results per wave.
7. Flaky files and memory incidents.
8. Real runs still owed: the gateway, local models, NVDA and the phone.
9. The owner's to-do list, in priority order.

Write the report in plain UK English, with no em dashes or en dashes.

## 19. Carrying on

If this session runs under Codehouse Extreme approval, keep going wave by wave. End a reply with the line QUEUE EMPTY only when:
- every item in docs/plan/frontier-status.md is built, built safe variant, listed for decision, blocked or deferred, and
- the final report is written.