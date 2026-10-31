# Wave 1 plan: replace the Claude desktop Chat tab

Status: Proposed, 31 Oct 2026. Nothing here is built until the owner approves.

**Done means** the owner can stop using the Claude desktop Chat tab. In practice that is: chats that look and feel current, projects with knowledge and instructions, memory, research with sources, artifacts, and files and data in chats. The other Wave 1 items (palette, overlay, voice, prompt library) make JCVC better to live in, but are not needed to stop using the Chat tab. Each slice says which kind it is.

Backlog ids are in `docs/plan/backlog.md`. Decisions are in `docs/decisions/` (ADRs 0001 to 0007, all Proposed).

## How each slice is built

- One branch per slice (`w1-NN-name`), fast-forwarded into `main` when done, as the conventions say.
- Tests first. Each important test is proved by breaking the code it guards.
- Before a slice is called done: the full test suite (`npm test`) and every type check (`npm run typecheck`), as the owner asked on 31 Oct. On this laptop the full suite takes about 30 minutes, so it runs once per slice, at the end.
- `docs/plan/backlog.md` and `docs/BUILD_REPORT.md` are updated after each slice, with a short note to the owner on what changed and what was tested.
- If a slice grows past its size, stop and re-plan.

## The slices, in order

Foundations first: safety fixes, then the look and the shell, because every later screen is built on them.

| Slice | Backlog ids | Days | Needed to drop Chat? | Depends on |
|---|---|---|---|---|
| W1-01 Safety fixes before new work | O9, O7 | 1 | Yes | None |
| W1-02 Theme spike and tokens | U15 (tokens), O12, ADR 0001, ADR 0002 | 2 | Yes | Owner's choice on ADRs 0001 and 0002, and C4, C5, C7 |
| W1-03 The shell and the session view in the new look | U15 (rest), O3, O5, U8, O4 | 3 | Yes | W1-02 |
| W1-04 Settings in sections with search | F19, O6 | 2 | No | W1-02 |
| W1-05 Palette, keys and the rail | G1, U1 | 2 | No | W1-03 |
| W1-06 Mica | U16, ADR 0004 | 1 | No | W1-03 |
| W1-07 Chat projects and instructions | G3, O17, ADR 0006 | 3 | Yes | W1-03 |
| W1-08 Memory | G4, ADR 0006 | 3 | Yes | W1-07 |
| W1-09 Artifacts | G6, ADR 0003 | 3 | Yes | W1-03 |
| W1-10 Research and sources | G5, O20, ADR 0007 | 2 | Yes | W1-03 |
| W1-11 Files and data in chats | G7 | 2 | Yes | W1-09 |
| W1-12 Transcript views and the tool tree | U5, U6, G12 (announcer) | 2 | No | W1-03 |
| W1-13 Export with a redaction preview | G10, O8 | 2 | Yes | None |
| W1-14 Prompt library | G8 | 2 | No | W1-01 (O7), W1-05 |
| W1-15 Quick-launch overlay | G2, U21, ADR 0005 | 3 | No | W1-05 |
| W1-16 Voice | G9 | 1 | No | IT answer on voice typing |
| W1-17 Policy level cards | U22, F1 | 1 | No | None |
| W1-18 Performance and accessibility pass | G11, G12 | 3 | Yes | All the above |
| W1-19 Marketplace | O1, O20 | 3 | No | Owner decision O14 |

About 41 days in all. The slices needed to drop the Chat tab add up to about 26.

## Slice details

### W1-01 Safety fixes before new work (1 day)

- **O9:** stop a session whose init message lists an MCP server that is not in-process (stdio, HTTP or SSE), with a safety error (hard constraint 3).
- **O7:** send a Claude Code command or skill as typed, instead of refusing every slash command JCVC does not know.
- Files: `apps/host/src/safety.ts`, `apps/host/src/sessions.ts`, `apps/host/test/fake-sdk.ts`, `apps/host/test/invariants.test.ts`, `apps/web/src/surfaces/Workspace.tsx`, `apps/web/test/plus-menu.test.tsx`, `docs/threat-model.md`.

| Acceptance | Test |
|---|---|
| A session listing a stdio, HTTP or SSE server stops with a safety error | `apps/host/test/invariants.test.ts`, new case through the fake SDK |
| The Companion (in-process) still starts | same file |
| A command or skill from the plus menu is sent as typed | `apps/web/test/plus-menu.test.tsx`, new case |
| JCVC's own commands still work, and a typo of one still says so | `apps/web/test/plus-menu.test.tsx` |

