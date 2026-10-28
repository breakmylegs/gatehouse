# JCVC roadmap: what the Claude desktop app offers, and what JCVC will do about it

The owner asked (28 Oct) for the features of the Claude desktop app's Code tab to be built into JCVC. This is the working queue. It is ordered, one item at a time, each shipped with tests and a package rebuild. While a gate or build is running, the next item is designed or built alongside it, with at most two jobs at once.

Rules that stay true for every item: the security invariants in `CLAUDE.md`; features are copied, the visual design is not (invariant 16); anything shown to the user says JCVC; everything is local and per session.

## What the Claude desktop Code tab offers (research notes)

From the app's own behaviour, the screens the owner has shared, and its documentation:

1. **Sessions**: a list with state, pinned and archived sessions, groups, unread marks, a new session from a folder, resume and fork, session titles, usage and cost per session.
2. **Per-session controls**: model, effort (low, medium, high, extra, max), permission mode (auto, manual, accept edits, plan, bypass if the organisation allows), fast mode, Remote Control.
3. **Composer**: a plus menu (add files or photos, add folder, slash commands, connectors, plugins), `@` file mentions, slash commands and skills, queued messages, voice input, attachments, drag and drop.
4. **Side-by-side sessions**: split view to watch two or more sessions at once.
5. **Files and preview**: see the files a session created or changed, a diff view, a file tree of the working folder, an inbuilt browser pane for local pages and dev servers, open in editor, reveal in Explorer.
6. **Terminal pane** per session, for the user's own commands.
7. **Plan and task panes**: the plan Claude proposes, the task list as it progresses, chapters.
8. **Worktrees**: each session can work in its own git worktree and branch, with sync with the base branch.
9. **Pull requests**: bind a PR, show CI and review status, auto-fix failing CI, merge.
10. **Scheduled and background work**: scheduled tasks, background sessions, side sessions started from a session, hand-off of a task to a new session.
11. **Extensions**: connectors (MCP servers), plugins, skills, subagents, hooks.
12. **Settings and preferences**: notifications, keep awake, auto-archive, branch prefix, output style, theme.
13. **Search and history**: search across session transcripts, export a transcript.

### Confirmed detail (research rerun on Opus 5.5, 28 Oct)

- Permission modes and their wording: Manual (asks before edits or commands), Accept edits (accepts file edits and common filesystem commands, still asks before other terminal commands), Plan (explores and proposes without editing), Auto (a background classifier checks each action), Bypass permissions (only with "Allow bypass permissions mode" turned on). The choice is remembered per folder.
- Effort: low, medium, high, xhigh (shown as Extra high) and max (Max, current session only). The model and effort share one menu.
- Panes: drag, resize and pop out; split view by Alt-clicking a session; a file tree with tabs; a diff view with line comments; a browser pane for dev servers from `.claude/launch.json` with element picking; a terminal with tabs; a background tasks list; a side chat (`/btw`) that is not saved.
- Composer: the plus menu (files or photos, folder, skills, connectors, plugins, slash commands), drag and drop of images and PDFs, `@` file mentions, queued messages you can reorder, prompt suggestions accepted with Tab, voice.
- Sessions: Ctrl+K searches all sessions including archived ones; pin, group, archive, delete; nested sessions that report back; resume CLI sessions; scheduled tasks with history and their own mode and model.
- System: notifications when a session you are not viewing finishes, a tray icon that asks before quitting while work is running, and keep awake while Claude works.

Source: Anthropic's documentation for the desktop app (code.claude.com/docs/en/desktop, permission-modes, model-config, desktop-scheduled-tasks) and the desktop release notes.

## What JCVC already has

Sessions list and workspace, model and mode choice, plan, approvals with the Approver, diff in approvals, checkpoints and restore, audit, policy, insights, phone approvals, setup wizard, sign-in from the app, folder chooser, Jean-Claude mode, usage and cost.

## The queue

