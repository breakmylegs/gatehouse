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
first cannot claim it), your email and a password of 12 characters or more. You sign in with the email.

**Made your account before email sign-in?** Sign in once with your name and password as before; CNW then asks for
your email, keeps your password and passkeys, and from then on you sign in with the email.

**"CNW needs updating" or "Codehouse needs updating"**: the two speak different versions of their protocol, so what the
older one cannot carry (such as a long history) may not arrive. CNW says it on its list of computers, and Codehouse in
Settings, Neighbourhood Watch. Update the older one: CNW with `scripts/update.sh` on its server (see Updates), Codehouse from
Settings, About.

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
root certificate on that device. Download it from CNW's Server panel (Download the root certificate; it is there from
the second start, once caddy has made it), or get it with
`docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt`, and add it to the device's trusted roots
(Windows: Manage computer certificates, Trusted Root Certification Authorities; iPhone: install the profile, then turn it
on in Settings, General, About, Certificate Trust Settings). Or accept the warning once per browser.

Codehouse does not need the root trusted on the computer: it pins caddy's root certificate when you pair (ADR 0020),
and checks every connection against it, the chain and the address. caddy renews CNW's own certificate every few hours
with a new key, and that keeps connecting, as do restarts, rebuilds and CNW updates. The root lives in the
`caddy-data` volume; never remove it (`docker compose down -v` would). If it is lost, each computer says CNW's
certificate changed, and you can trust it again there (below) or pair it again.

## The Server panel

Once signed in, the Server panel sets CNW's address, its kind of certificate and its port (and, behind your own
proxy, the proxy's address). Saved there, they win over `.env`; Save writes caddy's configuration again and starts
caddy and CNW again, which takes a minute. It also shows the fingerprint of caddy's root certificate, the one
Codehouse pins and shows when you trust CNW again, and that of this address's own certificate, which caddy renews.

A new address, or the other kind of certificate, gives CNW a new certificate: the panel names every paired computer
that will stop connecting, and changes it only when you confirm; pair each one again after. Docker publishes the port
from `.env` when you start the stack by hand, so keep `CNW_PORT` in `.env` the same as the panel's port, or remove it;
the panel says when they differ. An allowed network cannot see or change any of this.

## Pair a computer

1. In CNW, choose **Make a pairing code**. It works once, for ten minutes.
2. On the computer, open Codehouse, **Settings, Connectors, Neighbourhood Watch**, enter CNW's address and the code,
   and choose **Pair this computer**.
3. The computer appears in CNW's list. **Open** shows its Codehouse; **Remove** disconnects it at once.

Codehouse makes a key pair for the computer and keeps the private half sealed for your Windows user (the Keychain on a
Mac). It pins caddy's root certificate on first use (or, with a public certificate, trusts the system's store), and a
computer paired before that moves to the root by itself the next time it connects. If CNW's certificate really changes
(a new address or kind of certificate, or a new root), it stops connecting and says so, and CNW's board shows
"certificate refused by this computer". Then either pair again, or choose **Trust CNW's certificate again** in
Codehouse: it shows the root's fingerprint, which you compare with the Server panel's, and keeps this computer as it is
on CNW. Untick **Share this computer's sessions** to stop for a while, or **Unpair** to end it.

## Single sign-on

CNW can sign people in through your organisation's identity provider, with OpenID Connect or SAML 2.0, beside its own
passwords, codes and passkeys. Those keep working, so a provider that is down or set up wrongly never locks you out:
sign in with your password and fix it.

Set it on the Server page, under **Single sign-on**. The panel shows the three addresses a provider asks for:

| What the provider calls it | CNW's address |
| --- | --- |
| Redirect URI (OpenID Connect) | `https://<CNW_HOST>/api/sso/oidc/callback` |
| Entity ID or Identifier (SAML) | `https://<CNW_HOST>/api/sso/saml/metadata` |
| Reply URL or ACS URL (SAML) | `https://<CNW_HOST>/api/sso/saml/acs` |

CNW's own SAML metadata is at the entity ID's address once SAML is set, for a provider that reads it.

**Who it is.** Choose how a sign-in finds its CNW person:

- **Their email**: the provider's email for them, taken only when the provider does not say it is unverified, matched
  to a CNW person with that email.
- **Their subject**: the provider's own id for them (`sub` in OpenID Connect, the NameID in SAML). Each person links it
  once, signed in, from **You**, **Link**. Choose this when emails can change or are not verified (Entra ID's often are
  not).

Nobody is made, and no role given, unless you tick **Make an account for someone with none**. Then the new person gets
the role you choose, viewer, approver or admin, and never owner.

**What it does not give.** A single sign-on is not a passkey sign-in, and does not count as having just signed in. To
allow a Severe request, CNW still asks for the password (and its code) or a passkey again. Someone CNW made by single
sign-on has no password: they add a passkey on **You** to allow Severe requests.

**A second factor.** Someone with a code from an app set on their CNW account is asked for it after single sign-on too.

