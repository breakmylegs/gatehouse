# Codehouse Neighbourhood Watch

Codehouse Neighbourhood Watch (CNW) is a small server you run at home, on a mini server or a NAS, that shows the
sessions of every computer running Codehouse in a browser, a tablet or a phone. From there you can approve, answer,
send prompts and do what you could do at that computer. Each computer connects out to CNW, so nothing at your desk
needs a port opened. The design and its security are in `docs/design/neighbourhood-watch.md`.

## What you need

- A machine that runs Docker with the compose plugin: Linux (such as Debian 13 with Docker 29 and Compose 5), a NAS,
  or Docker Desktop. The first build needs about 2 GB of memory and 4 GB of disk; CNW itself then runs in about 200 MB.
- An address your devices can reach: an IP address, a name on your home network, or a public name. Each is covered
  below.
- A clone of this repository on that machine: `git clone https://github.com/breakmylegs/gatehouse`.

Everything a machine needs differently goes in `docker/cnw/.env`, which git ignores. Never edit a tracked file to set
CNW up: the updater checks out signed commits in the clone, and a local edit would be in its way.

## Start it

Pick the case that fits, write its `.env`, then from `gatehouse/docker/cnw`:

```sh
docker compose up -d --build
docker compose logs cnw | grep "Setup code"
```

Browse to the address. The first page asks for the setup code from the log (shown once, so whoever reaches a new CNW
first cannot claim it), your name and a password of 12 characters or more.

**An IP address on your home network**, such as `192.168.1.225`:

```sh
echo "CNW_HOST=192.168.1.225" > .env
```

Caddy makes its own certificate for the address. Passkeys are not offered: browsers refuse them for an IP address, so
you sign in with your password. Give CNW a name (below) to use passkeys.

**An IP address on the internet**, such as `203.0.113.9`: the same `.env`, and open port 443 (and 80) to the machine.
The certificate is caddy's own, as above. Prefer a name, so passkeys work.

**A name on your home network**, such as `cnw.home.arpa`, `cnw.lan`, `cnw.internal`, `cnw.local`, or one word:

```sh
echo "CNW_HOST=cnw.home.arpa" > .env
```

Point the name at the machine in your router's DNS (or, to try it, in each device's hosts file). Caddy makes its own
certificate. Passkeys work.

**A public name**, such as `cnw.example.org`:

```sh
echo "CNW_HOST=cnw.example.org" > .env
```

The name's DNS must point at the machine, and ports 80 and 443 must reach it, so caddy can get a Let's Encrypt
certificate by itself.

**Your own reverse proxy** (nginx, Traefik, another caddy) instead of the bundled one:

```sh
cat > .env <<'EOF'
COMPOSE_FILE=compose.yml:compose.own-proxy.yml
CNW_HOST=cnw.example.org
CNW_PORT=8080
CNW_TRUSTED_PROXY=192.168.1.10
EOF
```

CNW then listens in plain HTTP on `CNW_PORT` (default 8080) and the bundled caddy does not run. Your proxy ends TLS at
`https://CNW_HOST`, passes the Host and Origin headers through unchanged, and sets `X-Forwarded-For`.
`CNW_TRUSTED_PROXY` is your proxy's address as CNW sees it (with Docker's port publishing this can be the Docker
network's gateway, shown in `docker compose logs cnw` on a failed sign-in); several may be given with commas. Only that
proxy's `X-Forwarded-For` is believed. Leave it out and the header is ignored: every request then counts as from the
proxy, so sign-in throttling and allowed networks see one address. Set `CNW_PUBLIC_URL` only if people browse to
something other than `https://CNW_HOST`.

**Options for every case.** `CNW_TLS=internal` or `CNW_TLS=public` overrides the certificate choice. `CNW_PORT=8443`
(and `CNW_HTTP_PORT=8080`) publish caddy on other ports when 443 (or 80) is taken; the address then includes the port,
`https://192.168.1.225:8443`, in the browser and in Codehouse. A setting that cannot be used stops the start with a
plain reason in `docker compose logs cnw-config`. The updater works in the clone as its owner, user 1000 by default
(the first user on Debian and Ubuntu); if `id -u` and `id -g` say otherwise for the user who cloned it, set `CNW_UID`
and `CNW_GID`.

## Certificates

The bundled caddy chooses by itself from `CNW_HOST`: its own certificate authority for an IP address or a
home-network name, Let's Encrypt for a public name.

With caddy's own authority, a browser warns the first time ("Your connection isn't private") until you trust caddy's
root certificate on that device. Get it with
`docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt`, and add it to the device's trusted roots
(Windows: Manage computer certificates, Trusted Root Certification Authorities; iPhone: install the profile, then turn it
on in Settings, General, About, Certificate Trust Settings). Or accept the warning once per browser.

Codehouse does not need the root trusted: it pins CNW's certificate when you pair. The authority and certificates live
in the `caddy-data` volume, so they stay the same across restarts and CNW updates and the pin keeps working. Never
remove that volume (`docker compose down -v` would); if it is lost, pair each computer again.

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

To publish one (on the computer that holds the release key): raise `version` in `apps/cnw/package.json`, push to
`main`, then run `npm run release:cnw` (`-- --dry` says what it would upload). It signs `cnw-update.json` for the pushed
commit and uploads it with `cnw-update.sig` to the `cnw-latest` release, which is always a pre-release and never the
latest release, because Codehouse's own update reads the latest one.

## Troubleshooting

- **The computer shows "not connected".** In Codehouse, the Doctor and Settings, Neighbourhood Watch show the state: Connecting
  (CNW is not reachable from that computer: check the name and that port 443 is open on the server), Refused (pair it
  again).
- **The build stops with "Killed" or runs out of memory.** The interface's build needs about 2 GB; give the VM more
  memory, or add swap, and run `docker compose up -d --build` again.
- **caddy does not start.** `docker compose logs cnw-config` says what in `.env` could not be used.
- **Forgot the password.** Stop CNW, delete `users.json` in the `cnw-data` volume, start it again and use the new
  setup code from the log. Paired computers stay paired.
