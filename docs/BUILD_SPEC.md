# Gatehouse Build Specification

This document is the authoritative specification for this repository. Read it in full before starting any phase.

## 1. Mission

Build Gatehouse, a local Windows workbench for running Claude agent sessions with the Claude Agent SDK on the user's Accenture SSO Claude login.

- A custom MCP Approver decides low-risk permission requests automatically.
- Everything else is escalated to the desktop UI and an iPhone at the same time. The first valid answer wins.

Project status

- Accenture has approved this project for build and use. Build the complete system, including the phone channel.
- Single user, one corporate Windows laptop.
- The phone relay runs on the user's own server, which already runs Docker, Caddy and Authentik.

## 2. Components

| Component | Where | Role |
|---|---|---|
| Host | Laptop, `127.0.0.1:47820` | Node backend. Runs SDK sessions, serves the Web UI, owns escalation and the relay client. |
| Approver | Laptop, `127.0.0.1:47821/mcp` | MCP server. Policy engine, verdicts and audit. Control plane only, never loaded into an agent session. |
| Companion | Laptop, stdio | MCP server loaded into agent sessions. A small set of agent-facing tools. |
| Web UI | Served by Host | Desktop interface. |
| Relay | User's server, Docker behind Caddy | Stores ciphertext and signed decisions, sends Web Push. Untrusted by design. |
| Phone app | Served by Relay | Installable PWA used from the iPhone Home Screen. |

## 3. Security invariants (non-negotiable)

Copy this section into CLAUDE.md in Phase 0. Every phase must keep these true. Write an automated test for every invariant that can be tested.

1. **Fail closed.** Any Approver error, timeout, malformed verdict or crash means escalate, never allow.
2. **Deny-only floor.** The PreToolUse floor hook returns deny or no decision. It never returns allow.
3. **Permission modes.**
   - Never use `bypassPermissions`, auto mode, `allowDangerouslySkipPermissions` or any equivalent.
   - The only allowed modes are `default` and `plan`.
   - Set the mode explicitly on every session.
4. **No bare tool names in `allowedTools`.** Treat the SDK warning `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`, or any equivalent, as a fatal startup error.
5. **No `updatedPermissions`.** Never return it from `canUseTool`. "Remember" writes to the Gatehouse policy overlay instead, so the Approver stays the single decider and every decision keeps a rule id.
6. **Credentials.**
   - Never read, copy, log or transmit `%USERPROFILE%\.claude\.credentials.json` or any token.
   - Strip `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN` from the environment passed to the SDK.
   - Sign-in only happens through Anthropic's own flow in the unmodified Claude Code binary.
7. **Local listeners.** All listeners bind to 127.0.0.1 only. Each one:
   - requires a bearer token
   - checks the Host header against an allowlist
   - rejects unexpected Origin headers.

   The Web UI uses a per-launch session token.
8. **The Relay is untrusted.** It only ever holds ciphertext. The Host accepts a phone decision only when all of these hold:
   - the WebAuthn assertion verifies against the pinned credential
   - the nonce is unused
   - the envelope is unexpired
   - the payload hash matches the request the Host sent.
9. **Push payloads.** Payloads routed through the Relay carry no plaintext command text, paths, file names or project names. Detail is end-to-end encrypted and only decrypted on the phone.
10. **Edited input is re-evaluated.** If the user edits a tool input before allowing it, the edited input passes through the floor and the full policy again. A deny result blocks the allow.
11. **Phone scope.** The phone can allow, deny, answer questions and trigger the kill switch. It cannot edit inputs, change policy or create remember rules.
12. **Redaction first.** Redact before persisting or transmitting anything: audit log, Relay payloads and logs.
13. **Audit everything.** Every decision goes into the hash-chained audit log. That includes automatic allows and the deciding channel.
14. **Org guard.** Sessions refuse to start unless the signed-in account belongs to the expected organisation in Gatehouse settings.
15. **Judge limits.** The LLM judge (Phase 7) never sees transcripts, file contents or web content. It may only return allow for whitelisted categories.
16. **Branding.**
    - Do not name or style the product as Claude Code or claude.ai, and do not imitate their visual design.
    - "Powered by Claude" is allowed.
    - No Anthropic logos.

## 4. Ground truth and verification

The Agent SDK, MCP SDK and Impeccable change frequently. Code in this spec shows intent, not guaranteed signatures.

**Phase 0 verification**
- Read the installed type definitions, for example `node_modules/@anthropic-ai/claude-agent-sdk/*.d.ts` and the MCP SDK types.
- Record the verified API surface in `docs/sdk-notes.md`, with package versions and the date verified.
- Use only APIs recorded there.

**Versions and dependencies**
- Pin exact versions and commit the lockfile.
- Run `npm audit` at every checkpoint and report the findings.
- If a required capability is missing in the installed version, stop at the checkpoint and propose options.