**How it signs in.** OpenID Connect uses the authorization code flow with PKCE, state and nonce. CNW finds the
provider from its issuer URL and checks the ID token's signature against the provider's keys, and its issuer,
audience, expiry and nonce. SAML needs the assertion itself signed with a certificate from the IdP's metadata. The
assertion must be for CNW as its audience, from the IdP's own issuer, in answer to a request CNW made, and not seen
before. The client secret is sealed like CNW's other secrets and never shown again. While you are at the provider,
CNW keeps the sign-in's state in a short-lived cookie for that one callback. Every single sign-on, link and refusal is
in the audit log (the Server page's log) and CNW's own log.

### Authentik

OpenID Connect:

1. In Authentik, **Applications**, **Providers**, **Create**: **OAuth2/OpenID Provider**.
2. **Client type** Confidential. **Redirect URIs**: Strict, CNW's redirect URI.
3. **Signing Key**: choose a certificate (the built-in self-signed one will do). CNW checks the ID token's signature
   against it.
4. **Scopes**: keep openid, email and profile.
5. Create an application for the provider, for example with the slug `cnw`.
6. In CNW: **Issuer URL** `https://<authentik>/application/o/cnw/`, and the provider's client ID and client secret.

SAML:

1. **Providers**, **Create**, **SAML Provider**.
2. **ACS URL** is CNW's reply URL, and **Audience** is CNW's entity ID.
3. Choose a **Signing Certificate**, and switch on signing the assertion.
4. Create an application for it.
5. In CNW, **IdP metadata URL** is the provider's metadata download link,
   `https://<authentik>/api/v3/providers/saml/<id>/metadata/?download`. Or download the file and choose it.

### Keycloak

OpenID Connect:

1. In the realm, **Clients**, **Create client**: OpenID Connect, client ID `cnw`.
2. **Client authentication** on, **Standard flow** on.
3. **Valid redirect URIs**: CNW's redirect URI.
4. Under **Advanced**, **Proof Key for Code Exchange Code Challenge Method**: S256.
5. Copy the secret from **Credentials**.
6. In CNW: **Issuer URL** `https://<keycloak>/realms/<realm>`.

SAML:

1. **Clients**, **Create client**: SAML, **Client ID** CNW's entity ID.
2. **Valid redirect URIs** and **Master SAML Processing URL**: CNW's reply URL.
3. Under **Keys** and **Advanced**, **Sign assertions** on.
4. To match by email, either set **Name ID format** to email or add an email attribute mapper.
5. In CNW: **IdP metadata URL** `https://<keycloak>/realms/<realm>/protocol/saml/descriptor`.

### Entra ID

OpenID Connect:

1. **App registrations**, **New registration**. Under **Redirect URI**, choose Web and enter CNW's redirect URI.
2. **Certificates & secrets**, **New client secret**, and copy its value.
3. **API permissions**: openid, email and profile. Under **Token configuration**, add the optional claim `email` to
   the ID token.
4. In CNW: **Issuer URL** `https://login.microsoftonline.com/<tenant-id>/v2.0`, and the application (client) ID and
   the secret.

Entra ID does not always say an email is verified, and a person's email can change. **Their subject**, with each
person linking from **You**, is the safer match there.

SAML:

1. **Enterprise applications**, **New application**, **Create your own application**, non-gallery.
2. **Single sign-on**, **SAML**. **Identifier (Entity ID)** is CNW's entity ID, and **Reply URL** is CNW's reply URL.
3. Under **SAML Certificates**, keep **Signing Option** on one that signs the assertion: "Sign SAML assertion", or
   "Sign SAML response and assertion".
4. In CNW, **IdP metadata URL** is the **App Federation Metadata Url**.

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

## Notifications

On You, **Notify this device** lets a closed tab or a locked phone hear when something newly waits on a computer
you see (every request, or High and Severe only; **Send a test** checks it). A notification says the computer, the
tool, the project and the risk, never the command, and only that browser can read it. The browser must trust CNW's
certificate first: download the root certificate from the Server panel and trust it on the device. On an iPhone, add
Neighbourhood Watch to the Home Screen and turn it on from there.

### Channels

An owner or admin can also send notifications to email (SMTP), ntfy, Pushover, Telegram or a webhook: Server,
Notification channels. Each has its own rule (every request, High and Severe, or Severe only; which computers; quiet
hours) and a Test button. Passwords and tokens are kept sealed and never shown again. With email set up, invites are
emailed, and **Forgot your password?** on the sign-in page emails a link to set a new one.

## Updates

**On the server, one command** (from any folder; the script works on the clone it sits in):

```sh
/opt/gatehouse/scripts/update.sh
```

It notes the commit running now, runs `git pull`, then `docker compose --progress plain up -d --build` in
`docker/cnw` (with `compose.own-proxy.yml` too when `.env` sets CNW up behind your own proxy), showing every line of
the build. It waits up to four minutes for CNW's health check. If CNW does not come up healthy, it goes back to the
noted commit, rebuilds it, says **ROLLED BACK** and exits with an error. At the end it prints the old and new commit
and CNW's protocol number (the handshake with Codehouse). It stops at the first error, refuses to run over files you
changed by hand, and uses `sudo` only for docker, only when your user cannot reach Docker itself.

The first time, the script is not on the server yet: run `git -C /opt/gatehouse pull` once, then the script. After
that, the script alone.

**From CNW's own page**, CNW checks this repository for a signed CNW release. **Update** asks the updater service (the only part that can reach
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
