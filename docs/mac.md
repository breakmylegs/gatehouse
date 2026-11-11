# Codehouse on a Mac

This fork carries the Mac port. Upstream (`breakmylegs/gatehouse`) is built and released for Windows; its `docs/forks.md` says which parts are Windows only. The Mac code lives in files of its own (`*-mac.ts`) wherever it can, and joins upstream's code with small hooks, each marked `Mac fork`, so upstream's features merge in with few conflicts.

## Run it

You need Node 24, Git and Claude Code signed in.

```
npm ci
npm start                 the Host and the Approver, then the interface in your browser
npm start -- --check      start, prove the token is needed, and stop
npm start -- --relay      also the phone Relay (docs/relay-local.md)
```

`npm start` is `scripts/start.mjs`, which does what `scripts/start.ps1` does with Node alone.

**Set your workspace first.** The shipped rules file names Windows folders (`C:/dev`, `C:/Users/<you>/source`) as your workspace, and on a Mac those are nowhere, so until you set one, every edit is denied as outside your folders and every read waits for you. In **Settings, Account and plan**, set **Where new projects go** to a folder such as `/Users/you/dev` (it counts as a workspace folder), or list your folders under **Workspace roots**, one per line. Then restart Codehouse.

## What is ported

| Part | On a Mac |
|---|---|
| Data | `~/Library/Application Support/Gatehouse` |
| Managed policy | `/Library/Application Support/Codehouse/managed` (needs an administrator to change) |
| Secrets (phone keys, Slack tokens, update token) | AES-256-GCM with a random key in the login Keychain (`relay/protector-mac.ts`, chosen in `sealerFor()`). The key reaches `security` on standard input, never as an argument. If the Keychain cannot be read, nothing is sealed or opened. |
| Folder and save windows | `osascript` (`folder-picker-mac.ts`), with the folder or name passed as an argument, never inside the script |
| Show in folder | Finder, with the file selected |
| Terminal pane | `/bin/zsh -f`; Stop ends the command's whole process group |
| Keep the computer awake while a session works | `caffeinate -i`, started by `npm start` when the Host asks (on Windows the window app does it) |
| Project folders | Mac paths such as `/Users/you/dev` for the projects folder, routines, task board cards and remembered file rules (`packages/shared/src/node/folders-mac.ts`, `packages/policy/src/paths-mac.ts`). Upstream accepted only drive paths such as `C:\dev`, so on a Mac the projects folder could not be set and nothing counted as your workspace. The projects folder may not be `/` or a system folder (`/System`, `/Library`, `/Applications`, `/usr` and the like). `/c/...` and `/mnt/c/...` stay Mac folders, where on Windows the policy reads them as Git Bash's and WSL's names for drive C. |
| Held-out checks and locked tests, sealed | The Keychain, through the same `sealerFor()` |
| The memory governor | The share of memory in use from `sysctl kern.memorystatus_level`, macOS's memory pressure figure (`memory-governor-mac.ts`). A Mac has no commit limit, so the point in Settings is the share in use: at the default 85%, nothing heavy starts while less than 15% is free or reclaimable. Upstream read Windows' commit charge through `Codehouse-Helper.exe`, so on a Mac it had no reading and refused nothing. Its messages still say "committed". |
| Open in Claude, and the browser tools' page look | Edge from `/Applications` with the same `--app` arguments, or `open` for your default browser and the Claude app (`chat/handoff-mac.ts`). Upstream found Edge in the Windows registry and opened addresses through `Codehouse-Helper.exe`, so all three failed on a Mac. |
| Starting it | `npm start` |

Before this, away from Windows the Host kept those secrets with `PlainProtector`, in the clear.

### The interface on a Mac

`apps/web/src/lib/platform-mac.ts` marks the page `data-platform="mac"` from the browser's user agent, and `apps/web/src/mac.css` applies only under it:

- **Type:** SF Pro for the interface and SF Mono for code. Upstream names Segoe UI and Cascadia Mono, and in Chrome its fallback reached the generic monospace. The system font brings Apple's optical sizing and tracking, so no letter-spacing is set. The page title is not narrowed (upstream's `font-stretch` picks a condensed SF cut).
- **Scrollbars:** the Mac's own, which show while you scroll. Upstream's thin coloured bars made Chrome draw permanent classic ones.
- **Pointer:** the arrow on buttons, tabs, menu and palette items, as Mac apps do; the hand stays on links.
- **Shortcuts:** shown as a Mac shows them, `⌘K`, `⇧⌘K`, `⌥↑`, in Apple's modifier order, in menus, the palette, the shortcut sheet and the sidebar. Every Ctrl shortcut also answers to Command (two that did not now do). `⌘,` opens Settings.
- **Copy:** the theme and motion choices say "Follow macOS".

`apps/web/src/polish.css` holds the design audit's fixes for every platform: buttons give a little under the press (`scale(0.97)`, 160ms, not when motion is reduced), the load bars settle in 240ms instead of 400ms, and Increased contrast strengthens lines and secondary text.

