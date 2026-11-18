---
name: Codehouse Neighbourhood Watch
description: The watch board for every Codehouse you run, set as Codehouse's departures board for a phone.
inherits: ../../DESIGN.md
colors:
  shell: "oklch(25.5% 0.028 254)"
  shell-dark: "oklch(13.5% 0.02 254)"
  shell-raised: "oklch(31% 0.032 254)"
  shell-line: "oklch(37% 0.034 254)"
  shell-text: "oklch(96.5% 0.006 250)"
  shell-muted: "oklch(78% 0.022 250)"
  ground: "oklch(97.2% 0.005 250)"
  ground-dark: "oklch(17% 0.02 254)"
  surface: "oklch(100% 0 0)"
  surface-dark: "oklch(21.5% 0.024 254)"
  sunk: "oklch(95.2% 0.007 250)"
  sunk-dark: "oklch(19% 0.022 254)"
  hairline: "oklch(87.5% 0.011 250)"
  hairline-dark: "oklch(32% 0.03 254)"
  ink: "oklch(22% 0.022 255)"
  ink-dark: "oklch(95% 0.008 250)"
  ink-muted: "oklch(45% 0.022 255)"
  ink-muted-dark: "oklch(76% 0.022 250)"
  teal-ink: "oklch(46% 0.09 200)"
  teal-ink-dark: "oklch(78% 0.09 195)"
  signage-yellow: "oklch(86.5% 0.165 94)"
  signage-ink: "oklch(21% 0.03 85)"
  lit-row: "oklch(96.5% 0.06 96)"
  lit-row-dark: "oklch(29% 0.06 92)"
  risk-red: "oklch(46% 0.18 27)"
  risk-red-dark: "oklch(72% 0.15 25)"
  ok-green: "oklch(42% 0.11 152)"
  ok-green-dark: "oklch(76% 0.12 152)"
  caution: "oklch(46% 0.11 70)"
  caution-dark: "oklch(80% 0.12 75)"
  scrim: "oklch(0% 0 0 / 0.4)"
typography:
  display:
    fontFamily: "Segoe UI Variable Display, -apple-system, BlinkMacSystemFont, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.15
  board:
    fontFamily: "Segoe UI Variable Display, -apple-system, BlinkMacSystemFont, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.25
    fontFeature: "'tnum' 1"
  label:
    fontFamily: "Segoe UI Variable Text, -apple-system, BlinkMacSystemFont, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.2
  body:
    fontFamily: "Segoe UI Variable Text, -apple-system, BlinkMacSystemFont, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  code:
    fontFamily: "Cascadia Mono, SF Mono, ui-monospace, Menlo, Consolas, monospace"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  chip: "3px"
  control: "6px"
  panel: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "14px"
  lg: "20px"
  xl: "28px"
components:
  button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "44px"
  button-primary:
    backgroundColor: "{colors.teal-ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    height: "44px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "44px"
  needs-you:
    backgroundColor: "{colors.signage-yellow}"
    textColor: "{colors.signage-ink}"
    rounded: "{rounded.control}"
    height: "44px"
  board-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.board}"
    height: "64px"
---

# Design system: Codehouse Neighbourhood Watch

CNW's own pages (sign-in, the board of computers, the inbox, settings, the server) in `apps/cnw/public`. Once a
computer is open, CNW shows the Codehouse interface, which follows the root `DESIGN.md`. These pages must sit next to it
without a seam: the same world, set for a phone first.

## Overview

**Creative north star: "The watch board".** Codehouse's departures board, taken outside to the gatehouse. Each paired
computer is a row on the board, and what needs you lights it up in signage yellow, as a request does in Codehouse. The
inbox is the same board across every computer, oldest first. The server's own pages are the gatehouse office behind
the board: quieter, ruled sheets of settings, every change saying what it will break before it does.

What replaces today's look: the amber accent, the grey panel cards and the one-page layout are retired. CNW uses
Codehouse's tokens (the root `DESIGN.md`, ledger update of 31 Oct: teal-ink, Segoe UI Variable, slate shell), so a
person moving from CNW into a computer's interface sees one product.

Mode: **Operate** on every page. Precision and restraint; patterns a phone user already knows (a bottom tab bar, a
list that opens a detail, a sheet that slides up) earn their place.

Rejected on purpose: a generic admin dashboard (sidebar of icons, stat cards, charts for their own sake); glass,
gradients and glow; neon as interface colour (the neon belongs to the artwork, never the controls); imitating Claude
Code or claude.ai.

## Colours

