# CNW uplift, phase 1: intent, journeys and structure

Phase 1 of `docs/plan/cnw-uplift.md`. With `apps/cnw/PRODUCT.md` (who and why) and `apps/cnw/DESIGN.md` (the look), this
is what phases 2 to 6 build against. Made with the Design with Intent method (intent, journey, organize, fortify,
include, specify) and Impeccable's init, applied by hand from their published guides: the Intent skills could not be
installed in this session (the floor refuses writes to a `.claude` folder), so its steps are followed from
designwithintent.ai rather than run as commands. Recorded in BUILD_REPORT.

## Intent

**For** the owner (and later the people they invite), on a phone away from the desk, **CNW makes it possible to** know
in seconds whether any of their computers needs them and to act on it safely, **so that** sessions keep moving without
the owner sitting at each computer. **It must never** let a network address, a stale page or a mistaken tap stand in
for the owner's decision on something dangerous.

Measures of success: from opening CNW to seeing what waits, under 3 seconds on the home network; an approval answered
from the inbox in two taps (three for Severe, with sign-in again); no setting that needs `.env` after first start;
every mismatch or failure shown with its fix.

## Journeys

Each journey names the moment, what the person needs, and what the build must get right. "Phase" says where it lands.

### J1. First start (phase 2)

The owner runs `docker compose up` with nothing set, or only `CNW_HOST`.

1. CNW starts on the machine's own address with caddy's internal certificate, and prints a one-time set-up link in its
   log (today it prints the first password; the link replaces it).
2. The set-up page asks for the owner's email and a password, then shows the address, the certificate fingerprint and
   the root certificate to download, with one line on why the phone must trust it (Web Push and no warnings).
3. It ends on the empty board with "Pair your first computer" as the one primary action.

Get right: no step needs a file edited; the set-up link works once and expires; the fingerprint is shown in the
monospace, grouped in fours, to compare with Codehouse's.

### J2. Signing in, and the move to email (phase 2)

- **The usual case**: email and password; a passkey offered when the address allows it (a name, not an IP); TOTP after
  the password once set (phase 4).
- **The existing account** (a name, no email): at its next sign-in, after the password, one page asks for an email,
  explains it becomes the sign-in name, and keeps the password. Nothing else changes; the old name stays as the
  display name.
- **Too many tries**: the wait says how long, in words and a countdown, never a bare error.

Get right: the migration cannot be skipped forever (asked again at each sign-in until done) but never locks the owner
out; an allowed network never skips the migration page's password.

### J3. Pairing a computer (phase 2; QR in phase 5)

1. Board, Pair a computer: a code with a ten-minute countdown, the address to type in Codehouse, and later a QR code.
2. In Codehouse, Settings, Neighbourhood Watch: the address and the code.
3. The new computer appears on the board as it connects, named after the computer, with Rename beside it.

Get right: a protocol version mismatch is caught here first (J9); the countdown is text a screen reader hears, not
only a ring.

### J4. What needs me? (phase 3)

The owner opens CNW from the Home Screen.

1. The board: computers with something waiting first, lit, with the count; then working; then idle; then offline
   (last seen). The shell shows the total Needs you count.
2. Tap a lit computer: its interface opens (`/app/`) where it waits. Or open the Inbox (J5).

Get right: the board reads correctly with no colour (shapes and words); offline computers keep their last state, marked
as old, never shown as current.

### J5. Answering across computers (phase 3)

1. Inbox: every waiting approval and question across the computers the person may see, oldest first.
2. Open one: the pass (computer, session, the real command, the rule, risk), then Deny or Allow once.
3. Severe: Allow asks the person to sign in again (password, passkey or TOTP), whatever network they are on. An approver
   role may allow; a viewer sees only.
4. The answer goes to that computer, whose floor and policy decide; the row says "Sent to the laptop" until the
   computer confirms, then leaves the inbox. A refusal from the computer is shown in its words.

Get right: Allow is never the default focus at risk 70 or more; Deny is one tap; the computer's answer, not CNW's, is
what the row reports.

### J6. Being told (phase 3)

