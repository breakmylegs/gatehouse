---
name: Jean-Claude Van Code (JCVC)
description: A local permission workbench for Claude sessions, set like a departures board.
colors:
  shell-slate: "oklch(25.5% 0.028 254)"
  shell-slate-raised: "oklch(31% 0.032 254)"
  shell-line: "oklch(37% 0.034 254)"
  shell-text: "oklch(96.5% 0.006 250)"
  shell-muted: "oklch(78% 0.022 250)"
  ground: "oklch(97.2% 0.005 250)"
  surface: "oklch(100% 0 0)"
  surface-sunk: "oklch(95.2% 0.007 250)"
  hairline: "oklch(87.5% 0.011 250)"
  ink: "oklch(22% 0.022 255)"
  ink-muted: "oklch(45% 0.022 255)"
  gate-blue: "oklch(47% 0.15 258)"
  signage-yellow: "oklch(86.5% 0.165 94)"
  signage-ink: "oklch(21% 0.03 85)"
  lit-row: "oklch(96.5% 0.06 96)"
  segment-highlight: "oklch(93.5% 0.09 96)"
  risk-red: "oklch(46% 0.18 27)"
  ok-green: "oklch(42% 0.11 152)"
  caution: "oklch(46% 0.11 70)"
typography:
  display:
    fontFamily: "Bahnschrift, DIN Alternate, Segoe UI Variable Display, Segoe UI, sans-serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1.15
    fontVariation: "'wdth' 92"
  title:
    fontFamily: "Bahnschrift, DIN Alternate, Segoe UI, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.2
  board:
    fontFamily: "Bahnschrift, DIN Alternate, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.25
    fontFeature: "'tnum' 1"
  label:
    fontFamily: "Bahnschrift, DIN Alternate, Segoe UI, sans-serif"
    fontSize: "11.5px"
    fontWeight: 500
    lineHeight: 1.2
  body:
    fontFamily: "Segoe UI Variable Text, Segoe UI Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  code:
    fontFamily: "Cascadia Mono, Consolas, ui-monospace, monospace"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  chip: "3px"
  control: "4px"
  panel: "6px"
  pass: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "14px"
  lg: "20px"
  xl: "24px"
components:
  button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "4px 12px"
    height: "32px"
  button-primary:
    backgroundColor: "{colors.gate-blue}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "4px 12px"
    height: "32px"
  needs-you-pill:
    backgroundColor: "{colors.signage-yellow}"
    textColor: "{colors.signage-ink}"
    rounded: "{rounded.control}"
    height: "32px"
  board-time:
    backgroundColor: "{colors.surface-sunk}"
    textColor: "{colors.ink}"
    typography: "{typography.board}"
    rounded: "{rounded.chip}"
    height: "32px"
  board-time-lit:
    backgroundColor: "{colors.signage-yellow}"
    textColor: "{colors.signage-ink}"
    typography: "{typography.board}"
    rounded: "{rounded.chip}"
    height: "32px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
    height: "32px"
---

# Design System: Jean-Claude Van Code (JCVC)

## Overview

**Creative North Star: "Departures"**

JCVC is a permission workbench, and what needs you is a departures board. Requests waiting for a decision line up like departures, oldest first; a new one flips in and stays lit in signage yellow until you have looked at it. The request you open is a boarding pass: its details on the left, a perforated edge, and the decision stub on the right with Deny and Allow once.

The shell (header and rail) is committed slate in both themes, so the frame never changes and the work area carries the light. Colour does jobs: yellow means "needs you" and nothing else, gate blue means "you can act here", red means risk or error, green means healthy or low risk. Labels, numbers and headings are set in Bahnschrift, the DIN face that ships with Windows, with tabular figures; reading text stays in Segoe UI Variable and commands in Cascadia Mono.

Rejected on purpose: a grey sidebar, chat column and right panel clone of a chat client; imitating Claude Code or claude.ai; glass, gradients and glow.

**Key Characteristics:**

- Committed slate shell, cool white (or deep slate) work ground.
- Signage yellow reserved for what needs you.
- Every session has a flight-style code and a ribbon colour.
- Departure-board rows with a time cell; the approval card is a pass with a stub.
- One authored motion: a new request's time flips in.

## Colors

A restrained neutral system tinted toward blue slate, with two working signals and the risk scale.

### Primary

- **Gate Blue** (`oklch(47% 0.15 258)`, dark `oklch(75% 0.12 255)`): primary actions, focus rings, the selected row's outline, links. Never decoration.

### Secondary

