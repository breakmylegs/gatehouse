# ADR 0002: Visual direction and type

Status: Proposed, 31 Oct 2026. Waiting for the owner.

## Context

`DESIGN.md` sets the "Departures" direction: a slate shell, signage yellow, Bahnschrift for labels and flight-style session codes. On 31 Oct the owner said the interface "feels very retro" and asked for it to feel more like Claude Code and Codex. The interface research recommends "Ledger": quiet, neutral and Windows-native, with a cool teal-ink accent.

Hard rule from the owner: do not copy Claude desktop or claude.ai. No warm cream backgrounds, no terracotta or orange accents, no serif display type, no radial marks, no Anthropic logos.

## What was checked

- Segoe UI Variable is installed as a system font on this laptop (`C:\Windows\Fonts\SegUIVar.ttf`). Microsoft does not license it for use outside its products, so JCVC uses it by name only and never ships it.
- Cascadia Code and Cascadia Mono are **not** installed here. They come with Windows Terminal, not with Windows. Today's code text falls back to Consolas. The paper assumed Cascadia was present.
- Cascadia Code is under the SIL Open Font Licence 1.1, which allows bundling.

## Proposed decision

- **Ledger**, mapped onto Fluent v9 tokens (ADR 0001): cool neutral greys, one teal-ink accent for focus, selection and the main action, and no other decoration colour.
- **Type:** Segoe UI Variable for everything you read and scan, with `system-ui` after it. Bahnschrift goes.
- **Code:** Cascadia Mono where installed, then Consolas. Bundling Cascadia Code (OFL) is left to the owner, because it adds about 400 KB.
- **Shell:** a light rail in the light theme and a dark one in the dark theme, softer radii, hairlines instead of boxes, and no drop shadows except on floating menus.
- **Signals:** risk keeps a shape, a word and a number (DESIGN.md's "Risk Is Never Colour Alone"). Yellow is no longer a brand colour. "Needs you" keeps an amber tint and a word.
- **Themes:** light, dark and Windows high contrast (`forced-colors`). Follow the system theme by default.
- **Density:** Comfortable and Compact, per session (owner, 31 Oct), with a text size choice.

## Conflicts for the owner

- `DESIGN.md` rejects "a grey sidebar, chat column and right panel clone of a chat client". Ledger and the owner's 31 Oct ask both move towards that layout. `DESIGN.md` needs rewriting once the owner chooses.
- The paper says the Jean-Claude name and likeness should appear only in About, the installer and the window title, and "never a photo". Today, by owner decision (CLAUDE.md invariant 16, 28 Oct), the full name is on the window, tray, header, installer and phone app, and a faint photo sits behind every screen. The owner also asked for more photos on 31 Oct. Not resolved here.
- Flight-style session codes ("FM 719") are part of Departures. Ledger would show a small coloured mark and the name. The codes are also in tests and on the phone.

## Constraint check

Fits. Teal is outside the orange family. No serif. No radial mark.

## Verification

An automated test reads the theme tokens and fails on any accent hue between 15 and 75 degrees (orange family), and on any text pair under WCAG AA contrast. A named manual check compares screenshots against claude.ai before release.
