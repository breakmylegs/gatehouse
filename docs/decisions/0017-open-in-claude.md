# ADR 0017: Open in Claude

Status: **Decided, 5 Nov 2026**, with the Chat plan (`docs/plan/chat-build-plan.md` section 8, question 5: the Default profile, changeable in Settings). Built in CH-06.

## Context

The owner's Chat build prompt: an imported chat can be opened in claude.ai, in an Edge app window by default, the official Claude app or the default browser; Edge found through the registry's App Paths and given exactly `--app=<url>` and `--profile-directory=<profile>`, started detached, nothing read back; addresses from templates, a checked uuid and claude.ai only; the app's `claude://` link (documented only by third parties) behind a flag, off, with Edge as the fallback when it is not registered; an audit entry per hand-off; and Settings saying sign-in happens there and Codehouse never sees it. Loading claude.ai inside Codehouse, automation flags and reading anything back are prohibited (CH-01).

## Decision

- **`apps/host/src/chat/handoff.ts`**: `handoffUrl` builds the address from the template and refuses anything but https on `claude.ai` itself (no user name, port or other host) and an id that is not a uuid; `edgeArgs` returns exactly the two arguments, and the profile must be one Edge makes (Default, Profile N, Guest Profile), so it can never carry a switch; `findEdge` reads App Paths (HKCU, then HKLM) with `reg query`; Edge starts detached with no output read and no handle kept.
- **The default browser and the app's link** open through Codehouse-Helper.exe `--open-url` (the address in an environment variable; only https or claude:// accepted), so no shell and no PowerShell. The app's link is used only when turned on in Settings and registered in Windows; otherwise Edge.
- **The address comes from the chat's own claude.ai id** in the store, never from the request; each hand-off is audited with its target and address.
- **Settings, Privacy, Open in Claude**: the target, the Edge profile, and the app's link (off).
