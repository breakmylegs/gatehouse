# The interface remade from the Stitch design (owner, 1 Nov)

Owner: "Use this and remake the entire interface as a priority after you complete the current build item", "I want the full redesign based on stitch to be the next thing after the current build item".

Source: the Stitch export the owner attached (a zip), unpacked (read only, never run) to `C:\dev\.agentic-scratch\codehouse\stitch-1nov\`. 17 screens (picture and HTML) and two design notes: "Codehouse" (dark) and "Fluent Control Matrix" (light).

## What is taken from Stitch

- **Look:** obsidian and slate layers in dark (canvas #0B0E12, panes #12171E, cards #181F28, flyouts #202936, lines #2A3647), steel blue actions (#3A7BD5); the light theme from Fluent Control Matrix (canvas #F8FAFC, cards #FFFFFF, inset #F1F5F9, lines #E2E8F0, cobalt #1D4ED8). Radii 4 / 6 / 8, 2 for the kill switch. 1px lines, no soft shadows except flyouts.
- **Type:** dense UI at 13px body, monospace for ids, rules, commands, hashes, keys. Labels in small spaced capitals only for monospace telemetry (rule ids, states), sentence case everywhere else.
- **Risk:** a symbol, a word and a number, never colour alone: ◇ Low (0 to 39), △ Medium (40 to 69), ⬡ High (70 to 84), ■ Severe (85 to 100, solid tag and a 2px border). Same bands as today.
- **Keys on buttons:** each action shows its key in a chip (Allow once Ctrl+Enter, Deny Esc, Deny with message M, Edit then allow E, Stop session Shift+S). Single letters only while the card has focus, never from the composer.
- **Shell:** a 44px command deck across the top: the wordmark, the live session strip (flight code and state for each), the paired phone, and the kill switch (garnet with a hatch, Ctrl+Shift+K). Left navigation with counts (Dashboard with escalations, Audit log chain-verified). A footer with the keys for the page.
- **Dashboard:** "What needs your attention now" with the top escalation as a full card, live sessions as tiles (code, state, risk, spend, runtime), today's spend, the 5-hour limit, automatic vs asked decisions, and a live feed of automatic decisions.
- **Session workspace:** prompt header with turn count, mode segmented control with the Extreme switch and its limits, Stop and Force stop, Plan / Files / Changes / Terminal tabs, the transcript as a ledger of tool calls each with its decision line (rule, risk, who decided, time), the escalation inline in the transcript, a right inspector (changes, session risk and the phone), and the composer that keeps focus.
- **Approval card:** header with flight code, project, task, risk and state; the reason; the verbatim command with the flagged part marked; folder; Remember with its exact rule; the four states (auto-allowed, escalation, severe with Deny as the safe default and an interlock note, question with the recommended option marked).
- **Policy studio:** level cards (Strict, Balanced, Relaxed) over the rules list grouped by level, filter chips by kind, a rule inspector with what it denies and allows, the replay of past decisions with the change in numbers, recent firings. This is W1-17.
- **Audit and usage:** plan limit ring, spend by project, automatic vs asked share, tabs (all, escalated, phone, emergency), filters by channel and risk, a dense table, and the chain check for the chosen row.
- **Chat:** project bar with instructions and knowledge, messages, artifact card in the reply, artifact inspector with versions and compare, memory in use above the composer.
- **First run:** four steps in a row at the top (sign in, organisation, workspace, pair the iPhone).
- **Kill switch dialog:** what each session is doing and what stopping does to it, Esc to cancel.
- **Phone:** pending list, decision card, transcript with Interrupt.

## What is not taken (invariants, honesty, the laptop)

- Nothing from the internet: no Tailwind CDN, Google fonts, Material Symbols or hosted logo. Our own CSS and components, Segoe UI Variable and Cascadia Mono (no bundled font, owner's choice). Icons drawn as inline SVG.
- Phone: no Save rule, no Edit on Mac, no "dual-key" or "secure enclave" claims (invariant 11). Allow, Deny, Deny with a message, answer, kill switch, transcripts and Interrupt only.
- Kill switch: no revoking credentials, no git reset --hard, no typed phrase that slows an emergency; it keeps today's behaviour (stops every turn and background task, denies everything until re-armed).
- No invented data: no Merkle proofs, Ed25519 stamps, latency figures, cluster names, "Claude 3.5", throughput. Only what the Host knows: the real hash chain check, real models, real spend and limits.
- Single-letter keys never act from a text box (focus rule).
- Every current behaviour and test stays: the transcript, copy, artifacts, projects, memory, Extreme carry-on, resources, accounts, help, palette, rail order, high contrast.

## Slices (one branch each, pushed when done, gate each)

- R1 tokens and type: the Stitch palettes as the Ledger tokens' values (dark and light), radii, risk symbols in RiskBadge, key chips. High contrast stays.
- R2 shell: command deck (session strip, phone, kill switch), left navigation with counts, page footer with keys; Mica (W1-06) on the deck and navigation where Windows gives it.
- R3 approval card in its four states, and the Approvals page.
- R4 dashboard.
- R5 session workspace: header, tabs, ledger transcript, inline escalation, inspector, composer.
- R6 policy studio with level cards and replay (W1-17).
- R7 audit log and usage.
- R8 chat, projects, memory and artifacts.
- R9 first run, devices, settings, kill switch dialog.
- R10 phone app.
- R11 performance and accessibility pass across all of it (W1-18): AA in both themes, keyboard, reduced motion, 1366 to 1920 wide, impeccable detect.
