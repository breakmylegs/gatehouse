builtslice/T1-sidebar |builtslice/T1-sidebar |# t3code features in Codehouse (O31)

The review is `docs/research/t3code-review-2026-11.md` (owner, 14 Nov: "Review this and implement all the features into codehouse. This is the priority task and top of queue"). Build the Build and Partly items in the review's slice order, each slice on its own branch and released soon after; Conflicts items are listed for the owner, with the invariant each would weaken, in the review. Read this file first after a restart.

Slices, in order:
- Slice T1: the prompt box and the sidebar (all S, `apps/web`, a little `apps/host`)
- Slice T2: sessions working together (S to M, `apps/host`, Companion)
- Slice T3: git and review on this computer (S to M)
- Slice T4: forges (M to L)
- Slice T5: keyboard and reach on this computer (S to M)
- Slice T6: the rest by value

| Id | Feature | Verdict | Status | Branch | Note |
|---|---|---|---|---|---|
| T-001 | Desktop app for Windows, macOS and Linux, and package-manager installs. | Have | built (Codehouse had it) | | |
| T-002 | Open a project in the running app from a terminal (`t3 app <folder>`). | Build, S | todo | | |
| T-003 | Background service at sign-in, restarted if it exits. | Have | built (Codehouse had it) | | |
| T-004 | Welcome page that finds installed agents and imports recent projects and conversations from Claude Code's history. | Partly | todo | | |
| T-005 | Drop a folder on the sidebar to open it as a project. | Build, S | todo | | |
| T-006 | Threads without a project, in dated scratch folders, and Turn into project. | Partly | todo | | |
| T-007 | Desktop as a remote only, with no local server. | Conflicts | listed for decision | | |
| T-008 | Run agents and projects inside a WSL distro. | Build, L | todo | | |
| T-009 | Other coding agents (Codex, Cursor, Grok, OpenCode, Antigravity, Kiro, Pi, Muse Code, fx) on their own sign-ins. | Conflicts | listed for decision | | |
| T-010 | ACP Registry agents and local ACP commands, downloaded and run by the app. | Conflicts | listed for decision | | |
| T-011 | Provider instances with their own environment variables, API keys, base URLs and routers (OpenRouter, Claude Code Router, CLIProxyAPI hubs). | Conflicts | listed for decision | | |
| T-012 | Binary path and launch arguments per provider (for example `--chrome`, `--settings`). | Conflicts | listed for decision | | |
| T-013 | Several Claude accounts through separate config folders. | Have | built (Codehouse had it) | | |
| T-014 | Provider version warnings, Update now, readiness timeouts. | Have | built (Codehouse had it) | | |
| T-015 | Change model mid-thread, and switch provider with a budgeted context handoff. | Partly | todo | | |
| T-016 | Custom models and display names for models. | Partly | todo | | |
| T-017 | Remembered model and options for new threads, and a project default model. | Partly | todo | | |
| T-018 | Text generation: thread titles, commit messages, PR titles and descriptions, branch names, with optional API-key text generators. | Build (safe variant), S | partly built | slice/T2-titles | titles built (no tools, on the session account check, recorded); commit messages, PR texts and branch names follow in slice T3 (T-074, T-086) |
| T-019 | Regenerate title, and title instructions. | Build, S | built | slice/T2-titles | Name it again, and How you like titles in Settings |
| T-020 | Suggested next prompt after a turn (Tab to fill, never sent). | Build, S | todo | | |
| T-021 | Image generation (Codex). | Conflicts | listed for decision | | |
| T-022 | Threads outlive the agent process; stop and resume. | Have | built (Codehouse had it) | | |
| T-023 | Pin threads and drag to reorder or between sections. | Partly | todo | | |
| T-024 | Settle finished threads, automatically after inactivity or a merged PR, Never per thread. | Partly | todo | | |
| T-025 | Snooze a thread until a time or until limits reset; it wakes early for an approval, a question or a failure. | Build, S | todo | | |
| T-026 | Undo for sidebar actions (a five-second notice, mod+Z). | Build, S | todo | | |
| T-027 | A folded Working section for busy threads. | Partly | todo | | |
| T-028 | Group threads by project. | Have | built (Codehouse had it) | | |
| T-029 | Send the same prompt to several models, each in its own worktree; start in the background and open a fresh draft. | Partly | todo | | |
| T-030 | Search every thread by title, branch, PR and project, and inside messages, from the palette. | Partly | todo | | |
| T-031 | Copy a link or id for a thread. | Build, S | todo | | |
| T-032 | Subagent threads, an Agents view, and Stop that stops subagents too. | Have | built (Codehouse had it) | | |
| T-033 | Limited state with Resume, Resume at reset and Snooze until reset. | Have | built (Codehouse had it) | | |
| T-034 | Side chats (`/side`, `/btw`) with tools, their own composer, and Bring back. | Partly | built | slice/T2-side | /side opens beside the pane (not a tab), Plan mode, Bring back |
| T-035 | Threads from older versions migrated on first start. | Have | built (Codehouse had it) | | |
| T-036 | A large paste becomes an attachment. | Have | built (Codehouse had it) | | |
| T-037 | Rich-text Markdown composer (styled as you type, list continuation, code blocks with a language). | Build, M | todo | | |
| T-038 | Many attachments, images, videos, HEIC converted. | Have | built (Codehouse had it) | | |
| T-039 | Follow-ups queued or steered into the running turn; queued messages listed, edited, removed, Send now; a held queue resumed. | Partly | partly built | slice/T2-held | held until the turn ends: listed, edited, removed, sent now, resumed; steering a running turn waits for an SDK call recorded in sdk-notes |
| T-040 | Quote part of a reply into the composer with a comment (Cite in composer). | Build, S | built | slice/T1-composer | |
| T-041 | Recall sent prompts with Up and Down in an empty composer. | Build, S | built | slice/T1-composer | |
| T-042 | Edit from here, with Revert files too (worktree only, refused when another session shares the folder). | Partly | built | slice/T2-edit-revert | worktree only, refused when another open session shares the folder, recorded first |
| T-043 | Prompt stash (save a draft with its attachments and bring it back). | Build, S | built | slice/T1-composer | |
| T-044 | Commands with `/`, skills with `$`, Restart agent session after a skills change. | Have | built (Codehouse had it) | | |
| T-045 | `/compact`, idle compaction before the prompt cache expires with a Compact or Keep choice, and an auto-compact threshold. | Partly | todo | | |
| T-046 | `/clear`: a fresh agent session in the same thread, marked in the transcript. | Build, S | built | slice/T1-sidebar | |
| T-047 | `/goal`, working until a stated goal is met. | Have | built (Codehouse had it) | | |
| T-048 | Context chips inline in the text: a terminal excerpt, a review comment, a diff note, a file. | Partly | todo | | |
| T-049 | Another thread as context (`@` a thread, read on demand), a PR as `#123`, and `@model` to name a model. | Partly | partly built | slice/T2-linked | @session as context with read_linked_session; the PR chip waits for T-061 and @model is not built |
| T-050 | Previews of attached files: highlighted code, CSV and TSV as a table, Markdown and HTML rendered, audio, a ZIP's file list, PDF. | Partly | partly built | slice/T1-previews | CSV and TSV as a table. PDF left out: previews are served with a sandbox policy, which stops the browser's PDF viewer, and loosening it is not worth it; pdf.js would be a new dependency. ZIP listing left for later |
| T-051 | Files attached to answers of an agent's question. | Build, S | built | slice/T1-answers | desktop only, through Add files' route |
| T-052 | LaTeX maths rendered in messages. | Build, S | todo | | |
| T-053 | Send shortcut choice (Enter, or mod+Enter for multiline, or always mod+Enter). | Build, S | todo | | |
| T-054 | Tool calls grouped into an expandable summary, with Open diff. | Have | built (Codehouse had it) | | |
| T-055 | Live output of a running command. | Partly | todo | | |
| T-056 | Hide successful tool calls, hide all, or Zen (only your message and the final reply); approvals and errors always show. | Partly | built | slice/T1-sidebar | Failures only, a fourth level beside Summary, Normal and Verbose |
| T-057 | Screen reader announcement levels, and the session's status at the start of the window title. | Partly | built | slice/T1-a11y | Settings, Appearance: announcement level, title status off by default |
| T-058 | Visual replies: an HTML page (chart, table, diagram) in any thread, following the theme, sandboxed, with zoom. | Partly | todo | | |
| T-059 | MCP Apps: interactive apps returned by MCP tools, which can call tools and post to the thread. | Conflicts | listed for decision | | |
| T-060 | Find in the thread, including older messages and plans. | Have | built (Codehouse had it) | | |
| T-062 | Find across every file of a diff, folded files included. | Build, S | built | slice/T1-find | Find in every file, in the Changes pane |
| T-063 | A thread details card with chosen rows: context window with the autocompact mark, usage limits, local servers with Stop, side chats. | Partly | todo | | |
| T-064 | Permission modes per thread: Supervised, Auto-accept edits, Auto. | Have | built (Codehouse had it) | | |
| T-065 | Full access: commands and edits with no approval. | Conflicts | listed for decision | | |
| T-066 | A default mode for new threads, overridable per project. | Partly | todo | | |
| T-067 | Managed policy: cap the broadest mode, lock settings with a "Managed by" label, allow-list providers, limit clients, turn off remote access and webhooks, update from a mirror; refuse to start on a policy it cannot enforce; `policy check` and `policy show`. | Partly | todo | | |
| T-068 | Subagents' approval requests shown in the parent with the subagent's name; a typed reply declines with feedback. | Have | built (Codehouse had it) | | |
| T-069 | Remembered approvals ("Allow all edits this session"). | Have | built (Codehouse had it) | | |
| T-061 | Forge connections: GitHub, GitLab, Forgejo and Gitea, Bitbucket, Azure DevOps, others, using the forge's CLI or a saved token. | Build (safe variant), M | todo | | |
| T-070 | A turn's own changes in the diff, with restore. | Have | built (Codehouse had it) | | |
| T-072 | A Commits picker in the diff pane, and commit links opening there. | Partly | partly built | slice/T3-commits | Look at a commit in Changes; commit links in Claude's words not built |
| T-073 | New project with a first commit and optional private GitHub repository; clone from a URL with progress, in host folders. | Build (safe variant), S | todo | | |
| T-074 | Commit, push and open a pull request with one button; commit messages and PR text written from the changes and the repository's conventions. | Build (safe variant), S | built (safe variant) | slice/T3-ship | requests in the prompt box; Claude runs each command through the Approver |
| T-075 | A Pull requests page: review, comments, request reviewers, check out, merge, auto-merge, revert, tick description checkboxes, link previews. | Build (safe variant), L | todo | | |
| T-076 | Review guides: a tour of a change in reading order, Look closely stops, Ask about this stop, Finish review. | Partly | todo | | |
| T-077 | Mark files as viewed, with a count; a file changed since comes back marked. | Build, S | built | slice/T1-changes | a changed file comes back unmarked |
| T-078 | Several linked PRs per thread, linked automatically when the agent runs `gh pr create`, with badges. | Build, M | partly built | slice/T3-prlinks | linked from gh pr create in the transcript; badges wait for T-061 |
| T-080 | Watch a pull request: wake the agent when a check fails, someone comments or the branch conflicts. | Build (safe variant), M | todo | | |
| T-081 | GitHub stacks: Merge stack, Rebase stack. | Build (safe variant), L | todo | | |
| T-082 | Remove agent credits when merging. | Conflicts | listed for decision | | |
| T-083 | Keep the default branch current by fast-forward pulls when the checkout is clean. | Build (safe variant), S | partly built | slice/T3-pull | Pull (fast-forward only) in the Git pane, through the policy; pulling by itself is not built |
| T-084 | Pull request access shared between machines. | Conflicts | listed for decision | | |
| T-085 | A worktree per thread; a new thread in an existing worktree; reuse the previous worktree. | Partly | built | slice/T3-here | New session in this worktree, in the pane menu |
| T-086 | Worktree branch names: a static prefix, a model-chosen prefix such as `feat/`, or custom instructions. | Partly | built | slice/T3-branches | named from the task, without a model: kind of change and words, your prefix kept |
| T-088 | Worktree location. | Have | built (Codehouse had it) | | |
| T-089 | Automatic worktree cleanup by inactivity, after a merge, or when unchanged; Delete now with results; unused folders listed with sizes. | Partly | built | slice/T3-cleanup | rules off by default, never a dirty, untracked or ignored worktree, recorded first |
| T-090 | Fast worktree checkout by copy-on-write on macOS; submodule depth. | Build, S | todo | | |
| T-091 | Project actions: setup scripts on a new worktree, run or stop on settle, shortcuts, preview addresses, declared in a repository file (`t3.json`). | Build (safe variant), M | todo | | |
| T-092 | Project icons and monograms; pin and archive projects; settings per project with an inheritance chain. | Partly | todo | | |
| T-093 | T3 Connect: a cloud account and a tunnel to the machine, up to three machines. | Conflicts | listed for decision | | |
| T-094 | LAN and Tailscale pairing, Tailscale HTTPS, a hosted web client. | Conflicts | listed for decision | | |
| T-095 | SSH-managed remote environments started by the desktop. | Conflicts | listed for decision | | |
| T-096 | Linked environments (agents on one machine run, message and stop threads on another) and load balancing new threads across machines. | Conflicts | listed for decision | | |
| T-097 | Pairing with scoped tokens, approving new devices by matching a code, revoking sessions. | Have | built (Codehouse had it) | | |
| T-098 | A phone app with threads, approvals, prompts and Interrupt. | Have | built (Codehouse had it) | | |
| T-099 | Phone notifications when work finishes, fails, needs approval or asks for input. | Have | built (Codehouse had it) | | |
| T-100 | Live Activities, Android live updates and home-screen widgets (agent activity, subscription usage). | Conflicts | listed for decision | | |
| T-101 | Drafts and messages queued on the phone while offline, sent on reconnect. | Build (safe variant), S | todo | | |
| T-102 | Phone access to PRs, scheduled tasks, settings, providers and updates. | Conflicts | listed for decision | | |
| T-103 | Guest links: a teammate follows a thread in a browser and suggests messages. | Conflicts | listed for decision | | |
| T-087 | Prompt links that open a draft (prompt, repository, model, PR), stripping invisible characters. | Build (safe variant), S | todo | | |
| T-104 | Light, dark and system appearance; a theme picker. | Have | built (Codehouse had it) | | |
| T-105 | Custom themes, VS Code theme import, custom CSS, server-published themes, and an agent that restyles the app. | Conflicts | listed for decision | | |
| T-106 | Panel animation duration, 0 ms by default. | Build, S | todo | | |
| T-071 | Customisable shortcuts (a settings file with conditions and precedence, new defaults added later). | Build, M | todo | | |
| T-107 | Keyboard pickers for model, effort, mode, workspace and branch; effort up and down; mod+1 to 9 for the first threads. | Partly | todo | | |
| T-108 | F6 to move between areas; arrow keys, F2 rename and Shift+F10 in the thread list. | Partly | todo | | |
| T-109 | Back and forward through pages; reopen the last closed tab. | Build, S | todo | | |
| T-110 | Localisation and right-to-left text. | Build, L | todo | | |
| T-111 | Trackpad swipe for back and forward. | Build, S | todo | | |
| T-112 | A terminal per thread with server-kept scrollback (5,000 lines), restored after a reconnect, Select all, Jump to latest. | Partly | todo | | |
| T-113 | A browser panel with tabs, find on the page, and a list of ports the session's processes hold. | Partly | todo | | |
| T-079 | Agent-driven browser tabs in a headless Chrome, take and release control, screenshots of rendered pages. | Conflicts | listed for decision | | |
| T-114 | Import cookies from another browser into the app's browser. | Conflicts | listed for decision | | |
| T-115 | The app as the default web browser (macOS). | Conflicts | listed for decision | | |
| T-116 | Open in an external editor (VS Code, JetBrains) at a file and line. | Build, S | todo | | |
| T-117 | Edit files in the window; search and replace across files; read files outside the workspace read-only. | Have | built (Codehouse had it) | | |
| T-118 | A device panel: live iOS Simulator or Android Emulator next to the thread, device tools for agents, SSH device hosts. | Build, L | todo | | |
| T-119 | Scheduled tasks: recurring or once, run now, pause; runs go to a new thread each time, one continuing thread, or one thread with a fresh session each run. | Partly | todo | | |
| T-120 | Webhook automations: a public URL, placeholders from the request, signature check, filters, duplicate and burst handling, held while offline. | Build (safe variant), M | todo | | |
| T-121 | Orchestration tools for agents: delegate a task to another model, create threads, list, read, send, wait, interrupt. | Partly | built | slice/T2-orchestrate | start (asks you), read and wait; delegate to another model and interrupt not built |
| T-122 | Agents scheduling their own recurring work. | Build (safe variant), S | built | slice/T2-routine-drafts | drafted by a session, saved only by you on the desktop |
| T-123 | Outside agents (Claude Code in a terminal, ChatGPT, bots) drive threads through the app's MCP server after an OAuth sign-in. | Conflicts | listed for decision | | |
| T-124 | Scripts on the machine: `thread start`, `send --wait`, `show`, `list`. | Build (safe variant), M | todo | | |
| T-125 | Triage an issue: an agent reads the app's logs and its source for that version and drafts an issue, asking before any fix. | Build (safe variant), S | built | slice/T2-triage | a Plan-mode chat given the redacted log and Doctor report; drafts an issue |
| T-126 | Threads carry on after an update, crash or restart, at most three automatic resumes in a row. | Have | built (Codehouse had it) | | |
| T-127 | Usage: tokens, cache savings, model breakdown, estimated cost, periods with shortcuts. | Have | built (Codehouse had it) | | |
| T-128 | Custom model prices and counting one model as another. | Build, S | todo | | |
| T-129 | Limits pooled across accounts, one bar segment per account, the next reset and what it returns. | Partly | todo | | |
| T-130 | Limits from the composer (`/usage-limits`) and in thread details. | Have | built (Codehouse had it) | | |
| T-131 | OpenTelemetry export to your own receiver, with a Test button. | Have | built (Codehouse had it) | | |
| T-132 | Diagnostics: startup crash list with Copy details, process resource telemetry, notices for slow requests and a frozen host, database repair. | Partly | todo | | |
| T-133 | Update everything at once, Stable and Nightly tracks, rollback, a "could not start" window that offers the last good version, refusing mismatched versions. | Partly | todo | | |
| T-134 | Secret providers: credential fields filled from 1Password references read when needed. | Build (safe variant), S | todo | | |
| T-135 | An agent asks for a secret in a private card; the value goes to the tool or a private file, never into the conversation. | Build (safe variant), M | todo | | |
| T-136 | Voice input: local speech models downloaded and tested, dictionary and project dictionary, filler removal, transcript clean-up, optional cloud transcription with a key. | Partly | todo | | |
| T-137 | SnapShots: capture the window you are in with its app name, title and accessibility text, on a global shortcut. | Partly | todo | | |
