---
version: 1
slug: "src-mac-standard-css"
primary_target: "src/mac-standard.css"
related_targets: []
---

# Codehouse on a Mac: Standard macOS (Mac fork)

Scope: the whole desktop interface, on a Mac only (`:root[data-platform="mac"]`), as one stylesheet loaded after upstream's (`src/mac-standard.css`); in Codehouse.app the window adds the Mac's own sidebar material (`:root[data-mac-vibrancy]`) and colours its title bar as the page. Windows and upstream's files are unchanged. Mode: Operate. Owner's choice, 12 Nov 2026: option 3 of the Liquid Glass round, "Standard macOS", Mac only.

## Direction contract

THESIS: Codehouse should feel like an app that came with the Mac: Mail's sidebar, list and detail, System Settings' grouped sections, glass only where macOS 26 puts it. It refuses both upstream's Stitch control-room chrome (hard 4px boxes, striped kill switch, mono shouting) and a costume of glass over everything.

OWN-WORLD: Light or dark following macOS. A translucent sidebar (the Mac's own sidebar material in the app, frosted in a browser) and a toolbar of glass capsules over plain white or graphite content. Teal ink as the one accent (#0d6c76 light, #4ff0e0 dark), amber only for what needs you, red for risk. SF Pro, SF Mono only for commands. Rounded rectangles (8 to 12px), inset grouped sections, hairlines at 0.5 to 1px, no stripes.

STORY: You glance at the sidebar, Needs you shows amber; the list selects the request in teal; the detail pane reads like a Settings page: the command, then grouped rows (session, risk, where, why, status); Deny has the focus, Allow once is the outlined deliberate choice.

FIRST VIEWPORT: The toolbar on the page's own ground (in the app the Mac's title bar sits above it in the same colour, so the two read as one; see Deviation) with the wordmark, live session capsules and a red-tinted Stop everything capsule; sidebar left with Needs you, the nav and sessions on the sidebar material; Waiting on you list; the request pass as inset grouped rows with the decision bar under it.

FORM: Standard macOS 26, the category standard played straight (canon card), first of the three cards the owner saw; seed: none (unavailable).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Deviation

A toolbar merged into the title bar, with the traffic lights inside it, needs the page to extend under the title bar (fullSizeContentView). Whether clicks in that band then reach the page cannot be proven without a screen, and Stop everything lives there: it must always be clickable. Until it is checked at the owner's screen, the title bar stays its own band, coloured as the page, above the toolbar.