### W1-02 Theme spike and tokens (2 days)

- Spike: one Fluent v9 provider and one control, under React 19 StrictMode, in the packaged window. Measure bundle size and start time. If it fails, use ADR 0001 option 2.
- Ledger tokens as CSS variables in `styles.css`, Segoe UI Variable by name, the theme following Windows with a change listener, and base `forced-colors` rules.
- Files: `apps/web/package.json`, `package-lock.json`, `apps/web/src/main.tsx`, `apps/web/src/styles.css`, `apps/web/src/store.ts`, `apps/web/test/theme-tokens.test.ts` (new), `apps/web/test/theme-follow.test.ts` (new), `DESIGN.md` (rewritten once the owner chooses), `docs/BUILD_REPORT.md`.

| Acceptance | Test |
|---|---|
| No accent in the orange family (hue 15 to 75 degrees), no warm cream ground | `theme-tokens.test.ts` reads the tokens |
| Every text and surface pair meets WCAG AA | `theme-tokens.test.ts`, with the contrast formula |
| The window follows a Windows theme change while it runs | `theme-follow.test.ts`, with a `matchMedia` stand-in |
| Fluent renders under React 19 StrictMode with no console errors | spike test in jsdom, then a named manual check in the packaged window |
| Start time and bundle size do not grow by more than 10% | named manual check, numbers in BUILD_REPORT |
| Forced colours reads correctly | named manual check with Windows high contrast on |

### W1-03 The shell and the session view in the new look (3 days)

- The light rail, softer radii, hairlines, the new session header and footer (O3), per-session text size and Comfortable or Compact density (O5), and the sidebar drag (O4), with widths and folds kept (U8).
- Files: `apps/web/src/styles.css`, `apps/web/src/App.tsx`, `apps/web/src/components/Rail.tsx`, `apps/web/src/components/RailResizer.tsx` (new, drafted), `apps/web/src/components/SessionCode.tsx`, `apps/web/src/surfaces/Workspace.tsx`, `apps/web/src/lib/paneView.ts` (new), tests below.

| Acceptance | Test |
|---|---|
| The sidebar width follows a drag and the arrow keys, stays within 200 to 480 px and is kept | `apps/web/test/rail-resizer.test.tsx` (drafted) |
| The activity line and the session bar fold, and every pane follows | `apps/web/test/session-bar.test.tsx` (new) |
| Split panes keep their prompt boxes level | `apps/web/test/split.test.tsx`, plus a named layout check in headless Edge at 1440 by 900 with two and three panes |
| Text size and density are kept per session across a restart | `apps/web/test/pane-view.test.tsx` (new) |
| The resources choice says it is this PC's processor and memory | `apps/web/test/resources-select.test.tsx`, updated |
| Screens in both themes look right | named screenshot check of six screens in headless Edge, light and dark |

### W1-04 Settings in sections with search (2 days)

- A list of sections on the left (General, Account and plan, Sessions, Phone and notifications, Privacy, Updates), one section at a time, a search box, modified markers.
- Files: `apps/web/src/surfaces/Settings.tsx`, `apps/web/src/components/SettingsNav.tsx` (new), `apps/web/test/settings-autosave.test.tsx`, `apps/web/test/settings-restart.test.tsx`, `apps/web/test/settings-search.test.tsx` (new), `apps/web/src/help/content.ts`.

| Acceptance | Test |
|---|---|
| Settings opens on its sections, and the last one is kept | `settings-search.test.tsx` |
| Search finds any setting by its label or help text, across sections | `settings-search.test.tsx` |
| A changed setting shows a marker | `settings-search.test.tsx` |
| Save as you change, and restart now or later, still work | the two existing settings tests, updated to open a section first |

### W1-05 Palette, keys and the rail (2 days)

- A command registry used by menus and the palette, Ctrl+1 to 9, a shortcut sheet (Ctrl+/), ranking by page, and a rail order you can change.
- Files: `apps/web/src/lib/commands.ts` (new), `apps/web/src/components/CommandPalette.tsx`, `apps/web/src/components/Rail.tsx`, `apps/web/src/lib/rail.ts`, `apps/web/src/App.tsx`, `apps/web/src/components/ShortcutSheet.tsx` (new), `apps/web/test/palette.test.tsx`, `apps/web/test/rail.test.tsx`, `apps/web/src/help/content.ts`.

