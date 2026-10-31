# ADR 0004: Mica backdrop and its fallback

Status: Proposed, 31 Oct 2026. Waiting for the owner.

## Context

U16 asks for the Windows 11 Mica material behind the rail and the window background, with an opaque fallback. The paper warns of WebView2 transparency regressions.

## What was checked

- The window is WinForms (`packaging/JCVCApp.cs`, `MainForm : Form`) with the WinForms WebView2 control (`Microsoft.Web.WebView2.WinForms`). That is windowed (HWND) hosting, not visual hosting.
- It is compiled with the .NET Framework 4 `csc.exe` that ships with Windows, which accepts C# 5 only. New host code must avoid later syntax.
- WebView2 SDK 1.0.4314.35 (`scripts/package.mjs`). Runtime 156.0.4314.50 on this laptop. Windows 11 25H2, build 26200.
- Today the control sets `DefaultBackgroundColor` to an opaque grey to avoid a white flash at start.

## Proposed decision

- Turn on Mica with `DwmSetWindowAttribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE = 38, DWMSBT_MAINWINDOW = 2)` and extend the frame into the client area. Set `DefaultBackgroundColor` to transparent only after the page says it is ready, so there is no white flash. The web page keeps opaque content surfaces and leaves the rail and window ground transparent.
- Use the opaque path whenever any of these is true:
  - the build is below 22621
  - the user has turned off transparency effects (`HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize\EnableTransparency` = 0)
  - high contrast is on
  - the WebView2 runtime is in a known-bad list kept in the app
  - the owner turns it off in Settings.
- The web page learns which path is in force from a message the host posts, and sets its own ground to match.
- Keep the standard Windows title bar. Snap layouts then keep working with no extra code. The paper's custom title bar (U17) is deferred: it brings more risk than value while the standard bar works.

## Consequences

- No admin rights, no new binary, no new package.
- Resizing and moving must be checked for flicker on this laptop before the slice is done.

## Constraint check

Fits. Everything runs as the user.

## Verification

Named manual checks on this laptop: Mica on, transparency effects off, high contrast on, and a resize sweep, each with a screenshot. Automated: a host unit test of the decision function, which takes the build, the registry value, high contrast, the runtime and the setting, and returns Mica or opaque.
