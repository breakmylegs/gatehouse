# Product: Codehouse Neighbourhood Watch (CNW)

<!-- impeccable:product-schema 1 -->

CNW's own record. The product as a whole is in the root `PRODUCT.md`; this file covers only what CNW shows before you
open a computer (`apps/cnw/public`), which the uplift in `docs/plan/cnw-uplift.md` rebuilds. Once a computer is open,
CNW serves the Codehouse interface itself (`apps/web`, built for `/app/`), and the root records govern it.

Source: `docs/plan/cnw-uplift.md` (owner, 17 Nov), `docs/design/neighbourhood-watch.md` (owner, 15 Nov),
`docs/neighbourhood-watch.md` and the code in `apps/cnw`. The interview was not run: the owner asked for the build to
go ahead without questions (18 Nov). Facts marked *(inferred)* come from the brief and the code rather than the owner's
own words, for the owner to confirm.

## Platform

web

## Stack

Existing: a Fastify server in TypeScript (`apps/cnw/src`) serving plain HTML, CSS and JavaScript modules from
`apps/cnw/public`, with no framework and no build step for these pages. The uplift keeps that *(inferred: the brief
does not ask for a framework, and the pages must load on a phone over a home network with nothing else running)*.
Installable as a PWA (`manifest.webmanifest`).

## Users

- **The owner**: one senior technology architect who runs Codehouse on a Windows laptop and a Mac, and CNW in docker
  compose on a home mini server (a Debian 13 VM at 192.168.1.225 today). They open CNW from a phone, a tablet or another
  computer's browser, often away from the desk, to see whether a session needs them and to act on it.
- **Later, a household or a small team** *(from the uplift brief, requirement 4c)*: people the owner invites with a role
  (owner, admin, approver, viewer) and access to some computers only.

## Product Purpose

From anywhere on the owner's own network or address, see every paired computer and what its sessions need, and do what
you could do at that computer. CNW's own pages exist for the moments around that: signing in, pairing a computer,
seeing at a glance which computer needs you, answering what waits across all of them, and running the server itself
(its address and certificate, users, updates, health and backups).

Success: from a phone, in seconds, the owner knows whether anything waits and on which computer, and can act on it
safely; and the server is set up and kept current from its own pages, never by editing `.env`.

## Positioning

Your own server, not a cloud service. Each Codehouse connects out to CNW, so nothing at home needs a port opened, and
nothing leaves the owner's network for a vendor. The computer still decides: the floor, the policy and the audit run on
each computer whatever CNW sends, credentials never leave it, and CNW cannot re-arm a kill switch.

## Operating Context

- A phone first (iPhone Safari, added to the Home Screen), then a tablet or a desktop browser. Mobile first.
- Reached by an IP address on the home network (no passkeys there: browsers refuse WebAuthn on an IP), a local DNS
  name, or a public name with Let's Encrypt. Behind caddy, which holds TLS; or behind the owner's own proxy.
- A certificate from caddy's own CA on a home network, so the browser must trust its root before Web Push works.
- The owner updates CNW with `git pull` and a rebuild on the VM today; the uplift brings updates and rollback into
  its own pages.

## Capabilities and Constraints

- Today: name and password sign-in (scrypt), passkeys where the address allows, allowed networks that may skip
  sign-in, pairing by a one-time code, a list of computers, open a computer (the Codehouse interface at `/app/`), sign
  out. Everything else is set in environment variables.
- The uplift (owner, 17 Nov), in its phases: settings in the GUI with `.env` as bootstrap only; email sign-in with
  migration of the existing name-based account; notifications (in-page, system and Web Push); a dashboard across
  computers and one approvals inbox; users, roles, invites, per-computer access, TOTP and signed-in devices; server
  settings, updates with rollback, health, backup and restore, and an audit log viewer; pairing by QR code, renaming,
  groups and Wake-on-LAN.
- A protocol version handshake between Codehouse and CNW (owner, 18 Nov): on a mismatch both say which side needs
  updating rather than losing data.
- Security that must not regress: a Severe approval needs a signed-in person, never an allowed network alone; CNW
  never re-arms a kill switch; no credential leaves a computer; CSRF, throttling and the trusted-proxy rule stay;
  settings changes are audited; secrets are stored sealed and never shown or logged after saving.
- Terminology: "computer" (a paired Codehouse), "session", "approval", "Needs you", "kill switch", "pair",
  "allowed networks", "Severe".

## Brand Commitments

- Name: "Codehouse Neighbourhood Watch", "CNW" for short. Part of Codehouse: it must look and feel like Codehouse, not a
  generic admin panel or generic AI UI (owner, 17 Nov).
- Voice: plain, precise UK English in sentence case, no em dashes, no hype; explanations in visible text, never in
  hover tooltips.
- "Powered by Claude" is allowed. Never named or styled as Claude Code or claude.ai; no Anthropic logos.
- The Codehouse artwork (a roadhouse at night, neon) is original and may be used (`apps/web/public/codehouse`,
  `docs/brand`).

## Evidence on Hand

- The running server and its tests (`apps/cnw/test`), the Docker stack (`docker/cnw`), and the owner's VM.
- Brand: `docs/brand/palette.json`, the icon and pictures in `apps/web/public/codehouse` and `docs/brand`.
- There are no users other than the owner, no customer quotes and no usage numbers, and none may be invented.

## Product Principles

1. **What needs you, first.** The first screen answers "does anything wait, and where?" before anything else.
2. **The computer decides.** CNW asks; each computer's floor and policy answer. Nothing in CNW's pages may suggest
   otherwise, and the dangerous actions say whose rule applies.
3. **Settings you can see, changes you can undo.** Every server setting is in the GUI, says what it breaks before it
   breaks it (a new certificate unpairs every computer), and is audited.
4. **Safe on a phone.** One thumb, a small screen, a poor connection: every action is reachable, confirmable and hard
   to do by accident.
5. **Never silent.** A mismatch, a stale image, a refused push or a lost connection says so in words, with the fix.

## Accessibility & Inclusion

WCAG 2.2 AA in light and dark, following the device's theme. Full keyboard and screen-reader access. Risk and state
are never shown by colour alone. Respect reduced motion. Touch targets at least 44 by 44 pixels.