1. In-page: a toast for a new approval on another computer while CNW is open.
2. System notifications while the tab is open: asked for with a button that says why, never on page load.
3. Web Push for a closed tab or the phone: offered only when the certificate is trusted; otherwise Settings says
   exactly why it cannot, and links to the root certificate (J1).
4. Rules (phase 3 or later): which events, which computers, minimum risk, quiet hours; optional channels (email,
   ntfy, Pushover, Telegram, webhooks) that carry no command text unless redacted (invariant 9's rule for push channels).

### J7. Changing the address, TLS or ports (phase 2)

1. Server, Address and certificate: the current address, TLS mode, ports, trusted proxy, with the fingerprint.
2. A change that makes a new certificate opens the danger notice: "Every paired computer will stop connecting until
   you pair it again", listing them by name, Cancel the default.
3. On confirm: caddy's configuration is written again and caddy restarted; the page reconnects at the new address, or
   says where to go if it cannot.

### J8. Users, roles and devices (phase 4)

Invite by email (or a link to copy when there is no SMTP), a role (owner, admin, approver, viewer), the computers they
may see; TOTP set-up with a QR code and recovery codes; Signed-in devices with Sign out for each. Only an owner may
change an owner, and the last owner cannot be removed.

### J9. Something is wrong (phases 2 to 5)

- **Version mismatch** (the handshake, phase 2 or 3): CNW's board marks the computer "Codehouse needs updating" or
  shows a banner "CNW needs updating", with what will not work until then; Codehouse says the same in its Settings.
  No data is dropped silently.
- **A computer offline**: last seen, and Wake-on-LAN where set (phase 5).
- **CNW out of date**: a banner with Update; update shows the release notes, keeps the previous image, and offers
  Roll back after (phase 5).
- **Health** (phase 5): disk, memory, uptime, the updater and caddy, connection history; backup and restore.

## Structure (organize)

Four places, the same on every screen size (a bottom tab bar on a phone, a rail from 760px):

| Place | What it holds | First phase |
|---|---|---|
| **Board** | Every computer, what waits on each, open one, pair a computer | 3 (today's list moves here in 2) |
| **Inbox** | Approvals and questions across computers, activity from CNW and by whom | 3 |
| **Server** | Address and certificate, sign-in policy, allowed networks, notifications, updates, health, backup, audit log | 2, then 5 |
| **You** | Your email, password, passkeys, TOTP, signed-in devices; users and roles for an owner or admin | 2, then 4 |

Sign-in and first start sit outside the four. A computer's interface (`/app/`) opens full screen with a way back to the
board.

## Fortify: anti-patterns ruled out

- An allowed network approving Severe, changing allowed networks, unpairing, or changing sign-in policy.
- A setting that silently breaks pairing, push or sign-in.
- A notification permission asked on page load; a push that fails without saying why.
- Stat cards or charts that look busy and answer nothing; yellow used as decoration.
- A secret (SMTP password, push key, TOTP seed) shown again after saving, or put in a log or a page.
- CNW's state shown as the computer's truth when the computer has not confirmed it.
- From Intent's anti-pattern library (designwithintent.ai/patterns): **Dead Ends** (every error and refusal says what
  to do next), **Prechecked Consent** (no notification channel, push or email rule is on until chosen), **Fake
  Countdown Timers** (the pairing and sign-in waits count real expiry, never pressure), **Infinite Scroll** (the
  activity feed and audit log page, with a count), and **Anthropomorphic Manipulation** (CNW speaks as a tool; no
  persona urges an approval).

## Include

Phone one-handed, a screen reader (VoiceOver), keyboard on a desktop, light and dark, larger text (layouts hold at
200% text), reduced motion, a slow or dropping connection (every page says when it is reconnecting and what it is
showing is from when).

## Specify: what each later phase hands over

Every phase: tests for each change with named regression tests; screenshots in BUILD_REPORT at 390px and 1440px in
light and dark; the threat model updated for each new surface; pushed to main for the owner's VM. Phase 6 runs
Impeccable's critique, audit and polish and the Intent include and evaluate passes over all of it.
