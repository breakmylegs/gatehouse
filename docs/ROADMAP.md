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

## What JCVC already has

Sessions list and workspace, model and mode choice, plan, approvals with the Approver, diff in approvals, checkpoints and restore, audit, policy, insights, phone approvals, setup wizard, sign-in from the app, folder chooser, Jean-Claude mode, usage and cost.

## The queue

| # | Item | Notes |
|---|---|---|
| 1 | **Per-session controls**: model list as in Claude (Opus 5.5, Opus 5, Sonnet 5.5, Sonnet 5, Haiku 5.5, Haiku 4.5), effort, permission mode, and Extreme approval as a per-session mode | Extreme moves from an app-wide setting to the session. `acceptEdits` and `auto` are added to the allowed modes, which amends invariant 3; `bypassPermissions`, `dontAsk` and `allowDangerouslySkipPermissions` stay forbidden. The floor hook and the audit still apply in every mode. |
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
