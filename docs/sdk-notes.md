# SDK notes

Verified on 2026-10-26 by reading the installed type definitions. Later phases use only APIs recorded here. Items marked UNVERIFIED are not yet confirmed by the spike.

## Versions

| Package | Version | Notes |
|---|---|---|
| `@anthropic-ai/claude-agent-sdk` | 0.3.310 | Types in `sdk.d.ts` and `sdk-tools.d.ts`. Bundled binary comes from `@anthropic-ai/claude-agent-sdk-win32-x64` (optional dependency, installed). |
| `@modelcontextprotocol/sdk` | 1.32.2 | Subpath exports: `/client`, `/server`, plus deep imports such as `server/mcp.js`. |
| `zod` | 4.6.7 | The Agent SDK imports `zod/v4`. |
| Node | 24.15.0 | |
| pwsh | 7.6.9 | |

## Agent SDK

### `query()`

```ts
query({ prompt: string | AsyncIterable<SDKUserMessage>, options?: Options }): Query
```

`Query` extends `AsyncGenerator<SDKMessage, void>`. Control methods work only with streaming input (an `AsyncIterable` prompt): `interrupt()`, `setPermissionMode(mode)`, `setModel(model?)`, `applyFlagSettings(...)`, `initializationResult()`, `close()`.

### Streaming input message

```ts
type SDKUserMessage = {
  type: "user"
  message: MessageParam            // { role: "user", content: string | blocks }
  parent_tool_use_id: string | null
  isSynthetic?: boolean
  priority?: "now" | "next" | "later"
}
```

### Options Gatehouse uses

| Option | Type | Gatehouse value |
|---|---|---|
| `cwd` | string | session folder |
| `model` | string | from UI |
| `permissionMode` | `'default' \| 'acceptEdits' \| 'bypassPermissions' \| 'plan' \| 'dontAsk' \| 'auto'` | only `default` or `plan` (invariant 3) |
| `allowDangerouslySkipPermissions` | boolean | never set |
| `systemPrompt` | string, string[], custom, or `{ type: 'preset', preset: 'claude_code', append?, excludeDynamicSections?, snapshot? }` | preset `claude_code`, `snapshot: true` recommended by the SDK |
| `settingSources` | `('user' \| 'project' \| 'local')[]` | all three. Must include `project` to load CLAUDE.md. Omitted means all load, `[]` means none. |
| `canUseTool` | `CanUseTool` | Gatehouse handler |
| `hooks` | `Partial<Record<HookEvent, HookCallbackMatcher[]>>` | floor, audit, notification, stop, subagent |
| `mcpServers` | `Record<string, McpServerConfig>` | Companion over stdio |
| `strictMcpConfig` | boolean | UNVERIFIED whether to set. It ignores user MCP servers, which the spec wants loaded. |
| `includePartialMessages` | boolean | true |
| `env` | `{[k]: string \| undefined}` | REPLACES the subprocess environment. Spread `process.env` through `sanitiseEnv`. |
| `allowedTools` | string[] | auto-allows these tools. Gatehouse must not use bare tool names (invariant 4). |
| `resume`, `forkSession`, `sessionId`, `continue` | | resume and fork |
| `persistSession` | boolean | default true, sessions saved under `~/.claude/projects/` |
| `pathToClaudeCodeExecutable` | string | not set, use the bundled binary |
| `stderr` | `(data: string) => void` | capture diagnostics |
| `managedSettings` | `Settings` | restrictive policy tier only. Not needed. |
| `permissionPromptToolName` | string | UNVERIFIED exact name, near line 2046 of `sdk.d.ts`. For headless runs (Phase 2). |

### `canUseTool`

```ts
type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    signal: AbortSignal
    suggestions?: PermissionUpdate[]
    blockedPath?: string
    mcpServer?: { name: string; source: string }   // key trust on source
    decisionReason?: string
    title?: string
    displayName?: string
    description?: string
    defaultToNo?: boolean
    // more fields exist
  },
) => Promise<PermissionResult>
```

