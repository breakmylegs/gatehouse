---
name: Codehouse on a Mac (Standard macOS)
description: The Mac-only layer over upstream's design system, so Codehouse reads as an app that came with the Mac.
colors:
  # Light (:root[data-platform="mac"])
  ground: "#ffffff"
  surface: "#ffffff"
  grouped-fill: "#f5f5f7"
  line: "#e1e1e5"
  ink: "#1d1d1f"
  ink-muted: "#6e6e73"
  teal-ink: "#0d6c76"
  on-teal: "#ffffff"
  hi: "#fff1d6"
  hi-line: "#a8650a"
  risk-red: "#c4261d"
  healthy-green: "#1f7a3a"
  warn: "#955800"
  needs-you-amber: "#ffb347"
  on-amber: "#2b1700"
  lit: "#fff7e8"
  shell: "#f5f5f7"
  shell-2: "#e9e9ed"
  shell-line: "#dcdce1"
  shell-ink: "#1d1d1f"
  shell-ink-muted: "#6e6e73"
  mac-glass: "color-mix(in srgb, #f6f6f8 70%, transparent)"
  mac-rim: "rgb(255 255 255 / 0.85)"
  mac-fill: "color-mix(in srgb, #1d1d1f 6%, transparent)"
  mac-fill-2: "color-mix(in srgb, #1d1d1f 10%, transparent)"
  mac-hair: "color-mix(in srgb, #1d1d1f 11%, transparent)"
  # Dark (:root[data-platform="mac"][data-theme="dark"])
  ground-dark: "#1e1e20"
  surface-dark: "#252528"
  grouped-fill-dark: "#2c2c30"
  line-dark: "#3a3a40"
  ink-dark: "#f5f5f7"
  ink-muted-dark: "#a1a1a8"
  teal-ink-dark: "#4ff0e0"
  on-teal-dark: "#062a2a"
  hi-dark: "#3a2c10"
  hi-line-dark: "#ffcf80"
  risk-red-dark: "#ff8a80"
  healthy-green-dark: "#8fd9a0"
  warn-dark: "#ffcf80"
  needs-you-amber-dark: "#ffb347"
  on-amber-dark: "#2b1700"
  lit-dark: "#2a2519"
  shell-dark: "#2a2a2d"
  shell-2-dark: "#36363b"
  shell-line-dark: "#404046"
  shell-ink-dark: "#f5f5f7"
  shell-ink-muted-dark: "#a1a1a8"
  mac-glass-dark: "color-mix(in srgb, #2c2c31 62%, transparent)"
  mac-rim-dark: "rgb(255 255 255 / 0.14)"
  mac-fill-dark: "color-mix(in srgb, #f5f5f7 6%, transparent)"
  mac-fill-2-dark: "color-mix(in srgb, #f5f5f7 10%, transparent)"
  mac-hair-dark: "color-mix(in srgb, #f5f5f7 11%, transparent)"
  # Increase contrast (prefers-contrast: more)
  line-contrast: "#8e8e93"
  ink-muted-contrast: "#48484d"
  ink-muted-contrast-dark: "#d1d1d6"
typography:
  wordmark:
    fontFamily: "system-ui (SF Pro on a Mac)"
    fontSize: "15px"
    fontWeight: 700
    letterSpacing: "0"
  section-title:
    fontFamily: "system-ui (SF Pro on a Mac)"
    fontSize: "15px"
    fontWeight: 700
  body:
    fontFamily: "system-ui (SF Pro on a Mac)"
    fontSize: "13px"
    fontWeight: 400
  control:
    fontFamily: "system-ui (SF Pro on a Mac)"
    fontSize: "13px"
    fontWeight: 500
  capsule:
    fontFamily: "system-ui (SF Pro on a Mac)"
    fontSize: "12.5px"
    fontWeight: 500
  risk:
    fontFamily: "system-ui (SF Pro on a Mac)"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0"
  state:
    fontFamily: "system-ui (SF Pro on a Mac)"
    fontSize: "11.5px"
    fontWeight: 600
    lineHeight: 1.5
  sidebar-heading:
    fontFamily: "system-ui (SF Pro on a Mac)"
    fontSize: "11px"
    fontWeight: 700
    letterSpacing: "0"
  key:
    fontFamily: "system-ui (SF Pro on a Mac)"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.5
  command:
    fontFamily: "ui-monospace (SF Mono on a Mac)"
    fontSize: "13px"
    fontWeight: 500
