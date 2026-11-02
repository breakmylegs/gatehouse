# Multi-provider expansion: the owner's research (1 Nov 2026)

The owner asked (1 Nov 2026): "Add to the very end of the build queue the updating of the app to be for multiple AI products. This is the claude chat research. You will also want to do your own research and then after that build the features." The report below is what Claude chat returned to the prompt given the same day, kept as it came except for the build session's notes at the top. It is research, not a decision: every claim marked U, "prior knowledge" or third party must be checked before a slice relies on it, and the build session does its own research first.

## Build session notes (read these first)

- **Invariant 6 is not changed by this file.** ADR-003 below proposes rewording the credential invariant so Codehouse may present a credential to the vendor endpoint it belongs to (Pattern B needs that). Changing an invariant is the owner's decision with security sign-off, not the build session's; until then no Pattern B provider ships. The stricter options stay preferred: an OS broker (MSAL with WAM) so refresh tokens never reach Codehouse, access tokens in memory only, any API key DPAPI-sealed and opened only inside the request.
- **Order kept from the owner's queue:** this is the last item, after the interface remake and everything else queued on 1 Nov.
- **Done 1 Nov (Phase 81):** the key claims checked, ADRs 0008 to 0011 written (0010 and 0011 proposed), S-01 to S-04 built behind `providers.multi.enabled`. Corrections found: xAI ZDR is no longer enterprise-only; Azure's 30-day figure is not on Microsoft's current pages; the Ollama 0.34.2 floor is third-party only.
- **First steps when it comes up:** verify the report's key claims against primary sources (hook coverage and fail-closed behaviour per vendor, Azure OpenAI data terms, the Windows broker from Node, MCP bridging under the managed policy), write the ADRs into `docs/decisions`, then build S-01 to S-04 (contract, Claude behind it, executor, conformance harness) behind an off-by-default setting before any non-Claude provider.
- The report's file paths (`src/providers/...`) are suggestions; the real layout is `apps/host`, `apps/web`, `packages/policy`, `packages/shared`.

---

# Codehouse (Gatehouse) multi-provider expansion: research report, architecture and build plan

Research date: 1 November 2026. Audience: Chief Architect. Status: decision-ready draft.

Codehouse should expand by running the agent loop itself ("Pattern B") for every new provider, starting with Azure OpenAI and a local OpenAI-compatible runtime, because no non-Claude vendor agent tested here offers a pre-execution gate that provably covers every built-in tool and fails closed.

## TL;DR

- **Build Pattern B first.** Codehouse owns the loop, executes every tool itself and calls models over their APIs. Ship Azure OpenAI (Responses API, Entra ID sign-in) as the first non-Claude provider end to end behind an off-by-default setting, then a local runtime (Ollama 0.34.2 or later, or llama.cpp server) on the same engine.
- **Wrap only one vendor agent, and only after a spike.** The GitHub Copilot SDK is the single credible "wrap" candidate: its `onPreToolUse` hook returns allow, deny or ask with `modifiedArgs`, and `onPermissionRequest` covers shell, write, MCP and URL kinds. Codex CLI is excluded for now because its own docs say hooks are "not a complete enforcement boundary", a hook "ask" lets the tool run, and hosted web search skips the hook.
- **Leave out for now:** Codex CLI and app-server wrapping, Gemini CLI and Antigravity CLI, Grok Build, OpenCode, Aider, Cline, Roo, Continue, OpenHands, Goose, vLLM on the laptop, and Realtime or GPT-Live. Add Gemini (via Vertex AI, now Gemini Enterprise Agent Platform) and xAI API as Pattern B providers once legal confirms zero data retention terms.

## Key findings

### What decides the architecture

- **Interception is the deciding question.** Codehouse's invariants (floor, Approver, fail closed, re-check of edited input) only hold if every tool call passes a gate Codehouse controls. In a wrapped vendor agent, the gate is the vendor's hook system, so its coverage and failure behaviour become Codehouse's security boundary.
- **Vendor hook systems in late 2026 are useful guardrails, not boundaries.**
  - OpenAI's Codex hooks page states: "Treat tool hooks as a useful guardrail, not a complete enforcement boundary." It also states that "Some specialized tool paths can opt out of the default hook path." [1]
  - Codex PreToolUse fails open on "ask": "`permissionDecision: "ask"` ... are parsed but not supported yet. Codex marks the hook run as failed, reports the error, and continues the tool call." [1][2][3]
  - Codex hosted tools "such as `WebSearch`" do not fire PreToolUse: "These don't use the local function-tool hook path." [1]
  - Gemini CLI hooks are shell commands configured in settings files, and a third-party gate project (openmoat issue 257) warns about "fail-open exit-code behaviour". [4]
  - Antigravity CLI 1.2.7 on Windows 11 had a reported bug where a PreToolUse hook returning `allow` did not allow the call (issue 1053). A Google Cloud community write-up (agy 1.4.5) states "allow is a no-op, not an approval; only auto_approve suppresses a prompt". [5][6]
- **Pattern B removes the dependency.** When Codehouse defines the tools and executes them, the model can only request a tool. Nothing runs unless Codehouse's executor runs it after the floor and the Approver. This is the only pattern where every invariant is provable by Codehouse's own tests.
- **The cost of Pattern B** is that Codehouse must build and maintain its own tool executor, session store, compaction and subagent orchestration, and it must present the credential on each API call (see ADR-003).

### Provider-by-provider verdicts

| Candidate | Verdict | Pattern | Reason in one line |
|---|---|---|---|
| Azure OpenAI (Responses API) | Support first | B | Entra ID SSO through Microsoft's own broker, tenant check, no training on data, Modified Abuse Monitoring route |
| Local runtime (Ollama, llama.cpp server, LM Studio) | Support second | B | Data never leaves the laptop, but runtimes need version floors and loopback checks |
| OpenAI API direct (Responses) | Support if contract exists | B | Same engine as Azure, ZDR by approval, data residency options [7] |
| Gemini via Vertex AI / Agent Platform | Support third | B | Contractual training restriction, ZDR is a set of conditions, cloud identity for org check [8][9] |
| xAI API | Support after legal | B | 30-day default retention (xAI security FAQ), ZDR enterprise-only with a verifiable response header |
| GitHub Copilot SDK | Spike, then decide | A | Best hook contract found (allow, deny, ask, `modifiedArgs`), but coverage list and ordering not documented [10] |
| OpenAI Agents SDK | Use as a library inside Pattern B, optional | B | `needsApproval` and interruptions map cleanly, but Codehouse's own loop is simpler to prove [11] |
| Codex CLI / app-server | Leave out | (A) | Hook "ask" fails open, hosted web search bypasses hooks, app-server is experimental [3][12] |
| Gemini CLI | Leave out | (A) | Being transitioned to Antigravity CLI, consumer tiers stopped 18 June 2026 [13] |
| Antigravity CLI / SDK | Leave out, revisit | (A) | Young, hook semantics changed and buggy on Windows, SDK is Python [5] |
| Grok Build | Leave out, revisit | (A) | Early beta, but notable: PreToolUse still runs in always-approve mode and `dontAsk` mode exists [14] |
| GitHub Copilot CLI | Leave out (use the SDK instead) | (A) | The SDK exposes the same runtime with programmatic callbacks |
| OpenCode | Leave out | (A) | `permission.ask` plugin hook is declared but "never triggered" (issue 47674) [15] |
| Aider, Cline, Roo, Continue, OpenHands, Goose | Leave out | n/a | IDE-bound or own-UI agents, no external fail-closed gate Codehouse can own, or not Windows-native |
| vLLM | Server only, not laptop | B (remote) | "vLLM does not support Windows natively" per vLLM docs [16] |
| OpenAI Realtime / GPT-Live | Out of scope | n/a | Voice and contact-centre use, not coding sessions |

