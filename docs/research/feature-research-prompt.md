# Research brief: the best features of every coding agent interface, for JCVC

Run this in Claude with Research turned on. Paste the report back into the JCVC build session, or save it as `docs/research/features-<date>.md`.

The earlier brief (`deep-research-prompt.md`, results in `results-2026-10-29.md`) covered Claude Code's surfaces, risks and the Agent SDK. This one is about the **experience**: what each interface does best for the person using it, especially someone who is not a professional developer.

---

## Who I am and what I am building

I am building "Jean-Claude Van Code" (JCVC), a desktop workbench for Windows that runs Claude coding sessions through the Claude Agent SDK. It runs on a managed corporate Windows 11 laptop, signed in through Claude Code's own sign-in. I want it to be the easiest and safest way to build software with an AI agent, for experienced developers and for people "vibe coding" who have never used git or a terminal.

What JCVC has today (29 October 2026):

- **Sessions:** a list; a workspace per session with a transcript, a composer with a plus menu (files, photos, folders, slash commands, skills, connectors, plugins), pasted pictures; up to three sessions side by side; per-session model, effort and mode (Manual, Plan, Accept edits, Auto, Extreme approval; never bypass); resume and fork. A live line says what Claude is doing (thinking, writing a file with the characters so far, running a command).
- **Approvals:** an "Approver" decides every permission request with rules (a floor that is never allowed, then deny, remembered decisions, ask, allow) and a risk score. What it cannot decide waits for you on the desktop (in the queue, or in the session's own workspace with Allow once and Deny) and on an iPhone, ntfy or Slack. A kill switch. A hash-chained audit log of every decision.
- **Policy studio:** rules, rule packs from a library, a "test a command" box, a YAML editor with activate, remembered rules, insights. Today it reads like a firewall console; I want something an average vibe coder can understand and use.
- **Files:** changed files, a folder tree, a viewer for code, markdown, pictures and web pages, a local browser for dev servers. Checkpoints (git snapshots) and restore.
- **Other:** usage and cost, a setup wizard, a built-in user guide, Windows notifications, automatic updates from GitHub releases.

Not built yet: a terminal pane, session management (pin, archive, group, rename, search, export), worktrees and pull requests, scheduled and background tasks, voice, a visible message queue, `@` file autocomplete, a diff pane with comments, a context-used display, a default projects folder where a new project gets its name from the first prompt.

Constraints every idea must respect: Windows 11 managed by my employer (stdio and http MCP servers are blocked inside sessions; in-process SDK servers work); never bypass permissions; never read Claude credentials or tokens; every decision audited; local listeners only on 127.0.0.1 with a token; it must not copy the look of Claude Code or claude.ai or use Anthropic logos ("Powered by Claude" is fine).

## What to research

For each interface below, find the features and design ideas people value most, with evidence (documentation, changelogs, release notes, popular GitHub issues and discussions, Reddit, Hacker News, well-known reviews and videos). Concentrate on what makes the work faster, clearer or safer for the user, not on model quality.

1. **Claude desktop app, Code tab** (Windows and macOS): sessions, side sessions, worktrees, the diff and PR panes, preview, the task list, plan mode, notifications, Remote Control, scheduled tasks, connectors and plugins, settings. What do users praise and what do they still complain about?
2. **Claude Code in the CLI, VS Code and JetBrains**, and Claude Code on the web and mobile: the ideas that the desktop app lacks.
3. **OpenAI Codex**: the desktop app, the CLI, the IDE extension and Codex cloud. Approval modes and sandboxing, how it shows progress, how it hands back results (diffs, PRs), parallel tasks, environments, and anything else users say beats Claude Code.
4. **VS Code itself and GitHub Copilot**: agent mode, the coding agent, Copilot Edits, chat, checkpoints, the "keep or undo" review flow, tool approval, MCP management, terminal integration, Next Edit Suggestions, and the editor features an agent workbench should borrow (command palette, quick open, problems panel, source control view, settings UI with search and instant save).
5. **Tools aimed at non-developers**: Lovable, Bolt.new, Replit Agent, v0, Firebase Studio, Create, and similar. How they start a project from one prompt (naming, templates, folders), show live progress, preview the app, recover from errors, explain what happened, and keep people safe without asking technical questions.
6. **Other agent workbenches** where they have a standout idea: Cursor (agents, background agents, Bugbot, rules), Windsurf, Zed's agent panel, Cline, Roo Code, Kilo Code, Aider, Amp, Warp, Devin, Jules, Gemini CLI, and multi-agent managers (Conductor, Crystal, Claude Squad, Vibe Kanban, opcode, Sculptor and others).
7. **Permission and safety design for people who are not technical.** How these tools, and good consumer examples outside coding (iOS and Android app permissions, browser site permissions, password managers, parental controls, Little Snitch or other personal firewalls, Microsoft Defender's controlled folder access), let ordinary people set rules: plain-language choices, presets ("careful", "balanced", "hands off"), examples instead of syntax, "what would happen if" previews, learning from past decisions, undo. What does research on approval fatigue and warning design say works?
8. **Feedback while the agent works.** How each tool tells you what it is doing during long steps (writing a big file, installing packages, starting up), estimates time, and shows that it has not hung.
9. **Settings and onboarding.** Instant-save settings, search in settings, sensible defaults, first-run flows that get a beginner to a working app in minutes.

## How to report

- Date every claim and link its source. Prefer primary sources. Say when something is announced but not shipped, or older than six months.
- Keep documented fact apart from user opinion.
- Use these sections:
  - **A. Feature matrix.** Rows are features, columns are Claude desktop Code, Claude Code CLI/IDE, Codex, VS Code with Copilot, Cursor, one non-developer tool (Lovable or Bolt), and JCVC as described above. Mark yes, partial, no or unknown, with a source.
  - **B. The 20 ideas users value most**, across all tools, ranked by evidence, each with the tool, what it does, why people like it, and links.
  - **C. Ideas for non-technical users**: starting a project, naming and placing it, previews, explanations, recovering from mistakes.
  - **D. Permission and policy design** for ordinary people: the patterns that work, with examples and the research behind them, and a sketch of how a "policy studio" could look for a vibe coder.
  - **E. Progress and feedback patterns** during long agent steps.
  - **F. A ranked list of 25 concrete improvements for JCVC**, given what it already has and its constraints: the user problem, the evidence, how it beats the other tools, a rough size (small, medium, large) and any dependencies.
- Be factual and dense. Tables are welcome. No marketing language.
