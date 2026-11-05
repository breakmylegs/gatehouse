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
| Starting it | `npm start` |

Before this, away from Windows the Host kept those secrets with `PlainProtector`, in the clear.

All of it was written and unit tested on Windows. None of it has run on a Mac yet. The first time you run it there, check: a phone pairing survives a restart (the Keychain key is read back), the folder window opens in front, Stop ends a `sleep 100 & sleep 100` in the terminal pane, and `pmset -g assertions` shows `caffeinate` while a session works.

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

The hooks in upstream's files: `packages/shared/src/node/paths.ts`, `apps/host/src/relay/protector.ts` (in `sealerFor()`), `apps/host/src/bootstrap.ts` (the pickers), `apps/host/src/terminal.ts`, `apps/host/src/files-api.ts`, `apps/web/src/components/TerminalPane.tsx`, `apps/host/test/helper-exe.test.ts`, and the `start` and `sync:upstream` lines in `package.json`.

The repository has no licence. Forking is allowed by GitHub's terms, but changing and sharing the code is not granted; ask the owner before you share the Mac version.