## Comparison matrix

Legend: Y = yes and verified in official docs, P = partial, N = no, U = not verified in this research. Items marked "prior knowledge" were not re-verified on 1 November 2026.

### Matrix part 1: questions 1 to 4

| Candidate | Q1 What it is, Windows | Q2 Interception | Q3 Sign-in and org check | Q4 Modes and sandbox |
|---|---|---|---|---|
| Claude Agent SDK (baseline) | SDK driving signed Claude Code binary, Windows native | Y, `canUseTool` and PreToolUse with edited input | Company SSO, org guard in place today | Manual, Plan, Accept edits, Auto map natively |
| Codex CLI + app-server | Rust CLI, npm or Store install. Windows native sandbox: `mxc` recommended on Windows 11 24H2 build 26100.9278+, `elevated` and `unelevated` are legacy fallbacks | P. PreToolUse covers shell, `apply_patch`, MCP, local function tools. Not hosted `WebSearch`. "ask" fails open. `updatedInput` supported with "allow". App-server approvals cover command execution and file changes only | ChatGPT sign-in or API key or Codex access token. Org check via managed `forced_chatgpt_workspace_id` and `allowed_chatgpt_workspaces` [17][18][19] | Approval policy plus sandbox mode. `untrusted` policy retired in 0.149.0 (20 August 2026, third-party report) [3][20][21] |
| OpenAI Agents SDK (JS) | npm library, runs anywhere Node runs | Y for tools Codehouse defines: `needsApproval`, interruptions, `state.approve` or `state.reject`. Hosted tools run server side | API key or Azure credential, held by Codehouse | None built in, Codehouse supplies [11] |
| OpenAI Responses API | Hosted HTTPS API | Y in Pattern B (function calls only). Hosted tools (web search, code interpreter, hosted MCP) must be disabled | API key, workload identity federation, project scoping. Org check via project and org ids | n/a, Codehouse supplies |
| Azure OpenAI | Hosted in your Azure subscription | Y in Pattern B | Entra ID via MSAL and Windows broker, tenant id from account, resource allow list | n/a, Codehouse supplies |
| Gemini CLI | Node CLI, Windows native | P. `BeforeTool` hook can deny and rewrite `tool_input`. Policy engine TOML with admin tier. Exit-code fail-open risk reported | Google login (consumer tiers stopped 18 June 2026), API key, Vertex | Policy engine allow, deny, ask_user. YOLO exists [4][13][22] |
| Antigravity CLI / SDK | Go CLI (`agy`), Python SDK | P. SDK `PreToolCallDecideHook` can approve or deny built-in tools with `modified_args`, and "decide hooks fail closed". CLI `allow` bug on Windows | Google account, Google Cloud project | U [5][23][24] |
| Google ADK | Python, Java, Go, TS library (prior knowledge) | Y for tools Codehouse defines via before-tool callbacks (prior knowledge) | Gemini API key or Vertex ADC | n/a |
| Gemini API / Vertex AI (Agent Platform) | Hosted API. Vertex renamed Gemini Enterprise Agent Platform on 22 April 2026 [25] | Y in Pattern B, disable Search grounding for ZDR | API key (Developer API) or Google Cloud identity (Vertex). Org check via project and organisation | n/a |
| xAI API | Hosted API | Y in Pattern B | API key per team. Team ZDR visible as `x-zero-data-retention` header | n/a [26] |
| Grok Build | Rust CLI, Apache-2.0. Windows PowerShell installer and npm package. Repo says Windows builds from source are "best-effort" [27][28] | P. PreToolUse is "the only blocking event" and still applies in always-approve. Hooks are command or HTTP, default timeout 5 seconds [14][29][30] | OAuth or OIDC via auth.x.ai, device code, `XAI_API_KEY` [31] | Ask, Auto (classifier), Always-approve, Plan, `dontAsk` [14][31][32] |
| Copilot CLI | Node CLI, Windows native | P via config hooks (prior knowledge) | GitHub sign-in | Prior knowledge only |
| Copilot SDK | Node, Python, Go, .NET, Rust, Java. GA 2 June 2026 per changelog | Y on paper. `onPreToolUse` returns `allow`, `deny`, `ask`, `modifiedArgs`. `onPermissionRequest` kinds shell, write, mcp, url. Full tool list U | GitHub OAuth, GitHub App, env tokens, BYOK. Org check via GitHub org membership (U) | Codehouse supplies via callbacks [10][33][34] |
| Ollama | Local server, Windows native, no auth | n/a (no tools of its own), Pattern B | None. Guard by loopback and token proxy | n/a |
| LM Studio | Desktop app with local server (prior knowledge) | n/a, Pattern B | None | n/a |
| llama.cpp server | Native Windows binaries | n/a, Pattern B | Optional API key flag (prior knowledge) | n/a |
| vLLM | Linux server. "does not support Windows natively" [16] | n/a, Pattern B remote | Server-side | n/a |
| OpenCode | TS CLI and server | P. `tool.execute.before` can block by throwing. `permission.ask` never triggered [15][35] | Own provider config | Config allow, ask, deny |
| Aider | Python CLI (prior knowledge) | N, edits files directly, confirm prompts only | API keys in env or files | `--yes` style flags |
| Goose | Rust CLI and desktop (prior knowledge) | P, permission modes but own executor | Provider keys | Autonomous, smart approve, manual, chat only (prior knowledge) |
| Cline / Roo | VS Code extensions (prior knowledge) | P, per-action approval inside VS Code | Provider keys | Auto-approve toggles |
| Continue | IDE extension and CLI (prior knowledge) | P | Provider keys or hub | U |
| OpenHands | Python, Docker sandbox, WSL on Windows (prior knowledge) | P, runs tools in its own container | Provider keys | U |

### Matrix part 2: questions 5 to 7

| Candidate | Q5 Sessions | Q6 MCP, in-process | Q7 Cost, tokens, limits |
|---|---|---|---|
| Claude (baseline) | Stream, resume, fork, compaction, subagents | In-process SDK MCP servers | Per-turn usage and cost |
| Codex app-server | Threads and turns, interrupt, `turn/diff/updated`, subagents (`spawn_agent`) | stdio and HTTP MCP (blocked by company policy), no in-process option found (U) | Per-turn usage (U), plan limits via ChatGPT plan [12] |
| Pattern B on Responses or Azure | Codehouse owns streaming, resume, fork, compaction. OpenAI documents a compaction guide and background mode | Codehouse bridges its in-process MCP servers into function tools | `usage` per response. Rate-limit headers (U for exact names on Azure) |
| Gemini / Vertex (Pattern B) | Codehouse owns. Interactions API keeps state by default, opt out for ZDR | Codehouse bridge | `usageMetadata` per response (prior knowledge) [9] |
| xAI (Pattern B) | Codehouse owns. Stateful Responses disabled under ZDR | Codehouse bridge | Usage per response (U) [26] |
| Grok Build | Resume, subagents, headless `grok -p`, ACP via `grok agent stdio` [28] | Project MCP needs folder trust [29] | U |
| Copilot SDK | Streaming, multi-turn sessions, cloud or remote sessions | MCP connections. Custom tools defined in-process by the host | Premium request accounting (U) [36] |
| Local runtimes | Codehouse owns | Codehouse bridge | Tokens from server response, cost is zero cash but metered as compute time |

