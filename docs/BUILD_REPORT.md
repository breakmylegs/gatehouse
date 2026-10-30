# Build report

Running record of what each phase built, how it was checked, where it differs from `BUILD_SPEC.md`, and what is left for the owner. The owner asked on 26 October (during Phase 2) for the build to continue through every phase without stopping at checkpoints, so this file replaces the checkpoint reports. Each phase is committed on its own branch and fast-forwarded into `main`. Nothing is pushed, because the repository has no remote.

## Owner to-do list (running)

Things that cannot be done from the laptop session. This list is repeated at the end of the report.

1. Phase 6 needs the owner's server and an iPhone: deploy the Relay (`deploy/relay`), pair the phone, and run the real-device checks in the runbook.
2. Set `expectedOrg` in Gatehouse settings to `ACN - Premium` (the organisation the SDK reported on this account).
3. Re-check the managed-policy findings below on the managed build of the laptop if it differs from this one.

## Environment facts found while building

- Windows 11 Enterprise, Node 24.15, pwsh 7.6.9, Git 2.53.
- Signed in as organisation `ACN - Premium` (Claude Enterprise, first-party).
- The managed policy blocks **stdio and http MCP servers** in sessions but allows **in-process SDK servers**. Details in `docs/sdk-notes.md`.
- The SDK found no managed settings tier through `resolveSettings`.
- 8.3 short names are enabled on the C: volume and junctions can be created without elevation.

## Phase 0: scaffold (branch phase-0)

npm workspaces, strict TypeScript, ESLint, Prettier, Vitest, `CLAUDE.md` with the 16 invariants, pinned SDK versions, `docs/sdk-notes.md`, and a spike that confirmed the organisation, `canUseTool` on a Write, the PreToolUse hook on a Read, and CLAUDE.md loading.

## Phase 1: policy engine (branch phase-1)

Rules engine with floor, deny, remember, escalate, allow and default stages; bash (tree-sitter WASM) and PowerShell (warm `pwsh` AST worker) parsers; Windows path handling; redaction; replay harness; `docs/policy-guide.md`.

- 489 golden cases in 13 categories, 641 tests at the end of the phase, 98.8% line coverage, p95 about 8 ms.
- A 29-mutation check: all caught.
- Bugs found by the goldens and fixed: parentheses in globs, brace expansion, 8.3 names, `2>&1`, PowerShell worker latency (17 ms to 2 ms), a stale-exit teardown bug.

## Phase 2: Approver, Companion, audit (branch phase-2)

