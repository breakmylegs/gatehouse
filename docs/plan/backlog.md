# JCVC backlog

One backlog for JCVC, merged on 31 Oct 2026 from four sources. Original ids are kept.

- **F1 to F25**: the feature research of 30 Oct, section F of `docs/research/features-2026-10-30.md`.
- **G1 to G40**: the replacement report of 31 Oct ("what JCVC needs to replace Claude desktop, Codex desktop and VS Code").
- **U1 to U22**: the interface report of 31 Oct. The copy shared on 31 Oct stops part way through U22. U23 to U25 and sections I and J are missing.
- **O1 to O20**: asks from the owner and findings from the code that none of the three lists covers. Sources: `HANDOVER.md`, this session, and the code survey of 31 Oct.

Both reports are research, not specifications. Where they describe JCVC, the code was checked and the code wins. Items the reports tag as inferred are hypotheses here too.

## How to read it

- **Status:** Done, Partly or Not started, with the files that show it. Checked against the code on 31 Oct.
- **Wave:** 1 replaces the Claude desktop Chat tab. 2 replaces its Code tab. 3 replaces Codex. 4 replaces VS Code. "Now" means a fix that should not wait for a wave.
- **Size:** S up to 3 days, M 1 to 3 weeks, L more. Estimates.
- **Constraints:** the owner's seven hard constraints of 31 Oct. "Fits", "Fits with change" (and what changes), or "Conflict".
- **Absorbs:** the ids a merged item takes in. An absorbed id has no row of its own.

## Differences between the reports and the code

The reports were written from the owner's summary. These are the places where the code says otherwise.

| # | Report says | Code says | Evidence |
|---|---|---|---|
| D1 | Web search and research: "Unknown" | Claude Code's WebSearch and WebFetch work in sessions and chats. They escalate by default (network, risk 60); the web-read pack and the Balanced and Hands-off levels allow them. A live probe on 31 Oct confirmed they work on this account and policy. | `policy/rules.yaml:32,47`, `policy/library/web-read.yaml:4-12`, ADR 0007 |
| D2 | Keyboard-first use: "Unknown" | A Ctrl+K palette exists (cmdk), with F1, Ctrl+B, Ctrl+Shift+A and Alt+Up/Down. Its page list is out of date. | `apps/web/src/components/CommandPalette.tsx:5-49`, `App.tsx:42-58` |
| D3 | Artifacts: "local browser preview only" | The file viewer also shows HTML files in a sandboxed frame and renders Markdown. | `apps/host/src/files-api.ts:159-207`, `FilesPanel.tsx:20-22,324-358` |
| D4 | Image input: "pasted thumbnails" | Yes, and since Phase 44 also pictures Claude captures or reads, and yours after a restart. | `apps/web/src/lib/transcript.ts`, Phase 44 |
| D5 | Phone: step-up passkey for the highest tier | Every phone answer is already signed with the passkey (Face ID), which is stronger. ntfy and Slack use codes and refuse Allow for Severe. | `apps/phone/src/core.ts:278-325` |
| D6 | Window: a custom title bar is needed to keep snap layouts | The window is WinForms with the standard title bar, so snap layouts already work. | `packaging/JCVCApp.cs:80-83` |
| D7 | Code font: Cascadia Code, a system font | Cascadia is not installed on this laptop. It comes with Windows Terminal. Code falls back to Consolas. | `C:\Windows\Fonts` has `SegUIVar.ttf` but no Cascadia |
| D8 | Shell side-effect undo: "Nobody undoes non-git writes"; F5 "not built" | A git checkpoint (tracked and untracked files) is taken before every escalated call, shell included. Rule-allowed, Auto and Extreme-approved calls get none. | `apps/host/src/canuse.ts:244`, `hooks.ts:136` |
| D9 | Compliance: audit export plus verifiers | The export is one JSONL file without `head.json`. Both verifiers read only the monthly files, so an export cannot be checked as it is. | `apps/host/src/api.ts:290-299`, `packages/shared/src/audit/writer.ts:36-41` |
| D10 | ROADMAP item lists process, disk and network caps for Low, Medium and High | The job objects set CPU, memory, priority and kill-on-close only. | `packaging/Limits.cs:22-27,160-176` |
| D11 | Costs shown in GBP in the wireframes | The SDK reports US dollars. GBP would need an exchange rate. | `apps/host/src/usage.ts` |
| D12 | Projects group sessions | The sidebar groups sessions by parent folder. There is no project object, and each chat gets a new folder of its own. | `apps/web/src/lib/rail.ts:34-86`, `sessions.ts` |

