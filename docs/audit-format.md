# Audit log format

The audit log records every decision Gatehouse makes. It is append-only and hash-chained, so editing, deleting or reordering a record can be detected.

## Where it lives

`%LOCALAPPDATA%\Gatehouse\audit\` (override with `GATEHOUSE_AUDIT_DIR`, or `GATEHOUSE_DATA_DIR` for the parent).

| File | Contents |
|---|---|
| `audit-YYYY-MM.jsonl` | One JSON object per line, one file per UTC month. |
| `head.json` | `{ "seq", "hash", "file" }` for the newest record, written after each append. |
| `audit.lock` | Exists only while a process is appending. A lock older than 10 seconds is treated as left by a crash. |

## One record

```json
{"v":1,"seq":42,"ts":"2026-10-26T14:02:11.482Z","session":"s1","event":"evaluate_permission",
 "channel":"approver","tool":"Bash","toolUseId":"toolu_01...","cwd":"C:/dev/app","project":"app",
 "inputJson":"{\"command\":\"git status\"}",
 "verdict":{"outcome":"allow","ruleId":"safe-shell","reason":"...","risk":0,"decidedBy":"rules","policyHash":"..."},
 "latencyMs":3,"prevHash":"<hash of record 41>","hash":"<hash of this record>"}
```

- `seq` counts up by one from 1 across all files.
- `channel` is who decided: `approver`, `host`, `desktop`, `phone` or `timeout`. `verdict.decidedBy` is the decider inside that (floor, rules, judge, human-desktop, human-phone, timeout, evaluator-unavailable).
- `inputJson` is the **redacted** tool input as canonical JSON in a string. Keeping it a string means the record holds only strings, whole numbers, booleans, arrays and objects, so another program can recompute the hash without matching floating point formatting.
- Optional fields (`toolUseId`, `cwd`, `project`, `judgeRationale`) are left out when absent, never written as null.
- Redaction is applied to every text field before the record is built (`session`, `tool`, `cwd`, `project`, the verdict text and segments, the input, the judge rationale). The writer cannot be constructed without a redaction function.

## The chain

`hash` is the SHA-256 (lower-case hex) of the **canonical JSON** of the record without its `hash` field. Canonical JSON follows RFC 8785: object keys sorted by UTF-16 code unit, no whitespace, strings escaped as `JSON.stringify` does (only `"`, `\`, and control characters; non-ASCII characters are written as they are).

- The first record has `prevHash` of 64 zeros.
- Every other record's `prevHash` is the `hash` of the record before it, including across month files. The first record of a new month links to the last record of the month before.

## What the verifiers check

`npm run audit:verify` (Node) and `scripts/verify-audit.ps1` (an independent PowerShell 7.5+ implementation with its own canonical JSON) check:

1. Every line is valid JSON and a valid record.
2. `seq` follows the record before it, and `prevHash` matches it.
3. `hash` matches the content.
4. Each record sits in the file for its own month.
5. No blank lines, and no torn final line.
6. `head.json` exists, is valid, and agrees with the end of the log. A log shorter than `head.json` says means records were removed from the end.

They report every problem with file and line, and keep checking after one, so a single bad record does not hide later ones. Exit code 0 means intact, 1 means problems. Tests run both on the same fixtures and require the same verdicts.

```
npm run audit:verify                  # the default folder
npm run audit:verify -- C:\path\dir   # another folder, add --json for machine output
pwsh scripts\verify-audit.ps1 -Dir C:\path\dir
```

## Writing

All writers append through `AuditWriter` (the Approver now, the Host as well from Phase 3). It takes the lock, reads the end of the log, appends one line, flushes it to disk, and rewrites `head.json` (atomically, with retries because Windows briefly refuses a rename while a scanner has the file open). Appends from several processes are safe.

- A torn final line (a crash part-way through a write, never acknowledged to anyone) is cut off before the next append. Only the lock holder repairs. Reading the head never repairs.
- If the log is shorter than `head.json` says, or the last line is not a record, the writer refuses to append and reports an integrity error, rather than extending a damaged log.
- If a record cannot be written, the caller is told. The Approver turns an allow into an escalation in that case, so an unrecorded allow never happens.

## What this does and does not protect against

It detects accidental damage and edits by anyone who does not also recompute every later hash and `head.json`. It does not stop someone with write access to the whole folder from rebuilding a consistent chain, because the hashes are not keyed. The log is a record for the owner, kept on their own laptop. If that threat matters, copy `head.json` somewhere else from time to time and compare.
