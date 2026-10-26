# Gatehouse

Local Windows workbench for running Claude agent sessions with the Claude Agent SDK on the user's Accenture SSO Claude login. A custom MCP Approver decides low-risk permission requests automatically. Everything else escalates to the desktop UI and an iPhone at the same time, and the first valid answer wins.

The authoritative specification is `docs/BUILD_SPEC.md`. Read it before starting any phase. Work phase by phase, plan first, and stop at every CHECKPOINT.

## Security invariants (non-negotiable)

Every phase must keep these true. Write an automated test for every invariant that can be tested.

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

## Commands

| Command | Purpose |
|---|---|
| `npm ci` | Install from the lockfile. Never use `--omit=optional` (the SDK's bundled binary is an optional dependency). |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc` per workspace |
| `npm test` | Vitest |
| `npm audit` | Run and report at every checkpoint |
| `npm run host:cli` | Phase 0 spike CLI, later the full CLI harness |

## Conventions

- npm workspaces only. TypeScript strict. ESLint, Prettier, Vitest.
- Pin exact dependency versions and commit the lockfile. Add no dependency without stating why in the checkpoint report.
- Use only SDK APIs recorded in `docs/sdk-notes.md`. If the SDK conflicts with the spec, stop and tell the user.
- Tests first, especially for the policy engine and each invariant.
- Small conventional commits. One branch per phase, merged at the checkpoint.
- Cross-platform npm scripts. No shell-specific commands such as `rm -rf`.
- Avoid native addons. Local data lives under `%LOCALAPPDATA%\Gatehouse\`. Write files atomically (temp file, then rename).
- UI copy, docs and code comments use plain UK English with no em dashes.
- Impeccable hooks are not enabled. Run `npx impeccable detect` manually after UI tasks.