```ts
type PermissionResult =
  | { behavior: "allow"; updatedInput?: Record<string, unknown>; updatedPermissions?: PermissionUpdate[]; toolUseID?: string; decisionClassification?: ... }
  | { behavior: "deny"; message: string; interrupt?: boolean; toolUseID?: string; decisionClassification?: ... }
```

- Returning `null` is allowed only after the consumer answered out-of-band. Gatehouse never returns `null`.
- Gatehouse never sets `updatedPermissions` (invariant 5). It always echoes the input in `updatedInput` on allow.
- `defaultToNo: true` means the prompt must not be approvable by one stray keystroke and must not offer "don't ask again". Honour it in the UI.

### Hooks

```ts
type HookCallback = (input: HookInput, toolUseID: string | undefined, options: { signal: AbortSignal }) => Promise<HookJSONOutput>
interface HookCallbackMatcher { matcher?: string; hooks: HookCallback[]; timeout?: number }  // timeout in seconds
```

Events: PreToolUse, PostToolUse, PostToolUseFailure, PostToolBatch, Notification, UserPromptSubmit, UserPromptExpansion, SessionStart, SessionEnd, Stop, StopFailure, SubagentStart, SubagentStop, PreCompact, PostCompact, PreModelSwitch, PostModelSwitch, PermissionRequest, PermissionDenied, Setup, TeammateIdle, TaskCreated, TaskCompleted, Elicitation, ElicitationResult, ConfigChange, WorktreeCreate, WorktreeRemove, InstructionsLoaded, CwdChanged, FileChanged, DirectoryAdded, MessageDisplay.

`PreToolUseHookInput` carries `hook_event_name`, `tool_name`, `tool_input`, `tool_use_id`, `mcp_server?` (plus `BaseHookInput` fields).

Floor hook output (deny only, invariant 2):

```ts
{ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "..." } }
```

`HookPermissionDecision` also allows `allow`, `ask` and `defer`. The floor must never return `allow`. "No decision" is `{}` or `{ continue: true }`. `PreToolUseHookSpecificOutput` can also carry `updatedInput`, which the floor must not use.

`SyncHookJSONOutput` top-level fields: `continue`, `suppressOutput`, `stopReason`, `decision` (`approve` or `block`), `systemMessage`, `reason`, `hookSpecificOutput`.

`PermissionRequest` is also a hook event, with an allow/deny `decision` output that can carry `updatedPermissions`. Gatehouse does not register it.

### AskUserQuestion and ExitPlanMode

- `AskUserQuestion` arrives through `canUseTool` with input `{ questions: [{ question, header, options: [{ label, description, preview? }, 2 to 4], multiSelect? }, 1 to 4] }`.
- Answer shape on allow: `updatedInput = { ...input, answers: { [questionText]: answerString } }`. Multi-select answers are comma-separated. `annotations` is optional, keyed by question text. (`answers` appears in the permission-component input type in `sdk-tools.d.ts`.) The spike confirms this at runtime.
- `ExitPlanMode` arrives through `canUseTool`. Input shape UNVERIFIED, confirm in the spike.

### Account and organisation

`Query.initializationResult()` returns `SDKControlInitializeResponse` with `account: AccountInfo`:

```ts
type AccountInfo = { email?, organization?, subscriptionType?, tokenSource?, apiKeySource?, apiProvider?: "firstParty" | "bedrock" | ... | "gateway" }
```

`organization` is the value the org guard compares with `expectedOrg`. The org guard also requires `apiProvider === "firstParty"`. The response also lists `commands`, `agents`, `models`, `output_style`.

`startup()` and `prewarm()` also exist to start a process early. Not used in Phase 0.

### Managed policy detection

`resolveSettings({ cwd, settingSources })` returns `{ effective, provenance, sources[] }` without spawning the CLI. A `sources` entry with `source: "managed"` (with `policyOrigin` and `path`) shows that managed policy is active. It is marked `@alpha`. Managed settings always apply to SDK sessions, so Gatehouse can only be stricter.