**Facts to verify, not assume**
- **Bundled binary.** The Agent SDK runs a bundled Claude Code binary shipped as an optional dependency. Never install with `--omit=optional`.
- **Managed settings.** Accenture's managed settings always apply to SDK sessions. Gatehouse can only be stricter.
- **Self-approved calls.** Calls Claude Code approves on its own never reach `canUseTool`. Examples are reads inside the working directory and read-only commands.
  - The floor hook is the only place that sees every call.
  - Secret-file protection therefore lives in the floor.
- **Special tools.** `AskUserQuestion` and `ExitPlanMode` arrive through `canUseTool`.
- **Echo input on allow.** Older versions rejected an allow without `updatedInput`, so always echo the input back.
- **Prompt and settings loading.** The SDK does not load Claude Code's system prompt or filesystem settings unless asked.
  - Set `systemPrompt` to the Claude Code preset and `settingSources` to `["user","project","local"]` explicitly.
  - Then verify that CLAUDE.md, skills and user MCP servers load.

## 5. Architecture

```
[Web UI]  <-- WebSocket + per-launch session token -->  [Host  Node 24, 127.0.0.1:47820]
                                                          | one SDK query() per session
                                                          | PreToolUse floor (deny-only)
                                                          | canUseTool -> MCP client
                                                          v
                             [Approver MCP  127.0.0.1:47821/mcp, bearer token, spawned by Host]
                               policy engine, parsers, verdicts, audit writer
                             [Companion MCP  stdio, loaded into agent sessions]
                               notify_user, create_checkpoint, get_policy_summary
                                                          |
                                       outbound HTTPS only, Host polls
                                                          v
                  [Relay  Docker on user's server, behind Caddy]  ciphertext store, Web Push (VAPID)
                                                          |
                                                          v
                           [Phone app  PWA on iPhone Home Screen]  decrypt, Face ID, sign
```

### Request flow

1. Claude proposes a tool call.
2. The floor hook checks for secrets, critical paths and obfuscated shell. A match returns deny with a reason.
3. Managed and SDK rules run. Calls approved here execute and are audited through PostToolUse.
4. `canUseTool` fires. The Host calls `evaluate_permission` on the Approver with a 5 second timeout.
5. The Approver parses the call and applies the rules, with deny winning. It returns allow, deny or escalate.
6. On escalate, the broker creates an EscalationRequest and shows it in the Web UI.
   - Unless quiet hours apply, it also encrypts the request for the phone and posts it to the Relay.
   - The Relay then sends a Web Push.
7. The first valid answer wins.
   - A desktop answer needs the session token.
   - A phone answer needs a verified signed envelope.
   - The other channel is cancelled and shows the outcome, for example "Approved on desktop at 14:02".
8. Timeouts.
   - Phone delivery expires after 10 minutes, and the desktop request stays pending.
   - After 30 minutes the result is deny with "Timed out waiting for approval".
9. Every step goes into the audit log.

### Why Web Push instead of ntfy

- iOS opens links from other apps in Safari, and a Home Screen app keeps its storage separate from Safari.
- The phone's keys live in the Home Screen app, so a notification must open that app.
- A Web Push notification opens the Home Screen app directly, which ntfy cannot do.

## 6. Repository layout

```
gatehouse/
  CLAUDE.md
  PRODUCT.md                written by /impeccable init in Phase 4
  DESIGN.md                 written by /impeccable document in Phase 5
  apps/
    host/                   SDK sessions, WS API, broker, relay client, CLI harness
    approver/               MCP server, control plane
    companion/              MCP server, agent-facing tools
    web/                    Vite + React desktop UI
    relay/                  Fastify service for the user's server
    phone/                  PWA served by the Relay
  packages/
    shared/                 zod schemas, canonical JSON, crypto helpers, types
    policy/                 policy engine, bash and PowerShell parsers, golden tests
  policy/
    rules.yaml
    projects/               per-project overlays, tighten only
    rules.local.yaml        remember rules written by the desktop UI
  deploy/relay/             docker-compose.yml, .env.example, Caddy snippet
  scripts/                  start.ps1, ps-ast.ps1, verify-audit.ps1, dpapi.ps1
  docs/                     BUILD_SPEC.md, sdk-notes.md, threat-model.md, runbook.md, policy-guide.md
```

**Tooling**
- npm workspaces. Do not require pnpm or yarn.
- TypeScript strict everywhere, with ESLint, Prettier and Vitest.
- `.gitattributes` set to `* text=auto eol=lf`.
- Cross-platform npm scripts. Use no shell-specific commands such as `rm -rf`.

**On the laptop**
- Avoid native addons. Prefer WASM builds, for example `web-tree-sitter` with the bash grammar WASM.
- Keep local data under `%LOCALAPPDATA%\Gatehouse\` (config, state, audit).
- Use atomic writes: write a temp file, then rename.

## 7. Contracts (packages/shared)

Define the contracts with zod and export the inferred types.

```ts
export const Outcome = z.enum(["allow", "deny", "escalate"])

export const Verdict = z.object({
  outcome: Outcome,
  ruleId: z.string(),
  reason: z.string(),
  risk: z.number().int().min(0).max(100),
  segments: z.array(z.object({ text: z.string(), ruleId: z.string(), outcome: Outcome })).optional(),
  decidedBy: z.enum(["floor", "rules", "judge", "human-desktop", "human-phone", "timeout", "evaluator-unavailable"]),
  policyHash: z.string(),
})

