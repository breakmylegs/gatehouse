# 0021: Slow down fast approvals is a setting, off by default (O57)

Status: accepted, 26 Nov 2026 (owner).

## Context

D-021 (Frontier build) watches for approvals given faster than anyone could read them. After three High or Severe
approvals in a row, each within 800 ms of the card appearing, or ten approvals in a row from the queue's rows without
the card opened, the next High approval was refused with "You approved several requests faster than they could be
read..." and could be given again only as a deliberate second approval after two seconds. U4 also held Allow on a High
card for a second after it appeared.

The owner, 26 Nov: "I don't want the 'You approved several requests faster than they could be read… Allow works again
in two seconds' slow-down." He asked for it as a setting, "Slow down fast approvals", switched off for him, and for
everything else to stay as it is.

## Decision

- A setting, **Slow down fast approvals** (`slowFastApprovals` in Gatehouse's settings), in Settings, Safety. It is
  off unless it is `true`, so it is off for the owner and for any copy that never set it. It applies at once, without a
  restart.
- **On**, D-021 and U4 work as before.
- **Off**, the Host never refuses an approval for its speed and never asks for a deliberate second one, whichever way it
  came: the full card, a row of the queue, a notification's button, the phone or Neighbourhood Watch. The card's
  one-second hold on Allow at High risk goes with it. No friction message is shown anywhere, because the Host never
  sends one.
- **Fast approvals are still recorded.** The detector keeps counting whatever the setting. Off, each run it finds is
  written to the audit log as `approval_fast_run` (rule `rubber-stamp`, with the risk, how long the card was shown and
  whether it was opened), and counting starts again. The history D-021 kept is still there to read.
- **Nothing else changes.** A Severe request still needs allow typed on a computer, and from Neighbourhood Watch a
  signed-in session (a passkey or a recent sign-in for what needs one). Allowing High or Severe by keyboard still takes
  two presses (D-092), which guards against a stray key, not against speed. Floor denies stay denies. A prompt Ask
  about code offers into a session still always asks. Extreme approval, the kill switch and every invariant are as they
  were.

## Options considered

- **On by default, the owner switches it off.** Safer for a new copy, but the owner asked for it to be off for him,
  and a Host's settings file is not something to write from outside the app. Only the two owners use Codehouse now;
  the other can switch it on in a click.
- **Remove D-021.** Loses the audit history and the choice; the owner asked for a setting.
- **Keep the U4 hold when the setting is off.** The owner asked that approvals "never make me wait"; the hold is a wait.
  Severe's typed allow is a different control (reading what will run) and stays.

## Consequences

- Rubber-stamping is no longer slowed unless the setting is on. The audit log still shows each fast run, so it can be
  seen afterwards. Threat model T172 records this.
- Tests: `apps/host/test/server.test.ts` covers the Host on and off (on: refused, then the deliberate approval after
  two seconds, Severe typed allow at once; off: seven fast High approvals all go through, two runs recorded, no
  friction). `apps/web/test/approval-card.test.tsx` covers the card's hold on and off, and Severe asking to type allow
  either way. `apps/web/test/settings-search.test.tsx` lists the Safety section.