The root system, with explicit dark values because CNW follows the device's theme (`prefers-color-scheme`) and has no
window to take it from.

- **Shell** (slate in light, deeper slate in dark): the top bar and, on a phone, the bottom tab bar. The frame never
  changes; the work area carries the light.
- **Teal-ink** (the root token called gate-blue): primary actions, links, focus rings, the selected row. Never
  decoration.
- **Signage yellow** with signage ink on it: what needs you, and nothing else. The Needs you count in the shell, the time
  cell of a waiting approval, a lit computer row. **The One Yellow Rule** holds: yellow with nothing waiting is a bug.
- **Risk red**: risk, errors and destructive confirmations. Deny is never red.
- **Ok green**: a computer online, a check passed. Caution amber: out of date, a warning that needs reading.
- **The artwork**: the roadhouse picture sits very faintly behind the sign-in page only (opacity 0.08 light, 0.11 dark,
  never clickable). The board and settings have no picture behind them: on a phone it costs contrast.

**State is never colour alone.** Online and offline carry a word and a shape (filled or hollow circle); risk carries a
word, a number and a shape, as in Codehouse.

## Typography

System faces only, never bundled: Segoe UI Variable where it exists, the Apple system face on an iPhone or a Mac,
`system-ui` elsewhere; Cascadia Mono, SF Mono or the system monospace for commands, codes and fingerprints.

- **Display** (600, 24px): the page title, once per page.
- **Board** (600, 16px, tabular figures): computer names, counts, times on the board and the inbox.
- **Label** (500, 13px): the quiet word above a value. Sentence case, never uppercase or tracked.
- **Body** (400, 16px, 1.5): everything you read. 16px so an iPhone never zooms into a field.
- **Code** (400, 15px): pairing codes, certificate fingerprints, addresses, versions.

## Layout

- **Phone first** (360 to 430 wide): one column; a shell bar on top with the Needs you count and the account; a bottom
  tab bar (Board, Inbox, Server, You) clear of the home indicator (`env(safe-area-inset-bottom)`).
- **Tablet and desktop** (from 760): the tab bar becomes a slim rail on the left; the board and its detail sit side by
  side from 1100.
- **Settings** are sheets: section names, then fields, one hairline between sections; on a phone each section opens on
  its own page with a back control.
- Rhythm: 4, 8, 14, 20 and 28px. More space above a heading than below it. Content width at most 1100px.

## Elevation and depth

Flat and tonal, as in Codehouse: ground, surface and sunk surface, plus the shell. No drop shadows. A sheet on a phone
is separated by the shell's line and a 40% scrim, not a shadow.

## Components

- **Buttons**: 44px tall (thumb size), 6px radius. Neutral (surface, hairline border), primary (teal-ink fill),
  strong (teal-ink outline, the non-default choice at high risk), destructive confirm (risk red outline).
- **Fields**: 44px, 16px text, hairline border, teal-ink focus ring; the label above in Label type; the explanation
  below in muted body text, never a tooltip.
- **Board row** (a computer): a status shape and word, the name, what waits (a yellow time cell with the count when
  something does), sessions working, the Codehouse version (caution when out of date), last seen. The whole row opens
  the computer.
- **Inbox row** (an approval): the time it has waited, the computer and session, the request, its risk badge. Opening
  it shows the pass, as in Codehouse; Severe asks you to sign in again before Allow.
- **Banner**: one line across the top of the work area for what the whole server needs (needs updating, a refused
  certificate, push not possible), with its fix as a button. Never more than one; the rest wait in Server, Health.
- **Danger notice**: before a change that breaks something (a new certificate unpairs every computer), a sheet that
  says what breaks, in plain words, with the confirm button in risk red outline and Cancel as the default.
- **Toast**: bottom of the screen above the tab bar, one at a time, for what happened elsewhere (an approval answered
  on another device). Announced politely to screen readers; never the only record.

## Motion

One authored motion, as in Codehouse: a newly waiting approval's time cell flips in. Sheets slide up in 200ms
(ease-out). Everything else changes at once. With reduced motion, nothing moves.

## Do and don't

- **Do** keep yellow for what needs you, and only that.
- **Do** say what a change breaks before it breaks it, and which computer's rule decides an action.
- **Do** set numbers in tabular figures, and fingerprints and codes in the monospace.
- **Don't** use stat cards, charts or icons as decoration.
- **Don't** add drop shadows, glass, gradients or glow, or use neon as an interface colour.
- **Don't** hide an explanation in a tooltip.
- **Don't** make Deny red.
