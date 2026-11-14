# Codehouse expansion build: E-001 to E-100

You are building Codehouse, a Windows desktop workbench for AI chat and AI coding, in this repository. Your job is to build the 100 expansion features E-001 to E-100 in six waves, E1 to E6. Before each wave, build any prerequisites from the C and D backlogs that the wave needs and that are not built yet. Never weaken a safety rule.

Write in plain UK English with British spelling. Never use em dashes or en dashes anywhere: code comments, docs, UI text, commit messages and reports. Use hyphens, commas or full stops instead.

## 1. Read first

1. CLAUDE.md, which holds the invariants, owner decisions and conventions. It is authoritative. Where this prompt and CLAUDE.md disagree, CLAUDE.md wins and you record the conflict.
2. BUILD_REPORT.md, which says what is built, how phase entries are written and what is still owed.
3. docs/sdk-notes.md, docs/threat-model.md, docs/policy-guide.md and DESIGN.md.
4. If present:
   - docs/research/gap-analysis-2026-11.md
   - docs/research/feature-frontier-2026-11.md
   - docs/research/feature-expansion-2026-11.md
   - docs/plan/frontier-build-prompt.md
   - docs/plan/frontier-status.md
5. If this prompt is saved as docs/plan/expansion-build-prompt.md, re-read it after any compaction, restart or update.

## 2. Keep a status file

- Before any code, create docs/plan/expansion-status.md.
- List every prerequisite from section 11 and every E-item. For each one, record:
  - id, title and wave
  - status: todo, in progress, built, built safe variant, listed for decision, blocked or deferred
  - branch and BUILD_REPORT phase
  - a one-line note
- Update the file at the end of every slice and before every release.
- After a compaction, restart or update, read it first and carry on from the first unfinished item.
- This session may be running inside Codehouse itself. A release updates Codehouse and restarts this session on the same conversation. Commit everything and update the status file before releasing.

## 3. Safety rules you must keep

This is a summary. CLAUDE.md is authoritative.

- **Fail closed.** Any error, timeout, malformed input or missing data denies the action or asks a person. Never allow.
- **The floor.** The floor of hard denies is never overridden by anything. That includes Extreme approval, rules, plugins and the phone.
- **Modes.** The modes are Manual, Plan, Accept edits and Auto, plus per-session Extreme approval. Never use bypassPermissions or dontAsk.
- **Every tool call reaches Codehouse's policy engine.** The floor hook never answers allow, and canUseTool is never shadowed.
- **No inline SDK settings** beyond the narrow allowances already recorded.
- **Credentials.** Codehouse never reads, stores, logs or sends a credential or token. Hosted models go only through the organisation's gateway on 127.0.0.1.
- **Listeners.** All listeners bind to 127.0.0.1, with token, Host and Origin checks.
- **Phone.** The phone relay sees only ciphertext. The phone cannot edit inputs or change policy. Push channels use single-use codes.
- **Redaction.** The user's term list and secret patterns are applied before anything is stored or sent.
- **Audit.** Every decision and significant action gets a hash-chained audit record, written before the action. If the record cannot be written, the action is refused.
- **Organisation guard** applies per account.
- **MCP.** Only in-process MCP servers. A new Companion tool must be in-process and allowed by a policy rule with source sdk only.
- **Branding.** No vendor branding or imitation. Fixed update ids never change.
- **Native code.** No native Node addons. Native Windows capability comes only from small C# helpers compiled with the Windows csc.
- **Platform.** Windows first. Local signed builds. No cloud CI.

## 4. What you may decide, and what you must list

You may build and decide the following yourself. Record each one as an owner-delegated decision in CLAUDE.md, and list it in the final report for confirmation.
- Changes that only make Codehouse stricter:
  - new escalations
  - new floor denies
  - new exclusions from Extreme auto-approval
  - new pauses that are opt-in or off by default
- Implementation choices inside the rules.

You must not build the following. List each one with the decision needed, who decides and the invariant affected.
- Anything that loosens a rule:
  - fewer prompts
  - one approval covering more calls
  - broader allows
  - new trust in a channel, vendor, registry or device
  - new network access
  - a new credential path
  - an out-of-process server
  - native code in Codehouse
- The "List for" part of any item tagged BUILD-SAFE. Build only its safe variant.

## 5. Definition of done for every slice

- **Branch.** One slice per branch, named slice/E-NNN-short-name (or the C or D id for a prerequisite). Fast-forward it into main when green.
- **Tests and break checks.**
  - Write tests for every acceptance criterion.
  - Add break checks: deliberate mutations of the new code that must make named tests fail.
  - Run each break check against the single test that guards it, plus a control run, as BUILD_REPORT describes.
- **Policy changes.** Add golden cases in packages/policy/test/golden. Policy line coverage stays at or above 95%.
- **Safety.** Anything touching safety gets a threat model entry in docs/threat-model.md, continuing the numbering, with named tests that threat-model.test.ts checks.
- **Audit records.**
  - Names are snake_case.
  - They never hold secrets or prompt text.
  - They are written before the action, and the action is refused if the write fails.
- **Settings.**
  - Add them tolerantly: absent means the safe default, and unknown keys are kept.
  - An older version must still read the file. A test loads a settings file from before the change.
- **UI.**
  - Follow DESIGN.md, the Codehouse tokens and the existing components.
  - Make everything keyboard reachable, with screen reader labels.
  - Use the announcer for new events.
  - Respect high contrast and reduced motion.
  - Extend the axe-core scan to every new surface.
  - Show "not known" rather than inventing a number.
- **Phone and push.** Content is redacted and sealed as today. The phone gains no powers except those stated here.
- **Heavy work** (browser runs, test reruns, profiling, rehearsals, crawls, regeneration):
  - Run it in the analysis worker under Codehouse-Limits.exe.
  - Run one heavy job at a time.
  - Honour the memory governor and the kill switch.
- **Docs.**
  - A user guide article for every user-facing feature.
  - docs/policy-guide.md updated for every rule.
  - docs/sdk-notes.md updated with anything learnt about the SDK.
- **BUILD_REPORT.** Add a phase entry in the existing style: what it does, how, safety, tests, break checks and what is owed.

## 6. Actions Codehouse runs itself

Each command Codehouse runs itself must:
- be judged by the policy engine exactly as the same command would be judged for the session
- run with no credential in its environment
- run inside a job object
- stop on the kill switch
- be recorded in the audit with its outcome

## 7. Dependencies and project tools