| Acceptance | Test |
|---|---|
| Every menu action is in the palette | `palette.test.tsx` compares the registry with each menu's items |
| Ctrl+3 shows session 3 | `palette.test.tsx` |
| The page you are on ranks its commands first | `palette.test.tsx` |
| The sheet lists every binding in the registry | `palette.test.tsx` |
| The rail order you set is kept | `rail.test.tsx` |
| Ctrl+3 responds in under 100 ms | named manual check with the WebView2 performance panel |

### W1-06 Mica (1 day)

- Files: `packaging/JCVCApp.cs`, `packaging/Common.cs`, `apps/web/src/App.tsx`, `apps/web/src/styles.css`, `apps/host/test/backdrop-exe.test.ts` (new, builds a small C# check with `csc`, as `limits-exe.test.ts` does).

| Acceptance | Test |
|---|---|
| The decision function picks opaque for each fallback case | `backdrop-exe.test.ts` |
| No white flash at start or on resize | named manual check on this laptop |
| Opaque with transparency effects off, and in high contrast | named manual checks |

### W1-07 Chat projects and instructions (3 days)

- Projects under `%LOCALAPPDATA%\Gatehouse\projects\`, knowledge files, and global, project and session instructions in the system prompt `append`.
- Files: `apps/host/src/projects.ts` (new), `apps/host/src/sessions.ts`, `apps/host/src/api.ts`, `packages/shared/src/ws-protocol.ts`, `packages/shared/src/node/config.ts` (global instructions, added tolerantly), `apps/web/src/surfaces/Projects.tsx` (new), `apps/web/src/surfaces/NewChat.tsx`, `apps/web/src/surfaces/Workspace.tsx`, `apps/web/src/surfaces/Settings.tsx`, tests below.

| Acceptance | Test |
|---|---|
| Files attach to a project, and removing one stops its use next turn | `apps/host/test/projects.test.ts` (new) |
| Global, project and session instructions reach `append` in that order, within a size limit | `apps/host/test/projects.test.ts` through the fake SDK |
| A chat in a project gets the project folder through `additionalDirectories` | same file |
| Each turn shows which knowledge files Claude read | `apps/web/test/projects.test.tsx` (new) |
| The settings file stays readable by older versions | `packages/shared/test/node.test.ts`, new case |
| A project chat answers from a knowledge PDF | named manual check |

### W1-08 Memory (3 days)

- Companion tools `remember`, `recall` and `forget`, a memory store per project and global, a Memory page, export and import as Markdown. Claude Code's own auto memory off for chats.
- Files: `apps/companion/src/handlers.ts`, `apps/companion/src/server.ts`, `apps/host/src/memory.ts` (new), `apps/host/src/sessions.ts`, `apps/host/src/api.ts`, `apps/web/src/surfaces/Memory.tsx` (new), tests below, `docs/threat-model.md`.

| Acceptance | Test |
|---|---|
| Entries are kept by topic, redacted, written atomically, and read tolerantly | `apps/host/test/memory.test.ts` (new) |
| Each write and each use at start is in the audit log | `apps/host/test/memory.test.ts` through the fake SDK |
| Chats start with `autoMemoryEnabled: false` | `apps/host/test/memory.test.ts`, options check |
| Entries can be edited, deleted, exported and imported | `apps/web/test/memory.test.tsx` (new) |
| A preference remembered in one chat comes back in a new one | named manual check |

### W1-09 Artifacts (3 days)

- A Companion tool `save_artifact`, versions on the Host, the `/artifact/` route with the ADR 0003 headers, an Artifacts side panel, export to HTML.
- Files: `apps/companion/src/handlers.ts`, `apps/host/src/artifacts.ts` (new), `apps/host/src/api.ts`, `apps/web/src/components/ArtifactsPane.tsx` (new), `apps/web/src/surfaces/Workspace.tsx`, `apps/web/public/artifact-lib/` (vetted React build), `scripts/artifact-sandbox-check.mjs` (new, headless Edge), tests below.

| Acceptance | Test |
|---|---|
| The route sends the sandbox CSP and the other headers | `apps/host/test/artifacts.test.ts` (new) |
| Fetch, XHR, WebSocket, a form post, top navigation and a pop-up all fail inside an artifact | `scripts/artifact-sandbox-check.mjs` in headless Edge, plus a named manual check in the packaged window |
| Each version is redacted and audited | `apps/host/test/artifacts.test.ts` |
| Versions can be compared and exported | `apps/web/test/artifacts.test.tsx` (new) |

### W1-10 Research and sources (2 days)

- A Research choice for chats, the research instruction, a sources pane from `tool_use_result`, untrusted marks, and a rule that refuses a query or address holding a redaction term.
- Files: `apps/host/src/sessions.ts`, `packages/policy/src/` (the query check), `policy/rules.yaml`, `apps/web/src/lib/sources.ts` (new), `apps/web/src/components/SourcesPane.tsx` (new), `apps/web/src/surfaces/NewChat.tsx`, tests below.

| Acceptance | Test |
|---|---|
| A query with a listed term is refused with a rule id and an audit entry | `packages/policy/test/web-query.test.ts` (new) |
| Sources are built from a recorded `tool_use_result` and marked untrusted | `apps/web/test/sources.test.ts` (new), with the probe's real shape |
| Research adds its instruction | `apps/host/test/research.test.ts` (new) |
| A current question shows numbered citations and the sources pane | named manual check |

### W1-11 Files and data in chats (2 days)

- Attach in chats as in sessions. CSV, PDF and pictures. Charts as artifacts. XLSX waits for IT.
- Files: `apps/host/src/attach-api.ts`, `apps/web/src/surfaces/NewChat.tsx`, `apps/web/src/surfaces/Workspace.tsx`, the chat instruction in `apps/host/src/sessions.ts`, tests below.

| Acceptance | Test |
|---|---|
| A file attaches to a chat, a secrets file never does | `apps/host/test/attach.test.ts`, new cases |
| A file over the limit is refused with a clear message | same file |
| A CSV becomes a chart artifact | named manual check |

### W1-12 Transcript views and the tool tree (2 days)

- Summary, Normal and Verbose per session. Tool rows as a tree with arrow keys. One announcer for new requests and finished turns.
- Files: `apps/web/src/surfaces/Workspace.tsx`, `apps/web/src/lib/groups.ts`, `apps/web/src/components/Announcer.tsx` (new), `apps/web/src/store.ts`, tests below.

| Acceptance | Test |
|---|---|
| The view is kept per session, and Summary keeps approvals, errors and why-lines | `apps/web/test/views.test.tsx` (new) |
| Arrow keys move and open tool rows | `apps/web/test/tool-tree.test.tsx` (new) |
| A new request and a finished turn are announced once each | `apps/web/test/announcer.test.tsx` (new), plus a named check with Narrator and NVDA |

### W1-13 Export with a redaction preview (2 days)

- Export reads the whole conversation from the Host, applies the redaction list, previews it, and writes Markdown, HTML, or PDF through WebView2's own print to PDF.
- Files: `apps/web/src/lib/exportMarkdown.ts`, `apps/web/src/components/ExportDialog.tsx` (new), `apps/host/src/api.ts`, `packaging/JCVCApp.cs` (print to PDF), tests below.

| Acceptance | Test |
|---|---|
| Listed terms are masked in the preview and the file | `apps/web/test/export.test.tsx` (new) |
| A session longer than 3,000 items exports from its start | `apps/host/test/export.test.ts` (new) |
| Each export is in the audit log | same file |
| PDF keeps code blocks | named manual check |

### W1-14 Prompt library (2 days)

- Files: `apps/host/src/prompts.ts` (new), `apps/host/src/api.ts`, `apps/web/src/components/PlusMenu.tsx`, `apps/web/src/surfaces/Prompts.tsx` (new), tests `apps/host/test/prompts.test.ts` and `apps/web/test/prompts.test.tsx` (new).

| Acceptance | Test |
|---|---|
| Variables are asked for on use | `apps/web/test/prompts.test.tsx` |
| Promote writes a skill file in the project and audits it | `apps/host/test/prompts.test.ts` |

### W1-15 Quick-launch overlay (3 days)

- Files: `packaging/JCVCApp.cs`, `packaging/Common.cs`, `packaging/Overlay.cs` (new), `scripts/package.mjs`, `apps/web/src/surfaces/Quick.tsx` (new), `apps/web/src/App.tsx`, `apps/web/src/surfaces/Settings.tsx`, `apps/host/test/hotkey-exe.test.ts` (new, `csc`), `apps/web/test/quick.test.tsx` (new).

| Acceptance | Test |
|---|---|
| The hotkey text is parsed and a clash produces three alternatives | `hotkey-exe.test.ts` |
| The quick page sends a new chat or a message to the current project | `quick.test.tsx` |
| Opens in under 300 ms from the tray, and Esc gives focus back | named manual checks from Word, a full-screen app and the desktop |

### W1-16 Voice (1 day)

- A microphone button that starts Windows voice typing in the prompt box. Only if IT agrees.
- Files: `apps/web/src/surfaces/Workspace.tsx`, `packaging/JCVCApp.cs`, `apps/web/test/voice.test.tsx` (new).

| Acceptance | Test |
|---|---|
| The button asks the window to start voice typing | `voice.test.tsx` checks the message to the host |
| Spoken words reach the prompt box | named manual check |

### W1-17 Policy level cards (1 day)

- Files: `apps/web/src/surfaces/PolicyChoices.tsx`, `apps/web/src/lib/choices.ts`, `apps/web/test/policy-choices.test.tsx`.

| Acceptance | Test |
|---|---|
| Each level lists five example asks it allows and five it asks about, worked out by the real engine | `policy-choices.test.tsx` |
| Try it runs against any level | same file |

### W1-18 Performance and accessibility pass (3 days)

- Files: `scripts/perf-check.mjs` (new, headless Edge trace), fixes where the numbers point, `docs/BUILD_REPORT.md`.

| Acceptance | Test |
|---|---|
| A 10,000-message session scrolls without dropped frames and uses under 400 MB | `scripts/perf-check.mjs` |
| Start time is recorded for the release | `scripts/perf-check.mjs` |
| Every action is keyboard reachable | named manual check against the command registry |
| Narrator and NVDA read tool calls and why-lines | named manual check |
| The window works at 200% scaling | named manual check |

### W1-19 Marketplace (3 days, after O14)

- Browse first. Install through the unmodified Claude Code binary. Refuse a plugin with hooks, or with MCP servers that are not in-process, until O14 is decided.
- Files: `apps/host/src/marketplace.ts` (new), `apps/host/src/api.ts`, `apps/web/src/surfaces/Marketplace.tsx` (new), tests `apps/host/test/marketplace.test.ts` and `apps/web/test/marketplace.test.tsx` (new).

| Acceptance | Test |
|---|---|
| The catalogue lists plugins and what each contains | `marketplace.test.ts` with a recorded catalogue |
| A plugin with hooks, or a stdio or HTTP server, is refused | same file |
| Each install is audited | same file |

## New packages

| Package | Version | Licence | Slice | Why | IT |
|---|---|---|---|---|---|
| `@fluentui/react-components` | 9.75.0 | MIT | W1-02 | Tokens and the controls that are hard to get right (ADR 0001). Peer range covers React 19.3.1. | No |
| `@fluentui/react-icons` | 2.0.345 | MIT | W1-03 | One consistent icon set for the rail and toolbars | No |
| `mermaid` | 12.2.0 | MIT, but it pulls in `elkjs` (EPL-2.0) and `khroma` (no licence in the registry) | W1-09 | Mermaid artifacts | **Yes: licence review.** Wave 1 can ship artifacts without Mermaid. |
| Cascadia Code font | latest release, version not yet checked | SIL OFL 1.1 | W1-02, optional | Code text, because Cascadia is not installed here (D7). About 400 KB. | No, but the owner chooses |

No package is needed for PDF (WebView2's own print to PDF), for React in artifacts (the existing `react` and `react-dom` 19.3.1, MIT, served as a vetted copy), or for the hotkey and Mica (Windows APIs from C#).

Left out of Wave 1: an XLSX reader. The npm `xlsx` package is an old version, and current SheetJS builds come only from SheetJS's own site, so it needs IT.

## For the IT department

1. **Mermaid's licences** (`elkjs` EPL-2.0, `khroma` unstated), before W1-09 ships Mermaid.
2. **Windows voice typing** may send audio to Microsoft's online speech service. Is that allowed under DLP? Needed before W1-16.
3. **Web research:** queries already go through Anthropic today. Research mode makes that more common. JCVC refuses queries holding redaction terms. Worth telling DLP.
4. **A global hotkey** (Ctrl+Alt+Space by default) may clash with a corporate tool. No admin rights are needed. The owner can choose another key.
5. **XLSX in chats** needs a cleared library (left out of Wave 1).

## Open questions for the owner

1. Approve, change or reject ADRs 0001 to 0007.
2. The look (ADR 0002 and conflicts C4, C5, C7): Ledger? Does the faint Jean-Claude photo stay, and do the flight-style codes go? `DESIGN.md` is rewritten after this answer.
3. The hook question (O14), which blocks the marketplace.
4. Bundle Cascadia Code, or keep Consolas?
5. The default hotkey.
6. Is the Inbox (U2) needed in Wave 1 (C9)?
7. The interface report stops part way through U22. Can you share U23 to U25 and sections I and J?
8. Is about 41 days the right size for Wave 1, or should it stop at the 26 days needed to drop the Chat tab?
9. Branches: one per slice, fast-forwarded into `main`. Pushes then go straight to `main`, as now. Is that still right?
