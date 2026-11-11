# Codehouse on a Mac

This fork carries the Mac port. Upstream (`breakmylegs/gatehouse`) is built and released for Windows; its `docs/forks.md` says which parts are Windows only. The Mac code lives in files of its own (`*-mac.ts`) wherever it can, and joins upstream's code with small hooks, each marked `Mac fork`, so upstream's features merge in with few conflicts.

## The Mac app

`Codehouse.app` is an ordinary Mac app: put it in Applications and open it from there, Spotlight or Launchpad. Everything it runs on is inside it (Node, the Host, the Approver and their modules), so using it needs no Node, npm or Terminal. You still need Claude Code signed in on the Mac, and Git if you want checkpoints.

**Build and install it** (on the Mac, from the repository folder, once `npm ci` has run):

```
npm run package:mac -- --check --install     build dist-app/Codehouse.app, check it, put it in Applications
npm run package:mac -- --dmg                 also make dist-app/Codehouse-<version>.dmg, to install by dragging
npm run package:mac -- --swift-only          only recompile the window's program (quick)
```

`--install` uses `/Applications` when your account may write there, otherwise `~/Applications`, the Applications folder in your home folder, which needs no administrator and which Finder, Spotlight and Launchpad show too. It refuses while that copy is running. Installing a newer build over an older one keeps everything of yours, because none of it is in the app.

**What it does that a browser tab does not:**

