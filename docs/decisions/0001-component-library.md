# ADR 0001: Component library for the desktop interface

Status: Accepted, 31 Oct 2026 (the owner approved the plan with its recommended options). Slice W1-02's spike result below sends it to option 2 for now.

## Context

The desktop interface (`apps/web`) is React 19.3.1 with Tailwind 4.3.3 and hand-written components (`Menu`, `PictureViewer`, `ApprovalCard`, dialogs). About 45 test files find controls by role and accessible name. The interface research recommends Fluent UI React v9 for a Windows-native feel and free light, dark and high-contrast themes.

## What was checked

- `@fluentui/react-components` 9.75.0, MIT. Peer range `react >=16.14.0 <20.0.0`, so React 19.3.1 is inside it (npm view, 31 Oct).
- `@fluentui/react-icons` 2.0.345, MIT, same React range.
- Styling runs through Griffel (`@griffel/react` 1.7.8, MIT), which injects style tags at run time. The window serves no Content-Security-Policy of its own today, so this needs no change. A later CSP would need `style-src 'unsafe-inline'` or Griffel's build-time extraction.
- Not checked yet: React 19 StrictMode double effects with Fluent's focus management (tabster), bundle size, and start-up time in WebView2. The spike in slice W1-01 checks all three.

## Options

1. **Fluent v9 everywhere.** Replace every component. Most native look. Largest change, and every test that finds a control would need checking.
2. **Fluent tokens, own components.** Copy the Fluent v9 theme values (colours, radii, shadows, type ramp) into CSS variables. Keep Tailwind and today's components. Smallest change, no new run-time dependency, but no free high-contrast behaviour.
3. **Tokens everywhere, Fluent components where they earn it.** Option 2 for the shell and transcript, plus Fluent v9 for the controls that are hard to get right (Combobox, Menu, Dialog, Toast, Tree for the tool rows). Adopt one control at a time, behind the existing tests.

## Proposed decision

Option 3. Fluent tokens become the CSS variables in `apps/web/src/styles.css`. Fluent components replace our own only where a slice needs them, starting with the tree grid for tool rows (U6). Tailwind stays.

## Consequences

- The look moves to Fluent's neutral ramp at once, without a rewrite.
- New dependencies: `@fluentui/react-components` and `@fluentui/react-icons`, both MIT. Each goes in `docs/BUILD_REPORT.md` with its reason, as the conventions require.
- If the spike finds a React 19 problem, fall back to option 2 with no lost work.

## Constraint check

Fits. No Anthropic visuals. Segoe UI Variable stays a system font, never bundled.

## Spike result (slice W1-02, 31 Oct 2026)

Run outside the repository, so no dependency was added: React 19.3.1 with `@fluentui/react-components` 9.75.0, one `FluentProvider`, one primary `Button` and one `Menu`, in StrictMode.

- **Works:** both render under StrictMode with no console error or warning (jsdom, development build).
- **Size:** 464 KB minified (136 KB gzip), against 218 KB (68 KB gzip) for React 19 alone, so these three parts add 246 KB (68 KB gzip). The desktop interface is 1,378 KB of minified JavaScript in total today, so three components already add about 18%, past the plan's 10% limit, and each further component adds more.
- **Not measured:** start time inside WebView2 in the packaged window. The size result decides without it.
- **Decision for now:** option 2. The Ledger tokens are CSS variables (done in W1-02), and the components stay our own. Fluent v9 comes back only for a control that earns its size, and then through a dedicated import of that one control, measured again. The tool tree (U6) is the first candidate; a hand-built tree is the alternative.