### Matrix part 3: questions 8 to 10

| Candidate | Q8 Chat features | Q9 Licence, terms, data | Q10 Maturity and risk |
|---|---|---|---|
| Codex | Web search (hosted), image input | ChatGPT sign-in "follows your ChatGPT workspace permissions, RBAC, and ChatGPT Enterprise retention and residency settings" [37] | Fast release cadence (0.163.0 on 15 October, 0.165.0 on 27 October, 0.166.0 on 29 October 2026). App-server "experimental and aren't supported for production workloads" [12][38][39][40][41] |
| OpenAI API | Web search, file inputs, citations | Abuse monitoring retention 30 days on most endpoints, ZDR for approved customers, no training on API data | Stable core, but docs now at learn.chatgpt.com and list new APIs (Decisions, Agents API, GPT-Live) [7] |
| Azure OpenAI | Same models, region-pinned | No training. 30-day abuse monitoring by default according to Microsoft Q&A support answers (current Learn pages state no period). Modified Abuse Monitoring by application for EA or MCA customers. Microsoft Learn: "The value of 'false' for the 'ContentLogging' attribute appears only if data storage for abuse monitoring is turned off." | Stable, Microsoft DPA |
| Gemini Developer API | Search grounding, files | Google says use Vertex AI "if your workload requires guaranteed zero data retention". [8] Search grounding stores data 30 days | Stable API, fast model churn [9] |
| Vertex AI / Agent Platform | Grounding, files | Service Specific Terms Section 18: "Google will not use Customer Data to train or fine-tune any AI/ML models without Customer's prior permission or instruction." ZDR is a set of steps (disable caching, avoid Search grounding, no request logging) [42][43] | Stable, renamed in April 2026 |
| xAI API | Search tools (U), image input | Requests and responses stored 30 days for abuse audit, no training without permission, ZDR enterprise-only, ZDR disables stateful Responses, Files and Batch | Fast-moving. The docs.x.ai page title now reads "SpaceXSI Docs", and a third party (Kingy AI) reports that SpaceX acquired xAI on 2 February 2026 and that enterprise terms name SpaceXAI LLC (not confirmed by a primary source) |
| Grok Build | Plan mode, subagents | Apache-2.0 source | Early beta since May 2026 (launch date reported as 14 May or 25 May 2026, sources conflict) [32][44] |
| Copilot SDK | Depends on host | GitHub Copilot Business or Enterprise terms (U for SDK-specific retention) | GA per changelog, but the SDK docs page still says "currently in public preview" (conflict, flagged) [10][34] |
| Gemini CLI | Search grounding | Apache-2.0 (prior knowledge) | Consumer service stopped 18 June 2026, enterprise maintenance continues [45] |
| Ollama | n/a | MIT (prior knowledge) | CVE-2026-7482 "Bleeding Llama" CVSS 9.1 fixed in 0.17.1. Windows updater flaws CVE-2026-42248 and CVE-2026-42249 (CVSS 7.7 each). Pull API SSRF CVE-2026-108836 fixed in 0.34.2 [46][47] |
| vLLM | n/a | Apache-2.0 (prior knowledge) | Linux only officially [16] |
| Open models | n/a | Prior knowledge, verify per release: Qwen3 mostly Apache-2.0, DeepSeek V3 and R1 weights MIT, gpt-oss Apache-2.0, Mistral mixed Apache-2.0 and research licences, Llama community licence with acceptable use policy, Gemma own terms | Weights are inert data but GGUF parsers have had memory-safety CVEs |

## Details by provider

### OpenAI

- **Codex CLI and app-server.**
  - Hook coverage (official hooks page): shell and unified exec match as `Bash`, `apply_patch` matches as `apply_patch`, `Edit` or `Write`, MCP tools match by name, and `spawn_agent` also matches `Agent`. Hosted `WebSearch` is not covered. [1]
  - Edited input: "To rewrite a supported tool call without blocking, return `permissionDecision: "allow"` with `updatedInput`." [1] This can carry Codehouse's edited input, but Codex does not re-run earlier hooks against the rewritten input, so Codehouse would have to re-check inside its own hook. [3][48]
  - `write_stdin` "doesn't run `PreToolUse` again when it sends input or polls a command that already passed `PreToolUse`". An interactive shell approved once can therefore receive new input without a fresh gate. [1]
  - App-server: `item/commandExecution/requestApproval` (accept, acceptForSession, decline, cancel, acceptWithExecpolicyAmendment) and `item/fileChange/requestApproval`. [12] Connector tools use `tool/requestUserInput`. Web search appears only as a `webSearch` item with no approval flow. A user reported a turn stalling on an approval that never surfaced over JSON-RPC (openai/codex issue 21982, CLI 0.130.0). [12][49]
  - Windows: the native sandbox creates dedicated local sandbox users and needs UAC for the `elevated` mode. openai/codex issue 42233 (CLI 0.151.0-alpha.7.2, Windows 11) reports the elevated sandbox spawning its setup helper "once per sandboxed command", with "1,103 elevated helper spawns" in one day and a peak of 41 per minute, falling to zero only after switching to `unelevated`. On a managed laptop with EDR this is a likely security-tool flag.
  - **Conclusion:** Codex cannot meet "no tool call runs without passing the floor and the Approver" or "fail closed" today. Do not wrap it. Revisit when hosted tools fire hooks, "ask" fails closed, and the app-server leaves experimental status.
- **Agents SDK (JS).** "When a tool call requires approval, the SDK pauses the run, returns interruptions, and lets you resume later from the same RunState." `needsApproval` can be a function evaluated after arguments parse, and local `shellTool()` and `applyPatchTool()` accept `onApproval`. The Python SDK states "Callable approval rules fail closed when the SDK cannot safely inspect the arguments." [11][50] Usable inside Pattern B, but Codehouse's existing gate pipeline is the stronger source of truth, so treat the SDK as optional plumbing.
- **Responses API.** Use `store=false`, client-side function tools only, and Codehouse-held conversation state. Disable hosted web search, code interpreter, file search and hosted MCP, because they execute on OpenAI's side without Codehouse's gate.

### Microsoft

- **Azure OpenAI.** First provider. Abuse monitoring retains data up to 30 days by default according to Microsoft Q&A support answers, although a Q&A thread notes the current Microsoft Learn pages (updated 19 May 2026) "state no retention period". Modified Abuse Monitoring is "not a self-service setting", requires Microsoft approval, and is only for EA or MCA customers (Microsoft Q&A, 2 February 2026). Deployment type controls residency: global types may process in any region, so use Data Zone or regional deployments. [51]
- **GitHub Copilot SDK.** GA on 2 June 2026 per the GitHub changelog, with "GitHub OAuth, GitHub Apps, environment tokens, and BYOK". [34] The pre-tool hook docs list `permissionDecision` (`allow`, `deny`, `ask`), `permissionDecisionReason`, `modifiedArgs`, `additionalContext` and `suppressOutput`, and say "Return `null` or `undefined` to allow the tool to execute with no changes". [10] That last default is fail-open, so Codehouse's handler must never return null. The ordering between `onPreToolUse` and `onPermissionRequest` is not documented, and issue 2852 reports a resume bug. [52] Spike before committing.