### Sessions

- `listSessions({ dir?, limit?, offset?, includeWorktrees? })` returns `SDKSessionInfo[]` (`sessionId`, `summary`, `lastModified`, `customTitle?`, `firstPrompt?`, `gitBranch?`).
- `getSessionInfo(id, { dir? })`, `getSessionMessages(id, opts?)`, `forkSession(id, opts?)`, `renameSession`, `tagSession` exist.
- Resume uses `options.resume = sessionId`, with `forkSession: true` to fork.
- Used since 30 Oct (session management): `listSessions({ limit: 100 })` without `dir` lists sessions across all project folders, Claude Code's own included; `getSessionMessages(id, { dir?, limit })` returns `SessionMessage[]` (`type`, `message`, `parent_tool_use_id`) for search and export; `renameSession(id, title, { dir? })` appends a custom title to the session's JSONL so Claude Code shows the same title (JCVC keeps its own copy in `sessions.json` too, and a failure here only logs).
- `Query.getContextUsage({ detail: 'summary' })` returns `totalTokens`, `maxTokens`, `percentage` and `categories` (`name`, `tokens`, `kind`: used, free, buffer or deferred) from the last response and local estimates, without the token-count calls `'full'` makes. The context meter reads it after each turn.

### Background work and stopping (read 30 Oct, used since Phase 35)

- `system/background_tasks_changed` carries every live background task after a change (`task_id`, `task_type`, `description`, `subagent_type?`, `ambient?`), with REPLACE semantics. `ambient: true` marks watchers that are not work; hosts leave them out of activity. JCVC counts the rest as working after the turn's `result`.
- `system/task_notification` (`task_id`, `status: completed | failed | stopped`) says one task ended. `task_started` (`is_backgrounded?`) and `task_updated` (`patch.status`) exist and are not used yet.
- `Query.stopTask(taskId)` stops one task and emits its `task_notification` with `stopped`. Stop calls it for each background task after `interrupt()`.
- `Query.interrupt()` resolves to a receipt on CLIs with `interrupt_receipt_v1`: `still_queued` lists queued user messages that will still run. Dropping one is a control request (`cancel_async_message`) with no public Query method, so JCVC cannot take a queued message back.
- `SDKUserMessage.priority` (`now | next | later`): the SDK's own docs send composed messages at `later` "so a running turn cannot reorder them". With none, a message sent mid-turn is taken at Claude's next step.
- Force stop is `close()` on the query, then a new query with `resume` on the same conversation.

### Tool-shadowing warning

The string `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` does not appear in the installed package. UNVERIFIED. Gatehouse enforces invariant 4 itself: startup refuses any `allowedTools` entry that is a bare tool name, and any `permissionMode` outside `default` and `plan`. Revisit if the SDK emits a warning at runtime during the spike.

## Spike results (2026-10-26, `npm run host:cli -- C:\dev\gatehouse-spike`)

One streaming-input session, `permissionMode: "default"`, Claude Code preset prompt, all three setting sources, sanitised env. Cost about 0.06 USD.

| Question | Result |
|---|---|
| Signed-in organisation | `initializationResult().account.organization` returned `"ACN - Premium"`, `subscriptionType` `"Claude Enterprise"`, `apiProvider` `"firstParty"`. `tokenSource` was absent. Use `"ACN - Premium"` as `expectedOrg`. |
| Managed settings reported | `resolveSettings` returned only a `user` source. No `managed` source, so no managed policy tier was visible to the SDK on this laptop. Re-check on the managed build of the laptop. |
| `canUseTool` fires on a Write | Yes. Input keys `file_path` and `content`. The Write inside the scratch folder still prompted, because the default mode asks for edits. |
| PreToolUse hook fires on a Read | Yes, for `Read` and for `Write`. A Read inside the working directory never reached `canUseTool`, so the hook is the only place that sees it. |
| CLAUDE.md loads | Yes. The model returned the codeword from the project CLAUDE.md. |
| Deny message reaches the model | Yes. The model reported the deny message and did not try another route. |