export const EscalationRequest = z.object({
  id: z.string(),                 // UUIDv7
  nonce: z.string(),              // 32 random bytes, base64url
  kind: z.enum(["permission", "question", "plan"]),
  sessionId: z.string(),
  toolUseId: z.string(),
  toolName: z.string(),
  input: z.unknown(),             // redacted copy
  cwd: z.string(),
  project: z.string(),
  verdict: Verdict,
  createdAt: z.string(),
  expiresAt: z.string(),
  payloadHash: z.string(),        // SHA-256 of the canonical plaintext payload sent to the phone
})

export const DecisionEnvelope = z.object({
  v: z.literal(1),
  type: z.enum(["decision", "answer", "kill"]),
  requestId: z.string().optional(),
  nonce: z.string().optional(),
  decision: z.enum(["allow", "deny"]).optional(),
  message: z.string().max(500).optional(),
  answers: z.record(z.string()).optional(),
  payloadHash: z.string().optional(),
  deviceId: z.string(),
  issuedAt: z.string(),
  expiresAt: z.string(),
})
```

- **Canonical JSON** uses RFC 8785 (JCS).
- **WebAuthn challenge.** The challenge for a phone decision is SHA-256 of the canonical envelope.
- **Clock skew.** Allow 2 minutes between laptop, Relay and phone.

## 8. Policy engine (packages/policy)

### Rules

- **Format and loading.** YAML, validated with JSON Schema, hot-reloaded. Every verdict records the policy hash.
- **Evaluation order.** Floor, deny, escalate, allow, then default.
  - Deny wins.
  - An unknown tool means escalate.
  - A parse error means escalate.
- **Path globs** are relative to the session's project root, which is the git root of `cwd`.
- **Command patterns** match each normalised command segment.
  - `*` is a wildcard.
  - PowerShell cmdlet names match case-insensitively.
  - Define the full semantics in `docs/policy-guide.md`.
- **Project overlays** in `policy/projects/<name>.yaml` can only add deny or escalate rules, or remove allows. The loader rejects any overlay that widens access.
- **Remember rules** in `rules.local.yaml` come from the desktop UI only.
  - They are narrow: an exact command or an exact path.
  - They can never cover a floor or deny category.

### Windows path handling

- Resolve with `realpath`, normalise separators and compare case-insensitively.
- UNC paths (`\\server\share`) and device paths (`\\?\`, `\\.\`) escalate.
- Junctions and symlinks that resolve outside the workspace roots count as outside.
- Resolve 8.3 short names before matching.

### Bash parsing

- Use `web-tree-sitter` with the bash grammar.
- Collect every simple command across `&&`, `||`, `;`, `|`, newlines, subshells, `$()`, backticks, process substitution and functions.
- Every segment must match an allow rule for the whole call to be allowed.
- Escalate or deny, per the rules, on:
  - `ERROR` nodes
  - heredocs
  - `eval`
  - `bash -c` or `sh -c` with dynamic payloads
  - pipes into a shell.

### PowerShell parsing

- **Parser.** `scripts/ps-ast.ps1` runs under `pwsh -NoProfile -NonInteractive` with the command text on stdin.
  - It uses `System.Management.Automation.Language.Parser.ParseInput`.
  - It returns every `CommandAst` with its name and text.
- **Worker.** Keep a warm `pwsh` worker process to avoid start-up latency. If the worker is unavailable, escalate.
- **Deny or escalate triggers:**
  - `-EncodedCommand` or `-enc`
  - `Invoke-Expression` or `iex`
  - dynamic invocation (a null command name)
  - `Start-Process`
  - `[ScriptBlock]::Create`
  - `Add-Type`
  - `DownloadString`
  - registry writes
  - `Set-ExecutionPolicy`
- **Language mode.** Detect Constrained Language Mode at start-up and report it in the UI.

### Seed rules file (policy/rules.yaml)

```yaml
version: 1
workspaceRoots: ["C:/dev", "C:/Users/<you>/source"]
defaults:
  unknownTool: escalate
  parseError: escalate
  judge: { enabled: false, model: haiku, maxInputChars: 4000 }
quietHours: { start: "22:00", end: "07:00", tz: "Europe/London", phone: false }

floor:
  - id: secrets-files
    tools: [Read, Edit, Write, MultiEdit, NotebookEdit, Bash, PowerShell, Grep, Glob]
    pathGlobs: ["**/.env", "**/.env.*", "**/*.pem", "**/*.pfx", "**/*.key", "**/id_rsa*", "**/id_ed25519*",
                "**/.aws/**", "**/.azure/**", "**/.ssh/**", "**/.claude/.credentials.json"]
    message: "Secrets files are blocked by policy. Ask the user to provide the values instead."
  - id: obfuscated-shell
    powershell: { encodedCommand: true, invokeExpression: true, dynamicInvocation: true }
    bash: { evalDynamic: true, pipeToShell: true }
  - id: critical-paths
    pathGlobs: ["C:/Windows/**", "C:/Program Files/**", "C:/Program Files (x86)/**"]
    tools: [Edit, Write, MultiEdit, Bash, PowerShell]