### Google

- **Gemini CLI.** Google announced on 19 May 2026 that it is transitioning Gemini CLI to Antigravity CLI. Gemini CLI "will stop serving requests for Google AI Pro and Ultra, as well as those using it free of charge" on 18 June 2026, and remains available through paid Gemini and Gemini Enterprise Agent Platform API keys. [45][53] Hooks (`BeforeTool`) can deny and rewrite `tool_input`. [22] Not a good long-term wrap target.
- **Antigravity CLI and SDK.** The Python SDK's `PreToolCallDecideHook` "can approve or deny built-in tools" and supports `modified_args`. A third-party integration notes "Antigravity decide hooks fail closed (a raising hook aborts the tool)". This is promising, but it is Python, young (Antigravity 2.0 stable release 2.23.1 dated 13 October 2026 per Wikipedia), and the CLI's hook semantics changed between versions. [23][24][54]
- **Gemini on Vertex AI (Agent Platform).** Pattern B provider. Training restriction is contractual. [42] ZDR requires disabling caching, avoiding Search and Maps grounding and request-response logging, and setting store to false. [9][43]

### xAI

- **xAI API.** Pattern B provider after legal sign-off. Default retention is 30 days per the xAI security FAQ: "xAI never trains on your API inputs or outputs without your explicit permission ... This data is automatically deleted after 30 days." The same page offers a US regional endpoint (https://us.api.x.ai/v1) to keep retained request data in the United States. ZDR "is exclusively available to enterprise accounts", and "every API response includes an `x-zero-data-retention` header set to "true" or "false"". Codehouse can verify ZDR on every response and fail closed if it is not "true".
- **Grok Build.** The most interesting new wrap candidate. Checks run in order: "PreToolUse hooks, policy rules (deny > ask > allow), built-in fast paths, then the prompt policy". `dontAsk` mode will "Silently deny anything without an explicit allow rule". [31] Project hooks need folder trust, and "Untrusted folders run only managed hooks from your organization" (changelog 1.0.64). [55] Risks: early beta, default hook timeout of 5 seconds (too short for phone approval), and it also reads Claude Code and Cursor hook files, which widens the configuration attack surface. [30] Revisit in 2027.

### Open source

- **Runtimes.** Prefer Ollama (version 0.34.2 or later, auto-update disabled because of the Windows updater CVEs) or llama.cpp `llama-server` bound to 127.0.0.1 behind a Codehouse token proxy. LM Studio is acceptable for evaluation only (not verified for this report). vLLM belongs on a Linux server reached over TLS, not on the laptop. [16]
- **Agents.** OpenCode, Aider, Cline, Roo, Continue, OpenHands and Goose all bring their own executor and UI. None offers a documented, fail-closed, external pre-execution gate that Codehouse can own. OpenCode's `permission.ask` hook "is never triggered" (issue 47674). [15] Do not wrap them. Borrow ideas (repo maps from Aider, permission modes from Goose) instead.
- **Models.** For local coding use, start with Qwen3-Coder class and gpt-oss class models (permissive licences, prior knowledge). Treat model choice as a policy decision for legal, especially for models of non-EU, non-US origin.

## Architecture proposal

### Provider adapter interface (TypeScript)

```ts
// Gatehouse provider contract. Every adapter must pass the invariant conformance suite (S-04).

export type ProviderId = string // e.g. "claude-agent-sdk", "azure-openai", "local-ollama"
export type Pattern = "wrap" | "loop"
export type PermissionMode = "manual" | "plan" | "acceptEdits" | "auto"
export type Effort = "minimal" | "low" | "medium" | "high" | "max"
export type DataBoundary = "local" | "hosted-zdr" | "hosted-retained"

export interface ProviderCapabilities {
  pattern: Pattern
  streaming: boolean
  resume: boolean
  fork: boolean
  compaction: "native" | "app" | "none"
  subagents: "native" | "app" | "none"
  inProcessMcp: boolean
  webSearch: "app-tool" | "none" // vendor-hosted search is never enabled
  imageInput: boolean
  fileInput: boolean
  effortLevels: Effort[]
  reportsUsage: boolean
  reportsRateLimits: boolean
  dataBoundary: DataBoundary
}

export interface OrgAssertion {
  provider: ProviderId
  orgId: string // tenant id, workspace id, project id, team id
  accountLabel: string // display only, redacted before audit
  verifiedBy: string // e.g. "msal-account.tenantId", "x-zero-data-retention"
}

export interface ToolCall {
  callId: string
  sessionId: string
  provider: ProviderId
  canonicalTool: "read" | "write" | "edit" | "shell" | "glob" | "grep" | "webFetch" | "webSearch" | "mcp" | "subagent"
  vendorToolName: string
  input: unknown
  inputHash: string
}

export type GateVerdict =
  | { kind: "allow"; ruleId: string; risk: number; input: unknown; inputHash: string }
  | { kind: "deny"; ruleId: string; risk: number; reason: string }

// Single entry point into floor -> Approver -> human escalation.
// Any thrown error, timeout or malformed result must resolve to deny.
export interface Gate {
  decide(call: ToolCall, signal: AbortSignal): Promise<GateVerdict>
}

export interface CredentialBroker {
  // Returns an opaque handle. Adapters never see raw secrets except inside sendAuthorised.
  acquire(provider: ProviderId): Promise<{ handle: string; org: OrgAssertion }>
  sendAuthorised(handle: string, req: Request): Promise<Response>
}

export interface UsageReport {
  inputTokens: number
  outputTokens: number
  cachedInputTokens?: number
  reasoningTokens?: number
  costMicroUsd?: number // computed by Codehouse from a versioned price table
  priceTableVersion?: string
  rateLimit?: { remainingRequests?: number; remainingTokens?: number; resetAt?: string; source: string }
}

export type SessionEvent =
  | { type: "text"; delta: string }
  | { type: "toolRequested"; call: ToolCall }
  | { type: "toolResult"; callId: string; ok: boolean; redactedOutput: string; untrusted: true }
  | { type: "usage"; usage: UsageReport }
  | { type: "error"; code: string; message: string }
  | { type: "done"; stopReason: string }

export interface SessionOptions {
  model: string
  effort: Effort
  mode: PermissionMode
  workspaceRoot: string
  resumeFrom?: string
  forkFrom?: { sessionId: string; atTurn: number }
}

export interface ProviderAdapter {
  id: ProviderId
  capabilities(): ProviderCapabilities
  // Must call broker.acquire and fail if org does not match policy. Never starts a session otherwise.
  assertOrganisation(broker: CredentialBroker, expectedOrgIds: string[]): Promise<OrgAssertion>
  startSession(opts: SessionOptions, gate: Gate, broker: CredentialBroker): AsyncIterable<SessionEvent>
  send(sessionId: string, userText: string, attachments?: string[]): Promise<void>
  interrupt(sessionId: string): Promise<void>
  listModels(broker: CredentialBroker): Promise<{ id: string; label: string; effort: Effort[] }[]>
}
```

Design rules attached to the interface:

- **The adapter never executes a tool.** In Pattern B the adapter emits `toolRequested` and the Codehouse executor runs the tool only after `Gate.decide` returns allow. In Pattern A the vendor hook calls `Gate.decide` and must map every non-allow, error or timeout to the vendor's deny.
- **Edited input is re-gated.** If the human or the Approver edits the input, the gate computes a new `inputHash` and runs floor and Approver again before returning allow. The executor refuses to run if the hash it receives differs from the allowed hash.
- **No bypass mode exists in the type system.** `PermissionMode` has no bypass value, and adapters are rejected at registration if their vendor configuration contains auto-approve, always-approve, YOLO or `dontAsk`-off equivalents.

### Integration pattern A: wrap a vendor agent that has trustworthy hooks

- **Use when** the vendor documents a programmatic pre-execution callback that (1) fires for every built-in tool including web and MCP, (2) can return deny and an edited input, (3) treats errors, timeouts and null returns as deny, or can be configured so, and (4) can be pinned to a version. Today only the Claude Agent SDK meets this. The Copilot SDK may, pending S-15.
- **How invariants apply:**
  - Floor and Approver run inside the vendor callback through `Gate.decide`.
  - Set the vendor to its most restrictive mode and disable every hosted tool (web search, code execution, cloud sandboxes).
  - Human escalation is the same desktop and phone race. Hook timeouts must exceed Codehouse's escalation timeout, or the adapter must deny on timeout.
  - Audit records include vendor name, vendor version and the vendor's own tool name.
  - Org guard uses the vendor's own sign-in plus a Codehouse check before session start.
  - Canary tests run on every vendor version bump. A failed canary disables the provider.

### Integration pattern B: Codehouse runs the agent loop and executes tools itself

- **Use for** every hosted API (Azure OpenAI, OpenAI, Vertex, xAI) and every local runtime. Default pattern.
- **How invariants apply:**
  - Models only see function definitions for Codehouse's canonical tools. Each requested call goes through floor, Approver and escalation before the Codehouse executor runs it.
  - Tool results are redacted, tagged untrusted and only then sent back to the model.
  - Redaction runs on the prompt, attachments and tool results before any HTTP call and before storage.
  - In-process MCP servers are exposed as function tools through a Codehouse bridge, which keeps the company "in-process only" rule.
  - Org guard: Azure uses the tenant id from the MSAL account and an allow list of resource endpoints. Vertex uses the project and organisation from the cloud identity. xAI uses the team id and rejects any response where `x-zero-data-retention` is not "true" when policy demands ZDR. Local runtimes replace the org guard with a runtime guard (version floor, loopback binding, model hash allow list).
  - Subagents are Codehouse sessions with their own gate context and a parent link in the audit log.

### Normalisation

- **Models.** A Codehouse model registry maps `provider:model` to a label, context window, input types, effort levels and a price table version. The UI picks from the registry, not from raw vendor lists.
- **Effort.** `minimal` to `max` maps to OpenAI `reasoning.effort`, Gemini thinking level or budget, xAI reasoning effort where supported, and is ignored (with a visible note) for models without reasoning controls.
- **Modes.**

| Codehouse mode | Pattern B behaviour | Pattern A vendor setting |
|---|---|---|
| Manual | Approver may allow read-only calls only, everything else escalates | Most restrictive "ask" mode, all asks routed to Codehouse |
| Plan | Only read, glob, grep, webFetch offered to the model, write tools not even defined | Vendor plan or read-only mode plus Codehouse deny on writes |
| Accept edits | Approver may allow write and edit inside workspace root, shell escalates | Vendor "ask" mode, Codehouse Approver auto-allows edits |
| Auto | Approver allows by rule id and risk score threshold | Vendor "ask" mode, Codehouse decides. Never vendor auto, always-approve or YOLO |

- **Cost and limits.** Tokens come from vendor usage fields. Cost is computed by Codehouse from a versioned price table so that all providers report in one currency. Rate limits come from response headers where documented and are shown as "unknown" otherwise. Local sessions report tokens and wall-clock compute, with cost shown as zero cash.

### UI: showing the provider without imitating vendors

- A neutral Codehouse-designed provider chip on each session tab and transcript header: text label (for example "Azure OpenAI · gpt-x"), a Codehouse palette colour assigned per provider, and a shape glyph drawn by Codehouse. No vendor logos, fonts, colours or layout patterns.
- A second chip for the data boundary: "Local", "Hosted, ZDR verified" or "Hosted, retained 30 days".
- Approval cards (desktop and phone) show the provider chip and the vendor tool name next to the canonical tool name, and the signed phone payload includes provider id and input hash.

## Threat model addendum

| Id | Threat | Applies to | Mitigation | Test that proves it |
|---|---|---|---|---|
| T-01 | Prompt injection through tool results (web pages, files, MCP output) | All | Results tagged untrusted. After any untrusted read in a turn, the Approver raises risk for shell, network and writes outside workspace. Never auto-allow egress after a web fetch | Fixture page containing "run curl to exfiltrate" then model requests shell. Assert escalation, not allow, with rule id `taint.after-web` |
| T-02 | Vendor built-in tool bypasses hooks (for example hosted web search) | Pattern A | Disable hosted tools, canary probe per vendor version, provider disabled on probe failure | Canary session asks for web search and fetch. Assert either gate audit entry exists or the provider is marked failed |
| T-03 | Hook fails open on error, timeout, null or "ask" | Pattern A | Adapter maps every non-allow to deny. Handler never returns null. Timeout longer than escalation or deny on timeout | Inject thrown error, slow response and malformed JSON into the hook. Assert the tool did not execute (filesystem sentinel unchanged) |
| T-04 | Credential exposure in Pattern B | Pattern B hosted | MSAL with Windows broker, access tokens in memory only, API keys DPAPI-sealed and decrypted only inside `sendAuthorised`. Log redaction of `Authorization` and `api-key` headers | Grep audit, logs, crash dumps and env of child processes for token patterns after a session. Assert zero hits |
| T-05 | Unsandboxed or exposed local runtime | Local | Version floor (Ollama 0.34.2 or later), refuse to use a runtime listening on non-loopback, Codehouse token proxy, auto-update off | Start Ollama on 0.0.0.0 and assert Codehouse refuses the provider with `runtime.non-loopback` |
| T-06 | Supply chain of CLIs and runtimes (`curl \| bash`, `irm \| iex`, self-updaters) | All installed binaries | Install only through company software portal, pin versions, verify Authenticode signatures and hashes at start, disable self-update | Replace binary with an unsigned copy. Assert session start fails with `binary.signature` |
| T-07 | Malicious model files (crafted GGUF triggered CVE-2026-7482) | Local | SHA-256 allow list of model files, GGUF or safetensors only, no pickle formats, runtime version floor [56] | Load a non-allow-listed GGUF. Assert refusal before the runtime sees it |
| T-08 | Data leaving the company via retention, grounding or stateful APIs | Hosted | `store=false`, hosted tools off, provider data-boundary policy, ZDR header check for xAI, `ContentLogging=false` check for Azure, egress allow list | Contract tests assert request bodies contain no stored-state flags. xAI response with ZDR "false" ends the session |
| T-09 | Repository config injection (repo-level hooks, MCP or rules files read by vendor CLIs, including Grok Build reading `.claude/settings.json`) | Pattern A | Vendor folder trust off, managed config only, Codehouse launches vendors with an isolated config home [30] | Repo with a malicious hooks file. Assert the hook never runs |
| T-10 | Edited input skips the gate | All | Hash binding: executor runs only the allowed hash. Re-gate after any edit | Approver edits a path to `C:\Windows\...`. Assert floor deny on re-check |
| T-11 | Weaker refusal behaviour in small local models | Local | Stricter Approver profile for local sessions (lower auto-allow risk threshold) | Same injection fixture as T-01 run against local model. Assert escalation rate equals or exceeds hosted profile |
| T-12 | Phone approval replay across providers | All | Signed payload binds session id, provider id, call id and input hash, single use | Replay a valid answer for a different call. Assert rejection |
| T-13 | Cost runaway in Codehouse-owned loop | Pattern B | Per-session token and cost ceilings, loop step limit | Fake model that always requests tools. Assert stop at limit with audit entry |

## Build plan

Each slice is independent enough for a work queue. Effort is in engineer days.

### S-01 Provider adapter contract and feature flag
- **Scope:** Add `ProviderAdapter`, `Gate`, `CredentialBroker` types and a provider registry. Setting `providers.multi.enabled` defaults to false.
- **Likely files:** `src/providers/types.ts`, `src/providers/registry.ts`, `src/settings/schema.ts`
- **Acceptance tests:** registry rejects an adapter whose capabilities declare a bypass mode. With the flag off, only the Claude adapter is listed. Types compile with strict mode.
- **Dependencies:** none
- **Effort:** 2 days
- **Owner decisions:** flag name and whether the flag is per user or per build.

### S-02 Claude adapter behind the contract
- **Scope:** Move the existing Agent SDK integration behind `ProviderAdapter` with no behaviour change.
- **Likely files:** `src/providers/claude/adapter.ts`, `src/sessions/manager.ts`
- **Acceptance tests:** existing session, approval and audit tests pass unchanged. Golden transcript diff is empty.
- **Dependencies:** S-01
- **Effort:** 4 days
- **Owner decisions:** none

### S-03 Canonical tool executor
- **Scope:** Codehouse-side read, write, edit (patch), shell (PowerShell, workspace-rooted), glob, grep, web fetch and an in-process MCP bridge. The executor runs only gate-allowed hashes.
- **Likely files:** `src/executor/*.ts`, `src/mcp/bridge.ts`
- **Acceptance tests:** executor refuses a call without an allow verdict. Executor refuses when the input hash differs from the allowed hash. Shell runs with workspace root as cwd and no inherited secrets in env.
- **Dependencies:** S-01
- **Effort:** 6 days
- **Owner decisions:** shell choice (PowerShell 7 or Windows PowerShell 5.1), web fetch egress allow list.

### S-04 Invariant conformance harness
- **Scope:** A test suite every adapter must pass: fail closed on error, timeout and malformed verdict, no bypass mode, edited input re-checked, redaction before send and store, audit chain intact, org guard enforced, loopback listener checks.
- **Likely files:** `test/conformance/*.spec.ts`
- **Acceptance tests:** suite passes for the Claude adapter and fails for a deliberately broken fake adapter in each of the eight categories.
- **Dependencies:** S-01, S-02, S-03
- **Effort:** 4 days
- **Owner decisions:** whether failing conformance blocks a release automatically.

### S-05 Credential broker and organisation guard (Entra)
- **Scope:** MSAL Node with the Windows broker, opaque handles, DPAPI vault for any API keys, tenant id check against the expected list, header redaction.
- **Likely files:** `src/credentials/broker.ts`, `src/credentials/dpapi.ts`, `src/guards/org.ts`
- **Acceptance tests:** a wrong-tenant account cannot start a session. No token string appears in logs, audit or child env (T-04). Process env never contains an API key.
- **Dependencies:** S-01
- **Effort:** 4 days
- **Owner decisions:** Entra app registration owner, expected tenant ids.

### S-06 Azure OpenAI Responses adapter (first non-Claude provider)
- **Scope:** Streaming Responses API, function tools only, `store=false`, hosted tools off, usage events, model list from registry.
- **Likely files:** `src/providers/azure-openai/adapter.ts`, `src/loop/engine.ts`
- **Acceptance tests:** end-to-end session edits a file only after approval. Hosted tool definitions never appear in request bodies. Conformance suite passes. With the flag off the provider is invisible.
- **Dependencies:** S-03, S-04, S-05
- **Effort:** 5 days
- **Owner decisions:** which Azure subscription and deployment type (Data Zone or regional), Modified Abuse Monitoring application.

### S-07 Session store for Pattern B
- **Scope:** Codehouse-owned transcript, resume, fork at turn, compaction by summarisation with the same provider.
- **Likely files:** `src/loop/store.ts`, `src/loop/compaction.ts`
- **Acceptance tests:** resume reproduces state after restart. Fork produces an independent branch with a parent link in the audit log. Compaction keeps tool-call pairing valid.
- **Dependencies:** S-06
- **Effort:** 4 days
- **Owner decisions:** compaction threshold.

### S-08 Normalisation of models, effort, cost and limits
- **Scope:** Model registry, effort mapping, versioned price table, rate-limit parsing.
- **Likely files:** `src/normalise/*.ts`, `config/prices.json`
- **Acceptance tests:** each provider reports usage in the common shape. Unknown rate limits show "unknown", never zero.
- **Dependencies:** S-06
- **Effort:** 3 days
- **Owner decisions:** reporting currency and who maintains prices.

### S-09 Provider identity in the UI
- **Scope:** Provider and data-boundary chips, approval cards with provider and vendor tool names.
- **Likely files:** `web/src/components/ProviderChip.tsx`, `web/src/components/ApprovalCard.tsx`
- **Acceptance tests:** snapshot tests show no vendor logo assets. Every session view renders both chips.
- **Dependencies:** S-06
- **Effort:** 2 days
- **Owner decisions:** palette and glyph set.

### S-10 Audit and phone payload extensions
- **Scope:** Add provider id, vendor version and input hash to audit entries and to the signed phone payload.
- **Likely files:** `src/audit/chain.ts`, `src/relay/payload.ts`, iOS payload model
- **Acceptance tests:** replay of an answer for another call is rejected (T-12). Chain verification passes across mixed-provider sessions.
- **Dependencies:** S-06
- **Effort:** 2 days
- **Owner decisions:** iOS release timing.

### S-11 Local runtime adapter and runtime guard
- **Scope:** OpenAI-compatible adapter for Ollama and llama.cpp server, loopback check, version floor, model hash allow list, stricter Approver profile.
- **Likely files:** `src/providers/local/adapter.ts`, `src/guards/runtime.ts`
- **Acceptance tests:** T-05, T-07 and T-11 pass. Session works fully offline.
- **Dependencies:** S-04, S-07
- **Effort:** 4 days
- **Owner decisions:** approved runtimes and models, who signs the model allow list.

### S-12 Chat features on Pattern B
- **Scope:** Web search as a Codehouse tool through an approved search API, citations rendered from tool results, file and image input, artifacts reuse the existing sandbox.
- **Likely files:** `src/executor/webSearch.ts`, `web/src/components/Citations.tsx`
- **Acceptance tests:** each citation links to a fetched source in the audit log. Artifacts render only in the existing sandbox.
- **Dependencies:** S-06
- **Effort:** 4 days
- **Owner decisions:** search API vendor and its data terms.

### S-13 Gemini on Vertex AI adapter
- **Scope:** Pattern B adapter, ZDR configuration (caching off, no Search grounding), project and organisation check.
- **Likely files:** `src/providers/vertex/adapter.ts`
- **Acceptance tests:** conformance suite passes. Requests never enable Search grounding.
- **Dependencies:** S-04, S-08
- **Effort:** 4 days
- **Owner decisions:** Google Cloud project and contract.

### S-14 xAI API adapter
- **Scope:** Pattern B adapter, ZDR header enforcement, DPAPI-held key.
- **Likely files:** `src/providers/xai/adapter.ts`
- **Acceptance tests:** a response with `x-zero-data-retention: false` ends the session with an audit entry.
- **Dependencies:** S-04, S-08, legal sign-off
- **Effort:** 3 days
- **Owner decisions:** whether xAI is permitted at all.

### S-15 Copilot SDK wrap spike
- **Scope:** Time-boxed evaluation. Probe every built-in tool, MCP and URL fetch, hook ordering with `onPermissionRequest`, null and timeout behaviour, Windows behaviour, org check.
- **Likely files:** `spikes/copilot-sdk/*`
- **Acceptance tests:** written report with a pass or fail per probe. Go only if every probe passes T-02, T-03 and T-10.
- **Dependencies:** S-04
- **Effort:** 4 days
- **Owner decisions:** go or no-go for Pattern A with Copilot.

## Architecture decision records

### ADR-001 Default integration pattern
- **Context:** Vendor hooks differ in coverage and failure modes. Codex documents hooks as "not a complete enforcement boundary". [1]
- **Options:** (1) wrap every vendor agent, (2) Codehouse loop for everyone, (3) Codehouse loop by default, wrap only where hooks pass conformance.
- **Decision:** Option 3.
- **Consequences:** More code in Codehouse (executor, session store). Invariants become provable. Vendor-agent features (for example vendor subagents) are reimplemented or omitted.

### ADR-002 Provider contract and capability flags
- **Context:** Providers differ in streaming, fork, MCP and usage reporting.
- **Options:** lowest common denominator, or capability flags with graceful degradation.
- **Decision:** Capability flags in `ProviderCapabilities`. UI hides unsupported actions.
- **Consequences:** Each adapter declares honestly. Conformance tests check declarations against behaviour.

### ADR-003 Credential handling in Pattern B
- **Context:** In Pattern B Codehouse must present a credential to the vendor endpoint. The invariant "credentials are never read, logged or sent by Codehouse" cannot hold literally.
- **Options:** (1) refuse Pattern B, (2) proxy through a vendor CLI, (3) refine the invariant.
- **Decision:** Refine to: "Codehouse never persists, logs or displays a credential, never places one in environment variables, and transmits it only to the vendor endpoint it belongs to, through an OS broker or DPAPI-sealed store."
- **Consequences:** Security sign-off needed on the reworded invariant. MSAL broker keeps refresh tokens out of Codehouse.

### ADR-004 First non-Claude provider
- **Context:** Need one provider end to end with enterprise identity and clear data terms.
- **Options:** OpenAI API, Azure OpenAI, Vertex, xAI, local.
- **Decision:** Azure OpenAI Responses API with Entra ID.
- **Consequences:** Depends on an Azure subscription and deployment. Org guard uses tenant id. Residency follows deployment type.

### ADR-005 Local models
- **Context:** Ollama had a critical memory leak CVE in 2026 (CVE-2026-7482, CVSS 9.1, "potentially impacting 300,000 servers globally" per Cyera Research on 5 May 2026, fixed in Ollama 0.17.1 on 25 February 2026) as well as Windows updater flaws. vLLM is Linux only.
- **Options:** any runtime, a vetted shortlist, or none.
- **Decision:** Ollama (0.34.2 or later) and llama.cpp server, loopback only, auto-update off, model hash allow list. vLLM only as a remote Linux server.
- **Consequences:** IT must package runtimes. Model list governed.

### ADR-006 Codex CLI not wrapped
- **Context:** Hook "ask" fails open, hosted web search bypasses PreToolUse, app-server experimental, Windows sandbox needs elevation and local users. [1][3][12][20]
- **Options:** wrap with mitigations, or exclude.
- **Decision:** Exclude. OpenAI models are reached through Pattern B.
- **Consequences:** No ChatGPT plan billing for Codehouse sessions. Revisit at each quarterly review.

### ADR-007 Vendor-hosted tools disabled
- **Context:** Hosted web search, code execution and hosted MCP run outside Codehouse's gate and may store data.
- **Options:** allow with logging, or disable.
- **Decision:** Disable. Web search and fetch run as Codehouse tools.
- **Consequences:** Search quality depends on the chosen search API. Citations come from Codehouse's own fetches.

### ADR-008 Stateless vendor calls
- **Context:** Stateful APIs retain conversation state on vendor servers and some are not ZDR-eligible. [7]
- **Options:** vendor-held state, or Codehouse-held state.
- **Decision:** Codehouse-held state, `store=false` or equivalent everywhere.
- **Consequences:** Larger request payloads and more tokens per turn. Prompt caching partly offsets cost.

### ADR-009 Provider identity in the UI
- **Context:** Users must know which provider and data boundary each session uses, without trademark or trade-dress issues.
- **Options:** vendor logos, or neutral Codehouse chips.
- **Decision:** Neutral Codehouse chips with text labels and a data-boundary chip.
- **Consequences:** No brand approval needed. Small design task.

## Open questions

### For the owner
- Is Azure OpenAI the right first provider, or does Accenture hold an OpenAI API enterprise agreement with ZDR that makes the direct API simpler?
- Which subagent behaviour is required for non-Claude sessions in the first release, or can it wait?
- Is a per-session cost ceiling acceptable as a hard stop?

### For IT
- Can Ollama or llama.cpp be packaged through the software portal with auto-update disabled?
- Will EDR tolerate local model runtimes using the GPU and large memory maps?
- Is the Windows authentication broker (WAM) available to a Node desktop app under current policy?

### For security
- Do you accept the reworded credential invariant in ADR-003?
- Is a Codehouse in-process MCP bridge consistent with the managed policy that blocks stdio and HTTP MCP servers?
- What risk threshold should apply to local-model sessions?

### For legal and procurement
- Do Accenture's agreements cover Azure OpenAI Modified Abuse Monitoring, OpenAI ZDR, Google Cloud Service Specific Terms Section 18 and xAI Enterprise ZDR?
- Which open-weight model licences and origins are permitted on client work?
- Is the Copilot SDK covered by existing GitHub Copilot Business or Enterprise terms, given the docs page still says public preview?

## Caveats

- Several official pages did not show a "last updated" date, so they are dated by the date fetched (1 November 2026).
- Matrix entries marked "prior knowledge" or U were not verified in this research and must be checked before any slice depends on them.
- Third-party sources (blogs, Q&A answers, issue trackers) were used for some facts and are labelled. They may lag or misstate vendor behaviour.

## Sources

1. [Hooks | ChatGPT Learn](https://learn.chatgpt.com/docs/hooks)
2. [Hooks](https://developers.openai.com/codex/hooks)
3. [codex-hooks.md, CodeAlive-AI/ai-driven-development](https://github.com/codealive-ai/ai-driven-development/blob/main/skills/hooks-management/references/codex-hooks.md)
4. [openmoat issue 257: gemini-cli BeforeTool adapter](https://github.com/crocodile-labs/openmoat/issues/257)
5. [antigravity-cli issue 1053: PreToolUse allow does not allow](https://github.com/google-antigravity/antigravity-cli/issues/1053)
6. [Repo-Level Agent Permissions for Google Antigravity](https://medium.com/google-cloud/stop-clicking-yes-shipping-an-agent-permission-policy-inside-the-repository-with-google-eb434885ec00)
7. [OpenAI: your data](https://developers.openai.com/docs/guides/your-data)
8. [Google Gemini DPA, GDPR and AI Act compliance review](https://companyscope.io/vendors/google-gemini)
9. [Gemini API zero data retention](https://ai.google.dev/gemini-api/docs/zdr.md.txt)
10. [GitHub Docs: Copilot SDK pre-tool use hook](https://docs.github.com/en/copilot/how-tos/copilot-sdk/use-hooks/pre-tool-use)
11. [OpenAI Agents SDK JS: human-in-the-loop](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/)
12. [Codex App Server | ChatGPT Learn](https://learn.chatgpt.com/docs/app-server)
13. [TechRadar: Gemini CLI users switch to Antigravity 2.0](https://www.techradar.com/pro/google-is-making-gemini-cli-users-switch-to-its-new-antigravity-2-0-so-what-will-it-mean-for-you)
14. [xAI docs: Grok Build permissions](https://docs.x.ai/build/features/permissions.md)
15. [opencode issue 47674: permission.ask never triggered](https://github.com/anomalyco/opencode/issues/47674)
16. [vLLM GPU installation](https://docs.vllm.ai/en/stable/getting_started/installation/gpu/)
17. [Codex authentication](https://developers.openai.com/codex/auth)
18. [Codex access tokens](https://developers.openai.com/codex/enterprise/access-tokens.md)
19. [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
20. [Codex Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox.md)
21. [Blake Crosley: Codex Hooks Make the Harness Real](https://blakecrosley.com/blog/codex-hooks-make-the-harness-real)
22. [gemini-cli hooks reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/reference.md)
23. [antigravity-sdk-python hooks README](https://github.com/google-antigravity/antigravity-sdk-python/blob/main/google/antigravity/hooks/README.md)
24. [ory-antigravity on PyPI](https://pypi.org/project/ory-antigravity/)
25. [Wikipedia: Gemini Enterprise Agent Platform](https://en.wikipedia.org/wiki/Gemini_Enterprise_Agent_Platform)
26. [xAI docs: security FAQ](https://docs.x.ai/docs/faq/security)
27. [grok-build (third-party mirror)](https://github.com/dadwritestech/grok-build)
28. [innFactory: Grok CLI (Grok Build)](https://innfactory.ai/en/ai-harness/grok-cli/)
29. [xAI docs: Grok Build hooks](https://docs.x.ai/build/features/hooks)
30. [xAI docs: Grok Build hooks (alternate path)](https://docs.x.ai//build/features/hooks)
31. [xAI docs: enterprise deployments](https://docs.x.ai/build/enterprise.md)
32. [Developers Digest: Grok Build developer guide](https://www.developersdigest.tech/blog/grok-build-developer-guide-2026)
33. [@github/copilot-sdk on npm](https://www.npmjs.com/package/@github/copilot-sdk)
34. [GitHub Changelog: Copilot SDK generally available, 2 June 2026](https://github.blog/changelog/2026-06-02-copilot-sdk-is-now-generally-available/)
35. [openmoat issue 265: opencode tool.execute.before and permission.ask](https://github.com/crocodile-labs/openmoat/issues/265)
36. [linkloot: Copilot SDK generally available](https://linkloot.io/blog/github-copilot-sdk-generally-available-agent-powered-apps)
37. [Codex authentication (markdown)](https://developers.openai.com/codex/auth.md)
38. [codex_wrapper_ex issue 157: app-server JSON-RPC client](https://github.com/genagent/codex_wrapper_ex/issues/157)
39. [releasealert: openai/codex](https://releasealert.dev/github/openai/codex)
40. [openai/codex releases](https://github.com/openai/codex/releases)
41. [creatorstoolbox: codex rust-v0.165.0](https://creatorstoolbox.com/blog/codex-rust-v0-165-0)
42. [licenseware: Gemini on Google Cloud training restriction](https://wiki.licenseware.io/catalog/rules/google-gemini-on-google-cloud-training-restriction/#src-google-gemini-enterprise-agent-platform-zero-data-retention-and-training-restriction)
43. [aipolicydesk: privacy-first AI APIs](https://www.aipolicydesk.com/blog/privacy-first-ai-api-no-training-gdpr-ccpa-2026)
44. [aimadetools: Grok Build complete guide](https://www.aimadetools.com/blog/grok-build-complete-guide/)
45. [gemini-cli discussion 27274: transitioning to Antigravity CLI](https://github.com/google-gemini/gemini-cli/discussions/27274)
46. [The Hacker News: Ollama out-of-bounds read](https://thehackernews.com/2026/05/ollama-out-of-bounds-read-vulnerability.html)
47. [Threat Frontier: Ollama pull API SSRF CVE-2026-108836](https://threatfrontier.com/articles/ollama-pull-api-ssrf-cve-2026-108836-exposed-servers-public-exploit)
48. [Daniel Vaughan: One Gate Is Not Enough](https://codex.danielvaughan.com/2026/08/20/one-gate-is-not-enough-composing-stateful-pre-action-controls-codex-cli-hooks-guardian-remediation-coupling/)
49. [openai/codex issue 21982](https://github.com/openai/codex/issues/21982)
50. [OpenAI Agents SDK Python: human in the loop](https://openai.github.io/openai-agents-python/human_in_the_loop/)
51. [Microsoft Q&A: Azure AI Foundry Modified Abuse Monitoring and EU data residency](https://learn.microsoft.com/en-us/answers/questions/5966351/azure-ai-foundry-modified-abuse-monitoring-eu-data)
52. [copilot-sdk issue 2852: pending permission recovery](https://github.com/github/copilot-sdk/issues/2852)
53. [Virtualization Review: Gemini CLI into Antigravity CLI](https://virtualizationreview.com/articles/2026/05/19/google-moves-gemini-cli-into-antigravity-cli-as-agent-platform-expands.aspx)
54. [Wikipedia: Google Antigravity](https://en.wikipedia.org/wiki/Google_Antigravity)
55. [xAI: Grok Build changelog](https://x.ai/build/changelog)
56. [Daily Security Review: CVE-2026-7482 in Ollama](https://dailysecurityreview.com/resources/cve-2026-7482-in-ollama-exposes-300000-ai-servers-to-memory-leaks/)