- **Codehouse dependencies.**
  - Add one only with a stated reason and an exact version, recorded in BUILD_REPORT.
  - Check the licence. Refuse AGPL, GPL, SSPL, BUSL, LGPL and unknown licences, and record any other copyleft licence decision.
  - npm audit must show no new findings.
  - Prefer Node built-ins and packages already in the repo.
- **Project tools** (Playwright, dotnet-trace, dotnet-dump, Podman, openapi-generator, NSwag, orval, Kiota, faker and others).
  - Detect them in the user's project or on the machine. Never install them silently.
  - Offering to add one is an ordinary dependency change that goes through the policy engine and, if built, D-053.
- **Native code.** Check whether every tool loads native code. Refuse any tool that would need native code inside Codehouse.
- **Missing runtimes.** If the gateway, a local model runtime or a database is missing, build and test against stand-ins on 127.0.0.1. Record that a real run is owed, and make the feature say it is unavailable rather than fail.

## 8. Memory and tests

- The laptop has about 16 GB and suffers memory pressure. Run heavy test files one at a time with `npx vitest run path/to/file.test.ts`.
- Never skip a flaky test. Record flaky files and memory incidents in BUILD_REPORT.
- Run `npm run gate` before every release.
- Release at the end of each wave with `npm run release`. Never use --skip-tests unless the owner agrees in writing for that release.

## 9. Stop and escalate to the owner

Stop and report to the owner when:
- a slice would weaken any rule in section 3
- a test cannot pass without weakening a check or removing a break check
- two gate runs on the same commit disagree after a one-file-at-a-time retry
- the SDK, Windows or a tool does not support what a slice needs. Record what you found, build what you safely can and mark the rest blocked.

If a prerequisite is missing and not in section 11, mark the E-item blocked and move on.

## 10. Feasibility rules that override the feature descriptions

- **Browser automation** (E-001 to E-010):
  - Drive the installed Edge through --remote-debugging-pipe with a throwaway profile. Never open a debugging port, which would be an unauthenticated listener.
  - Allow loopback addresses only.
  - Reuse the approach of the repo's existing headless Edge scripts. Add puppeteer-core only if needed, with a stated reason.
- **Debugger ports.** Never open a Node inspector port (E-041, E-042). Use built-in flags (--cpu-prof, --report-on-fatalerror) and preload scripts calling v8.writeHeapSnapshot.
- **E-021 credential safety.**
  - Never read kubeconfig, Azure CLI or AWS files, because they hold credentials.
  - Read only context names, with `kubectl config current-context`, `az account show --query name -o tsv`, and the profile name from --profile or AWS_PROFILE.
  - Check the output for token-like strings and redact it.
- **No new unauthenticated listeners.** E-032 adds no mock server hosted by Codehouse. E-034 adds no intercepting proxy and no certificate install.
- **E-040** must require a per-project token header. Check Host, refuse any Origin and cap body size.
- **E-085** must not use GPL or commercially licensed formula engines. Verify a supported subset with a small built-in evaluator and mark the rest "not verified".
- **E-026.** Podman ships native binaries and needs IT approval. Never install it. Run containers only when Podman is present and a setting allows it. IT can lock that setting off through managed policy.
- **E-066** never deletes audit files.
- **E-100 canaries** never start a session or call a model. A failing canary puts Codehouse into safe mode (E-096) with Doctor guidance, never into a crash loop.
- **Stricter Extreme exclusions.** E-011, E-016, E-018, E-021, E-030, E-061 and E-093 add exclusions from Extreme auto-approval. They do not touch Codehouse's own repository, so the owner's unattended builds keep running. Record them as stricter decisions.
- **Protect unattended Extreme builds.**
  - E-089 keeps Extreme running on battery by default. Pausing Extreme on battery is opt-in.
  - E-094 is opt-in. The default stays all channels at once.
  - E-049 never delays approvals, the kill switch or Stop.
- **E-095** is a stopping power only. Resuming is a desktop action.
- **Role and tutor scopes.** E-046 role scopes and E-072 tutor mode can only restrict, as an overlay. They never add allows.
- **E-086** corrects only text Codehouse writes itself. For agent text it flags the problem and never rewrites input silently.
- **E-063 and E-073** stay local and deletable, and are never sent anywhere.
- **E-098 rehearsal** uses a synthetic data folder holding copies of settings and policy only. No audit, sessions or secrets go into it.

## 11. Prerequisites from the C and D backlogs

Build each one just before the wave that needs it, and only if BUILD_REPORT or docs/plan/frontier-status.md shows it is not built. The full acceptance criteria are in docs/plan/frontier-build-prompt.md. Short versions follow.

**Before Wave E2**
- D-003 Change evidence pack. A content-addressed store under the data folder, hash-linked to the audit, with a signed export. A one-byte change fails both verifiers.
- D-007 Locked acceptance tests. Edits to a locked test escalate, and Extreme never approves them.
- D-009 Done-claim verifier. Claims are rerun independently and stamped Verified, Contradicted or Unverified.
- C-031 Tree-sitter outline (WASM). Outline and go-to-symbol for TS, JS, Python, C#, PowerShell and JSON, in under 50 ms on 5,000 lines.

**Before Wave E3**
- C-057 Mermaid and Markdown artifacts. Rendered offline. Hostile Mermaid passes under the sandbox CSP.
- D-094 Egress helper (packaging/Egress.cs). Samples the session's endpoints with GetExtendedTcpTable, with no admin rights.
- C-004 Memory governor. Refuses new heavy work above a commit threshold and audits the refusal.

**Before Wave E4**
- C-010 Audit-backed session timeline.
- C-012 Policy dry run. Predicted counts, and nothing executes.
- D-030 Lineage git notes under refs/notes/codehouse.

**Before Wave E5**
- C-016 Verified data-boundary cards per model.
- C-059 XLSX attachments. A pinned pure JS parser running in a worker, with macros ignored.
- D-033 Requirement ledger. Markdown with stable ids, linked to commits, tests and evidence.
- D-051 Personal data flow map.
- D-055 Licence policy.
- C-055 Signed shared rule packs.
- D-080 Signed knowledge packs.
- D-100 Estimates from history. This is optional.

**Before Wave E6**
- C-013 Grant lifetimes.
- C-054 Signed session bundles. A tampered bundle is refused.
- D-079 Codebase tours.
- D-083 Ubiquitous language glossary.
- C-022 Audited editor. Optional, because it is an owner decision in the C-backlog. If it is not built, tutor mode uses the owner's own editor.

## 12. Wave E1: guards and reliability

Build in this order.