deny:
  - id: outside-workspace-write
    tools: [Edit, Write, MultiEdit, NotebookEdit]
    pathOutside: workspaceRoots
  - id: destructive-shell
    commands: ["rm -rf /*", "rm -rf ~*", "Remove-Item * -Recurse -Force*", "format *", "diskpart*",
               "git push --force*", "git push -f*", "git reset --hard*", "git clean -fdx*"]

escalate:
  - { id: package-install, commands: ["npm install*", "npm i *", "pip install*", "winget*", "choco*"], risk: 70 }
  - { id: network, tools: [WebFetch, WebSearch], commands: ["curl*", "Invoke-WebRequest*", "Invoke-RestMethod*"], risk: 60 }
  - { id: git-remote, commands: ["git push*", "git remote*", "gh *"], risk: 80 }
  - { id: mcp-external, tools: ["mcp__*"], exceptTools: ["mcp__companion__*"], risk: 60 }
  - { id: unc-path, pathUnc: true, risk: 90 }

allow:
  - { id: read-workspace, tools: [Read, Glob, Grep], pathInside: workspaceRoots }
  - { id: edit-workspace-source, tools: [Edit, Write, MultiEdit], pathInside: workspaceRoots,
      pathGlobs: ["src/**", "test/**", "tests/**", "docs/**", "*.md"] }
  - { id: safe-shell, everySegmentMustMatch: true,
      commands: ["git status*", "git diff*", "git log*", "npm test*", "npm run lint*", "npx tsc --noEmit*",
                 "Get-ChildItem*", "Get-Content*"] }
  - { id: companion-tools, tools: ["mcp__companion__notify_user", "mcp__companion__create_checkpoint",
                                   "mcp__companion__get_policy_summary"] }

