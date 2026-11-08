# Performance budget

What Codehouse holds itself to, and how each is checked (backlog G11). A change that breaks a budget is a fault, like a failing test.

| What | Budget | How it is checked |
|---|---|---|
| Start, fresh copy (as an install or update leaves it) | Ready in 30 s | `scripts/package-smoke.mjs`, run by `npm run package:check` and so by every release, times the packaged copy from start to its address, says SLOW over budget, and adds a line to `dist-app\start-times.jsonl` (not in git) so each release can be compared. Over budget is said, not failed, because another program busy on the computer slows a start too. Measured 22 s first and 11 s second in Phase 26. |
| A long session's transcript | Only the messages on screen are drawn, however many there are | The transcript, the approvals queue and the audit list are virtual lists (react-virtuoso). |
| A long diff | At most 400 lines drawn until you ask for the rest | `components/MoreLines.tsx`, used by the diffs in the transcript and the Changes pane, with `more-lines.test.tsx` drawing a 10,000-line diff. The side-by-side and inline diff view (CodeMirror) draws only what is on screen by itself. |
| The Approver's answer | 30 to 60 ms on a quiet laptop; given up after 15 s (35 s with the judge), which escalates | Phase 27 measurements; the limit is in the Host, fail-closed. |

## Not checked by a machine

- **Dropped frames while scrolling a 10,000-message session** in a headless Edge trace. Scrolling draws only what is on screen (above), but no trace runs on each release: a frame count on this laptop changes with whatever else is running, so it would fail for reasons that are not Codehouse's.
- **Memory under 400 MB for such a session.** Not measured on each release, for the same reason. Look in Task Manager at Codehouse's window process (msedgewebview2) with a long session open.
