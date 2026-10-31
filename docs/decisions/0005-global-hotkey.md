# ADR 0005: Global hotkey and the quick-launch overlay

Status: Proposed, 31 Oct 2026. Waiting for the owner.

## Context

G2 and U21 ask for a small window that opens from anywhere in Windows on a hotkey: ask a question, start a chat or a task, then return focus to the app you were in.

## What was checked

- The window host (`packaging/JCVCApp.cs`) has no hotkey today and keeps running in the tray.
- `RegisterHotKey` works per user with no admin rights. It fails with error 1409 (`ERROR_HOTKEY_ALREADY_REGISTERED`) when another app holds the key.
- Alt+Space is the Windows window menu. Ctrl+Alt is AltGr on some keyboard layouts, so Ctrl+Alt+Space can type a character there. The owner uses a UK layout, where AltGr+Space types nothing.

## Proposed decision

- The host registers the hotkey with `MOD_NOREPEAT`. The default is Ctrl+Alt+Space, and Settings can change it. On error 1409 the host tells the page, and Settings shows the clash and offers three free alternatives.
- The overlay is a second, small, borderless window in the same process, with its own WebView2 on the same environment, so it opens fast. It loads the existing interface at a `#quick` route, behind the same per-launch token and the same origin checks.
- Before showing, the host remembers the foreground window. Esc, or sending, hides the overlay and gives focus back. The hotkey press itself lets the process take the foreground, so no special rights are needed.
- Sending from the overlay uses the same commands as the main window. Every policy and audit rule applies.

## Consequences

- One more window class in the host. Still C# 5.
- If a corporate tool takes the key at sign-in, the user sees the clash on first use and picks another key.

## Constraint check

Fits. No admin rights. The overlay is only a view of the same 127.0.0.1 interface.

## Verification

Automated: a host test of the hotkey string parser and the clash message. Named manual checks: the hotkey from Word, from a full-screen app and from the desktop, with focus coming back each time, plus a clash test with a second app holding the key. Opening time is measured from the key press to a usable input (target under 300 ms when JCVC is in the tray).