**E-100 Invariant canaries** [BUILD, M]
- Deps: none.
- Build:
  - Add apps/host/src/canaries.ts. It runs at start, after each update and daily, with no model and no session.
  - It proves the following on the installed build:
    - the floor denies a Read of a canary .env path
    - redaction masks a canary secret
    - the Approver client fails closed on a wrong token and on a timeout
    - the Host refuses requests with no token, with a wrong Host and with any Origin
    - the audit chain verifies with both verifiers
    - the organisation guard refuses a fake account
    - the in-process MCP check refuses a fake stdio server
    - the managed policy loader refuses a tampered file
  - Any failure blocks new sessions, names the canary, shows Doctor guidance and offers safe mode.
- Accept:
  - Each canary has a break check that makes it fail.
  - A failing canary blocks session start.
  - The suite runs in under 5 s.
  - Audit canary_run with pass and fail counts.
  - Threat model entry.

**E-096 Safe mode** [BUILD, S]
- Deps: none.
- Build:
  - A start option from the tray, from Doctor, after three crash restarts in ten minutes, or after a failing canary.
  - In safe mode: no sessions restored, no plugins, no routines, no warm chat, push channels paused, and a banner.
  - Leaving safe mode is a desktop action.
- Accept:
  - After three simulated crashes, the next start is safe mode.
  - No session is restored.
  - Audit safe_mode_entered and safe_mode_left.

**E-097 Crash bundle** [BUILD, S]
- Deps: Doctor.
- Build:
  - One click builds a zip in Downloads containing:
    - host.log
    - version information
    - the Doctor report
    - the types and outcomes of the last 200 audit records, without inputs
    - crash codes
    - settings key names
  - Show a redaction preview first.
  - The zip never includes inputs, prompts, transcripts or secrets.
- Accept:
  - The preview matches the zip contents.
  - A seeded secret in host.log is masked.
  - Audit crash_bundle_exported.

**E-099 Health score** [BUILD, S]
- Deps: E-100.
- Build:
  - A dashboard tile and a Doctor section showing 30-day trends for:
    - canary results
    - crash restarts
    - memory incidents
    - flaky test files
    - gate results
    - update state
    - audit verification
  - Each factor links to its source.
  - The overall status is the worst factor. Do not use a weighted score.
- Accept:
  - A seeded crash restart appears in the trend.
  - Every factor links to its record.

**E-011 Destructive migration guard** [BUILD, M]
- Deps: none.
- Build:
  - Detect migration files: SQL, EF Core migrations, Prisma migration SQL, Flyway, Liquibase XML and YAML, Alembic and Knex.
  - Parse them with tree-sitter or a pinned pure JS SQL parser, with a stated reason.
  - Escalate the following, showing the statements and affected tables:
    - DROP TABLE and DROP COLUMN
    - TRUNCATE
    - type narrowing
    - NOT NULL added without a default
    - renames without a compatibility step
    - DELETE without WHERE
  - Extreme never approves these.
- Accept:
  - 25 golden cases (15 destructive, 10 safe) decide as written.
  - An EF Core DropColumn escalates.
  - Break check.
  - Audit destructive_migration_escalated.

**E-016 Remote database connection guard** [BUILD, S]
- Deps: none.
- Build:
  - Parse connection strings and client arguments for psql, sqlcmd, mysql, mongosh and redis-cli, including environment assignments.
  - A non-loopback host escalates, showing the host.
  - A host matching the project's production patterns escalates as Severe.
  - Extreme never approves writes to non-local databases.
  - Passwords in connection strings are redacted everywhere.
- Accept:
  - `psql -h` with a remote host escalates, with no password in the audit.
  - A loopback connection passes.
  - Golden cases.

**E-017 Bulk data export guard** [BUILD, S]
- Deps: none.
- Build:
  - Escalate pg_dump, mysqldump, bcp out, sqlcmd -o, mongoexport, COPY TO, SELECT INTO OUTFILE and Export-Csv of query results, showing source and target.
  - Targets outside the project need approval.
- Accept:
  - pg_dump to Downloads escalates.
  - Golden cases.

**E-021 Production context guard for cloud CLIs** [BUILD, S]
- Deps: none.
- Build:
  - Before a mutating kubectl, helm, az, aws or gcloud command, read only the context or profile name, as section 10 says.
  - Names matching the project's production patterns make the call Severe. Extreme never approves them.
  - Read-only commands are unchanged.
- Accept:
  - `kubectl apply` in a context named prod-weu escalates as Severe.
  - A test proves the credential files are never opened.
  - Golden cases.

**E-023 Kubernetes manifest guard** [BUILD, S]
- Deps: none.
- Build:
  - On agent edits to Kubernetes YAML and Helm values, flag:
    - privileged containers
    - hostPath, hostNetwork and hostPID
    - running as root
    - latest tags
    - missing resource limits
    - plain-text secrets
  - Severe findings escalate the edit.
- Accept:
  - privileged: true escalates.
  - 12 golden fixtures.

**E-028 WSL command coverage** [BUILD, S]
- Deps: none.
- Build:
  - Parse wsl.exe and bash.exe invocations (-e, --exec, -d, -- and bash -c strings) and apply the Bash parser and rules to the inner command.
  - Unparseable inner commands escalate.
  - Floor extension: deny WSL home secrets under \\wsl$ and \\wsl.localhost, including .ssh, .aws, .kube and .config/gcloud.
- Accept:
  - `wsl -e bash -c "cat ~/.ssh/id_rsa"` is denied at the floor.
  - `wsl -- ls` is decided as ls would be.
  - Golden cases.

**E-030 Toolchain manager guard** [BUILD, S]
- Deps: none.
- Build:
  - Escalate user-wide and machine-wide toolchain changes, showing what changes and where:
    - nvm, fnm and volta installs and switches
    - rustup and pyenv-win
    - dotnet-install scripts
    - npm -g, pnpm -g and dotnet tool install -g
    - pip install outside a virtual environment
    - Set-ExecutionPolicy
  - Extreme never approves global installs or Set-ExecutionPolicy.
- Accept:
  - `npm install -g` escalates in every mode.
  - Installs into a project virtual environment behave as before.
  - Golden cases.

**E-093 Card data guard** [BUILD, S]
- Deps: none.
- Build:
  - Detect Luhn-valid 13 to 19 digit numbers, outside documented test ranges, in staged diffs, fixtures and logs.
  - Also detect code that logs or persists card fields such as pan, cardNumber and cvv.
  - Staged real-looking card numbers are denied at the floor.
  - Logging card fields escalates.
  - Only the rule and location are recorded.
- Accept:
  - A commit with a non-test card number is denied.
  - A known test number passes.
  - A test proves the value never appears in audit or logs.

