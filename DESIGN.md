# Design

Recorded from the built desktop UI (`apps/web`). Product truth is in `PRODUCT.md`, surface briefs in `docs/design/surface-briefs.md`. Tokens live in `apps/web/src/styles.css`.

## Visual world

A quiet instrument panel. Calm surfaces, one accent, and the single thing that needs a decision is the strongest thing on the page. No gradients, glass, glow or illustration.

## Type

- UI: Segoe UI Variable, then Segoe UI, then system-ui. Code, commands, paths, rule ids: Cascadia Mono, then Consolas.
- Nothing loads from the network.
- Sizes: body 14px, metadata 13px, kbd 11px, section heading 14px (semibold), card and card-section titles 17px, page titles 22px. Commands render at 14px with 1.6 line height.
- Sentence case everywhere. No uppercase tracking labels.

## Colour

OKLCH tokens, light and dark, as CSS variables (`--c-*`) mapped into Tailwind colours (`bg`, `s1`, `s2`, `line`, `tx`, `mut`, `acc`, `acc-tx`, `hi`, `hi-line`, `sev`, `ok`, `warn`).

| Token | Light | Dark | Use |
|---|---|---|---|
| bg | 97% .005 250 | 19% .01 255 | page |
| s1 | 100% 0 0 | 23% .012 255 | panels, header, nav |
| s2 | 94.5% .007 250 | 27% .014 255 | command blocks, decision rail |
| tx / mut | 24% / 45% | 93% / 72% | text, secondary text |
| acc | 45% .15 255 | 72% .13 255 | focus ring, selected item, primary action, strong outline |
| sev | 42% .17 25 | 76% .13 25 | risk High and Severe, errors, the stop-session confirm |
| ok / warn | 40% .11 150 / 42% .10 70 | 78% .12 150 / 80% .10 85 | risk Low, Moderate, healthy status |

Rules:
- Risk is never colour alone. Every band is a word, a number and a distinct shape (circle, diamond, triangle, octagon). Severe is also filled.
- Deny is never red. Red means risk or error. The emphasised choice at risk 70 or above is Deny (filled), and Allow becomes an outline.
- Placeholder text uses the muted token for contrast.

## Shape, depth, motion

- 6px radius, 1px hairlines, no shadows. Depth is surface steps (bg, s1, s2).
- Motion is deliberately minimal: a 120ms background-colour fade on buttons, the counters (NumberFlow) and toasts (Sonner). No layout animation. Reduced motion removes animation and transition duration.

## Components

- **Approval card** (`components/ApprovalCard.tsx`): header with title, project, age and risk badge; command block with the escalating segment marked by a background and a 2px underline, collapsing past 12 lines or 1,500 characters behind Show all; Where, Rule, Why and Status rows; a decision rail with Deny and Allow once (chord Ctrl+Enter), then Deny with message, Edit then allow, Remember, then Stop session behind a confirm. The chord and Esc work only while focus is inside the card. Decisions pause while the Host is disconnected.
- **Queue** (`surfaces/Approvals.tsx`): virtualised, oldest first, each row with kind, project, age and the risk badge. Alt+Up and Alt+Down move without wrapping.
- **Risk badge** (`components/RiskBadge.tsx`): bands Low under 40, Moderate 40 to 69, High 70 to 84, Severe 85 and over.
- **Buttons**: `.btn` (neutral), `.btn-primary` (filled accent), `.btn-strong` (accent outline), `.btn-deny` (only for destructive confirms). 32px minimum height.
- **Status marks**: a shape plus words, never a dot alone. Failures use the triangle, information-only checks a ring.
- **Tables and lists**: Virtuoso for the transcript, queue and audit log. Compact 32px rows.
- **Dialogs**: none. Confirmations are inline (kill switch, stop session), so Esc and focus stay predictable.

## Layout

- Desktop first, 1366 to 1920 wide, tested at 1024 and 1440. Left nav 190px; queue 290px; card up to 1100px wide with a 250px decision rail that moves below the content under 1100px.
- Every page has a skip link, one `h1`, a labelled landmark per region, and keyboard operation throughout.

## Copy

Plain UK English, sentence case, no em dashes, no hover tooltips. Help sits in visible text under the control it explains. Errors say what happened, whether anything was sent, and what is still true (for example, that a request is still waiting).

## Not built yet

The phone app (Phase 6) reuses these tokens and the risk badge, with a fixed bottom decision area.