- Its own window (`packaging/mac/MainWindow.swift`), with the Mac's own WebKit. It shows only Codehouse's own page, by the same rules as Windows (`NavGuard.swift`, tested as compiled by `apps/host/test/navguard-mac.test.ts`): a link opens in your default browser, anything else is refused, and the Host audits each one. File fields, page dialogs and saving a file use the Mac's own windows. `⌘1` to `⌘9` and `⇧⌘C` reach the page.
- **Closing the window keeps Codehouse running**, with its mark in the menu bar, so a request that needs you still reaches you: the Dock icon bounces, gets a badge, and a notification says "Something needs your decision", never what it is. Click the Dock icon or the menu bar mark to bring the window back. **Quit** (`⌘Q`, or the menu bar mark) stops the Host and the Approver.
- It keeps the Mac awake while a session works (an IOKit power assertion, as `caffeinate -i`), remembers its size and place, zooms with `⌘+`, `⌘-` and `⌘0`, and starts the Host again by itself if it stops unexpectedly, at most three times in ten minutes, as on Windows.
- Claude's commands get the PATH your Terminal has, read once from your login shell (an app opened from the Finder gets only `/usr/bin:/bin:/usr/sbin:/sbin`). `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN` are removed from what the Host is given.
- If `npm start` is already running, the app says so instead of starting a second Codehouse on the same port.
- **A session in its own window:** a pane's menu, Pop out into its own window. Closing that window puts the session back in the main window (`Popout.swift`).
- **The quick prompt:** a small panel over whatever app you are in, from its shortcut (Control-Option-Space unless you choose another in Settings) or the menu bar mark. It does not bring Codehouse's other windows forward, and Esc or a click elsewhere puts it away and leaves you where you were (`Quick.swift`). The shortcut is held with the Mac's hot key registration, which needs no Accessibility permission: Codehouse is told only that its own shortcut was pressed. A shortcut chosen on Windows still works (Ctrl is read as Control, Alt as Option, Win as Command), and if another app has it, Settings offers three that are free (`Shortcut.swift`, tested as compiled by `apps/host/test/shortcut-mac.test.ts`).
- **Pictures from the quick prompt:** part of the screen (you choose it; Space switches to choosing a window) or the window you were in, taken with the Mac's own `screencapture` (`Capture.swift`). The first time, macOS asks you to let Codehouse record the screen (System Settings, Privacy and Security, Screen and System Audio Recording). Because the app is signed for this Mac only, a rebuild may ask again.
- **Voice typing:** with the microphone switched on in Settings, the button starts the Mac's own Dictation in the prompt box. macOS types the words; Codehouse is never given the microphone.
- **How much of the Mac a session may use** (Low, Medium, High and the rest, in a session's menu): `codehouse-limits` (`packaging/mac/limits/main.swift`, beside the program in the app) runs each session's Claude Code with its level's limits, as `Codehouse-Limits.exe` does on Windows, with the same arguments, so the Host calls it the same way (`limits-mac.ts`, `apps/host/test/limits-mac.test.ts`). The session's processes are its process group and everything descended from it. A lower priority is `nice` 10; the share of the processor is held by pausing and resuming the session's processes in 100 ms slices, since macOS cannot cap a group of processes; over the memory cap, the session's largest process is ended and its pane says so, since macOS enforces no memory limit (on Windows the allocation fails instead). When the session ends, whatever it started that is still running in it is ended too. Two differences from Windows: macOS lets a program lower a priority but not raise it again, so a session moved from a level with a lower priority back to normal priority keeps the lower one until it next starts; and a process that leaves the session's process group and its family (a daemon that detaches itself) is not counted. From the source folder (`npm start`) there is no helper, so sessions run without limits.

**How the page talks to the window.** The page was written for WebView2's `chrome.webview` (`apps/web/src/lib/shell.ts`). `Page.swift` gives the page the same object over WebKit's message handler, only in the top frame of Codehouse's own page, and drops any message from a frame or another origin. `--check` proves both: a frame inside the page gets no `chrome.webview`, and a message it sends through WebKit's handler directly is not heard.

**Where things are.** The app is signed as a whole, and nothing writes inside it (`--check` verifies the signature after a run). Your data is in `~/Library/Application Support/Gatehouse` as before, and the rules you change go in its `policy` folder: `rules.local.yaml` (Remember), `rules.user.yaml` and `projects/`. The shipped `rules.yaml` and library are read from the app. If you had rules of your own in the source folder's `policy` folder, copy them into `~/Library/Application Support/Gatehouse/policy`.

**Inside the app:** `Contents/MacOS/Codehouse` (the Swift program, `packaging/mac/`), `Resources/runtime/node` (Node's own Mac build, version pinned in `scripts/package-mac.mjs`, its sha256 checked against nodejs.org), `Resources/app` (the same app folder as the Windows package, staged by `scripts/package.mjs --stage-only`), the icon, the start-up picture and the menu bar marks. `Contents/MacOS/Codehouse --check` starts it, checks the Host answers with its token and refuses without it, loads the interface in a window that is not shown, and stops.

**Limits of this first version:**

- **Signed for this Mac only** (ad hoc), not notarised. Built and installed here, it opens like any app. A copy downloaded onto another Mac is stopped by Gatekeeper until its owner allows it in System Settings, Privacy and Security, Open Anyway. Signing and notarising for other Macs needs an Apple Developer ID.
- **No in-app updates yet.** Settings, Updates says so. To update, pull and run `npm run package:mac -- --install` again (or install a newer `.dmg`).
- **For this Mac's processor** (Apple silicon here). An Intel Mac needs its own build, made on an Intel Mac.

## Run it from the source folder

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
| Keep the computer awake while a session works | The Mac app holds a power assertion when the Host asks; from the source folder, `npm start` runs `caffeinate -i` |
| Project folders | Mac paths such as `/Users/you/dev` for the projects folder, routines, task board cards and remembered file rules (`packages/shared/src/node/folders-mac.ts`, `packages/policy/src/paths-mac.ts`). Upstream accepted only drive paths such as `C:\dev`, so on a Mac the projects folder could not be set and nothing counted as your workspace. The projects folder may not be `/` or a system folder (`/System`, `/Library`, `/Applications`, `/usr` and the like). `/c/...` and `/mnt/c/...` stay Mac folders, where on Windows the policy reads them as Git Bash's and WSL's names for drive C. |
| Held-out checks and locked tests, sealed | The Keychain, through the same `sealerFor()` |
| The memory governor | The share of memory in use from `sysctl kern.memorystatus_level`, macOS's memory pressure figure (`memory-governor-mac.ts`). A Mac has no commit limit, so the point in Settings is the share in use: at the default 85%, nothing heavy starts while less than 15% is free or reclaimable. Upstream read Windows' commit charge through `Codehouse-Helper.exe`, so on a Mac it had no reading and refused nothing. Its messages still say "committed". |
| Open in Claude, and the browser tools' page look | Edge from `/Applications` with the same `--app` arguments, or `open` for your default browser and the Claude app (`chat/handoff-mac.ts`). Upstream found Edge in the Windows registry and opened addresses through `Codehouse-Helper.exe`, so all three failed on a Mac. |
| Starting it | `Codehouse.app` (above), or `npm start` from the source folder |

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

- **Browser shortcuts:** in Chrome on a Mac, `⌘1` to `⌘9` switch the browser's tabs and `⇧⌘C` opens the inspector before the page sees them. The Mac app does not have this.
- **Copy deeper in Settings** still names Windows in places: the commit charge, temporary files, voice typing, the installer, "sealed for your Windows account".

## Still to do

1. **Updates and signing.** A Developer ID signature and notarisation, so the app opens on other Macs, then Mac releases and an updater: the signed releases of `apps/host/src/update/` with a Mac part, or Sparkle.
2. **PowerShell checking.** Commands are checked with tree-sitter Bash on a Mac. Without `pwsh`, PowerShell commands simply wait for you, as on Windows.

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

The hooks in upstream's files: `packages/shared/src/node/paths.ts`, `apps/host/src/relay/protector.ts` (in `sealerFor()`), `apps/host/src/bootstrap.ts` (the pickers, the hand-off launcher and the memory reader), `apps/host/src/chat/handoff.ts` (`findEdge()`, `hasAppLink()`), `packages/shared/src/node/config.ts` (the projects folder), `apps/host/src/board.ts`, `routines.ts` and `sessions.ts` (folder paths), `packages/policy/src/paths.ts` (`normaliseRaw()`), `loader.ts` and `host-helpers.ts` (remembered file rules), `packages/policy/test/paths.test.ts`, `apps/web/src/lib/choices.ts` and `RoutinesPanel.tsx`, `apps/host/src/terminal.ts`, `apps/host/src/files-api.ts`, `apps/host/test/helper-exe.test.ts`, and the `start`, `sync:upstream` and `package:mac` lines in `package.json`. For the Mac app: `--stage-only` in `scripts/package.mjs` (two places), `macAppWhy()` in `apps/host/src/update/service.ts` (`#whyNot`), and `GATEHOUSE_MAC_APP_VERSION` in `bootstrap.ts` (the update service's version), `findLimitsMac()` in `limits.ts` (`findLimitsExe`), and `macActionShell()` in `codehouse-action.ts` (`startCommand`). When upstream adds a part to the Windows package outside the app folder (a new exe, a picture the window shows), check whether `scripts/package-mac.mjs` needs it. In the interface: `main.tsx` (the two stylesheets and the platform mark), `App.tsx` (`⌘,`), `Menu.tsx`, `CommandPalette.tsx`, `ShortcutSheet.tsx`, `CommandDeck.tsx`, `Rail.tsx` (shortcut labels), `SettingsPanels.tsx` and `lib/appearance.ts` (copy and the code font), `Approvals.tsx` and `Workspace.tsx` (Command as well as Ctrl), `TerminalPane.tsx`, and `VoiceButton.tsx` and `QuickKeyPanel.tsx` (Dictation and the menu bar in the Mac app's words, from `voiceCopy()` and `trayName()`). When upstream adds a message between the page and its window (`lib/shell.ts`, `packaging/CodehouseApp.cs`), add its answer to `packaging/mac`.

Do not run Prettier over upstream's files: upstream does not keep them formatted, and rewrapping its lines turns every later change near them into a conflict. Format only the fork's own files, or the lines you add.

The repository has no licence. Forking is allowed by GitHub's terms, but changing and sharing the code is not granted; ask the owner before you share the Mac version.
