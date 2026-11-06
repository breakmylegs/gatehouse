# Plan: desktop extensions (.mcpb) in Chat

Written 5 Nov 2026 for CH-08 of the owner's Chat build, which says: "`.mcpb` desktop extension install is a later slice behind a flag. Plan it, do not build it now." Nothing here is built.

## What a .mcpb is

A desktop extension is a zip (`.mcpb`, formerly `.dxt`) holding an MCP server and a `manifest.json`: its name, version, author, the server's entry point and runtime (Node, Python or a binary), the tools it offers, and the settings it asks for (some marked sensitive, such as API keys). Claude's desktop app installs one with a click and runs its server locally over stdio.

## Why it waits

- **This laptop's managed policy blocks stdio and http MCP servers in sessions** (docs/sdk-notes.md); only in-process SDK servers run. A .mcpb's server is a separate process over stdio, so it would be refused here today. The Companion reaches sessions as an in-process server for the same reason.
- **The marketplace (W1-19) refuses plugins with out-of-process MCP servers** (CLAUDE.md invariant 2), so extensions need the same scrutiny before any is allowed.
- **Chat's posture (ADR 0012)**: MCP only where a project switches it on.

## The slice, when it is wanted

Behind a flag, `chat.extensions.enabled`, off by default and never on where the managed policy blocks stdio servers (checked at start, as the Doctor does).

1. **Install, read only first.** Choosing a .mcpb (the open window, never a URL) unpacks it with the CH-04 zip reader and its limits, checks `manifest.json` against a schema, and shows what it is: author, version, runtime, every tool with its description, every setting, and whether it is signed. Nothing runs until you install it.
2. **Settings and secrets.** Sensitive settings are sealed with Codehouse-Helper.exe (DPAPI), never written to the settings file or the audit log, and passed to the server only in its environment. Invariant 6 still holds: no Anthropic credential is ever given to an extension.
3. **Running it.** The server starts only for a chat in a project that switches it on, inside a Codehouse-Limits.exe job object (memory, processor and kill-on-close), with a cleaned environment, in its own folder. Every tool call it offers is `mcp__<name>__<tool>` and goes through the floor hook and the Approver like any other: by the existing rule `mcp-external` it escalates (risk 60) until you write a rule for it. Remember rules can allow a tool, never a whole server.
4. **Updates and removal.** A new version is a new install, shown again before it replaces the old; removing deletes its folder and its sealed settings, and is audited.
5. **Audit.** Install, each setting change (by name, never value), enable per project, every start and stop, and removal.

## Tests it will need

Manifest refusals (missing fields, a runtime that is not allowed, a path that climbs out); the zip limits from CH-04; that no tool call skips the Approver; that a sensitive setting never reaches a file, a log or the audit; that the flag stays off where the managed policy blocks stdio servers; and that a removed extension leaves nothing behind.
