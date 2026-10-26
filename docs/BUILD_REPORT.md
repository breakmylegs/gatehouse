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
