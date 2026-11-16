# Codehouse Neighbourhood Watch

Codehouse Neighbourhood Watch (CNW) is a small server you run at home, on a mini server or a NAS, that shows the
sessions of every computer running Codehouse in a browser, a tablet or a phone. From there you can approve, answer,
send prompts and do what you could do at that computer. Each computer connects out to CNW, so nothing at your desk
needs a port opened. The design and its security are in `docs/design/neighbourhood-watch.md`.

## What you need

- A machine that runs Docker with the compose plugin (Linux, a NAS, or Docker Desktop).
- A name for it that your devices can reach, such as `cnw.home.arpa` on your home network (set it in your router's
  DNS) or a public name if you want to reach it from outside.
- A clone of this repository on that machine: `git clone https://github.com/breakmylegs/gatehouse`.

## Start it

```sh
cd gatehouse/docker/cnw
echo "CNW_HOST=cnw.home.arpa" > .env
docker compose up -d --build
docker compose logs cnw | grep "Setup code"
```

Browse to `https://cnw.home.arpa`. The first page asks for the setup code from the log (shown once, so whoever reaches
a new CNW first cannot claim it), your name and a password of 12 characters or more.

**Certificates.** With a public name, caddy gets a Let's Encrypt certificate by itself. On a home name, change the
`Caddyfile` site to use `tls internal` and trust caddy's root certificate on your devices
(`docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt`). Codehouse does not need it trusted: it
pins CNW's certificate when you pair.

## Pair a computer

1. In CNW, choose **Make a pairing code**. It works once, for ten minutes.
2. On the computer, open Codehouse, **Settings, Connectors, Neighbourhood Watch**, enter CNW's address and the code,
   and choose **Pair this computer**.
3. The computer appears in CNW's list. **Open** shows its Codehouse; **Remove** disconnects it at once.

Codehouse makes a key pair for the computer and keeps the private half sealed for your Windows user (the Keychain on a
Mac). It pins CNW's certificate on first use: if the certificate changes, it stops connecting until you pair again.
Untick **Share this computer's sessions** to stop for a while, or **Unpair** to end it.

## What CNW can and cannot do

- Everything you can do at the computer, through the same checks: the floor, your rules and the audit log run on the
  computer. Each decision made from CNW is recorded with the channel `cnw` and the person signed in.
- A Severe request can be approved from CNW only by someone signed in, never from an allowed network alone.
- The kill switch on the computer stops everything, and CNW cannot re-arm it.
- No credential leaves the computer: not your Claude sign-in, not any token.

## Allowed networks

Under **Allowed networks** you can list address ranges, such as `192.168.1.0/24`, whose devices need no sign-in. Leave
it empty to always sign in. Ranges wider than /8 (IPv4) or /16 (IPv6) are refused. Even on an allowed network, changing
this list, removing a computer and approving a Severe request need someone signed in.

## Updates

CNW checks this repository for a signed CNW release. **Update** asks the updater service (the only part that can reach
Docker, and only through a restricted socket proxy) to fetch that release, check its signature, check out exactly the
signed commit, rebuild and restart CNW. Your data volume is kept. Anything unsigned, or a different commit, is refused
and CNW stays as it was.

## Troubleshooting

- **The computer shows "not connected".** In Codehouse, Settings, Neighbourhood Watch shows the state: Connecting
  (CNW is not reachable from that computer: check the name and that port 443 is open on the server), Refused (pair it
  again).
- **Forgot the password.** Stop CNW, delete `users.json` in the `cnw-data` volume, start it again and use the new
  setup code from the log. Paired computers stay paired.
