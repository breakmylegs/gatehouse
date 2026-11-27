# 0023: Releasing Codehouse from a session with no terminal step (O60)

Status: accepted, 27 Nov 2026 (owner).

## Context

The owner, 27 Nov: "fix everything that stops you pushing and releasing Codehouse on your own, so a release never
needs me in a terminal again". What stopped releases in the week before, with the evidence:

1. **The release crashed in its invariant tests.** Four `npm run release` runs in a row stopped in
   `invariants.test.ts` with "Fatal process out of memory: Zone" (exit 2147483651). The same file passed five times run
   any other way: alone, through `test-shards.mjs`, under `tsx`, and under `npm run`.
2. **The update routes file** (`release-channels.local.json`) lives only in `C:\dev\gatehouse`, so every release from a
   worktree needed it copied in and deleted by hand.
3. **The full gate ran past the two hours a background run is given** and was stopped while still in the host tests,
   with nothing recorded and nothing to carry on from. Its output was held back until it ended, so where it had got to
   could not be seen.
4. **Sessions fought over memory.** Another session ran the whole suite (`vitest run --sequence.shuffle`) during a
   release; its bundler (Rolldown) and test workers ran out of memory, and seven files passed only on a retry.
5. **Leftover processes.** A break run that hung left a vitest worker and its headless Edge running. Each crashed
   browser test left a `codeh-phone-*` profile in the temp folder.
6. **Pushes refused** by `secret-in-commit` (O59) and held by a prompt-injection flag (O58).
7. **Also hit**: the browser test's dev server reloading the page partway through, which O55 fixed by finding
   dependencies first; the prohibited-patterns check refusing the browser check, which O55 named as a build check;
   test timeouts too short for git on a busy laptop, given explicit timeouts in O59's tests; and a test run's results
   arriving only when it ends (point 3).

**The job object.** The owner asked to read the session's job cap and live use and confirm it was the cause.

- This session's job is **Low** (`--memory-mb 2048`, Codehouse-Limits process 18924). `claude.exe` is in it.
- But a tool's own processes are not. `IsProcessInJob` says the PowerShell tool's process and everything the Bash
  tool starts are outside that job, and the release runs from those.
- So the job's 2 GB was **not** the cause of the release's crash, and raising the session's level would not have
  helped it.
- What a release does have is the computer's memory, which was about 2 GB free while several sessions ran, and the
  memory options its test processes started with (none, unlike every other run here).
- **Measured afterwards** with the release's own setup and nothing published (a throwaway npm script under tsx running
  the same test step): the crash is on a V8 background compile thread, and it comes and goes with the computer's free
  memory, not with anything in the environment. Dropping all of npm's variables crashed once; dropping each group in
  turn passed. With about 2 GB free it crashed every time.
- **So the release waits for memory**: before its tests it waits, saying so, until the computer has 3 GB free (up to
  20 minutes, then it stops with a clear message), and a test process that ran out of memory gets one more try once
  there is room again.

## Decision

- **The release, before anything long:**
  - it takes the heavy-run lock;
  - it reads the job it runs in (`scripts/job-headroom.mjs`, read only, by asking each Codehouse job whether it holds
    the process), and with less than 3 GB free there it stops, naming the level it needs. Today it runs outside a
    job, so nothing stops it;
  - it says how much memory the computer has free.
- **Its tests** run one file at a time with `--max-old-space-size=3072 --max-semi-space-size=4`, as every other run
  here does, each process stopped with everything it started if it hangs.
- **A full gate recorded as complete for exactly the commit** is accepted in place of those tests.
- **A release needs Medium (4 GB) or more** when it runs inside a session's job. Low (2 GB) is not enough.
- **Raising the level through an approval card: not built.** A session's tools run outside its job, so a raise
  changes nothing a release uses. Should Claude Code ever run tools inside the job, the preflight above would say so,
  naming the level, and the session's Details already change it.
- **The routes file** is found in this checkout, then in the main worktree (`git rev-parse --git-common-dir`), then
  beside the release key (`scripts/release-routes.ts`, used by the release and `update-route-e2e.ts`). It stays
  git-ignored and is never committed.
- **The gate is resumable.** On a clean tree, everything that passes (each type-check, the lint, each test file) is
  recorded for that exact commit (`scripts/gate-record.mjs`, in Gatehouse's data folder). A rerun carries on from
  there. `--budget-minutes <n>` stops the tests cleanly after n minutes (exit 3: run again). The tests' progress is
  shown as it goes.
- **One heavy run at a time** (`scripts/heavy-lock.mjs`): the full gate, a release, and any vitest run of the whole
  suite or with the browser checks (`scripts/vitest-heavy-lock.mjs`, vitest's global setup) take a lock across the
  computer.
  - Another waits its turn, saying who has the lock and since when.
  - What a holder starts inherits it.
  - A lock whose process is gone, or that is over six hours old, is taken over.
- **Leftovers** (`scripts/leftovers.mjs`): a test process that runs past its time (30 minutes, or 20 in a release) is
  stopped with everything it started. When a test run ends, our headless browsers whose run is gone are stopped, and
  profiles nothing uses are removed. Another run's browser is left alone.

## Consequences

- A release from a session needs no copying, waits rather than collides, and can rest on a gate that finished over
  several runs.
- Nothing about what a release checks was weakened: the same invariant tests run, or the full gate that includes
  them, for the same commit.
- Tests: `apps/host/test/release-self.test.ts`:
  - the lock: held, waited for with a message, inherited, and taken over when stale;
  - the gate record;
  - the time budget, and retries recorded;
  - the sweep, ours and orphaned only;
  - the headroom message naming the level;
  - the routes file found from a worktree.