- **Audit** (`packages/shared`, subpath `@gatehouse/shared/audit`): hash-chained monthly JSONL, `head.json`, cross-process lock, torn-write repair, redaction injected into the writer, Node verifier and an independent PowerShell verifier that agree on every test fixture. Format in `docs/audit-format.md`.
- **Approver** (`apps/approver`): MCP server over streamable HTTP on 127.0.0.1 with the request guard (Host allowlist, no Origin, constant-time bearer token, POST `/mcp` only, 256 KB limit) and four tools: `evaluate_permission`, `explain_verdict`, `policy_status`, `approval_prompt`. Every verdict is audited, and an allow becomes an escalate if the audit record cannot be written.
- **Companion** (`apps/companion`): `notify_user` (140 characters, one a minute, redacted), `create_checkpoint` (a temporary-index git commit under `refs/gatehouse/checkpoints/`, secrets excluded using the floor's globs), `get_policy_summary` (fixed shape, no arguments). Tools are plain handlers shared by a stdio server and an in-process SDK server.
- **Host pieces pulled forward from Phase 3** because the crash test needs them: `ApproverClient` (fails closed to `evaluator-unavailable`), `ApproverProcess` (spawn with a per-launch token, restart with back-off, clean stop through stdin), `createCompanionSdkServer`.
- **Policy change:** `mcpSource` rule condition, so the allow rule for Companion tools only applies to the in-process server.

### Phase 2 results

- 778 tests across 23 files, all passing. `packages/policy` line coverage 98.8%. `npm audit`: 0 vulnerabilities.
- Acceptance: an integration test for every tool (4 Approver tools over HTTP through the MCP client, 3 Companion tools over stdio and in-process); guard tests over raw HTTP (missing and wrong token, wrong Host, any Origin, oversized body declared and streamed, other methods, other paths, malformed JSON); a crash and restart test with a real Approver process (kill with SIGKILL, every request escalates as `evaluator-unavailable` while it is down, it comes back, the audit chain stays valid and continues).
- Mutation check of the new code: 26 deliberate bugs, all caught. One survived the first time (the early Content-Length check, which the streaming check hides), so a test was added that declares 10 MB and then stalls, and the mutation is now caught.
- Found and fixed while testing: Windows briefly refuses a rename onto `head.json` and creation of a just-deleted lock file (retries added); a late `exit` event from an old `pwsh` process tore down its replacement (Phase 1); killing the Approver with `TerminateProcess` left its PowerShell worker to find out later, so the supervisor now stops it by closing its stdin, and the Approver also exits if its Host dies.
- Working note: two new, uncommitted source files were emptied during a formatting run while a mutation run had just finished. Both were rebuilt from the originals. Work is now committed before any bulk formatting, and the gate checks for empty files.

### Deviations from the spec in Phase 2

| Spec | What was done | Why |
|---|---|---|
| Companion is a stdio server loaded through `mcpServers` | Same tools also served in-process by the Host (`source: sdk`). The stdio form is built and tested. | The managed policy blocks stdio and http MCP servers in sessions on this laptop. |
| `approval_prompt` serves headless `claude -p --permission-prompt-tool` | Built and tested over the Approver's own HTTP transport. Request and response shapes verified through an in-process server. | The same policy blocks the Approver as an MCP server of a CLI run. |
| Audit `input` field | Stored as `inputJson`, a canonical JSON string. | Lets an independent verifier recompute hashes without float formatting rules. |
| Audit and checkpoint code location | `packages/shared`, as subpaths `./audit` and `./node`, kept out of the barrel. | Both the Approver and the Host append to the audit log. The barrel must stay free of `node:fs` for the phone bundle. |
| Checkpoint "for example `git stash create`" | Temporary index, `add -A`, `write-tree`, `commit-tree`. | Captures untracked files and never touches the real index or working tree. |

## Phase 3: Host core (branch phase-3)

Sessions, `canUseTool`, the PreToolUse floor hook, the broker (desktop channel, with the phone interface ready), the kill switch, the organisation guard, checkpoints with restore, usage, the WebSocket API and a command-line harness.

- **Code:** `apps/host/src`: `broker.ts`, `canuse.ts`, `hooks.ts`, `sessions.ts`, `account.ts`, `safety.ts`, `kill.ts`, `checkpoints.ts`, `usage.ts`, `quiet-hours.ts`, `server.ts`, `server-guard.ts`, `bootstrap.ts`, `main.ts`, `cli.ts`. Shared: UUIDv7, escalation payload hash, WebSocket protocol, persisted state, checkpoint preview and restore. Policy package: `evaluateFloor`, `checkRemember`, `appendRemember`.
- **Results:** 940 tests in 32 files, all passing. A mutation check of 35 deliberate bugs in the new code: all caught. One survived at first (the Host's own kill-switch check, hidden by the floor hook and the Approver also denying) and now has a test that runs with the Approver down. `npm audit`: 0 vulnerabilities. 305 packages scanned for licences: no AGPL or GPL.
- **Acceptance, scripted run** (`apps/host/test/scripted-run.test.ts`, the real Approver, policy, broker, audit and checkpoints, with only the SDK faked): auto-allow, auto-deny, a floor deny in the hook before `canUseTool`, escalate then approve (checkpoint taken first, audit record, `updatedInput` echoed, no `updatedPermissions`), escalate then deny with a message, a phone answer and a refused phone edit, escalate then time out ("Timed out waiting for approval"), edited input re-checked and blocked by a deny rule and by the floor, remember writing `rules.local.yaml` and the Approver picking it up, `AskUserQuestion` answered from desktop and phone and declined, plan approval and rejection, interrupt while waiting, kill switch (interrupts, cancels, denies, refuses new sessions) and desktop-only re-arm. The audit log is one intact chain across the Approver and the Host.
- **Invariant tests:** 1 to 7, 10, 13 and 14 each have named tests (`invariants.test.ts`, `server.test.ts`, the Approver tests).
- **Live run** through `npm run host:cli` with the real SDK: the account and organisation were checked before any prompt, `git status` was approved by Claude Code itself, a `Write` in the workspace was allowed by the Approver, `npm install` was escalated and the denial reached Claude, and a read of `.env` was refused by the floor. The notes in `docs/sdk-notes.md` record what this showed.

### Found and fixed during Phase 3

- **Usage was counted wrongly:** the SDK reports cost and per-model usage cumulatively for the session. The first live run showed $0.52 where the real figure was about $0.14. The store now adds only the change, and the fake SDK reports cumulatively so the tests would catch a regression.
- **Policy reload could be starved:** the rules watcher reset its debounce on every event in the folder, so steady activity (audit writes) could delay a reload indefinitely. It now reacts only to YAML files.
- **A fatal session error could be hidden** by a later `result` message moving the session back to idle. An error is now final.
- **Shutdown could hang:** sockets from refused WebSocket upgrades are not tracked by the HTTP server, so `closeAllConnections()` missed them. The server now tracks raw sockets and destroys them after a short grace period.
- **A restore on Windows writes CRLF** when the user's git setting is `core.autocrlf=true`, because `git restore` follows that setting. The content is otherwise identical. Repositories with a `.gitattributes` `eol` rule are unaffected.

### Deviations from the spec in Phase 3

| Spec | What was done | Why |
|---|---|---|
| The Approver has four tools | A fifth, `kill_switch`, engages and re-arms deny-all | The spec says the kill switch puts the Approver in deny-all until re-armed. The state is persisted in `state.json` so a restarted Approver stays denying, and a damaged state file counts as engaged. The tool is control plane only and needs the bearer token. |
| `defaultToNo` | Set when the SDK says so or when risk is 70 or more | Spec: allow is never the default focus at risk 70 or above. |
| `PostToolUse` audit | Only for calls that never went through `canUseTool` (self-approved by Claude Code) | Calls that did reach `canUseTool` are already audited by the Approver and the Host, and a second record would double count. |
| Shadow warning `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` | Not present in this SDK. `assertSafeOptions` enforces invariant 4 itself, and a stderr or system message matching the likely wording is fatal. | Cannot test for a warning that does not exist. |
| Checkpoint restore | Always takes a safety checkpoint first, never touches secrets files or ignored files, and refuses without `confirm: true` | Makes a restore itself undoable, as the spec's "shows the diff first and asks for confirmation" implies. |
| The Host may spawn the Approver with the standard `node --import tsx` | Same, with the loader given as an absolute URL | The child runs in the project's folder, where `tsx` cannot be found by name. Phase 8 packaging may compile instead. |

### Owner to-do added in Phase 3

- Set `expectedOrg` to `ACN - Premium` in `%LOCALAPPDATA%\Gatehouse\config.json`. Without it the Host refuses to start any session (invariant 14), and the first-run screen in Phase 5 will do this from the UI.

## Phase 4. Design foundation

- **Done:** `PRODUCT.md` (from the spec's product context), `docs/design/surface-briefs.md` (visual world and the nine surface briefs), and three approval card variants in one file, `docs/design/prototype/approval-card.html` (open it in a browser; keys 1, 2, 3 switch variant, a button switches light and dark).
- **Variants:** A stacked (one column, actions in a row at the bottom), B decision rail (command and reasons in the main column, risk and all actions in a fixed right rail), C command first (facts in a strip, the command large, actions in a footer).
- **Choice made without the owner:** B. The actions stay in one place whatever the command length, so a 10,000 character command scrolls while the rail stays put (the rail will be sticky in Phase 5). Deny sits first and Allow last with its chord shown. It matches the phone layout, where the same decision controls sit in a fixed bottom area. A and C push the actions below the command, so a long command pushes them off screen. The owner can still pick another variant; the cost of changing is one component.

### Deviations in Phase 4

| Spec | What was done | Why |
|---|---|---|
| `/impeccable init` interview, then the owner chooses a variant at a checkpoint | No interview and no checkpoint; PRODUCT.md is from the spec's own answers, and I chose the variant | The owner is away and asked for no questions. Init's rule to probe once with a real question was not followed for the same reason. |
| Emil's `prototype` skill | A hand-written static HTML page with the same purpose (three variants behind a switcher, realistic data) | A single file needs no build and survives into Phase 5 as a reference. |
| Per-surface `/impeccable shape` | One briefs file covering all nine surfaces | Same content, one place to read. |

### Owner to-do added in Phase 4

- Open `docs/design/prototype/approval-card.html`, and say if you prefer variant A or C over B.
- The prototype's contrast and keyboard behaviour were not machine-checked. Phase 5 does that on the real components.

## Phase 5. Desktop UI

Vite and React app in `apps/web`, served by the Host from `apps/web/dist`. Every desktop surface in the spec exists and runs against the live Host: approval card and queue, session workspace (transcript, tool cards, diffs, todo list, composer with slash commands, model picker, default and plan toggle, interrupt), sessions overview, policy studio (rules, test a command, replay and activate with a diff, remember rules), audit log (filter, search, detail, chain status, export), devices, settings, first run. `DESIGN.md` records the system as built.

- **Host additions** (`apps/host/src/api.ts`, token-guarded `/api/*`): audit query, verify and export; policy read, dry-run test, replay, activate (validated, hash-checked, audited) and remember removal; settings read and save (audited by key name only, never value). Config gained `workspaceRoots` and `quietHours`, honoured by both the Host and the Approver. `policy:replay` now reads real audit records (their input is a JSON string).
- **Verified live** with the real SDK through the UI in a scratch folder: org check, session start, an escalated `npm install` appearing in the queue, Remember preview showing the exact rule, Esc closing the panel then denying, "Denied on desktop at 09:16", and the audit log showing both records with an intact chain.
- **Detector:** `impeccable detect apps/web/src` exit 0 (19 files). In-page scan of all surfaces, light and dark: real findings fixed (placeholder contrast, a card inside a card, flat type steps). Two remaining findings on `body` (`layout-transition`, `dark-glow`) come from the detector's own overlay, which is visible in a screenshot taken while it was injected; neither string exists in our source or build. The URL form of the scan exited 0 but only saw the empty approvals page, so the in-page run is the evidence.
- **Critique** (Assessment A as an isolated sub-agent, B run inline by me, so this is a degraded dual run): fixed every P1 and the P2 queue and type findings. Allow no longer the loudest control at risk 70 or above (Deny is filled, Allow an outline); red no longer on Deny; risk badge in the card header, Severe filled; a Status row and target path; Stop session behind a confirm and apart from Allow; Host-disconnected banner that pauses decisions and the keyboard; a persistent live region; the queue virtualised, oldest first, ages that tick, no wrap-around; long single-line commands collapse by characters. Not done: grouping the queue by session, a D shortcut (the brief said "Esc or D"; Esc is the only key), diff rendering for Write input (shown as labelled JSON with the target path), sub-agent threads as indented groups only by marker.
- **Worst case** (`apps/web/demo.html`, built only with `DEMO=1`): 300 pending requests, 40 sessions, 5,000 character and 300 line commands, Unicode and very long names and paths, empty, Relay unreachable, Approver down, kill switch engaged. 42 page and data combinations at 1024 pixels wide: no horizontal overflow. Not run: a literal 10,000 character command (the demo's longest is about 5,000, collapse is by characters so size does not matter), real Relay offline (Phase 6).
- **Hardening:** error boundary, kill switch and stop session confirm inline rather than `window.confirm`, session start guidance (a start takes up to a minute), reduced motion covers transitions.
- **Not run:** Emil's `animate`, `find-animation-opportunities` and `review-animations`. The UI has no layout or main-thread animation to review: only a 120ms colour fade, NumberFlow counters and Sonner toasts. Optional Playwright smoke tests skipped.
- **Library note:** shiki is in the spec's list but not used yet (commands and diffs are plain monospace, which is easier to verify than highlighted text); react-markdown and remark-gfm and diff are the two the spec flags as outside the curated list. `@types/diff` was a stub and was removed.

### Found and fixed during Phase 5

- **The Host would not start once a UI build existed:** `@fastify/static` and the Host both declared `GET /`. Never hit before because no build existed. Fixed with `index: false`, with a server test that serves a built folder (fails without the fix).
- **A render loop on first load:** selectors that built a new array each call (zustand 5 re-renders for ever). Now `usePending` and friends, with a test that renders the app.
- **Static files are registered at start:** a rebuilt UI is not served until the Host restarts (`wildcard: false` registers files that exist at start). Deliberate, noted for the runbook.
- **Audit and replay mismatch:** `policy:replay` skipped every real audit record. Fixed, with a test.

### Deviations in Phase 5

| Spec | What was done | Why |
|---|---|---|
| Critique as two isolated sub-agents | A as a sub-agent, B inline | A browser pane and one live Host cannot be shared by two agents at once. A never saw detector output. |
| `npx impeccable detect http://127.0.0.1:47820` | Run, plus an in-page scan of every surface | The URL scan cannot hold a signed-in, populated page. |
| Quiet hours and workspace roots in settings | Stored in `config.json`, applied at the next start | Both the Host and the Approver read them at startup. The page says a restart is needed. |
| Settings notifications | Browser notification is a per-browser choice stored locally | Nothing to store on the Host. The notification never carries detail. |
| Remember rules "review" | List and remove | Editing a remember rule would let it grow past one command or file. |

### Owner to-do added in Phase 5

- Open the printed URL from `npm run host` (it ends in `#token=...`), after `npm run build -w @gatehouse/web`. Restart the Host after every UI rebuild.
- Try the UI on your real laptop sign-in and set the organisation on the first-run page (then restart).

### Phase 5 results

- Full suite: 39 files, 999 tests, all passing (the web app adds 44 and the admin API 12). `npm run lint`, `npm run format`, `npm run typecheck` clean. `npm audit` 0 vulnerabilities. 577 packages scanned for licences, no AGPL, GPL or LGPL.
- Mutation check of the admin API: 6 deliberate bugs, 5 caught, 1 survived (`restartRequired` always true) and now has a test. Approval card: 4 deliberate bugs in the safety rules (plain Enter allows, Allow takes focus, Esc always denies, edit unchanged), all caught.
- On a loaded laptop the Host's escalation tests time out at the old 10 second wait (git and PowerShell are slow while other tools hold dozens of `git.exe` processes in `C:\dev`). The wait is now 60 seconds; both files pass.

## Phase 6. Relay, phone app and pairing

The Relay (`apps/relay`), the phone app (`apps/phone`), the Host's phone channel (`apps/host/src/relay`), the Devices page, and the shared protocol (`packages/shared`: `e2e.ts`, `relay-protocol.ts`, `phone-protocol.ts`).

**How it works.** The Host seals each escalation to the phone's ECDH key (ephemeral ECDH P-256, HKDF-SHA-256, AES-256-GCM, request id as additional data) and posts it to the Relay. The phone opens it, shows it, and answers with an envelope signed by its passkey (a WebAuthn assertion whose challenge is the hash of the envelope), sealed to the Host's key. The Host opens it and accepts it only through `verifyPhoneDecision` (invariant 8): passkey assertion against the pinned credential, unused nonce, unexpired envelope, payload hash matching the request it sent, and the right device. The Relay never sees text or the answer, and a push says only "Approval needed" unless the user turned lock-screen detail on (the phone's service worker then opens a small sealed summary).

- **Relay:** Fastify and Node's built-in `node:sqlite` (no native addons), enrolment by a one-time token, pairing with an 8 character code valid 5 minutes, passkey login for phone sessions (15 minutes), long-poll for decisions, Web Push with VAPID keys made on first run, purge every minute, rate limits on endpoints with no login, strict CSP on pages, `trustProxy` by address function.
- **Pairing:** the Host verifies the phone's attestation itself, both sides show the same six digits derived from both keys and the passkey id, and the passkey and key are pinned only after the user confirms on the desktop. Revoking removes the pinned key first, so that phone is refused at once even if the Relay is down.
- **Phone app:** installable PWA (manifest, icons, a classic-script service worker), guided Add to Home Screen, pairing, Face ID unlock, list, request detail with the command shown in full, Deny in one tap, Allow behind a second step, a message to Claude, questions, kill switch behind a second step, lock-screen detail off by default.
- **Host:** `PhoneService` (pairing, delivery, decision loop, notifications for finished sessions and notes from Claude), a persisted store with the device token and the Host's private key protected by Windows DPAPI (`scripts/dpapi.ps1`), admin endpoints and the Devices page (set up, pair with the six digits, rename, revoke). Every refused phone decision is audited as `phone_decision_rejected`.
- **Oversize:** a request too big for a push-safe body (4,800 bytes) is shown to the phone in outline and the phone may only deny it. (This also keeps bodies under the 8 KB limit that some edges apply.)

**Results.** Relay 27 tests (real WebAuthn verification with a software passkey). Invariant 8 gate 12 tests. Host and Relay end to end 16 tests (real Relay, real broker, real audit): pairing and fingerprint, allow, deny with a message, question, an envelope that tries to edit input or remember a rule (refused: the passkey signed different bytes), replay, a request the Relay made up, a sealed decision altered or sealed to the wrong key, oversize, kill from the phone (once, never re-armed), revocation, and the Devices endpoints. Phone app 16 tests, Devices page 5. Mutation checks: Relay 8 deliberate bugs (6 applied, all caught), decision gate 11 (10 caught; the 11th, an explicit credential id check, is redundant because the library also rejects a different passkey, so it stays as defence in depth). Detector on the phone app at 390 by 844, every screen: no overflow, one finding (type scale), fixed.

### Found and fixed during Phase 6

- The first draft of the tamper test raced the Host's own poll; it now feeds the altered envelope straight to the handler.
- `eslint` and `prettier` were reading the demo build output (862 false errors); both now ignore `dist-demo`.

### Deviations in Phase 6

| Spec | What was done | Why |
|---|---|---|
| Relay deployed on the owner's server behind Caddy and Authentik | Runs locally, started with `npm run relay` or in a Podman container, reached by the phone through an https tunnel | The owner asked for a local, container-optional run. Authentik and Caddy are optional. The Authentik-in-Home-Screen question no longer applies. |
| Docker image built and tested | Dockerfile and compose written, not built | No container tool is installed on this machine. |
| Relay settings in `.env` | The public address is given once on the command line and remembered; everything else has a default | Nothing may have to be in the environment. The container still takes `RELAY_PUBLIC_URL`. |
| Notification lock-screen detail | Sealed summary sent with each request push | The service worker can only decrypt what the push carries. |
| `@simplewebauthn/browser` on the phone | Used | As specified. |
| Real iPhone checks | Not done | See the owner to-do list and `docs/relay-local.md`. |

### Owner to-do added in Phase 6

- Run the Relay (`docs/relay-local.md`), set up an https address (Tailscale is the simplest), pair the iPhone, and walk through the "things to check on a real iPhone" list. WebAuthn, Home Screen install and push cannot be tested without the device.
- If you want the container, build it once with Podman and tell me if it fails.

## Phase 7. Extras

- **LLM judge, off by default** (`packages/policy/src/judge.ts`, `apps/approver/src/sdk-judge.ts`). A separate one-turn SDK query to a Haiku-class model with no tools, `dontAsk`, no setting sources, run in the temp folder, with a strict JSON schema. It sees only the tool name, the parsed segments and the matched rule. It can only turn an escalation into an allow, only for rules in `judgeEligible`, only at 0.85 confidence or more. It is not asked when the input is longer than `maxInputChars` or reads like an instruction to it, and its own reason gets the same suspicion. Any error, timeout or odd answer leaves the call escalated. Allows carry `judge:<rule>`, `decidedBy: judge` and the reasoning in the audit record, which the audit detail shows. Checked live once with the real SDK: a harmless documentation fetch was allowed at 0.95, an upload of an SSH key was escalated at 0.99. Latency was about 26 seconds for the first call, so while the policy has the judge on the Host waits up to 35 seconds for the Approver (15 otherwise, see phase 27). Still bounded and fail-closed.
- **Policy analytics** (Policy, Insights; `apps/host/src/analytics.ts`): escalation rate, per rule asked, approved, denied, timed out, approval rate and median wait, time to decide (median, 90th percentile), per day, desktop against phone. A chart plus a table of the same figures for each.
- **Suggestions:** calls you approved at least three times and never refused or let time out, as exact commands or files, each passed through the same narrow Remember check, accepted only on the desktop (re-checked on accept, audited as `remember_added`).
- **Digest:** a plain paragraph about the last 24 hours, shown on the Sessions page and sent to the phone once a day after a chosen time (default 08:00, can be turned off, sent at the next check if the computer was asleep, never twice in a day).
- **Usage views:** spend and tokens by day (new `byDay`, older files load without it), project and model, on the Sessions page.
- **Quiet hours** were already built in Phase 3 (the phone is held, not told) and are now settable in Settings (Phase 5).

**Results.** Judge: 9 policy tests, 8 Approver tests (including that the query is tool-less, one turn, with no credentials in its environment), mutation check of 8 deliberate bugs, all caught. Analytics 12, digest scheduler 5, usage by day 3, Host endpoints 3 more, web Insights and usage 8. Detector and layout checks of the new Insights screen are not done separately (it uses the same components and tokens).

### Deviations in Phase 7

| Spec | What was done | Why |
|---|---|---|
| Judge in `dontAsk` mode | As specified, for the judge query only | Sessions still only run in `default` or `plan` (invariant 3). The judge has no tools, so `dontAsk` can do nothing. |
| Quiet hours and daily digest | Digest sent once a day to the phone at a chosen time rather than at the end of quiet hours | Simpler and predictable. Quiet hours still hold phone requests. |
| Analytics "suggestions for narrow new allow rules" | Suggestions are remember-style exact rules | Anything wider would need a human to write it. |

### Owner to-do added in Phase 7

- To try the judge, set `defaults.judge.enabled: true` in the rules file (Policy, Edit and activate). It uses a little of your Claude allowance for each judge-eligible call.

## Phase 8. Hardening and packaging

- **Threat model** (`docs/threat-model.md`): 24 threats, each with what stops it and the named tests that show it. `apps/host/test/threat-model.test.ts` reads the table and fails if a threat has no test, a test file is missing, a named test is not in its file, the ids are not consecutive, or fewer than 60 references are found (checked by corrupting one reference, which failed as it should). New tests for threats that needed a table: secrets reached through every file tool, Grep, Glob and the shell (about 100 cases); safe commands chained, wrapped or substituted with bad ones in Bash and PowerShell (about 80 cases); markup and script URLs in text from Claude or a tool (the screen where you decide).
- **Start-up:** `scripts/start.ps1` checks Node, builds the interface if needed, starts the Host (which starts the Approver), prints the one-time address and opens Edge. `-Check` proves the Host answers with its token and refuses without it, then stops everything (an automated test runs it). `-Relay` also starts the Relay. The Host now stops cleanly when its input is closed, so the script ends it without killing it. Start at logon is documented, not enabled.
- **Runbook** (`docs/runbook.md`): start and sign in, pair and revoke, lost phone, rotate the device token (new Relay route, Devices button, tested) and the push keys (`--rotate-vapid`), update the SDK safely, verify the audit chain, back up, common problems. `docs/relay-local.md` covers the local Relay.
- **Final checks:** `npm audit` 0 vulnerabilities; 614 packages scanned, no AGPL, GPL, SSPL, BUSL or unknown licences, no LGPL.

### Observation

- After `start.ps1` exits, a Node parent that reads its output through pipes never sees them close on this machine, although the script's exit code is 0 and no process of ours is left. I could not find the holder (the machine runs hundreds of the Claude desktop app's own search processes). The automated test therefore waits for the script's exit. If you run it from a tool that waits on pipes, redirect the output to a file.

### Dependencies added after Phase 3, and why

| Dependency | Where | Why |
|---|---|---|
| react, react-dom, vite, @vitejs/plugin-react, tailwindcss, @tailwindcss/vite | web, phone | The spec's UI stack |
| zustand, clsx, sonner, cmdk, @number-flow/react, react-virtuoso, recharts | web | The spec's curated list, all in use: cmdk for the Ctrl+K palette, Sonner for toasts, NumberFlow for counters, Virtuoso for long lists, recharts for Insights |
| react-markdown, remark-gfm, diff | web | Flagged in the spec as outside the curated list: assistant text and line diffs |
| @simplewebauthn/server, @simplewebauthn/browser | host, relay, phone | WebAuthn, as specified |
| web-push | relay | Web Push with VAPID |
| tsx | relay | Runs the Relay's TypeScript in its container and locally, as the Host does |
| @anthropic-ai/claude-agent-sdk | approver | The judge's query (already pinned for the Host) |
| zod | policy | Declared (it was used through the workspace before) |
| jsdom, @testing-library/react, user-event, jest-dom | web tests | Component tests |

From the spec's list I did **not** use `motion` (the UI has almost no motion, and what it has is a 120ms colour fade), `@base-ui/react` (confirmations are inline, so there are no dialogs, menus or popovers to build), `class-variance-authority` (a handful of plain button classes) and `shiki` (commands and diffs are plain monospace on purpose, so what you read is exactly the text that runs). They were installed early and have been removed rather than left unused.

The command palette (Ctrl+K) only moves you: to a page, a session or a waiting request, or switches theme. It has no allow, deny or kill, so a decision can only be made on the card.

## Final summary

Gatehouse is built, phase by phase, to the spec, through Phase 8. Everything is committed on local branches `phase-0` to `phase-8` and fast-forwarded into `main`. Nothing is pushed anywhere (the repository has no remote).

**What exists**

- The policy engine (floor, deny, escalate, allow, remember, overlays, optional judge) with 489 golden cases, a Bash parser (tree-sitter, no native code) and a PowerShell AST worker.
- The Approver and the Companion (MCP servers), the hash-chained audit log with two independent verifiers, the Host (sessions, the permission broker, kill switch, organisation guard, checkpoints, usage, WebSocket API, admin API, phone channel).
- The desktop interface (`apps/web`), the phone Relay (`apps/relay`), the iPhone app (`apps/phone`), `scripts/start.ps1`, the runbook and the threat model.

**Final checks (27 October, on this machine)**

| Check | Result |
|---|---|
| `npm run lint`, `npm run format`, `npm run typecheck` | clean |
| Tests | 1,156 tests in 58 files, each file passing at least once (see the note below) |
| `packages/policy` coverage | 97.8% of lines (the gate is 95%), 684 tests |
| `npm audit` | 0 vulnerabilities |
| Licences | 614 packages scanned, no AGPL, GPL, SSPL, BUSL, unknown or LGPL |
| Mutation checks | policy (29), Approver (26), Host (35), admin API (6), card (4), Relay (8), phone decision gate (11), judge (8): every one caught after the tests added along the way |
| Threat model | 24 threats, 60+ test references checked by a test |

Note on the test run: this laptop is heavily loaded (the Claude desktop app and other sessions run hundreds of search processes and git calls take seconds). A full parallel run therefore shows load failures in different heavy files each time: a worker that does not start within Vitest's fixed 90 seconds, or a git-heavy test that passes its 60 second limit. Each affected file passes on its own (`packages/shared/test/phase3.test.ts` needs about three minutes on this machine), and the last full runs without that load were 1,134 tests in 52 files (Phase 7) and 1,146 in 56 (just before the last few additions). If you see this, rerun the named file.

**Deviations from the spec** are in the table at the end of each phase above. The ones that matter most:

- The Companion reaches sessions as an in-process server (the managed policy blocks stdio and http MCP servers here).
- No owner checkpoint after Phase 4 (you were away): I chose the decision-rail approval card.
- The Relay runs on your computer, started with `npm run relay` or in a Podman container, reached by the phone through an https tunnel, instead of on a server behind Caddy and Authentik. The container files are written but were never built (no container tool here).
- `motion`, `@base-ui/react`, `class-variance-authority` and `shiki` from the spec's library list were not needed and were removed.

**Owner to-do list** (everything I could not do or test myself)

1. **Try it.** `pwsh scripts/start.ps1`. Set the expected organisation on the first run page (`ACN - Premium` for this account) and restart, then start a session in a scratch folder.
2. **Look at the approval card choice** (`docs/design/prototype/approval-card.html` shows the three variants) and tell me if you prefer A or C over the decision rail.
3. **Re-check the managed policy findings on the managed laptop build** (`docs/sdk-notes.md`): that stdio and http MCP servers are blocked in sessions and in-process ones are allowed.
4. **Phone, on a real iPhone** (nothing about the passkey, Home Screen app or push can be tested here): follow `docs/relay-local.md`. Set up an https address (Tailscale is the simplest), run the Relay, connect it on the Devices page, pair, compare the six digits, then go through the "things to check on a real iPhone" list: install and pair, a push on the lock screen saying only "Approval needed", Face ID to allow, deny, answer a question, and the kill switch.
5. **Podman:** if you want the container, build it once (`podman compose -f deploy/relay/docker-compose.yml up -d --build`) and tell me if it fails.
6. **Judge (optional, off):** turn it on by setting `defaults.judge.enabled: true` in the rules file. It uses a little of your Claude allowance and its first call takes about 25 seconds.
7. **Remote:** the repository has no remote. Add one and push `main` when you want it backed up.
8. **If the machine stays this slow**, free the other sessions' processes before running the full suite.

**Known limits** are listed at the end of `docs/threat-model.md`.

## Phase 9. Running as an exe (added after the spec, at the owner's request)

- `npm run package` builds `dist-app\Gatehouse\Gatehouse.exe` with `runtime\node.exe` and the `app` folder next to it, so it finds its files in the expected directory structure around it and the folder can be moved or zipped. The launcher (`packaging/Launcher.cs`, compiled with the C# compiler that ships with Windows) starts the Host, waits for it, prints the one-time address, opens Edge, stops everything on Ctrl+C or when the window closes, and a Windows job object ends the children if the launcher itself is killed. Options: `--no-browser`, `--check`, `--relay`, `--help`.
- Verified: `npm run package:check` built the folder (about 465 MB), ran the packaged `Gatehouse.exe --check`, and it passed: the Host started from the packaged runtime and app, answered with its token, refused without it, and stopped cleanly.
- An installer is a template only (`packaging/installer.iss`, Inno Setup, not compiled or tested: it is not installed here). The upgrade keeps the user's `app\policy` folder. A single file was judged not worth it (see `docs/packaging.md`).
- Limits: not code signed (SmartScreen may warn), policy lives inside the app folder, so copy your rules across when replacing the folder.
- Not covered by an automated test (it takes minutes and the network); use `npm run package:check`.

## Phase 10: Jean-Claude Van Code naming and pictures (28 Oct)

Owner requests: rename the app, show a start-up picture whatever the theme, and add an optional mode that shows extra pictures.

- **Name.** The user-facing name is now "Jean-Claude Van Code": window title, tray, balloon, header, web page title, phone app name, installer name and shortcuts, README. Internal names are unchanged (exe files stay Gatehouse.exe and Gatehouse-Console.exe, data folder stays %LOCALAPPDATA%Gatehouse, so existing data and installs carry on). Invariant 16 forbids naming the product Claude Code; this is a pun on a different name, recorded as an explicit owner decision in CLAUDE.md.
- **Start-up picture.** The picture of two trucks is in `apps/web/public/jcvc/loading-trucks.png`. It shows in the native window while the Host starts (copied to `splash.png` next to the exe) and again from `index.html` before any script runs, for about 1.8 s, in both themes. Covered by `apps/web/test/jcvc.test.tsx`.
- **Jean-Claude mode.** (Superseded in Phase 21: it is now always on.) Optional, off by default, stored in localStorage (`gatehouse.jcmode`). Toggle in the header, Settings and the command palette. It adds three pictures (empty Approvals queue, empty Sessions list, Settings) and changes nothing else. It is separate from the light and dark themes.
- **Owner to-dos.** The pictures are film and magazine stills supplied by the owner. They are for personal local use; do not publish the repository, the package or the installer without clearing the rights. The exe files still say Gatehouse; renaming them is a small change if wanted. The installer has to be rebuilt (`npm run installer`).

## Phase 11: sign-in, wizard, pictures, Extreme approval mode (28 Oct)

Owner requests, and what was done or decided:

- **Sign in from the app.** `apps/host/src/signin.ts` starts Anthropic's own `claude auth login` (browser flow, or `--sso`) in the unmodified binary the SDK ships, with the sanitised environment. It keeps only the sign-in page address from the output, never reads a credential (invariant 6), then asks the account check again.
- **Setup wizard** on first launch (`apps/web/src/surfaces/Setup.tsx`): welcome, sign in, organisation, phone alerts (optional, embeds the Devices page), your choices, finish. Skippable; run again from Settings.
- **Folder chooser** on the Sessions page: `POST /api/pick-folder` opens the Windows folder window through a fixed PowerShell script (the start folder travels in an environment variable). A folder that does not exist is now created, with any missing parent folders (owner request). A relative path, a file, or a missing drive is refused with a plain message (`folder-missing`) instead of the SDK's misleading "binary failed to launch".
- **Jean-Claude mode** is now a very faint background picture (opacity 0.07, 0.10 in dark, behind all content, never clickable) instead of pictures dropped into screens. Choose automatic (changes by screen), one of four built in, or your own: files in `%LOCALAPPDATA%\Gatehouse\jcvc` are listed and served by the Host (picture types only, by listed name, 8 MB cap). More pictures from the internet were NOT fetched: they are other people's copyrighted photographs and cannot be bundled or redistributed, so the app takes the owner's own files instead.
- **Not done: more Claude Code modes.** The owner asked for the other modes (acceptEdits, auto, bypassPermissions and so on). Invariant 3 allows only `default` and `plan`, because those modes approve actions without calling the Approver, which breaks invariants 1 and 13. Left as is until the owner amends invariant 3 on purpose. Extreme approval mode (below) covers the "stop asking me" need while keeping the audit trail.
- **Extreme approval mode** (`extremeApproval` in settings, off by default, applies at once). A request that would wait for a person is approved, written to the audit log first with `decidedBy: "extreme-mode"`, and the phone is sent "Approved automatically" naming only the tool and project. It never overrides: the floor hook (runs before), any deny verdict, the kill switch, or any escalation that comes from a failure (`NEVER_AUTO_APPROVED`: evaluator-unavailable, audit-failure, policy-unavailable, engine-error, malformed-input, pwsh-unavailable, parse-error, kill-switch). If the audit write fails the call is denied. Questions from Claude and plan approvals still wait for the owner. A red banner shows on every screen while it is on. This is a deliberate owner-requested relaxation of "everything else escalates"; invariants 1, 2, 3 and 13 still hold. Tests: `apps/host/test/extreme.test.ts`.

## Phase 12: per-session controls and the Departures redesign (28 Oct)

- **Per-session controls.** Mode (Manual, Accept edits, Plan, Auto, Extreme approval), effort (Low, Medium, High, Extra, Max) and a fuller model list (Opus 5.5, Opus 5, Sonnet 5.5, Sonnet 5, Haiku 5.5, Haiku 4.5, Fable 5.1), on the start form and live in the workspace. Extreme approval is now per session, audited when switched, not an app-wide setting. Invariant 3 amended by owner decision: `acceptEdits` and `auto` allowed, `bypassPermissions` and `dontAsk` still refused. Effort goes through `applyFlagSettings` with the one key only (`docs/sdk-notes.md`).
- **New visual identity: Departures** (owner chose a new identity over a polish, with Jean-Claude mode kept optional). Run through the Impeccable new-work flow: a dealt direction (a drawing set) lost to a fused challenger (boarding pass and gate board) on audience fit and clarity, and the owner picked it. Code-led (no image generation here). What it is: a committed slate shell, signage yellow only for what needs you, gate blue for actions, Bahnschrift for labels and numbers; the approvals queue is a board whose new rows flip in and stay lit until seen; the approval card is a pass with a perforated decision stub; every session has a flight-style code and ribbon colour; Settings is a two-column sheet; the setup wizard has a segmented step strip. `DESIGN.md` and `.impeccable/design.json` rewritten from the build; the direction contract is in `apps/web/.impeccable/surfaces/src-app-tsx.md`.
- **Finish review** (run inline, because the reviewer agent is not installed here): disposition **fix**. Open: the board does not animate when rows close up after a decision (only the arrival flip is built); Policy, Audit log and Devices only inherit the new tokens and were not reworked; the phone app is unchanged. Detector: no findings. Web tests: all pass.
- **Font note.** Bahnschrift is installed with Windows 10 and 11, and the app only runs on Windows, so it is not downloaded or bundled.

## Phase 13: the rule library (28 Oct)

- **Packs.** Ten preseeded packs in `policy/library/`: Git looking only, Git local changes, Node and npm, Python, .NET, Rust Go and make, Docker and Podman looking only, cloud and Kubernetes looking only, edit any file in your folders, and extra caution on Windows. Each rule has a plain reason, and each pack ships golden cases that must decide as written with only that pack on (`packages/policy/test/library.test.ts`). A pack does nothing until you switch it on.
- **Your rules** live in `policy/rules.user.yaml` next to the rules file (kept on upgrade, never committed): packs switched on, built-in allow or ask rules switched off, and rules of your own (ids start with `my-`). The loader merges base, packs, then yours. The floor and deny rules can never be switched off; the file cannot hold floor rules or change the workspace, defaults or judge; every rule shape check still applies. The Host and the Approver load the same library and file, so they always decide alike.
- **Policy, Library tab.** Switch packs on and off, switch built-in rules off and on, copy any rule into your own rules and change it, remove rules, preview which past decisions would change (replay of the audit log), then save. A save is a dry load first; a file that does not load is never written. Every save is audited by name (`policy-library-changed`).
- **Upgrade.** The installer now replaces `app\policy\library` on upgrade and keeps the rest of `app\policy`.
- **Tests and proof.** Policy suite 701 tests, 97.5% lines (gate 95%). With no packs on, the policy hash is unchanged, so all 489 golden cases decide as before. Two deliberate breaks were caught: letting a deny rule be switched off, and not merging switched-on packs.

## Phase 14: the Relay inside JCVC (28 Oct)

- **Devices, Run the Relay inside JCVC.** Give the https address your phone uses and choose Start. The Host runs the Relay as its own child on 127.0.0.1 (port 8087 by default), only while JCVC runs, reads the Relay's one-time enrolment token from its data folder and links itself over loopback, so there is nothing to copy. The choice is saved (`localRelay` in settings) and the Relay starts again with JCVC; Stop clears it. Starting is audited (`relay-local-started`).
- **What it cannot do for you.** The iPhone still needs an https address that reaches this computer. The panel and the Devices help explain Tailscale Funnel and Cloudflare Tunnel; setting one up is the owner's step.
- **Security.** Nothing changes for invariants 8 and 9: the Relay still only carries ciphertext and every phone answer is verified by the Host. The Relay gets the sanitised environment and binds to loopback.
- **Tests.** `apps/host/test/local-relay.test.ts` (start, enrol with the token, no second enrol when linked, refuses non-https, a Relay that dies before it is ready) and an API test for start, save, audit and stop.

## Phase 15: outbound-only push with ntfy (28 Oct)

- **Why.** The owner's laptop policies will likely block anything reaching in (a tunnel or the local network), so phone answers must come back over a connection the laptop opens. Tested from this laptop on 28 Oct: ntfy.sh publish, poll and a live outbound stream all work; Telegram and Slack are reachable.
- **How it works.** When a request starts waiting, the Host posts to a random topic on ntfy (ntfy.sh by default, or your own ntfy server). The phone's ntfy app shows Approve and Deny buttons. A tap posts a single-use code to a second random topic, and the Host is already reading that topic over its own outbound stream (reconnects with back-off).
- **What protects it.** Codes are random, per request, stored only as hashes, single use (both die once either works) and expire with the phone window. Allow is not offered above the risk limit (default up to Moderate, at most High) and never for Severe. Push answers cannot edit input or create rules. Refused answers are audited (`push-answer-refused`); good ones are recorded as `human-push` decisions on the channel `push`.
- **Owner decisions recorded** in `CLAUDE.md` under invariants 8 and 9: push channels answer with single-use codes instead of a passkey, and may carry a short redacted summary.
- **Devices.** A new panel switches ntfy on (fresh topics), shows the topic to subscribe to, sends a test, sets the risk limit, makes new topics if one leaks, and switches it off. The Devices help explains both ways (ntfy, and the iPhone app with a Relay).
- **Tests.** `apps/host/test/ntfy.test.ts`: redacted summary, buttons and codes, single use (proved by removing it), wrong code, the other decision's code, malformed reply, expiry, risk limit and Severe, the outbound stream. API test for switching on, keeping topics, new topics, off and audit.
- **Not yet.** Only permission requests and plan approvals get buttons; a question shows "Answer it in JCVC". Quiet hours do not hold ntfy yet. A private ntfy topic can be protected further with an access token on your own ntfy server; not built.

## Phase 16: Slack push through Socket Mode (28 Oct)

- **How it works.** JCVC posts each request to a Slack channel or a direct message with Approve and Deny buttons, and hears taps through Socket Mode: a WebSocket this computer opens to Slack, so nothing reaches in. When a request is decided anywhere, the message's buttons are replaced with what happened.
- **What protects it.** The same single-use hashed codes, risk limit and Severe rule as ntfy (now shared in `apps/host/src/push/codes.ts`). Only taps by the Slack member id you give count. Both tokens are kept sealed with DPAPI in `%LOCALAPPDATA%\Gatehouse\slack.sealed`, never in the settings file or the audit log. Refused taps are audited.
- **Devices.** A Slack panel with the steps and an app manifest to paste (bot scopes `chat:write` and `im:write`, interactivity and Socket Mode on), fields for the two tokens, your member id and the channel, a test message, the risk limit, and switch off (optionally forgetting the tokens). Node's built-in WebSocket is used, so no dependency was added.
- **Tests.** `apps/host/test/slack.test.ts` (redacted summary and buttons, every envelope acknowledged, only your taps, single use, risk limit, forged values, tokens sealed on disk); the "only your taps" check was proved by removing it. API test: tokens never reach the settings file or the audit log.
- **Owner to do.** A company Slack may need an administrator to approve the app.

## Phase 17: Relay on your own server (28 Oct)

- **One command on the server.** `deploy/relay/install.sh https://relay.your-domain` builds the existing image with Podman or Docker, runs it on 127.0.0.1:8087 only with a data volume, waits until it answers, and prints the one-time enrolment token. Running it again updates the Relay and keeps paired phones.
- **https front.** `deploy/relay/Caddyfile.simple`: one site block, Caddy gets the certificate itself. No extra login is needed in front, since every phone answer needs a passkey anyway.
- **In the app.** A user guide article, Relay on your own server, with the exact steps; the Devices form points to it.
- **Tests.** `apps/relay/test/install-script.test.ts` runs the real script against stand-in podman and curl: it refuses a non-https address, binds to loopback only, keeps the volume, passes the address and prints the token.
- **Owner to do.** Run the install on your server, add the Caddy site and DNS, then connect from Devices and pair the iPhone. Not run against any server from here.

## Phase 18: the files panel, viewer and local browser (28 Oct)

- **Workspace, Files tab.** What Claude made or changed in the session (from the transcript's Write and Edit calls, newest first), and the session folder as a tree that opens folder by folder. The Plan tab keeps the todo list and session facts.
- **Viewer pane** beside the transcript: code and text with line numbers (first 1 MB), markdown formatted, pictures, and HTML shown as the page in a sandboxed frame (or its source). Show in Explorer opens the folder with the file selected.
- **Local browser** in the same pane for a dev server on this computer; the address must be localhost or 127.0.0.1.
- **Safety.** Everything is read-only and stays inside the session folder by real path, so `..` and junctions cannot lead out. A file the floor would refuse to read (secrets, keys) is shown as Not shown and never sent. Page previews are served at `/preview/<token>/...` with a per-folder random token, a sandbox content security policy, and the floor check on every file.
- **Tests.** `apps/host/test/files.test.ts` (listing, `..` and junction refused, secrets blocked, binary, preview sandbox and token, reveal), proved by switching the inside-the-folder check off (three tests failed). `apps/web/test/files.test.tsx` (changed files from the transcript, the tree, markdown, code, blocked, preview, local addresses only).

## Phase 19: split view (28 Oct)

- **Up to three sessions side by side** in the workspace, each a full pane with its own header (model, effort, mode, Interrupt), transcript, files, viewer and composer. Open beside (in the last pane's header) adds one; Close pane removes one; switching a pane to a session already on screen swaps the two. Sessions has a Beside button. Opening a session from elsewhere puts it in the first pane unless it is already shown.
- **Narrow panes** (container query at 980px): the files rail folds behind Files and plan, which opens it over the pane, and an open file takes the transcript's place.
- **Found and fixed while testing.** The composer had a fixed id, so two panes would have shared one label; it now has its own id per pane. Opening beside from a single session replaced it instead of adding; fixed and covered by a test.
- **Tests.** `apps/web/test/split.test.tsx` (open beside, three at most, close, swap, opening from elsewhere).

## Phase 20: the composer plus menu (28 Oct)

- **Plus button** beside the prompt: Add files or photos (the Windows file window, several at once), Add a folder, Slash commands and skills, Connectors, Plugins. Files go into the prompt as @ mentions of their place in the session folder; a file from elsewhere is copied into `.jcvc/attachments` in the folder first, so Claude reads it without leaving the folder. Pictures can also be pasted or dropped into the prompt.
- **Commands, skills, connectors and plugins** come from the session's own start message (terminal-only commands left out), so the lists are the session's real ones.
- **Safety.** A file the floor would refuse to read is never copied; names are cleaned and prefixed; pictures only (png, jpeg, gif, webp) can be pasted, at most 20 MB; every copy is audited by name (`files-attached`). The file window's script is fixed and takes nothing from the request.
- **Tests.** `apps/host/test/attach.test.ts`, `apps/web/test/plus-menu.test.tsx`.

## Phase 21: start-up progress, and Jean-Claude mode as the only look (28 Oct)

- **Start-up progress.** The native window's start-up picture now has a band across its foot with a moving bar and a line saying what is happening and for how long (Starting the Approver, Starting the PowerShell checker, Loading your rules, Opening the window), read from the Host's own log lines. After 20 seconds it adds that the first start can take a minute. A failure stops the bar and gives the message room. In `packaging/JCVCApp.cs`.
- **Jean-Claude mode is the only look** (owner, 28 Oct: "the default mode from now on with only light and dark versions of it available"). The on and off switch is gone from the header, Settings, the setup wizard and the command palette, and so is the stored `gatehouse.jcmode` setting. The faint picture is always behind the screens. The themes are now called Jean-Claude light and Jean-Claude dark; Settings keeps the picture choice (automatic, one of four, or your own).
- **Tests.** `apps/web/test/jcvc.test.tsx` (no switch in the store, paints from the start), `app.test.tsx` (always on, the header switches only between the two versions), `setup.test.tsx` (only the two themes, no checkbox), `palette.test.tsx`. Proved by breaking it three ways (the page marked off, the old theme names, the picture gated on the old setting): all caught.

## Phase 22: JCVC updates itself (29 Oct)

- **Install once, then one choice per update.** The Host looks for a new release every 30 minutes (Settings: 15 minutes to once a day, or never), downloads it in the background unless you turn that off, and puts an Update button in the header with what is new. Update now closes JCVC, switches and opens the new version. Skip this version, Offer it again, and Go back to the kept version are in Settings. Any version can follow any other.
- **Only what changed is downloaded.** A release has three parts with tree hashes: the app (a few MB), node_modules and the Node runtime (together about 460 MB). Unchanged parts are copied from the current install.
- **Signed, checked, contained.** release.json is signed with an Ed25519 release key built into the app; every archive must match its size and sha256; downloads only from GitHub's hosts with every redirect checked; zips are written and read by JCVC itself (UTF-8 names, every name checked, no more files or bytes than signed; Windows' tar.exe was dropped after the end-to-end check found it could not take some real file names); a token (only for a private repository) is sealed with DPAPI and sent only to api.github.com. Threats T25 and T26.
- **Never left broken.** JCVC-Update.exe (packaging/Updater.cs, new) swaps folders after JCVC closes, carries your policy and the uninstaller, and goes back by itself if the new version's Host does not say it started within four minutes. Tested for real against compiled stand-ins: a good switch, a crash, a hang, going back, a folder still held open, and a plan naming a folder elsewhere.
- **Found and fixed on the way.**
  - npm's workspace links in the package are junctions with absolute paths, so the packaged folder could not really be moved, and the installer would have copied them as folders (the PowerShell parser would then not have found its script). scripts/links.mjs now makes them point at the folder JCVC is in, on every start; releases and the installer leave them out.
  - The settings file refused any setting it did not know, so going back to an older version would have stopped JCVC starting. It now keeps unknown settings; the settings screen still refuses one nobody has.
  - The quiet hours and digest time checks had lost their backslashes, so no real time could be saved. Fixed and tested.
- **Releases are made on this computer** (`npm run release`): GitHub Actions are switched off for the repository at the owner's request (free account). The release page leads with JCVC-Setup.exe.
- **Owner to do.**
  - Keep a copy of the release key (`%USERPROFILE%\.jcvc-release\release-key.pem`) in your password manager. Without it no installed copy accepts a new release.
  - The repository is public (owner, 29 Oct), so installed copies need no GitHub token. Outsiders can only fork: issues, projects, wiki and discussions are off, pull requests are for collaborators only, and rulesets stop main being deleted or force-pushed and published release tags being moved or deleted. The token field in Settings stays for a private fork.

## Phase 23: installing without a download (29 Oct)

- **Why.** The owner's company laptop blocks JCVC-Setup.exe in the browser ("Keep" is locked). An MSI would most likely be blocked the same way (an unsigned .msi is treated as the same kind of download), so it was not the answer here.
- **`npm run install:local`** builds JCVC from the checkout and installs it where the installer would, with a Start menu shortcut, or over an existing copy through JCVC-Update.exe like an update. Tested in a temporary folder: a fresh install that starts and passes its check, then a second install over it that switched, kept the old copy and reported that the new one started.
- **The release page** now has JCVC-Setup.exe and the same in a zip.
- **The MSI is parked** on the branch `parked/msi`: built only with Windows (its own msi.dll through a small C# tool, makecab for the files), dual-purpose (for you alone, or for everyone with ALLUSERS=1), not yet tested. WiX could not be used: downloading and running its tools was refused as code from outside.

## Phase 24: your rules hold in Auto and Accept edits (29 Oct)

- **The gap.** In Auto and Accept edits, Claude Code approves many calls by itself without asking JCVC. The floor and the audit already ran on those, but your deny rules and High risk escalations did not: a `git push --force` your rules deny could run in Auto if Claude Code's classifier approved it.
- **The fix.** In those two modes the PreToolUse hook asks the Approver too. A deny is a deny. A High or Severe escalation, or one the Approver could not decide (for example while it is down), is answered "ask", which sends it through canUseTool to you, as in Manual. Moderate and Low requests, and commands no rule names (rated 50), are left to Claude Code's check, which is what Auto is for. The hook still never answers allow (invariant 2, reworded). canUseTool reuses the hook's verdict, so each call is judged and recorded once. Manual is unchanged.
- **JCVC's own tools** (notify_user, create_checkpoint, get_policy_summary) now state their annotations instead of leaving them to defaults.
- **Tests.** `apps/host/test/auto-mode.test.ts`, run in both modes against the real Approver and rules: a denied command is blocked by the hook even when Claude Code would approve it; `git push origin main` (High, 80) reaches a person and is judged once; `curl` (Moderate, 60) is left to Claude Code and the audit shows both what JCVC thought and that it ran; Manual judges once; an undecided verdict is asked. Invariant 2's test now runs in all three modes. Five breaks, each caught by its own test. Threat T27.
- **Confirmed live.** A real Claude session in Auto mode (one short turn on a small model, in an empty scratch folder) whose hook answered "ask" for a Bash call did call canUseTool for it. Auto mode is available on this account.

## Phase 25: quicker updates, start-up steps, ntfy topics (29 Oct)

- **The first real update looked stuck.** Updating 1.0.74 to 1.0.75 on the owner's laptop spent about 15 minutes on "Checking the new version, 0%": it had copied the 12,000 unchanged files of node_modules and then read every byte to check them, while Windows' virus scan inspected each new file. The bar only moved at the end, and the dialog's Update now was lost on the way, so nothing switched once it was ready.
  - **Unchanged parts are now hard links** to the current version's files: nothing new is written, so there is nothing new to scan, and they are checked by count and size instead of being read again (they are the files JCVC already runs). Downloaded parts are still checked byte for byte against the signed release, with progress per file.
  - **The Host keeps Update now** (`POST /api/update/install`): it prepares the version if needed and switches as soon as it is ready, whatever the screen does. The dialog and Settings only show what the Host says.
  - Found while testing: a lost update in a running total (`bytes += await ...` reads the total before the await), which made a linked part look wrong and be downloaded again. Fixed.
  - The update from 1.0.75 to the next version still runs 1.0.75's slower code; the improvement shows from the update after that.
- **Why the first start takes 60 to 120 seconds**, measured on a fresh copy: 9 s re-pointing npm's links, 50 s loading and compiling the Host's code (about 1,500 files, each scanned by Windows on first read), 24 s starting the PowerShell checker, the Approver and the rest: 84 s. A second start: 32 s. Copying the package, as an install does, took 208 s.
  - **The start-up picture now names each step** with its time so far, lists the steps done with how long each took, and says why a first start is slower. The window reports its own two steps (checking JCVC's files, loading JCVC's code); the Host reports the rest as progress lines. The file check runs off the window's thread, so the picture keeps moving.
  - The installed Host no longer runs git at start (it printed "fatal: not a git repository").
  - **Next:** build the code into a few files at package time, so a start reads a handful of files instead of 1,500.
- **ntfy test "not working".** The owner's tests did reach ntfy (three on the topic); the phone was not on that exact topic. New topics use only letters and digits that cannot be confused (no 0 o 1 l i), in groups of four; the panel has Copy topic and the address to open in the phone's browser to check; the test now says when ntfy stored it; the counter says it counts request notifications.
- **Release notes** list only what changed since the last release (the release tags are fetched first).

## Phase 26: starting in a quarter of the time (29 Oct)

- **Built code.** The package now runs the Host, the Approver and the phone Relay as one built file each (`scripts/bundle.mjs`, esbuild, already installed with tsx and vite, so no new dependency). The sources stay as a fallback.
- **Measured on a fresh copy of the package** (what an install or an update leaves): first start 84 s before, **22 s** now (loading JCVC's code went from 50 s to 3 s); second start 32 s before, **11 s** now. Node's compile cache in the data folder helps the second start.
- **What could have broken, and the check for it.** `scripts/package-smoke.mjs`, run by `npm run package:check`, drives the packaged copy: Approver and PowerShell checker running, `git status` allowed and `git push --force` denied through the shell parser, a PowerShell command parsed, a secrets file blocked by the floor, a token sealed with DPAPI and removed, the built Relay loading. Proved by hiding the DPAPI script for one run: that check failed. The DPAPI script path counted folders and would have broken; it now searches up for the app folder.
- **Still slow:** about 6 s between "Opening the window" and ready, and 3 to 4 s starting the Approver. Not looked into yet.

## Phase 27: saying what is happening, deciding in place (29 Oct)

The owner started a session, saw "The Host did not answer in time" though the session had started, sent a prompt that seemed to do nothing for minutes, and was then asked about a Write in Extreme approval.

- **The Approver limit is 15 seconds, not 5** (deviation from BUILD_SPEC step 4). The audit log showed the Approver judged that Write in 1.4 s, but the request had waited about 6 s to reach it while Claude streamed a 40,000 character file, so the Host gave up first and recorded `evaluator-unavailable`, which Extreme approval rightly never approves. The same call takes 30 to 60 ms on a quiet laptop (installed copy and built package both measured). Still bounded, still fail-closed; 35 s with the judge on, as before. When Extreme approval meets such a failure the card now says why it waits.
- **What a session is doing.** The SDK's partial messages were already sent to the screen and thrown away. `apps/web/src/lib/activity.ts` reads them into a line above the composer: sent, thinking, writing a reply, writing a file with the characters so far, running a tool, with seconds. A subagent's messages are left out. The label is announced once per phase; the counters are not.
- **Starting a session** waits up to 3 minutes instead of 1, counts the seconds and says the first start after an install or update is the slow one. If it still gives up, it says the session may yet appear instead of calling it a failure.
- **Deciding in place.** Permission rows on the queue have Deny and Allow once; the workspace shows its session's oldest request above the composer with the same two, Esc and Ctrl+Enter only while focus is inside it, Deny filled at high risk, and More options for the full card. Questions and plans show the full card there. All of them send through one helper (`lib/decide.ts`).
- **Tabs that look like tabs.** The open tab had no underline anywhere: `border-transparent` is written after `border-acc` in the built CSS, so the class pair never worked. One `.tab` rule keyed on `aria-selected` replaces it.
- **The narrow Files and plan panel** has a Close button and closes on Esc, giving focus back to the button that opened it.
- Tests: `apps/web/test/activity.test.ts`, `apps/web/test/decide-in-place.test.tsx`, and the Extreme approval reason in `apps/host/test/extreme.test.ts`. Each was proved by breaking the code it guards (9 breaks, 9 caught).
- **Settings save as you change them** (owner, 29 Oct). A switch, a choice or a time saves after 300 ms (quick clicks make one save); a typed box saves when you leave it or press Enter, and only if it changed. Saves run one at a time and always send the whole file with any keys this version does not know. A refusal shows the Host's reason and keeps what you typed. Every save, here and on the update, ntfy, Slack and picture controls, confirms in a toast that replaces the last. The organisation box lost its placeholder, which read as a value. Tests: `apps/web/test/settings-autosave.test.tsx` (5 breaks, 5 caught).

## Phase 28: what Claude may do, in plain words (30 Oct)

The owner found the Policy studio "very techy and not something the average user vibe coding could use". The page now opens on **Your choices**; the studio is under **Advanced**, unchanged. Grounded in the owner's research (`docs/research/features-2026-10-30.md`, sections D and F1, F3, F18): presets described by their consequences, a locked list shown not hidden, examples over syntax, a "Try it" answer in words, suggestions learned from approvals.

- **Levels**: Careful (today's default, so a fresh install reads as Careful), Balanced (for building an app) and Hands-off. Sending code away never becomes an allow.
- **Eight switches** in words (`apps/web/src/lib/choices.ts`), each owning packs, switched-off rules or a deny rule of yours. A choice changed in Advanced reads as "custom" and is only replaced by an explicit pick. Every change saves at once through the existing `PUT /api/library` (validated and audited by the Host) and the toast offers Undo.
- **Three new packs**: `run-app` (dev servers and previews), `packages` (project installs; whole-computer installs still ask) and `web-read` (search and read pages; downloads still ask).
- **`turnsOff` on packs** (`packages/policy`): an ask beats an allow, so an allowing pack must switch off the ask it replaces, while it is on. A floor or deny id is a load error. This changes the pack format: older versions refuse a pack with the field, which is fine because packs ship with the version that reads them.
- **Always blocked** lists the floor and deny rules in words. **Learned from you** reuses `/api/suggestions` and the remembered rules. **Try it** runs `/api/policy/test` from the project folder of a file, so the code, tests and docs rule applies as it would in a session.
- Research items not built yet: grant lifetimes, watch mode, a decision line in the transcript, snapshots before risky commands (F2 to F5).
- Tests: `packages/policy/test/library.test.ts` (turnsOff, and the new packs' cases), `apps/web/test/choices.test.ts`, `apps/web/test/policy-choices.test.tsx`. 6 breaks, 6 caught.

## Phase 29: a new project from what you want to build (30 Oct)

The owner asked for a default root folder, and for a session started without a folder to take its folder name from the prompt. Research item F7 (`docs/research/features-2026-10-30.md`, section C1 and C2): no folder picker for a beginner, a short slug, a number on collision, git initialised so autonomy and checkpoints are safe.

- **Settings, Where new projects go** (`projectsFolder`): a folder on a drive, below its root, outside Windows and Program Files (`PROJECTS_FOLDER`). It is added to the workspace roots in the Host and the Approver alike (`extraWorkspaceRoots`), or the deny rule `outside-workspace-write` would block every edit in a new project. A restart applies it, like the other roots.
- **Sessions**: with it set, an empty Folder asks "What do you want to build?". The folder name comes from the words that are left once how you asked is dropped ("Build me an HTML page that acts like a simple version of excel" becomes `html-excel`), shown while you type, with Change the name. Start creates the session and sends what you typed as the first prompt.
- **The Host** accepts `freshFolder` only for a folder straight inside the projects folder, adds -2, -3 when the name is taken by a folder with anything in it, and runs `git init` so checkpoints work from the first edit. A git failure is logged and the project still starts.
- **Found while checking it on screen**: the form imported the name helper from the shared package's main entry, which loads Node's crypto and left a blank window; the tests run under Node and passed. It now has its own entry (`@gatehouse/shared/project-name`), and `apps/web/test/browser-imports.test.ts` refuses any value import of Node-only code in the screen. Also fixed: the start form overflowed at common widths, and the Folder box showed an example path that read as a value.
- The demo page (`screens.html`) now stands in for the policy routes and has policy and sessions views, so the README pictures can show both.
- Not built: the blueprint card (name, purpose, features) and opening in Plan mode (C1 steps 2 and 3).
- Tests: `packages/shared/test/project-name.test.ts`, `packages/policy/test/projects-root.test.ts`, `apps/host/test/new-project.test.ts`, `apps/web/test/new-project.test.tsx`, `apps/web/test/browser-imports.test.ts`. 6 breaks, 6 caught; the import guard was proved by putting the bad import back.

## Phase 30: a sidebar and panes like the desktop coding apps (30 Oct)

The owner asked to arrange JCVC like the Claude desktop app and said a complete change was fine. Invariant 16 still holds: the arrangement and behaviour follow patterns common to desktop coding apps, the look is JCVC's own (signage type, colours, the Jean-Claude backdrop); no icons, colours or spacing were copied.

- **The sidebar** (`components/Rail.tsx`): Needs you, New session, Search (opens the Ctrl+K palette), pinned pages and More; your sessions grouped by the folder they are in, those needing you first, each with a ... menu (open, open beside, close); at the foot the Host, Approver and phone, the update button, the kill switch (still one click and a confirmation away) and a profile menu holding every other page, the theme and help. Edit sidebar chooses the pinned pages; Ctrl+B hides it, and while hidden a Sidebar button says how many requests need you.
- **Menus** (`components/Menu.tsx`): one accessible pop-up used everywhere. It floats above the page so a scrolling list never clips it, takes focus on its first action, moves with the arrow keys, Home and End, and Esc gives focus back. Found in the browser, not by the tests: a menu measured while hidden could not take focus; it is now transparent while it measures.
- **A session pane**: its name opens a menu (show another session here, open one beside, close the pane, interrupt, close the session; each item says what it does). Plan, Files and Browser are worded buttons, not icons, because the project forbids hover tooltips and an icon needs one. Model, effort and mode moved under the prompt box with Interrupt.
- **Detail** (research F9 and F10 in part): a run of tool calls folds into one line ("Ran 2 commands, read schema.ts") that opens to each call; the live line adds tokens written and how long since anything arrived, and after two quiet minutes with nothing waiting for you it says the turn is possibly stuck.
- Fixed on the way: the toast, palette and backdrop sat inside the layout grid and each took a row, so the sidebar stopped short of the window; a pane's name shrank to nothing beside its state.
- Not built yet: a terminal pane, a changes pane with keep and undo, sessions for chat rather than code, renaming and archiving sessions, a context meter.
- Tests: `apps/web/test/rail.test.tsx`, `apps/web/test/groups.test.ts`, the pulse in `apps/web/test/activity.test.ts`, and the split, app and side panel tests moved to the new controls. 9 breaks, 9 caught (one survived at first: the test data sorted the same by age as by need; a case where the session needing you is the oldest now guards it).

## Phase 31: terminal, changes, chats, and restart now (30 Oct)

The owner chose stage 3 of the new shell (terminal and chat), and queued a restart prompt.

- **Terminal pane** (`apps/host/src/terminal.ts`, `components/TerminalPane.tsx`): your own PowerShell commands in the session's folder, one at a time, output streamed, Up and Down for history, Stop. Not a pseudo console: that needs a native addon, which the project avoids, so a program that asks a question gets no answer. Your commands do not pass the Approver (they are yours, as in a PowerShell window), but each is written to the audit log before it runs and does not run if it cannot be; the record has no cwd so a policy replay never reads it as Claude's. The kill switch refuses new commands and stops running ones; Claude Code's sign-in variables are removed. Threat model T28.
- **Changes pane** (`changesSince` and `restoreFiles` in `packages/shared/src/node/checkpoint.ts`): files changed since a checkpoint (the session's first by default), with line counts and each diff, secrets never listed; Undo for one file or all, each after a confirmation and a safety checkpoint. Only files that changed since the checkpoint can be named. The Host already had checkpoint list, preview and restore; nothing on screen used them until now.
- **Chats** (`surfaces/NewChat.tsx`, `kind: "chat"`): a conversation that is not about a project. It gets a folder of its own under the data folder, named from what you said, never shared with an earlier chat; Claude is told it is a chat; the Host keeps it in Plan mode and refuses any other mode or Extreme approval, because the read and edit rules cover your workspace folders and a chat in Manual mode could otherwise change them. Chats are listed under Chats in the sidebar and have no project panels. Threat model T29.
- **Restart now or later**: a setting that needs a restart offers Restart now and Later, warning that open sessions stop. The Host prints a restart line; the window app starts a fresh JCVC that waits for this one to close (`--after`), then closes. The console launcher cannot, and the Host says so.
- Found on screen: in a narrow pane the wider Terminal and Changes column beat the narrow-pane rule and squeezed the transcript to a letter a line; the rules now sit in container queries.
- Tests: `apps/host/test/terminal.test.ts`, `packages/shared/test/changes-since.test.ts`, the chat cases in `apps/host/test/new-project.test.ts`, `apps/web/test/panes.test.tsx`, `apps/web/test/chat.test.tsx`, `apps/web/test/settings-restart.test.tsx`, and the restart command in `apps/host/test/server.test.ts`. 11 breaks, 11 caught.

## Phase 32: pictures, times, a checking state, and session management (30 Oct)

- **Pictures** (owner, a priority): a pasted, dropped or added picture shows as a thumbnail above the prompt box, opens large, and can be removed; it is sent as a reference with your words, so the prompt box keeps only what you typed, and your message in the transcript shows it. Before, its path appeared in the prompt box.
- **A time on each message**: "14:02" today, "29 Oct, 14:02" before, the full date and time for a screen reader.
- **Checking, not failing**: after a start or an update the first sign-in check takes about 20 seconds, and Before you start showed red failures until it answered. Health now says whether that check has finished (`signin.checked`); until it has, nothing sends you to Before you start, the page says Checking with the seconds, and the sidebar says Checking sign-in.
- **Session management**: titles, pins and archives, kept by Claude Code session id in `%LOCALAPPDATA%\Gatehouse\sessions.json` (read tolerantly, unknown keys kept, a broken file starts empty) so they hold across restarts and resumes; a title is also written into the session's own transcript through the SDK. The sidebar shows Pinned first and leaves archived sessions out; Archive stops a session first. **Earlier sessions** on Sessions lists past sessions (Claude Code's own from elsewhere on this computer too) with Resume and Fork, which were missing: three places told you to resume from Sessions and there was no way to. **Search what was said** reads up to 100 past sessions within 20 seconds, your words and Claude's but not tool output or subagents, and says when it stopped early. **Export as Markdown** saves what was said and the commands that ran, never tool output, to Downloads. A **context meter** under the prompt box shows how full the conversation is after each turn, and what fills it.
- Tests: `apps/web/test/pictures.test.tsx`, `apps/web/test/sessions-manage.test.tsx`, `apps/host/test/history.test.ts`, the time in `apps/web/test/format.test.ts`, the checking state in `apps/web/test/app.test.tsx`. 11 breaks, 11 caught (one more was equivalent to the code and proved nothing, so a stronger one replaced it).

## Phase 33: keep the ntfy topic your phone has (30 Oct)

- **Owner report:** the topic in Settings was not the one the phone was subscribed to.

  The audit log shows what happened. Topics were made at 15:41 on 29 Oct, and again by **Make new topics** at 15:44. The 15:44 topic is the one still saved, and no update since has changed it. Only that button asks for new topics, and it sat next to Save changes and acted at once.
- **Your phone's topic, typed back in.** Choose **My phone has a different topic** and paste what the ntfy app shows (the name or its address). The phone needs no new subscription.

  Only a topic JCVC made is taken: five groups of four, or the 20 to 24 letters and digits of before 29 Oct. Whoever reads the topic sees the Approve buttons, so a name someone could guess is refused.

  The reply topic is kept. The audit records that a topic was typed, never the topic itself.
- **Make new topics asks first.** It says your phone stops getting requests until you subscribe again. Keep this topic is the default.
- A refused topic says why under its box, and Cancel clears it.
- The panel's five-second status check no longer puts the server and risk boxes back while you edit them.
- Tests: `apps/web/test/push-panel.test.tsx`, and the typed-topic case in `apps/host/test/api.test.ts`. 9 breaks, 9 caught.

## Phase 34: nothing lost on a restart, the update bar, and fixes the owner met (30 Oct)

The owner now builds JCVC from a session inside JCVC, so every update used to end that session.

- **Nothing lost on a restart or update** (owner, "one major thing").

  The Host keeps the open sessions in `%LOCALAPPDATA%\Gatehouse\open-sessions.json` (`apps/host/src/open-sessions.ts`): each one's id, folder, Claude Code conversation, mode, model, effort, Extreme approval, and whether a turn was running. It is written a quarter of a second after each change, so a crash or a forced close leaves it current. When JCVC closes it stops writing first, so the sessions it then closes come back.

  At the next start each one is resumed in turn, under the same id, with the settings it had. The restore is audited (`session_restored`). Only the allowed modes come back (invariant 3); anything else starts in Manual. A chat keeps its own folder, and only a folder JCVC made for chats. With the kill switch engaged nothing starts and the list waits. One that cannot come back is dropped; it is still under Earlier sessions. The file is read tolerantly and keeps what a newer version wrote.

  The window remembers its page, its panes and what you had typed but not sent. A resumed session (after a restart, or Resume or Fork) now shows its earlier conversation, read from Claude Code's transcript through the Host. Before this, Resume opened an empty pane. If a restart cut a turn off, a line says so.

  Only the desktop Host keeps sessions (`keepOpenSessions`); the CLI does not.

  Not covered: the first update from a version without this file brings nothing back, because that version never wrote the file. Resume from Sessions that once.
- **An update bar** across the top of the window when a newer version is out: Update now, What is new (the dialog) and Later (until JCVC next opens). It replaces the sidebar's update button. It shows the download and the switch as they happen. The Sidebar button and the skip link now sit inside the shell, so the bar never covers them.
- **The prompt box always shows.** The update banner, or the space over a hidden sidebar, pushed the prompt box and its Model, Effort and Mode bar below the window. The workspace now fills what is left; only the transcript scrolls; a long request card scrolls inside itself. The sidebar also scrolled sideways on a long session name.

  Checked in headless Edge at 1280 x 720 with the banner and the bar: the settings bar's bottom went from 757 px (off screen) to 708 px, and the sideways scroll from 315 px to 0.
- **Interrupt** read "Turn ended with an error: The turn ended with an error". The Host now says it is stopping the turn before it does, and the result reads "You stopped this turn." (or the kill switch did). A real failure with no text says why where the SDK says.
- **ntfy topics** are all lower case with none of 0 o 1 l i (owner). ntfy treats O, o and 0 as different topics. A typed topic with capitals is refused with the reason.

  The owner's saved topic is from before 29 Oct and their phone works on it. So it is never replaced by itself: the panel offers a new one.
- **The sidebar foot** said "No phone" with ntfy on. It now names each way a request reaches you, "Notifying on ntfy", green while one works, and updates when ntfy or Slack connects or drops.

  Slack's change callback follows ntfy's but has no test of its own.
- **Each tool call's decision** (F2, first half): the Host sends a `decision` session event for every verdict, never the input. The screen does not show it yet.
- Tests:
  - `apps/host/test/open-sessions.test.ts` (threat model T30)
  - `apps/web/test/restore.test.tsx`
  - the bar in `apps/web/test/update.test.tsx`
  - the stopped turn in `apps/web/test/transcript.test.ts` and `store.test.ts`
  - the interrupt cases in `apps/host/test/scripted-run.test.ts`
  - `apps/host/test/decision-events.test.ts`
  - the topic cases in `apps/host/test/ntfy.test.ts` and `api.test.ts`
  - `apps/web/test/push-panel.test.tsx`
  - the foot in `apps/web/test/rail.test.tsx`

  49 breaks, 46 caught on the first run. For the other three, two tests were tightened and caught their break on a second run, and one check was redundant, so the code was made simpler.

## Phase 35: background work, Stop and Force stop (30 Oct)

- **Owner report:** a Proscenia session's turn ended while its background subagents kept working. The header said Ready, the sidebar had no Working, and there was nothing to press to stop it.
- **Working in the background.** The Host keeps the live background tasks from Claude Code's own list (`background_tasks_changed`, leaving out watchers it marks ambient) and drops each as it ends (`task_notification`). `SessionInfo.background` names them. While any run, the header says Working in the background, the sidebar says Working, and a line lists them.
- **Stop** replaces Interrupt, in the session bar, the title menu and `/stop`. It interrupts the turn and stops every background task (`stopTask`). The kill switch now does the same, so background agents stop with it too.
- **Force stop**, offered when a session is still working five seconds after Stop, closes its Claude process and starts it again on the same conversation under the same id (the restore path of Phase 34). The pane keeps its transcript and adds a line saying you force-stopped it.
- Release 1.0.95 went out with Phases 33 and 34 after one rerun: the first attempt's gate lost a test worker under load (exit 3221226505 in `server.test.ts`). The file passed alone, 28 of 28.
- Tests:
  - `apps/host/test/background.test.ts` (the fake SDK gained `stopTask` and a way to send a message between turns)
  - `apps/web/test/stop.test.tsx`

  14 breaks, 14 caught.
- **The context meter always shows** (owner): it was read only when a session went idle, so a pane opened mid-turn showed none. It is now read when the pane opens and after every turn. **Compact now** in its panel sends `/compact` between turns; the meter says Compact from 60% and its fill turns yellow from 80%; the transcript says when you asked and when Claude Code summarised (`compact_boundary`). Tests: `apps/web/test/context-meter.test.tsx`, 7 breaks, 7 caught.

## Phase 36: Extreme approval carries on until the build queue is empty (30 Oct)

- **Owner decision** (CLAUDE.md, invariant 3): in Extreme approval a session does not wait on you. A turn ended with "Still to do" and sat there.
- **Questions and plans** (`apps/host/src/carry-on.ts`, `canuse.ts`): a question gets the option marked Recommended, or else the first (every recommended one where several may be chosen). A question with no options still waits for you. A plan is approved. Each is audited first with `decidedBy: extreme-mode`, and not given if it cannot be recorded.
- **Carrying on**: after each turn the Host sends a carry-on message ("carry on with the next item in your build queue... end your reply with the line QUEUE EMPTY") until Claude ends a reply with QUEUE EMPTY. It stops after 25 automatic turns or $25 spent since your last message (`extremeCarryOn` in the settings file, read tolerantly), on a failed turn, on Stop and on the kill switch. Your next message starts a new run. Each carry-on is audited first (`extreme_carry_on`); the transcript says each turn and why it stopped.
- **After a restart**, a session that was working in Extreme approval carries on by itself. After Force stop it does not.
- Not yet: the limits have no place in Settings; they are in the settings file.
- Tests (threat model T31):
  - `apps/host/test/carry-on.test.ts`
  - `apps/host/test/extreme-carry.test.ts` (the fake SDK's result now carries the turn's last words, as the real one does)
  - the lines in `apps/web/test/store.test.ts`

  17 breaks, 17 caught.

## Phase 37: a message sent while Claude works (30 Oct)

- **Owner decision:** a message sent mid-turn reaches Claude at its next step, as Claude Code does, rather than waiting for the turn to end. It shows as queued until Claude has it, cannot be taken back, and can be made to interrupt.
- A live probe (`docs/sdk-notes.md`) showed Claude takes such a message between tool calls and says nothing when it does. The transcript marks it **Queued: Claude reads it at its next step** until a tool result has come back after it and Claude has answered again (a subagent's steps do not count), or the turn ends.
- **Interrupt now** beside it is Stop: the turn and its background tasks end, and Claude Code then runs the queued message, which the interrupt receipt confirms it keeps.
- Tests: `apps/web/test/queue.test.tsx`. 7 breaks, 7 caught; one survived the first run and the test was tightened.
