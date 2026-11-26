# Codehouse on a phone (O55)

Owner, 25 Nov: "a real phone layout for the Codehouse interface when I use it through Neighbourhood Watch on a phone".
Today CNW serves the desktop interface at `/app/`, and a phone gets the desktop screen squashed. This note says what a
phone user does there and the screens that serve it. It follows the Mac and iOS conventions in `mac-standard.md`.

## What a phone user does, most important first

1. **See what needs them, and allow or deny it.** A request is waiting, the phone buzzed, they open the page to decide.
   This is most of the time spent on a phone, so it is the first tab and it opens there when something waits.
2. **Check how a session is going.** Working, waiting, stopped or done, and what it last did.
3. **Read its transcript.** Scroll back through what Claude said and did.
4. **Send it a prompt.** A short instruction, typed with the thumbs, the keyboard up.
5. **Switch between computers and sessions.** Through CNW, back to the computers on the board, or to another session
   on this computer.

What they do not do on a phone: edit policy, tune the Approver, lay out four panes, browse the marketplace, read the
audit table, or set up a computer. Those pages say so and suggest a computer, instead of being squeezed in.

## When the phone layout applies

By the size of the window, not by where the page came from, so it works the same through CNW, in a narrow browser
window on a computer, on the Mac and on Windows:

- the window is 640 px wide or narrower (any phone in portrait, a narrow window), or
- the pointer is coarse (a finger) and the window is at most 960 by 520 (a phone in landscape).

The query is `PHONE_QUERY` in `apps/web/src/lib/phone.ts`. When it matches, the root element carries
`data-layout="phone"` and the app draws the phone screens. Wider than that, nothing changes: the desktop layout is
the same as before, line for line.

## The screens

One column. A bottom tab bar replaces the sidebar, with four tabs, each at least 44 px tall, above the home indicator:

| Tab | Opens | Badge |
|---|---|---|
| **Needs you** | the requests waiting, oldest first | how many wait |
| **Sessions** | the coding sessions on this computer | how many are working |
| **Ask** | your Ask about code questions | |
| **More** | the other pages, the computers, and the kill switch | |

A tab keeps its place, as on iOS: going back to Sessions reopens the session you were reading (O54's memory of the last
session on each side). Tapping the tab you are on goes back to its list.

### Needs you

The queue as a list of large rows (what, which session, the risk). Tapping a row opens the request full-screen with a
back button: the same approval card as on a computer, with every check it has today (Severe still needs what it needs
today, a default-to-no request still asks for the reason, edited input is still checked again). Its buttons are full
width, at least 48 px tall, with space between Allow and Deny so a thumb cannot hit the wrong one. Sessions that need
you sit under the queue.

### Sessions and Ask

The session list is its own screen: each session a row with its state (working, needs you, ready, stopped), its
project and how long ago it last did something. Sessions that need you come first, then working, then the rest. On top,
in CNW, the name of this computer and a link to all computers on the board. **New session** (or **New question**) opens
the start form.

A session opens full-screen with a back button and its name. One pane only: split panes are a computer's thing; on a
phone the session you chose fills the screen, and the panes you set on a computer are kept for when you are back
there. The tab bar steps aside while a session is open, so the transcript has the height.

The prompt box sits at the foot, above the keyboard: the page uses the visual viewport (`interactive-widget=
resizes-content`), so when the keyboard comes up the transcript shrinks and the box rides on top of it.

Changes, Terminal, Details, Files and the other panels open as sheets that slide up from the bottom, with a handle, a
Close button and the transcript dimmed behind, never as side columns.

### More

The pages that work on a phone, the computers (in CNW), and the kill switch, which a phone can always trigger
(invariant 11). Pages made for a big screen (Policy, Audit, Approver, Marketplace, MCP servers, Board, Doctor, Devices,
Settings) open a short page that says "Open this on a computer", with the address to open.

## Rules every phone screen keeps

- One column, and nothing scrolls sideways. Long lines (commands, paths, code) wrap or scroll inside their own box.
- No control that only shows on hover: what a mouse reveals on hover is always shown.
- Every button and tab at least 44 by 44 px.
- The safe areas are kept: nothing under the notch, the rounded corners or the home indicator, in portrait or
  landscape (`viewport-fit=cover` with `env(safe-area-inset-*)`).
- Light, dark and high contrast (Windows' forced colours, the Mac's increased contrast) as on a computer.
- The Mac look (`mac-standard.md`) on both platforms, as everywhere else (O51).
- Every safety rule as it is: the phone layout changes where things are drawn, never what a decision needs.

## How it is tested

- `apps/web/test/phone-layout.test.tsx`: at phone width the sidebar, its resizer and the help column are not drawn, the
  tab bar is; a session opens alone with a back button; a panel opens as a sheet. At desktop width none of that
  happens.
- `apps/web/test/phone-browser.test.ts`: the demo screens in Edge without a window at 360x800, 390x844 and 430x932,
  portrait and landscape, light, dark and forced colours: no sideways scrolling, no sidebar or side column on screen,
  every visible button at least 44 px, nothing under the safe areas. It skips where Edge is not installed.
