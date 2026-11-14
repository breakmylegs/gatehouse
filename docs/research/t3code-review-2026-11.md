# T3 Code review against Codehouse, November 2026

Owner request (O31, 14 Nov): bring "all the features" of T3 Code (https://github.com/pingdotgg/t3code, MIT, TypeScript) into Codehouse. This paper decides what that means safely. CLAUDE.md's invariants 1 to 16 and the owner decisions recorded there win over anything here. Nothing was cloned, installed or run from T3 Code; its documentation was read through GitHub, and its source tree was listed only to find features the documents do not mention. No code, names, logos or look are to be copied (invariant 16): every Build item below is to be built in Codehouse's own design.

## 1. What T3 Code is and how it works

T3 Code calls itself "the open-source control plane for coding agents". It is not an agent harness itself: it drives agents the user already has installed and signed in (Claude Code through Anthropic's Agent SDK, Codex through its app server, Cursor through its SDK, Grok, OpenCode, Antigravity, Kiro, Pi, Muse Code, fx, and any ACP agent) and gives them one interface.

- **Server.** One Node server (an "environment") owns the providers, terminals, Git, project files and durable state, in SQLite. Orchestration is event sourced: commands are serialised, events and projections are committed in one transaction with "outbox" side effects that a worker runs afterwards, and about a day of events is kept for reconnects. Checkpoints are hidden Git refs. The server also exposes an MCP endpoint (`/mcp`) that its own agents use for delegation, thread tools and scheduling, and that outside agents can use after an OAuth sign-in.
- **Clients.** An Electron desktop app (which can host its own server), a web client (including a hosted one at app.t3.codes), and native iOS and Android apps. Clients talk to the server over authenticated RPC and WebSocket; shared connection logic lives in `packages/client-runtime`.
- **Providers.** Each provider is an adapter behind one contract. Provider "instances" can carry their own binary path, launch arguments, environment variables (including API keys and base URLs, for example an OpenRouter recipe for Claude), and config folder (several Claude accounts through `CLAUDE_CONFIG_DIR`). "Text generators" (OpenAI, Anthropic, OpenRouter or any OpenAI-compatible endpoint with a key) write titles, commit messages and PR text.
- **Remote access.** The server can listen on the local network and Tailscale addresses, be reached through "T3 Connect" (a Cloudflare tunnel set up by their relay, which they describe as a trusted broker and which can hold webhook bodies for 24 hours), through Tailscale HTTPS, or through SSH-managed remote environments that the desktop starts on another machine. Machines can be linked so agents on one run threads on another. Guest links let someone with no account follow a thread in a browser.
- **Permissions.** Four modes per thread: Supervised, Auto-accept edits, Auto (the provider's own automatic review) and Full access (no approvals), with Full access as the initial default. Approvals appear in the conversation; each provider enforces them its own way. A managed policy (JSON file, registry value, ADMX or macOS profile) can cap the broadest mode, lock settings, limit providers and turn off remote access; T3 Code refuses to start with a policy it cannot fully enforce.
- **Performance.** "Performance is a feature here. We measure it, and we treat a dropped frame as a bug." They keep byte and row budgets for the wire protocol as integration tests that fail locally, and lint the web app so every file compiles under React Compiler (section 4).

How this differs from Codehouse in one line: T3 Code maximises reach (every agent, every device, every network, Full access by default); Codehouse is a permission workbench where every call reaches the floor and the Approver, listeners stay on 127.0.0.1, the Relay sees only ciphertext and sessions run only on the owner's SSO Claude login. Most of T3 Code's everyday interface features fit Codehouse; its reach features mostly do not.

### Documents read

All of `docs/user/`: activity-log, appearance, background-service, browser-import, composer, cursor, default-browser, devices, faq, guest-links, html-renders, install, keybindings, keyboard-focus, managed-policy, mobile-notifications, open-source-licenses, outside-agents, permission-modes, portable-handoffs, project-settings, prompt-links, providers-acp, providers-claude, providers-codex, question-attachments, remote-access, secrets, snap-shot, source-control, telemetry, terminal, text-generation, thread-migration, thread-sidebar, triage, updating, usage, voice-input, welcome-page. Skimmed only, as provider-specific or vendor-account detail: providers-antigravity, providers-fx, providers-kiro, providers-muse, providers-opencode, providers-pi, secrets-1password-connect, secrets-1password-service-account, t3-connect-troubleshooting.

From `docs/internals/`: overview (the architecture overview), glossary, remote, t3-connect, environment-auth, performance-regressions, resource-telemetry, web-ui, assistant-citations, devcontainer, and the headings of the rest. From `docs/orchestration-v2/`: orchestrator-mcp-server. Also `README.md` and `docs/README.md`. The source tree (`git/trees/main?recursive=1`) was listed for `apps/web/src`, `apps/web/src/components` and `apps/server/src`, which added: open in an external editor (JetBrains and VS Code icons), localisation and right-to-left text (`i18n`, `textDirection`), trackpad history swipe, slow-request and host-freeze notices, and project script editing.

Codehouse side: CLAUDE.md, docs/BUILD_REPORT.md (searched), docs/plan/frontier-status.md, docs/plan/expansion-status.md, PRODUCT.md, docs/performance.md, docs/inventory/product-inventory-2026-11-04.md (the feature ids CHAT-, CODE-, IDE-, PHONE- and so on below come from it), and spot checks in apps/web/src.

## 2. Features, one by one

Verdicts: **Have** (Codehouse does it), **Partly** (what is missing is said), **Build** (fits every invariant; sketch and size S, M or L), **Build (safe variant)** (the T3 form conflicts, a safe form fits), **Conflicts** (would weaken an invariant or owner decision; the decision the owner would need is named). Sizes: S is up to a day or so, M a few days, L a week or more.

### 2.1 Install, start and running

**T-001. Desktop app for Windows, macOS and Linux, and package-manager installs.** Docs: `docs/user/install.md`. Verdict: **Have**. Per-user installer with no administrator rights (PLAT-01, Phase 9 and 23) and the Mac app (`npm run package:mac`, BUILD_REPORT "The Mac version joins the repository"). Package-manager listings do not apply to a private release repository.

**T-002. Open a project in the running app from a terminal (`t3 app <folder>`).** Docs: `docs/user/install.md`. Verdict: **Build**, S. `Codehouse.exe --open <folder>` passes the folder to the running copy over the existing single-instance channel (`packaging/CodehouseApp.cs`; the Mac's in `packaging/mac/`), and the window opens Start a session with the folder filled in. It never starts a session by itself. Changes the window's messages, so the other machine's gate is needed.

**T-003. Background service at sign-in, restarted if it exits.** Docs: `docs/user/background-service.md`. Verdict: **Have**. Optional start at sign-in (PLAT-01), Host restart after an unexpected stop (PLAT-04), tray.

**T-004. Welcome page that finds installed agents and imports recent projects and conversations from Claude Code's history.** Docs: `docs/user/welcome-page.md`. Verdict: **Partly**. The setup wizard (UX-15, Phase 11) and Resume earlier sessions (CODE-28) exist. Missing: offering the folders Claude Code has already worked in. Build S: the Host lists Claude Code's per-project history folders (names and dates only; never the credentials file, invariant 6), the wizard offers repositories active in the last 30 days, each ticked by the person. `apps/host/src/history.ts`, `apps/web/src/surfaces/Setup.tsx`.

**T-005. Drop a folder on the sidebar to open it as a project.** Docs: `docs/user/install.md`. Verdict: **Build**, S. The shell reads the dropped folder's path (WebView2 drop) and sends it as the same message as T-002. Window message change: other machine's gate.

**T-006. Threads without a project, in dated scratch folders, and Turn into project.** Docs: `docs/user/thread-sidebar.md`. Verdict: **Partly**. Chats have their own folders and New project from the first prompt exists (CODE-40). Build S: a scratch coding session in a folder Codehouse makes under a workspace root (`<root>/scratch/<date>-<words>-<id>`), so `outside-workspace-write` and every other rule still apply; Make it a project renames it in place.

**T-007. Desktop as a remote only, with no local server.** Docs: `docs/user/remote-access.md`. Verdict: **Conflicts** with invariant 7 and the window design (the window loads only its own Host's origin). Meaningless without remote environments (T-093).

**T-008. Run agents and projects inside a WSL distro.** Docs: `docs/user/install.md`. Verdict: **Build**, L, low priority. Sessions whose folder is in a WSL distro run the pinned Linux Claude Code (B04's version gate) through `wsl.exe`, with the same SDK options, floor hook and Approver; the Host stays on Windows loopback. Depends on E-028 (WSL command coverage).

### 2.2 Providers and models

**T-009. Other coding agents (Codex, Cursor, Grok, OpenCode, Antigravity, Kiro, Pi, Muse Code, fx) on their own sign-ins.** Docs: `docs/user/install.md`, `providers-*.md`, README. Verdict: **Conflicts**. Invariant 6 and ADR 0010 (another provider reaches Codehouse only through a runtime or gateway on 127.0.0.1 that holds any credential itself); invariants 1, 2 and 13 (every call reaching the floor and Approver is built on the Agent SDK's PreToolUse hook and canUseTool, and other CLIs run their own tools under their own approvals; T3's docs say "File reads and searches never wait for approval" for ACP agents); invariant 14 (the org guard is an Anthropic account check). Owner decision needed: whether any second agent that offers a per-call approval callback may run, on whose credential, and how the org guard applies. Safe variant already built: chats on a local model or an organisation gateway through Codehouse's own tool loop (MM-05, MM-07, MM-08).

**T-010. ACP Registry agents and local ACP commands, downloaded and run by the app.** Docs: `docs/user/providers-acp.md`. Verdict: **Conflicts**. As T-009, plus downloading and running third-party binaries (D-053 and D-096 admission) and the app answering their approval requests by mode, automatically in Auto.

**T-011. Provider instances with their own environment variables, API keys, base URLs and routers (OpenRouter, Claude Code Router, CLIProxyAPI hubs).** Docs: `docs/user/install.md`, `providers-claude.md`, `usage.md`. Verdict: **Conflicts** with invariant 6 (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` are stripped; Codehouse sends no key). T3's own FAQ warns that pooled subscriptions risk bans. Safe variant already built: an organisation gateway on 127.0.0.1 (MM-08, ADR 0010).

**T-012. Binary path and launch arguments per provider (for example `--chrome`, `--settings`).** Docs: `docs/user/install.md`, `providers-claude.md`. Verdict: **Conflicts** with invariants 3 and 4: `assertSafeOptions` refuses `extraArgs` and `pathToClaudeCodeExecutable`, and B04 runs only the checked Claude Code.

**T-013. Several Claude accounts through separate config folders.** Docs: `docs/user/providers-claude.md`. Verdict: **Have**. Phase 42 (OTHER-01), with an expected organisation per account (invariant 14 as amended).

**T-014. Provider version warnings, Update now, readiness timeouts.** Docs: `docs/user/install.md`. Verdict: **Have**, stricter: B04 pins the Claude Code a release was checked with; C-008 (pin a newer one through conformance) is queued.

**T-015. Change model mid-thread, and switch provider with a budgeted context handoff.** Docs: `docs/user/portable-handoffs.md`, README. Verdict: **Partly**. Model per session (CODE-06) and Carry on with another model (B21, behind its flag, with D-085's boundary check). Missing: T3's handoff rules (keep the original request and recent turns whole, never shorten the new request, list what was left out and let the agent read it on demand). Build M: a handoff builder in `apps/host` plus a read-only Companion tool that returns omitted history, redacted and marked as data.

**T-016. Custom models and display names for models.** Docs: `docs/user/composer.md`. Verdict: **Partly**. Model lists (MM-09) and IT's signed model list (B19). Missing: display names. Build S, low value.

**T-017. Remembered model and options for new threads, and a project default model.** Docs: `docs/user/composer.md`. Verdict: **Partly**. Missing: a per-project default for coding sessions (Codehouse projects are chat projects today, CHAT-04). Build S once coding sessions can belong to a project.

**T-018. Text generation: thread titles, commit messages, PR titles and descriptions, branch names, with optional API-key text generators.** Docs: `docs/user/text-generation.md`. Verdict: **Build (safe variant)**, S. Chats are named from the first message only (CHAT-02). Generate these with a one-turn query with no tools on the session's own account, exactly as the recap and `/btw` already do (redacted input, org guard, audited), or with a local runtime on 127.0.0.1. API-key generators are out (invariant 6).

**T-019. Regenerate title, and title instructions.** Docs: `docs/user/thread-sidebar.md`. Verdict: **Build**, S, on T-018.

**T-020. Suggested next prompt after a turn (Tab to fill, never sent).** Docs: `docs/user/composer.md`. Verdict: **Build**, S. Off by default; one extra one-turn query with no tools, said in Settings to use plan usage; not offered during Extreme approval's carry-on. Check `docs/sdk-notes.md` for a supported SDK call first.

**T-021. Image generation (Codex).** Docs: `docs/user/providers-codex.md`. Verdict: **Conflicts**, as T-009.

### 2.3 Threads and the sidebar

**T-022. Threads outlive the agent process; stop and resume.** Docs: `docs/internals/glossary.md`. Verdict: **Have** (CODE-28, CODE-29, Phase 34).

**T-023. Pin threads and drag to reorder or between sections.** Docs: `docs/user/thread-sidebar.md`. Verdict: **Partly**. Rename, pin, archive and group exist (CODE-39). Build S: drag reorder in `apps/web/src/components/Rail.tsx`, order kept by the Host and read tolerantly, with the board's keyboard drag pattern (G24) for accessibility.

**T-024. Settle finished threads, automatically after inactivity or a merged PR, Never per thread.** Docs: `docs/user/thread-sidebar.md`. Verdict: **Partly**. Hide and archive ended sessions (Phase 55). Build S: auto-archive ended sessions idle for N days, off by default; the merged-PR rule waits for T-061.

**T-025. Snooze a thread until a time or until limits reset; it wakes early for an approval, a question or a failure.** Docs: `docs/user/thread-sidebar.md`. Verdict: **Build**, S. A snoozed session leaves the sidebar's live list until its time; anything U2's one inbox counts as needing you wakes it at once, and requests are never hidden.

**T-026. Undo for sidebar actions (a five-second notice, mod+Z).** Docs: `docs/user/keybindings.md`. Verdict: **Build**, S (Sonner notice with Undo for pin, archive, snooze, discard draft).

**T-027. A folded Working section for busy threads.** Docs: `docs/user/thread-sidebar.md`. Verdict: **Partly**. State icons and the agents board (B08). Build S.

**T-028. Group threads by project.** Docs: `docs/user/thread-sidebar.md`. Verdict: **Have** (Phase 30, CHAT-03, CHAT-05).

**T-029. Send the same prompt to several models, each in its own worktree; start in the background and open a fresh draft.** Docs: `docs/user/thread-sidebar.md`. Verdict: **Partly**. Best of several runs (G25: 1 to 4 runs, one model). Build S: a model per run, and a send-and-new chord that is not Ctrl+Enter (Codehouse's allow chord, PRODUCT.md).

**T-030. Search every thread by title, branch, PR and project, and inside messages, from the palette.** Docs: `docs/user/thread-sidebar.md`. Verdict: **Partly**. Palette (UX-01) and find in one conversation (UX-05, Phase 94). Build M: a local message index over redacted transcripts, built like D-031's incremental index, opening a session at the match.

**T-031. Copy a link or id for a thread.** Docs: `docs/user/thread-sidebar.md`, `prompt-links.md`. Verdict: **Build**, S, with T-087 (a `codehouse://session/<id>` reference that only this computer can open).

**T-032. Subagent threads, an Agents view, and Stop that stops subagents too.** Docs: `docs/user/thread-sidebar.md`. Verdict: **Have** (CODE-13, CODE-16, CODE-31).

**T-033. Limited state with Resume, Resume at reset and Snooze until reset.** Docs: `docs/user/thread-sidebar.md`, `providers-claude.md`. Verdict: **Have**: pause at the plan limit and start again after the reset (B26, Phase 53); the snooze part is T-025.

**T-034. Side chats (`/side`, `/btw`) with tools, their own composer, and Bring back.** Docs: `docs/user/thread-sidebar.md`. Verdict: **Partly**. `/btw` is a one-turn question with no tools (BUILD_REPORT "/btw side questions"). Build M: a side session in Plan mode in the same folder (read tools only, every call through the Approver, never Extreme), shown as a tab of the pane; Bring back puts its answer in the prompt box for you to send.

**T-035. Threads from older versions migrated on first start.** Docs: `docs/user/thread-migration.md`. Verdict: **Have** (Phase 93 and 95, updates never break).

### 2.4 The composer

**T-036. A large paste becomes an attachment.** Docs: `docs/user/composer.md`. Verdict: **Have** (BUILD_REPORT "A large paste becomes a card").

**T-037. Rich-text Markdown composer (styled as you type, list continuation, code blocks with a language).** Docs: `docs/user/composer.md`. Verdict: **Build**, M, low priority. CodeMirror's Markdown mode (already a dependency) in the prompt box; the text sent is the plain text typed. Touches `Workspace.tsx`, a shared file both machines change: say so first.

**T-038. Many attachments, images, videos, HEIC converted.** Docs: `docs/user/composer.md`. Verdict: **Have** (CHAT-13 to CHAT-15, Phase 44 and 67; floor checked before attaching).

**T-039. Follow-ups queued or steered into the running turn; queued messages listed, edited, removed, Send now; a held queue resumed.** Docs: `docs/user/composer.md`. Verdict: **Partly**. Messages queue while Claude works (CODE-32, Phase 37) and Interrupt now exists; the memory note "Queue at Claude's next step" is not built. Build M: the queue as a visible, editable list in the pane; steering only through an SDK call recorded in `docs/sdk-notes.md`; each queued message audited like any prompt. Touches `sessions.ts` and `Workspace.tsx` (shared files).

**T-040. Quote part of a reply into the composer with a comment (Cite in composer).** Docs: `docs/user/composer.md`, `internals/assistant-citations.md`. Verdict: **Build**, S. A selection action in the transcript that inserts the quoted text and your comment as plain text; nothing new stored.

**T-041. Recall sent prompts with Up and Down in an empty composer.** Docs: `docs/user/composer.md`. Verdict: **Build**, S.

**T-042. Edit from here, with Revert files too (worktree only, refused when another session shares the folder).** Docs: `docs/user/composer.md`. Verdict: **Partly**. Retry and Edit (CHAT-21, CHAT-22, Phase 91) and checkpoint restore (CODE-18) exist separately; Retry today leaves files as they are. Build S: one action that forks at the message and restores the checkpoint taken before it, recorded first, refused when another open session uses the same folder or one inside it.

**T-043. Prompt stash (save a draft with its attachments and bring it back).** Docs: `docs/user/composer.md`. Verdict: **Build**, S. Drafts already survive a restart (UX-21); add a stash list beside the prompt library (CTX-11).

**T-044. Commands with `/`, skills with `$`, Restart agent session after a skills change.** Docs: `docs/user/composer.md`. Verdict: **Have** (CTX-10, EXT-04, EXT-05, Start again).

**T-045. `/compact`, idle compaction before the prompt cache expires with a Compact or Keep choice, and an auto-compact threshold.** Docs: `docs/user/composer.md`, `providers-claude.md`. Verdict: **Partly**. Compact after this turn (Phase 46) and the context meter. Build M: when you come back to a large session after the cache window, a Compact or Keep choice beside Send; a threshold only if the SDK exposes one that passes `isSafeInlineSettings`.

**T-046. `/clear`: a fresh agent session in the same thread, marked in the transcript.** Docs: `docs/user/composer.md`. Verdict: **Build**, S. A new SDK session in the same pane through the normal start (org guard, mode set explicitly, Extreme flag carried only if it was on), the earlier transcript kept above a marker, audited.

**T-047. `/goal`, working until a stated goal is met.** Docs: `docs/user/composer.md`. Verdict: **Have** (B25 goal mode).

**T-048. Context chips inline in the text: a terminal excerpt, a review comment, a diff note, a file.** Docs: `docs/user/composer.md`, `internals/composer-context-references.md`. Verdict: **Partly**. Comments on diff lines go into the prompt box (G13), folder mentions (CHAT-16), @ mentions partly (IDE-18). Build M: chips for terminal excerpts and files that send as plain text.

**T-049. Another thread as context (`@` a thread, read on demand), a PR as `#123`, and `@model` to name a model.** Docs: `docs/user/composer.md`. Verdict: **Partly**. `/tell` sends to another session by its code. Build M: an `@session` chip; Claude reads it through a read-only Companion tool that returns the redacted transcript marked untrusted (D-017 labels, B32 taint) and can never send to it. The PR chip waits for T-061.

**T-050. Previews of attached files: highlighted code, CSV and TSV as a table, Markdown and HTML rendered, audio, a ZIP's file list, PDF.** Docs: `docs/user/composer.md`. Verdict: **Partly**. Markdown, pictures and sandboxed HTML (IDE-04), code views (IDE-01). Build S: CSV table, PDF in a sandboxed frame using WebView2's own viewer, ZIP listing without a new dependency if possible.

**T-051. Files attached to answers of an agent's question.** Docs: `docs/user/question-attachments.md`. Verdict: **Build**, S. Through `attach-api` (floor checked first), desktop only, so the phone's scope is unchanged (invariant 11).

**T-052. LaTeX maths rendered in messages.** Docs: `docs/user/appearance.md`. Verdict: **Build**, S. Needs a dependency (KaTeX), stated in BUILD_REPORT; off by default.

**T-053. Send shortcut choice (Enter, or mod+Enter for multiline, or always mod+Enter).** Docs: `docs/user/keybindings.md`. Verdict: **Build**, S, under T-071's rule that no composer chord may match an allow chord on a card.

### 2.5 The conversation and its activity

**T-054. Tool calls grouped into an expandable summary, with Open diff.** Docs: `docs/user/activity-log.md`. Verdict: **Have** (Phase 75 tool tree, CODE-38).

**T-055. Live output of a running command.** Docs: `docs/user/activity-log.md`. Verdict: **Partly**, blocked by the SDK: no live tool output (`docs/sdk-notes.md` "No live tool output", IDE-15). Look again under C-008.

**T-056. Hide successful tool calls, hide all, or Zen (only your message and the final reply); approvals and errors always show.** Docs: `docs/user/activity-log.md`. Verdict: **Partly**. Summary, Normal and Verbose (UX-04). Build S: a failures-only view.

**T-057. Screen reader announcement levels, and the session's status at the start of the window title.** Docs: `docs/user/activity-log.md`. Verdict: **Partly**. Screen reader mode (B40) and one announcer (Phase 75). Build S: a level setting, and a title prefix (Working, Needs you) off by default, never naming a command (anyone who sees the taskbar sees it).

**T-058. Visual replies: an HTML page (chart, table, diagram) in any thread, following the theme, sandboxed, with zoom.** Docs: `docs/user/html-renders.md`. Verdict: **Partly**. Artifacts in chats (CHAT-17, CHAT-18, ADR 0003). Build S: `save_artifact` for coding sessions too, same sandbox and size limits. T3's screenshot check of pages by a headless browser is not part of this (browser automation, T-079).

**T-059. MCP Apps: interactive apps returned by MCP tools, which can call tools and post to the thread.** Docs: `docs/user/html-renders.md`. Verdict: **Conflicts** with the in-process-only MCP rule (CLAUDE.md "Machine facts", SafetyError 17) and invariant 2's single decider: an app posting messages and calling tools is another actor.

**T-060. Find in the thread, including older messages and plans.** Docs: `docs/user/keybindings.md`. Verdict: **Have** (UX-05, Phase 94).

**T-062. Find across every file of a diff, folded files included.** Docs: `docs/user/keybindings.md`. Verdict: **Build**, S, in the Changes pane (CodeMirror search is already there per file).

**T-063. A thread details card with chosen rows: context window with the autocompact mark, usage limits, local servers with Stop, side chats.** Docs: `docs/user/thread-sidebar.md`, `usage.md`. Verdict: **Partly**. The Details panel (O21), with O26 queued for the fuller context split. Build S: choose rows. Local servers belong to E-029 (queued).

### 2.6 Permissions and approvals

**T-064. Permission modes per thread: Supervised, Auto-accept edits, Auto.** Docs: `docs/user/permission-modes.md`. Verdict: **Have** (CODE-04), with the floor and Approver in every mode (invariant 2 as amended).

**T-065. Full access: commands and edits with no approval.** Docs: `docs/user/permission-modes.md`. Verdict: **Conflicts** with invariant 3 (never `bypassPermissions` or an equivalent). Extreme approval is Codehouse's owner-approved answer, and it still stops for floor denies and failures.

**T-066. A default mode for new threads, overridable per project.** Docs: `docs/user/permission-modes.md`. Verdict: **Partly**. The mode is set explicitly on every session. Build S: a per-project default among the four allowed modes; Extreme approval stays a per-session choice.

**T-067. Managed policy: cap the broadest mode, lock settings with a "Managed by" label, allow-list providers, limit clients, turn off remote access and webhooks, update from a mirror; refuse to start on a policy it cannot enforce; `policy check` and `policy show`.** Docs: `docs/user/managed-policy.md`. Verdict: **Partly**. Signed managed policy (B37), IT's signed model list (B19), a session refused under an unverifiable policy. Missing: per-setting locks shown in Settings, ADMX and Intune templates (D-095, queued), a check command. Build M: locks read from the signed managed file, Settings shows the lock and who set it, `npm run policy:check` for a file. An update mirror only for files signed by the release key (updates never break).

**T-068. Subagents' approval requests shown in the parent with the subagent's name; a typed reply declines with feedback.** Docs: `docs/user/permission-modes.md`. Verdict: **Have**: every call reaches canUseTool and the card, Deny with a message (PRODUCT.md), subagent labels (D-017).

**T-069. Remembered approvals ("Allow all edits this session").** Docs: `docs/user/permission-modes.md`. Verdict: **Have**, stricter: Remember writes a policy rule with an id (invariant 5), with lifetimes (C-013), and the session-wide web fetch allow (owner, 13 Nov).

### 2.7 Source control and review

**T-061. Forge connections: GitHub, GitLab, Forgejo and Gitea, Bitbucket, Azure DevOps, others, using the forge's CLI or a saved token.** Docs: `docs/user/source-control.md`. Verdict: **Build (safe variant)**, M. Today "Codehouse itself never pushes or calls GitHub" (BUILD_REPORT "Settings overhaul, pull requests"). Build connectors that are off until the owner switches one on (owner decision, 9 Nov), use the forge's own CLI sign-in (gh, glab, az, tea) so Codehouse holds no token, and read only. Every write (comment, merge, push) goes through the Approver as T-074 says. `apps/host/src/forge/` (new), Settings, Doctor.

**T-070. A turn's own changes in the diff, with restore.** Docs: `docs/user/source-control.md`. Verdict: **Have** (Changes pane, checkpoints, B12, G13, G27 outside git).

**T-072. A Commits picker in the diff pane, and commit links opening there.** Docs: `docs/user/source-control.md`. Verdict: **Partly**. Git panel history (G36) and each step's commits (G17). Build S: pick one commit in Changes; commit links in Claude's words open it.

**T-073. New project with a first commit and optional private GitHub repository; clone from a URL with progress, in host folders.** Docs: `docs/user/source-control.md`. Verdict: **Build (safe variant)**, S. New project from the first prompt exists (CODE-40). Clone and publish are network actions: run them as Claude's calls or as a recorded Codehouse action under the `git-remote` rule (risk 80, asks), never silently.

**T-074. Commit, push and open a pull request with one button; commit messages and PR text written from the changes and the repository's conventions.** Docs: `docs/user/source-control.md`. Verdict: **Build (safe variant)**, S. The Pull requests setting already tells a worktree session to push its branch and run `gh pr create`. Buttons that put the prepared command through the Approver (so Manual asks and Extreme follows its rules), with the message from T-018.

**T-075. A Pull requests page: review, comments, request reviewers, check out, merge, auto-merge, revert, tick description checkboxes, link previews.** Docs: `docs/user/source-control.md`. Verdict: **Build (safe variant)**, L. Read-only views through T-061; each write is a request on the approval card with a rule id, and a merge is never approved by Extreme approval (G20's cannot-be-undone rule). Comments by others are untrusted content (D-061 scan, B32 taint).

**T-076. Review guides: a tour of a change in reading order, Look closely stops, Ask about this stop, Finish review.** Docs: `docs/user/source-control.md`. Verdict: **Partly**. The review card (G16), the evidence walkthrough (G31), codebase tours (D-079, queued). Build M: a Plan-mode session over a temporary worktree writes the guide as a structured block, drawn like G16's card; local branches first, PRs after T-061.

**T-077. Mark files as viewed, with a count; a file changed since comes back marked.** Docs: `docs/user/source-control.md`. Verdict: **Build**, S, in the Changes pane, kept per session.

**T-078. Several linked PRs per thread, linked automatically when the agent runs `gh pr create`, with badges.** Docs: `docs/user/source-control.md`. Verdict: **Build**, M. Linking from the transcript's own `gh pr create` output is local (S); status badges need T-061.

**T-080. Watch a pull request: wake the agent when a check fails, someone comments or the branch conflicts.** Docs: `docs/user/source-control.md`. Verdict: **Build (safe variant)**, M. A routine trigger (B34) that reads `gh pr checks` through T-061 at most every two minutes; a wake is a new turn counted by Extreme approval's turn and spending limits and the trigger caps (T58); others' comments are untrusted content.

**T-081. GitHub stacks: Merge stack, Rebase stack.** Docs: `docs/user/source-control.md`. Verdict: **Build (safe variant)**, L, low priority: writes through the Approver as T-075.

**T-082. Remove agent credits when merging.** Docs: `docs/user/source-control.md`. Verdict: **Conflicts** with owner decision B38 (AI-generated labelling, EU AI Act Article 50) and D-030's approval lineage on commits.

**T-083. Keep the default branch current by fast-forward pulls when the checkout is clean.** Docs: `docs/user/project-settings.md`. Verdict: **Build (safe variant)**, S. Off by default; a recorded Codehouse action under the `git-remote` rule, fast-forward only.

**T-084. Pull request access shared between machines.** Docs: `docs/user/source-control.md`. Verdict: **Conflicts** with invariant 7 (needs other machines' environments, T-093).

### 2.8 Worktrees and projects

**T-085. A worktree per thread; a new thread in an existing worktree; reuse the previous worktree.** Docs: `docs/user/thread-sidebar.md`, `keybindings.md`. Verdict: **Partly**. A worktree per session (B10, CODE-17). Build S: New session in this worktree.

**T-086. Worktree branch names: a static prefix, a model-chosen prefix such as `feat/`, or custom instructions.** Docs: `docs/user/project-settings.md`. Verdict: **Partly**. A branch prefix setting exists. Build S: a semantic name from T-018, checked by the existing `BRANCH_PREFIX` rules.

**T-088. Worktree location.** Docs: `docs/user/project-settings.md`. Verdict: **Have** (BUILD_REPORT "Settings overhaul, worktree location").

**T-089. Automatic worktree cleanup by inactivity, after a merge, or when unchanged; Delete now with results; unused folders listed with sizes.** Docs: `docs/user/project-settings.md`, FAQ. Verdict: **Partly**. The cleanup panel with Remove and Merge back (B10, G14). Build S: policies off by default; never remove a worktree with uncommitted, untracked or ignored files (stricter than T3's default, which deletes ignored files such as `.env`); each removal recorded first.

**T-090. Fast worktree checkout by copy-on-write on macOS; submodule depth.** Docs: `docs/user/project-settings.md`. Verdict: **Build**, S, Mac only, low priority (in the Mac's own files).

**T-091. Project actions: setup scripts on a new worktree, run or stop on settle, shortcuts, preview addresses, declared in a repository file (`t3.json`).** Docs: `docs/user/project-settings.md`, `thread-sidebar.md`. Verdict: **Build (safe variant)**, M. Actions defined in Codehouse's settings run by your click in the terminal pane. A repository's own setup file is untrusted (D-059's pinning pattern): shown, and run only as a request through the Approver, never automatically on worktree creation.

**T-092. Project icons and monograms; pin and archive projects; settings per project with an inheritance chain.** Docs: `docs/user/project-settings.md`. Verdict: **Partly**. Projects in the sidebar, providers per project (B17), test integrity per project. Build S for icons, pin and archive; M for an inheritance view, low priority.

### 2.9 Remote access, the phone and sharing

**T-093. T3 Connect: a cloud account and a tunnel to the machine, up to three machines.** Docs: `docs/user/remote-access.md`, `internals/t3-connect.md`. Verdict: **Conflicts** with invariant 7 (listeners on 127.0.0.1 only) and invariant 8 (their relay is a trusted broker that can hold request bodies; Codehouse's Relay holds only ciphertext). Safe variant already built: the Relay and the passkey phone app (Phase 6, 14 and 17).

**T-094. LAN and Tailscale pairing, Tailscale HTTPS, a hosted web client.** Docs: `docs/user/remote-access.md`, `background-service.md`. Verdict: **Conflicts** with invariant 7.

**T-095. SSH-managed remote environments started by the desktop.** Docs: `docs/user/remote-access.md`. Verdict: **Conflicts** with invariants 7, 6 and 14: work, files and credentials on another machine, reached through a forward. Owner decision needed. A possible variant for the owner to weigh: a full Codehouse on the other machine, with its own org guard and Approver, reached only through an SSH forward to its 127.0.0.1 listener, its Host header allowlist naming the forwarded port.

**T-096. Linked environments (agents on one machine run, message and stop threads on another) and load balancing new threads across machines.** Docs: `docs/user/remote-access.md`, `internals/remote.md`. Verdict: **Conflicts** with invariants 7, 6 and 14, as T-095.

**T-097. Pairing with scoped tokens, approving new devices by matching a code, revoking sessions.** Docs: `docs/user/remote-access.md`. Verdict: **Have** (PHONE-02, PHONE-09); the phone's scope is fixed by invariant 11.

**T-098. A phone app with threads, approvals, prompts and Interrupt.** Docs: README, `docs/user/install.md`. Verdict: **Have**: the passkey PWA (PHONE-01 to PHONE-07), sessions live (O25), prompts and Interrupt signed and audited (G32, O18), starting only routines marked for the phone.

**T-099. Phone notifications when work finishes, fails, needs approval or asks for input.** Docs: `docs/user/mobile-notifications.md`. Verdict: **Have** (PHONE-08, ntfy, Slack, notification kinds).

**T-100. Live Activities, Android live updates and home-screen widgets (agent activity, subscription usage).** Docs: `docs/user/mobile-notifications.md`, `usage.md`. Verdict: **Conflicts** with the owner decision of 13 Nov (no Apple Developer Program, so no native iOS app); a PWA cannot show these. Web push already carries the status.

**T-101. Drafts and messages queued on the phone while offline, sent on reconnect.** Docs: `docs/user/composer.md`. Verdict: **Build (safe variant)**, S. Queuing signed messages offline conflicts with invariant 8 (a fresh nonce and a life of a minute). Keep the draft on the phone offline and sign it with Face ID only when sent online.

**T-102. Phone access to PRs, scheduled tasks, settings, providers and updates.** Docs: `docs/user/source-control.md`, `project-settings.md`, `updating.md`. Verdict: **Conflicts** with invariant 11 as amended 30 Oct (allow, deny, answer, kill switch, see sessions, prompts and Interrupt only).

**T-103. Guest links: a teammate follows a thread in a browser and suggests messages.** Docs: `docs/user/guest-links.md`. Verdict: **Conflicts** with invariants 7, 8, 9 and 11 (a tunnel, plaintext transcript and paths to a browser, a new remote actor). The safe alternative is already built: export with a redaction preview (SHARE-01).

**T-087. Prompt links that open a draft (prompt, repository, model, PR), stripping invisible characters.** Docs: `docs/user/prompt-links.md`. Verdict: **Build (safe variant)**, S. A per-user `codehouse://new?prompt=` handler registered by the installer (and the Mac app's own file), opening a draft only: never a mode, folder, account or send. Invisible characters removed with a warning (G21). Touches the installer: run `scripts/update-e2e.ts`, and the other machine's gate.

### 2.10 Settings, appearance, keyboard and accessibility

**T-104. Light, dark and system appearance; a theme picker.** Docs: `docs/user/appearance.md`. Verdict: **Have**: light and dark following Windows, high contrast (UX-11, Phase 56); one Codehouse look by decision (Phase 21).

**T-105. Custom themes, VS Code theme import, custom CSS, server-published themes, and an agent that restyles the app.** Docs: `docs/user/appearance.md`. Verdict: **Conflicts** with the owner decision of Phase 21 (the Codehouse look as the only look) and invariant 16; an agent restyling the app would also let a session change the screen that shows approvals (invariants 2 and 10 in spirit: the card must show the real command). A variant for the owner: a few accent and text-size choices inside the Ledger tokens, contrast checked to WCAG 2.2 AA, no CSS (S).

**T-106. Panel animation duration, 0 ms by default.** Docs: `docs/user/appearance.md`. Verdict: **Build**, S, low priority; reduced motion always wins.

**T-071. Customisable shortcuts (a settings file with conditions and precedence, new defaults added later).** Docs: `docs/user/keybindings.md`. Verdict: **Build**, M. A shortcut registry in `apps/web` with overrides in settings, read tolerantly. The allow gestures (Ctrl+Enter, the one-second delay on High, typed allow for Severe) can never be rebound or reused (D-092, U4).

**T-107. Keyboard pickers for model, effort, mode, workspace and branch; effort up and down; mod+1 to 9 for the first threads.** Docs: `docs/user/keybindings.md`. Verdict: **Partly**. `/model`, `/effort`, the palette. Build S.

**T-108. F6 to move between areas; arrow keys, F2 rename and Shift+F10 in the thread list.** Docs: `docs/user/keyboard-focus.md`. Verdict: **Partly** (UX-10). Build S: F6 cycle.

**T-109. Back and forward through pages; reopen the last closed tab.** Docs: `docs/user/keybindings.md`. Verdict: **Build**, S.

**T-110. Localisation and right-to-left text.** Source: `apps/web/src/i18n`, `textDirection.ts`. Verdict: **Build**, L, low priority (UK English is the product voice, PRODUCT.md).

**T-111. Trackpad swipe for back and forward.** Source: `HistorySwipeNavigation.tsx`. Verdict: **Build**, S, low priority.

### 2.11 Terminal, browser, files and devices

**T-112. A terminal per thread with server-kept scrollback (5,000 lines), restored after a reconnect, Select all, Jump to latest.** Docs: `docs/user/terminal.md`. Verdict: **Partly**. The terminal pane (IDE-14, Phase 31). Build S: scrollback limits and restore after a restart.

**T-113. A browser panel with tabs, find on the page, and a list of ports the session's processes hold.** Docs: `docs/user/remote-access.md`, `keybindings.md`. Verdict: **Partly**. The local browser pane for localhost (IDE-05, Phase 18). Ports are E-029 (queued, M).

**T-079. Agent-driven browser tabs in a headless Chrome, take and release control, screenshots of rendered pages.** Docs: `docs/user/remote-access.md`, `html-renders.md`. Verdict: **Conflicts**: browser automation and debugging connections are forbidden (expansion-status conflict 1, `scripts/forbidden.mjs`); already listed for the owner.

**T-114. Import cookies from another browser into the app's browser.** Docs: `docs/user/browser-import.md`. Verdict: **Conflicts** with invariant 6 in spirit and 12 (copying sign-in cookies is credential handling) and the viewer's local-only decision.

**T-115. The app as the default web browser (macOS).** Docs: `docs/user/default-browser.md`. Verdict: **Conflicts** with the owner decision that the viewer loads only pages on this computer (BUILD_REPORT "Settings overhaul, browser settings").

**T-116. Open in an external editor (VS Code, JetBrains) at a file and line.** Source: `JetBrainsIcons.tsx`, `editorPreferences.ts`. Verdict: **Build**, S. The Host runs the editor's own command without a shell, recorded as Codehouse's own action.

**T-117. Edit files in the window; search and replace across files; read files outside the workspace read-only.** Docs: `docs/user/composer.md`. Verdict: **Have** (G33, G35, "A file Claude made outside the session folder opens in the pane").

**T-118. A device panel: live iOS Simulator or Android Emulator next to the thread, device tools for agents, SSH device hosts.** Docs: `docs/user/devices.md`. Verdict: **Build**, L, low priority, local only: the Android Emulator on Windows and the iOS Simulator on the Mac; an agent's device commands are shell calls through the Approver. SSH device hosts are out (invariant 7).

### 2.12 Automation and agents working with agents

**T-119. Scheduled tasks: recurring or once, run now, pause; runs go to a new thread each time, one continuing thread, or one thread with a fresh session each run.** Docs: `docs/user/project-settings.md`. Verdict: **Partly**. Routines with schedules and triggers (B34, AUTO-01 to AUTO-03), a worktree per run and recent runs (G23). Build S: the two one-thread destinations.

**T-120. Webhook automations: a public URL, placeholders from the request, signature check, filters, duplicate and burst handling, held while offline.** Docs: `docs/user/project-settings.md`, `internals/t3-connect.md`. Verdict: **Build (safe variant)**, M. A public URL conflicts with invariant 7. Build a trigger endpoint on 127.0.0.1 for tools on this computer (its own bearer token, Host and Origin checks), and polled forge events through T-061; every value from a request wrapped and treated as untrusted (D-061, B32), and runs held to the trigger caps (T58).

**T-121. Orchestration tools for agents: delegate a task to another model, create threads, list, read, send, wait, interrupt.** Docs: `docs/orchestration-v2/orchestrator-mcp-server.md`, `docs/user/outside-agents.md`. Verdict: **Partly**. Hand off a side task and fork (B13), `/tell`, the agents board. Build M: Companion tools to start a session (through the normal start and org guard, in a mode no broader than the caller's, never Extreme unless you set it), read one (redacted, marked untrusted) and wait for it; every call recorded. Relates to E-046 and E-047.

**T-122. Agents scheduling their own recurring work.** Docs: `docs/orchestration-v2/orchestrator-mcp-server.md`. Verdict: **Build (safe variant)**, S. As T3 has it, it conflicts with the routine-trigger rule (never started by its own work, T58). Safe form: the agent drafts a routine through a Companion tool and you save it on the desktop.

**T-123. Outside agents (Claude Code in a terminal, ChatGPT, bots) drive threads through the app's MCP server after an OAuth sign-in.** Docs: `docs/user/outside-agents.md`. Verdict: **Conflicts**: hosted agents need internet reach (invariant 7), this laptop's managed policy blocks HTTP MCP servers on 127.0.0.1 in Claude Code sessions, and another controller of sessions widens invariant 2's single path. Safe form is T-124.

**T-124. Scripts on the machine: `thread start`, `send --wait`, `show`, `list`.** Docs: `docs/user/outside-agents.md`. Verdict: **Build (safe variant)**, M. A `codehouse` command talking to the Host on 127.0.0.1 with its own scoped token (start, send to and read sessions; never decisions, policy, modes beyond the project default, or the kill switch), the token sealed for the user, each call audited with its own channel. Adds a listener client, not a listener.

**T-125. Triage an issue: an agent reads the app's logs and its source for that version and drafts an issue, asking before any fix.** Docs: `docs/user/triage.md`. Verdict: **Build (safe variant)**, S. A Plan-mode session in a temporary folder given a redacted copy of `host.log` and the Doctor report; read only; restart steps are given to you.

**T-126. Threads carry on after an update, crash or restart, at most three automatic resumes in a row.** Docs: `docs/user/updating.md`. Verdict: **Have** (CODE-29, Phase 34 and 43; Extreme's two idle turns stop).

### 2.13 Usage, diagnostics, updates, secrets and voice

**T-127. Usage: tokens, cache savings, model breakdown, estimated cost, periods with shortcuts.** Docs: `docs/user/usage.md`. Verdict: **Have** (OBS-01, Phase 39, B15).

**T-128. Custom model prices and counting one model as another.** Docs: `docs/user/usage.md`. Verdict: **Build**, S.

**T-129. Limits pooled across accounts, one bar segment per account, the next reset and what it returns.** Docs: `docs/user/usage.md`. Verdict: **Partly**. The plan ring per account (OBS-03, Phase 45). Build S: one pooled view across Codehouse's own accounts.

**T-130. Limits from the composer (`/usage-limits`) and in thread details.** Docs: `docs/user/usage.md`. Verdict: **Have** (Phase 45).

**T-131. OpenTelemetry export to your own receiver, with a Test button.** Docs: `docs/user/telemetry.md`. Verdict: **Have** (B36, loopback collector only). T3's product analytics to its own endpoint is not a user feature and is not wanted.

**T-132. Diagnostics: startup crash list with Copy details, process resource telemetry, notices for slow requests and a frozen host, database repair.** Docs: `docs/user/install.md`, `background-service.md`, `internals/resource-telemetry.md`, source. Verdict: **Partly**. Doctor (B07), crash causes in words (PLAT-03), processor and memory bars (CODE-36), the memory governor (C-004); crash bundle E-097 queued. Build S: a notice when the Host's event loop stalls or a request is slow, shown in Doctor (feeds O30, section 4).

**T-133. Update everything at once, Stable and Nightly tracks, rollback, a "could not start" window that offers the last good version, refusing mismatched versions.** Docs: `docs/user/updating.md`, `internals/server-updates.md`. Verdict: **Partly**. The in-app updater with signed parts, staged copy and rollback (PLAT-02, Phase 22 and 95); window and Host ship together. Build M: a second track from the same repository and product id with its own manifest inside the routes, downgrades only to signed releases, proved by `scripts/update-e2e.ts` (updates never break).

**T-134. Secret providers: credential fields filled from 1Password references read when needed.** Docs: `docs/user/secrets.md`. Verdict: **Build (safe variant)**, S, low priority. A connector off by default that runs `op read` without a shell; the value is never stored and is added to the redaction terms (invariant 12); never for Anthropic credentials (invariant 6).

**T-135. An agent asks for a secret in a private card; the value goes to the tool or a private file, never into the conversation.** Docs: `docs/user/secrets.md`. Verdict: **Build (safe variant)**, M. A Companion tool that raises a desktop-only card (not the phone or push, invariants 9 and 11); the value sealed for the user and given to one named command as an environment variable through an edited input that the floor and Approver check again (invariant 10); added to the redaction terms; audited by name only; refused for anything that looks like an Anthropic credential.

**T-136. Voice input: local speech models downloaded and tested, dictionary and project dictionary, filler removal, transcript clean-up, optional cloud transcription with a key.** Docs: `docs/user/voice-input.md`, `composer.md`. Verdict: **Partly**. Windows voice typing behind a flag (Phase 79); G9 (a Whisper-compatible server through 127.0.0.1) is queued. Build M as G9; cloud transcription with a key conflicts with invariant 6 and ADR 0010 unless through a gateway on 127.0.0.1.

**T-137. SnapShots: capture the window you are in with its app name, title and accessibility text, on a global shortcut.** Docs: `docs/user/snap-shot.md`. Verdict: **Partly**. The quick prompt takes a picture of a region or a window (CH-08, `packaging/Capture.cs`). Build S: a global shortcut, the app name and title on the attachment; accessibility text off by default and redacted (pictures are not).

## 3. Suggested build order

Smallest high-value first, in slices of a few days each, each slice on its own branch and released soon after (owner, 12 Nov: small releases).

**Slice T1, the prompt box and the sidebar (all S, `apps/web`, a little `apps/host`).** T-041 recall sent prompts; T-040 cite a reply; T-043 prompt stash; T-025 snooze, with T-026 undo; T-046 `/clear`; T-056 failures-only view; T-057 announcement levels and title status; T-050 CSV and PDF previews; T-051 files in question answers; T-062 find across a diff; T-077 mark files viewed. Say before touching `Workspace.tsx`.

**Slice T2, sessions working together (S to M, `apps/host`, Companion).** T-042 Edit from here with files; T-039 the queue as a list, then steering if the SDK allows; T-034 side sessions with Bring back; T-018 and T-019 titles and commit messages by a no-tools query; T-049 `@session` chips with the read-only Companion tool; T-121 start, read and wait for sessions; T-122 routines drafted by an agent; T-125 triage.

**Slice T3, git and review on this computer (S to M).** T-085 new session in this worktree; T-086 semantic branch names; T-072 Commits picker; T-089 cleanup policies; T-074 commit, push and PR buttons through the Approver; T-073 clone and publish; T-078 PR links from the transcript; T-076 review guides over local branches; T-083 fast-forward pulls.

**Slice T4, forges (M to L).** T-061 read-only forge connectors, then T-080 watch a PR, T-075 the Pull requests page with writes through the Approver, T-081 stacks last.

**Slice T5, keyboard and reach on this computer (S to M).** T-071 shortcuts with locked allow gestures (with D-092); T-107, T-108, T-109 keyboard pickers, F6, back and forward; T-002 and T-005 open a folder from a terminal or a drop; T-087 prompt links; T-031 session links; T-124 the `codehouse` command; T-120 the loopback trigger endpoint; T-006 scratch sessions; T-004 import from Claude Code's history.

**Slice T6, the rest by value.** T-135 secret request card; T-045 idle compaction choice; T-015 handoff rules; T-129 and T-128 pooled limits and prices; T-132 stall notices; T-067 setting locks (with D-095); T-133 a second update track; T-058 artifacts in coding sessions; T-136 voice (G9); T-137 SnapShots; T-112 terminal scrollback; T-029, T-023, T-024, T-027, T-030, T-063, T-066, T-092, T-119, T-017, T-016, T-020, T-037, T-048, T-052, T-053, T-091; then the low-priority large items T-008 WSL, T-118 devices, T-110 localisation, T-090, T-106, T-111, T-134.

**For the owner to decide (not built):** T-009, T-010 other agents; T-011, T-012 keys and launch arguments; T-065 Full access; T-093 to T-096 remote reach; T-100 native phone extras; T-102 wider phone scope; T-103 guest links; T-105 custom themes (or the accent variant); T-079, T-114, T-115 browser; T-059 MCP Apps; T-082 removing AI credits; T-123 outside agents; T-084 shared PR access; T-007 remote-only desktop; T-021 image generation.

## 4. Performance: what Codehouse could measure or adopt

T3 Code treats a dropped frame as a bug and, more usefully, turns performance into budgets that fail locally without depending on how busy the machine is. Codehouse's `docs/performance.md` already has a start budget, virtual lists, a 400-line diff cap and the Approver's limits, and says frame and memory checks are not run each release because timings on this laptop vary. T3's answer to exactly that problem is to budget bytes, rows and counts, which do not vary.

1. **Byte and row budgets as tests.** T3's transfer budget test caps decoded bytes and rows for a 900-row turn, for reconnects that must not resend a snapshot, and for the cold sidebar. Codehouse could add `apps/host/test/wire-budget.test.ts`: the WebSocket bytes the Host sends for opening a 10,000-message session, for a reconnect with nothing new, and for the sidebar's session list with 200 ended sessions, each with a ceiling. Machine-independent, so it can run in the gate, unlike a frame trace.
2. **Bounded first window.** T3 stops a cold open at about 1 MiB or 10 user turns and pages older history over HTTP. Check what Codehouse sends when a pane opens a long session; send the last turns first and page the rest as the Virtuoso list scrolls up.
3. **Leave tool output off the wire until expanded.** T3 omits raw command output and file-change bodies from the stream and fetches them when a row is opened. Codehouse's tool tree could do the same for large `Bash` results and edit diffs, which also cuts the window's memory for the 400 MB target.
4. **Frame metric with a real threshold.** Phase 84's goal is 98% of frames under 50 ms. Add the share of frames over 16.7 ms (one dropped frame at 60 Hz) and the 95th percentile frame time to `scripts/perf-check.ts`, and append each release's figures to a `dist-app\frame-times.jsonl` beside `start-times.jsonl`, said and not failed, as start times already are. Trends across releases are visible even when single runs are noisy.
5. **Closures that keep old renders alive.** T3 found that memoised handlers in large, long-lived components keep earlier renders (with their data) in memory, and writes plain handlers wrapped only where they leave the component. `Workspace.tsx` and `App.tsx` are the large components here. A heap snapshot of the window after scrolling a 10,000-message session, counting retained transcript arrays, would show whether this applies; the fix is a `useStableCallback` pattern.
6. **Stalls in the Host.** T3 shows notices for slow requests and a frozen host, and writes logs asynchronously because synchronous appends stall Node on slow Windows disks. For Codehouse: measure the Host's event-loop delay with `perf_hooks.monitorEventLoopDelay` and show the worst recent delay in Doctor (T-132). This bears directly on O30, the plain `cat` held as evaluator-unavailable: record each Approver call's latency in a small histogram, add "Approver answer, 95th percentile" as a row in `docs/performance.md`, and see whether timeouts line up with loop stalls, memory pressure or the PowerShell worker's cold start. Only `host.log` and telemetry writes may go asynchronous: the audit write stays where it is, because an allow that is not recorded must be refused (invariants 1 and 13).
7. **Sample only while someone looks.** T3's resource monitor samples on a timer only while a diagnostics view is open. Codehouse's processor and memory bars could ask `Codehouse-Limits.exe` for usage only while a pane showing them is visible.
8. **Queries leased to what is on screen.** T3's palette runs Git status and PR lookups only for visible rows. Apply the same rule to T-030's message search and to any per-session Git status in the sidebar.
9. **Startup reads only what needs recovering.** T3 selects sessions to recover from current state without loading finished histories. Phase 51 already shows sessions at once; a budget test that a restart with 500 ended sessions reads no transcript would keep it so.
10. **Panels open instantly by default.** T3's panel animations default to 0 ms with a slider. Codehouse respects reduced motion already; a 0 ms default for panes and the sidebar (T-106) removes a source of jank on a loaded laptop.