**E-086 Writing rules enforcement** [BUILD, S]
- Deps: none.
- Build:
  - A global and per-project style list covering UK spelling, no em or en dashes, required terms and banned terms.
  - Apply it to everything Codehouse writes (exports, summaries, change records, docs) and show the corrections in the preview.
  - For agent-written docs and commit messages, flag problems in Changes and the evidence pack without rewriting them.
- Accept:
  - An export containing an em dash is corrected in the preview, with the change listed.
  - An agent commit message with a banned term is flagged.

**E-080 Shared signed redaction lists** [BUILD, S]
- Deps: none.
- Build:
  - Import team lists signed with a trusted key.
  - They only add terms, never remove them.
  - Each list is shown with its source and date.
- Accept:
  - An imported term is masked in an export.
  - A list that removes a term is refused, and so is a tampered list.
  - Audit redaction_list_imported.

**E-051 Merge conflict pre-check** [BUILD, S]
- Deps: none.
- Build:
  - While worktree sessions run, periodically simulate merging each branch into its base and into each other with `git merge-tree --write-tree`, run by Codehouse.
  - Warn on the dashboard and in both sessions, naming the files.
- Accept:
  - Two fixture worktrees editing the same lines raise a warning within one cycle.
  - A test proves the working trees are unchanged.

**E-052 Structured task results** [BUILD, S]
- Deps: D-017 if built.
- Build:
  - "Hand off a side task" can declare a JSON Schema for the result.
  - The result is validated before it reaches the main session.
  - An invalid result goes back once with the errors, then is marked failed.
  - Results carry the side session's taint.
- Accept:
  - An invalid result is refused with its errors.
  - A valid result arrives with its taint label.

**E-089 Battery-aware scheduling** [BUILD, S]
- Deps: none.
- Build:
  - The C# shell reads SystemInformation.PowerStatus and tells the Host.
  - On battery, heavy jobs Codehouse runs are deferred, and new sessions default to a lower resource level.
  - Extreme keeps running unless the owner turns on "Pause Extreme on battery".
- Accept:
  - A simulated battery state defers a queued heavy job, which resumes on mains power.
  - Extreme keeps running by default.
  - Audit power_state_changed.

**E-094 Escalation ladder** [BUILD, S]
- Deps: none.
- Build:
  - An opt-in channel order with delays, for example the phone after 2 minutes and Slack after 5.
  - The default stays all channels at once.
  - The ladder never extends the approval timeout.
- Accept:
  - With a ladder set, the phone is told only after the delay.
  - Without one, behaviour is unchanged.

**E-095 Phone pause per project** [BUILD, S]
- Deps: none.
- Build:
  - A passkey-signed phone action that pauses every session in one project.
  - Resuming is desktop only.
- Accept:
  - The project's sessions pause and other sessions keep running.
  - A phone envelope that tries to resume is refused.
  - Audit project_paused_from_phone.
  - Threat model entry.

## 13. Wave E2: running and seeing the app

Build in this order.

**E-001 Visual regression baselines** [BUILD, M]
- Deps: D-003.
- Build:
  - A browser driver in apps/host/src/browser/, following section 10.
  - Capture screenshots of configured routes before and after a change.
  - Diff them with a pinned pure JS pixel diff, with a stated reason.
  - Show the changed regions in Changes and the evidence pack.
  - The owner approves baselines, which are stored in the evidence store.
- Accept:
  - A CSS change in a fixture app shows a diff region.
  - A non-loopback route is refused.
  - A test proves no listening port is opened.
  - The run happens under the analysis worker.
  - Audit visual_check_run.

**E-007 Console and network error watcher** [BUILD, S]
- Deps: E-001, D-009.
- Build:
  - During driver runs, capture console errors, uncaught exceptions, failed requests and CSP violations.
  - New errors after a change make a done-claim Contradicted.
- Accept:
  - A fixture that throws after a change shows Contradicted, with the error redacted.

**E-006 Responsive and theme matrix** [BUILD, S]
- Deps: E-001.
- Build:
  - Capture configured widths (default 360, 768, 1280 and 1920) and light, dark and forced-colours themes through CDP emulation.
  - Detect overflow and clipped text.
- Accept:
  - Overflow at 360 px is reported.
  - Each cell of the matrix links to its screenshot.

**E-002 Accessibility audit of the app being built** [BUILD, M]
- Deps: E-001.
- Build:
  - Ship axe-core in the app package and record the MPL-2.0 licence decision.
  - Inject it into driver pages and report WCAG 2.2 AA violations that are new against the baseline.
  - New Serious or Critical violations make a done-claim Contradicted. Projects can optionally gate on this.
- Accept:
  - A missing alt attribute is reported as new.
  - Violations link to the element, and to the source where source maps exist.
  - Audit a11y_audit_run.

**E-064 European Accessibility Act mapping** [BUILD, S]
- Deps: E-002.
- Build:
  - Map each rule to its WCAG 2.2 success criteria and EN 301 549 clauses.
  - Draft an accessibility statement, marked as a draft for legal review.
- Accept:
  - Every violation shows its references.
  - The statement lists the known issues.

**E-003 Design conformance check** [BUILD, M]
- Deps: E-001.
- Build:
  - A perceptual diff against a reference image, with a tolerance.
  - Computed styles compared against a design tokens file.
  - Report colours, spacing and fonts that are off-token.
- Accept:
  - An off-palette colour is reported with the nearest token.

**E-004 Web performance budgets** [BUILD, M]
- Deps: E-001.
- Build:
  - Measure LCP, CLS and an interaction latency proxy through injected PerformanceObserver scripts.
  - Use the median of 5 runs and compare against per-route budgets.
- Accept:
  - A seeded 500 ms delay fails the LCP budget.
  - Results show the run count and spread.

**E-009 Smoke crawl** [BUILD, S]
- Deps: E-001, E-007.
- Build:
  - Crawl same-origin loopback links within depth and page limits.
  - Never submit forms or send non-GET requests.
  - Report crashes, blank pages and error pages.
- Accept:
  - A blank fixture page is reported.
  - A test proves no POST is ever sent.

**E-008 Pseudo-localisation and copy checks** [BUILD, M]
- Deps: E-001, C-031.
- Build:
  - Detect the i18n framework (i18next, react-intl, .resx and others).
  - Render a pseudo-locale.
  - Report overflow, missing keys, and hard-coded strings found by tree-sitter in JSX and Razor.
- Accept:
  - A hard-coded string and a pseudo-locale overflow are both reported.

