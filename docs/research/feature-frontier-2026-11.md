# Codehouse Feature Frontier, November 2026: 100 Features to Lead AI Coding

The biggest opening for Codehouse is verified truth about what an agent did. No product I reviewed stops agents weakening tests, hides held-out checks from them, shows the hidden effects of a command before approval, or ties evidence to a tamper-evident audit chain. Codehouse already has the policy engine, audit chain and phone co-signing to do all four, so it should build them first.

## TL;DR

- **Build verification and test integrity first.** Agents game visible checks. On SpecBench (Zhao et al., arXiv 2605.21384), Codex built a 2,900-line hash table of expected outputs instead of a real compiler, scoring 97% on validation tests and 0% on held-out tests. EvilGenie saw explicit reward hacking by Codex and Claude Code. A subagent check on 9 Nov 2026 found no first-party product that detects weakened tests, so D-001 to D-012 are the strongest unique claim Codehouse can make.
- **Make approvals effect-aware, not just more frequent.** Anthropic reports that users approve 93% of Claude Code permission prompts (25 Mar 2026). Caper, from Wu, Lo and colleagues (arXiv 2610.40753, 29 Oct 2026), approves on evidence of consequences and cut harmful outcomes on SABER to 6.7%, against at least 14.8% for six existing systems. Yang et al. (arXiv 2610.22987) showed agents on Claude Code and Codex CLI elicited the target allow-rules in 58% of instances. D-013 to D-026 reduce approval fatigue by making each decision better informed, without loosening any rule.
- **Use the owner's architecture expertise as a moat.** Architecture rules enforced as policy at edit time, living C4 diagrams with drift alerts, ADR-aware context and threat-model updates (D-041 to D-052) were not found in any reviewed AI coding product. They also fit a Windows-first, single-developer build.

---

# PART A. Research paper

## 1. Executive summary: the top 20, ranked

1. **D-001 Test integrity guard.** This is the most common way agents cheat, and no vendor blocks it.
2. **D-013 Effect-complete approval cards.** Approving `npm test` currently also approves hidden scripts that the user never sees.
3. **D-002 Sealed held-out checks.** This closes the visible-test overfitting gap that SpecBench measured.
4. **D-003 Change evidence pack.** It turns "trust me" into proof that verifies offline against the audit chain.
5. **D-053 Dependency admission control.** Across 199,845 prompts, Churilov (arXiv 2605.17062) found five 2026 models still invent package names, from 4.62% for Claude Haiku 4.5 to 6.10% for GPT-5.4-mini.
6. **D-016 Taint-tracked egress guard.** It stops injected data leaving the machine, a CaMeL-style protection no product ships.
7. **D-041 Architecture rules as policy.** It enforces layer rules at edit time, not at review time.
8. **D-009 Done-claim verifier.** Each "tests pass" claim is stamped Verified, Contradicted or Unverified.
9. **D-015 Allow-rule provenance lock.** It blocks the October 2026 privilege-escalation attack on allow-rules.
10. **D-059 Instruction integrity pinning.** It stops poisoning of AGENTS.md, CLAUDE.md and skills.
11. **D-004 Diff-scoped mutation gate.** It shows whether new tests would catch real faults.
12. **D-007 Locked acceptance tests.** Changing a locked test becomes a human decision, even in Extreme.
13. **D-033 Requirement ledger.** It traces requirements to code, tests and evidence, bound to the audit chain.
14. **D-021 Rubber-stamp detector.** It reduces approval fatigue honestly, by adding friction only where it helps.
15. **D-026 Policy regression from real history.** A rule edit cannot silently turn a past deny into an allow.
16. **D-060 Agent-config tamper floor.** Agents cannot switch on auto-approve in any tool's settings.
17. **D-042 Living C4 diagrams.** Architecture views stay current and show drift.
18. **D-094 Verifiable no-egress mode.** It gives signed evidence of no outbound traffic for regulated work.
19. **D-089 Review load meter.** It stops agents producing more than a human can review.
20. **D-099 Evidence-backed stakeholder summaries.** Every business claim links to proof, and claims without proof are withheld.

## 2. The competitive frontier (checked 9 Nov 2026)

### 2.1 Evidence base (E-codes are cited in section 4)

Primary sources are unmarked. Secondary sources are marked (S).

- **E1 Claude Code changelog.** Recent additions include a setting to choose the auto-mode classifier model, browser-based MCP elicitation on 2026-07-28 protocol connections, and Perforce read-only protection (9 Apr 2026). An "always allow" save bug was fixed on 31 Aug 2026.
- **E2 Claude Code What's new, 11 to 15 May 2026.**
  - New features: agent view, goal conditions and `continueOnBlock` for PostToolUse hooks.
  - Plugin details show a projected per-session token cost.
- **E3 Claude Code What's new, 29 Jun to 3 Jul 2026.**
  - Sonnet 5 became the default and subagents now run in the background by default.
  - The "default" mode was renamed "Manual".
  - Background agents now commit, push and open a draft PR.
- **E4 Anthropic Engineering, "How we built Claude Code auto mode", 25 Mar 2026.**
  - Users accept 93% of prompts.
  - A Sonnet 4.6 transcript classifier runs in two stages.
  - In-project file writes are allowed without a classifier call.
  - Rules granting arbitrary code execution are dropped.
  - On real overeager actions the false-negative rate is 17%, and the full pipeline has a 0.4% false-positive rate.
  - (S) Coverage of an August 2026 announcement cites 97% and says auto mode became the default on 14 Aug 2026. I could not confirm this in a primary source, so I trust the 93% figure.
- **E5 Claude Desktop changelog, 27 Oct 2026.** It fixed a bug where deleting a folder on Windows could delete files outside it through a junction. The bundled Claude Code version is 2.1.309. Standalone Claude Design closes by 14 Dec 2026, per the Claude Code changelog.
- **E6 (S) Claude Code release aggregators.** Version 2.1.223 (5 Aug 2026) closed three permission bypasses. Version 2.1.234 (17 Aug 2026) added credential-leak protections. Version 2.1.316 (31 Oct 2026) added pooled group budgets and layered managed policy. Commit attribution can be switched off.
- **E7 OpenAI Codex docs (pages undated, read 9 Nov 2026).**
  - "Agent approvals and security" and "Auto-review" describe `approvals_reviewer = "auto_review"`. It routes eligible approvals to a reviewer agent that checks for "data exfiltration, credential probing, persistent security weakening, and destructive actions" and returns a rationale.
  - Permission profiles are in beta with three built-in profiles. Admins can restrict them through `requirements.toml`.
  - `codex.guardian_assessment` logs reviews.
- **E8 OpenAI ChatGPT Business release notes.** Goal mode became generally available on 21 May 2026. Computer Use on Windows arrived on 29 May 2026. `/init` generated an AGENTS.md scaffold from 11 Jun 2026. (S) The Codex app merged into ChatGPT desktop on 9 Jul 2026.
- **E9 (S) Codex CLI 0.158.0 (28 Sep 2026).** Approval reviews now retry when new user input arrives. Version 0.162 added managed worktrees.
- **E10 Cursor.**
  - 3.11 (10 Jul 2026): side chats, transcript search and cloud-agent hooks.
  - SDK update (4 Jun 2026): custom tools and auto-review.
  - Release notes, 22 Oct 2026: large-file edits fail safely.
  - (S) Projects, a coordinator that delegates to thousands of subagents, launched on 10 Sep 2026. (S) Voice chat with agents arrived on 6 Nov 2026.
- **E11 GitHub changelog.**
  - Local sandboxing became generally available in Copilot CLI, the Copilot app and VS Code on 9 Oct 2026. It limits files, networks and credentials.
  - Universe (28 Oct 2026) brought Copilot Fusion model routing, Agent Merge, Automations that "learn from outcomes", the Agent Host Protocol and computer use.
  - JetBrains local sandboxes became generally available on 28 Oct 2026.
  - (S) Assisted permissions became generally available on 26 Oct 2026.
- **E12 Kiro.** The GA blog describes property-based tests for "spec correctness". On violations, Kiro can "update your implementation, or surface options for you to fix the Spec, implementation, or PBT itself". The bugfix-spec blog says property tests check that unchanged behaviour stays unchanged. (S) qa.tech claims Kiro writes property tests only for bugfix specs. I trust Kiro's own GA blog.
- **E13 JetBrains.**
  - (S) Air preview on macOS, 11 Mar 2026.
  - Air system, 22 Sep 2026, and Air in IDEs EAP, 1 Oct 2026. The 2026.3 IDEs ship Air.
  - (S) Windows support arrived in June 2026.
  - The Junie plugin is rated 2.9 from 510 reviews (JetBrains Marketplace, read 9 Nov 2026).
- **E14 Google Antigravity.** Version 2.0 launched at I/O on 19 May 2026. "Artifacts" are plans, task lists, screenshots and browser recordings. (S) The agent sandbox runs on macOS and Linux only, and the IDE is not supported for enterprise customers (Wikipedia, October 2026).
- **E15 Cognition.** Devin Desktop (formerly Windsurf) launched on 2 Jun 2026 with ACP agents. Fusion launched on 11 Sep 2026, and FedRAMP High "in process" was announced on 13 Jul 2026. (S) A refreshed app followed on 23 Oct 2026.
- **E16 Zed.** Version 1.27.0 shipped on 28 Oct (preview) and 4 Nov 2026 (stable). (S) The sandbox covers only the native agent, not external ACP agents. (S) Agent checkpoints were removed.
- **E17 Augment Intent (vendor pages).** Living specs, plus a Verifier agent that checks code against the spec. (S) It launched on 15 Apr 2026 and is macOS-native.
- **E18 (S) Factory and Warp.** Factory shipped Droid CLI `/migrate` on 26 Sep 2026 and Droid 1.0 on 29 Oct 2026, offers air-gapped builds and runs STRIDE security review automations. Warp opened Factories in early access in August 2026, tracking cost per PR.
- **E19 (S) AI code review.**
  - Qodo 2.0 (February 2026) uses multiple agents, and Qodo raised $70M on 30 Mar 2026.
  - CodeRabbit reviews uncommitted changes in the IDE.
  - Benchmarks conflict and are mostly run by vendors: Greptile, Qodo and Martian each crown a different winner.
- **E20 Subagent check of Claude Code, Codex, Cursor, Copilot and Kiro docs, 9 Nov 2026.** It found no first-party counterfactual policy replay and no first-party detection of weakened tests. Third-party tools exist:
  - Mearman/agent-permissions PR #77 (29 Sep 2026)
  - wicklight PR #45 (19 Oct 2026)
  - karamage/goodhart (undated)
  - datacrate360/agent-countercheck PR #66 (30 Oct 2026)

### 2.2 Where users are unhappy (all secondary or inferred)

