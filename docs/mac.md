# Codehouse on a Mac

This fork carries the Mac port. Upstream (`breakmylegs/gatehouse`) is Windows only. Everything Mac-specific sits beside the Windows code and is chosen by `process.platform`, so upstream's features merge in without touching it.

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
| Secrets (phone keys, Slack tokens, update token) | AES-256-GCM with a random key in the login Keychain. The key reaches `security` on standard input, never as an argument. If the Keychain cannot be read, nothing is sealed or opened. |
| Folder and save windows | `osascript`, with the folder or name passed as an argument, never inside the script |
| Show in folder | Finder, with the file selected |
| Terminal pane | `/bin/zsh -f`; Stop ends the command's whole process group |
| Starting it | `npm start` |

Before this, away from Windows the Host kept those secrets with `PlainProtector`, in the clear.

All of it was written and unit tested on Windows. None of it has run on a Mac yet. The first time you run it there, check: a phone pairing survives a restart (the Keychain key is read back), the folder window opens in front, and Stop ends a `sleep 100 & sleep 100` in the terminal pane.

## Still to do

1. **The native window.** `packaging/*.cs` is a WebView2 window with a tray, an overlay, a popout and a global hotkey. On a Mac that is a small Swift app with WKWebView, or Tauri. `apps/web/src/lib/shell.ts` talks to the window only through `chrome.webview` (WebView2) and needs a `window.webkit.messageHandlers` path.
2. **Limits per session.** `Codehouse-Limits.exe` uses Windows job objects. macOS has no equivalent; `setrlimit`, `nice` and `taskpolicy` cover part of it.
3. **Installer and updates.** A signed and notarised `.app` in a `.dmg` in place of Inno Setup, and the signed delta updates (`packaging/Updater.cs`, `apps/host/src/update/`) or Sparkle.
4. **Notifications.** Windows toasts come from the window; on a Mac they come from the native app.
5. **PowerShell checking.** Commands are checked with tree-sitter Bash on a Mac. Without `pwsh`, PowerShell commands simply wait for you, as on Windows.

Items 1 to 4 need a Mac to build and test.

## Keep upstream's features

```
git fetch upstream
git merge upstream/main
```

Do it often. Conflicts, if any, are in the few files with Mac branches: `paths.ts`, `relay/protector.ts`, `folder-picker.ts`, `terminal.ts`, `files-api.ts`, `bootstrap.ts`, `TerminalPane.tsx` and `package.json`.

The repository has no licence. Forking is allowed by GitHub's terms, but changing and sharing the code is not granted; ask the owner before you share the Mac version.
