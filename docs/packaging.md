# Running Codehouse as a Windows app

The app is shown to you as **Codehouse** (Codehouse for short), and its files are named Codehouse. The data folder `%LOCALAPPDATA%\Gatehouse` and internal names keep the old name Gatehouse so existing data carries on.

`Codehouse.exe` is a normal Windows application with its own window. It is not a browser tab: it has its own icon and taskbar button, a title bar with minimise, maximise and close, no address bar, and a tray icon so approvals still reach you when the window is closed. It shows the Codehouse interface using Microsoft's WebView2 (the engine Edge uses, installed with Windows 11).

It does not contain the whole application. It finds its files in the folder around it, so the folder can be moved, copied or zipped as a unit.

```
Codehouse\
  Codehouse.exe              the window, with the tray icon and the quick prompt (packaging/CodehouseApp.cs, Overlay.cs, Hotkey.cs)
  Codehouse-Console.exe      the same thing in a console window, for troubleshooting and scripts
  splash.png                 the start-up picture the window shows while it starts (from the visual identity pack)
  tray-*.png                 the tray marks, normal and waiting on you, at 16 and 32 px (docs/brand/README.md)
  Microsoft.Web.WebView2.Core.dll, Microsoft.Web.WebView2.WinForms.dll, WebView2Loader.dll, WebView2-LICENSE.txt
  runtime\node.exe           the Node it runs on
  app\                       the application, with its production node_modules
  Codehouse-Update.exe            switches to a new version after Codehouse closes, and goes back if it does not start
  Codehouse-Limits.exe            runs each session's Claude Code inside a job object with its resource limits (packaging/Limits.cs)
  release.json               this folder's version and the hash of each part
  README.txt
```

## Build it

From the repository folder (needs the network the first time, for the production dependencies and the WebView2 libraries):

```
npm run package          builds the interface and the phone app, then makes dist-app\Codehouse
npm run package:check    the same, then runs the packaged Codehouse.exe --check
npm run installer        makes dist-app\Codehouse-Setup.exe (below)
node scripts/package.mjs --exe-only    only recompile the two exes into the existing folder (quick)
node scripts/package.mjs --skip-build --zip    reuse the last build, also make dist-app\Codehouse.zip
```

Both exes are compiled from `packaging/*.cs` with the C# compiler that ships with Windows, so no SDK is needed. The WebView2 libraries are downloaded once from NuGet into `dist-app\.cache`. The folder is about 470 MB, mostly the Claude Agent SDK's own binary and the node_modules it needs. `dist-app` is not committed.

## Run it

Double-click `Codehouse.exe`. A window opens (a short "Starting" page first, then the interface). What it does that a browser tab would not:

- **Closing the window keeps Codehouse running in the tray**, so a request that needs you can still reach you. The taskbar button flashes and a balloon says "Something needs your decision" when one arrives and the window is not in front. The balloon never shows what the request is.
- **Quit** from the tray icon's menu (right-click), which also stops the Host and the Approver. Left-click the tray icon, or double-click `Codehouse.exe` again, to bring the window back. A second copy never starts: it just shows the first.
- It remembers its size and position, follows the Windows light or dark setting, and opens links from Claude's text in your default browser instead of inside the window.
- It only ever loads the Codehouse page from its own Host. Anything else is refused or sent to your browser.

| Option | What it does |
|---|---|
| `--check` | Start, confirm the Host answers with its token and refuses without it, open the real window off screen and confirm the interface loaded, stop. Exit code 0 or 1. |
| `--relay [--public-url URL]` | Also start the phone Relay on this computer (`docs/relay-local.md`). |
| `--tray` | Start hidden in the tray (what "start when I sign in" uses). |
| `--browser` | Use your default browser instead of this window (runs `Codehouse-Console.exe`). |
| `--help` | List the options. |

If the WebView2 runtime is missing (it is part of Windows 11 and most Windows 10), Codehouse says so and opens in your default browser instead. You can install the runtime from Microsoft to get the window.

