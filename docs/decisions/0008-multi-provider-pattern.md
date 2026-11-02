# ADR 0008: How other AI providers would run in Codehouse

Status: Accepted for the groundwork, 1 Nov 2026 (owner: pick the best options, safety first). Built: the contract, the registry, the loop gate, the executor and the conformance suite (Phase 81), behind `providers.multi.enabled`, off by default. No provider other than Claude exists yet.

## Context

The owner asked for Codehouse to work with other AI products as well as Claude (OpenAI, Gemini, Grok, open models). Their research (`docs/plan/multi-provider-research.md`) proposed two ways to fit a provider in: wrap a vendor's own agent and gate it from the vendor's hook ("wrap"), or have Codehouse run the agent loop and execute every tool itself, so a model can only ask for a tool ("loop"). Codehouse's invariants (floor, Approver, fail closed, edited input checked again) hold only if every tool call passes a gate Codehouse controls.

## What was checked (1 Nov, against the vendors' own pages)

- **OpenAI Codex hooks** (learn.chatgpt.com/docs/hooks, where developers.openai.com/codex/hooks now redirects): "Treat tool hooks as a useful guardrail, not a complete enforcement boundary." A PreToolUse answer of `ask` "is not supported yet": "Codex marks the hook run as failed, reports the error, and continues the tool call." Hosted tools such as `WebSearch` do not fire PreToolUse ("These don't use the local function-tool hook path"). For MCP tool hooks, "Errors, missing servers, and unavailable tools don't block the operation." All as the research said.
- **GitHub Copilot SDK pre-tool hook** (docs.github.com): `allow`, `deny` and `ask`, with `modifiedArgs`; "Return `null` or `undefined` to allow the tool to execute with no changes." The page does not say what an error or a timeout does. So a wrap would have to make every other answer a deny itself, and its coverage is not documented.
- Not re-checked: the Gemini CLI, Antigravity, Grok Build and OpenCode findings. They only argue against wrapping, which this decision does not do.

## Decision

- **Loop by default.** A provider other than Claude runs as a loop: Codehouse offers the model only Codehouse's canonical tools, each request goes through the same gate as Claude's calls (the floor in the Host, then the session's `canUseTool`: the Approver, a person, edited input checked again, the audit), and Codehouse's executor runs it only with the allow for that call, bound to the hash of the input allowed.
- **Wrap only after the conformance suite passes**, with the vendor in its strictest mode and every hosted tool off. Today only Claude (through the Agent SDK's `canUseTool` and PreToolUse) is a wrap. The Copilot SDK would need a spike (research S-15) before it could be one.
- **Codex is not wrapped**, for the reasons checked above. OpenAI models would come through a loop.
- **Canonical tools take the input shape of the Claude Code tool of the same kind** (`read` as `Read`, `shell` as `PowerShell`, and so on), so the floor, the rules and remember rules judge a call from any provider exactly as they judge Claude's, with no rule changes.
- **The conformance suite** (`apps/host/src/providers/conformance.ts`) is what a provider must pass before it can be switched on: fail closed on a gate error, a stuck gate and a malformed answer; no setting that approves by itself; only the allowed input runs; results redacted; the organisation checked. It looks at the file system to see whether a tool ran.

## Consequences

- Codehouse carries its own executor (read, write, edit, glob, grep, a PowerShell command, a web fetch). Session store, compaction, subagents and an MCP bridge come with the first loop provider (research S-06, S-07), not before.
- Vendor agents' own features (their subagents, their sandboxes) are not used.
- Nothing changes for Claude sessions: they still start through SessionManager. The Claude adapter describes them and checks the organisation the same way.

## Constraint check

Fits. No invariant changes. The Approver stays the single decider, every provider's calls are audited by the same `canUseTool`, and the off-by-default setting keeps all of it out of the way until a provider exists.
