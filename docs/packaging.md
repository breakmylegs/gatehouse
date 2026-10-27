# Running Gatehouse as an exe

`Gatehouse.exe` is a small launcher. It does not contain the application: it finds its files in the folder around it, so the folder can be moved, copied or zipped as a unit.

```
Gatehouse\
  Gatehouse.exe        the launcher
  runtime\node.exe     the Node it runs on
  app\                 the application, with its production node_modules
  README.txt
```

## Build it

From the repository folder (needs the network the first time, for the production dependencies):

```
npm run package          builds the interface and the phone app, then makes dist-app\Gatehouse
npm run package:check    the same, then runs the packaged Gatehouse.exe --check
node scripts/package.mjs --skip-build --zip    reuse the last build, also make dist-app\Gatehouse.zip
```

The launcher is compiled from `packaging/Launcher.cs` with the C# compiler that ships with Windows, so no SDK is needed. The folder is about 460 MB, mostly the Claude Agent SDK's own binary and the node_modules it needs. `dist-app` is not committed.

## Run it

Double-click `Gatehouse.exe`. A window shows what it is doing and your browser opens the interface. Close the window, or press Ctrl+C in it, to stop. If the launcher is killed, Windows ends everything it started.

| Option | What it does |
|---|---|
| `--no-browser` | Do not open the browser. The address is printed in the window. |
| `--check` | Start, confirm the Host answers with its token and refuses without it, stop. Exit code 0 or 1. |
| `--relay [--public-url URL]` | Also start the phone Relay on this computer (`docs/relay-local.md`). |
| `--help` | List the options. |

It runs the same Host as `pwsh scripts/start.ps1`, so everything in `docs/runbook.md` applies. If `runtime\node.exe` is missing it falls back to a Node 22 or newer on the PATH.

## What is where

- **Your data** (audit log, settings, usage, phone keys) is in `%LOCALAPPDATA%\Gatehouse`. Replacing the folder does not touch it.
- **Your policy** is in `app\policy` (`rules.yaml`, `rules.local.yaml`, `projects\`). Replacing the `app` folder with a newer one replaces these too, so copy your own across first. A proper installer should keep this folder (the template below does).
- The package does not ship your `rules.local.yaml` or any audit data.

## Later: an installer, or a standalone single file

Not built yet, by choice. Two routes when you want them:

- **Installer.** `packaging/installer.iss` is an Inno Setup script that wraps this folder: it installs to `%LOCALAPPDATA%\Programs\Gatehouse` (no administrator needed), adds a Start menu shortcut and an uninstaller, keeps `app\policy` on upgrade, and offers an unticked "start at sign-in" choice. It has not been compiled or tested, because Inno Setup is not installed here. Build it with `npm run installer`. It finds `ISCC.exe` in the usual Inno Setup folders or on the PATH (give a path with `--iscc <path>` or `GATEHOUSE_ISCC`), builds the package first if needed, and writes `dist-app\Gatehouse-Setup.exe`.
- **One file.** Node can embed a script into its own exe, but Gatehouse also needs its WebAssembly files, the Agent SDK's binary, the PowerShell scripts and the built interface at run time, so a single file would still unpack them next to itself. The folder layout above avoids that.

## Known limits

- It is not code signed, so Windows SmartScreen may warn the first time. Signing needs a certificate.
- The folder bundles one Node version (recorded in `runtime\NODE-VERSION.txt`). Update it by building a new package.
- It needs the same things as the source: you signed in to Claude Code on this computer, and PowerShell 7 (`pwsh`) installed for the PowerShell parser.
