# 0022: A prompt-injection flag holds nothing unless you ask, and a session's own files are not scanned (O58)

Status: accepted, 27 Nov 2026 (owner).

## Context

D-061 scans what a session reads from outside for prompt injection. When it finds some, Claude reads the result with
those parts taken out, the session shows a banner, the audit log records it, and the session's network commands are
held as `tainted-egress`.

The owner, 27 Nov: the flag "gets in my way and I don't want it holding me up". A session showed "11 results looked
like prompt injection ... Commands that send over the network (such as curl or a push) now ask you, even in Max
approval".

What the code did:

- In **Max approval** (and Extreme approval, the same flag since O45), `tainted-egress` was already answered:
  `EXTREME_ASKS` holds only failure escalations and the chat hand-off (invariant 3, 14 Nov). The banner's "even in Max
  approval" was wrong, and the code was right.
- A **Read** of a file matching `untrustedFiles` (`**/readme*`, `**/*.md`, `node_modules`, `vendor`, `third_party`) was
  scanned wherever it was, the session's own README and docs included. A session working on Codehouse read the
  repository's prompt-injection fixtures and Markdown, was flagged, and read its own files with parts taken out.
- In **Manual**, Plan and Auto, every network command after a flag asked.

## Decision

1. **The banner says what happens.** With the hold on, network commands ask "except in Max approval, which answers
   them". With it off, "Nothing is held for it". It never says Max approval asks, which matches invariant 3.
2. **A session's own files are not outside content.** A file inside the session's folder is never scanned or changed.
   Inside it, a dependency's folder (`node_modules`, `vendor`, `third_party`) is still outside content, because those
   are other people's words. Any file outside the folder is scanned, whatever its name, which is stricter than before,
   when only Markdown and README files outside were. Web fetches, searches and outside MCP servers are scanned as
   before. D-015 (no rule remembered from a README or a dependency) is unchanged.
3. **A setting**, "Hold network commands after a prompt-injection flag" (`holdNetworkAfterInjection`), in Settings,
   Safety. It is off unless `true`, so it is off for the owner, and it applies at once. Off, a flag is still taken out
   of what Claude reads, shown and recorded, but it holds no network command in any mode. On, D-061's hold works in
   every mode but Max approval.

Unchanged: B32 (a command copied word for word from what was read), D-016 (a value from an untrusted source sent on),
the floor, Severe, Ask about code prompts, and every invariant.

## Options considered

- **Keep scanning a session's own Markdown.** That is what kept flagging this repository. A project's own files are
  what the owner is working on, not someone else's words.
- **Treat everything inside the folder as its own, dependencies too.** `npm install` puts other people's READMEs
  there, which is exactly the outside content D-061 is for.
- **Hold on by default.** The owner asked for it off. The flag and its record stay, so the history is there.

## Consequences

- A session that read injected text from outside can push or curl without asking unless the setting is on. Threat
  model T173 records this, and it supersedes T95's claim that Extreme approval never answers `tainted-egress`.
- CLAUDE.md invariant 3 says so.
- Tests:
  - `apps/host/test/injection-scan.test.ts`: own files are clean, while dependencies and files outside the folder are
    flagged; with the hold off nothing is held, and on, a push is held.
  - `apps/host/test/tool-grant.test.ts`: in Max approval a flagged session runs curl and git push without asking,
    hold on or off; in Manual with the hold off nothing asks.
  - `apps/web/test/injection-flags.test.tsx`: the banner, both ways.
  - `apps/web/test/settings-autosave.test.tsx`: the setting saves.
