---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: []
---

# Desktop app (JCVC)

Scope: the whole desktop interface in `apps/web` (Approvals, Sessions, Workspace, Policy, Audit, Devices, Settings, Setup). Mode: Operate. Audience: one senior technology architect, frequent traveller, many Claude sessions at once, deciding in seconds. Constraints: PRODUCT.md, security invariants, sentence case UK English, no hover tooltips, nothing from the network, Windows 11 WebView2.

## Direction contract

THESIS: What needs you is a live departure board, not a chat list. The queue and the sessions re-rank by urgency in place, and a new request stays lit until you have seen it. Refuses the category default of a grey sidebar, chat column and right panel.

OWN-WORLD: Committed slate shell (header and rail) in both themes, cool white or deep slate work ground. Signage yellow only for "needs you"; gate blue only for actions; risk red and green for state. Bahnschrift (DIN, ships with Windows) for labels, numbers and headings, Segoe UI Variable for reading, Cascadia Mono for commands. Tabular figures. Each session has a flight-style code and a ribbon colour.

STORY: You glance at the board, see the lit row, open its pass, read exactly what will run and why it was held, decide on the stub, and the board closes up.

FIRST VIEWPORT: Slate header with JCVC wordmark, yellow Needs you counter, health. Rail left. Board of waiting requests (340px) left of the selected approval pass: segmented header fields, the command, then a perforated edge and the decision stub with Deny and Allow once.

FORM: Departures, fused from the boarding pass and gate board challenger (vernacular-ephemera-boarding-pass-and-gate-board) over assigned candidate 4 (drawing set). Seed key 0f68ed2d. Raises: one dominant work area per screen; saturated colour only where it means something; session identity ribbons; one shared baseline across split panes; exact live readouts.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