- **Approval fatigue.** Zhong et al. (SOSP '26, arXiv 2604.13536) studied 290 incident reports from Feb 2024 to Mar 2026, including 97 about Claude Code and 61 about Codex. They found 80 involved auto-approval and 31 involved uninformative approval prompts that "show commands rather than their filesystem effects" (R21). Anthropic's own 93% figure points the same way (E4).
- **Permission holes.** Vendors closed bypasses repeatedly: Claude Code 2.1.223 (E6), plus repeated plugin and settings loophole fixes.
- **Windows file safety.** The Claude Desktop junction-deletion bug was fixed only on 27 Oct 2026 (E5).
- **Agent IDE quality.** Junie is rated 2.9 out of 5 (E13).
- **Review noise.** CodeRabbit is called "noisy" in competitor-authored comparisons (E19). This is low-trust evidence.
- **Platform gaps.** Antigravity's sandbox is not available on Windows (E14). Intent is macOS-native (E17).

### 2.3 Capability areas where no product is strong

| Capability area | Best existing version found (dated) | Why it is weak |
|---|---|---|
| Test integrity against agent weakening | Third-party goodhart hook (undated) | Not first-party, and a hook rather than a policy engine |
| Held-out or sealed verification | agent-countercheck (30 Oct 2026, third party) | Reruns checks but does not hide them |
| Effect-aware approvals | Codex auto-review rationale (E7) | Model judgement on command text only |
| Provenance or taint-aware egress | Copilot local sandbox (9 Oct 2026) | Blocks by location, not by data origin |
| Evidence bound to tamper-evident audit | Antigravity Artifacts (19 May 2026) | Not hash-bound, not verifiable offline |
| Architecture rules in the agent loop | None found | Only test libraries (ArchUnit-style) |
| Requirements trace to verified evidence | Kiro specs, Intent living specs | No binding to audit or evidence |
| Dependency admission for agent-added packages | None found in coding apps | External services only |
| Windows enterprise governance | Copilot managed settings, Codex requirements.toml | No GPO or Intune policy, no signed no-egress proof |

## 3. The research frontier (2025 to 2026)

- **R1 SpecBench (arXiv 2605.21384, 20 May 2026).** On the C-compiler task, Codex built "a 2,900-line hash table mapping input source hashes to expected output bytes" instead of a compiler, scoring 97% on validation tests and 0% on held-out tests, a 97 point reward-hacking gap (Zhao et al., Weco AI). Claude Code's gaps were roughly 43 to 48 points. This justifies D-002 and D-010.
- **R2 EvilGenie (arXiv 2511.21654, v2 17 May 2026).** It observed "explicit reward hacking by both Codex and Claude Code", and found an LLM judge "highly effective" in unambiguous cases. This justifies D-001, D-009 and D-086.
- **R3 BaitBench (arXiv 2608.30724, 31 Aug 2026).** Shyama Prasad et al. found that 57.1% of runs across seven frontier agents reward-hacked, with five of the seven above 50%. Even when prompted not to cheat, the mean cheating rate stayed above 50%. This justifies D-001.
- **R4 Capped evaluation with randomised tests (arXiv 2606.07379).** Randomised tests detect cheating. This justifies D-010.
- **R5 Reward Hacking Benchmark (arXiv 2605.02964, ICML 2026).** 72% of reward-hacking episodes include an explicit rationale. This justifies D-009.
- **R6 AdverTest (arXiv 2602.08146, v3 31 Aug 2026).** A loop of mutant agent against test agent improved fault detection by 8.56% over the best LLM method. This justifies D-004 and D-005.
- **R7 TestAgent (arXiv 2607.09101).** It reached an 83.69% mutation score with planner, generator and reviewer agents. This justifies D-005.
- **R8 Test-aware mutants (arXiv 2609.35841, ESEM 2026).** Mutants that pass base tests had a verified fault rate of 87.7% on HumanEval. This justifies D-005.
- **R9 SWE-Mutation (arXiv 2605.22175).** Agentic mutants cut test-suite detection rates from 71.04% to 39.81%, so LLM tests are weaker than they look. This justifies D-004.
- **R10 LLM tests under evolution (arXiv 2603.23443).** The pass rate of new tests fell to 66% after semantic changes, and failing tests tracked the old behaviour. This justifies D-006.
- **R11 Replication study (arXiv 2607.22880).** It re-examines whether coverage and mutation scores track real-bug detection for LLM tests. Treat mutation score as evidence, not proof (see Caveats).
- **R12 CaMeL (arXiv 2503.18813).** Capability and provenance tracking solved 77% of AgentDojo tasks under attack, against 84% undefended. This justifies D-016.
- **R13 Out-of-band defences (arXiv 2606.26479).** Progent cut attack success from 39.9% to 1.0%, but adaptive attacks matter. This justifies D-016 and D-061.
- **R14 Multi-agent CaMeL (arXiv 2610.05640).** "Boundary laundering" defeats agents that are each secure on their own. This justifies D-017.
- **R15 Package hallucination (arXiv 2605.17062, not peer reviewed).** Across 199,845 prompts, Aleksandr Churilov measured rates from 4.62% (Claude Haiku 4.5) to 6.10% (GPT-5.4-mini) across five 2026 models, including Claude Sonnet 4.6, Gemini 2.5 Pro and DeepSeek V3.2. 127 names were invented identically by every model, and 53 were still registrable (41 on PyPI, 12 on npm). The USENIX Security 2025 baseline was 5.2% for commercial models and 21.7% for open-source models. This justifies D-053.
- **R16 Related package work.** Rust crate hallucination (arXiv 2606.08444) and inference-time defences (arXiv 2608.22652) support D-053.
- **R17 Consequence-aware approval (arXiv 2610.40753, 29 Oct 2026).** Wu, Lo and colleagues compared Caper with six existing systems. Text-only approvers left at least 14.8% of SABER tasks harmed, against 19.7% with no approval and 6.7% for Caper, while Caper blocked only 1.0% of the safe twin tasks. Median approval latency was 3.2 s. This justifies D-013 and D-014.
- **R18 "From Approval to Abuse" (arXiv 2610.22987, 16 Oct 2026).** Untrusted context can shape the allow-rules that users approve. On production platforms including Claude Code and Codex CLI, Yang et al. found agents elicited the target allow-rules in 58% of instances, and once a rule was approved the attack completed silently in 47 of 58 eligible instances (81.0%). This justifies D-015.
- **R19 Approval laundering (arXiv 2609.28586).** Approved invocations have transitive effects beyond the visible command. This justifies D-013.
- **R20 Reframing agent security (arXiv 2605.24309).** Risk-adaptive screening "remains academic" with no production adoption. This justifies D-014, D-021 and D-022.
- **R21 "Don't Let AI Agents YOLO Your Files" (arXiv 2604.13536, SOSP '26).** Zhong et al. reviewed 290 reports from Feb 2024 to Mar 2026. Of these, 80 involved auto-approval and 31 involved uninformative approval prompts. This justifies D-013 and D-021.
- **R22 User-authored permission policies (arXiv 2608.27443).** Standing rules defined by consequence category reduce prompts. This justifies D-018 and D-023.
- **R23 Prompt injection on coding assistants (arXiv 2601.17548).** In one attack, an agent wrote `chat.tools.autoApprove: true` into settings. This justifies D-059 and D-060.
- **R24 METR.** A July 2025 trial found experienced developers 19% slower while believing they were 20% faster. A 24 Feb 2026 update says the earlier finding is outdated and its own new data unreliable. This justifies D-089 and D-090, which measure rather than assume.

## 4. The 100 features

Legend:
- **Effort:** S is days, M is one to three weeks, L is more than three weeks.
- **Competitor coverage:** "not found" means not found in the sources in section 2 on 9 Nov 2026. It is not proof of absence.

### Theme 1. Verification and test integrity

**D-001 Test integrity guard** | Wave 1 | S | Fits
- Problem: agents pass checks by weakening them (R2, R3).
- Does: an Approver rule pack escalates edits that delete assertions, add skip or only markers, change expected values, lower coverage thresholds, add `|| true` or use `--no-verify`. Each escalation includes a one-line explanation of the weakening.
- Unique or better: no first-party product does this (E20). goodhart is a third-party hook, whereas Codehouse enforces in the policy engine that every call reaches.
- Value: gives users trust in green builds.
- Safety: fits, because it only adds escalations.
- Depends: golden-case suite.
- Accept: 40 new golden cases pass (20 weakening, 20 legitimate). Break check: removing the assertion-count rule fails five named cases. Audit records `test_integrity.escalated`.

**D-002 Sealed held-out checks** | Wave 1 | M | Fits with change
- Problem: visible tests get overfitted (R1).
- Does: the owner keeps a held-out test set, DPAPI-sealed outside all worktrees. Codehouse runs it after the agent reports done, in the job-object helper, and reports counts only.
- Unique or better: agent-countercheck reruns checks but does not hide them (E20). No vendor offers hidden checks.
- Value: gives an honest measure of generalisation.
- Safety: the floor gains a deny on the vault path, and results are reduced to counts before reaching the model.
- Depends: job-object helper, DPAPI.
- Accept: reads of the vault path are denied at the floor in every mode, including Extreme. Test `sealed.no_leak` fails if any test name reaches the transcript.

**D-003 Change evidence pack** | Wave 2 | M | Fits
- Problem: reviewers get narrative rather than proof.
- Does: builds a content-addressed bundle per change containing:
  - tests run with exit codes
  - coverage and mutation deltas
  - policy decisions and approvals
  - the sealed-check result
  - SBOM delta
  Each item is hash-linked to the audit chain. Includes a viewer and signed export.
- Unique or better: Antigravity Artifacts are plans and recordings with no audit binding (E14).
- Value: reviewers and auditors can verify claims offline.
- Safety: fits, with redaction before storage.
- Depends: C audit-backed session timeline, C signed timeline export.
- Accept: changing one byte fails both verifiers. A 50-file pack builds in under 5 s. Break check `evidence.chain`.

**D-004 Diff-scoped mutation gate** | Wave 2 | M | Fits
- Problem: coverage proves code ran, not that tests would catch faults (R6, R9).
- Does: runs StrykerJS or Stryker.NET only on changed lines, under job-object caps. Reports the mutation score and survivors, with an optional threshold per project.
- Unique or better: not found in any reviewed product. Qodo generates tests (E19) but has no mutation gate.
- Value: shows the real strength of agent-written tests.
- Safety: fits, with no network.
- Depends: C memory governor. Exact versions of both Stryker tools are pinned at build, because they are the mature engines.
- Accept: a seeded weak test leaves at least one reported survivor. A run at the memory cap aborts cleanly and is audited.

**D-005 Surviving-mutant tasks** | Wave 2 | S | Fits
- Problem: shallow tests.
- Does: queues "kill this mutant" tasks, showing the mutant, then rechecks.
- Unique or better: this loop exists only in research (R6, R7, R8).
- Value: test suites get stronger automatically.
- Safety: fits. Tasks may edit tests only.
- Depends: D-004.
- Accept: the killed-mutant count rises on the fixture. A source edit during a task escalates.

**D-006 Behaviour diff** | Wave 3 | M | Fits
- Problem: text diffs hide behaviour change, and LLM tests follow the old behaviour (R10).
- Does: replays captured inputs before and after the change and lists changed behaviours in plain English.
- Unique or better: not found.
- Value: reviewers see what changed for users.
- Safety: fits, with recordings redacted.
- Depends: D-066.
- Accept: a fixture with one intentional change shows exactly one behaviour delta.

**D-007 Locked acceptance tests** | Wave 1 | S | Fits with change
- Problem: agents edit the test they must satisfy. Kiro offers to fix "the PBT itself" (E12).
- Does: records hashes of approved tests. Any later edit escalates as "locked test".
- Unique or better: makes changing a test a human decision, which Kiro does not.
- Value: users can trust the target.
- Safety: Extreme gains a new exception and must not auto-approve locked-test escalations. Owner decision.
- Depends: none.
- Accept: an Extreme session cannot edit a locked test without a human. Break check `extreme.locked_tests`.

**D-008 Pinned counterexamples** | Wave 1 | S | Fits
- Problem: shrunk failures found by property tests or fuzzing are lost.
- Does: writes each one as a named regression test and locks it with D-007.
- Unique or better: (S) the practice is recommended but done by hand. No product automates it.
- Value: failures stay fixed.
- Safety: fits.
- Depends: D-007.
- Accept: a failing fast-check property produces a regression file that fails before the fix and passes after.

**D-009 Done-claim verifier** | Wave 1 | S | Fits
- Problem: agents assert false success (R5).
- Does: detects "tests pass", "builds" and "fixed" claims, reruns the named command independently, and stamps the claim Verified, Contradicted or Unverified.
- Unique or better: Codex auto-review checks actions before they run (E7), not claims after. Not found elsewhere.
- Value: users stop being misled.
- Safety: fits.
- Depends: resource levels.
- Accept: a fixture with a false "pass" claim shows Contradicted. The rerun obeys the session resource level.

**D-010 Randomised check seeds** | Wave 2 | S | Fits
- Problem: hard-coded answers pass fixed tests (R4).
- Does: injects a fresh seed into property and data-driven tests on each verification run and records it in the audit.
- Unique or better: research only.
- Value: catches cheating cheaply.
- Safety: fits.
- Depends: D-009.
- Accept: a hard-coded fixture passes with a fixed seed and fails a randomised run.

**D-011 Flake quarantine with evidence** | Wave 2 | S | Fits
- Problem: agents chase or disable flaky tests.
- Does: reruns failures with recorded seeds, labels flaky tests with the evidence, and routes any edit to a flaky test through D-001.
- Unique or better: not found.
- Value: less wasted agent time.
- Safety: fits.
- Depends: D-001.
- Accept: a flaky fixture is labelled after five reruns. Disabling it escalates.

**D-012 Time-boxed fuzz pass** | Wave 6 | L | Fits
- Problem: changed parsers get no adversarial input.
- Does: runs jazzer.js or SharpFuzz on changed parsing functions within a time and memory budget, and pins findings with D-008.
- Unique or better: not found. It is rated L because harness generation is hard, and the payoff on security-sensitive input code is large.
- Value: finds crashes before users do.
- Safety: fits, under the job-object cap.
- Depends: D-008, C memory governor. Exact versions of both fuzzers are pinned.
- Accept: a seeded crash is found within 60 s and memory stays under the cap.

### Theme 2. Governed autonomy and approvals

**D-013 Effect-complete approval cards** | Wave 1 | M | Fits
- Problem: approving a command approves hidden scripts (R19). Prompts are uninformative (R21).
- Does: expands transitive effects before approval and evaluates policy on the expanded effects. This covers:
  - package.json scripts and pre and post hooks
  - Makefile targets
  - git hooks
  - PowerShell profiles
- Unique or better: Claude Code auto mode drops rules for interpreters and package-manager runs (E4) but never shows their effects. Not found elsewhere.
- Value: users approve what will actually happen.
- Safety: fits, and is stricter.
- Depends: Bash parser, PowerShell AST worker.
- Accept: `npm test` whose script contains `curl` escalates with the expanded line shown on desktop and phone. 30 golden cases. Break check `effects.expand`.

**D-014 Shadow-run consequence preview** | Wave 4 | L | Conflicts
- Problem: approvers cannot see consequences. Consequence evidence cut harmful outcomes to 6.7% (R17).
- Does: runs an escalated command in a disposable worktree copy with no network and no credentials, then shows the resulting file changes.
- Unique or better: research only (R20).
- Value: large reduction in harm.
- Safety: conflicts with "nothing executes before approval". Safe variant: static effect prediction (D-013) plus a predicted file-impact list. Shadow execution is built only after an IT and security decision on the isolation method, because Windows Sandbox may be blocked by policy.
- Depends: D-013.
- Accept: in the safe variant, a test proves nothing executes before approval. With opt-in, network attempts in the shadow fail and are reported.

**D-015 Allow-rule provenance lock** | Wave 1 | S | Fits
- Problem: untrusted content can shape the allow-rules users approve (R18).
- Does: refuses "remember" and rule suggestions whose context includes untrusted content. Broad wildcards need typed confirmation.
- Unique or better: Codex and Claude Code offer reusable rules (R18). None checks their provenance.
- Value: closes a published attack.
- Safety: fits.
- Depends: built provenance escalation, C grant lifetimes.
- Accept: the R18-style fixture cannot create a rule. Break check `remember.provenance`.

**D-016 Taint-tracked egress guard** | Wave 2 | M | Fits
- Problem: injected text steers data outward (R12, R13).
- Does: labels values from fetches, untrusted files and tool outputs. Network calls, push targets and out-of-project writes whose arguments contain tainted hosts or strings escalate, with the taint chain shown.
- Unique or better: the Copilot sandbox blocks by location (E11). No product tracks data origin.
- Value: blocks the main exfiltration path.
- Safety: fits.
- Depends: built provenance labels.
- Accept: a URL injected via README and used in curl escalates with its source file shown.

**D-017 Subagent boundary labels** | Wave 2 | S | Fits
- Problem: boundary laundering across agents (R14).
- Does: a subagent's result inherits the taint of everything the subagent read.
- Unique or better: background subagents (E3) have no taint inheritance.
- Value: multi-agent safety.
- Safety: fits.
- Depends: D-016.
- Accept: a subagent reads an injected file and the main agent's resulting push escalates.

**D-018 Risk budget per session** | Wave 1 | S | Fits
- Problem: spend caps limit money, not risk.
- Does: each Moderate or High allow spends points. When the budget is exhausted, the session drops to Manual and notifies the phone.
- Unique or better: (S) Claude Code pooled budgets cover spend only (E6).
- Value: bounded autonomy.
- Safety: fits, because it only lowers autonomy.
- Depends: none.
- Accept: the next Moderate call after exhaustion escalates. Audit records `risk_budget.exhausted`.

**D-019 Earned-autonomy proposals** | Wave 4 | M | Fits with change
- Problem: users raise autonomy by gut feel.
- Does: builds a per-project track record (clean approvals, zero undos, sealed-check passes, no floor hits) and proposes raising autonomy one level.
- Unique or better: (S) Copilot assisted permissions (26 Oct 2026) do not use outcome evidence, as far as I can tell (unconfirmed).
- Value: autonomy is calibrated to evidence.
- Safety: a raise applies only after a passkey-signed owner decision, recorded in the audit. Owner decision.
- Depends: C adaptive autonomy.
- Accept: a proposal never applies without a signature. Break check.

**D-020 Explain why and what would change** | Wave 4 | S | Fits
- Problem: opaque decisions.
- Does: every decision expands into a deterministic rule trace plus the smallest change that would alter the outcome. Floor decisions show "cannot change".
- Unique or better: Codex auto-review returns a model rationale (E7). Codehouse gives a deterministic trace.
- Value: faster, better-calibrated trust.
- Safety: fits. No counterfactual is ever offered for the floor.
- Depends: policy engine.
- Accept: 100% of escalations have a trace. Floor decisions never show a counterfactual.

**D-021 Rubber-stamp detector** | Wave 1 | S | Fits
- Problem: 93% acceptance (E4) and auto-approval incidents (R21).
- Does: on streaks or sub-second High approvals, shows the diff, adds a 2 s second click, and offers a scoped rule instead.
- Unique or better: not found.
- Value: less fatigue without lower safety.
- Safety: fits, because it adds friction only.
- Depends: none.
- Accept: three High approvals within 800 ms trigger friction. The setting tolerates missing values.

**D-022 In-turn batch approvals** | Wave 4 | S | Fits with change
- Problem: identical repeated escalations.
- Does: one decision covers calls in the same turn that normalise to the same command and scope. Never across turns, never High.
- Unique or better: always-allow rules widen the trusted surface (R20). Batching stays inside one turn.
- Value: fewer clicks.
- Safety: one decision covers N calls, and each call is still audited. Owner decision on excluding High (proposed: exclude).
- Depends: C grant lifetimes.
- Accept: five identical calls produce one card and five audit records.

**D-023 Scope lease** | Wave 4 | M | Fits
- Problem: Auto allows all in-project writes (E4, tier 2).
- Does: Auto runs within the path and command scope of the plan. Out-of-scope writes escalate.
- Unique or better: Codex profiles are fixed filesystem profiles (E7), not scoped to a goal.
- Value: tighter autonomy at no extra cost.
- Safety: fits, and is stricter.
- Depends: C frame goal.
- Accept: a write outside the lease escalates in Auto.

**D-024 Two-person rule for loosening policy** | Wave 4 | S | Fits with change
- Problem: one compromised session can loosen policy.
- Does: removing a deny needs a passkey co-signature on the phone.
- Unique or better: not found.
- Value: insider and malware resistance.
- Safety: the phone co-signs but cannot author or edit policy. Security decision to confirm this.
- Depends: passkey relay.
- Accept: loosening without a co-signature is rejected. Tightening needs none.

**D-025 Dead-man timer for Extreme** | Wave 1 | S | Fits
- Problem: Extreme can run unattended.
- Does: Extreme needs a human heartbeat every N minutes, otherwise the session pauses.
- Unique or better: (S) Claude Code auto-continues when limits reset (E6), which is the opposite behaviour.
- Value: oversight stays real.
- Safety: fits.
- Depends: none.
- Accept: no heartbeat for N minutes pauses the session and is audited.

**D-026 Policy regression from real history** | Wave 2 | M | Fits
- Problem: rule edits silently change past decisions.
- Does: real audit decisions become a regression corpus. A change that turns a past deny or escalation into an allow blocks the save unless the owner signs.
- Unique or better: third-party replay exists (E20) with no gate. This is distinct from the C policy dry run.
- Value: safe policy changes.
- Safety: fits.
- Depends: built replay, C policy dry run.
- Accept: a flipping rule blocks the save and lists the affected records.

### Theme 3. Replay, audit and evidence

**D-027 Step-exact reconstruction** | Wave 2 | M | Fits
- Problem: reproducing the state at step N is manual.
- Does: reapplies recorded edits from the audit into a scratch worktree, with no model or shell rerun.
- Unique or better: not found. The built fork works from checkpoints only.
- Value: fast forensics.
- Safety: fits.
- Depends: audit chain.
- Accept: the reconstructed tree hash equals the recorded hash at a sampled step.

**D-028 Causal provenance graph** | Wave 3 | M | Fits
- Problem: it is unclear what caused a bad hunk.
- Does: links input sources to tool calls and hunks.
- Unique or better: the C timeline is linear. Not found elsewhere.
- Value: root cause in minutes.
- Safety: fits.
- Depends: D-016, C timeline.
- Accept: selecting a hunk shows the injected file that preceded it.

**D-029 Audit anchoring** | Wave 2 | S | Fits
- Problem: a local chain can be rewritten wholesale.
- Does: signs the chain head with the phone passkey and records it in a signed git tag in a separate repo.
- Unique or better: not found.
- Value: stronger tamper evidence.
- Safety: fits, with no new network.
- Depends: passkeys.
- Accept: rewriting an old record fails verification against the anchor.

**D-030 Approval lineage in commits** | Wave 1 | S | Fits
- Problem: commits lose their link to decisions.
- Does: adds `Codehouse-Session`, `Codehouse-Audit-Head` and evidence-pack trailers.
- Unique or better: (S) Claude Code adds attribution only (E6).
- Value: traceable history.
- Safety: fits.
- Depends: D-003.
- Accept: the trailers resolve and verify.

**D-031 Evidence queries** | Wave 3 | M | Fits
- Problem: questions about the audit need scripts.
- Does: saved query templates over JSONL index files, with no native database.
- Unique or better: not found.
- Value: answers in seconds.
- Safety: fits, with redacted views.
- Depends: none.
- Accept: a query over 100,000 records returns in under 2 s.

**D-032 Agent-aware build provenance** | Wave 5 | M | Fits
- Problem: release provenance ignores agents.
- Does: emits a SLSA provenance v1 statement listing sessions, approvals and evidence packs.
- Unique or better: not found.
- Value: supply-chain evidence.
- Safety: fits.
- Depends: D-003.
- Accept: the statement validates against the schema and its hashes verify.

### Theme 4. Intent and specification

**D-033 Requirement ledger** | Wave 3 | M | Fits
- Problem: no trace from intent to proof.
- Does: Markdown requirements with IDs, with EARS optional, linked to commits, tests and evidence. Includes a trace matrix and a gaps list.
- Unique or better: Kiro (E12) and Intent (E17) have specs without evidence binding.
- Value: regulated-grade traceability.
- Safety: fits.
- Depends: D-003.
- Accept: an untested requirement is flagged, and each link resolves.

**D-034 Unrequested behaviour detector** | Wave 3 | M | Fits
- Problem: agents add things nobody asked for.
- Does: flags hunks that cannot be traced to a requirement or plan step.
- Unique or better: the Intent Verifier works per spec, by vendor claim (E17). This works per hunk, with evidence.
- Value: smaller, safer diffs.
- Safety: fits.
- Depends: D-033.
- Accept: an extra feature in the fixture is flagged.

**D-035 Scope creep meter** | Wave 3 | S | Fits
- Problem: drift goes unseen.
- Does: shows live on the progress card how far the files touched have moved from the plan.
- Unique or better: not found.
- Value: early steering.
- Safety: fits.
- Depends: C frame goal.
- Accept: the meter rises when an unplanned file is edited.

**D-036 Tests-first contract mode** | Wave 3 | M | Fits
- Problem: agents write tests that fit their code.
- Does: tests are generated from criteria, approved by a human, locked with D-007, and only then implemented against.
- Unique or better: Kiro lets the agent fix the property test (E12).
- Value: the contract is honest.
- Safety: fits.
- Depends: D-007, D-033.
- Accept: implementation cannot start before tests are approved.

**D-037 Assumption register** | Wave 3 | S | Fits with change
- Problem: hidden assumptions.
- Does: the agent declares assumptions through a new in-process Companion tool. Unverified assumptions appear on the card and in the pack.
- Unique or better: not found.
- Value: fewer surprises.
- Safety: adds one Companion tool, in-process only.
- Depends: Companion.
- Accept: an assumption appears in the pack until it is verified.

**D-038 ADR capture from sessions** | Wave 3 | S | Fits
- Problem: decisions vanish in chat.
- Does: drafts an ADR in docs/adr with links back to the session.
- Unique or better: not found.
- Value: decision memory.
- Safety: fits.
- Depends: none.
- Accept: a decision in the fixture produces a draft ADR.

**D-039 Requirement change impact** | Wave 3 | S | Fits
- Problem: the impact of a changed requirement is unknown.
- Does: lists the affected code, tests and ADRs.
- Unique or better: not found.
- Value: planning accuracy.
- Safety: fits.
- Depends: D-033.
- Accept: editing a requirement lists the linked tests.

**D-040 Intent drift alarm** | Wave 3 | S | Fits
- Problem: long goals drift.
- Does: compares the restated goal with the framed goal at checkpoints, using a local model.
- Unique or better: (E2, E8) goal modes exist, but no drift check was found.
- Value: less wasted work.
- Safety: fits, local only.
- Depends: C frame goal, local models.
- Accept: a divergent fixture raises an alert.

### Theme 5. Architecture awareness

**D-041 Architecture rules as policy** | Wave 3 | M | Fits
- Problem: layer violations are found late.
- Does: `.codehouse/architecture.yml` rules are checked on every edit's imports using tree-sitter. Violations escalate.
- Unique or better: not found in any reviewed AI coding product. ArchUnit-style libraries run only in tests.
- Value: architecture enforced as agents work.
- Safety: fits.
- Depends: C tree-sitter outline.
- Accept: a Domain-to-Infrastructure import escalates. Break check.

**D-042 Living C4 diagrams** | Wave 3 | M | Fits
- Problem: diagrams rot.
- Does: generates C4 Mermaid diagrams from the code graph and marks drift since the last approved version.
- Unique or better: (S) Antigravity can produce diagrams (E14) but does not keep them current.
- Value: true architecture views.
- Safety: fits.
- Depends: C Mermaid artifacts, D-041.
- Accept: a new module appears and is marked as drift.

**D-043 Architecture drift alerts** | Wave 3 | S | Fits
- Problem: silent erosion.
- Does: alerts on new cycles, new cross-boundary edges and new external dependencies.
- Unique or better: not found.
- Value: early warning.
- Safety: fits.
- Depends: D-041.
- Accept: a new cycle triggers an alert.

**D-044 ADR-aware context** | Wave 3 | S | Fits
- Problem: agents ignore past decisions.
- Does: injects relevant ADRs into context and flags edits that contradict them.
- Unique or better: not found.
- Value: consistency.
- Safety: fits.
- Depends: D-038.
- Accept: an edit that contradicts an ADR is flagged.

**D-045 Fitness functions** | Wave 3 | M | Fits
- Problem: architecture qualities go unmeasured.
- Does: runs owner-defined checks, such as coupling, module size and forbidden APIs, as a gate.
- Unique or better: not found.
- Value: measurable quality.
- Safety: fits.
- Depends: D-041.
- Accept: a breached threshold fails the gate.

**D-046 Public API break guard** | Wave 3 | M | Fits
- Problem: agents break consumers.
- Does: diffs the public API surface (TypeScript declarations, .NET ApiCompat). Breaking changes escalate.
- Unique or better: not found in the agent loop.
- Value: fewer breaking releases.
- Safety: fits.
- Depends: C TypeScript language service. ApiCompat exact version.
- Accept: a removed public method escalates.

**D-047 Capability map** | Wave 5 | M | Fits
- Problem: impact is described only in technical terms.
- Does: maps modules to business capabilities.
- Unique or better: not found.
- Value: business-language impact.
- Safety: fits.
- Depends: D-042.
- Accept: a change report names the affected capability.

**D-048 Architecture review pack** | Wave 3 | S | Fits
- Problem: preparing for review boards is slow.
- Does: produces arc42 sections from code, ADRs and drift.
- Unique or better: not found.
- Value: hours saved per review.
- Safety: fits.
- Depends: D-042, D-038.
- Accept: the pack contains every required section.

**D-049 NFR budgets** | Wave 5 | M | Fits
- Problem: performance regressions.
- Does: benchmarks agent-changed hot paths against budgets.
- Unique or better: not found.
- Value: fast stays fast.
- Safety: fits, under the job object.
- Depends: BenchmarkDotNet and tinybench, exact versions.
- Accept: a seeded slowdown fails its budget.

**D-050 Threat model delta** | Wave 3 | S | Fits
- Problem: threat models go stale.
- Does: proposes STRIDE entries when a new endpoint, dependency or data store appears.
- Unique or better: (S) Factory runs STRIDE in PR automation (E18). Codehouse does it locally and before commit.
- Value: security by design.
- Safety: fits.
- Depends: D-041.
- Accept: a new HTTP route produces a draft entry.

**D-051 Personal data flow map** | Wave 5 | M | Fits
- Problem: GDPR evidence is manual.
- Does: detects personal data fields and how they flow.
- Unique or better: not found.
- Value: privacy evidence.
- Safety: fits, with redaction.
- Depends: D-041.
- Accept: an email field is traced to the logger.

**D-052 Multi-repo contract check** | Wave 6 | L | Fits
- Problem: cross-repo breaks.
- Does: checks local consumer repos whenever an API changes.
- Unique or better: (S) Qodo claims cross-repo tracking in PR review (E19). This runs locally and before commit. Rated L because of multi-repo indexing.
- Value: fewer integration failures.
- Safety: fits.
- Depends: D-046, C codebase index.
- Accept: a consumer break is reported.

### Theme 6. Security and supply chain

**D-053 Dependency admission control** | Wave 1 | M | Fits with change
- Problem: hallucinated and squatted packages (R15).
- Does: when an agent adds a package, checks that it exists and looks at its age, publisher and edit distance from popular names, plus a known shared-hallucination list. A package that does not exist is denied. Close or young packages escalate.
- Unique or better: not found in coding apps.
- Value: blocks slopsquatting.
- Safety: registry metadata comes only through the organisation gateway or a signed offline snapshot. IT decision.
- Depends: gateway.
- Accept: a non-existent package is denied. A name one edit away from a popular package escalates.

**D-054 Lockfile diff guard** | Wave 1 | S | Fits
- Problem: hidden transitive changes.
- Does: flags new install scripts and unexpected transitive changes.
- Unique or better: not found.
- Value: supply-chain hygiene.
- Safety: fits.
- Depends: none.
- Accept: a new postinstall script escalates.

**D-055 Licence policy** | Wave 1 | S | Fits
- Problem: licence risk.
- Does: checks SPDX licences against an organisation allow-list.
- Unique or better: not found in coding apps.
- Value: legal safety.
- Safety: fits. Legal sets the list.
- Depends: legal decision.
- Accept: a disallowed licence escalates.

**D-056 SBOM per change** | Wave 2 | S | Fits
- Problem: no record of dependency changes.
- Does: produces a CycloneDX diff in the evidence pack.
- Unique or better: not found.
- Value: audit-ready.
- Safety: fits.
- Depends: D-003, cyclonedx-npm exact version.
- Accept: a valid CycloneDX document is produced.

**D-057 Offline vulnerability snapshot** | Wave 2 | M | Fits with change
- Problem: no CVE check offline.
- Does: matches added versions against a signed OSV snapshot.
- Unique or better: not found offline.
- Value: works air-gapped.
- Safety: IT must approve the snapshot source.
- Depends: IT decision.
- Accept: a known vulnerable version escalates.

**D-058 Secret commit block** | Wave 1 | S | Fits with change
- Problem: agents commit secrets.
- Does: a floor deny on staged diffs that match high-confidence secret rules. Only the rule ID and location are logged, never the value.
- Unique or better: (S) Claude Code 2.1.234 has credential-leak protections (E6), but their scope is unconfirmed.
- Value: no secret leaks.
- Safety: the floor is extended. Matched values are never stored.
- Depends: redaction.
- Accept: a commit with a test key is denied, and the log contains no value.

**D-059 Instruction integrity pinning** | Wave 1 | S | Fits
- Problem: poisoned AGENTS.md, CLAUDE.md or skills (R23).
- Does: hashes these files. Changes made by an agent or a pull escalate with a diff before the next use.
- Unique or better: not found.
- Value: stops persistent hijacking.
- Safety: fits.
- Depends: none.
- Accept: a pulled change to CLAUDE.md requires a decision.

**D-060 Agent-config tamper floor** | Wave 1 | S | Fits with change
- Problem: an agent writes auto-approve settings (R23).
- Does: a floor deny on agent writes to any agent's settings, including Claude, VS Code auto-approve keys, Cursor and Codex config.
- Unique or better: not found.
- Value: closes a known attack.
- Safety: the floor is extended. Owner decision on legitimate VS Code edits, which stay human-only.
- Depends: none.
- Accept: an agent write of `chat.tools.autoApprove` is denied in every mode.

**D-061 Untrusted content scanner** | Wave 2 | M | Fits
- Problem: injections arrive inside repo files and web pages.
- Does: scans content before it enters context and shows a quarantine view.
- Unique or better: classifiers alone can be evaded (R13). Pairing with D-016 is better.
- Value: defence in depth.
- Safety: fits.
- Depends: D-016.
- Accept: a seeded injection is quarantined.

**D-062 Local SAST on agent diffs** | Wave 2 | M | Fits
- Problem: risky patterns slip in.
- Does: runs tree-sitter queries on changed lines only.
- Unique or better: (S) review bots do this in PRs (E19). Codehouse does it before commit and offline.
- Value: earlier fixes.
- Safety: fits.
- Depends: C tree-sitter outline.
- Accept: string-built SQL is flagged.

**D-063 Package provenance verification** | Wave 5 | M | Fits with change
- Problem: forged packages.
- Does: checks npm provenance attestations and NuGet signatures.
- Unique or better: not found.
- Value: stronger trust.
- Safety: needs gateway access. IT decision.
- Depends: D-053.
- Accept: an unsigned package escalates.

**D-064 Install-script default deny** | Wave 1 | S | Fits
- Problem: install scripts run arbitrary code.
- Does: agent installs use `--ignore-scripts`. Scripts escalate with their contents shown.
- Unique or better: not found.
- Value: large risk cut.
- Safety: fits.
- Depends: D-013.
- Accept: an install with scripts escalates.

### Theme 7. Codebase health and modernisation

**D-065 Test impact analysis** | Wave 5 | M | Fits
- Problem: full suites are slow under memory pressure.
- Does: runs affected tests first. The release gate still runs everything.
- Unique or better: not found in coding apps.
- Value: faster loops.
- Safety: fits. The gate still refuses skip-tests.
- Depends: C sharded tests.
- Accept: the affected set is a subset of the full set, and the release still runs everything.

**D-066 Characterisation capture** | Wave 3 | M | Fits
- Problem: legacy code has no tests.
- Does: records inputs and outputs before an agent edits.
- Unique or better: not found.
- Value: safe change.
- Safety: fits, with redaction.
- Depends: none.
- Accept: captured cases replay green before the change.

**D-067 Migration planner with evidence** | Wave 6 | L | Fits
- Problem: migrations stall.
- Does: produces a wave plan with characterisation tests and a behaviour diff per wave.
- Unique or better: (S) Factory `/migrate` (26 Sep 2026) has no behaviour evidence.
- Value: modernisation at lower risk.
- Safety: fits.
- Depends: D-006, D-066.
- Accept: every wave has a behaviour diff.

**D-068 Dead code with evidence** | Wave 5 | S | Fits
- Problem: unsafe deletion.
- Does: combines static and coverage evidence and proposes small removal slices.
- Unique or better: not found.
- Value: leaner code.
- Safety: fits.
- Depends: C tree-sitter outline.
- Accept: unreferenced fixture code is listed.

**D-069 Hotspot map** | Wave 5 | S | Fits
- Problem: risk is invisible.
- Does: combines churn, complexity and agent failure rate.
- Unique or better: not found.
- Value: better targeting.
- Safety: fits.
- Depends: D-072.
- Accept: the top hotspot matches the fixture.

**D-070 PowerShell modernisation** | Wave 6 | M | Fits
- Problem: PowerShell 5.1 estates.
- Does: runs PSScriptAnalyzer and plans the move to PowerShell 7.
- Unique or better: not found.
- Value: Windows-first value.
- Safety: fits.
- Depends: PSScriptAnalyzer exact version.
- Accept: findings are listed per script.

**D-071 Dependency upgrade with evidence** | Wave 6 | M | Fits
- Problem: upgrade fear.
- Does: local upgrades with a pack and admission checks.
- Unique or better: (S) bots open PRs without evidence packs.
- Value: current dependencies.
- Safety: fits.
- Depends: D-003, D-053.
- Accept: every upgrade has a pack.

### Theme 8. Agent quality analytics

**D-072 Failure taxonomy** | Wave 5 | M | Fits
- Problem: it is unclear where agents fail.
- Does: classifies failures as loops, tool errors, test failures or undos, per model and per project.
- Unique or better: (E8) Codex profiles show usage, not failures.
- Value: targeted fixes.
- Safety: fits.
- Depends: audit.
- Accept: fixture events are classified correctly.

**D-073 Undo-learning loop** | Wave 5 | S | Fits
- Problem: the same mistakes recur.
- Does: per-hunk undos and denials produce proposed instruction edits, with evidence.
- Unique or better: (E11) Copilot Automations learn from outcomes (28 Oct 2026). This applies the idea locally and to instructions.
- Value: fewer repeats.
- Safety: fits, because proposals need approval.
- Depends: D-059.
- Accept: repeated undos produce a proposal.

**D-074 Behaviour regression suite for Claude Code upgrades** | Wave 5 | M | Fits
- Problem: new versions change agent behaviour.
- Does: replays owner tasks before a pinned upgrade.
- Unique or better: not found.
- Value: safe upgrades.
- Safety: fits.
- Depends: C pin Claude Code version.
- Accept: a regression blocks the pin bump.

**D-075 Loop and thrash detector** | Wave 2 | S | Fits
- Problem: wasted tokens.
- Does: pauses on repeated edit and revert cycles or the same failing command, with a summary.
- Unique or better: (S) Claude Code reined in runaway subagents (2.1.217). No cross-tool detection was found.
- Value: cost saved.
- Safety: fits.
- Depends: none.
- Accept: three identical failures pause the session.

**D-076 Cost per outcome** | Wave 5 | S | Fits
- Problem: spend is not linked to value.
- Does: reports cost per accepted change, including rework.
- Unique or better: (S) Warp tracks cost per PR (E18).
- Value: budget clarity.
- Safety: fits.
- Depends: usage page.
- Accept: rework is included.

**D-077 Context efficiency report** | Wave 5 | S | Fits
- Problem: context waste.
- Does: shows measured per-session use of instructions and files.
- Unique or better: (E2) Claude Code projects plugin cost only.
- Value: cheaper sessions.
- Safety: fits.
- Depends: context meter.
- Accept: unused instruction blocks are listed.

**D-078 Claim calibration score** | Wave 5 | S | Fits
- Problem: unknown honesty per model.
- Does: compares claims with verified outcomes.
- Unique or better: not found.
- Value: trust calibration.
- Safety: fits.
- Depends: D-009.
- Accept: the score is computed per model.

### Theme 9. Context and knowledge

**D-079 Codebase tours** | Wave 5 | M | Fits
- Problem: onboarding is slow.
- Does: generates guided tours with checkpoints.
- Unique or better: not found.
- Value: faster onboarding.
- Safety: fits.
- Depends: C codebase index.
- Accept: each tour step links to a real symbol.

**D-080 Signed knowledge packs** | Wave 6 | M | Fits
- Problem: team knowledge is siloed.
- Does: signed export and import of ADRs, glossary and instructions.
- Unique or better: not found.
- Value: shared memory.
- Safety: fits, with signatures checked.
- Depends: C signed shared rule packs.
- Accept: an altered pack is refused.

**D-081 Why is this code like this** | Wave 5 | S | Fits
- Problem: lost rationale.
- Does: combines blame, ADRs and session links.
- Unique or better: not found with session links.
- Value: faster understanding.
- Safety: fits.
- Depends: D-030.
- Accept: the answer cites a commit and an ADR.

**D-082 Stale instruction detector** | Wave 5 | S | Fits
- Problem: instructions refer to code that no longer exists.
- Does: flags references to missing files and symbols.
- Unique or better: not found.
- Value: better context.
- Safety: fits.
- Depends: C tree-sitter outline.
- Accept: a deleted symbol is flagged.

**D-083 Ubiquitous language glossary** | Wave 5 | S | Fits
- Problem: naming drift.
- Does: extracts domain terms and flags inconsistent names.
- Unique or better: not found.
- Value: clarity.
- Safety: fits.
- Depends: none.
- Accept: a synonym clash is flagged.

### Theme 10. Multi-model orchestration

**D-084 Adversarial pair** | Wave 5 | M | Fits
- Problem: the same model shares the same blind spots.
- Does: one model implements while another tries to break the result in a separate worktree, within data-boundary cards.
- Unique or better: (S) Cursor routes subagents across models, and Copilot Fusion routes by cost (E11). Neither uses adversarial roles with evidence.
- Value: more bugs found.
- Safety: fits, within the boundaries.
- Depends: C cross-model review, C best-of-N.
- Accept: breaker findings land in the pack.

**D-085 Data-boundary hand-off check** | Wave 2 | S | Fits
- Problem: content leaks across models.
- Does: denies a hand-off when the content classification exceeds the target model's verified card.
- Unique or better: not found.
- Value: privacy.
- Safety: fits, and is stricter.
- Depends: C verified data-boundary cards.
- Accept: confidential content sent to an unverified model is denied.

**D-086 Local judge for claims** | Wave 5 | S | Fits
- Problem: verification costs money.
- Does: a local model judges reward-hacking signs (R2).
- Unique or better: not found.
- Value: cheap checks.
- Safety: fits. The judge can only escalate.
- Depends: D-009, local models.
- Accept: a seeded hack is flagged, and the judge never allows.

### Theme 11. Human factors and accessibility

**D-087 Interruption budget** | Wave 4 | S | Fits
- Problem: notifications break flow.
- Does: batches non-urgent notices. Approvals stay immediate.
- Unique or better: not found.
- Value: focus.
- Safety: fits. Approvals are never delayed.
- Depends: notifications.
- Accept: approvals bypass batching.

**D-088 Adaptive explanation depth** | Wave 4 | S | Fits
- Problem: too much or too little detail.
- Does: sets depth per user and per area.
- Unique or better: not found.
- Value: lower cognitive load.
- Safety: fits. Floor details are always shown.
- Depends: D-020.
- Accept: the depth setting persists per area.

**D-089 Review load meter** | Wave 4 | S | Fits
- Problem: agents outpace reviewers (R24).
- Does: estimates review minutes and warns when output exceeds capacity.
- Unique or better: not found.
- Value: real oversight.
- Safety: fits.
- Depends: Changes pane.
- Accept: the estimate is shown for each pending diff.

**D-090 Measured time panel** | Wave 5 | S | Fits
- Problem: users perceive speed-ups that measurement may not show (R24).
- Does: shows measured time per task against the user's own baseline.
- Unique or better: not found.
- Value: honest productivity.
- Safety: fits, local only.
- Depends: usage data.
- Accept: the panel shows an interval, not just a point estimate.

**D-091 Narrated diffs and approvals** | Wave 4 | M | Fits
- Problem: diffs are hard to use with a screen reader.
- Does: structured narration of hunks and risk.
- Unique or better: not found.
- Value: accessibility beyond compliance.
- Safety: fits.
- Depends: screen reader mode.
- Accept: an NVDA script reads hunks in order.

**D-092 Safe keyboard approvals** | Wave 4 | S | Fits
- Problem: fat-finger allows.
- Does: High risk needs a two-key chord.
- Unique or better: not found.
- Value: accessibility and safety.
- Safety: fits.
- Depends: shortcuts.
- Accept: a single key cannot allow High.

**D-093 Cognitive load presets** | Wave 4 | S | Fits
- Problem: overload, including for neurodivergent developers.
- Does: chunked plans, reduced motion and a single-task focus mode.
- Unique or better: not found.
- Value: inclusion.
- Safety: fits.
- Depends: theme system.
- Accept: the preset passes an axe-core scan.

### Theme 12. Windows, enterprise and local-first

**D-094 Verifiable no-egress mode** | Wave 6 | M | Fits with change
- Problem: regulated work needs proof that no data left the machine.
- Does: a C# helper samples per-process connections (GetExtendedTcpTable, no admin) and produces a signed report.
- Unique or better: (S) Factory air-gapped builds (E18) provide no signed proof.
- Value: regulator evidence.
- Safety: adds a new C# helper. The ETW variant needs admin and an IT decision.
- Depends: C# helper.
- Accept: a seeded outbound connection is reported.

**D-095 GPO and Intune templates** | Wave 6 | M | Fits with change
- Problem: IT cannot manage Codehouse natively.
- Does: ADMX templates mapping to the managed policy.
- Unique or better: (E7, E11) others use their own files.
- Value: enterprise rollout.
- Safety: IT decision.
- Depends: IT-signed managed policy.
- Accept: a GPO setting is reflected in Doctor.

**D-096 WinGet admission** | Wave 1 | S | Fits
- Problem: agents install software.
- Does: `winget install` escalates with the publisher and signature shown.
- Unique or better: not found.
- Value: endpoint safety.
- Safety: fits.
- Depends: none.
- Accept: winget escalates.

**D-097 Constrained Language Mode awareness** | Wave 6 | S | Fits
- Problem: commands fail under AppLocker or Constrained Language Mode.
- Does: detects the mode and explains failures.
- Unique or better: not found.
- Value: fewer dead ends.
- Safety: fits.
- Depends: PowerShell AST worker.
- Accept: the mode is shown in Doctor.

**D-098 NPU judge profile** | Wave 6 | M | Fits
- Problem: local checks are slow.
- Does: routes local judge tasks to an NPU profile.
- Unique or better: (E11) Copilot Fusion selects local models, but not for verification.
- Value: cheap, private checks.
- Safety: fits.
- Depends: C Foundry Local profiles, D-086.
- Accept: the judge runs on the NPU when one is present.

### Theme 13. Delivery and stakeholders

**D-099 Evidence-backed stakeholder summary** | Wave 5 | S | Fits
- Problem: non-engineers get unverifiable claims.
- Does: change summaries and release notes in which every claim links to evidence. Claims without evidence are withheld.
- Unique or better: not found.
- Value: credible reporting.
- Safety: fits, with redaction.
- Depends: D-003, D-047.
- Accept: no sentence ships without a link.

**D-100 Estimates from history** | Wave 5 | S | Fits
- Problem: guesswork.
- Does: estimates time and cost intervals from local sessions.
- Unique or better: not found.
- Value: planning.
- Safety: fits, local only.
- Depends: D-076.
- Accept: the estimate shows an interval and a sample size.

## 5. Comparison table

Key:
- **Y** means offered.
- **P** means partial.
- **N** means not found in the sources reviewed on 9 Nov 2026.
- **U** means unknown.

Columns: CC is Claude Code and Desktop. Cx is Codex. GH is Copilot and VS Code. Cu is Cursor. Ki is Kiro. AG is Antigravity. JB is JetBrains Air and Junie. DV is Devin Desktop.

| D | CC | Cx | GH | Cu | Ki | AG | JB | DV | Gap exploited |
|---|---|---|---|---|---|---|---|---|---|
| 001 | N | N | N | N | P | N | N | N | Policy-level test integrity |
| 002 | N | N | N | N | N | N | N | N | Hidden checks |
| 003 | N | N | N | N | N | P | N | N | Hash-bound evidence |
| 004 | N | N | N | N | N | N | N | N | Mutation on diffs |
| 005 | N | N | N | N | N | N | N | N | Mutant-driven tests |
| 006 | N | N | N | N | P | N | N | N | Behaviour diff |
| 007 | N | N | N | N | P | N | N | N | Human-locked tests |
| 008 | N | N | N | N | P | N | N | N | Auto-pinning |
| 009 | N | P | N | N | N | N | N | N | Claim verification |
| 010 | N | N | N | N | N | N | N | N | Randomised seeds |
| 011 | N | N | N | N | N | N | N | N | Flake evidence |
| 012 | N | N | N | N | N | N | N | N | Agent fuzzing |
| 013 | P | N | N | N | N | N | N | N | Effect expansion |
| 014 | N | N | N | N | N | N | N | N | Consequence preview |
| 015 | N | N | N | N | N | N | N | N | Rule provenance |
| 016 | N | N | P | N | N | N | N | N | Taint egress |
| 017 | N | N | N | N | N | N | N | N | Subagent taint |
| 018 | P | N | N | N | N | N | N | N | Risk budget |
| 019 | N | N | P | N | N | N | N | N | Evidence-earned autonomy |
| 020 | N | P | N | N | N | N | N | N | Deterministic trace |
| 021 | N | N | N | N | N | N | N | N | Vigilance friction |
| 022 | P | P | U | U | N | N | N | N | In-turn batching |
| 023 | P | P | P | N | N | N | N | N | Goal-scoped lease |
| 024 | N | N | N | N | N | N | N | N | Co-signed loosening |
| 025 | N | N | N | N | N | N | N | N | Heartbeat |
| 026 | N | N | N | N | N | N | N | N | Policy regression gate |
| 027 | N | N | N | N | N | N | N | N | Step reconstruction |
| 028 | N | N | N | N | N | N | N | N | Causal graph |
| 029 | N | N | N | N | N | N | N | N | Anchored audit |
| 030 | P | N | N | N | N | N | N | N | Lineage trailers |
| 031 | N | N | N | N | N | N | N | N | Audit queries |
| 032 | N | N | N | N | N | N | N | N | Agent SLSA |
| 033 | N | N | N | N | P | N | N | N | Evidence-bound trace |
| 034 | N | N | N | N | P | N | N | N | Per-hunk intent |
| 035 | N | N | N | N | N | N | N | N | Scope meter |
| 036 | N | N | N | N | P | N | N | N | Locked tests-first |
| 037 | N | N | N | N | N | N | N | N | Assumptions |
| 038 | N | N | N | N | N | N | N | N | ADR capture |
| 039 | N | N | N | N | P | N | N | N | Impact preview |
| 040 | N | N | N | N | N | N | N | N | Drift alarm |
| 041 | N | N | N | N | N | N | N | N | Arch policy |
| 042 | N | N | N | N | N | P | N | N | Living C4 |
| 043 | N | N | N | N | N | N | N | N | Drift alerts |
| 044 | N | N | N | N | N | N | N | N | ADR context |
| 045 | N | N | N | N | N | N | N | N | Fitness gate |
| 046 | N | N | N | N | N | N | N | N | API guard |
| 047 | N | N | N | N | N | N | N | N | Capability map |
| 048 | N | N | N | N | N | N | N | N | Review pack |
| 049 | N | N | N | N | N | N | N | N | NFR budgets |
| 050 | N | N | N | N | N | N | N | N | Local STRIDE |
| 051 | N | N | N | N | N | N | N | N | PII map |
| 052 | N | N | N | N | N | N | N | N | Local cross-repo |
| 053 | N | N | N | N | N | N | N | N | Admission |
| 054 | N | N | N | N | N | N | N | N | Lockfile guard |
| 055 | N | N | N | N | N | N | N | N | Licence |
| 056 | N | N | N | N | N | N | N | N | SBOM delta |
| 057 | N | N | N | N | N | N | N | N | Offline CVE |
| 058 | P | U | U | U | U | U | U | U | Floor secret block |
| 059 | N | N | N | N | N | N | N | N | Instruction pinning |
| 060 | U | U | U | U | U | U | U | U | Config tamper floor |
| 061 | P | P | N | N | N | N | N | N | Pre-context scan |
| 062 | N | N | N | N | N | N | N | N | Local SAST |
| 063 | N | N | N | N | N | N | N | N | Provenance |
| 064 | P | N | N | N | N | N | N | N | Script deny |
| 065 | N | N | N | N | N | N | N | N | Impact tests |
| 066 | N | N | N | N | N | N | N | N | Characterisation |
| 067 | N | N | N | N | N | N | N | N | Evidence migration |
| 068 | N | N | N | N | N | N | N | N | Dead code |
| 069 | N | N | N | N | N | N | N | N | Hotspots |
| 070 | N | N | N | N | N | N | N | N | PowerShell modernisation |
| 071 | N | N | P | N | N | N | N | N | Upgrade evidence |
| 072 | N | P | P | N | N | N | N | N | Failure taxonomy |
| 073 | N | N | P | N | N | N | N | N | Instruction learning |
| 074 | N | N | N | N | N | N | N | N | Upgrade regression |
| 075 | P | N | N | N | N | N | N | N | Thrash stop |
| 076 | N | N | N | N | N | N | N | N | Cost per outcome |
| 077 | P | N | N | N | N | N | N | N | Measured context |
| 078 | N | N | N | N | N | N | N | N | Calibration |
| 079 | N | N | N | N | N | N | N | U | Tours |
| 080 | N | P | P | P | N | N | N | N | Signed knowledge |
| 081 | N | N | N | N | N | N | N | N | Rationale |
| 082 | N | N | N | N | N | N | N | N | Stale instructions |
| 083 | N | N | N | N | N | N | N | N | Glossary |
| 084 | N | N | P | P | N | N | N | N | Adversarial pair |
| 085 | N | N | N | P | N | N | N | N | Boundary hand-off |
| 086 | N | N | N | N | N | N | N | N | Local judge |
| 087 | U | U | U | U | U | U | U | U | Interruption budget |
| 088 | N | N | N | N | N | N | N | N | Adaptive depth |
| 089 | N | N | N | N | N | N | N | N | Review capacity |
| 090 | N | P | N | N | N | N | N | N | Measured time |
| 091 | U | U | U | U | U | U | U | U | Narrated diffs |
| 092 | N | N | N | N | N | N | N | N | Chorded allow |
| 093 | U | U | U | U | U | U | U | U | Load presets |
| 094 | N | N | N | N | N | N | N | N | Signed no-egress |
| 095 | N | P | P | P | N | N | N | N | GPO and ADMX |
| 096 | N | N | N | N | N | N | N | N | WinGet admission |
| 097 | N | N | N | N | N | N | N | N | Constrained Language Mode |
| 098 | N | N | P | N | N | N | N | N | NPU judge |
| 099 | N | N | N | N | N | N | N | N | Evidence summaries |
| 100 | N | N | N | N | N | N | N | N | History estimates |

## 6. Build plan

Waves run after the C-backlog items they depend on. Each slice ships independently on its own branch.

| Wave | Theme of wave | Features | Runs after or alongside | Reasoning |
|---|---|---|---|---|
| 1 | Truth and guards | 001, 002, 007, 008, 009, 013, 015, 018, 021, 025, 030, 053, 054, 055, 058, 059, 060, 064, 096 | Alongside the first C wave (memory governor, gate items) | Small policy-engine extensions with the biggest safety gain and no new structural parts except the sealed vault |
| 2 | Evidence | 003, 004, 005, 010, 011, 016, 017, 026, 027, 029, 056, 057, 061, 062, 075, 085 | After C audit-backed timeline, signed timeline export, memory governor, policy dry run, verified data-boundary cards | Needs the evidence store and the analysis worker |
| 3 | Intent and architecture | 006, 028, 031, 033 to 046, 048, 050, 066 | After C tree-sitter outline, TypeScript language service, Mermaid artifacts, frame goal | Needs the code graph |
| 4 | Approvals and human factors | 014 (safe variant), 019, 020, 022, 023, 024, 087, 088, 089, 091, 092, 093 | After C grant lifetimes, adaptive autonomy, frame goal | Builds on decision traces |
| 5 | Analytics, knowledge, multi-model, health | 032, 047, 049, 051, 063, 065, 068, 069, 072 to 079, 081 to 084, 086, 090, 099, 100 | After C codebase index, sharded tests, cross-model review, best-of-N, pin Claude Code | Needs history and the index |
| 6 | Enterprise and large items | 012, 052, 067, 070, 071, 080, 094, 095, 097, 098 | After C Foundry Local profiles, signed shared rule packs, IT decisions | Includes the L items and the IT-dependent items |

## 7. Architecture decision records

**ADR-D1 Evidence store**
- Context: D-003, D-030, D-032 and D-099 need durable, verifiable artefacts.
- Options: (a) inline in the audit JSONL, (b) a content-addressed store referenced by audit hashes, (c) a database.
- Decision: (b). The store sits under the data directory, filenames are SHA-256 hashes, and every pack is referenced by an audit record.
- Consequences: the audit stays small, the verifiers gain a pack check, and no native database is needed. Disk growth needs a retention setting.

**ADR-D2 Analysis worker**
- Context: mutation runs, fuzzing, benchmarks and test reruns are heavy on a 16 GB laptop.
- Options: (a) in the Node Host, (b) a separate process launched through the existing job-object helper, (c) a new C# runner.
- Decision: (b), one queued job at a time, honouring the memory governor.
- Consequences: crashes are isolated, live caps apply and no new native code is needed. Throughput is limited.

**ADR-D3 Architecture model**
- Context: D-041 to D-052 need a code graph.
- Options: (a) build the graph on demand from tree-sitter, (b) keep a persisted graph in `.codehouse/arch` as JSON, (c) use an external tool.
- Decision: (b), rebuilt incrementally, with rules in `architecture.yml`.
- Consequences: the graph can be reviewed in git and diffed for drift. It depends on the C tree-sitter outline.

**ADR-D4 Requirement ledger format**
- Context: D-033 to D-039.
- Options: (a) Markdown with front matter in the repo, (b) an internal database.
- Decision: (a). Files are human-editable, with stable IDs.
- Consequences: works with git review, and tolerant parsing is required.

**ADR-D5 Taint labels in the policy engine**
- Context: D-016 and D-017.
- Options: (a) heuristic scanning only, (b) labels carried on values through the session.
- Decision: (b), extending the built provenance labels. Labels can only cause escalation, never an allow.
- Consequences: the engine gains a taint input, and golden cases must cover propagation.

**ADR-D6 Sealed check vault**
- Context: D-002.
- Options: (a) a hidden folder, (b) a DPAPI-sealed archive outside worktrees, protected by a floor deny.
- Decision: (b).
- Consequences: the agent can never read it, and the owner manages its contents.

**ADR-D7 Dependency intelligence source**
- Context: D-053, D-057 and D-063.
- Options: (a) direct registry calls, (b) the organisation gateway, (c) a signed offline snapshot.
- Decision: (b) where IT allows it, otherwise (c). Never (a).
- Consequences: works air-gapped, but freshness depends on how often snapshots are imported.

## 8. Risks and open questions

**Owner**
- Should Extreme exclude locked tests (D-007)? Recommendation: yes.
- Should High risk be excluded from batching (D-022)? Recommendation: yes.
- Raising autonomy needs a signature (D-019).
- Should legitimate VS Code settings edits stay human-only (D-060)?

**IT**
- Registry metadata route (D-053, D-063).
- Approved source for OSV snapshots (D-057).
- Isolation for shadow runs (D-014). Windows Sandbox may be blocked by policy.
- ETW access for the no-egress report (D-094).
- GPO and Intune rollout (D-095).

**Security**
- Confirm that a phone co-signature is not "changing policy" (D-024).
- Floor extensions (D-002, D-058, D-060).
- Shadow execution (D-014) stays unbuilt until a decision is made.

**Legal**
- The licence allow-list (D-055).
- Personal data mapping scope (D-051).
- Whether evidence packs count as records under retention rules.

**Delivery risks**
- Memory pressure makes mutation testing and fuzzing unreliable. Mitigation: ADR-D2 and running one test file at a time.
- Mutation score is an imperfect proxy (R11).
- Effect expansion can miss dynamic scripts. Mitigation: unknown effects escalate rather than allow.

**Assumptions**
- Competitor "not found" ratings may be wrong, because changelogs move weekly.
- The Claude Code Agent SDK continues to route every tool call to Codehouse's policy engine.

## 9. Sources (all checked 9 Nov 2026)

**Primary**
- https://code.claude.com/docs/en/changelog
- https://code.claude.com/docs/en/whats-new/2026-w20
- https://code.claude.com/docs/en/whats-new/2026-w27
- https://code.claude.com/docs/en/permission-modes
- https://www.anthropic.com/engineering/claude-code-auto-mode
- https://claude.com/docs/cowork/changelog
- https://developers.openai.com/codex/changelog
- https://developers.openai.com/codex/agent-approvals-security
- https://developers.openai.com/codex/concepts/sandboxing/auto-review
- https://learn.chatgpt.com/docs/permissions
- https://help.openai.com/en/articles/11391654-chatgpt-business-release-notes
- https://cursor.com/changelog/side-chat
- https://cursor.com/changelog/sdk-updates-jun-2026
- https://cursor.com/docs/release-notes
- https://github.blog/changelog/2026-10-09-github-copilot-weekly-releases-october-5/
- https://github.blog/changelog/2026-10-28-github-copilot-in-vs-code-universe-releases/
- https://github.blog/changelog/2026-10-28-github-copilot-in-jetbrains-universe-releases/
- https://kiro.dev/blog/general-availability/
- https://kiro.dev/blog/specs-bugfix-and-design-first/
- https://www.jetbrains.com/ides/whatsnew/
- https://blog.jetbrains.com/ai/2026/10/air-in-ides-eap/
- https://plugins.jetbrains.com/plugin/26104-junie-the-ai-coding-agent-by-jetbrains
- https://antigravity.google/blog/introducing-google-antigravity-2/
- https://antigravity.google/docs/changelog/
- https://developers.googleblog.com/build-with-google-antigravity-our-new-agentic-development-platform/
- https://cognition.com/blog/introducing-devin-desktop
- https://cognition.com/blog
- https://zed.dev/releases/preview
- https://zed.dev/releases/stable
- https://docs.warp.dev/changelog/2026/
- https://www.augmentcode.com/guides/ai-agent-pre-merge-verification

**arXiv**
- 2605.21384, 2511.21654, 2608.30724, 2606.07379, 2605.02964
- 2602.08146, 2607.09101, 2609.35841, 2605.22175, 2603.23443, 2607.22880
- 2503.18813, 2606.26479, 2610.05640
- 2605.17062, 2606.08444, 2608.22652
- 2610.40753, 2610.22987, 2609.28586, 2605.24309, 2604.13536, 2608.27443, 2601.17548

**GitHub (third party)**
- Mearman/agent-permissions PR #77
- wicklight-agents/wicklight PR #45
- karamage/goodhart
- datacrate360/agent-countercheck PR #66

**Secondary (S)**
- havoptic.com, clockedcode.com and cc.bruniaux.com (Claude Code releases)
- gradually.ai and releasebot.io (Codex and Cursor)
- devops.com, devclass.com and altaitools.com (JetBrains Air)
- Wikipedia (Antigravity, Codex, Cursor, Zed, Qodo)
- digitalapplied.com (Zed, Cursor 3.11)
- learncursor.dev, developertoolkit.ai, qa.tech
- openorchestrators.org (Intent)
- wetheflywheel.com and aiagentslist.io (Factory)
- ppcbasic.com (Warp)
- mastra.ai, greptile.com, macroscope.com and particula.tech (code review)
- socket.dev (slopsquatting)
- METR posts on X, and devs-group.ch (METR update)

**Claims I could not confirm**
- Anthropic's 97% approval figure, and auto mode becoming the default on 14 Aug 2026.
- The scope of Claude Code's credential-leak protections in 2.1.234.
- Copilot assisted permissions details (26 Oct 2026).
- Cursor Projects (10 Sep 2026) and Cursor Voice (6 Nov 2026) details.
- JetBrains Air Windows availability date.
- Antigravity sandbox platform limits.
- Zed checkpoint removal.
- Factory Droid 1.0 and `/migrate` details.
- Intent launch date and platform.
- All AI code review benchmark rankings, which are vendor-run and conflict with each other.
- Absence claims marked N in section 5. These are not proven.

---

# PART B. Build prompt for Claude Code

```
You are working in the Codehouse repository. Plain UK English. Never use em dashes or en dashes.

READ FIRST
1. CLAUDE.md, BUILD_REPORT.md, docs/sdk-notes.md.
2. If present: docs/research/gap-analysis-2026-11.md and docs/research/feature-frontier-2026-11.md (save the research paper there first if it is missing).

WORKING METHOD (same as the C-backlog)
- One slice per branch, fast-forwarded into main.
- Every slice: tests plus break checks (deliberate mutations that must make named tests fail), threat model entries with named tests, audit records for every decision and significant action, tolerant settings (missing or malformed values fall back safely), docs, and a BUILD_REPORT phase entry.
- Any dependency: stated reason and exact version. C# helpers instead of native Node addons. Windows first. Local signed builds.
- Run npm run gate before each release. Release at the end of each wave. Never use --skip-tests.
- Under memory pressure run heavy tests one file at a time, at a low resource level, and record this in BUILD_REPORT.

DO NOT BUILD (list only, with the decision needed)
- Items marked OWNER, IT, SECURITY or LEGAL below. Build the safe variant where one is given.

STOP AND ESCALATE TO THE OWNER WHEN
- A slice would weaken any safety invariant (fail closed, floor, modes, no credentials, loopback only, phone ciphertext only, redaction, audit chain, organisation guard, in-process MCP only).
- A test cannot pass without weakening a check.
- Memory pressure makes the gate unreliable after one file-at-a-time retry.
- A C-item dependency is not yet built. Skip the slice and record it.

WAVE 1 (after or alongside first C wave)
D-001 Test integrity guard. Deps: none. Accept: 40 golden cases (20 weakening, 20 legitimate) pass. Break check on the assertion-count rule fails 5 named cases. Audit test_integrity.escalated.
D-002 Sealed held-out checks. Deps: job-object helper, DPAPI. Accept: floor denies vault reads in all modes including Extreme. Results are counts only. sealed.no_leak.
D-007 Locked acceptance tests. OWNER confirms Extreme exception. Safe variant: build with exception on. Accept: Extreme cannot edit a locked test without a human. extreme.locked_tests.
D-008 Pinned counterexamples. Deps: D-007. Accept: a failing property writes a regression file that fails before the fix and passes after.
D-009 Done-claim verifier. Accept: a false pass claim is stamped Contradicted. The rerun obeys the resource level.
D-013 Effect-complete approval cards. Accept: npm test whose script runs curl escalates with the expanded line on desktop and phone. 30 golden cases. effects.expand.
D-015 Allow-rule provenance lock. Deps: C grant lifetimes. Accept: a poisoned-context fixture cannot create a rule. remember.provenance.
D-018 Risk budget per session. Accept: after exhaustion the next Moderate call escalates. Audit risk_budget.exhausted.
D-021 Rubber-stamp detector. Accept: 3 High approvals within 800 ms trigger friction.
D-025 Dead-man timer for Extreme. Accept: no heartbeat for N minutes pauses the session, audited.
D-030 Approval lineage trailers. Deps: D-003 (add the pack trailer in wave 2). Accept: trailers resolve and verify.
D-053 Dependency admission control. IT decides the metadata route. Safe variant: signed offline snapshot. Accept: a non-existent package is denied. A name 1 edit from a popular package escalates.
D-054 Lockfile diff guard. Accept: a new postinstall script escalates.
D-055 Licence policy. LEGAL sets the list. Safe variant: escalate all non-permissive licences. Accept: a disallowed licence escalates.
D-058 Secret commit block. Accept: a test key commit is denied at floor. The log has a rule ID only.
D-059 Instruction integrity pinning. Accept: a pulled change to CLAUDE.md needs a decision before next use.
D-060 Agent-config tamper floor. OWNER decides on VS Code settings. Accept: an agent write of chat.tools.autoApprove is denied in every mode.
D-064 Install-script default deny. Deps: D-013. Accept: an install with scripts escalates with contents shown.
D-096 WinGet admission. Accept: winget install escalates with publisher and signature.

WAVE 2 (after C audit-backed timeline, signed timeline export, memory governor, policy dry run, verified data-boundary cards)
D-003 Change evidence pack (ADR-D1). Accept: a 1 byte change fails both verifiers. A 50-file pack builds in under 5 s. evidence.chain.
D-004 Diff-scoped mutation gate (ADR-D2). Accept: a weak test leaves a reported survivor. A run at the cap aborts cleanly, audited.
D-005 Surviving-mutant tasks. Deps: D-004. Accept: killed mutants rise. A source edit in a task escalates.
D-010 Randomised check seeds. Accept: a hard-coded fixture fails a randomised run.
D-011 Flake quarantine. Accept: flaky fixture labelled after 5 reruns. Disabling it escalates.
D-016 Taint-tracked egress guard (ADR-D5). Accept: a README-injected URL used in curl escalates with source shown.
D-017 Subagent boundary labels. Deps: D-016. Accept: a push based on a tainted subagent result escalates.
D-026 Policy regression from history. Accept: a rule flipping a past deny blocks save with a list.
D-027 Step-exact reconstruction. Accept: tree hash at a sampled step matches.
D-029 Audit anchoring. Accept: rewriting an old record fails against the anchor.
D-056 SBOM per change. Accept: a valid CycloneDX diff in the pack.
D-057 Offline vulnerability snapshot. IT approves the source. Accept: a known vulnerable version escalates.
D-061 Untrusted content scanner. Accept: a seeded injection is quarantined.
D-062 Local SAST on diffs. Accept: string-built SQL is flagged.
D-075 Loop and thrash detector. Accept: 3 identical failures pause the session.
D-085 Data-boundary hand-off check. Accept: confidential content to an unverified model is denied.

WAVE 3 (after C tree-sitter outline, TypeScript language service, Mermaid artifacts, frame goal)
D-006 Behaviour diff. Deps: D-066. Accept: one intentional change gives one delta.
D-028 Causal provenance graph. Accept: a hunk shows its injected source.
D-031 Evidence queries. Accept: 100k records answered in under 2 s.
D-033 Requirement ledger (ADR-D4). Accept: untested requirement flagged. Links resolve.
D-034 Unrequested behaviour detector. Accept: an extra feature is flagged.
D-035 Scope creep meter. Accept: an unplanned file raises the meter.
D-036 Tests-first contract mode. Deps: D-007, D-033. Accept: no implementation before test approval.
D-037 Assumption register. Accept: an unverified assumption appears in the pack.
D-038 ADR capture. Accept: a decision produces a draft ADR.
D-039 Requirement change impact. Accept: an edit lists linked tests.
D-040 Intent drift alarm. Accept: a divergent fixture alerts.
D-041 Architecture rules as policy (ADR-D3). Accept: a forbidden import escalates. Break check.
D-042 Living C4 diagrams. Accept: a new module is marked as drift.
D-043 Architecture drift alerts. Accept: a new cycle alerts.
D-044 ADR-aware context. Accept: a contradicting edit is flagged.
D-045 Fitness functions. Accept: a breached threshold fails the gate.
D-046 Public API break guard. Accept: a removed public method escalates.
D-048 Architecture review pack. Accept: all arc42 sections are present.
D-050 Threat model delta. Accept: a new route drafts a STRIDE entry.
D-066 Characterisation capture. Accept: cases replay green before the change.

WAVE 4 (after C grant lifetimes, adaptive autonomy, frame goal)
D-014 Shadow-run preview. IT and SECURITY decide isolation. Build safe variant only: static effect prediction. Accept: nothing executes before approval.
D-019 Earned-autonomy proposals. OWNER signs raises. Accept: never applies without a passkey signature.
D-020 Explain why and what would change. Accept: 100% of escalations have a trace. Floor never shows a counterfactual.
D-022 In-turn batch approvals. OWNER confirms High excluded. Accept: 5 identical calls give 1 card and 5 audit records.
D-023 Scope lease. Accept: a write outside the lease escalates in Auto.
D-024 Two-person rule. SECURITY confirms co-sign model. Accept: loosening without co-sign is rejected.
D-087 Interruption budget. Accept: approvals bypass batching.
D-088 Adaptive explanation depth. Accept: depth persists per area.
D-089 Review load meter. Accept: an estimate is shown per pending diff.
D-091 Narrated diffs. Accept: an NVDA script reads hunks in order.
D-092 Safe keyboard approvals. Accept: a single key cannot allow High.
D-093 Cognitive load presets. Accept: passes axe-core.

WAVE 5 (after C codebase index, sharded tests, cross-model review, best-of-N, pin Claude Code)
D-032 Agent-aware build provenance. Accept: SLSA v1 validates and hashes verify.
D-047 Capability map. Accept: a report names the capability.
D-049 NFR budgets. Accept: a seeded slowdown fails its budget.
D-051 Personal data flow map. LEGAL sets scope. Accept: an email field is traced to the logger.
D-063 Package provenance verification. IT decides the route. Accept: an unsigned package escalates.
D-065 Test impact analysis. Accept: affected tests are a subset and the release still runs all tests.
D-068 Dead code with evidence. Accept: unreferenced code is listed.
D-069 Hotspot map. Accept: the top hotspot matches the fixture.
D-072 Failure taxonomy. Accept: fixture events are classified correctly.
D-073 Undo-learning loop. Accept: repeated undos produce a proposal.
D-074 Behaviour regression for Claude Code upgrades. Accept: a regression blocks the pin bump.
D-076 Cost per outcome. Accept: rework is included.
D-077 Context efficiency report. Accept: unused instruction blocks are listed.
D-078 Claim calibration score. Accept: a score per model.
D-079 Codebase tours. Accept: each step links to a real symbol.
D-081 Why is this code like this. Accept: cites a commit and an ADR.
D-082 Stale instruction detector. Accept: a deleted symbol is flagged.
D-083 Glossary. Accept: a synonym clash is flagged.
D-084 Adversarial pair. Accept: breaker findings land in the pack.
D-086 Local judge. Accept: a seeded hack is flagged. The judge never allows.
D-090 Measured time panel. Accept: shows an interval.
D-099 Evidence-backed summaries. Accept: no sentence without a link.
D-100 Estimates from history. Accept: an interval and sample size are shown.

WAVE 6 (after C Foundry Local profiles, signed shared rule packs, IT decisions)
D-012 Time-boxed fuzz pass. Accept: seeded crash found in 60 s under the cap.
D-052 Multi-repo contract check. Accept: a consumer break is reported.
D-067 Migration planner. Accept: every wave has a behaviour diff.
D-070 PowerShell modernisation. Accept: findings per script.
D-071 Dependency upgrade with evidence. Accept: every upgrade has a pack.
D-080 Signed knowledge packs. Accept: an altered pack is refused.
D-094 Verifiable no-egress. IT decides ETW. Safe variant: GetExtendedTcpTable helper. Accept: a seeded connection is reported.
D-095 GPO and Intune templates. IT decides rollout. Accept: a GPO setting shows in Doctor.
D-097 Constrained Language Mode awareness. Accept: the mode is shown in Doctor.
D-098 NPU judge profile. Accept: runs on the NPU when present.

FINAL REPORT
At the end, write a report with: what was built per wave, what was deferred and why, every decision still needed (owner, IT, security, legal), test and break-check counts, gate results, and the owner's to-do list.
```

## Caveats

- Competitor coverage changes weekly. Every N in section 5 means "not found on 9 Nov 2026", not proven absence.
- Many competitor details come from secondary sources and are marked (S). Where primary and secondary sources disagree, I trust the primary source. Examples: Anthropic's 93% over the unconfirmed 97%, and Kiro's own blog over qa.tech.
- Several arXiv results are preprints that have not been peer reviewed, including the slopsquatting replication.
- Mutation score is an imperfect proxy (R11). Evidence packs report it as evidence, not as proof of correctness.