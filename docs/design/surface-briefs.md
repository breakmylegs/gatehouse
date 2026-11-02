# Surface briefs

Mode for every surface is Operate unless stated. Product truth is in `PRODUCT.md`. Requirements are in `docs/BUILD_SPEC.md` sections 13 and 14. Chosen without the owner present, so each decision is marked and can be revised.

## Visual world (decision)

A quiet instrument panel. The product is a place to make careful decisions, so the page is calm and the one thing that needs a decision is the strongest thing on it.

- **Type.** Segoe UI Variable for the interface and Cascadia Mono for every command, path and rule id. Both ship with Windows, so nothing loads from the network. Fallbacks: system-ui and ui-monospace on the phone. Sizes on a 1.2 scale from 13 px body, commands at 14 px.
- **Colour.** Cool neutral surfaces (OKLCH, low chroma) in light and dark. One accent, a deep blue, used only for focus rings, the selected item and the primary non-destructive action. Risk bands are four named steps (Low, Moderate, High, Severe). Each band has a label, a distinct shape icon and a colour, so colour is never the only signal.
- **Shape.** Square-ish 6 px radius, 1 px hairlines, almost no shadow. Depth comes from surface steps, not blur.
- **Motion.** 120 to 180 ms, opacity and transform only, ease-out. Nothing moves when the user is typing. Reduced motion removes all movement and keeps the state change.
- **Density.** Compact rows (32 px) with generous space around the single active decision.
- **Rejected.** Dark neon "security console", chat bubbles, gradients, glass, illustration. They say drama or chat, and the principles say calm and not a chat toy.

## 1. Approval card and queue

The most important surface. Queue on the left (grouped by session, oldest first, badge count in the title bar). The card fills the main area when selected and shows, top to bottom: header (project, session, risk badge with band label, age), the exact command or edit in a monospace block with the escalating segment marked by an underline and a "Why" marker (never colour alone), then Where, Why (rule id, plain reason, risk score), Status (phone notified at, phone expiry, desktop timeout), then actions. Long input collapses behind "Show all" after 12 lines, never truncated silently. Actions: Deny (left, always one key: Esc or D), Deny with message, Allow once (Ctrl+Enter, never initial focus when risk is 70 or above), Edit then allow, Stop session, Remember (shows the exact rule in a panel before it is created). Resolution replaces the actions with a single line such as "Approved on iPhone at 14:02". New escalations arrive by Sonner toast, queue badge and optional browser notification, never by moving focus.

## 2. Session workspace

Transcript (Virtuoso), tool cards with the real input and result, diffs (line diff with `diff`), todo list, subagent threads as collapsible indented groups, composer with slash command menu, model picker, a two-state mode toggle (default, plan), and an Interrupt button that is always visible while running. A pending approval for this session shows as a pinned strip above the composer that opens the card, without taking focus.

## 3. Sessions overview

A table, not cards: session, project, state (Running, Waiting on you, Idle, Error, each with an icon and word), pending count, last activity, usage today. Sort puts "Waiting on you" first. Handles 40 sessions without scrolling the page chrome away.

## 4. Policy studio

Rules list grouped by section with rule id, effect and match summary. "Test a command" box returns the live verdict with rule id and segments. Replay runs a draft against the audit log and lists decisions it would change. Remember rules have their own review list. Activation shows a diff of the YAML and needs an explicit confirm.

## 5. Audit log

Virtualised table with filters (decision, channel, rule id, project, time), text search, a detail panel for one decision, a chain status line ("Chain intact, 18,204 records" or the first broken record) and export.

## 6. Devices and pairing

Paired devices with name, paired date, last seen, revoke. Pairing shows a QR code and a short code, with the fingerprint to compare on the phone.

## 7. Settings

Plain labelled form in sections: Organisation and workspaces, Quiet hours and timeouts, Redaction list, Notifications. Each field has visible help text under it, no hover tooltips. Changes apply on Save and say what was saved.

## 8. First run

A short linear list of checks that tick as they pass: signed in, organisation matches, managed policy detected, workspace roots chosen, optional phone pairing. A failed check says what is wrong and the one next step.

## 9. Phone app

390 by 844, thumb first. Pending list, then request detail with the full command wrapped, risk band with label and icon, Deny as the large easy control at the bottom, Allow behind a hold-and-confirm with Face ID. Question answering, a kill switch behind a confirm, pairing onboarding and Add to Home Screen steps. Detail is decrypted on the phone only.
