# Forks on other systems

Codehouse is built and released for Windows. There is a Mac fork that this repository does not maintain (owner, 4 Nov 2026). So that a fork like it can keep pulling the newest features, every release says which change is for which platform.

## What each release says

- **The release notes** group "What is new" into **For every platform**, **For every platform, with Windows parts** and **Windows only**. Changes to this repository's own release tools and documents are left out of the notes.
- **`changes.json`** is attached to every release. It lists each commit since the release before, with:
  - its hash, its subject and the files it touched;
  - its `platform`, one of:

| Platform | Means |
|---|---|
| `all` | Touches only shared code: a fork can take it as it is |
| `mixed` | Shared code and Windows parts together: take the shared files, and do the Windows part your own way |
| `windows` | Windows parts only: a fork does not need it, or needs its own version |
| `release` | How this repository builds and publishes its releases |
| `docs` | Documents only |

The platform comes from the files a commit touched (`scripts/platforms.ts`, tested in `apps/host/test/platforms.test.ts`).

## What is Windows only

| Part | Where | What a fork does instead |
|---|---|---|
| The window, tray, quick prompt, pop-outs, global hotkey, splash | `packaging/*.cs` (C# and WebView2) | Its own shell, or the browser (`--browser`, or `npm run host:cli`) |
| The installer and packaging | `packaging/installer.iss`, `scripts/installer*.mjs`, `scripts/package*.mjs`, `scripts/install-local.mjs`, `scripts/links.mjs`, `scripts/ico.mjs` | Its own package |
| Resource limits per session | `packaging/Limits.cs`, `apps/host/src/limits.ts` | Sessions run without limits when the helper is not there |
| Sealing secrets for the user | `scripts/dpapi.ps1`, `apps/host/src/relay/protector.ts` | The Keychain, through its own protector |
| The Windows file and folder pickers | `apps/host/src/folder-picker.ts` | Its own picker |
| The in-app updater | `apps/host/src/update/`, `packaging/Updater.cs` | Its own update path; a fork must not use this repository's signing key or update names |

Everything else is shared: the Host (`apps/host`), the Approver, the Companion, the web interface, the phone app and Relay, and the policy and shared packages. The security rules in `CLAUDE.md` apply to a fork as they do here.