| # | Item | Notes |
|---|---|---|
| 1 | **Per-session controls**: model list as in Claude (Opus 5.5, Opus 5, Sonnet 5.5, Sonnet 5, Haiku 5.5, Haiku 4.5), effort, permission mode, and Extreme approval as a per-session mode | Extreme moves from an app-wide setting to the session. `acceptEdits` and `auto` are added to the allowed modes, which amends invariant 3; `bypassPermissions`, `dontAsk` and `allowDangerouslySkipPermissions` stay forbidden. The floor hook and the audit still apply in every mode. |
| 1b | **Approver workbench**: see and work with the MCP server that decides (status, restart, the tools it offers, run a request through it and see which rule decided and why, recent decisions it made, its health and policy hash) | Builds on the Policy page's test panel and the Approver status in the header. Restart goes through the supervisor, never around it. |
| 1c | **A large preseeded rule library** that you can edit: ship many more built-in rules grouped by theme (git, package managers, build tools, cloud CLIs, file edits, web, PowerShell, MCP servers), each with a plain reason; copy a built-in rule into your own rules, change it, switch it off or remove it | Built-in and your own rules stay separate files. The floor (never allowed) stays fixed and cannot be switched off, copied into an allow or edited. Every rule has a test in the golden set. |
| 1d | **Built-in user guide and page help**: a full user guide inside the app, and a help pane that slides out on the right of every page with detailed help for that page, so nobody has to open a document in a folder | Help is written as app content (one source per page, plus the guide), searchable, opened with a Help button and F1. Every place that says "see docs/..." is replaced by a link into the guide. |
| 1e | **Run the Relay inside the app**: a switch that starts the phone Relay as a managed child of JCVC, only while JCVC is running, with its address, the one-time token filled in for you, and a way to reach it over https (tunnel or tailnet) | Replaces typing a token from a data folder. It binds to loopback; the https front is the part that needs the owner's choice of tunnel. |
| 1f | **More notification channels with remote approval** (for example ntfy, Pushover, Telegram, Slack, Teams, Discord, email, web push for Android and desktop browsers) | Each channel must keep invariant 8: a decision only counts if it is verified by the Host (a signed, single-use, expiring answer bound to the exact request). iPhone with a passkey stays the strongest. Channels that cannot sign are limited to low-risk requests by a setting, and every channel is audited by name. |
| 2 | **Files panel**: the files a session created or changed, and the working folder as a tree; open a file in an inbuilt viewer (text, code, images, markdown, html preview) or reveal it in Explorer | Read-only, inside the session's folder only, never outside it. |
| 3 | **Inbuilt browser pane** for a local html file or a dev server address on this computer | Sandboxed frame, loopback and file addresses only. |
| 4 | **Split view**: two or more sessions side by side | Per-session transcripts and composers in columns. |
| 5 | **Composer plus menu**: add files or photos, add folder, slash commands from the session, connectors and plugins as seen by the session | Attachments sent as path references the session can read inside its folder. |
| 6 | **Terminal pane** per session | Needs a design that keeps the Approver and floor honest: the user's own commands, clearly separate from Claude's. |
| 7 | **Session management**: pin, archive, group, rename, search transcripts, export a transcript | |
| 8 | **Worktrees** per session and **pull request status** | Uses git and `gh` on this computer. |
| 9 | **Scheduled tasks and side sessions** | |
| 10 | **Voice input, queued messages, `@` mentions** | |

Items 1 to 5 are the next ones to build. Items 6 to 10 are designed after those ship.

## Progress

- **Done (28 Oct):** 1 per-session controls (mode, effort, model, Extreme approval per session); 1d built-in user guide and help pane on every page (F1); Windows notification from the tray when a decision is waiting, sent by the Host itself so it works while the window is hidden or minimised; the Departures visual identity across the desktop app.
- **Done since:** 1b Approver workbench, 1c preseeded rule library with your own rules.
- **Next:** 1e Relay inside the app, then 2 files panel and 3 inbuilt browser, 4 split view, 5 composer plus menu.
- **Research:** the notes above were checked against Anthropic's documentation for the Claude desktop Code tab (code.claude.com/docs/en/desktop and related pages) on 28 Oct.

## Design notes: 1c rule library (next)

- Packs ship in `policy/library/*.yaml` (git, Node and npm, Python, .NET, build tools, PowerShell read-only, cloud CLIs read-only, containers read-only, file reading, documentation sites). Each rule has an id, a plain reason and golden cases. A pack does nothing until it is switched on.
- Your own rules live in `rules.user.yaml` in the data folder: packs switched on, rules you copied and changed, and built-in allow or escalate rules you switched off. The floor and deny rules can never be switched off, copied into an allow, or edited.
- The loader merges base rules, switched-on packs and your rules, refuses duplicate ids, and keeps the floor first. With no packs switched on, the 489 golden cases give exactly today's decisions.
- The Policy page gets a Library: switch packs on and off, copy a rule into your own rules and edit it, switch off or remove. Every change is checked by a dry load first, and the replay shows which past decisions it would change before you save.