## Conflicts left for the owner

Not resolved here.

| # | Between | The conflict |
|---|---|---|
| C1 | F24 and G15 | F24 says JCVC never reads `gh` credentials: it calls `gh`, which keeps its own sign-in. G15 proposes a Git host token kept by JCVC in Windows Credential Manager. |
| C2 | F17 and U4 | Both slow down risky approvals. F17 proposes a 1 second delay on high-risk Allow and batching. U4 proposes no default focus at the middle tier and a hold or typed confirmation at the top tier. |
| C3 | F11 and the owner's choice of 30 Oct | F11 proposes Queue or Steer per message. The owner chose that a message sent mid-turn always reaches Claude at its next step, with Interrupt to read it now. |
| C4 | DESIGN.md and the owner's ask of 31 Oct, and U15 | DESIGN.md rejects "a grey sidebar, chat column and right panel clone of a chat client", keeps a slate shell in both themes, bans glass and shadows, sets Bahnschrift, and makes Jean-Claude mode the only look with no plain light or dark theme. The owner now wants a feel closer to Claude Code and Codex, and U15 and U16 propose a neutral Fluent look with Mica and high contrast. |
| C5 | Invariant 16 and the interface report's personality budget | The report keeps the full name for About, the installer and the title, and never a photo of the actor. By owner decision (28 Oct) the full name is on the window, tray, header, installer and phone, and a faint photo is behind every screen. The owner asked for more photos on 31 Oct (O2). |
| C6 | U1 and the no-tooltip rule | U1 proposes a 48 px icon rail with labels on hover. DESIGN.md, PRODUCT.md and the session rules forbid hover tooltips. |
| C7 | Flight-style session codes and Ledger | The codes ("FM 719") are Departures. Ledger would show a small mark and the name. Codes are also in tests and on the phone. |
| C8 | G7 and chats in Plan mode | G7 runs local Python or Node. A chat always runs in Plan mode (owner decision), so it cannot run code. ADR 0003 proposes analysis inside the artifact sandbox instead. |
| C9 | U2 in Wave 1 | The interface report puts the Inbox in Wave 1. It is not needed to stop using the Chat tab, so this plan puts it in Wave 2. |

## Wave 1: replace the Claude desktop Chat tab