- **Signage Yellow** (`oklch(86.5% 0.165 94)`) with **Signage Ink** (`oklch(21% 0.03 85)`) on it: the Needs you counter, the time cell of a lit row, the rail count, the "waiting on you" bar in the workspace, text selection, the skip link. Lit rows use the paler **Lit Row** (`oklch(96.5% 0.06 96)`, dark `oklch(29% 0.06 92)`).

### Neutral

- **Shell Slate** (`oklch(25.5% 0.028 254)`, dark `oklch(13.5% 0.02 254)`) with raised and line steps for hover and borders, and shell text and muted text on it.
- **Ground**, **Surface**, **Surface Sunk** and **Hairline** for the work area, **Ink** and **Ink Muted** for text.

### Named Rules

**The One Yellow Rule.** Signage yellow appears only where something needs you. If it is on screen and nothing is waiting, it is a bug.

**Risk Is Never Colour Alone.** Risk bands always carry a word, a number and a shape (circle, diamond, triangle, octagon); Severe is filled.

## Typography

**Display and labels:** Bahnschrift (DIN 1451 lineage, installed with Windows 10 and 11, variable width and weight), falling back to DIN Alternate and Segoe UI.
**Body:** Segoe UI Variable Text.
**Code:** Cascadia Mono.

**Character:** signage lettering for what you scan, a humanist sans for what you read, a true monospace for what will run.

### Hierarchy

- **Display** (600, 26px, width 92%): page titles (`h1`).
- **Title** (600, 22px): the request title on the pass.
- **Board** (600, 15px, tabular): board rows, the time cell, session names.
- **Label** (500, 11.5px): the small word above a value on the pass (Session, Waiting, Held by rule).
- **Body** (400, 14px, 1.5): explanations and help, about 70 characters per line.
- **Code** (400, 14px, 1.6): commands, paths, rule ids.

### Named Rules

**Sentence Case Everywhere.** No uppercase tracked labels; a label is a quiet word in Bahnschrift, never shouted.

## Layout

- Shell: a slate header across the top and a 200px slate rail on the left; under 900px the rail becomes a row of tabs.
- Approvals: a 360px board on the left, the pass on the right up to 1100px wide; under 1000px the board stacks above.
- Settings: a sheet, section names in a 220px left column and fields on the right, one hairline between sections; one column under 900px.
- Rhythm: 4, 8, 14, 20 and 24px. More space above a heading than below it.
- Desktop first: 1366 to 1920 wide, primary 1440 by 900; the window's minimum is 900 by 600.

## Elevation & Depth

Flat. Depth is tonal: ground, surface and sunk surface, plus the slate shell. There are no drop shadows. The selected board row carries a 1px inset outline in gate blue.

## Shapes

- 3px chips (time cells, counts), 4px controls (buttons, fields), 6px panels, 8px passes.
- The pass's stub is separated by a 2px dashed perforation with a half-round notch top and bottom.
- Ribbon squares (10px, 2px radius) mark a session's colour, always next to its code.

## Components

### Buttons

- **Shape:** 4px radius, 32px minimum height, Bahnschrift 500.
- **Neutral:** surface with a hairline border; hover goes to the sunk surface.
- **Primary:** gate blue fill, white text.
- **Strong:** gate blue outline (the non-default choice at high risk).
- **Deny (destructive confirm):** risk red outline; Deny itself is never red.
- **In the shell:** transparent with a shell-line border.

### Needs you pill

Slate when nothing waits, signage yellow when something does, with the count in a small inverse chip.

### Board row

A time cell (how long it has waited), the session code with its ribbon, the project, the request and its risk badge. Lit rows (not yet seen) take the lit-row ground and a yellow time cell that flips in on arrival. The selected row takes a light gate blue wash and a 1px inset outline.

### Approval pass

A sunk header band of labelled fields (Session, Waiting, Held by rule, risk badge), then the title, the command with the escalating segment highlighted, Where, Why and Status, then the perforated stub with the decision buttons.

### Session code

Two letters from the project and three digits from the session id ("AT 830"), with its ribbon colour. Shown on the board, the pass, the sessions table and the workspace header.

### Fields

4px radius, hairline border that darkens on hover, gate blue focus ring. Selects use Bahnschrift.

## Do's and Don'ts

### Do:

- **Do** keep signage yellow for what needs you, and only that.
- **Do** show a session's code wherever the session is named.
- **Do** set numbers with tabular figures so columns line up.
- **Do** keep risk as a word, a number and a shape.

### Don't:

- **Don't** imitate Claude Code or claude.ai, or use Anthropic logos.
- **Don't** add drop shadows, glass, gradients or glow.
- **Don't** use uppercase tracked labels, kickers above headings, or coloured side stripes.
- **Don't** add hover tooltips; explanations sit in visible text.
- **Don't** make Deny red; red means risk or error.
