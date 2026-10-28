# Running Gatehouse as a Windows app

The app is shown to you as **Jean-Claude Van Code**. The files and the data folder keep the name Gatehouse.

`Gatehouse.exe` is a normal Windows application with its own window. It is not a browser tab: it has its own icon and taskbar button, a title bar with minimise, maximise and close, no address bar, and a tray icon so approvals still reach you when the window is closed. It shows the Gatehouse interface using Microsoft's WebView2 (the engine Edge uses, installed with Windows 11).

It does not contain the whole application. It finds its files in the folder around it, so the folder can be moved, copied or zipped as a unit.

```
Gatehouse\
  Gatehouse.exe              the window
  Gatehouse-Console.exe      the same thing in a console window, for troubleshooting and scripts
  splash.png                 the start-up picture the window shows while it starts
  Microsoft.Web.WebView2.Core.dll, Microsoft.Web.WebView2.WinForms.dll, WebView2Loader.dll, WebView2-LICENSE.txt
  runtime\node.exe           the Node it runs on
  app\                       the application, with its production node_modules
  README.txt
```

## Build it

From the repository folder (needs the network the first time, for the production dependencies and the WebView2 libraries):

```
npm run package          builds the interface and the phone app, then makes dist-app\Gatehouse
npm run package:check    the same, then runs the packaged Gatehouse.exe --check
npm run installer        makes dist-app\Gatehouse-Setup.exe (below)
node scripts/package.mjs --exe-only    only recompile the two exes into the existing folder (quick)
node scripts/package.mjs --skip-build --zip    reuse the last build, also make dist-app\Gatehouse.zip
```

Both exes are compiled from `packaging/*.cs` with the C# compiler that ships with Windows, so no SDK is needed. The WebView2 libraries are downloaded once from NuGet into `dist-app\.cache`. The folder is about 470 MB, mostly the Claude Agent SDK's own binary and the node_modules it needs. `dist-app` is not committed.

## Run it

Double-click `Gatehouse.exe`. A window opens (a short "Starting" page first, then the interface). What it does that a browser tab would not:

- **Closing the window keeps Gatehouse running in the tray**, so a request that needs you can still reach you. The taskbar button flashes and a balloon says "Something needs your decision" when one arrives and the window is not in front. The balloon never shows what the request is.
- **Quit** from the tray icon's menu (right-click), which also stops the Host and the Approver. Left-click the tray icon, or double-click `Gatehouse.exe` again, to bring the window back. A second copy never starts: it just shows the first.
- It remembers its size and position, follows the Windows light or dark setting, and opens links from Claude's text in your default browser instead of inside the window.
- It only ever loads the Gatehouse page from its own Host. Anything else is refused or sent to your browser.

| Option | What it does |
|---|---|
| `--check` | Start, confirm the Host answers with its token and refuses without it, open the real window off screen and confirm the interface loaded, stop. Exit code 0 or 1. |
| `--relay [--public-url URL]` | Also start the phone Relay on this computer (`docs/relay-local.md`). |
| `--tray` | Start hidden in the tray (what "start when I sign in" uses). |
| `--browser` | Use your default browser instead of this window (runs `Gatehouse-Console.exe`). |
| `--help` | List the options. |

If the WebView2 runtime is missing (it is part of Windows 11 and most Windows 10), Gatehouse says so and opens in your default browser instead. You can install the runtime from Microsoft to get the window.

It runs the same Host as `pwsh scripts/start.ps1`, so everything in `docs/runbook.md` applies. If `runtime\node.exe` is missing it falls back to a Node 22 or newer on the PATH.

## What is where

- **Your data** (audit log, settings, usage, phone keys, window position) is in `%LOCALAPPDATA%\Gatehouse`. Replacing the folder does not touch it. The window's own web data is in `%LOCALAPPDATA%\Gatehouse\webview`.
- **Your policy** is in `app\policy` (`rules.yaml`, `rules.local.yaml`, `projects\`). Replacing the `app` folder with a newer one replaces these too, so copy your own across first. The installer keeps this folder.
- The package does not ship your `rules.local.yaml` or any audit data.

## The installer

`npm run installer` runs Inno Setup on `packaging/installer.iss` and writes `dist-app\Gatehouse-Setup.exe` (about 135 MB). It finds `ISCC.exe` in the usual Inno Setup folders or on the PATH; give another path with `--iscc <path>` or `GATEHOUSE_ISCC`. It builds the package first if needed.

The installer puts Gatehouse in `%LOCALAPPDATA%\Programs\Gatehouse` (no administrator needed), adds a Start menu shortcut and an uninstaller, keeps `app\policy` on upgrade, and offers an unticked "start Gatehouse when I sign in" choice. Compiling it works, and it has not been run through an install on this machine. Try it on a spare account or machine first.

A single-file exe was judged not worth it: Gatehouse also needs the WebView2 libraries, its WebAssembly files, the Agent SDK's binary and the PowerShell scripts at run time, so a single file would unpack them next to itself anyway.

## Known limits

- It is not code signed, so Windows SmartScreen may warn the first time. Signing needs a certificate.
- The folder bundles one Node version (recorded in `runtime\NODE-VERSION.txt`). Update it by building a new package.
- It needs the same things as the source: you signed in to Claude Code on this computer, and PowerShell 7 (`pwsh`) installed for the PowerShell parser.
- Notifications from the page itself (Settings, browser notification) are allowed in the window, but the taskbar flash and balloon are the dependable signal.
