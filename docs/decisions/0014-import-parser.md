# ADR 0014: Reading a claude.ai export

Status: **Decided, 5 Nov 2026**, with the Chat plan (`docs/plan/chat-build-plan.md` section 8). Built in CH-04.

## Context

The owner's Chat build prompt asks Codehouse to import the official claude.ai export zip, treating every byte as untrusted: no path traversal, absolute paths, links or duplicates; limits of 10 GB unpacked, a ratio of 200 to 1, 100,000 entries and two levels of zips; three layouts told apart by their contents; `conversations.json` of about 1 GB on one line read with bounded memory; nothing left behind by a failure; instructions and memory inactive until accepted; and re-importing the same zip changing nothing. The format is undocumented and changes (the owner's report, section 7).

## Decision

- **Codehouse's own zip reader** (`apps/host/src/chat/import/zip.ts`), not the updater's, which reads only Codehouse's own zips, loads each entry whole and has no ZIP64. The whole directory is read and checked before anything is unpacked; each entry is then streamed through its CRC and its stated size. Windows does not tell names apart by case, so duplicates are found in any case. No dependency is added.
- **A small streaming array parser** (`json-stream.ts`) that holds one item at a time and refuses an item over 256 million characters. Measured on this laptop: a synthetic 1 GB file in about 6 seconds, below 512 MB of memory (the ceiling in the plan, question 6).
- **Files told apart by what they hold** (`map.ts`, `kindOf`): an array of conversations, a project, a list of projects, or memory. Zips inside the export are opened one level down with the same budget. The layout name (single, per-project, manifest) only labels the audit entry, so a layout change that keeps the records' shape still imports.
- **Fields as observed, not guaranteed.** Unknown fields stay in the raw JSON; an unknown block is kept whole to show collapsed; nothing is ever run; a record without a uuid or a date is skipped with the reason. The shown branch is the newest child at each fork from the newest root, since the export has no marker.
- **One transaction for the whole export** (`writer.ts`), redacted first, with the batch recorded by the zip's SHA-256, its layout and its counts. A record already imported is skipped unless the export has a newer `updated_at`, which replaces its snapshot under the same id.
- **Untrusted instructions.** Imported project instructions and memory are stored inactive and listed for you to accept or turn down one by one, as Anthropic's own importer does; newer instructions wait to be accepted again.
