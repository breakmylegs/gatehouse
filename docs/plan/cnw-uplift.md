# CNW front-end uplift (owner, 17 Nov): in progress

**Go-ahead given 18 Nov** (CNW opens the owner's computer and shows the full history). Phase 1 is done:
`apps/cnw/PRODUCT.md`, `apps/cnw/DESIGN.md` and `docs/design/cnw-journeys.md`. The order is in
`docs/plan/queue-2026-11-18.md`.

**Start only after:** the current CNW fixes are done and released (the /app/ base path, the start screen opening on the
main screen), and the owner confirms CNW opens their computer. Not before.

**Goal:** totally uplift CNW's own front end (apps/cnw/public and apps/cnw/src: what you see before opening a computer).
Today it is one page, one account, name and password, allowed networks only, the rest in environment variables.

## Requirements

1. **Settings in the GUI, not .env.**
   - `.env` is bootstrap only: ideally just `CNW_HOST`, which is optional and defaults to the machine's IP.
   - Everything else is set in the GUI and stored in the cnw-data volume: address, TLS mode, ports, trusted proxy, allowed networks, sign-in policy, notifications and updates.
   - A change to the address, TLS or ports regenerates caddy's configuration (cnw-config) and restarts caddy safely, with a clear warning that a new certificate breaks every pairing.
   - Show CNW's certificate SHA-256 (to compare with Codehouse's pin), and offer caddy's root certificate to download.
2. **Email sign-in.** The email is the username. An existing name-based account is asked for an email at its next sign-in, keeping its password.
3. **Notifications from a computer's remote sessions, while it is open in CNW.**
   - In-page toasts.
   - System notifications (Notification API) while the tab is open.
   - Web Push through a service worker for a closed tab or a phone, when the certificate is trusted.
   - Settings explains the trusted-certificate requirement for push, rather than failing silently.
4. **Research-backed features, in this priority order (group a first):**
   - a. A dashboard across all computers: online or offline, last seen, sessions working or waiting, pending approvals, limit state, Codehouse version (with an out-of-date warning) and the kill switch. A single approvals inbox across computers (Severe needs re-auth). An activity feed of decisions made from CNW, and by whom.
   - b. Notification rules: event types, computers, minimum severity and quiet hours. Optional channels: email (SMTP), ntfy, Pushover, Telegram and webhooks.
   - c. Users and roles (owner, admin, approver, viewer), invites by email, per-computer access, a TOTP second factor (passkeys cannot work on an IP), signed-in devices with revoke, and password reset by email when SMTP is set.
   - d. Server: updates (channel, auto or manual, schedule, roll back to the previous image, release notes); health (disk, memory, uptime, updater and caddy state, connection history); backup and restore of CNW data; an audit log viewer.
   - e. Pairing by QR code with a countdown, renaming computers, groups or tags, and Wake-on-LAN.

   Record anything deferred in BUILD_REPORT, with the reason.

## Design method

- **Design with Intent** (https://designwithintent.ai; `npx skills add ghaida/intent --all`, or the plugin from ghaida/intent): use /intent, /journey, /organize, /evaluate, /include, /fortify and /specify, and check against its anti-pattern library.
- **Impeccable** (https://impeccable.style; `npx impeccable install`, or the plugin from pbakaus/impeccable): run /impeccable init to write PRODUCT.md and DESIGN.md, then shape, critique, audit, polish and harden, and clear its slop checks.
- Both are third-party. Impeccable's hooks run code after edits, so install deliberately, as for any plugin or hook, and record it in BUILD_REPORT.
- CNW must look and feel part of Codehouse (apps/web/public/codehouse, docs/brand), not generic AI UI. It must be mobile-first (an installable PWA), work in light and dark, and have full keyboard and screen-reader access.

## Security must not regress

- Severe approvals still need a signed-in person, never an allowed network alone.
- CNW can never re-arm a kill switch.
- No credential leaves a computer.
- CSRF, throttling and the trusted-proxy rule all stay.
- Settings changes are audited.
- Secrets (SMTP passwords, push keys, TOTP seeds) are stored sealed in the data volume, and never logged or sent to the browser after saving.
- Update the threat model for every new surface: users and roles, SMTP, push, webhooks, TOTP, settings that change TLS, backup files and Wake-on-LAN.

## Phases

Each phase is released with screenshots in BUILD_REPORT. A CNW-only phase is pushed to main for the owner to `git pull` and rebuild; the desktop app is released only when a phase touches Codehouse itself.

1. PRODUCT.md, DESIGN.md and the journeys.
2. GUI settings, plus email sign-in and its migration.
3. The dashboard, the approvals inbox and notifications.
4. Users, roles, TOTP and devices.
5. Server settings, updates with rollback, health and backup.
6. The final Impeccable critique, audit and polish, and the Intent include and evaluate pass.

Testing standard as usual: tests for each change, plus named regression tests.