**E-010 Before and after UI previews on approval cards** [BUILD, S]
- Deps: E-001.
- Build:
  - When a decision concerns UI files, attach before and after thumbnails.
  - Show them on the desktop card, and on the phone through the sealed relay. Never put them in a push body.
- Accept:
  - The card shows both thumbnails.
  - A test proves the push payload contains no image.

**E-005 Flow recorder to locked end-to-end test** [BUILD, L]
- Deps: E-001, D-007.
- Build:
  - A headed Edge with a throwaway profile, driven through the pipe.
  - The owner clicks through a flow on a loopback app, and actions are recorded through an injected recorder and CDP bindings.
  - Save the result as a Playwright test if @playwright/test is in the project, otherwise as a Codehouse flow file that the driver replays.
  - Lock the saved test.
- Accept:
  - A recorded fixture login flow replays green.
  - The test is locked.
  - Non-loopback addresses are refused.

## 14. Wave E3: data, infrastructure, environments and APIs

Build in this order.

**E-025 Environment manifest and drift** [BUILD, S]
- Deps: none.
- Build:
  - Codehouse runs version queries for node, npm, pnpm, the dotnet SDKs, python, pwsh, git and java where present.
  - It also reads .nvmrc, global.json, rust-toolchain and engines.
  - Store the result in .codehouse/environment.json. Environment variables are recorded by name only, never by value.
  - Report drift.
- Accept:
  - engines node 22 on a machine running Node 24 reports drift.
  - A test proves no variable value is stored.

**E-027 Dev Drive and Defender awareness** [BUILD, S]
- Deps: none.
- Build:
  - Doctor shows each project's volume type (Dev Drive, ReFS or NTFS).
  - Where it can be read without admin rights, Doctor shows Defender's performance mode, with guidance.
  - Otherwise it shows "not known".
- Accept:
  - The volume type is shown for each project.
  - A test proves no admin prompt appears.

**E-029 Port and process tracking** [BUILD, M]
- Deps: D-094 helper, or build the helper here with the same contract.
- Build:
  - Use job objects and the TCP table to show listening ports and long-running processes for each session.
  - Warn about port clashes before a server starts.
  - At session end, offer to stop them. Ask first.
- Accept:
  - A fixture dev server appears with its port.
  - Nothing is stopped without confirmation.

**E-026 Container runs for Codehouse actions** [BUILD-SAFE, M]
- Deps: C-004.
- Build safe variant:
  - When Podman is present and the setting allows, run test reruns, sealed checks and other heavy jobs in a container.
  - The project is mounted read-only, with a scratch volume, and the container has no network.
- List for IT:
  - Allowing Podman on managed laptops.
  - Running agent sessions themselves in containers.
- Accept:
  - With a stand-in podman, the run uses the no-network flag and a read-only mount.
  - Without Podman, the feature says it is unavailable.

**E-012 Schema diff view** [BUILD, M]
- Deps: C-057, E-011.
- Build:
  - Derive the before and after schema from migrations, a Prisma schema, an EF Core snapshot or DDL.
  - Render a Mermaid ER diff.
- Accept:
  - An added column shows as added, and a dropped column shows as removed.

**E-013 Migration rehearsal** [BUILD, M]
- Deps: E-011.
- Build:
  - Run migrations up and then down against a throwaway database:
    - SQLite through node:sqlite.
    - Postgres or SQL Server only if a loopback instance or an E-026 container exists.
  - Report failures and steps that cannot be reversed.
- Accept:
  - A migration with no down step is reported as irreversible.
  - The throwaway database is deleted afterwards.

**E-014 Query plan review** [BUILD, M]
- Deps: E-013.
- Build:
  - Find changed queries with tree-sitter.
  - Run EXPLAIN, or EXPLAIN QUERY PLAN for SQLite, in the rehearsal database.
  - Flag full scans and missing indexes.
- Accept:
  - An unindexed fixture query reports a scan and suggests an index.

**E-015 Synthetic fixtures with PII scan** [BUILD, S]
- Deps: none.
- Build:
  - Generate deterministic synthetic seed data from the schema, using a small generator of our own or a pinned faker with a stated reason.
  - Flag real-looking personal data in existing fixtures: real email domains, UK phone and National Insurance formats, and Luhn-valid card numbers.
- Accept:
  - Generated fixtures meet the schema constraints.
  - A real-looking email in a fixture is flagged.

**E-018 IaC plan as policy** [BUILD, M]
- Deps: none.
- Build:
  - Parse plan output from terraform show -json, Bicep and ARM what-if JSON, CloudFormation change sets and Pulumi preview JSON.
  - Deleting or replacing a stateful resource escalates as Severe. This covers databases, storage, key vaults and queues.
  - New public exposure escalates as High.
  - An apply inherits the strictest result in its plan. Extreme never approves an apply that deletes.
- Accept:
  - Applying a plan that deletes a database escalates as Severe, naming the resource.
  - 20 golden fixtures.
  - Threat model entry.

**E-024 Blast radius preview** [BUILD, S]
- Deps: E-018.
- Build:
  - Show, on the approval card, the dependent resources from the plan's dependency graph.
- Accept:
  - Replacing a virtual network lists its subnets and machines.

**E-019 Infrastructure cost delta** [BUILD-SAFE, S]
- Deps: E-018.
- Build:
  - Import a price sheet signed with the IT key.
  - Give the monthly change as an interval.
  - Show "not known" for unknown SKUs.
  - No network access.
- List for IT: the source of the price sheet and how often it is refreshed.
- Accept:
  - A known SKU shows an interval.
  - An unsigned sheet is refused.

**E-020 Least-privilege IAM diff** [BUILD, S]
- Deps: none.
- Build:
  - Flag wildcard actions and resources.
  - Flag Owner or Contributor granted at subscription or account scope.
  - Flag new admin roles.
  - Offer a narrower alternative for each.
- Accept:
  - A grant of * on * escalates with a suggestion.

**E-022 In-process IaC misconfiguration checks** [BUILD, M]
- Deps: C-031.
- Build:
  - Rules over HCL, Bicep, ARM and CloudFormation for public storage, open security groups, missing encryption, weak TLS minimums and missing diagnostics.
  - Use tree-sitter WASM grammars where available, otherwise parse JSON or YAML. Record which grammars are available.
- Accept:
  - 10 seeded misconfigurations are found.
  - Benign fixtures are clean.

**E-031 Contract-first conformance probe** [BUILD, M]
- Deps: none.
- Build:
  - Generate valid requests for each operation in an OpenAPI 3.x spec.
  - Send them to the app on loopback as a Codehouse-run action.
  - Validate responses with a pinned validator, preferring one already in the repo.
  - Mismatches go into the evidence pack and make done-claims Contradicted.