Not exercised in the spike (still UNVERIFIED): AskUserQuestion answer round trip, ExitPlanMode input shape, `interrupt()` and `setPermissionMode()` mid-session, `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`.

## Phase 2 findings (2026-10-26)

### The managed policy blocks stdio and http MCP servers, but not in-process ones

Probes: `apps/host/src/probes/mcp-policy-probe.ts` (SDK session) and the CLI (`claude -p --mcp-config ...`).

| Server kind | Result on this laptop |
|---|---|
| stdio (`type: "stdio"`), any name | Not loaded. The CLI prints `MCP server blocked by enterprise policy: <name>`. In an SDK session `init.mcp_servers` is `[]`. |
| http and sse to 127.0.0.1 | Not loaded, same message. |
| In-process (`createSdkMcpServer`, `type: "sdk"`) | Loaded and `connected`, with `source: "sdk"`. |

The policy is not visible in `resolveSettings`, so it probably comes from server-managed settings for the organisation. **Consequences**

- The stdio Companion (spec section 2 and 10) cannot be loaded into a session here. The Host uses the same tools as an in-process server named `companion` (`apps/host/src/companion-server.ts`), so tool names stay `mcp__companion__*`. The stdio form is built and tested for machines without this restriction.
- `claude -p --permission-prompt-tool` cannot load the Approver over http here either. The Approver's `approval_prompt` tool is built and tested over its own transport, and the request and response shapes below were verified through an in-process server.
- The Approver itself is not an MCP server of any session. The Host calls it with plain HTTP, which the policy does not touch.

### Provenance of an MCP tool

`CanUseTool` options carry `mcpServer: { name, source }` and the PreToolUse hook input carries `mcp_server: { name, source }`. For the in-process Companion both report `source: "sdk"` (verified live with `probes/companion-live-probe.ts`). The SDK says to trust `source`, not the name, so the policy has an `mcpSource` condition and the seed rule `companion-tools` only matches `source: sdk`. A server from user or project configuration that names itself `companion` is not allowed automatically.

Claude Code also calls a built-in `ToolSearch` tool to load deferred tool schemas. It reaches the PreToolUse hook but not `canUseTool`, because Claude Code approves it itself.

### Permission prompt tool (`permissionPromptToolName`, CLI `--permission-prompt-tool`)

Verified against Claude Code 2.1.310 with `probes/prompt-tool-probe.ts`:

- Claude Code calls the tool with `{ tool_name: string, input: object, tool_use_id: string }`. For a Write, `input` is `{ file_path, content }` with an absolute path.
- The tool must return one text content block whose text is JSON: `{"behavior":"allow","updatedInput":{...}}` or `{"behavior":"deny","message":"..."}`.
- Allow: the tool ran and the file was written. Deny: the file was not written, and the model was told the message (it repeated it and did not try another route). A bare `{"behavior":"allow"}` also worked on this version, but Gatehouse always echoes `updatedInput`.
- `permissionPromptToolName` cannot be combined with `canUseTool`. The Host uses `canUseTool`. Only headless runs use the prompt tool.

## Phase 3 findings (2026-10-26, live run through `npm run host:cli`)

A real session on the real SDK, started by the Host's own `createHost()` against a scratch repository, confirmed:

