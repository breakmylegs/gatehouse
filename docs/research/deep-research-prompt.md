# Deep research brief: making JCVC better than every official Claude Code surface

Run this in Claude with Research turned on. Save the report as `docs/research/results-<date>.md` so it can be turned into roadmap items.

---

## Who I am and what I am building

I am building "Jean-Claude Van Code" (JCVC), a private desktop workbench for Windows that runs Claude agent sessions through the Claude Agent SDK (TypeScript). It is for my own use on a managed corporate Windows 11 laptop, signed in to Claude with my company's SSO through Claude Code's own sign-in flow. I want it to be the best way to run Claude coding agents: better than Claude Code in the CLI, the VS Code and JetBrains extensions, the Claude desktop app's Code tab, Claude Code on the web, and the mobile apps.

What JCVC already has (29 October 2026):

- A sessions list and a workspace per session; up to three sessions side by side; per-session model, effort and permission mode (Manual, Plan, Accept edits, Auto; never bypass); resume and fork.
- A custom MCP "Approver" that decides every permission request with a policy engine (a floor of never-allowed actions, then deny, remembered decisions, escalate, allow), a library of rule packs, my own rules, replay of a rule change against past decisions, and an optional LLM judge for whitelisted categories.
- Escalated requests go to the desktop and an iPhone (passkey-signed answers through an encrypted relay) at the same time, and to ntfy or Slack with single-use codes. The first valid answer wins. There is a kill switch.
- A hash-chained audit log of every decision, checkpoints (git snapshots) and restore, insights, usage and cost.
- A files panel (changed files, folder tree, viewer for code, markdown, images and HTML), a local browser for dev servers, a composer plus menu (files, photos, folders, slash commands, skills, connectors and plugins as the session reports them), pasted pictures, the plan and task list, diffs in approvals, Windows notifications, a setup wizard and a built-in guide.

Not built yet: a terminal pane, session management (pin, archive, group, rename, transcript search, export), worktrees and pull requests, scheduled tasks and side sessions, a background tasks list, voice, a visible message queue, `@` autocomplete, a session diff pane with comments, a context-used display, and a live status line.

Constraints that every recommendation must respect:

- Windows 11, managed by my employer. The managed Claude Code policy blocks stdio and http MCP servers inside sessions; in-process SDK MCP servers work.
- Never `bypassPermissions`, `dontAsk` or skip-permissions modes. Never read Claude credentials or tokens. Every decision is audited. Listeners bind to 127.0.0.1 only and need a token.
- It must not imitate the look of Claude Code or claude.ai or use Anthropic logos; "Powered by Claude" is fine. It must stay within Anthropic's terms for the Agent SDK and Claude subscriptions. Check what those terms say about third-party apps that use a Claude subscription login, and flag any risk.
- Single user, local. No cloud backend of my own beyond an optional relay.

## What to research

1. **Every official Claude Code surface, as of now.** The full feature inventory of the CLI, the VS Code extension, the JetBrains plugin, the Claude desktop Code tab, Claude Code on the web, the mobile apps, the Slack integration and the GitHub app and Actions. Use Anthropic's documentation (code.claude.com/docs, docs.claude.com, the Agent SDK docs), the Claude Code changelog and the desktop release notes. Note the version and date each feature appeared. Include features in preview or behind flags.
2. **The Claude Agent SDK** (TypeScript and Python): what it can do that the official surfaces do not expose, or expose poorly. Hooks, `canUseTool`, permission prompt tools, sessions (resume, fork, list), subagents, in-process MCP, structured output, setting sources, loading plugins and skills, interrupts, streaming input, context management, cost and usage data, OpenTelemetry. Include recent and announced changes, deprecations and breaking changes.
3. **What users complain about and ask for.** Search the anthropics/claude-code GitHub issues (the open feature requests and bugs with the most reactions and comments), Anthropic's public community spaces, Reddit (r/ClaudeAI, r/ClaudeCode, r/ChatGPTCoding), Hacker News threads and well-known blog posts. Group by theme: permission and approval fatigue, running many sessions, context limits and compaction, cost and rate limits, Windows problems, enterprise and managed settings, trust and safety, remote and mobile use, reviewing what the agent did. Give reaction or comment counts where you can.
4. **The best ideas in other agent tools**, and which ones people say make them better than Claude Code: Cursor (agents, background agents, Bugbot), Windsurf, GitHub Copilot (agent mode, coding agent), OpenAI Codex (CLI, IDE, cloud, desktop), Google Gemini CLI and Jules, Cline, Roo Code, Kilo Code, Aider, Zed's agent panel, Amp, Warp, Devin, Factory, and managers that run many Claude Code agents (Conductor, Crystal, Claude Squad, Vibe Kanban, opcode, Sculptor, Terragon and any others you find). For each, the standout ideas, not a full review.
5. **Human approval and oversight.** Research and good practice on approval prompts and approval fatigue, risk scoring, policy-as-code for agents, allow lists, sandboxing on Windows (AppContainer, Windows Sandbox, WSL, Dev Containers), prompt injection defences for coding agents, audit and tamper evidence, and how enterprises govern coding agents (Anthropic's managed settings and other vendors' admin controls).
6. **Remote and mobile control.** Claude's Remote Control and mobile features, push approvals, how other tools let you steer an agent from a phone, and what works when the laptop cannot accept inbound connections.
7. **Observability and review.** How tools show context used, cost, token burn, live tool activity, timelines, diffs and session replay, and what makes reviewing an agent's work fast.

## How to report

- Date every claim and link its source. Prefer primary sources (Anthropic docs, changelogs, GitHub issues, vendor docs) over commentary. Say when something is announced but not shipped, rumoured, or older than six months and possibly stale.
- Keep documented fact apart from user opinion.
- Use these sections:
  - **A. Feature matrix.** Rows are features. Columns are CLI, VS Code, JetBrains, Desktop, Web, Mobile, Agent SDK, and the two or three strongest competitors. Mark each cell yes, partial, no or unknown, with a source.
  - **B. The top 30 user pain points with Claude Code**, ranked by evidence, each with links and its theme.
  - **C. Ideas worth taking from other tools**: the tool, what it does, and why users like it.
  - **D. Agent SDK capabilities** a custom host can use to beat the official apps, with API names, doc links and limits (rate limits, terms, anything that needs an API key instead of a subscription).
  - **E. Risks**: anything in Anthropic's terms, policies or technical changes that could break or forbid an app like JCVC, especially third-party use of a Claude subscription login, and what to do about each.
  - **F. A ranked list of 25 concrete improvements for JCVC**, given what it already has and its constraints. For each: the user problem it solves, the evidence, how it beats every official surface, a rough size (small, medium, large) and its dependencies.
- Be factual and dense. Tables are welcome. No marketing language.