| id | Item | Absorbs | Status and evidence | Size | Depends on | Constraints | Acceptance criteria |
|---|---|---|---|---|---|---|---|
| G1 | Command palette for every action, Ctrl+1 to 9 session jumps, a shortcut sheet, ranked by the page you are on | U20 | Partly. Ctrl+K palette for pages, sessions, waiting requests and theme (`CommandPalette.tsx:5-49`). No actions, no Ctrl+1 to 9, no sheet, no ranking. Page list out of date. | S | None | Fits | Every menu action is in the palette. Ctrl+3 shows session 3 in under 100 ms. The sheet lists every binding. The current page's commands rank first. |
| G2 | Quick-launch overlay on a global hotkey | U21 | Not started. Tray only (`JCVCApp.cs:138-147`). | M | G1, ADR 0005 | Fits (per-user `RegisterHotKey`, no admin) | Opens in under 300 ms from the tray. A clash is shown with alternatives. Esc gives focus back to the app you were in. |
| G3 | Chat projects with knowledge files and instructions, plus global and per-session instructions | O17 | Not started. Claude Code loads `CLAUDE.md` itself (`sessions.ts:470`). No project object or instruction UI. | M | ADR 0006 | Fits | Files attach to a project. Each turn shows which knowledge files Claude read. Removing a file stops its use next turn. Global, project and session instructions reach the session in that order, and the session says so. |
| G4 | Editable memory by topic, per project and global | | Not started. Nothing in JCVC (searched for memory, MEMORY.md). | M | G3, ADR 0006 | Fits | Entries can be edited and deleted. Each write and each use is in the audit log. Export and import as Markdown. |
| G5 | Research mode with a sources pane. Web content marked untrusted | O20 (research part) | Partly. Web tools work and the rules cover them (D1). No research mode, no sources pane, no untrusted mark. | M | ADR 0007 | Fits with change: queries leave the computer, so the Approver refuses a query or address that holds a term from the redaction list. It never rewrites it. | Every claim links to a source. Research output saves as Markdown. Sources show as untrusted. A query with a listed term is refused with a rule id. |
| G6 | Artifacts: sandboxed HTML, React, Mermaid and Markdown pages, with versions and export | | Partly. Sandboxed HTML file preview and Markdown (D3). No artifacts, React, Mermaid, versions or export. | M | ADR 0003 | Fits (Companion tool, no network) | An artifact renders with no network: fetch, XHR, WebSocket, forms, pop-ups and top navigation all fail. Versions can be compared. Export writes an HTML file. |
| G7 | Files and data in chats: CSV, PDF and pictures, with charts | | Not started. Any file up to 20 MB can be attached for Claude to read (`attach-api.ts:15-16`). | M | G6 | Fits with change: analysis runs inside the artifact sandbox, not on the computer (C8). XLSX needs a library cleared by IT. | A 50 MB CSV is refused with a clear message and a 10 MB one is summarised. A chart renders as an artifact. Rows are not sent unless the user asks. |
| G8 | Prompt library with variables and slash use, promotable to a skill | | Not started. The plus menu lists the session's commands and skills. Blocked by O7. | S | G1, O7 | Fits | Variables are asked for on use. An entry can be used from the phone later (G32). Promote creates a skill file and audits it. |
| G9 | Voice dictation | | Not started. The window refuses the microphone (`JCVCApp.cs:345-349`). | S | None | Fits with change: no third-party speech service. Windows voice typing (Win+H) may send audio to Microsoft. That is an IT question. | A microphone button starts Windows voice typing in the prompt box. The help says what it uses. |
| G10 | Export to Markdown, HTML and PDF with a redaction preview | O8 | Partly. Markdown export only, not redacted, and long sessions lose their start (`lib/exportMarkdown.ts:26-28`, `transcript.ts:67`). | S | None | Fits | The preview shows redacted terms masked. PDF keeps code blocks. The whole conversation is exported, read from the Host. Each export is in the audit log. |
| G11 | Performance budget | U7 | Partly. Transcript, queue and audit lists are virtualised. Start measured at 22 s first, 11 s after (Phase 26). Diffs are not virtualised. No written budget. | M | None | Fits | A 10,000-message session scrolls without dropped frames in a headless Edge trace. Memory for it stays under 400 MB. Start time is measured on each release. |
| G12 | Accessibility: screen readers, high contrast, 200%, reduced motion, one announcer | U18, U19 | Partly. About 240 aria attributes, reduced motion, a skip link, risk shown by shape, word and number. No high contrast, no announcer service, session states by colour and word only. | M | U15 | Fits | Narrator and NVDA read tool calls, why-lines and new requests once each. Every action is keyboard reachable. Forced colours works. Session states have a shape. |
| U1 | A fixed rail of places, reorderable, every one in Ctrl+K | | Partly. Rail with Dashboard, Needs you, New, Search, pinned pages and More (`Rail.tsx:91-180`). Fixed order. Ctrl+K misses five pages. | S | G1 | Fits with change: visible labels, no hover tooltips (C6). | The order you set survives an update. Every page is in Ctrl+K. No place shows before its wave. |
| U5 | Transcript views: Summary, Normal, Verbose, per session | | Not started. Tool runs fold into one line (`lib/groups.ts:85`). | S | None | Fits | The view is kept per session. Summary keeps approvals, errors and why-lines. The scroll position stays on switch. |
| U6 | Tool-call rows as a keyboard tree | | Partly. Grouped rows that open (`Workspace.tsx:1158-1225`). No tree role or arrow keys. | S | ADR 0001 | Fits | Arrow keys move and open rows. A screen reader reads each row as a sentence. |
| U8 | Layout kept and never reset, with presets; sidebar width by drag | O4 | Partly. Page, panes, pins and drafts kept in WebView2 storage, which survives updates. No presets, side panels or widths. | S | None | Fits | After an update the layout is the same. Four presets. The sidebar width follows a drag and the arrow keys, and is kept. |
| U15 | The new look (Ledger) on Fluent tokens, light, dark and high contrast, following Windows. Per-session text size and density | O5, O12, O19 | Not started. Departures tokens (`styles.css:7-79`). The system theme is read once only. No high contrast. | M | ADR 0001, ADR 0002, C4, C5, C7 | Fits (no Anthropic look, Segoe UI Variable by name only) | An automated test fails on an orange-family accent and on any text pair under AA. The window follows a Windows theme change. Forced colours passes a manual check. Text size and density are kept per session. |
| U16 | Mica with an opaque fallback | | Not started. Opaque form and WebView2 background (`JCVCApp.cs:85,88`). | S | ADR 0004 | Fits | No white flash. Opaque when transparency effects are off, in high contrast, below build 22621, or when turned off in Settings. |
| U22 | Policy level cards with examples, and Try it | F1 | Partly (close). Three levels, Always blocked, Learned from you, Try it (`PolicyChoices.tsx:168-468`). The cards are prose. | S | None | Fits | Each level lists five example asks it allows and five it asks about. Try it can run against any level. |
| F19 | Settings in sections with search, modified markers and restart flags | O6 | Partly. Instant save and restart now or later (`Settings.tsx`). One long page, no search, no markers. | S | U15 | Fits | Settings opens on a list of sections. Search finds any setting by label or help text. A changed setting shows a marker. |
| O3 | The session footer: a smaller activity line that folds, a session bar that folds to one line, PC resources named plainly, split panes level | | Not started. Asked 31 Oct. Draft code in `C:\dev\.agentic-scratch\jcvc\footer\`. | S | U15 | Fits | Folds are kept and shared by every pane. Prompt boxes in split view sit level. The resources choice reads "This PC". |
| O7 | The composer refuses any slash command it does not know, so Claude Code commands and skills from the plus menu cannot be sent | | Done 31 Oct (W1-01, Phase 49). Was a bug found 31 Oct (`Workspace.tsx:926-967`). | S | None | Fits | A Claude Code command or skill named in the plus menu is sent as typed. JCVC's own commands still work. |
| O9 | JCVC does not itself check that sessions use only in-process MCP servers; it relies on the managed policy | | Done 31 Oct (W1-01, Phase 49). Claude.ai connectors are left to the policy. Servers a plugin adds after start are not checked yet. | S | None | Fits (enforces constraint 3) | A session whose init message lists a stdio, HTTP or SSE MCP server stops with a safety error, tested with the fake SDK. |
| O14 | Hook-bypass decision for plugins (open since 31 Oct) | | Open owner decision. A plugin's PreToolUse "allow" hook might skip `canUseTool` in Manual mode. Probes were inconclusive. | S | Owner | Must fit constraint 1 | Decision recorded. Until then plugins with hooks are refused. |
| O1 | Marketplace for skills and plugins (owner, 30 Oct) | O20 (plugins and skills part) | Not started. Research done (`HANDOVER.md` item 20). Install blocked on O14. | M | O14 | Fits with change: browse first. A plugin with hooks or MCP servers that are not in-process is refused. | Browse the catalogue, see what a plugin contains, install through the unmodified binary, audited. |

## Wave 2: replace the Claude desktop Code tab

| id | Item | Absorbs | Status and evidence | Size | Depends on | Constraints | Acceptance criteria |
|---|---|---|---|---|---|---|---|
| G13 | Diff review: line comments sent as one batch, keep or reject each hunk, multibuffer | U10, F6 | Partly. Changed files with diffs, undo per file or all, with a confirmation and a checkpoint (`ChangesPane.tsx:38-235`). No hunks, no comments. | M | None | Fits | Comment on three lines and send once. Rejecting one hunk reverts that hunk only. Each hunk shows the decision that allowed it. |
| G14 | Git worktree per session, with merge back | F20 | Not started. Only `git worktree list` is allowed (`git-read.yaml:29`). Files, checkpoints, Changes and Terminal assume one folder. | M | None | Fits | Two sessions edit one repository without clashing. Merge back shows a diff first. Orphan worktrees are pruned only after you confirm. Junctions are never followed. |
| G15 | Pull requests and CI with an attempt cap and Merge when ready | F24 | Not started. `gh *` escalates at risk 80 (`rules.yaml:33`). | M | G14, C1, IT | Fits with change: call `gh` and its own sign-in. JCVC keeps no token (C1). | A PR opens from a session. A failing check gets at most three fix attempts. Merge needs an approval record. |
| G16 | Local code-review card: walk through, fix one, apply all | | Not started. Blocked by O7. | S | G13, O7 | Fits | Findings are grouped by file. Fix applies one finding only. A dismissal is recorded. |
| G17 | Plans and specs tied to the build queue | F8, O10, O11 | Partly. Plan panel from TodoWrite, plan cards, Extreme approval's build queue (`carry-on.ts`). The panel ignores TaskCreate and TaskUpdate. QUEUE EMPTY matches anywhere in a reply. | M | None | Fits | Spec files live in the repository. A task links to its commits. A task with failing tests cannot be ticked. The queue's end is read only from a reply's last line. |
| G18 | Side chat (Ctrl+;) and @session messages | U9, F21 | Not started (`companion/src/handlers.ts:100`). | S | None | Fits (messages go through the Approver) | Side chat reads the session without adding to it. An @mention reaches the named session and is logged. |
| G19 | Loop and stuck guard and a cost budget per task, with a phone alert | O16 | Partly. "Possibly stuck" after 120 s in the window only. Extreme approval's limits and stall guard. No loop detection, no budget outside Extreme, no phone alert. | S | None | Fits | The same failing command three times pauses the session. 80% of a budget sends a phone alert. Resume needs a tap. Stuck detection runs on the Host. |
| G20 | Effects and reversibility on approvals | U3, F5 (the reversibility line) | Partly. Risk score, band and shape, the risky segment, Where, Target, Why (`ApprovalCard.tsx`). `Verdict` has no field for effects. | M | Contract change through Approver, Host, Relay and phone | Fits | `rm` or `del` shows a file count and paths. Irreversible actions are never allowed by themselves. The card says how to undo. The phone shows the same. |
| U4 | Gestures in proportion to risk | F17 | Partly. Focus never moves to Allow. At risk 70 and over, Deny is the main button and Allow needs Ctrl+Enter. The queue still has one-click Allow at any risk (`Approvals.tsx:132-135`). | S | C2 | Fits | No default focus on Allow above Low. Severe needs a hold or typed confirmation on every surface. Severe can never become a rule. |
| G21 | Prompt-injection taint and hidden Unicode | | Not started. Only the optional judge refuses instruction-like input (`judge.ts:36-37`). | M | G5 | Fits | A planted README asking for `curl ... | sh` escalates even in Auto. Hidden Unicode is shown. Taint shows on the why-line. |
| G22 | Secret scanning on commit, export, relay and outbound prompts | | Partly. Redaction on the audit log, the phone, ntfy and Slack. The floor blocks secrets files by path. No scan on `git commit`. Export not redacted (O8, in G10). | S | None | Fits with change: a plain in-repo scanner. Never gitleaks (owner's rule). | A test AWS key blocks a commit. Relay payloads are redacted. A false positive needs a rule to pass. |
| U2 | One Inbox shared with the phone | | Partly. One approvals queue on desktop and phone, answered once (`Approvals.tsx`, phone `App.tsx:603-606`). No failures, reviews or parked actions in it. | M | C9 | Fits | An item shows on both within 2 s. Answering on one makes the other read-only. Counts match the Host. |
| F2 | Why-line with a safer alternative | | Partly. The why-line is built (Phase 38). No safer alternative. | S | None | Fits | A blocked call suggests one allowed alternative where a rule names one. |
| F15 | @ file mentions with autocomplete and line ranges | | Partly. The plus menu inserts @ mentions (`Workspace.tsx:920-921`). | S | None | Fits | Typing @ lists files in the folder. `@file.ts:10-20` sends the range. |
| F22 | Terminal pane: "Ask about this output" | | Partly. Your own PowerShell pane, audited (Phase 31). | S | None | Fits (your commands stay outside the Approver, as now) | A button sends the selected output to the session as a quoted message. |

## Wave 3: replace Codex

| id | Item | Absorbs | Status and evidence | Size | Depends on | Constraints | Acceptance criteria |
|---|---|---|---|---|---|---|---|
| G23 | Automations: schedules and triggers, a review inbox, parked actions | U12, F23 | Not started. Only the daily digest scheduler (`digest.ts:10`). Waiting requests already park and reach the phone. | M | G14, G26, U2 | Fits (never "approval never": unapproved actions park) | A nightly job runs in a worktree. A blocked action parks and does not fail. The inbox shows the diff, evidence and cost. |
| G24 | Task board across sessions | U13 | Not started. | M | G14 | Fits | Dragging a card to Running starts a session. The board survives a restart. Space and the arrow keys move cards, and moves are announced. |
| G25 | Best of N in separate worktrees, compared | F25 | Not started. | M | G14 | Fits | Three runs from one prompt. A table compares tests passed, diff size and policy hits. The losing worktrees go when you pick. |
| G26 | A Windows sandbox for agent commands with no admin | | Not started. Job objects give CPU, memory, priority and kill-on-close only (D10). Commands run with the user's full token. | L | IT | Fits with change: AppContainer or a restricted token, and a user-mode egress proxy on 127.0.0.1 that needs a token. No firewall rules, Windows Sandbox, WSL or Dev Drive (all need admin). | A write outside the workspace is denied. A host not on the allowlist is unreachable. Works on a standard user account. |
| G27 | Undo of shell side effects outside git | F5 (snapshots) | Partly. A git checkpoint before every escalated call (D8). Nothing before rule-allowed, Auto or Extreme calls, and nothing outside the repository. | L | G26 | Fits | A deleted untracked file comes back. An undo list per command. Junction targets are never followed. |
| G28 | Install guard for new dependencies | | Partly. Install commands ask at risk 70. The packages pack allows project installs. No age, typosquat, install-script or OSV checks. | M | IT (OSV through the proxy) | Fits with change: lookups through the corporate proxy | A package under 7 days old escalates. A postinstall script is flagged. A typosquat of a top-1000 package is blocked. |
| G29 | Approval quality and rules that expire | F3, F4 | Partly. Escalation and approval rates, time to decide, suggestions, remember rules listed and removed (`analytics.ts`, `PolicyChoices.tsx:301-377`). No expiry, no last used, no watch mode. | S | None | Fits | The dashboard shows approval rate and median decision time. A candidate rule needs your accept. Rules expire unless renewed. |
| G30 | A signed compliance bundle with a verifier | | Partly. Hash-chained log, two verifiers, a JSONL export that cannot be verified as it is (D9). An Ed25519 signer exists for updates. | S | None | Fits | The verifier finds one changed byte. The bundle is redacted. Each export is in the audit log. |
| G31 | An evidence walkthrough per task | U11, F10 | Not started. Building blocks exist: why-lines, folded runs, Changes, audit by session. | M | G6, G30 | Fits | Every finished task has a walkthrough with plan, diff, tests and approvals. Its audit ids open the records. |
| G32 | Phone: start tasks, read summaries, see diffs, steer | O18 | Partly. Approve, deny, answer, kill switch, a message tied to a decision (`apps/phone/src/App.tsx`). No sessions, starts, diffs or steering. | M | G8, G20 | Fits (passkey-signed and audited, invariant 11) | A new task from the phone starts a session. A diff is readable on the phone. An approval shows its effects. |
| U14 | Phone approval card with step-up | | Done, with a caveat (D5). Nothing varies by tier. | S | U4 | Fits | Nothing to do unless U4 adds a hold gesture. |
| F13 | "Check my app": a preview self-test with a screenshot and console errors | | Not started. | L | G39, IT for browser automation | Fits with change: IT approval | A run reports console errors and a screenshot of the page. |

## Wave 4: replace VS Code

| id | Item | Absorbs | Status and evidence | Size | Depends on | Constraints | Acceptance criteria |
|---|---|---|---|---|---|---|---|
| G33 | Monaco editor (edit mode first, possibly in Wave 2) | | Not started. The viewer is read-only and the files API writes nothing (`files-api.ts:11`). | M | None | Fits (Monaco is MIT) | Edit and save any workspace file. An outside change asks to merge. A 5 MB file stays responsive. |
| G34 | Language servers, also given to Claude through a Companion tool | | Not started. | L | G33, IT (new binaries) | Fits with change: user-scope installs, endpoint security may flag binaries | F12 jumps to a definition. Rename updates every reference. Claude's tool returns diagnostics. |
| G35 | Search and replace across files | | Not started. Search covers past conversations only (`history.ts:43-45`). | S | G13 | Fits | A regex over 100,000 files in under 2 s. Replace shows hunks first. Undo works. |
| G36 | Git panel: graph, hunk staging, blame, merge-conflict editor | | Not started. The Changes pane is checkpoint-based, not a git view. | M | G33 | Fits | A graph of 10,000 commits renders. A conflict is resolved in the editor. A proposal is never applied by itself. |
| G37 | Debugger through DAP | | Not started. | L | G33, G34 | Fits with change: netcoredbg, debugpy, js-debug. Not Microsoft's vsdbg. | A breakpoint hits in Node, Python and .NET. Claude's breakpoint actions are logged. |
| G38 | Test explorer | | Not started. `npm test*` is allowed (`rules.yaml:42`). | M | G37 | Fits | Tests listed per file. A failure opens at its line. "Fix this" makes a scoped task. |
| G39 | Click-to-edit in the preview, and "Fix this error" with a loop guard | F12 | Not started. The local browser frame has no console capture (`FilesPanel.tsx:204,325-331`). | M | G6 | Fits | Clicking an element gives a prompt with file and line. A console error makes a fix task, retried at most once. |
| G40 | Templates, local SQLite and sign-in scaffolding, secrets in Credential Manager, share as zip | F7 (done part) | Partly. New project from the first prompt with git (F7, Phase 29). | L | G39, G26, IT for any public host | Fits with change: a public host needs IT | A new app from a sentence runs locally in one click. Secrets never reach the repository. The zip leaves secrets out. |

## Done or nearly done

| id | Item | Status and evidence |
|---|---|---|
| F7 | New project from the first prompt into a projects folder | Done (Phase 29). The blueprint card and opening in Plan mode were not built, and sit in G40. |
| F9 | Three-state live status, heartbeat, stall rule | Done (Phases 27, 30). |
| F11 | Visible message queue | Done as the owner chose (Phase 37). See C3. |
| F14 | Rename, pin, archive, group, search, export | Done (Phases 30, 32). |
| F16 | Context meter with a plain explanation and Compact | Done (Phases 32, 35, 46). |
| F18 | A visible, locked Never list | Done (Phase 28). |
| O15 | The floor did not cover an added account's sign-in | Fixed 31 Oct (Phase 47). |

## Other owner items

| id | Item | Status |
|---|---|---|
| O2 | More Jean-Claude pictures in rotation (30 Oct) | Waiting for the owner's pictures. See C5. |
| O4 | Drag the sidebar wider or narrower (31 Oct) | In U8. |
| O5 | Per-session text size and Normal or Compact layout (31 Oct) | In U15. |
| O6 | Settings shown and organised like the desktop apps (31 Oct) | In F19. |
| O12 | The window reads the system theme once and never again, and has no forced-colors styles | In U15. |
| O17 | One instruction for every session at its start, and one per session (31 Oct) | In G3. |
| O18 | Sessions on the phone, with prompts and Interrupt (owner decision, 30 Oct) | In G32. |
| O19 | A look that feels more like Claude Code and Codex, less retro (31 Oct) | In U15. See C4. |
| O20 | Chat with what the Claude desktop app has: deep research, plugins and skills (31 Oct) | In G5 and O1. |
| O8 | Export loses the start of long sessions and is not redacted | In G10. |
| O10 | The Plan panel ignores TaskCreate and TaskUpdate | In G17. |
| O11 | QUEUE EMPTY matches anywhere in a reply | In G17. |
| O13 | Preview tokens outlive their session. The local browser frame allows same origin for any localhost port. | Hardening, Wave 2. A page on another port is a different origin and cannot read JCVC's storage, and the Host refuses its Origin. Low risk. |
| O16 | Stuck detection runs only in the window, and the end of an Extreme run reaches no phone | In G19. |