- `Query.initializationResult()` can be awaited **before any prompt has been sent**. The Host uses this for the organisation guard (invariant 14): the account is checked, and if it is wrong the query is closed and nothing is ever sent.
- `git status` was approved by Claude Code itself (read-only command), a `Write` inside the workspace went through `canUseTool` and the Approver, `npm install` was escalated, and a `Read` of `.env` was refused by the PreToolUse floor before `canUseTool`. A hook denial reaches Claude as "your permission settings deny access", and a `canUseTool` denial reaches it as the message the Host gives.
- **Cost and usage semantics.** In a `result` message, `total_cost_usd` and every figure in `modelUsage` are **cumulative for the session**. The top-level `usage` object and `num_turns` are for that one result. Two turns of "reply with one word" reported cost 0.0385 then 0.0671, and `modelUsage.inputTokens` 2 then 6 while `usage.input_tokens` was 2 then 4. Gatehouse's usage store therefore adds only the change in cost and in `modelUsage` since the last result for that session, and takes tokens from `usage`.
- The `canUseTool` options also carry `toolUseID`, `agentID`, `defaultToNo`, `suppressAlwaysAllowRule` and `requestId`. The Host echoes `toolUseID` in every result and treats `defaultToNo` as "never default to allow".
- A `Stop` hook fires at the end of every turn, before the `result` message.
- Starting a session adds about 0.04 USD of cache setup to the first turn on this account, so a one-word turn costs a few cents.

## MCP SDK (1.32.2)

- Stateless HTTP: `new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })`, one `McpServer` and one transport per request, `transport.handleRequest(req, res, parsedBody)`. A `tools/call` request needs no earlier `initialize` in this mode, so the Host calls it with a single JSON-RPC `fetch`.
- `registerTool` with an `outputSchema` (a zod shape) validates `structuredContent` and returns it with a text copy.
- In-memory pair for tests: `InMemoryTransport.createLinkedPair()` from `@modelcontextprotocol/sdk/inMemory.js`.

- Server: `McpServer` (`@modelcontextprotocol/sdk/server/mcp.js`) with `registerTool(name, { title?, description?, inputSchema?, outputSchema? }, handler)`. The older `tool()` is deprecated.
- Transports: `StdioServerTransport` (`server/stdio.js`), `StreamableHTTPServerTransport` (`server/streamableHttp.js`). Stateless mode is `new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` with `transport.handleRequest(req, res, body)`. Host, Origin and bearer checks are Gatehouse's own, in front of it.
- Client: `Client` (`client/index.js`) with `connect(transport)`, `listTools()`, `callTool({ name, arguments })`. Transports: `StreamableHTTPClientTransport`, `StdioClientTransport`.
- Agent SDK also offers `createSdkMcpServer` and `tool(...)` for in-process servers. Gatehouse does not use them. The Approver is a separate process and the Companion is stdio.

## Effort (28 Oct)

- `Options.effort` takes `'low' | 'medium' | 'high' | 'xhigh' | 'max'` (`EffortLevel`) and sets the reasoning effort when a session starts.
- Mid-session the Host calls `query.applyFlagSettings({ effortLevel })` with that one key only. The flag layer can carry other settings, including permission rules, so nothing else is ever sent through it (invariant 5).
- `acceptEdits` and `auto` are now allowed permission modes by owner decision. Claude Code approves some calls itself in those modes without calling `canUseTool`; the PreToolUse floor still runs first and the PostToolUse hook records those calls as `claude-code-auto` in the audit log.
- Since 29 Oct the PreToolUse hook also asks the Approver in those two modes (`apps/host/src/hooks.ts`). `HookPermissionDecision` is `allow | deny | ask | defer`; JCVC uses only `deny` and `ask`. The SDK says that with a canUseTool callback, an `ask` from a hook "surfaces via a can_use_tool control_request" (sdk.d.ts, 0.3.310), so the call reaches canUseTool even where the mode would have approved it. The hook keeps the verdict by tool use id and canUseTool uses it, so the Approver judges and records each call once. Confirmed live on 29 Oct: a real session in Auto mode (it reported permissionMode auto) on a small model, whose hook answered ask for a Bash call, called canUseTool for it.
- In-process tools carry explicit annotations (`apps/companion/src/handlers.ts`): Claude Code reads an unset `destructiveHint` as false, and in Auto mode a tool with `permission_policy: always_ask` still asks only if it is annotated destructive. JCVC does not mark its own tools always_ask: none of them changes your files.