- Accept:
  - A missing required field is reported.
  - A non-loopback server is refused.

**E-032 Mock definitions from specs** [BUILD-SAFE, S]
- Deps: none.
- Build safe variant:
  - Generate mocks for the project's own tool: MSW handlers, Prism config or WireMock mappings.
- List for SECURITY: a mock server hosted by Codehouse without a token, which would conflict with the listener rule.
- Accept:
  - The generated MSW handlers compile and cover every operation.

**E-033 Spec breaking-change detector** [BUILD, M]
- Deps: none.
- Build:
  - A TypeScript diff of OpenAPI or AsyncAPI versions from git.
  - Detect removed operations or fields, narrowed types, new required parameters and changed enums.
  - A breaking change without a major version bump escalates.
- Accept:
  - A removed response field escalates.
  - An added optional field passes.

**E-034 Contract snapshots** [BUILD, S]
- Deps: E-031.
- Build:
  - Store redacted probe responses as snapshots.
  - Report changes in response shape over time.
- Accept:
  - A changed shape is reported.

**E-035 API security lint** [BUILD, S]
- Deps: none.
- Build: spec rules that flag:
  - operations without security
  - missing 401 and 403 responses
  - object ids in paths without authorisation notes
  - unbounded arrays
  - no documented rate limit
  - sensitive data in query strings
- Accept:
  - An unauthenticated operation is flagged.

**E-036 Generated client drift** [BUILD, S]
- Deps: none.
- Build:
  - Where the project has an openapi-generator, NSwag, orval or Kiota config, regenerate the client into a scratch folder with the project's own tool, as a Codehouse-run action.
  - Diff the result against the committed client.
- Accept:
  - A spec change with no regenerated client reports drift.

**E-037 Error contract consistency** [BUILD, S]
- Deps: none.
- Build:
  - Check error responses in specs and in probe results against RFC 9457 or the project's convention.
- Accept:
  - An error without a type field is flagged.

## 15. Wave E4: runtime insight and orchestration

Build in this order.

**E-038 Local log capture and viewer** [BUILD, M]
- Deps: none.
- Build:
  - Capture the output of Codehouse-run commands.
  - Tail the log files listed in .codehouse/logs.yml, through the floor checks.
  - Parse JSON and common formats, then redact.
  - Provide search, level and time filters, and a retention setting.
- Accept:
  - A JSON line is parsed into fields.
  - A secret is masked.
  - A path the floor denies is refused.

**E-039 Error signature triage** [BUILD, S]
- Deps: E-038.
- Build:
  - Normalise errors into signatures and count them.
  - Source-map their frames.
  - Offer a fix task for each signature.
- Accept:
  - Two errors that differ only in ids group into one signature.

**E-040 Local trace receiver** [BUILD, M]
- Deps: none.
- Build:
  - An OTLP HTTP JSON receiver on 127.0.0.1, following section 10.
  - Redact attributes.
  - Show a span tree for each trace.
- Accept:
  - A request with no token is refused.
  - A fixture trace renders.
  - A 10 MB body is refused.
  - Threat model entry.

**E-041 Profiling on request** [BUILD, M]
- Deps: none.
- Build:
  - Use --cpu-prof for Node, and dotnet-trace for .NET if present.
  - Show an in-app flame graph and give the agent a summary of the top functions.
- Accept:
  - A fixture's hot loop is the top frame.
  - A test proves no inspector port is opened.

**E-042 Memory leak detector** [BUILD, M]
- Deps: none.
- Build:
  - A preload script takes heap snapshots with v8.writeHeapSnapshot across repeated runs.
  - Report the constructors whose retained size keeps growing.
- Accept:
  - A fixture that leaks an array on every request reports the constructor.

**E-045 Crash summary** [BUILD, S]
- Deps: none.
- Build:
  - Read Node diagnostic reports (--report-on-fatalerror), .NET unhandled exception output and known Windows crash codes.
  - Summarise them with source-mapped frames.
  - Use dotnet-dump only if it is present.
- Accept:
  - A fixture fatal error yields its top frame.

**E-043 Verified reproduction recipes** [BUILD, S]
- Deps: D-007.
- Build:
  - The agent writes a minimal reproduction test from the bug description.
  - Codehouse confirms it fails before the fix and passes after.
  - It is then locked.
- Accept:
  - A reproduction that passes before the fix is rejected.

**E-044 Bisect assistant** [BUILD, S]
- Deps: D-030.
- Build:
  - Run git bisect with a check command in a scratch worktree, as an audited Codehouse-run action.
  - Report the first bad commit with its session note.
  - Remove the worktree with junction-safe deletion.
- Accept:
  - The seeded bad commit is found.
  - The user's working tree is untouched.

**E-049 Resource-aware scheduler** [BUILD, M]
- Deps: C-004.
- Build:
  - A priority queue for sessions, routines and heavy jobs.
  - Each item starts when free memory and CPU allow.
  - Waiting items show their reason.
  - It never delays approvals, the kill switch or Stop.
- Accept:
  - Under simulated pressure, a queued job waits and then starts once memory frees.
  - A test proves approvals are unaffected.

**E-050 Cross-session locks** [BUILD, S]
- Deps: none.
- Build:
  - A lock table in the Host for files in shared folders, ports and named resources.
  - An agent edit to a file another session has locked escalates.
  - Locks release when the session ends.
- Accept:
  - Two sessions in one folder cannot both edit one file without a decision.

**E-055 Agent handover notes** [BUILD, S]
- Deps: none.
- Build:
  - A new in-process Companion tool, write_handover, allowed by a policy rule with source sdk only.
  - On pause, stop or end, it records state, next steps, risks and questions.
  - Files it names are checked against the real diff.
  - The next session in that folder receives the note.
- Accept:
  - A note that names an unchanged file is marked.
  - A new session receives the note.

**E-053 Verified playbooks** [BUILD, M]
- Deps: none.
- Build:
  - Playbooks in .codehouse/playbooks, made of steps and checklist items.
  - Each item has an automatic check where possible.
  - Codehouse verifies the checklist at the end.
- Accept:
  - A run that misses the docs step lists it as unmet.

**E-048 Evidence gates between steps** [BUILD, M]
- Deps: D-003, D-009.
- Build:
  - Gate types:
    - tests Verified
    - sealed checks pass
    - mutation score at least N
    - no new Serious accessibility violations
    - definition of done complete
  - The next step waits until the gate passes.
  - A gate that cannot be read fails closed.
- Accept:
  - A failing gate stops the next step and gives the reason.
  - An unreadable gate fails closed.