judgeEligible: [network]
```

### Golden tests and replay

- **Golden tests.** At least 250 cases in `packages/policy/test/golden/*.yaml`, each with an input, the expected outcome and the expected rule id. They must cover:
  - chaining and pipes
  - subshells and substitutions
  - quoting tricks
  - PowerShell aliases and case variants
  - encoded commands
  - Windows path tricks (case, separators, UNC, junctions, short names, `..`)
  - secrets reached through every tool
  - MCP tools and unknown tools
  - parse failures
  - overlay widening attempts.
- **Replay harness.** `npm run policy:replay -- --rules <candidate.yaml> --audit <file>` lists every past decision that would change under the candidate rules.

## 9. Approver MCP server (apps/approver)

**Transport and process**
- Streamable HTTP on `127.0.0.1:47821/mcp`, stateless.
- The Host spawns it as a child process and passes a random per-launch bearer token through the environment.
- The Host restarts it on crash with back-off, and escalates everything while it is down.

**Request guard**
- Bearer token required.
- Host header must be in the allowlist.
- Reject any request that carries an Origin header.
- 256 KB body limit.

**Tools**
- `evaluate_permission(toolName, input, ctx)` returns a Verdict as structured content.
- `explain_verdict(ruleId)` returns the rule text and rationale for the UI.
- `policy_status()` returns the policy hash, load errors and active overlays.
- `approval_prompt(tool_name, input, tool_use_id?)` serves headless `claude -p --permission-prompt-tool` runs.
  - These runs have no human path, so escalate becomes deny with a clear message.
  - Verify the expected output format against the installed version before relying on it.

**Audit.** The Approver writes the audit record for every verdict it produces.

## 10. Companion MCP server (apps/companion)

The Companion is loaded into each agent session through `mcpServers` over stdio. It exposes three tools.

- `notify_user(text)`
  - Sends an end-to-end encrypted phone notification and a desktop toast.
  - Maximum 140 characters, maximum one per minute per session, and redacted.
- `create_checkpoint(label)` creates a git checkpoint (see section 11).
- `get_policy_summary()` returns a short summary of what is pre-approved, so the agent can choose allowed commands.

Do not expose arbitrary policy probing to the agent.

## 11. Host (apps/host)

### Runtime

- **Stack.** Node 24 LTS (22 minimum) with Fastify and WebSocket.
- **Serving.** The Host serves the built Web UI in production and proxies Vite in development. Allow only the UI's own origin.
- **Sessions.** One SDK `query()` per session, using streaming input so that interrupt, mode switch, model switch and follow-ups all work.
- **Per-session options.** Verify every name in `sdk-notes.md`.
  - `cwd`, `model`
  - `permissionMode: "default"`
  - `systemPrompt`: the Claude Code preset
  - `settingSources: ["user","project","local"]`
  - `canUseTool`
  - `hooks`: PreToolUse floor, PostToolUse audit, Notification, Stop, SubagentStart, SubagentStop
  - `mcpServers`: the Companion
  - `includePartialMessages: true`
  - a sanitised `env`
- **Resume and fork** use the SDK session options. List past sessions through SDK APIs if they exist. Otherwise read the Claude Code session files read-only.

### Sign-in and org guard

- **Account check.** At start-up, check sign-in state through the SDK account information API if it is available. Show the signed-in email and organisation in the UI header.
- **First run.** If not signed in, show a first-run screen that opens a terminal running the bundled Claude Code binary.
  - The user completes `/login` through Anthropic's SSO flow there.
  - Never capture or proxy that flow.
- **Org match.** Compare the organisation with `expectedOrg` in Gatehouse settings. On a mismatch, block sessions and explain why.
- **Managed policy.** Detect whether managed policy is active and show it in the UI.

### canUseTool handler

- `AskUserQuestion` goes to the broker as kind `question`. Return the answers in `updatedInput`, in the shape the installed SDK expects.
- `ExitPlanMode` goes to the broker as kind `plan`.
- Everything else goes to the Approver.
  - Allow echoes the input back.
  - Deny returns the rule id and reason to Claude so it can adapt.
  - Escalate goes to the broker.
- Edited input from the desktop runs through the floor and the Approver again before it is allowed (invariant 10).

### Broker

- First answer wins across desktop and phone, with one AbortController per request.
- Honour the SDK abort signal. An interrupted session cancels its requests everywhere.
- Phone expiry is 10 minutes and the hard timeout is 30 minutes. Both are configurable.
- Quiet hours hold phone delivery. The desktop still shows the request.

### Kill switch

- It can be triggered three ways:
  - the desktop button
  - a UI keyboard shortcut
  - a signed phone command.
- It interrupts all sessions and puts the Approver into deny-all until the user re-arms it on the desktop.

### Git checkpoints

- **When.** Before any escalated call, and before edit bursts (configurable).
- **How.** Create the checkpoint without touching the working tree or index, for example `git stash create` followed by `git update-ref refs/gatehouse/checkpoints/<session>/<timestamp>`.
- **Restore.** List and restore checkpoints in the UI. Restore shows the diff first and asks for confirmation.

### Audit

- **Storage.** One JSONL file per month under `%LOCALAPPDATA%\Gatehouse\audit\`.
- **Chain.** Each record carries `prevHash` and `hash`. `npm run audit:verify` and `scripts/verify-audit.ps1` check the chain.
- **Record fields:**
  - timestamp, session, tool
  - redacted input
  - verdict, rule id, policy hash
  - decider, channel, latency
  - judge rationale where the judge was used.

### Redaction

- **Built-in patterns:**
  - tokens and keys
  - connection strings
  - JWTs
  - Authorization headers.
- **User list.** A user-maintained list of client names and internal hostnames.
- **Where it applies.** Before the audit log, Relay payloads and logs.

### Usage

Record token usage and the cost fields from SDK result messages, per session and per project.

### Relay client

- **Device token.** Store it with Windows DPAPI (current user scope) through `scripts/dpapi.ps1`.
- **Encryption.** Encrypt payloads to the phone's ECDH public key, then post them to the Relay.
- **Decisions.** Long-poll the Relay for decisions, verify each one, then resolve the request.

### WebSocket API to the UI

- **Events.** Typed with zod:
  - SDK messages
  - approvals and resolutions
  - session state
  - audit stream
  - usage
  - health of the Approver, Relay and sign-in.
- **Commands:**
  - prompt, interrupt
  - set mode, set model
  - approve, deny, answer
  - kill, re-arm
  - checkpoint restore
  - remember rule
  - pair, revoke and rename device.

### CLI harness

`npm run host:cli` runs a session in the terminal and answers approvals on the command line, so Phase 3 can be tested without the UI.

## 12. Relay (apps/relay) and deployment

### Service

- **Stack.** Fastify on Node 24 with SQLite.
- **Image.** Docker image for arm64 and amd64 on a Debian slim base. Oracle Cloud free tier is ARM.
- **Stored data:**
  - pairing sessions
  - device records
  - push subscriptions
  - encrypted requests
  - signed envelopes.
- **Retention.** Purge expired items every minute. Never store plaintext detail.

### Device API

The device API serves the laptop. It uses the bearer device token and no Authentik.

- `POST /api/device/requests` stores `{ id, ciphertext, expiresAt, priority }` and sends the Web Push.
- `GET /api/device/decisions?wait=25` long-polls for signed envelopes.
- `POST /api/device/requests/:id/resolved` marks a request resolved so the phone updates.
- `POST /api/device/notify` sends an encrypted notification (Stop, idle, `notify_user`).
- Pairing endpoints cover the laptop side of pairing.

### Phone API

- `GET /api/phone/pending`
- `GET /api/phone/requests/:id`, which returns ciphertext
- `POST /api/phone/envelopes`
- Push subscription endpoints and pairing endpoints.
- **Authentication.** A WebAuthn assertion per app session, which the Relay verifies against the registered credential. Authentik forward auth is an additional layer on top.

### Web Push

- **VAPID keys** are generated on first run and stored in the container volume.
- **Decryption.** The service worker decrypts payloads with the phone's ECDH private key before showing a notification. The key is held in IndexedDB and is non-extractable.
- **Notification text** is generic by default, such as "Approval needed" or "Session finished".
- **Lock-screen detail.** A phone setting, "Show details on lock screen", shows the decrypted detail. It is off by default.

### Caddy and Authentik

- **Caddy snippet.** Generate a snippet to merge into the user's existing Caddyfile. Do not generate a new Caddy setup.
  - Route `/api/device/*` straight to the Relay.
  - Route the PWA and `/api/phone/*` through Authentik forward auth.
- **Known iOS risk.** Authentik's login redirect inside a Home Screen app may not keep its session in standalone mode.
  - Test this on a real iPhone in Phase 6.
  - If it fails, keep Authentik for admin pages only and rely on the Relay's WebAuthn session authentication for the PWA.
  - Record the result in `docs/runbook.md`.

### Deployment files

- `deploy/relay/docker-compose.yml`
- `.env.example`
- The Caddy snippet
- A deploy section in the runbook.

## 13. Phone app (apps/phone)

### App basics

- Installable PWA with a manifest, service worker and icons.
- iOS only allows notifications after the app is added to the Home Screen. Onboarding must guide the user through that first.

### Pairing

1. The desktop shows a pairing code (8 characters, 5 minute expiry) and creates a pairing session that holds a WebAuthn registration challenge.
2. The user enters the code in the installed PWA. The PWA then:
   - generates an ECDH P-256 key pair, with the private key non-extractable in IndexedDB
   - creates a passkey with user verification required
   - subscribes to Web Push
   - posts the registration to the Relay.
3. The Host fetches and verifies the registration, then shows a 6-digit fingerprint derived from both public keys.
4. The PWA shows the same fingerprint, and the user confirms the match on the desktop.
5. The Host pins the passkey credential and the ECDH public key.

### Flows

- **Approve.** Open the notification, then the request. The app decrypts and shows the detail. Choose Allow or Deny, with an optional message. Face ID runs through a WebAuthn assertion over the envelope challenge, then the app posts the signed envelope.
- **Questions.** Render the AskUserQuestion options and sign the answers.
- **Kill switch.** A signed `kill` envelope, confirmed with Face ID.

### Devices

- The desktop lists paired devices and can rename or revoke them.
- Revoking removes the pinned key immediately.
- If the phone loses its keys, the user pairs again.

### Cryptography

- **Payload encryption.** Ephemeral ECDH P-256, HKDF-SHA-256 and AES-256-GCM, with the request id as additional data. Both ends use WebCrypto.
- **WebAuthn.** Use `@simplewebauthn/browser` and `@simplewebauthn/server`. Accept a signature counter of 0, which synced passkeys use.

## 14. Design and GUI

### Skill roles

- **Impeccable** (`.claude/skills/impeccable`) owns:
  - visual direction
  - layout, typography and colour
  - UX copy
  - accessibility
  - design QA.
- **Emil Kowalski's skills** own:
  - motion and interaction feel
  - library choices
  - worst-case data testing
  - native feel on the phone.

### Precedence

- PRODUCT.md and DESIGN.md come first, then Impeccable's craft floor, then Emil's motion rules.
- For motion, use Emil's skills instead of `/impeccable animate`. Never run both on the same element.

### Verification passes

Follow Impeccable's bounded verification:
1. Build fully.
2. Inspect once, desktop and mobile together.
3. Fix everything in one batch.
4. Confirm with at most one more round.

### Curated libraries

These picks come from Emil's `pick-ui-library` list. That skill only runs when the user invokes it, so the picks are written here.

- base-ui for dialogs, popovers, menus, selects and tooltips.
- cmdk for the command palette: sessions, slash commands and actions.
- Sonner for toasts. Use Emil's `ask-sonner` skill when wiring it.
- motion for springs, layout and enter or exit animation. Use plain CSS transitions for simple hovers and fades.
- NumberFlow for counters: pending approvals, tokens and cost.
- shiki for highlighting commands, code and diffs. Lazy-load it, and highlight long diffs in a Web Worker.
- Virtuoso for the transcript, the audit log and any list that can grow past a few hundred rows.
- zustand for client state. clsx for conditional classes and cva for component variants.
- recharts for policy analytics.
- Tailwind CSS for styling.
- Outside the curated list, and flagged as such in the checkpoint report:
  - `react-markdown` with `remark-gfm` for assistant text
  - `diff` for line diffs.

### Product context for /impeccable init

Use these answers when init asks.

- **Register:** product UI.
- **Mode:** Operate.
- **Platforms:**
  - Desktop web app served locally on Windows, used in Edge or Chrome at 1366 to 1920 pixels wide, primary 1440 by 900.
  - Companion iPhone PWA at 390 by 844.
- **User:** one senior technology architect running several Claude agent sessions at once across client and internal projects. Switches context constantly, and often decides from an iPhone away from the desk.
- **Purpose:** run Claude agent sessions locally and decide quickly and safely what they may do. Most decisions are automatic. The interface exists for the few that are not.
- **Jobs:**
  - See what needs me now.
  - Understand exactly what will run, where, and why it was escalated.
  - Decide in seconds without mistakes.
  - Trust that automatic decisions were right.
  - Tune the policy over time.
- **Principles:**
  - Decisions first.
  - Show the real command, never a paraphrase.
  - Calm by default, urgent only when it matters.
  - Allowing is deliberate, denying is easy.
  - Every automatic decision is explainable.
  - Keyboard first on desktop, thumb first on phone.
- **Anti-goals:**
  - Not a chat toy.
  - Not a clone of Claude Code or claude.ai.
  - No marketing gloss and no gamification.
- **Accessibility:**
  - WCAG 2.2 AA in light and dark themes.
  - Risk is never shown by colour alone.
  - Respect reduced motion.
  - Full keyboard operation.
- **Voice:** plain, precise UK English in sentence case, with no em dashes and no hype.

### Surfaces

Run `/impeccable shape` for each surface, in this order.

1. Approval card and queue. This is the most important surface.
2. Session workspace:
   - transcript, tool cards and diffs
   - todo list and subagent threads
   - composer with slash commands
   - model picker
   - mode toggle (default and plan only)
   - interrupt.
3. Sessions overview:
   - concurrent sessions
   - state (running, waiting on you, idle, error)
   - pending counts
   - usage.
4. Policy studio:
   - rules view
   - test a command
   - replay against the audit log
   - review remember rules
   - activate with a diff.
5. Audit log: filter, search, decision detail, chain verification status, export.
6. Devices and pairing.
7. Settings:
   - expected org and workspace roots
   - quiet hours and timeouts
   - redaction list
   - notifications.
8. First run:
   - sign-in check and org check
   - managed policy detected
   - workspace roots
   - optional phone pairing.
9. Phone app:
   - pending list and request detail
   - Face ID decision
   - question answering
   - kill switch
   - pairing onboarding and Add to Home Screen guidance.

### Approval card requirements

- **What will run.** The exact command or edit, fully visible. Wrap it, never truncate silently. Long input collapses behind a clear "Show all".
- **Where.** Project, working directory and target paths.
- **Why.**
  - Rule id, a plain-language reason, and the risk score and band.
  - Highlight the segment that triggered escalation inside the parsed command.
- **Status.** When the phone was notified, the phone expiry and the desktop timeout.
- **Actions:**
  - Allow once
  - Deny
  - Deny with a message to Claude
  - Edit then allow (desktop only)
  - Stop session
  - Remember (desktop only). This is narrow, and the card shows the exact rule it will create.
- **Safety.**
  - Allow needs a deliberate chord on desktop, such as Ctrl+Enter.
  - Allow is never the default focus when risk is 70 or above.
  - Deny is always one step.
- **Resolution** is visible, for example "Approved on iPhone at 14:02" or "Denied by policy rule destructive-shell".
- **Focus.** New escalations never steal focus from the composer. Signal them with a Sonner toast, a queue badge and an optional browser notification.

### Design process

**Phase 4**
1. Run the Impeccable context step, then `/impeccable init` with the product context above.
2. Shape the surfaces in order and choose the visual world.
3. Use Emil's `prototype` skill to build three distinct approval card variants with realistic data, behind a switcher.
4. CHECKPOINT. The user chooses a variant.

**Phase 5.** Build the desktop UI, then run this sequence.
1. `npx impeccable detect apps/web/src` and `npx impeccable detect http://127.0.0.1:47820`. The exit code must be 0, or every remaining finding must have an ignore with a recorded reason.
2. `/impeccable critique`. Fix every P0 and P1.
3. `/impeccable audit` for accessibility, performance and responsive behaviour.
4. Emil's `break-ui` with worst-case data:
   - commands of 10,000 characters
   - 300 pending approvals
   - 40 concurrent sessions
   - very long paths and Unicode file names
   - empty states
   - Relay offline
   - Approver down.
5. `/impeccable harden` for errors and edge cases.
6. `/impeccable clarify` for all approval and error copy.
7. Emil's `find-animation-opportunities`, `animate`, `review-animations` and `animation-performance`. The transcript streams constantly, so keep animation work off the main thread.
8. `/impeccable polish`.
9. `/impeccable document` to write DESIGN.md.

**Phase 6 phone app**
1. `/impeccable adapt`.
2. Emil's `mobile-native` and `apple-design`.
3. `npx impeccable detect --viewport 390x844` against the phone app URL.
4. `break-ui`.
5. `/impeccable polish`.

If managed settings block Impeccable hooks, run the detector manually after every UI task.

## 15. Phases and acceptance criteria

### Phase 0. Verify and scaffold

1. Confirm Node, Git Bash and pwsh, and that Impeccable and Emil's skills are installed. If anything is missing, stop and tell the user.
2. Scaffold:
   - the workspaces and tooling
   - CLAUDE.md, covering mission, invariants, commands and conventions
   - `.gitattributes`.
3. Install exact versions of the Agent SDK and MCP SDK.
4. Write `docs/sdk-notes.md` from the installed types. It must cover:
   - query options
   - the `canUseTool` signature and return shape
   - hook event names and outputs
   - the AskUserQuestion shape
   - the account information API
   - session listing and resume
   - the streaming input message shape
   - MCP server and client APIs.
5. Spike one session through a minimal CLI harness and confirm:
   - the signed-in organisation
   - whether managed settings are reported
   - that `canUseTool` fires on a Write
   - that the floor hook fires on a Read
   - that CLAUDE.md loads.
6. CHECKPOINT.

### Phase 1. Policy engine

**Build**
- The engine, schema and loader, including overlay rules.
- The bash and PowerShell parsers.
- The floor categories and redaction.
- The golden tests and the replay harness.
- `docs/policy-guide.md`.

**Accept**
- All goldens pass.
- 95% line coverage in `packages/policy`.
- p95 evaluation under 20 ms for typical commands, excluding the first PowerShell worker start.

CHECKPOINT.

### Phase 2. Approver and Companion

**Build**
- Both MCP servers and the request guard.
- The audit writer with its hash chain and verifier.

**Accept**
- An integration test for every tool.
- Guard tests: wrong token, wrong Host, any Origin, oversized body.
- A crash and restart test.

CHECKPOINT.

### Phase 3. Host core

**Build**
- Sessions, `canUseTool` and the floor hook.
- The broker, desktop channel only for now.
- The kill switch and org guard.
- Checkpoints and usage.
- The WS API and the full CLI harness.

**Accept**
- Tests for invariants 1 to 7, 10, 13 and 14.
- A scripted run that shows:
  - auto-allow and auto-deny
  - escalate then approve
  - escalate then time out
  - AskUserQuestion
  - plan approval
  - interrupt and kill.

CHECKPOINT.

### Phase 4. Design foundation

**Build**
- PRODUCT.md and the surface briefs.
- The visual direction.
- Three approval card prototypes.

CHECKPOINT. The user chooses.

### Phase 5. Desktop UI

**Build**
- Every desktop surface in section 14, working against the live Host.
- The full Phase 5 QA sequence.

**Accept**
- The detector is clean, or every finding is justified.
- All critique P0 and P1 issues and all audit issues are fixed.
- A keyboard-only walkthrough of approve, deny, edit, remember and kill.
- Light and dark themes, and reduced motion.
- Optional Playwright smoke tests using the installed Edge (`channel: "msedge"`), so no browsers are downloaded.

CHECKPOINT.

### Phase 6. Relay, phone app and pairing

**Build**
- The Relay service and its deployment files.
- The PWA, pairing, encryption, WebAuthn signing and Web Push.
- The phone-side QA sequence.

**Accept**
- An end-to-end test against a local Relay container.
- Tests for invariant 8:
  - forged signature
  - replayed nonce
  - expired envelope
  - payload hash mismatch
  - revoked device
  - tampered ciphertext.
- Real iPhone checks, listed in the runbook:
  - install, pair and receive a notification
  - Face ID, approve, answer a question, kill
  - Authentik session in standalone mode.

CHECKPOINT.

### Phase 7. Extras

**LLM judge**, off by default:
- A separate SDK query with a Haiku-class model, no tools, one turn, `dontAsk` mode and a strict JSON schema.
- The judge only sees the tool name, the parsed segments and the matched rule.
- Any schema error, low confidence or instruction-like content means escalate.
- It may only allow `judgeEligible` categories.

**Policy analytics**:
- Escalation rate by rule, approval rate and time to decide.
- Suggestions for narrow new allow rules, which the user accepts on the desktop only.

**Other**: quiet hours, the daily digest and usage views.

CHECKPOINT.

### Phase 8. Hardening and packaging

**Threat model.** `docs/threat-model.md` with a test for each threat:
- a port probe from another origin
- DNS rebinding through the Host header
- the evaluator killed mid-session
- the Relay returning modified data
- chained command bypasses
- secrets reached through every tool
- edited input that hits a deny rule.

**Start-up.** `scripts/start.ps1` starts the Host, which spawns the Approver, and opens the UI. Document optional start at logon through Task Scheduler, but do not enable it automatically.

**Runbook.** `docs/runbook.md` covers:
- start and sign in
- pair a phone and revoke a device
- rotate the device token and VAPID keys
- update the SDK safely
- verify the audit chain
- recover from a lost phone.

**Final checks.** A final `npm audit` and a licence check with no AGPL dependencies.

FINAL CHECKPOINT.

## 16. Working conventions

- **Plans.** Plan first for each phase. Keep plans short and concrete.
- **Commits.** Small commits with conventional commit messages. One branch per phase, merged at the checkpoint.
- **Tests first.** Write tests before the policy engine code and before each security invariant.
- **Dependencies.** Add none without stating why in the checkpoint report. Prefer the curated libraries.
- **Language.** UI copy, docs and code comments use plain UK English with no em dashes.
- **Uncertain behaviour.** If you are unsure how the SDK behaves, test it in the CLI harness before building on it.
