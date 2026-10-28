# Gatehouse

Local Windows workbench for running Claude agent sessions with the Claude Agent SDK on the user's Accenture SSO Claude login. A custom MCP Approver decides low-risk permission requests automatically. Everything else escalates to the desktop UI and an iPhone at the same time, and the first valid answer wins.

The authoritative specification is `docs/BUILD_SPEC.md`. Read it before starting any phase. The build is complete through Phase 8. See `docs/BUILD_REPORT.md` for what was built, the deviations and the owner to-do list.

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
    - Owner decision, 28 Oct: the product is shown to the user as "Jean-Claude Van Code" (a pun, not Claude Code). Window, tray, header, installer and phone app use that name. File names, env vars and `%LOCALAPPDATA%\Gatehouse` keep the internal name Gatehouse. Do not imitate Claude Code or claude.ai visuals.

## Commands

| Command | Purpose |
|---|---|
| `npm ci` | Install from the lockfile. Never use `--omit=optional` (the SDK's bundled binary is an optional dependency). |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc` per workspace |
| `npm test` | Vitest (all workspaces) |
| `npm run test:coverage` | Vitest with coverage. `packages/policy` must stay at 95% of lines. |
| `npm audit` | Run and report at the end of every phase |
| `npm run host:cli` | Phase 0 spike CLI, later the full CLI harness |
| `npm run approver` | Start the Approver on its own (the Host normally starts it with a per-launch token) |
| `npm run policy:replay -- --rules <file> --audit <file>` | List decisions a candidate rules file would change |
| `npm run audit:verify` | Check the audit hash chain. `pwsh scripts/verify-audit.ps1` does the same without Node. |
| `pwsh scripts/start.ps1` | Start the Host (which starts the Approver) and open the interface. `-Check` tests it, `-Relay` also starts the phone Relay. |
| `npm run build -w @gatehouse/web` | Build the desktop interface the Host serves. Restart the Host after a rebuild. |
| `npm run package` / `npm run package:check` | Build `dist-appGatehouseGatehouse.exe` with its runtime and app folder next to it (`docs/packaging.md`). |
| `npm run relay` / `npm run relay:build-phone` | Run the phone Relay locally (see `docs/relay-local.md`) and build the phone app. |

Layout: `apps/host` (Host, admin API, phone channel), `apps/approver`, `apps/companion`, `apps/web` (desktop UI), `apps/relay` (phone Relay), `apps/phone` (iPhone PWA), `packages/policy`, `packages/shared`. Design notes are in `PRODUCT.md`, `DESIGN.md` and `docs/design`. The threat model (`docs/threat-model.md`) is checked against real test names by `apps/host/test/threat-model.test.ts`.

Machine facts that shape the design (details in `docs/sdk-notes.md`): the managed policy on this laptop blocks stdio and http MCP servers in sessions but allows in-process SDK servers, so the Companion reaches sessions as an in-process server.

## Conventions

- npm workspaces only. TypeScript strict. ESLint, Prettier, Vitest.
- Pin exact dependency versions and commit the lockfile. Add no dependency without stating why in `docs/BUILD_REPORT.md`.
- Use only SDK APIs recorded in `docs/sdk-notes.md`. If the SDK or the machine conflicts with the spec, never break an invariant: record the deviation and the reason in `docs/BUILD_REPORT.md` and keep the invariant true.
- Tests first, especially for the policy engine and each invariant. Prove important tests by breaking the code they guard and checking they fail.
- Small conventional commits. One branch per phase, fast-forwarded into `main` when the phase is done. The owner asked for no phase gates, so work continues through the phases.
- Cross-platform npm scripts. No shell-specific commands such as `rm -rf`.
- Avoid native addons. Local data lives under `%LOCALAPPDATA%\Gatehouse\`. Write files atomically (temp file, then rename).
- UI copy, docs and code comments use plain UK English with no em dashes.
- Impeccable hooks are not enabled. Run `npx impeccable detect` manually after UI tasks.
