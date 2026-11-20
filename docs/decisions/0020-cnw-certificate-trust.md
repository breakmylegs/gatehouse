# ADR 0020: How Codehouse trusts Neighbourhood Watch's certificate

Status: **Decided, 20 Nov 2026** (owner: "Pick the best design and record it in an ADR"). Built on fix/cnw-pin.

## Context

Pairing with Codehouse Neighbourhood Watch (O41) pinned the SHA-256 of the leaf certificate CNW presented (trust on first use), and every later connection compared the leaf with that pin. CNW's bundled caddy uses `tls internal` for an IP address or a home name. caddy's own authority issues leaf certificates that last about 12 hours, renews them before they expire with a new key each time, and renews its intermediate about every 7 days. So the pin went stale within hours, and at once after a caddy restart or a rebuild (`scripts/update.sh`, the updater's `/apply`). The connector then marked the pairing refused and never retried, and the board showed the computer as "Offline, never connected". The only fix was to delete it and pair again.

What was checked (20 Nov):

- **The Host's log** on the owner's computer has "its certificate is not the one it had when you paired" seven times between 17 and 18 Nov, hours apart, each followed by a refusal.
- **The Caddyfile** cnw-config writes says only `tls internal` with no lifetime, so caddy's default (12 hours) applies.
- **caddy's root** lives in the named `caddy-data` volume (`/data/caddy/pki/authorities/local/root.crt`). `docker compose up -d --build`, `scripts/update.sh` and the updater's apply and rollback recreate containers, never volumes, so the root survives all of them. Only `docker compose down -v`, or removing the volume, makes a new one.

## Options

1. **Keep pinning the leaf** and make caddy's leaf last longer (`tls internal { lifetime 90d }`). It still changes on every renewal and on any re-issue, and caddy caps internal lifetimes; it only moves the breakage.
2. **Pin the leaf's public key** (SPKI) instead. caddy makes a new key at each renewal, so this breaks just as often.
3. **Turn verification off and check the leaf by hand.** The owner ruled this out, and it is the pattern that caused the breakage.
4. **Pin caddy's root certificate and verify every connection properly against it alone**, chain and address, with Node's own checks. For a public certificate (Let's Encrypt), verify against the system's trust store, as a browser would.

## Decision

Option 4.

- **At pairing** Codehouse first tries a verified connection with the system's store. If that verifies, the trust is `public`. Otherwise it reads caddy's root from CNW's new `/agent/ca` over a connection that does not yet trust it (trust on first use, as pairing always was). It believes the root only once a fresh connection verifies against it (`ca: [root]`, `rejectUnauthorized` on, the address checked), and sends the pairing code and public key over a connection verified that way. A root CNW's own certificate does not verify against is refused, and nothing is sent.
- **Every connection** uses `ca: [root]` (or the system's store) with `rejectUnauthorized` on, so a renewed leaf or intermediate under the same root connects, and another root or a certificate for another address does not. No working connection turns verification off.
- **Moving existing pairings over.** A pairing from before (a leaf pin) still connects with its leaf pin while the leaf lasts. When it connects with the leaf still matching, CNW's welcome carries the root. Codehouse checks that a fresh connection verifies against that root, then keeps it as the pairing's trust and records `cnw_trust_moved`. From then on, renewals no longer break it.
- **Recovery without deleting the computer.** A pairing that is already broken has a "Trust CNW's certificate again" action in Settings. Codehouse reads the root again, checks CNW's certificate against it, and shows its fingerprint. CNW's Server page shows the same fingerprint, so you can compare them. Only when you confirm does Codehouse keep it, with the same computer id and key, and record `cnw_trusted_again`. A fingerprint other than the one you confirmed changes nothing.
- **A real change is still refused**, and both sides say so. That covers a new address or kind of certificate on the Server page, or a new root after the volume was removed. Codehouse says "CNW's certificate changed, so nothing was sent. Trust it again, or pair again", and looks again every 15 minutes, so a root that comes back heals by itself.
- **Telling CNW.** Over a connection it does not trust, Codehouse sends CNW only its computer id and a signature over `cnw-refused:` and CNW's challenge. That signature is never over the challenge alone, so it cannot be replayed as a sign-in, and nothing else is sent. CNW's board then says "certificate refused by this computer" rather than "never connected", until the computer connects again.
- **Older versions.** The pairing file keeps the leaf pin (`certSha256`) beside the new `trust`, so an older Codehouse after an undone update reads it as before. It breaks when the leaf renews, as it always did, and is never less safe. An older CNW gives no root, so a pairing with it stays on the leaf pin and moves over once CNW is updated.

## Consequences

- Pairing no longer breaks when caddy renews, restarts or is rebuilt.
- What a stolen root key could do is unchanged from any CA: whoever holds caddy's root key (in the caddy-data volume on the CNW server) can stand in for CNW. That was already true of the server itself, which holds the leaf keys.
- The threat model's entry for CNW (docs/threat-model.md) is updated, and the tests are `apps/host/test/cnw-trust.test.ts` (against a real TLS server with a chain shaped like caddy's) and `apps/cnw/test/hub-certificate.test.ts`.