All of it was written and unit tested on Windows. None of it has run on a Mac yet. The first time you run it there, check: a phone pairing survives a restart (the Keychain key is read back), the folder window opens in front, Stop ends a `sleep 100 & sleep 100` in the terminal pane, `pmset -g assertions` shows `caffeinate` while a session works, the interface is in SF Pro with overlay scrollbars, the profile menu says `⌘K`, and `⌘,` opens Settings.

### Known gaps

- **Browser shortcuts:** in Chrome on a Mac, `⌘1` to `⌘9` switch the browser's tabs and `⇧⌘C` opens the inspector before the page sees them. The native window will not have this.
- **Copy deeper in Settings** still names Windows in places: the commit charge, temporary files, voice typing, the installer, "sealed for your Windows account". Voice typing and the screen-capture quick prompt need the native window.

## Still to do

1. **The native window.** `packaging/*.cs` is a WebView2 window with a tray, an overlay, a popout and a global hotkey. On a Mac that is a small Swift app with WKWebView, or Tauri. `apps/web/src/lib/shell.ts` talks to the window only through `chrome.webview` (WebView2) and needs a `window.webkit.messageHandlers` path.
2. **Limits per session.** `Codehouse-Limits.exe` uses Windows job objects. macOS has no equivalent; `setrlimit`, `nice` and `taskpolicy` cover part of it.
3. **Installer and updates.** A signed and notarised `.app` in a `.dmg` in place of Inno Setup, and the signed delta updates (`packaging/Updater.cs`, `apps/host/src/update/`) or Sparkle.
4. **Notifications.** Windows toasts come from the window; on a Mac they come from the native app. Keep-awake moves there too, from `npm start`.
5. **PowerShell checking.** Commands are checked with tree-sitter Bash on a Mac. Without `pwsh`, PowerShell commands simply wait for you, as on Windows.

Items 1 to 4 need a Mac to build and test.

## Keep upstream's features

Upstream releases several times a day. Sync at least weekly, on a branch:

```
git checkout -b mac/sync-<date> main
npm run sync:upstream -- --check     what is new, what needs Mac work, whether it would conflict
npm run sync:upstream                the same, then merge (nothing is pushed)
npm run gate
```

`scripts/sync-upstream.ts` sorts each new commit with upstream's own `scripts/platforms.ts`, the same as each release's `changes.json`:

- **Every platform**: comes in as it is. Most commits are this.
- **Needs a look** (shared code with Windows parts) and **Windows only**: listed with their Windows files. For each, decide whether the Mac needs its own version. For example, upstream's keep-awake feature was shared code plus the Windows window app; the Mac version is `caffeinate` in `npm start`.
- **Files with Mac hooks** that upstream changed: check each hook is still there after the merge (`git grep "Mac fork"`).

When a merge conflicts, take upstream's code as it is and put back the `Mac fork` hook it replaced; keep Mac code in its `-mac.ts` file, not in upstream's. If an upstream test pins Windows-only behaviour on a Mac, change only that assertion and mark it `Mac fork` (as in `apps/host/test/helper-exe.test.ts`).

Merge, do not rebase, so upstream's commit hashes stay the same as in its release notes and `changes.json`.

The hooks in upstream's files: `packages/shared/src/node/paths.ts`, `apps/host/src/relay/protector.ts` (in `sealerFor()`), `apps/host/src/bootstrap.ts` (the pickers, the hand-off launcher and the memory reader), `apps/host/src/chat/handoff.ts` (`findEdge()`, `hasAppLink()`), `packages/shared/src/node/config.ts` (the projects folder), `apps/host/src/board.ts`, `routines.ts` and `sessions.ts` (folder paths), `packages/policy/src/paths.ts` (`normaliseRaw()`), `loader.ts` and `host-helpers.ts` (remembered file rules), `packages/policy/test/paths.test.ts`, `apps/web/src/lib/choices.ts` and `RoutinesPanel.tsx`, `apps/host/src/terminal.ts`, `apps/host/src/files-api.ts`, `apps/host/test/helper-exe.test.ts`, and the `start` and `sync:upstream` lines in `package.json`. In the interface: `main.tsx` (the two stylesheets and the platform mark), `App.tsx` (`⌘,`), `Menu.tsx`, `CommandPalette.tsx`, `ShortcutSheet.tsx`, `CommandDeck.tsx`, `Rail.tsx` (shortcut labels), `SettingsPanels.tsx` and `lib/appearance.ts` (copy and the code font), `Approvals.tsx` and `Workspace.tsx` (Command as well as Ctrl), and `TerminalPane.tsx`.

Do not run Prettier over upstream's files: upstream does not keep them formatted, and rewrapping its lines turns every later change near them into a conflict. Format only the fork's own files, or the lines you add.

The repository has no licence. Forking is allowed by GitHub's terms, but changing and sharing the code is not granted; ask the owner before you share the Mac version.