rounded:
  mark: "4px"
  key: "5px"
  menu-item: "6px"
  row: "7px"
  control: "8px"
  segmented: "9px"
  list-row: "10px"
  group: "12px"
  sheet: "14px"
  capsule: "999px"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  group-inset: "14px"
  pane: "20px"
components:
  button:
    backgroundColor: "{colors.mac-fill}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "3px 12px"
    height: "28px"
  button-hover:
    backgroundColor: "{colors.mac-fill-2}"
  button-primary:
    backgroundColor: "{colors.teal-ink}"
    textColor: "{colors.on-teal}"
    rounded: "{rounded.control}"
    padding: "3px 12px"
    height: "28px"
  button-strong:
    backgroundColor: "transparent"
    textColor: "{colors.teal-ink}"
    rounded: "{rounded.control}"
    padding: "3px 12px"
    height: "28px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.row}"
    padding: "3px 8px"
    height: "28px"
  toolbar-capsule:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.capsule}"
    rounded: "{rounded.capsule}"
    padding: "2px 10px"
    height: "28px"
  stop-everything:
    textColor: "{colors.risk-red}"
    rounded: "{rounded.capsule}"
    padding: "2px 12px"
    height: "28px"
  sidebar-item:
    textColor: "{colors.shell-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.row}"
    padding: "4px 8px"
    height: "28px"
  sidebar-item-current:
    backgroundColor: "{colors.mac-fill-2}"
  needs-you-pill-on:
    backgroundColor: "{colors.needs-you-amber}"
    textColor: "{colors.on-amber}"
    rounded: "{rounded.control}"
    height: "30px"
  segmented-control:
    backgroundColor: "{colors.mac-fill}"
    rounded: "{rounded.segmented}"
    padding: "2px"
  segmented-option-on:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.row}"
    height: "26px"
  list-row:
    rounded: "{rounded.list-row}"
  waiting-time-lit:
    backgroundColor: "{colors.needs-you-amber}"
    textColor: "{colors.on-amber}"
    rounded: "{rounded.row}"
    width: "48px"
    height: "28px"
  grouped-rows:
    backgroundColor: "{colors.grouped-fill}"
    rounded: "{rounded.group}"
    padding: "0 14px"
  decision-bar:
    backgroundColor: "{colors.grouped-fill}"
    rounded: "{rounded.group}"
    padding: "12px 14px"
  tab-selected:
    backgroundColor: "{colors.mac-fill-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "4px 12px"
  menu:
    backgroundColor: "color-mix(in srgb, {colors.surface} 78%, transparent)"
    rounded: "{rounded.group}"
    padding: "5px"
  menu-item-highlight:
    backgroundColor: "{colors.teal-ink}"
    textColor: "{colors.on-teal}"
    rounded: "{rounded.menu-item}"
    padding: "3px 9px"
    height: "24px"
  risk-capsule:
    typography: "{typography.risk}"
    rounded: "{rounded.capsule}"
    padding: "1px 8px 1px 7px"
---

# Design System: Codehouse on a Mac (Standard macOS)

## Overview

**Creative North Star: "Standard macOS"**

This layer applies only on a Mac. Everything in it sits under `:root[data-platform="mac"]` in `apps/web/src/mac-standard.css`, loaded after upstream's `styles.css`, which it re-sets without editing. Upstream's `DESIGN.md` governs Windows and remains the source of the product's design meanings; this file records how those meanings are drawn on a Mac. It lives beside upstream's file, not inside it, because this repository is a fork that merges upstream often and upstream's system forbids the glass the Mac layer uses.

Codehouse on a Mac should look like an app that came with the Mac: Mail's sidebar, list and detail; System Settings' grouped sections; glass only where macOS 26 puts it. It sets aside both upstream's control-room chrome (hard 4px boxes, a striped kill switch, mono labels in capitals) and a costume of glass over everything. The density is the Mac's own: 13px body, 28px controls, hairlines, rounded rectangles.