It runs the same Host as `pwsh scripts/start.ps1`, so everything in `docs/runbook.md` applies. If `runtime\node.exe` is missing it falls back to a Node 22 or newer on the PATH.

## What is where

- **Your data** (audit log, settings, usage, phone keys, window position) is in `%LOCALAPPDATA%\Gatehouse`. Replacing the folder does not touch it. The window's own web data is in `%LOCALAPPDATA%\Gatehouse\webview`.
- **Your policy** is in `app\policy` (`rules.yaml`, `rules.local.yaml`, `projects\`). Replacing the `app` folder with a newer one replaces these too, so copy your own across first. The installer keeps this folder.
- The package does not ship your `rules.local.yaml` or any audit data.

## The installer

`npm run installer` runs Inno Setup on `packaging/installer.iss` and writes `dist-app\Codehouse-Setup.exe` (about 135 MB). It finds `ISCC.exe` in the usual Inno Setup folders or on the PATH; give another path with `--iscc <path>` or `GATEHOUSE_ISCC`. It builds the package first if needed.

The installer puts Codehouse in `%LOCALAPPDATA%\Programs\Codehouse` (no administrator needed), adds a Start menu shortcut and an uninstaller, keeps `app\policy` on upgrade, and offers an unticked "start Codehouse when I sign in" choice. Compiling it works, and it has not been run through an install on this machine. Try it on a spare account or machine first.

A single-file exe was judged not worth it: Codehouse also needs the WebView2 libraries, its WebAssembly files, the Agent SDK's binary and the PowerShell scripts at run time, so a single file would unpack them next to itself anyway.

## Built code

The package does not run the TypeScript sources: `scripts/bundle.mjs` builds the Host, the Approver and the phone Relay into one file each (`appapps<name>distmain.mjs`), and the launchers and the Host start those directly. A start then reads a handful of files instead of about 1,500, which matters most on the first start after an install or update, when Windows scans every file once. Measured on a fresh copy: first start 84 s from source, 22 s built; second start 32 s and 11 s. The sources stay in the package, and each launcher falls back to them through tsx if a built file is missing.

The Agent SDK and the shell parser stay outside the built files (they find their own files at run time), as do pino and thread-stream. Each built file sits in `apps<name>dist`, the same depth as `src`, so paths the code finds from its own place still lead to the same files; the one that did not (the DPAPI script) now searches up for the app folder.

Node keeps compiled code in `%LOCALAPPDATA%Gatehouse
ode-cache` (`NODE_COMPILE_CACHE`, set by the launchers), so later starts skip compiling.

`npm run package:check` also runs `scripts/package-smoke.mjs` against the package: the Approver and the PowerShell checker running, real decisions through the shell parser and the PowerShell parser, a secret sealed with DPAPI and removed, and the built Relay loading.

## Installing from the source

`npm run install:local` (`scripts/install-local.mjs`) is for a computer whose browser will not keep Codehouse-Setup.exe. It builds the package (`--skip-build` reuses `dist-app\Codehouse`), copies it beside `%LOCALAPPDATA%\Programs\Codehouse` without npm's workspace links, and then:

- **No copy there yet:** renames it into place, adds the Start menu shortcut and starts Codehouse.
- **A copy there:** hands over to Codehouse-Update.exe with a plan, exactly as an update does. Your policy is carried across, the old copy is kept as `Codehouse.previous`, and if the new one does not report that it started, the old one is put back. It refuses to run while Codehouse is running from that folder, and asks you to quit it.

`--dir <folder>` installs somewhere else; `--no-shortcut` and `--no-start` are for tests.

## Updates and releases

You install Codehouse once. After that it updates itself (the user guide's Updates article says how it looks to you).

**A release** is made on this computer with `npm run release` (GitHub Actions are switched off for this repository: the account has few minutes). The commit must be pushed first. It runs the typecheck and the tests, builds and checks the package, builds the installer, then `scripts/release.ts publish` and `gh release create`. Each release has:

- **Codehouse-Setup.exe**, first on the release page, for new installs.
- **release.json** and **release.sig**: the version, the notes and, for each of the three parts, its tree hash, file count, archive, size and sha256, signed with the release key (Ed25519). The private key is `%USERPROFILE%\.codehouse-release\release-key.pem` (or `CODEHOUSE_RELEASE_KEY` / `CODEHOUSE_RELEASE_KEY_FILE`); its public half is in `apps/host/src/update/manifest.ts`. Keep a copy of the private key somewhere safe: without it no installed copy will accept a new release.
- **codeh-<version>-app.zip, -modules.zip, -runtime.zip**: the three parts. The app part is everything except `app\node_modules` (modules) and `runtime` (Node).

The version is `major.minor` from package.json and the number of commits (`npm run release:version`). A working copy with changes builds as `-dev`, which sorts before the release of that number.

**Updating** (`apps/host/src/update/`): the Host reads the newest release.json from GitHub every 30 minutes (or as set), checks its signature, and offers a newer version you have not skipped. To prepare it, it builds `Codehouse.next` beside the install folder: parts whose hash is unchanged are copied from the current install, the rest are downloaded, checked and unpacked by `zip.ts`, which reads only its own zips (UTF-8 names), checks every name, and refuses a zip holding more files or bytes than the signed release says before it writes anything. Codehouse does not use a zip tool: Windows' tar.exe could not take some real file names (a dependency ships test files named with a snowman), which the end-to-end check found. The whole folder must then match the signed hashes. Applying it writes a plan and hands over to `Codehouse-Update.exe` (`packaging/Updater.cs`), which waits for Codehouse to close, renames `Codehouse` to `Codehouse.previous` and `Codehouse.next` to `Codehouse`, carries `app\policy` across (all but the shipped library) and the uninstaller files, starts the new Codehouse.exe and waits for its Host to write `started.json` with the new version. If that does not happen within four minutes, it puts the old folder back and starts it. It writes `result.txt` and `update.log` in `%LOCALAPPDATA%\Gatehouse\updates`.

**Workspace links.** npm links `app\node_modules\@gatehouse\*` to the workspace packages with junctions, which hold absolute paths. They are left out of releases and the installer, and `scripts/links.mjs` (run by Codehouse.exe before the Host, every start) makes them point into the folder Codehouse is in. That is also what lets the folder be moved.

**Checking it end to end:** after `npm run package`, `node node_modules/tsx/dist/cli.mjs scripts/update-e2e.ts` installs the package into a temporary folder, serves a signed release of it as 1.0.900 from a local stand-in for GitHub, and updates the installed copy through its own Host and Codehouse-Update.exe.

## Known limits

- It is not code signed, so Windows SmartScreen may warn the first time. Signing needs a certificate.
- The folder bundles one Node version (recorded in `runtime\NODE-VERSION.txt`). Update it by building a new package.
- It needs the same things as the source: you signed in to Claude Code on this computer, and PowerShell 7 (`pwsh`) installed for the PowerShell parser.
- Notifications from the page itself (Settings, browser notification) are allowed in the window, but the taskbar flash and balloon are the dependable signal.

## The rename to Codehouse (31 Oct 2026)

Releases from 1.0.116 ship `Codehouse.exe` and `Codehouse-Update.exe` as copies of `Codehouse.exe` and `Codehouse-Update.exe`. An install from 1.0.115 or before needs them: its Host looks for `Codehouse-Update.exe` to switch, and its shortcuts start `Codehouse.exe`. Remove the copies (in `scripts/package.mjs`) only once no install from before the rename is left. The updater renames the old shortcuts itself once the new version runs. To check the path from an old install: unpack an old release's three zips and its `release.json` and `release.sig` into one folder, run `npm run package`, then `E2E_FROM=<that folder> node node_modules/tsx/dist/cli.mjs scripts/update-e2e.ts`.