**E-046 Role-based agent teams** [BUILD, L]
- Deps: E-048, E-052.
- Build:
  - .codehouse/roles.yml defines planner, implementer, tester, reviewer and documenter roles, each with a model, effort, path scopes and tool limits.
  - Each role runs as its own session in its own worktree.
  - Role scopes are an overlay that can only restrict.
  - Hand-offs use E-052 structured results.
- Accept:
  - A tester role editing source escalates.
  - A role definition that adds an allow is refused.

**E-047 Workflows as code** [BUILD, L]
- Deps: E-046, C-012.
- Build:
  - .codehouse/workflows/*.yml defines steps, each with a role, prompt, inputs, outputs, gate and approval point.
  - A workflow is validated and dry-run before it starts.
  - Every step is audited.
  - After a restart, it resumes from the last completed step.
- Accept:
  - A fixture three-step workflow completes with its gates.
  - A restart mid-way resumes correctly.
  - An invalid workflow is refused before it starts.

**E-054 Night shift planner and morning report** [BUILD, M]
- Deps: E-049, E-047.
- Build:
  - At the end of the day, queue tasks with their dependencies, budgets and resource needs.
  - They run overnight through the scheduler and Extreme, within limits.
  - The morning report gives each task's evidence status, cost and open decisions.
- Accept:
  - Dependent tasks run in order.
  - The report shows each status.
  - A budget stops the run when it is reached.

## 16. Wave E5: delivery, compliance and knowledge work

Build in this order.

**E-062 Epic decomposition** [BUILD, S]
- Deps: D-033.
- Build:
  - Turn a brief into ledger stories with acceptance criteria and dependencies.
  - Add estimates from history where D-100 exists.
- Accept:
  - A fixture epic yields stories with stable ids and criteria.

**E-056 Work item linkage** [BUILD-SAFE, S]
- Deps: D-030.
- Build safe variant:
  - Link sessions, commits and evidence packs to Azure DevOps or Jira ids found in branch names, messages and the ledger.
  - Store the links locally, with a CSV or JSON export.
- List for IT: live sync through a claude.ai connector or the gateway.
- Accept:
  - A branch named AB#1234 links its session and commits.
  - The export lists them.

**E-057 Definition of done checklist** [BUILD, M]
- Deps: D-003.
- Build:
  - Per-project DoD items, checked automatically where possible and ticked by hand otherwise.
  - Done-claims show the DoD status.
- Accept:
  - A change with no docs shows the unmet item.

**E-058 Release readiness report** [BUILD, S]
- Deps: D-003.
- Build: aggregate, for a release candidate:
  - evidence packs
  - open escalations
  - sealed checks
  - SBOM, licence and vulnerability status
  - accessibility and DoD
- Accept:
  - An open Severe escalation marks the release not ready and gives the reason.

**E-059 Change record and CAB pack** [BUILD, S]
- Deps: E-058, E-086.
- Build:
  - Draft an ITIL change record and a CAB pack from the evidence.
  - The record covers description, risk, impact, tests, implementation, backout and schedule.
- Accept:
  - Every field links to evidence or is marked as needing input.

**E-060 Backout plan verification** [BUILD, M]
- Deps: E-013.
- Build:
  - In a scratch worktree, prove that:
    - the revert applies cleanly
    - tests pass after the revert
    - the down migrations work
- Accept:
  - A change whose revert conflicts is reported as not reversible.

**E-061 Environment promotion gate** [BUILD, S]
- Deps: E-048 or E-058.
- Build:
  - The project defines its environments and their promotion commands.
  - A promotion escalates unless the gate passes.
  - Extreme never approves a promotion to an environment marked production.
- Accept:
  - Promoting to production with a failing gate escalates as Severe.

**E-063 Effort and billing log** [BUILD, S]
- Deps: none.
- Build:
  - A per-project log of human active time, agent time and cost, exported as CSV.
  - It stays local and can be deleted.
- Accept:
  - The exported totals for a fixture day are correct.
  - A test proves nothing leaves the machine.

**E-069 AI system register** [BUILD, S]
- Deps: C-016.
- Build: a per-project register recording, for each model used:
  - provider, model and purpose
  - data classification and boundary card
  - first and last use
- Accept:
  - A new model appears in the register with its card.

**E-070 Third-party notices generator** [BUILD, S]
- Deps: D-055.
- Build:
  - Generate a notices file from dependency licences and their notice files.
  - List any notices that are missing.
- Accept:
  - Every fixture dependency is listed with its licence.

**E-068 Data residency evidence** [BUILD, S]
- Deps: C-016, D-094.
- Build:
  - Record the endpoints and regions each session used.
  - Export a statement per project and period.
- Accept:
  - A local-model session shows no remote region.
  - A Claude session shows its region, or "not known".

**E-067 DPIA draft** [BUILD, S]
- Deps: D-051.
- Build:
  - Draft data protection impact assessment sections from the personal data map, marked as a draft for legal review.
- Accept:
  - Every mapped flow appears in the draft.

**E-065 DORA and NIS2 evidence mapping** [BUILD, M]
- Deps: D-003.
- Build:
  - Map audit records, evidence packs, change records and policies to DORA and NIS2 control areas.
  - Produce a draft index that lists the gaps.
- Accept:
  - Each control either links to evidence or is listed as a gap.

**E-066 Retention and legal hold** [BUILD-SAFE, M]
- Deps: none.
- Build safe variant:
  - Retention by project classification for transcripts, evidence packs, exports, logs and traces.
  - A legal hold that suspends deletion.
  - Junction-safe deletion. Audit files are never deleted.
- List for SECURITY and LEGAL: audit retention, which depends on audit anchoring (D-029).
- Accept:
  - An item under legal hold survives past its retention date.
  - An expired pack is deleted and audited.

**E-081 Office files with redaction preview** [BUILD, M]
- Deps: E-086.
- Build:
  - Generate Word, PowerPoint and Excel files from chats, evidence and reports.
  - Use pinned pure JS libraries, with stated reasons and checked licences.
  - Show a redaction preview, apply writing rules and add the AI-generated mark before saving.
- Accept:
  - A fixture report produces a .docx that opens.
  - A redaction term is masked.
  - The mark is present.

**E-085 Formula-first spreadsheets** [BUILD, M]
- Deps: C-059, E-081.
- Build:
  - Spreadsheet outputs use formulas rather than pasted values, checked as section 10 describes.
- Accept:
  - A fixture's totals are formulas that evaluate to the expected values.

**E-082 Meeting notes to backlog** [BUILD, S]
- Deps: D-033.
- Build:
  - From a transcript, extract decisions, actions and stories with criteria into the ledger.
  - Each one links to its source line.
- Accept:
  - Every story links to its line.

**E-083 Evidence-grounded documents** [BUILD, M]
- Deps: D-003.
- Build:
  - In drafts, every claim links to a file, research source or evidence pack.
  - Sentences without a source are highlighted and listed before export.
- Accept:
  - An ungrounded sentence is highlighted and appears in the export list.

**E-084 Sequence diagrams from code paths** [BUILD, M]
- Deps: C-031, C-057.
- Build:
  - From a chosen entry point, follow calls with tree-sitter to a set depth.
  - Render a Mermaid sequence diagram and mark calls that could not be resolved.
- Accept:
  - A fixture route renders with its service and repository calls.

**E-087 Research to decision brief** [BUILD, S]
- Deps: E-086.
- Build:
  - Turn a research chat into a brief covering context, options, risks and a recommendation, citing the chat's sources.
- Accept:
  - Every option cites a source from the sources pane.

**E-092 Signed industry packs** [BUILD-SAFE, M]
- Deps: C-055, D-080.
- Build safe variant:
  - Draft rule, knowledge and checklist packs for:
    - contact centres: payment descoping and call recording redaction
    - telecoms
    - energy: vulnerable customers
    - banking: consumer protection
  - A pack is installable only once signed after the owner's review.
  - Packs can only add rules and checklist items.
- List for LEGAL and subject experts: sign-off of each pack's content.
- Accept:
  - An unsigned pack cannot be installed.
  - A pack that removes a rule is refused.

## 17. Wave E6: learning, collaboration and productivity

Build in this order.

**E-073 Skill growth tracker** [BUILD, S]
- Deps: none.
- Build:
  - A local record of accepts, undos and requests for explanation, by language and topic.
  - It suggests topics to learn. It stays local and can be deleted.
- Accept:
  - Repeated undos in one area surface that area as a suggested topic.

**E-071 Teach-back check** [BUILD, S]
- Deps: none.
- Build:
  - The owner explains a large change in a few lines.
  - A model compares the explanation with the diff and lists the gaps. Use a local model where available.
- Accept:
  - An explanation that misses a changed module lists that module.

**E-072 Tutor mode** [BUILD, M]
- Deps: none. C-022 is optional.
- Build:
  - A session overlay in which the agent can read, run tests and give hints.
  - Agent edits to non-test files are denied.
- Accept:
  - An agent Write to a source file is denied in tutor mode.
  - Hints are still given.

**E-074 Code reading drills** [BUILD, S]
- Deps: D-079.
- Build:
  - Generate questions from tours and the index.
  - The owner answers them in the app, and each answer gets an explanation.
- Accept:
  - Each question links to its code.

**E-075 Onboarding curriculum** [BUILD, M]
- Deps: D-079, D-083.
- Build:
  - A sequenced path of tours, glossary terms, drills and starter tasks per project, with progress.
- Accept:
  - Progress persists.
  - Every step links to its material.

**E-076 Pattern cards** [BUILD, S]
- Deps: C-031.
- Build:
  - Cards showing how this repo handles errors, logging, configuration and tests, with real examples.
  - Used as context for agents and people.
- Accept:
  - Each card links to at least two real examples.

**E-077 Personal handover packs** [BUILD, S]
- Deps: C-054.
- Build:
  - A signed pack across all projects containing:
    - open sessions
    - pending decisions
    - grants about to expire
    - routines
    - a written summary
- Accept:
  - The pack verifies.
  - A tampered pack is refused.

**E-078 Policy exceptions register** [BUILD, S]
- Deps: C-013.
- Build:
  - A register of every grant and exception, recording who granted it, why, its scope and its expiry.
  - Reminders before expiry, and an export.
- Accept:
  - A grant expiring tomorrow shows a reminder.

**E-079 Reviewer suggestions** [BUILD, S]
- Deps: none.
- Build:
  - Suggest reviewers from the git history of the touched files, weighted by recency.
- Accept:
  - The main author of a fixture file is suggested.

**E-088 Daily plan** [BUILD, S]
- Deps: E-054.
- Build: a morning plan ordered by urgency, built from:
  - open escalations
  - pending reviews
  - Contradicted runs
  - grants about to expire
  - routines
  - the night shift report
- Accept:
  - A Contradicted overnight run appears near the top.

**E-090 Energy and carbon estimate** [BUILD, S]
- Deps: none.
- Build:
  - Estimate local energy from job-object CPU time and a configurable device power figure.
  - Model energy comes only from figures the owner enters, otherwise it shows "not known".
  - Everything is labelled as an estimate.
- Accept:
  - A fixture CPU time gives the expected estimate.
  - Model energy shows "not known" by default.

**E-091 Screen-share safe mode** [BUILD, M]
- Deps: none.
- Build:
  - A shortcut and tray mode that:
    - masks redaction terms on screen
    - hides chosen transcripts
    - holds non-urgent notices
    - hides pairing codes and push topics
  - The C# shell sets SetWindowDisplayAffinity with WDA_EXCLUDEFROMCAPTURE on the quick prompt and pop-out windows.
- Accept:
  - A redaction term is masked in the transcript view.
  - A test through the helper proves the overlay has capture exclusion set.

**E-098 Upgrade rehearsal** [BUILD, M]
- Deps: E-100.
- Build:
  - Before switching to a downloaded release, start it against a synthetic data folder, as section 10 says.
  - Run its canaries, load the policy and simulate a session restore.
  - On failure, keep the current version and explain why.
- Accept:
  - A staged release whose policy fails to load is not switched to.
  - A test proves the real data folder is untouched.

## 18. Final report

When every item is resolved, write docs/reports/expansion-build-YYYY-MM-DD.md. It must contain:

1. What was built in each wave, with test and break-check counts and BUILD_REPORT phase references.
2. The safe variants built, and what remains for decision.
3. Every listed item, with the decision needed, who decides and the invariant affected.
4. Every owner-delegated stricter decision, for confirmation.
5. Blocked and deferred items, with reasons.
6. Gate and release results per wave.
7. Flaky files and memory incidents.
8. Real runs still owed: databases, Podman, gateway, local models, NVDA and the phone.
9. The owner's to-do list, in priority order.

Write the report in plain UK English, with no em dashes or en dashes.

## 19. Carrying on

If this session runs under Codehouse Extreme approval, keep going wave by wave.

End a reply with the line QUEUE EMPTY only when both are true:
- every item in docs/plan/expansion-status.md is built, built safe variant, listed for decision, blocked or deferred
- the final report is written