The meanings stay upstream's. Amber appears only for what needs you. Red is for risk and errors, green for healthy. One accent, teal ink, marks what you can act on. Risk is always a word, a number and a shape, never colour alone.

**Key Characteristics:**
- Light or dark following macOS, on plain white or graphite content.
- A translucent sidebar floating inside the window; in Codehouse.app it shows the Mac's own sidebar material.
- A toolbar of capsules, with a red-tinted Stop everything capsule.
- The request read as a Settings pane: the command, grouped rows, the decision bar.
- Teal ink as the single accent; amber reserved for Needs you and new waiting times.
- Mac key names (⌘, ⌥, ⇧, ↩) wherever a shortcut is shown.

## Colors

A neutral Apple-grey palette with one teal accent, keeping upstream's amber and red jobs.

### Primary
- **Teal ink** (`teal-ink`, `teal-ink-dark`): primary buttons, the menu highlight (with the label inverted to `on-teal`), sidebar symbols, the selected list row's tint (14% over the surface, with a 40% teal outline), focus rings and text selection (28%). The only accent on screen.

### Signal colours (upstream's meanings)
- **Needs you amber** (`needs-you-amber`, same in both themes): the Needs you pill when something waits, the waiting time on a newly arrived request, and (at 40%) the highlight on the part of a command that caused the escalation. Text on it is `on-amber`.
- **Risk red** (`risk-red`, `risk-red-dark`): risk badges, the Stop everything capsule (13% tint, 55% inset ring), the High risk callout (10% tint), the Severe frame and Deny with message.
- **Healthy green** (`healthy-green`, `healthy-green-dark`) and **warn** (`warn`, `warn-dark`): status dots and moderate states, as upstream assigns them.
- **Hi** and **lit** (`hi`, `hi-line`, `lit` and dark pairs): upstream's highlight and lit-row grounds, retuned to the Mac palette.

### Neutral
- **Ground and surface** (`ground`, `surface`; dark `#1e1e20`, `#252528`): the content area and controls. Content is opaque.
- **Grouped fill** (`grouped-fill`): the inset ground of grouped rows, the command block and the decision bar.
- **Line** (`line`): 1px separators under the toolbar, the request heading and Settings sections; field strokes.
- **Ink and muted ink** (`ink`, `ink-muted`): text and secondary text.
- **Shell family** (`shell`, `shell-2`, `shell-line`, `shell-ink`, `shell-ink-muted`): the sidebar's opaque fallback and its text.
- **Mac fills and hairline** (`mac-fill` 6%, `mac-fill-2` 10%, `mac-hair` 11%, all of the ink colour): hover, selected and resting fills on buttons, tabs, sidebar items and keys; 0.5px hairlines between rows. Because they are mixed from ink they follow the theme without separate values.
- **Glass and rim** (`mac-glass`, `mac-rim`): the sidebar's frosted ground in a browser and the 0.5px light top edge on glass panes.
- **Desk** (`--mac-desk`, light `linear-gradient(165deg, #dfe6f0 0%, #ece7ef 55%, #f2ebe1 100%)`, dark `linear-gradient(165deg, #1b2333 0%, #2a2033 55%, #2d241d 100%)`): a stand-in for the desktop behind the sidebar in a browser only, so the glass has something to be glass over. Never used as a content ground.

### Named Rules
**The One Ink Rule.** Teal is the only accent. Sidebar symbols, primary buttons, the menu highlight, selection and focus all use it; no second accent appears.

