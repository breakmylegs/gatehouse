# Codehouse Neighbourhood Watch (CNW), design note

Owner request, 15 Nov (O41, priority 1): a docker compose stack on a home mini server that serves the full Codehouse
interface for sessions running on other computers. Each Codehouse connects out to CNW, so nothing at home needs port
forwarding; from a desktop browser, a tablet or a phone you see every computer's sessions, approve, answer, send
prompts and do what you could do at that computer. CNW lives in this repository, is public, and updates itself from
its own interface. Sign-in is a username and password, with passkeys offered; an IP allow list can skip sign-in for
address ranges you trust.

This note is the plan the build follows. It records the decisions taken under the standing instruction ("choose the
recommended option, safety first"), for the owner to confirm, and what it changes in the security invariants.

## Research, and what it settled

- **Outbound connections from the edge.** Remote-management agents that work behind NAT (Portainer's Edge Agent,
  MeshCentral, cloudflared) all have the agent open the connection; the server never dials in. They use port 443
  (outbound 443 is almost never blocked, other ports often are), keep-alives shorter than home routers' NAT timeouts,
  and reconnect with exponential backoff and jitter, telling an authentication failure (stop) from a network one
  (retry). CNW does the same: Codehouse opens one WebSocket over TLS to CNW and keeps it.
  [Portainer Edge behind NAT](https://oneuptime.com/blog/post/2026-03-20-portainer-edge-behind-nat-firewall/view),
  [MeshCentral and CGNAT](https://natchecker.com/blog/meshcentral),
  [WebSocket reliability patterns](https://zylos.ai/research/2026-02-23-websocket-reliability-multi-agent-systems/)
- **Updating a compose stack from its own page.** An app cannot safely recreate its own container, and mounting the
  Docker socket into a web app gives it root on the host. The safe pattern is a small separate updater service that
  alone talks to Docker, takes a narrow request from the app, pulls or builds the new version and recreates the stack;
  the app itself exits and lets the restart policy bring it back.
  [Compose updates](https://hostim.dev/learn/docker/updating-images-compose/),
  [compose-updater](https://github.com/virtualzone/compose-updater), [Pulse's approach](https://github.com/rcourtman/pulse/commit/ea14f17)
- **Passwords and passkeys.** Use a maintained WebAuthn library (this repository already uses SimpleWebAuthn for the
  phone), the server's domain as the relying party, discoverable credentials and conditional UI so the passkey is
  offered in the username field, and keep the password as the fallback until passkeys are in use.
  [Passkeys in Node.js](https://dudelemon.com/blog/webauthn-passkeys-node),
  [Production guide](https://www.hirenodejs.com/blog/nodejs-passkeys-webauthn-2026)

## Shape

```
  laptop: Codehouse Host ──wss (outbound, 443)──┐
  Mac:    Codehouse Host ──wss (outbound, 443)──┤
                                                 ▼
  home mini server:  caddy (TLS) ──▶ cnw (Node, Fastify)  ◀──▶ updater (Docker, alone)
                                         ▲
  browser / tablet / phone ──https───────┘
```

- **apps/cnw**: a Fastify server (Node 22, TypeScript, the repository's own libraries: fastify, ws, @simplewebauthn,
  zod). No new dependency is needed. Data in a volume as JSON files written atomically, like Codehouse (no native
  addons, so no SQLite). Passwords hashed with Node's own scrypt.
- **The interface** is the existing desktop web app (apps/web) built in a remote mode: the same screens, talking to
  CNW instead of the local Host. A computer picker sits at the top; everything below works as it does at that
  computer. Responsive layouts for tablet and phone, and installable as a PWA.
- **Codehouse side**: Settings, Neighbourhood Watch: the address, Pair (a one-time code shown in CNW), on or off, and
  what this computer shares. When on, the Host opens the outbound connection, sends its sessions' state and events,
  and takes commands.
- **docker compose**: `caddy` (TLS: Let's Encrypt for a public name, or its internal CA on a home network, the root
  shown for you to trust), `cnw`, and `updater`. Only caddy publishes a port.

## Security

What CNW changes, recorded here and in the threat model before any of it is built:

1. **Invariant 7 (listeners on 127.0.0.1 only)** stays true for Codehouse: it listens on nothing new. CNW is a
   separate program on your server and listens behind caddy.
2. **Invariants 8, 9 and 11 (the Relay is untrusted and sees only ciphertext; the phone's narrow scope)** do not
   describe CNW. CNW is your own server and you asked it to do everything you can do at the computer, so it sees
   session content in plain text over TLS, as the desktop does. This is a new owner decision that amends those
   invariants for CNW only; the Relay and the phone app keep them.
3. **What still holds on every computer, whatever CNW sends:** the floor, the policy and the audit log run in the
   Host as now. Edited input goes through the floor and the policy again (invariant 10). A Severe allow still needs
   allow typed. The kill switch on the computer stops everything, and CNW cannot re-arm it.
   Credentials never leave the computer (invariant 6). Every command from CNW is recorded with the channel `cnw`
   and the CNW user.
4. **Pairing**: CNW shows a one-time code (ten minutes). Codehouse sends it with a key pair it makes; CNW pins the
   computer's public key, and the computer pins CNW's TLS certificate fingerprint on first use, so a changed
   certificate stops the connection until you pair again. Each computer can be removed in CNW, and unpaired in
   Codehouse.
5. **Sign-in**: username and password (scrypt), passkeys offered and encouraged, sessions in HttpOnly, Secure,
   SameSite=Strict cookies that rotate at sign-in, CSRF tokens on every change, five tries then a growing wait, and
   sign-in recorded in CNW's own log.
6. **IP allow list (you asked for it to skip sign-in).** Off and empty until set. Only ranges you list skip sign-in,
   and only from the address caddy saw (never a header from outside). 0.0.0.0/0 and ::/0 are refused. A request from
   an allow-listed address can still not do the three most dangerous things without signing in: change the allow
   list, unpair a computer, and approve a Severe request. Decided under the standing instruction; the owner may
   relax it.
7. **Updates** never break (the owner's rule for Codehouse holds here too): CNW checks the repository's releases for
   a signed `cnw-update.json` (the same release key as Codehouse), and Update asks the updater to fetch that release,
   check its signature, build the new image and recreate the stack, keeping the data volume. The updater refuses
   anything unsigned and keeps the previous image to go back to.

## More that would help (from the research)

- A board of every computer's sessions at once, with what waits on you first.
- Web push notifications from CNW to the phone and the browser, for requests waiting.
- A health page for each computer: online, last heard, version, plan use.
- Per-user accounts with roles (viewer, approver, owner), for a household or a small team.
- Audit search across computers.
- Read-only share links for one session, expiring.

## Build order

1. This note, the threat model entries, and the owner decisions in BUILD_REPORT.
2. apps/cnw: the server, its store, sign-in with password and passkeys, the allow list, pairing.
3. The Codehouse connector: Settings, pairing, the outbound connection, state and events out, commands in, recorded.
4. The interface in remote mode, the computer picker, tablet and phone layouts, PWA.
5. docker compose with caddy and the updater; signed CNW releases from `npm run release:cnw`.
6. Docs (`docs/neighbourhood-watch.md`), Doctor lines, and an end-to-end test with a Host and CNW on one machine.