**The One Yellow Rule (upstream's, kept).** Amber appears only where something needs you. If it is on screen and nothing is waiting, it is a bug.

## Typography

**Body Font:** the system face (`system-ui`, which is SF Pro on a Mac; upstream's Segoe names fall through to it)
**Command Font:** the system monospace (`ui-monospace`, SF Mono on a Mac), for commands and paths only

**Character:** the Mac's own type at the Mac's own sizes. Weight carries hierarchy; nothing is set in capitals or letter-spaced.

### Hierarchy
- **Headings** (700): `h1`, `h2`, `h3`, legends and the request title are bold. Settings section legends are 15px.
- **Wordmark** (700, 15px, no letter-spacing): Codehouse in the toolbar.
- **Body** (400, 13px): the page's base size, fields, menu items, sidebar items, notices.
- **Controls** (500, 13px; 600 for primary, strong, selected tab and Stop everything): buttons, tabs.
- **Capsules and segments** (500, 12.5px): toolbar session capsules, the segmented control.
- **Risk and state** (600, 12px and 11.5px, line height 1.5): the risk badge and the request's state capsule.
- **Small labels** (500 11.5px list column heads; 600 11px command block head; 700 11px sidebar section names; 500 11px Powered by Claude and keys).

### Named Rules
**The Sentence Case Rule.** Sidebar section names are small and bold in sentence case, as macOS sets them; the Mac layer turns upstream's capitals and tracking off.

**The Mac Keys Rule.** Shortcuts show as a Mac names them, modifiers in Apple's order (⌥ ⇧ ⌘; Ctrl shows as ⌘ because every Ctrl shortcut also answers to Command) and then the key (↩, ↑, ↓): "Ctrl Shift A" reads ⇧⌘A. Keys sit in 5px rounded caps on `mac-fill`, in the system face, not mono.

## Layout

Mail's three columns. The sidebar floats inside the window with an 8px margin on its top, bottom and left; the list of requests sits beside it; the request pane fills the rest, its content held to 1100px. The toolbar is at least 44px tall (padding 4px 10px 4px 16px, 10px gaps) on the page's own ground with a 1px line beneath.

In the request pane the heading, the High risk callout and the decision bar keep a 20px inset from the pane's sides; grouped rows have 14px side padding and 9px row padding, with a 12px gap before each value. List rows inset 6px from the column's sides with 2px between them.

The decision bar is a container. Deny, the other decisions and Allow once sit on one row, Allow once at its end; Remember and Stop session wrap to a second row of their own, so Allow once is never pushed beneath the others. Below 980px of bar width the secondary buttons drop their key hints first (the keys still work); Deny and Allow once keep theirs.

In Codehouse.app the title bar is its own band coloured as the page (`ground`), above the toolbar, so the two read as one (see Known gaps).

## Elevation & Depth

Content is flat and opaque; depth comes from material, not from shadow. Glass is used in exactly three places, as macOS 26 uses it: the sidebar, menus and popovers, and passing notices. Each glass pane blurs what is behind it (`blur(30px) saturate(1.8)`), carries a 0.5px light rim on its top edge (`mac-rim`) and a 0.5px hairline. In Codehouse.app the main window puts the Mac's own sidebar material (`NSVisualEffectView`, material `.sidebar`, behind the window, following the window's active state) behind a transparent page, so the sidebar column shows the blurred desktop through a 40% shell tint and the page's own blur is switched off. Session windows and the quick prompt paint as in a browser.

### Shadow Vocabulary
- **Float** (`--mac-shadow`: `0 10px 36px rgb(0 0 0 / 0.12), 0 1px 3px rgb(0 0 0 / 0.08)`; dark `0.45` and `0.3`): menus, notices and dialog sheets.
- **Sidebar lift** (`0 4px 18px rgb(0 0 0 / 0.08)` with the rim and an inset hairline): the floating sidebar.
- **Capsule rest** (`0 0 0 0.5px` hairline, `0 1px 2px rgb(0 0 0 / 0.08)`): toolbar session capsules.
- **Segment lift** (`0 0.5px 0 rgb(255 255 255 / 0.4) inset, 0 1px 3px rgb(0 0 0 / 0.14)`): the chosen option of the segmented control.
- **Hairline edges** (`inset 0 0 0 0.5px` of `mac-hair` on buttons; `0 -1px 0` of `mac-hair` between list rows and grouped rows; `inset 0 0 0 1px` of `line` on panels): structure without boxes.

### Named Rules
**The Three Glasses Rule.** Glass belongs to the sidebar, menus and notices. Content, lists, the request pane, dialogs and the toolbar are opaque.

**The Frame Means Severe Rule.** In the request pane only Severe keeps a frame (14px radius, 2px red outline offset 2px, and a 1px red ring). Any other risk reads with no frame, so a frame always means Severe.

## Shapes

Rounded rectangles that grow with their container: 4px on the command highlight, 5px on keys, 6px on menu items, 7px on sidebar items, fields, sidebar icons, waiting times and segments, 8px on buttons, tabs, the Needs you pill and the profile, 9px on the segmented control's track, 10px on list rows, command text and the High risk callout, 12px on grouped rows, the command block, the decision bar, panels and menus, 14px on the sidebar, dialogs and notices. Capsules (999px) are for the toolbar (session capsules, buttons in the toolbar, Stop everything, Powered by Claude), counts, risk badges and state. Edges are 0.5px hairlines or 1px lines; no stripes and no hard boxes.

## Components

### Toolbar capsules
Quiet and native. Each live session is a 28px capsule on `surface` (`grouped-fill` in dark) with a hairline ring and a faint drop; hover mixes 4% ink in. Buttons in the toolbar become capsules. Powered by Claude is a small 11px capsule on `mac-fill`.

### Stop everything
Unmistakable without stripes: a 28px red capsule, 13% red over the ground with a 55% red inset ring, red 600 13px label, its power mark and its key (⇧⌘K) on a 16% red cap. Hover deepens the tint to 20%.

### Sidebar
A floating 14px pane of glass (see Elevation & Depth). Items are 28px, 7px rounded, 13px; symbols take teal; hover is `mac-fill`, the current page `mac-fill-2` at 600 weight. Section names follow the Sentence Case Rule.

### Needs you pill
30px, 8px rounded, 600 13px. At rest it sits on `mac-fill` with its count in a `mac-fill-2` capsule. When something waits it turns amber (`needs-you-amber` on `on-amber`) and the count inverts to an amber number in a dark capsule.

### Segmented control
Ask about code or Code, as the Mac's segmented control: a 9px track on `mac-fill` with 2px padding; options 26px, 7px rounded, 500 12.5px; the chosen option lifts on `surface` at 600.

### List rows
Waiting on you as Mail's list: rows 10px rounded, inset 6px, divided by a hairline. Hover is `mac-fill`; the current row is tinted teal (14%) with a 40% teal outline. The waiting time is a 48 by 28px, 7px rounded block in 600 13px on `mac-fill`; on a new request it turns amber and fades in over 160ms. Column heads are 500 11.5px with no rule beneath.

### The request pane
Read as a System Settings page, not a card: no frame, no fill (except Severe, see the Frame Means Severe Rule). The heading sits 20px in with a 1px line beneath; its state is a 600 11.5px capsule. The High risk note is a 10px rounded callout inside the pane (10% red, 600 weight), not a band across it, and its square icon is hidden because the badge carries the shape. The command block is a 12px rounded group on `grouped-fill` with a 600 11px head and a hairline above its foot. Where, Why and Status are grouped rows: a 12px rounded group on `grouped-fill`, 14px side padding, 9px rows divided by hairlines.

### Decision bar
A 12px rounded group on `grouped-fill`, 20px from the pane's sides and foot, padding 12px 14px. Layout as in Layout. At High risk and above Deny is the filled primary with the focus and Allow once is the outlined deliberate choice; below that Allow once is filled.

### Buttons
- **Shape:** 8px rounded, at least 28px tall, padding 3px 12px, 500 13px. In the toolbar, capsules.
- **Default:** `mac-fill` with a 0.5px hairline ring; hover `mac-fill-2`. Background and transform ease over 160ms (`--mac-ease`, `cubic-bezier(0.23, 1, 0.32, 1)`).
- **Primary:** teal ink on `on-teal`, 600, no ring; hover brightens by 8%.
- **Strong (the deliberate choice):** transparent, teal label, 1px teal inset ring, 600; hover a 9% teal tint. Never filled.
- **Deny with message:** 10% red tint, red label, 45% red hairline.
- **Keys inside buttons:** a cap of 14% of the label's own colour.

### Fields
28px, 7px rounded, padding 3px 8px, 1px `line` stroke on `surface`, 13px. Focus turns the stroke teal and adds a 3px teal glow at 35%, in place of the outline.

### Tabs
8px rounded, padding 4px 12px, 500 13px, no underline. Hover `mac-fill`; selected `mac-fill-2` in ink at 600.

### Menus
Glass, 12px rounded, 5px padding, 78% surface. Items are 24px, 6px rounded, 13px. The highlight is the Mac's: teal with every part of the label inverted to `on-teal`.

### Dialogs
A sheet with 14px corners, a hairline and the float shadow, over a lighter dim (`rgb(0 0 0 / 0.18)`). The palette uses the same sheet.

### Notices
Passing notices are small glass panes: 14px rounded, 80% surface, the rim, hairline and float shadow, 13px text.

### Settings
Sections as grouped sections: a 1px line above each fieldset and a 15px bold legend.

## Accessibility

- **Reduce transparency:** every glass pane becomes opaque. The sidebar takes `shell` (in the app too), menus and notices take `surface`, blurs are switched off, and the desk stand-in becomes `shell`. In the app macOS also makes the sidebar material opaque.
- **Increase contrast:** lines darken to `line-contrast` (#8e8e93), hairlines rise to 45% ink, muted ink strengthens (`ink-muted-contrast`, `ink-muted-contrast-dark`), and the sidebar becomes opaque `shell` with a 1px line around it.
- **Reduce motion:** the layer's only motion is short (160ms) colour and opacity easing and the 160ms fade of a new waiting time; it removes upstream's departures-board flip on the Mac. Upstream's global rule in `styles.css` cuts every animation and transition to 0.01ms with Reduce motion on, so the fade does not play.
- **Focus:** a 3px teal ring at 55%, offset 1px, on every focusable element; fields use the stroke and glow described above. Deny takes the focus at High risk and above.
- Risk is always a word, a number and a shape in its capsule, never colour alone.

## Do's and Don'ts

### Do:
- **Do** scope every Mac rule under `:root[data-platform="mac"]` in `mac-standard.css`, and leave upstream's files unedited.
- **Do** keep upstream's meanings: amber only for what needs you, red for risk and errors, green for healthy, teal as the one accent.
- **Do** keep risk as a word, a number and a shape, in a 999px capsule at 600 12px.
- **Do** keep glass to the sidebar, menus and notices, and give each an opaque fallback under Reduce transparency.
- **Do** use the Mac fills (`mac-fill` 6%, `mac-fill-2` 10%) for rest, hover and selected states, and hairlines (0.5 to 1px) for structure.
- **Do** show shortcuts with Mac key names through `keyLabel`.
- **Do** keep Stop everything red, labelled, with its power mark and key, and always clickable.

### Don't:
- **Don't** put glass on content, lists, the request pane, dialogs or the toolbar.
- **Don't** frame the request pane for any risk below Severe.
- **Don't** fill Allow once when it is the deliberate choice; it is outlined in teal.
- **Don't** bring upstream's Windows chrome to the Mac: hard 4px boxes, warning stripes on Stop everything, mono labels in capitals, the departures-board flip.
- **Don't** add a second accent or use amber where nothing waits.
- **Don't** use the desk gradient as a ground for content; it only stands in for the desktop behind the sidebar in a browser.

## Known gaps

These are open in the shipped build. They are not part of the system and new surfaces should not copy them.

- **Unified title bar (deviation).** A toolbar merged into the title bar with the traffic lights inside it needs the page to extend under the title bar, and whether clicks in that band reach the page, where Stop everything lives, cannot be proven without a screen. Until it is checked at the owner's screen, the title bar stays its own band coloured as the page, above the toolbar.
- **Session and Held by rule are not yet in the grouped rows.** They still sit in the request heading above the command; the contract's story puts session, risk, where, why and status in the grouped rows.
- **The ▾ text glyph after sidebar group names.** Folding is shown by a text character, not a drawn symbol. It is a defect carried from upstream's sidebar, not a Mac rule; a drawn chevron should replace it.
